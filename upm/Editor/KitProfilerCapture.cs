using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEditor.Profiling;
using UnityEditorInternal;
using UnityEngine;
using UnityEngine.Profiling;
using UnityEngine.SceneManagement;
using Unity.Profiling;

namespace UnityAgentKit.Doctor
{
    // Bounded native capture checkpoints and a small frame index. The .raw files
    // retain every sample Unity saved; indexed rows never pretend to replace them.
    internal static class KitProfilerCapture
    {
        internal static readonly string Root = Path.Combine(Path.GetDirectoryName(Application.dataPath), "Logs", "UnityAgentKit", "Profiler");
        static readonly string ActivePath = Path.Combine(Root, "active.json");
        static readonly string OwnershipPath = Path.Combine(KitActions.Root, "profiler-capture.json");
        static readonly Encoding Utf8 = new UTF8Encoding(false);
        static readonly ProfilerMarker CheckpointMarker = new ProfilerMarker("UnityAgentKit.Profiler.Checkpoint");
        internal static Session Current { get; private set; }
        internal static string LastError { get; private set; }

        [Serializable] internal sealed class Session
        {
            public int schema = 1;
            public string id, label, state, startedUtc, endedUtc, unityVersion, editorSession, targetName, error, stopReason, finalizationNote, leaseToken;
            public int target, first = -1, last = -1, checkpointFrames, indexedFrames;
            public double seconds, maxMb, startedEditorTime, checkpointMs, maxCheckpointMs;
            public long bytes;
            public bool editor, deepProfiling, cleanupComplete;
            public int allocationMode;
            public bool sourceContextKnown = true;
            public string storagePolicy = "Stop threshold; the final native checkpoint may exceed maxMb. No captures are automatically deleted.";
            public Settings previous;
            public CaptureContext captureContext;
            public List<Chunk> chunks = new List<Chunk>();
            public List<Gap> gaps = new List<Gap>();
            public List<Bookmark> bookmarks = new List<Bookmark>();
            [NonSerialized] internal int drainLast, drainStable;
            [NonSerialized] internal double drainStarted;
        }
        [Serializable] sealed class Ownership
        {
            public string id, state, leaseToken, editorSession;
            public bool active;
        }
        [Serializable] internal sealed class Settings
        {
            public bool recording, editor, cpu;
            public int target, allocationMode;
        }
        [Serializable] internal sealed class CaptureContext
        {
            public int schema = 2;
            public string suppliedJson;
            public bool sourceContextKnown, stable = true;
            public EnvironmentContext environment;
            public ProfilerContext profiler;
            public List<ContextChange> changes = new List<ContextChange>();
        }
        [Serializable] internal sealed class EnvironmentContext
        {
            public string scope, scenePath, sceneName, backgroundPumpMode;
            public int sceneCount, width, height, qualityLevel, targetFrameRate, vSyncCount;
            public float fixedDeltaTime, timeScale;
            public bool playing, editorFocused, runInBackground;
        }
        [Serializable] internal sealed class ProfilerContext
        {
            public int target, allocationMode, checkpointFrames;
            public string targetName;
            public bool editor, deepProfiling;
        }
        [Serializable] internal sealed class ContextChange
        {
            public string reason, utc;
            public int profilerFrame;
            public EnvironmentContext environment;
        }
        [Serializable] internal sealed class Chunk
        {
            public string file;
            public int rawFirst, first, last, frameCount;
            public long bytes;
            public double saveMs;
        }
        [Serializable] internal sealed class Gap { public int first, last; public string reason; }
        [Serializable] internal sealed class Bookmark
        {
            public string label, utc, contextJson;
            public int profilerFrame, localUnityFrame;
            public long tick = -1;
            public bool tickSupplied;
        }
        [Serializable] sealed class SessionList { public int total; public bool truncated; public Session[] sessions; }
        [Serializable] sealed class FrameRow { public int frame; public double cpuMs, gpuMs; public bool gpuAvailable; public string gpuAvailability; }
        [Serializable] sealed class FrameList
        {
            public string session, state;
            public int firstFrame, lastFrame, matched, offset, limit;
            public bool truncated;
            public FrameRow[] frames;
            public Gap[] gaps;
            public CaptureContext captureContext;
            public Bookmark[] bookmarks;
        }

        internal static void Install()
        {
            if (AssetDatabase.IsAssetImportWorkerProcess()) return;
            AssemblyReloadEvents.beforeAssemblyReload += () => FinishOnExit("domain-reload");
            EditorApplication.quitting += () => FinishOnExit("editor-quit");
            EditorApplication.update += Tick;
            EditorApplication.focusChanged += OnFocusChanged;
            if (!File.Exists(ActivePath)) return;
            try
            {
                var old = JsonUtility.FromJson<Session>(File.ReadAllText(ActivePath));
                old.state = "interrupted";
                old.error = "The Editor stopped before finalizing this capture; only listed chunks are durable.";
                old.endedUtc = DateTime.UtcNow.ToString("O");
                if (old.editorSession == SessionState.GetString("uak.sessionId", "")) Restore(old);
                WriteJson(Path.Combine(SessionDirectory(old.id), "session.json"), old);
                WriteOwnership(old, false);
                File.Delete(ActivePath);
            }
            catch (Exception e) { LastError = e.Message; UnityEngine.Debug.LogWarning("[KitProfiler] Recovery failed: " + e.Message); }
        }

        internal static string SessionDirectory(string id)
        {
            if (string.IsNullOrEmpty(id) || id != Path.GetFileName(id) || id == "." || id == ".." || id.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
                throw new ArgumentException("session must be an archive ID, not a path");
            return Path.Combine(Root, id);
        }

        internal static Session ReadSession(string id)
        {
            string path = Path.Combine(SessionDirectory(id), "session.json");
            if (!File.Exists(path)) throw new FileNotFoundException("Profiler session does not exist", path);
            var s = JsonUtility.FromJson<Session>(File.ReadAllText(path));
            if (s == null || s.schema != 1 || s.id != id) throw new InvalidDataException("Invalid profiler session manifest");
            return s;
        }

        internal static object Start(KitProfiler.Request r)
        {
            if (Current != null || ProfilerDriver.enabled) throw new InvalidOperationException("A recording is already active; stop it before starting a managed capture");
            if (File.Exists(ActivePath)) throw new InvalidOperationException("An unfinished capture needs recovery before starting another");
            int target = r.target == -2 ? ProfilerDriver.connectedProfiler : r.target;
            if (!ProfilerDriver.GetAvailableProfilers().Contains(target)) throw new ArgumentException("Profiler target is unavailable; use targets to list current IDs");
            var s = NewSession(r.label);
            s.leaseToken = r.leaseToken;
            s.target = target;
            s.seconds = r.seconds; s.maxMb = r.maxMb; s.checkpointFrames = r.checkpointFrames;
            s.previous = new Settings { recording = ProfilerDriver.enabled, editor = ProfilerDriver.profileEditor,
                target = ProfilerDriver.connectedProfiler, cpu = ProfilerDriver.IsAreaEnabled(ProfilerArea.CPU), allocationMode = (int)ProfilerDriver.memoryRecordMode };
            s.editor = r.editor; s.deepProfiling = ProfilerDriver.deepProfiling;
            s.allocationMode = r.allocations ? (int)(ProfilerDriver.memoryRecordMode | ProfilerMemoryRecordMode.GCAlloc | ProfilerMemoryRecordMode.NativeAlloc | ProfilerMemoryRecordMode.UnsafeUtilityMalloc)
                : (int)ProfilerDriver.memoryRecordMode;
            Current = s;
            LastError = null;
            try
            {
                Persist(s);
                ProfilerDriver.connectedProfiler = target;
                ProfilerDriver.profileEditor = s.editor;
                ProfilerDriver.SetAreaEnabled(ProfilerArea.CPU, true);
                ProfilerDriver.memoryRecordMode = (ProfilerMemoryRecordMode)s.allocationMode;
                s.first = ProfilerDriver.lastFrameIndex + 1;
                s.last = s.first - 1;
                s.startedEditorTime = EditorApplication.timeSinceStartup;
                s.targetName = ProfilerDriver.GetConnectionIdentifier(target);
                s.captureContext = new CaptureContext { suppliedJson = r.contextJson ?? "{}", sourceContextKnown = true,
                    environment = ReadEnvironment(target), profiler = new ProfilerContext { target = target, targetName = s.targetName,
                        editor = s.editor, deepProfiling = s.deepProfiling, allocationMode = s.allocationMode, checkpointFrames = s.checkpointFrames } };
                ProfilerDriver.enabled = true;
                Persist(s);
                return s;
            }
            catch
            {
                Restore(s); Current = null;
                s.state = "failed"; s.error = "Capture could not start";
                Persist(s); File.Delete(ActivePath);
                throw;
            }
        }

        static Session NewSession(string label)
        {
            string id = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 8);
            var s = new Session { id = id, label = label ?? "", state = "recording", startedUtc = DateTime.UtcNow.ToString("O"),
                unityVersion = Application.unityVersion, editorSession = SessionState.GetString("uak.sessionId", "") };
            Directory.CreateDirectory(SessionDirectory(id));
            return s;
        }

        static void Tick()
        {
            if (Current == null) return;
            try
            {
                var s = Current;
                if (s.state == "stopping")
                {
                    int received = ProfilerDriver.lastFrameIndex;
                    s.drainStable = received == s.drainLast ? s.drainStable + 1 : 0;
                    s.drainLast = received;
                    if (s.drainStable >= 3 || EditorApplication.timeSinceStartup - s.drainStarted > 2)
                    {
                        if (s.drainStable < 3) s.finalizationNote = "Receive buffer did not settle within 2 seconds; later packets may be absent.";
                        FinalizeStop(s, s.stopReason);
                    }
                    return;
                }
                if (!ProfilerDriver.enabled && ProfilerDriver.connectedProfiler == s.target)
                {
                    Stop("recording-stopped"); return;
                }
                if (s.captureContext != null && !EnvironmentMatches(s.captureContext.environment))
                {
                    InvalidateContext(s, "Scene, Game view resolution, focus, or runtime settings changed during capture");
                    Stop("interrupted"); return;
                }
                if (!ProfilerSettingsMatch(s))
                {
                    s.error = "Profiler settings or target changed during capture";
                    InvalidateContext(s, s.error);
                    Stop("interrupted"); return;
                }
                if (ProfilerDriver.lastFrameIndex < s.last)
                {
                    s.error = "Profiler history was cleared or its frame numbering reset";
                    Stop("interrupted"); return;
                }
                if (EditorApplication.timeSinceStartup - s.startedEditorTime >= s.seconds) { Stop("duration-limit"); return; }
                if (ProfilerDriver.lastFrameIndex - s.last >= s.checkpointFrames) Checkpoint(s);
                if (s.bytes >= s.maxMb * 1024 * 1024) Stop("storage-limit");
            }
            catch (Exception e)
            {
                LastError = e.Message;
                if (Current == null) { UnityEngine.Debug.LogError("[KitProfiler] " + e.Message); return; }
                var failed = Current; Current = null;
                failed.state = "failed"; failed.error = e.Message; failed.endedUtc = DateTime.UtcNow.ToString("O");
                Restore(failed);
                try { Persist(failed); File.Delete(ActivePath); }
                catch (Exception io) { UnityEngine.Debug.LogError("[KitProfiler] Could not finalize failed capture: " + io.Message); }
            }
        }

        static EnvironmentContext ReadEnvironment(int target)
        {
            var scene = SceneManager.GetActiveScene();
            return new EnvironmentContext { scope = target == -1 ? "profiled-editor" : "host-editor",
                scenePath = scene.path, sceneName = scene.name, sceneCount = SceneManager.sceneCount,
                width = Screen.width, height = Screen.height, qualityLevel = QualitySettings.GetQualityLevel(),
                targetFrameRate = Application.targetFrameRate, vSyncCount = QualitySettings.vSyncCount,
                fixedDeltaTime = Time.fixedDeltaTime, timeScale = Time.timeScale, playing = EditorApplication.isPlaying,
                editorFocused = EditorApplication.isFocused, runInBackground = Application.runInBackground,
                backgroundPumpMode = KitPlaySession.BackgroundPumpMode };
        }

        // These Editor properties are cheap to check. Game-specific state and
        // source files are supplied once and are never scanned in the update loop.
        static bool EnvironmentMatches(EnvironmentContext before)
        {
            if (before == null) return false;
            var scene = SceneManager.GetActiveScene();
            return before.scenePath == scene.path && before.sceneName == scene.name && before.sceneCount == SceneManager.sceneCount
                && before.width == Screen.width && before.height == Screen.height && before.qualityLevel == QualitySettings.GetQualityLevel()
                && before.targetFrameRate == Application.targetFrameRate && before.vSyncCount == QualitySettings.vSyncCount
                && before.fixedDeltaTime == Time.fixedDeltaTime && before.timeScale == Time.timeScale && before.playing == EditorApplication.isPlaying
                && before.editorFocused == EditorApplication.isFocused && before.runInBackground == Application.runInBackground
                && before.backgroundPumpMode == KitPlaySession.BackgroundPumpMode;
        }

        // Preserve even a focus transition that returns before the next capture tick.
        static void OnFocusChanged(bool focused)
        {
            var s = Current;
            if (s?.captureContext?.environment == null || s.captureContext.environment.editorFocused == focused) return;
            try
            {
                InvalidateContext(s, "Editor focus changed during capture");
                Stop("interrupted");
            }
            catch (Exception e) { LastError = e.Message; UnityEngine.Debug.LogError("[KitProfiler] Focus change finalization: " + e.Message); }
        }

        static bool ProfilerSettingsMatch(Session s) => ProfilerDriver.connectedProfiler == s.target && ProfilerDriver.profileEditor == s.editor
            && ProfilerDriver.deepProfiling == s.deepProfiling && (int)ProfilerDriver.memoryRecordMode == s.allocationMode
            && ProfilerDriver.IsAreaEnabled(ProfilerArea.CPU);

        static void InvalidateContext(Session s, string reason)
        {
            s.error = reason;
            if (s.captureContext != null)
            {
                if (!s.captureContext.stable) return;
                s.captureContext.stable = false;
                s.captureContext.changes.Add(new ContextChange { reason = reason, utc = DateTime.UtcNow.ToString("O"),
                    profilerFrame = ProfilerDriver.lastFrameIndex, environment = ReadEnvironment(s.target) });
            }
            int tail = ProfilerDriver.lastFrameIndex;
            if (tail > s.last) s.gaps.Add(new Gap { first = s.last + 1, last = tail, reason = reason + "; mixed-context tail was not archived" });
        }

        internal static CaptureContext ContextForRange(int first, int last)
        {
            var s = Current;
            return s != null && first >= s.first && last <= ProfilerDriver.lastFrameIndex ? s.captureContext : null;
        }

        internal static object Stop(string reason)
        {
            if (Current == null) throw new InvalidOperationException("No bridge-owned recording is active");
            var s = Current;
            if (s.state == "stopping") return s;
            if (s.captureContext != null && !EnvironmentMatches(s.captureContext.environment))
            {
                InvalidateContext(s, "Scene, Game view resolution, focus, or runtime settings changed before capture stopped");
                reason = "interrupted";
            }
            if (!ProfilerSettingsMatch(s))
            {
                InvalidateContext(s, "Profiler settings or target changed before capture stopped");
                reason = "interrupted";
            }
            s.state = "stopping"; s.stopReason = reason;
            s.drainStarted = EditorApplication.timeSinceStartup;
            s.drainLast = ProfilerDriver.lastFrameIndex; s.drainStable = 0;
            if (ProfilerDriver.connectedProfiler == s.target) ProfilerDriver.enabled = false;
            Persist(s);
            return s;
        }

        internal static void RequireOwner(string token)
        {
            if (Current != null && !string.IsNullOrEmpty(Current.leaseToken) && token != Current.leaseToken)
                throw new InvalidOperationException("Only the capture's owning lease can stop or bookmark it");
        }

        static void FinalizeStop(Session s, string reason)
        {
            Current = null;
            try
            {
                if (ProfilerDriver.connectedProfiler == s.target) ProfilerDriver.enabled = false;
                if (s.captureContext != null && !EnvironmentMatches(s.captureContext.environment))
                {
                    InvalidateContext(s, "Scene, Game view resolution, focus, or runtime settings changed while capture finalized");
                    reason = "interrupted";
                }
                if (!ProfilerSettingsMatch(s))
                {
                    InvalidateContext(s, "Profiler settings or target changed while capture finalized");
                    reason = "interrupted";
                }
                if (reason != "interrupted") Checkpoint(s);
                s.state = reason;
            }
            catch (Exception e) { s.state = "failed"; s.error = e.Message; }
            finally
            {
                Restore(s);
                s.endedUtc = DateTime.UtcNow.ToString("O");
                Persist(s);
                File.Delete(ActivePath);
            }
            if (s.state == "failed") throw new IOException("Capture " + s.id + " failed: " + s.error);
        }

        static void FinishOnExit(string reason)
        {
            if (Current == null) return;
            try
            {
                Current.finalizationNote = "Editor lifecycle ended capture before waiting for delayed profiler packets.";
                FinalizeStop(Current, reason);
            }
            catch (Exception e) { UnityEngine.Debug.LogError("[KitProfiler] Capture finalization: " + e.Message); }
        }

        static void Restore(Session s)
        {
            if (s.previous == null) { s.cleanupComplete = true; return; }
            bool ownsTarget = ProfilerDriver.connectedProfiler == s.target;
            if (ownsTarget) ProfilerDriver.enabled = false;
            if (ProfilerDriver.profileEditor == s.editor) ProfilerDriver.profileEditor = s.previous.editor;
            if (ProfilerDriver.IsAreaEnabled(ProfilerArea.CPU)) ProfilerDriver.SetAreaEnabled(ProfilerArea.CPU, s.previous.cpu);
            if ((int)ProfilerDriver.memoryRecordMode == s.allocationMode)
                ProfilerDriver.memoryRecordMode = (ProfilerMemoryRecordMode)s.previous.allocationMode;
            if (ownsTarget)
            {
                ProfilerDriver.connectedProfiler = s.previous.target;
                ProfilerDriver.enabled = s.previous.recording;
            }
            s.cleanupComplete = true;
        }

        static void Checkpoint(Session s)
        {
            using (CheckpointMarker.Auto()) WriteCheckpoint(s);
        }

        static void WriteCheckpoint(Session s)
        {
            int first = ProfilerDriver.firstFrameIndex, last = ProfilerDriver.lastFrameIndex;
            if (first < 0 || last <= s.last) return;
            int from = Math.Max(first, s.last + 1);
            if (from > s.last + 1) s.gaps.Add(new Gap { first = s.last + 1, last = from - 1, reason = "Frames expired before checkpoint" });
            string dir = SessionDirectory(s.id);
            string file = "chunk-" + s.chunks.Count.ToString("D4") + ".raw";
            string path = Path.Combine(dir, file);
            var watch = Stopwatch.StartNew();
            if (!ProfilerDriver.SaveProfile(path)) throw new IOException("Unity failed to save profiler checkpoint");
            long bytes = new FileInfo(path).Length;
            int count = 0;
            using (var writer = new StreamWriter(Path.Combine(dir, "frames.jsonl"), true, Utf8))
            {
                for (int f = from; f >= 0 && f <= last;)
                {
                    using (var view = ProfilerDriver.GetRawFrameDataView(f, 0))
                    {
                        if (view.valid)
                        {
                            var gpu = ProfilerDriver.GetGpuStatisticsAvailabilityState(f);
                            bool hasGpu = (gpu & GpuProfilingStatisticsAvailabilityStates.Gathered) != 0;
                            writer.WriteLine(JsonUtility.ToJson(new FrameRow { frame = f, cpuMs = view.frameTimeMs,
                                gpuMs = hasGpu ? view.frameGpuTimeMs : 0, gpuAvailable = hasGpu, gpuAvailability = gpu.ToString() }));
                            count++;
                        }
                        else s.gaps.Add(new Gap { first = f, last = f, reason = "Frame data unavailable at checkpoint" });
                    }
                    int next = ProfilerDriver.GetNextFrameIndex(f);
                    if (next <= f) break;
                    if (next > f + 1 && f < last) s.gaps.Add(new Gap { first = f + 1, last = Math.Min(next - 1, last), reason = "Missing profiler frame indices" });
                    f = next;
                }
            }
            double ms = watch.Elapsed.TotalMilliseconds;
            s.chunks.Add(new Chunk { file = file, rawFirst = first, first = from, last = last, frameCount = count, bytes = bytes, saveMs = ms });
            s.last = last; s.bytes += bytes; s.indexedFrames += count;
            s.checkpointMs += ms; s.maxCheckpointMs = Math.Max(s.maxCheckpointMs, ms);
            Persist(s);
        }

        internal static object Save(string label)
        {
            if (Current != null) { Checkpoint(Current); return Current; }
            if (ProfilerDriver.firstFrameIndex < 0) throw new InvalidOperationException("Profiler has no retained frames to save");
            var s = NewSession(label);
            s.sourceContextKnown = false;
            s.target = -2; s.targetName = "Unknown source of existing retained history";
            s.first = ProfilerDriver.firstFrameIndex; s.last = s.first - 1;
            try { Checkpoint(s); s.state = "snapshot"; }
            catch (Exception e) { s.state = "failed"; s.error = e.Message; throw; }
            finally { s.endedUtc = DateTime.UtcNow.ToString("O"); Persist(s); }
            return s;
        }

        internal static object Mark(KitProfiler.Request r)
        {
            if (Current == null) throw new InvalidOperationException("A bookmark needs an active bridge capture");
            if (string.IsNullOrWhiteSpace(r.label)) throw new ArgumentException("A bookmark label is required");
            var mark = new Bookmark { label = r.label, utc = DateTime.UtcNow.ToString("O"), profilerFrame = ProfilerDriver.lastFrameIndex,
                localUnityFrame = Time.frameCount, tick = r.tick, tickSupplied = r.tick >= 0, contextJson = r.contextJson ?? "{}" };
            Current.bookmarks.Add(mark); Persist(Current); return mark;
        }

        internal static object Sessions(KitProfiler.Request r)
        {
            if (!Directory.Exists(Root)) return new SessionList { sessions = Array.Empty<Session>() };
            var all = Directory.GetDirectories(Root).Where(p => File.Exists(Path.Combine(p, "session.json")))
                .Select(p => ReadSession(Path.GetFileName(p))).OrderByDescending(s => s.startedUtc).ToArray();
            return new SessionList { total = all.Length, truncated = r.offset + r.limit < all.Length, sessions = all.Skip(r.offset).Take(r.limit).ToArray() };
        }

        internal static object Frames(KitProfiler.Request r)
        {
            var s = ReadSession(r.session);
            string path = Path.Combine(SessionDirectory(s.id), "frames.jsonl");
            var rows = new List<FrameRow>();
            int matched = 0;
            if (File.Exists(path)) foreach (string line in File.ReadLines(path))
            {
                var row = JsonUtility.FromJson<FrameRow>(line);
                if (row.frame < (r.first < 0 ? s.first : r.first) || row.frame > (r.last < 0 ? s.last : r.last) || row.cpuMs < r.minMs) continue;
                if (matched >= r.offset && rows.Count < r.limit) rows.Add(row);
                matched++;
            }
            return new FrameList { session = s.id, state = s.state, firstFrame = s.first, lastFrame = s.last, matched = matched,
                offset = r.offset, limit = r.limit, truncated = r.offset + r.limit < matched, frames = rows.ToArray(), gaps = s.gaps.ToArray(),
                captureContext = s.captureContext, bookmarks = s.bookmarks.ToArray() };
        }

        static void Persist(Session s)
        {
            WriteJson(Path.Combine(SessionDirectory(s.id), "session.json"), s);
            if (s == Current) WriteJson(ActivePath, s);
            if (s.previous != null) WriteOwnership(s, !s.cleanupComplete);
        }

        static void WriteOwnership(Session s, bool active)
        {
            if (AssetDatabase.IsAssetImportWorkerProcess()) return;
            WriteJson(OwnershipPath, new Ownership {
                id = s.id, state = s.state, leaseToken = s.leaseToken, editorSession = s.editorSession, active = active
            });
        }

        internal static void WriteJson(string path, object value) => KitFiles.WriteJson(path, value, true);
    }
}
