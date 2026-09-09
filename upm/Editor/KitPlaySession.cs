using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using UnityEditor;
using UnityEditor.Compilation;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAgentKit.Doctor
{
    // Owns one bounded Play run. Project callbacks own their input and assertions;
    // this service restores its scene setup, timeScale and background setting, never saves scenes.
    // Deadlines run on editor updates. A synchronous callback must return control;
    // Unity cannot preempt arbitrary project C# on its main thread.
    [InitializeOnLoad]
    internal static class KitPlaySession
    {
        const string Key = "uak.playSession";
        const int BackgroundPulseIntervalMs = 100;
        static readonly string Project = Path.GetFullPath(Path.GetDirectoryName(Application.dataPath));
        static readonly string Root = Path.Combine(Project, "Temp", "unity-agent-kit");
        static readonly string SnapshotPath = Path.Combine(Root, "play-session.json");
        static Session current;
        static long nextPersist;
        static double nextBackgroundPulse;
        static readonly Dictionary<string, MethodInfo> Methods = new Dictionary<string, MethodInfo>();

        [Serializable] sealed class Request
        {
            public string action, id, scene, setupMethod, stepMethod, checkMethod, teardownMethod;
            public string screenshotPath, owner, leaseToken;
            public double durationSeconds = 10, warmupSeconds = 0.5;
        }
        [Serializable] sealed class Lease { public string token; public long expiresMs; }
        [Serializable] sealed class CallbackValue { public string method, type, value; }
        [Serializable] sealed class Session
        {
            public int schema = 1;
            public int pid;
            public string editorSession, projectPath;
            public string id, state, owner, leaseToken, scene, error, stopReason, artifact, screenshotPath;
            public string startedUtc, endedUtc, cleanup, cleanupError, terminalState;
            public long startedMs, phaseStartedMs, deadlineMs, stoppingMs, captureStartedMs;
            public double durationSeconds, warmupSeconds, elapsedSeconds;
            public int frame, lastUnityFrame = -1, width, height, screenshotWidth, screenshotHeight;
            public int unfocusedFrames, backgroundPumpCount, backgroundPumpIntervalMs;
            public bool priorPlaying, switchedScene, setupAttempted, teardownAttempted, checkRan, checkPassed;
            public bool finishing, screenshotComplete;
            public bool backgroundOwned, priorRunInBackground, runInBackground, editorFocused;
            public string backgroundPumpMode;
            public float priorTimeScale;
            public SceneSetup[] priorScenes;
            public string setupMethod, stepMethod, checkMethod, teardownMethod;
            public CallbackValue setupValue, stepValue, checkValue, teardownValue;
        }
        [Serializable] sealed class Failure { public bool ok; public string error; }

        static KitPlaySession()
        {
            if (AssetDatabase.IsAssetImportWorkerProcess()) return;
            try
            {
                string saved = SessionState.GetString(Key, "");
                if (saved.Length > 0) current = JsonUtility.FromJson<Session>(saved);
                else if (File.Exists(SnapshotPath))
                {
                    current = JsonUtility.FromJson<Session>(ReadShared(SnapshotPath));
                    if (Active)
                    {
                        current.state = "failed"; current.cleanup = "interrupted";
                        current.error = "Editor session ended without completing Play cleanup; its callbacks and unsaved state cannot be recovered.";
                        current.endedUtc = DateTime.UtcNow.ToString("O");
                        Persist(); WriteJson(current.artifact, JsonUtility.ToJson(current, true));
                    }
                }
                if (Active && current.state != "entering" && current.state != "stopping")
                {
                    current.error = "Domain reload interrupted the Play session.";
                    current.state = "stopping"; current.terminalState = "failed";
                    current.stoppingMs = Now;
                }
            }
            catch (Exception e) { Debug.LogError("[KitPlaySession] Recovery failed: " + e.Message); }
            EditorApplication.update += Tick;
            EditorApplication.playModeStateChanged += OnPlayState;
            AssemblyReloadEvents.beforeAssemblyReload += BeforeReload;
            EditorApplication.quitting += OnQuit;
        }

        static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        static bool Active => current != null && !Terminal(current.state);
        static bool Terminal(string state) => state == "completed" || state == "failed" || state == "cancelled";
        internal static string BackgroundPumpMode => Active && current.state != "stopping"
            ? current.backgroundPumpMode ?? "none" : "none";

        internal static string Handle(string payloadJson) => Handle(payloadJson, null);

        // The request envelope's authenticated token takes precedence over payload data.
        internal static string Handle(string payloadJson, string leaseToken)
        {
            try
            {
                var r = JsonUtility.FromJson<Request>(payloadJson ?? "{}") ?? new Request();
                if (leaseToken != null) r.leaseToken = leaseToken;
                switch (r.action ?? "status")
                {
                    case "start": Start(r); break;
                    case "status":
                        if (!string.IsNullOrEmpty(r.id) && (current == null || current.id != r.id))
                            return ReadShared(ArtifactPath(r.id));
                        break;
                    case "stop":
                    case "cancel":
                        RequireCurrent(r);
                        if (!Active) break;
                        if (r.action == "cancel") BeginStop("cancelled", "cancelled by owner");
                        else if (current.state == "running")
                        {
                            try { FinishRun(); }
                            catch (Exception e) { BeginStop("failed", Error(e)); }
                        }
                        else BeginStop("cancelled", "stopped before verification began");
                        break;
                    default: throw new ArgumentException("Unknown Play session action: " + r.action);
                }
                return current == null ? "{\"state\":\"idle\"}" : JsonUtility.ToJson(current);
            }
            catch (Exception e) { return JsonUtility.ToJson(new Failure { ok = false, error = Error(e) }); }
        }

        static void RequireCurrent(Request r)
        {
            if (current == null || string.IsNullOrEmpty(r.id) || r.id != current.id)
                throw new InvalidOperationException("Supply the current Play session id.");
            if (string.IsNullOrEmpty(r.leaseToken) || r.leaseToken != current.leaseToken)
                throw new InvalidOperationException("Only the owning lease can stop this Play session.");
        }

        static void Start(Request r)
        {
            if (Active) throw new InvalidOperationException("A Play session is already active: " + current.id);
            if (Application.isBatchMode && !string.IsNullOrEmpty(r.screenshotPath))
                throw new InvalidOperationException("Game view screenshots require a graphical Editor; omit screenshotPath in batch mode.");
            if (EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Start requires edit mode; an existing Play session is never interrupted.");
            if (EditorApplication.isCompiling || EditorApplication.isUpdating)
                throw new InvalidOperationException("Wait for the editor to finish compiling and importing before starting.");
            CheckLease(r.leaseToken);
            if (double.IsNaN(r.durationSeconds) || r.durationSeconds <= 0 || r.durationSeconds > 600
                || double.IsNaN(r.warmupSeconds) || r.warmupSeconds < 0 || r.warmupSeconds > 60)
                throw new ArgumentException("durationSeconds must be 0 < seconds <= 600; warmupSeconds must be 0..60.");
            foreach (var method in new[] { r.setupMethod, r.checkMethod, r.teardownMethod }) Resolve(method, false);
            Resolve(r.stepMethod, true);
            for (int i = 0; i < SceneManager.sceneCount; i++)
                if (SceneManager.GetSceneAt(i).isDirty)
                    throw new InvalidOperationException("Loaded scenes have unsaved changes; use a saved fixture after preserving those changes.");
            string scene = r.scene;
            bool switching = !string.IsNullOrEmpty(scene) && scene != SceneManager.GetActiveScene().path;
            if (!string.IsNullOrEmpty(scene))
            {
                scene = scene.Replace('\\', '/');
                string full = Path.GetFullPath(Path.Combine(Project, scene));
                if (!scene.StartsWith("Assets/", StringComparison.Ordinal) || !Under(full, Application.dataPath)
                    || !scene.EndsWith(".unity", StringComparison.OrdinalIgnoreCase) || !File.Exists(full))
                    throw new ArgumentException("scene must name an existing project scene under Assets/.");
                if (switching && EditorSceneManager.GetSceneManagerSetup().Any(s => string.IsNullOrEmpty(s.path)))
                    throw new InvalidOperationException("Save the untitled scene before switching to a fixture.");
            }
            string id = string.IsNullOrEmpty(r.id) ? Guid.NewGuid().ToString("N") : r.id;
            string artifact = ArtifactPath(id);
            if (File.Exists(artifact)) throw new InvalidOperationException("Play session id already has a result: " + id);
            string screenshot = "";
            if (!string.IsNullOrEmpty(r.screenshotPath))
            {
                screenshot = Path.GetFullPath(Path.Combine(Project, r.screenshotPath));
                if (Under(screenshot, Application.dataPath) || !screenshot.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
                    throw new ArgumentException("screenshotPath must be a .png outside Assets/.");
                if (File.Exists(screenshot)) throw new IOException("Screenshot path already exists; use a new path.");
            }
            current = new Session {
                id = id, state = "queued", owner = r.owner ?? "", leaseToken = r.leaseToken,
                pid = System.Diagnostics.Process.GetCurrentProcess().Id, projectPath = Project,
                editorSession = SessionState.GetString("uak.sessionId", ""),
                scene = string.IsNullOrEmpty(scene) ? SceneManager.GetActiveScene().path : scene, durationSeconds = r.durationSeconds,
                warmupSeconds = r.warmupSeconds, setupMethod = r.setupMethod, stepMethod = r.stepMethod,
                checkMethod = r.checkMethod, teardownMethod = r.teardownMethod, artifact = artifact,
                screenshotPath = screenshot, priorScenes = EditorSceneManager.GetSceneManagerSetup(),
                priorTimeScale = Time.timeScale, priorPlaying = false, switchedScene = switching,
                backgroundOwned = true, priorRunInBackground = Application.runInBackground,
                backgroundPumpMode = Application.isBatchMode ? "none" : "unfocused-10Hz",
                backgroundPumpIntervalMs = Application.isBatchMode ? 0 : BackgroundPulseIntervalMs,
                startedMs = Now, startedUtc = DateTime.UtcNow.ToString("O"), cleanup = "pending"
            };
            current.deadlineMs = Now + (long)((r.durationSeconds + r.warmupSeconds + 30) * 1000);
            try { Persist(); }
            catch { current = null; SessionState.EraseString(Key); throw; }
        }

        static void Tick()
        {
            if (!Active) return;
            try
            {
                var s = current;
                s.elapsedSeconds = (Now - s.startedMs) / 1000d;
                s.width = Screen.width; s.height = Screen.height;
                if (s.state == "stopping") { Cleanup(); return; }
                CheckLease(s.leaseToken);
                if (Now > s.deadlineMs) { BeginStop("failed", "Play session deadline exceeded"); return; }
                KeepRunningInBackground();
                if (s.state == "queued")
                {
                    if (s.switchedScene) EditorSceneManager.OpenScene(s.scene, OpenSceneMode.Single);
                    s.state = "entering"; s.phaseStartedMs = Now; Persist();
                    EditorApplication.isPlaying = true;
                    return;
                }
                if (s.state == "entering")
                {
                    if (EditorApplication.isPlaying && !EditorApplication.isCompiling) EnteredPlay();
                    return;
                }
                if (!EditorApplication.isPlaying) { BeginStop("failed", "Play mode ended before the session finished"); return; }
                if (s.finishing)
                {
                    if (ReadScreenshot()) BeginStop("completed", "verification finished");
                    else if (Now - s.captureStartedMs > 5000) BeginStop("failed", "Game view screenshot did not finish within 5 seconds");
                    return;
                }
                if (s.state == "warmup")
                {
                    if ((Now - s.phaseStartedMs) / 1000d >= s.warmupSeconds)
                    { s.state = "running"; s.phaseStartedMs = Now; Persist(); }
                    return;
                }
                if (Time.frameCount != s.lastUnityFrame)
                {
                    s.lastUnityFrame = Time.frameCount;
                    s.stepValue = Call(s.stepMethod, true, s.frame);
                    s.frame++;
                    if (!EditorApplication.isFocused) s.unfocusedFrames++;
                }
                if ((Now - s.phaseStartedMs) / 1000d >= s.durationSeconds) FinishRun();
                else if (Now >= nextPersist) Persist();
            }
            catch (Exception e) { BeginStop("failed", Error(e)); }
        }

        static void EnteredPlay()
        {
            if (!Active || current.state != "entering") return;
            if (current.backgroundOwned) Application.runInBackground = true;
            current.state = "warmup"; current.phaseStartedMs = Now;
            current.setupAttempted = true; Persist();
            current.setupValue = Call(current.setupMethod, false, 0);
            current.phaseStartedMs = Now;
            Persist();
        }

        static void FinishRun()
        {
            if (current.finishing) return;
            current.checkValue = Call(current.checkMethod, false, 0);
            current.checkRan = !string.IsNullOrEmpty(current.checkMethod);
            current.checkPassed = !current.checkRan || current.checkValue.type != "Boolean" || current.checkValue.value == "True";
            if (!current.checkPassed) { BeginStop("failed", "Check callback returned false"); return; }
            if (string.IsNullOrEmpty(current.screenshotPath)) { BeginStop("completed", "verification finished"); return; }
            Directory.CreateDirectory(Path.GetDirectoryName(current.screenshotPath));
            current.finishing = true; current.captureStartedMs = Now; Persist();
            ScreenCapture.CaptureScreenshot(current.screenshotPath);
        }

        static void BeginStop(string terminal, string reason)
        {
            if (!Active) return;
            if (terminal == "failed") current.error = reason;
            if (current.state != "stopping")
            {
                current.terminalState = terminal; current.stopReason = reason;
                current.state = "stopping"; current.stoppingMs = Now;
            }
            else if (terminal == "failed") current.terminalState = "failed";
            Teardown();
            Time.timeScale = current.priorTimeScale;
            Persist();
        }

        static void Teardown()
        {
            if (!current.setupAttempted || current.teardownAttempted) return;
            current.teardownAttempted = true;
            Persist();
            try { current.teardownValue = Call(current.teardownMethod, false, 0); }
            catch (Exception e) { current.cleanupError = Error(e); current.terminalState = "failed"; }
        }

        static void Cleanup()
        {
            // Reload and Play-state callbacks can run before Unity finishes its transition.
            // Only an editor update may request exit or restore the saved scene setup.
            if (EditorApplication.isCompiling || EditorApplication.isUpdating) return;
            if (Application.isPlaying || EditorApplication.isPlaying || EditorApplication.isPlayingOrWillChangePlaymode)
            {
                EditorApplication.isPlaying = false;
                // Remain visibly stopping and retain ownership if the editor cannot exit.
                if (Now - current.stoppingMs > 15000)
                { current.cleanupError = "Editor has not exited Play within 15 seconds; cleanup is still pending."; Persist(); }
                return;
            }
            try
            {
                Time.timeScale = current.priorTimeScale;
                if (current.backgroundOwned) Application.runInBackground = current.priorRunInBackground;
                if (current.switchedScene) EditorSceneManager.RestoreSceneManagerSetup(current.priorScenes);
                current.cleanup = string.IsNullOrEmpty(current.cleanupError) ? "restored" : "restored-with-errors";
            }
            catch (Exception e) { current.cleanup = "failed"; current.cleanupError = Error(e); current.terminalState = "failed"; }
            current.state = current.terminalState ?? "failed";
            current.endedUtc = DateTime.UtcNow.ToString("O");
            Persist();
            WriteJson(current.artifact, JsonUtility.ToJson(current, true));
        }

        static void OnPlayState(PlayModeStateChange state)
        {
            if (!Active) return;
            try
            {
                if (state == PlayModeStateChange.EnteredPlayMode) EnteredPlay();
                else if (state == PlayModeStateChange.ExitingPlayMode && current.state != "stopping")
                    BeginStop("failed", "Play mode was stopped outside this session");
            }
            catch (Exception e) { BeginStop("failed", Error(e)); }
        }

        static void BeforeReload()
        {
            if (!Active) return;
            if (current.state != "entering" && current.state != "stopping")
                BeginStop("failed", "Domain reload interrupted the Play session");
            Persist();
        }

        static void OnQuit()
        {
            if (!Active) return;
            Teardown(); Time.timeScale = current.priorTimeScale;
            if (current.backgroundOwned) Application.runInBackground = current.priorRunInBackground;
            current.state = "failed"; current.error = "Editor quit before Play session cleanup completed.";
            current.cleanup = "interrupted"; current.endedUtc = DateTime.UtcNow.ToString("O");
            Persist(); WriteJson(current.artifact, JsonUtility.ToJson(current, true));
        }

        // Keep this owned run progressing without focusing or opening an editor window.
        // Screenshot repaints happen after the check, outside its measured run.
        static void KeepRunningInBackground()
        {
            if (!current.backgroundOwned) return;
            if (!Application.runInBackground) Application.runInBackground = true;
            if (Application.isBatchMode || EditorApplication.isFocused || EditorApplication.isCompiling
                || EditorApplication.isUpdating || EditorApplication.timeSinceStartup < nextBackgroundPulse) return;
            nextBackgroundPulse = EditorApplication.timeSinceStartup + BackgroundPulseIntervalMs / 1000d;
            EditorApplication.QueuePlayerLoopUpdate();
            current.backgroundPumpCount++;
            if (current.finishing)
                foreach (var window in Resources.FindObjectsOfTypeAll<EditorWindow>())
                    if (window.GetType().FullName == "UnityEditor.GameView") window.Repaint();
        }

        static void CheckLease(string token)
        {
            if (string.IsNullOrEmpty(token)) throw new InvalidOperationException("Play session requires a live lease token.");
            string error = KitActions.ValidateLease(token);
            if (error != null) throw new InvalidOperationException(error);
            var lease = JsonUtility.FromJson<Lease>(ReadShared(Path.Combine(Root, "lease.json")));
            if (lease == null || lease.token != token || lease.expiresMs <= Now)
                throw new InvalidOperationException("Play session lease is missing, expired or no longer owned.");
        }

        static MethodInfo Resolve(string name, bool step)
        {
            if (string.IsNullOrEmpty(name)) return null;
            string key = (step ? "step:" : "call:") + name;
            if (Methods.TryGetValue(key, out var cached)) return cached;
            int dot = name.LastIndexOf('.');
            if (dot <= 0) throw new ArgumentException("Callback must be Namespace.Type.Method: " + name);
            string typeName = name.Substring(0, dot), methodName = name.Substring(dot + 1);
            var type = AppDomain.CurrentDomain.GetAssemblies().Select(a => a.GetType(typeName)).FirstOrDefault(t => t != null);
            if (type == null) throw new ArgumentException("Callback type is not loaded: " + typeName);
            var assembly = CompilationPipeline.GetAssemblies(AssembliesType.Editor).FirstOrDefault(a => a.name == type.Assembly.GetName().Name);
            if (assembly == null || !assembly.sourceFiles.Any(p => Under(Path.Combine(Project, p), Application.dataPath)))
                throw new ArgumentException("Callback must belong to project code under Assets/: " + name);
            var matches = type.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static)
                .Where(m => m.Name == methodName && !m.ContainsGenericParameters && ValidSignature(m, step)).ToArray();
            if (matches.Length != 1) throw new ArgumentException("Callback requires one unambiguous static signature: " + name
                + (step ? " must be void Step(int frame)." : " must take no arguments and return void, bool or string."));
            Methods.Add(key, matches[0]);
            return matches[0];
        }

        static bool ValidSignature(MethodInfo m, bool step)
        {
            var p = m.GetParameters();
            return step ? p.Length == 1 && p[0].ParameterType == typeof(int) && m.ReturnType == typeof(void)
                : p.Length == 0 && (m.ReturnType == typeof(void) || m.ReturnType == typeof(bool) || m.ReturnType == typeof(string));
        }

        static CallbackValue Call(string name, bool step, int frame)
        {
            var method = Resolve(name, step);
            if (method == null) return null;
            object value = method.Invoke(null, step ? new object[] { frame } : null);
            return new CallbackValue { method = name, type = method.ReturnType.Name,
                value = value == null ? "" : Convert.ToString(value, CultureInfo.InvariantCulture) };
        }

        static bool ReadScreenshot()
        {
            if (!File.Exists(current.screenshotPath)) return false;
            try
            {
                using (var file = File.Open(current.screenshotPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                {
                    if (file.Length < 33) return false;
                    var header = new byte[24]; if (file.Read(header, 0, header.Length) != header.Length) return false;
                    if (!header.Take(8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 })) return false;
                    file.Seek(-12, SeekOrigin.End);
                    var end = new byte[12]; if (file.Read(end, 0, end.Length) != end.Length) return false;
                    if (!end.SequenceEqual(new byte[] { 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130 })) return false;
                    current.screenshotWidth = (header[16] << 24) | (header[17] << 16) | (header[18] << 8) | header[19];
                    current.screenshotHeight = (header[20] << 24) | (header[21] << 16) | (header[22] << 8) | header[23];
                    current.screenshotComplete = true;
                    return true;
                }
            }
            catch (IOException) { return false; }
        }

        static string ArtifactPath(string id)
        {
            if (string.IsNullOrEmpty(id) || id.Length > 80 || id.Any(c => !char.IsLetterOrDigit(c) && c != '-' && c != '_'))
                throw new ArgumentException("Play session id may contain only letters, digits, '-' and '_', up to 80 characters.");
            return Path.Combine(Project, "Logs", "UnityAgentKit", "PlaySessions", id + ".json");
        }

        static bool Under(string path, string directory) => Path.GetFullPath(path).StartsWith(
            Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar,
            StringComparison.OrdinalIgnoreCase);

        static void Persist()
        {
            current.runInBackground = Application.runInBackground;
            current.editorFocused = EditorApplication.isFocused;
            string json = JsonUtility.ToJson(current);
            SessionState.SetString(Key, json);
            WriteJson(SnapshotPath, json);
            nextPersist = Now + 250;
        }

        static void WriteJson(string path, string json) => KitFiles.WriteTextAtomic(path, json);

        static string ReadShared(string path)
        {
            using (var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var reader = new StreamReader(file)) return reader.ReadToEnd();
        }

        static string Error(Exception e)
        {
            while (e is TargetInvocationException tie && tie.InnerException != null) e = tie.InnerException;
            return e.GetType().Name + ": " + e.Message;
        }
    }
}
