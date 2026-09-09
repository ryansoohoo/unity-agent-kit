using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditorInternal;
using UnityEngine;
using UnityEngine.Profiling;

namespace UnityAgentKit.Doctor
{
    // Agent entry point: kit profiler <action>. All Unity profiler access stays on
    // the Editor thread; the existing invoke channel carries one JSON request.
    [InitializeOnLoad]
    public static class KitProfiler
    {
        [Serializable]
        public sealed class Request
        {
            public string action, session, path, label, filter, contextJson, leaseToken;
            public int target = -2, first = -1, last = -1, frame = -1, thread = -1, sample = -1;
            public long deadlineMs;
            public long tick = -1;
            public int checkpointFrames = 300, offset, limit = 100;
            public double seconds = 60, maxMb = 512;
            public float minMs;
            public bool allocations, editor;
        }

        [Serializable] sealed class Failure { public bool ok; public string error; }
        [Serializable] sealed class Target { public int id; public string name; public bool connected; }
        [Serializable] sealed class TargetsResult { public Target[] targets; }
        [Serializable] sealed class StatusResult
        {
            public int schema = 1, target, firstFrame, lastFrame;
            public string unityVersion, editorSession, targetName, allocationMode, loadedPath, lastCaptureError;
            public bool recording, profileEditor, deepProfiling, cpuEnabled, gpuEnabled, captureActive;
            public KitProfilerCapture.Session capture;
            public string[] limitations;
        }
        [Serializable] sealed class LoadResult
        {
            public string path, session;
            public int firstFrame, lastFrame, originalFirstFrame, frameOffset, inspectFrame, ownedFirstFrame, ownedLastFrame;
            public bool historyBackedUp;
        }
        [Serializable] sealed class UnloadResult { public bool restored; public int firstFrame, lastFrame; }
        [Serializable] sealed class LoadLease { public string backup, loaded; public bool hadFrames; }

        static readonly string LeasePath = Path.Combine(KitProfilerCapture.Root, "loaded.json");
        static LoadLease lease;

        static KitProfiler()
        {
            if (AssetDatabase.IsAssetImportWorkerProcess()) return;
            if (File.Exists(LeasePath))
            {
                try { lease = JsonUtility.FromJson<LoadLease>(File.ReadAllText(LeasePath)); }
                catch (Exception e) { UnityEngine.Debug.LogWarning("[KitProfiler] Cannot read history backup: " + e.Message); }
            }
            KitProfilerCapture.Install();
        }

        public static string Execute(string json) => ExecuteWithLease(json, null);

        // The transport supplies the lease separately so payload data cannot replace its owner.
        internal static string ExecuteWithLease(string json, string leaseToken)
        {
            var watch = Stopwatch.StartNew();
            try
            {
                if (AssetDatabase.IsAssetImportWorkerProcess()) throw new InvalidOperationException("Profiler commands require the main Editor process");
                var r = new Request();
                JsonUtility.FromJsonOverwrite(json, r);
                if (leaseToken != null) r.leaseToken = leaseToken;
                Validate(r);
                if (!new[] { "status", "targets", "sessions", "frames", "threads", "frame", "sample" }.Contains(r.action))
                {
                    string leaseError = KitActions.ValidateLease(r.leaseToken);
                    if (leaseError != null) throw new InvalidOperationException(leaseError);
                    if (r.action == "stop" || r.action == "cancel" || r.action == "mark") KitProfilerCapture.RequireOwner(r.leaseToken);
                }
                object result;
                switch (r.action)
                {
                    case "status": result = Status(); break;
                    case "targets": result = Targets(); break;
                    case "sessions": result = KitProfilerCapture.Sessions(r); break;
                    case "start":
                        if (lease != null) throw new InvalidOperationException("Unload the historical capture before starting a recording.");
                        result = KitProfilerCapture.Start(r); break;
                    case "stop": result = KitProfilerCapture.Stop("complete"); break;
                    case "cancel": result = KitProfilerCapture.Stop("cancelled"); break;
                    case "save":
                        if (lease != null) throw new InvalidOperationException("This history is loaded from an existing capture. Use its original archive; unload before saving live history.");
                        result = KitProfilerCapture.Save(r.label); break;
                    case "mark": result = KitProfilerCapture.Mark(r); break;
                    case "load": result = Load(r); break;
                    case "unload": result = Unload(); break;
                    case "frames" when !string.IsNullOrEmpty(r.session): result = KitProfilerCapture.Frames(r); break;
                    case "frames": result = KitProfilerReader.Frames(r); break;
                    case "threads": RequireLoaded(r); result = KitProfilerReader.Threads(r); break;
                    case "frame": RequireLoaded(r); result = KitProfilerReader.Frame(r); break;
                    case "sample": RequireLoaded(r); result = KitProfilerReader.Sample(r); break;
                    case "analyze": result = string.IsNullOrEmpty(r.session) ? KitProfilerReader.Analyze(r) : AnalyzeSession(r); break;
                    default: throw new ArgumentException("Unknown profiler action: " + r.action);
                }
                return "{\"ok\":true,\"queryMs\":" + watch.Elapsed.TotalMilliseconds.ToString("R", CultureInfo.InvariantCulture)
                    + ",\"data\":" + JsonUtility.ToJson(result) + "}";
            }
            catch (Exception e)
            {
                return JsonUtility.ToJson(new Failure { ok = false, error = e.GetType().Name + ": " + e.Message });
            }
        }

        static void Validate(Request r)
        {
            if (string.IsNullOrEmpty(r.action)) throw new ArgumentException("action is required");
            if (r.deadlineMs > 0 && DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() > r.deadlineMs) throw new InvalidOperationException("Profiler request expired before execution");
            if (r.limit < 1 || r.limit > 1000 || r.offset < 0) throw new ArgumentException("limit must be 1..1000; offset must be nonnegative");
            if (r.first < -1 || r.last < -1 || r.frame < -1 || r.thread < -1 || r.sample < -1 || r.target < -2)
                throw new ArgumentException("indices must be -1 or nonnegative");
            if (r.first >= 0 && r.last >= 0 && r.first > r.last) throw new ArgumentException("first exceeds last");
            if (double.IsNaN(r.seconds) || double.IsInfinity(r.seconds) || r.seconds < 1 || r.seconds > 3600)
                throw new ArgumentException("seconds must be 1..3600");
            if (double.IsNaN(r.maxMb) || double.IsInfinity(r.maxMb) || r.maxMb < 16 || r.maxMb > 16384)
                throw new ArgumentException("maxMb must be 16..16384");
            if (r.checkpointFrames < 30 || r.checkpointFrames > 1000) throw new ArgumentException("checkpointFrames must be 30..1000");
            if (float.IsNaN(r.minMs) || float.IsInfinity(r.minMs) || r.minMs < 0) throw new ArgumentException("minMs must be finite and nonnegative");
            if (r.tick < -1 || r.tick > 9007199254740991L) throw new ArgumentException("tick must be a nonnegative JSON-safe integer");
            if (r.contextJson != null && System.Text.Encoding.UTF8.GetByteCount(r.contextJson) > 65536)
                throw new ArgumentException("contextJson must not exceed 64 KiB");
        }

        static object Status()
        {
            int target = ProfilerDriver.connectedProfiler;
            return new StatusResult {
                unityVersion = Application.unityVersion, editorSession = SessionState.GetString("uak.sessionId", ""),
                target = target, targetName = ProfilerDriver.GetConnectionIdentifier(target),
                firstFrame = ProfilerDriver.firstFrameIndex, lastFrame = ProfilerDriver.lastFrameIndex,
                recording = ProfilerDriver.enabled, profileEditor = ProfilerDriver.profileEditor,
                deepProfiling = ProfilerDriver.deepProfiling, allocationMode = ProfilerDriver.memoryRecordMode.ToString(),
                cpuEnabled = ProfilerDriver.IsAreaEnabled(ProfilerArea.CPU), gpuEnabled = ProfilerDriver.profileGPU,
                loadedPath = lease?.loaded, capture = KitProfilerCapture.Current, captureActive = KitProfilerCapture.Current != null,
                lastCaptureError = KitProfilerCapture.LastError,
                limitations = new[] {
                    "CPU methods and loops require recorded markers or Deep Profile instrumentation.",
                    "Call stacks and GPU samples are returned only when captured and supported.",
                    "Archives checkpoint the native rolling history. Gaps and checkpoint costs are recorded. maxMb is a stop threshold and may overshoot by one native checkpoint.",
                    "Loading an archive requires recording to be stopped. Indexed archived frames remain searchable during recording.",
                    "Memory object snapshots and hardware GPU analysis are separate integrations." }
            };
        }

        static object Targets() => new TargetsResult { targets = ProfilerDriver.GetAvailableProfilers()
            .Select(id => new Target { id = id, name = ProfilerDriver.GetConnectionIdentifier(id), connected = id == ProfilerDriver.connectedProfiler }).ToArray() };

        static void RequireLoaded(Request r)
        {
            if (!string.IsNullOrEmpty(r.session))
                throw new ArgumentException("Use load --session ID --frame ORIGINAL_FRAME, then inspect the returned inspectFrame. frames --session works directly on the archive index.");
        }

        static object AnalyzeSession(Request r)
        {
            if (lease != null) throw new InvalidOperationException("Unload the current historical view before analyzing a whole archive");
            if (ProfilerDriver.enabled || KitProfilerCapture.Current != null) throw new InvalidOperationException("Stop recording before archive analysis. Indexed frames remain readable during recording.");
            var s = KitProfilerCapture.ReadSession(r.session);
            int first = r.first < 0 ? s.first : r.first, last = r.last < 0 ? s.last : r.last;
            if (first < s.first || last > s.last || first > last) throw new ArgumentException("Requested range is outside the archived session");
            var times = new List<double>();
            var map = new Dictionary<string, KitProfilerReader.MarkerDto>(StringComparer.Ordinal);
            var watch = Stopwatch.StartNew();
            try
            {
                foreach (var chunk in s.chunks.Where(c => c.last >= first && c.first <= last))
                {
                    if (watch.Elapsed.TotalSeconds > 8) throw new InvalidOperationException("Archive analysis exceeded its 8-second budget. Use a narrower --first/--last range.");
                    int from = Math.Max(first, chunk.first), to = Math.Min(last, chunk.last);
                    var loaded = (LoadResult)Load(new Request { session = s.id, frame = from });
                    var part = (KitProfilerReader.AnalyzeResult)KitProfilerReader.Analyze(new Request {
                        first = from - loaded.frameOffset, last = to - loaded.frameOffset,
                        thread = r.thread, filter = r.filter, minMs = r.minMs, limit = int.MaxValue });
                    times.AddRange(part.frameTimes);
                    foreach (var marker in part.markers)
                    {
                        string key = marker.threadGroup.Length + ":" + marker.threadGroup + marker.thread.Length + ":" + marker.thread + marker.path;
                        if (!map.TryGetValue(key, out var sum)) { map.Add(key, marker); continue; }
                        sum.totalMs += marker.totalMs; sum.selfMs += marker.selfMs; sum.calls += marker.calls; sum.gcBytes += marker.gcBytes;
                        sum.frames += marker.frames; sum.childOverlapMs += marker.childOverlapMs;
                        sum.maxMs = Math.Max(sum.maxMs, marker.maxMs); sum.maxFrameMs = Math.Max(sum.maxFrameMs, marker.maxFrameMs);
                    }
                }
            }
            finally { if (lease != null) Unload(); }
            var ordered = map.Values.OrderByDescending(m => m.selfMs).ThenBy(m => m.path, StringComparer.Ordinal).ToArray();
            return new KitProfilerReader.AnalyzeResult { firstFrame = first, lastFrame = last, frameCount = times.Count,
                frameStats = KitProfilerReader.Stats(times, r.minMs > 0 ? r.minMs : 16.667),
                sourceSession = s.id, archiveGaps = s.gaps.ToArray(), unityVersion = s.unityVersion,
                captureContext = s.captureContext, bookmarks = s.bookmarks.ToArray(),
                filter = r.filter, threadFilter = r.thread, offset = r.offset, limit = r.limit, markerTotal = ordered.Length,
                markersTruncated = r.offset > 0 || ordered.Length > r.limit, markers = ordered.Skip(r.offset).Take(r.limit).ToArray() };
        }

        static object Load(Request r)
        {
            if (ProfilerDriver.enabled || KitProfilerCapture.Current != null)
                throw new InvalidOperationException("Stop recording before loading history. Loading would replace Unity's live frame buffer.");
            string path = r.path;
            int originalFirst = -1, ownedFirst = -1, ownedLast = -1;
            if (!string.IsNullOrEmpty(r.session))
            {
                var s = KitProfilerCapture.ReadSession(r.session);
                var chunks = s.chunks.Where(c => r.frame < 0 || (c.first <= r.frame && r.frame <= c.last)).ToArray();
                if (chunks.Length == 0) throw new ArgumentException("No archived chunk contains that frame; inspect the session's gaps.");
                var chunk = chunks[chunks.Length - 1];
                path = Path.Combine(KitProfilerCapture.SessionDirectory(s.id), chunk.file);
                originalFirst = chunk.rawFirst;
                ownedFirst = chunk.first; ownedLast = chunk.last;
            }
            if (string.IsNullOrEmpty(path)) throw new ArgumentException("load requires path or session");
            path = Path.GetFullPath(path);
            if (!File.Exists(path)) throw new FileNotFoundException("Capture does not exist", path);
            if (lease == null)
            {
                Directory.CreateDirectory(KitProfilerCapture.Root);
                var next = new LoadLease { backup = Path.Combine(KitProfilerCapture.Root, "restore-" + Guid.NewGuid().ToString("N") + ".raw"),
                    hadFrames = ProfilerDriver.firstFrameIndex >= 0 };
                if (next.hadFrames && !ProfilerDriver.SaveProfile(next.backup)) throw new IOException("Could not back up the existing Profiler history");
                lease = next;
                KitProfilerCapture.WriteJson(LeasePath, lease);
            }
            try
            {
                if (!ProfilerDriver.LoadProfile(path, false)) throw new IOException("Unity rejected the profiler capture");
                lease.loaded = path;
                KitProfilerCapture.WriteJson(LeasePath, lease);
            }
            catch
            {
                Unload();
                throw;
            }
            int loadedFirst = ProfilerDriver.firstFrameIndex;
            int offset = originalFirst < 0 ? 0 : originalFirst - loadedFirst;
            return new LoadResult { path = path, session = r.session, firstFrame = loadedFirst, lastFrame = ProfilerDriver.lastFrameIndex,
                originalFirstFrame = originalFirst, frameOffset = offset,
                inspectFrame = r.frame < 0 ? (ownedFirst < 0 ? loadedFirst : ownedFirst - offset) : r.frame - offset,
                ownedFirstFrame = ownedFirst < 0 ? loadedFirst : ownedFirst - offset,
                ownedLastFrame = ownedLast < 0 ? ProfilerDriver.lastFrameIndex : ownedLast - offset, historyBackedUp = true };
        }

        static object Unload()
        {
            if (ProfilerDriver.enabled || KitProfilerCapture.Current != null) throw new InvalidOperationException("Stop recording before restoring history");
            if (lease == null) return new UnloadResult { restored = false, firstFrame = ProfilerDriver.firstFrameIndex, lastFrame = ProfilerDriver.lastFrameIndex };
            if (lease.hadFrames)
            {
                if (!File.Exists(lease.backup) || !ProfilerDriver.LoadProfile(lease.backup, false))
                    throw new IOException("History backup could not be restored; retained at " + lease.backup);
            }
            else ProfilerDriver.ClearAllFrames();
            string backup = lease.backup;
            lease = null;
            File.Delete(LeasePath);
            if (File.Exists(backup)) File.Delete(backup);
            return new UnloadResult { restored = true, firstFrame = ProfilerDriver.firstFrameIndex, lastFrame = ProfilerDriver.lastFrameIndex };
        }
    }
}
