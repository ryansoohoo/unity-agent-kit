using System;
using System.IO;
using System.Reflection;
using UnityEditor;
using UnityEditor.Compilation;
using UnityEngine;

namespace UnityAgentKit.Doctor
{
    // Kanabō: the reload-boundary correctness signal, plus (v3) the file
    // request channel it pumps. Writes <project>/Temp/unity-agent-kit/epoch.json —
    // epoch (per domain reload), 0.5 s heartbeat, compile/reload state, asset
    // world-revision — answers refresh.request with AssetDatabase.Refresh(),
    // and hands req/*.json to KitActions (invoke). Console mirroring lives in
    // KitConsole; the stalled-main-thread detector in KitBlocked.
    // Deliberately SMALL: a status file out, a handful of verbs in, no scene
    // serializers, no property-by-path — write an editor script and invoke it.
    [InitializeOnLoad]
    public static class KanaboEpoch
    {
        const double HeartbeatSeconds = 0.5;
        const double RefreshGraceSeconds = 5.0;

        static readonly string Dir = Path.Combine(Path.GetDirectoryName(Application.dataPath), "Temp", "unity-agent-kit");
        static readonly string StatusPath = Path.Combine(Dir, "epoch.json");
        static readonly string RequestPath = Path.Combine(Dir, "refresh.request");

        static readonly int Epoch;
        internal static int CurrentEpoch => Epoch;
        internal static string CurrentSession => SessionState.GetString("uak.sessionId", "");
        internal static int CurrentPid => Pid;
        internal static int WorldRevision => SessionState.GetInt("uak.worldRevision", 0);
        internal static string CurrentState => state;
        static readonly int Pid;
        static string state = "ready";
        static double lastWrite;
        static double refreshGraceUntil = -1.0;
        static bool sawWorkSinceRefresh;

        [Serializable]
        class Snapshot
        {
            public int schema;
            public int protocol;
            public int pid;
            public string sessionId;
            public int epoch;
            public long heartbeatMs;
            public string state;
            public int worldRevision;
            public bool probePresent;
            public int probeValue;
        }

        static KanaboEpoch()
        {
            // Import workers run InitializeOnLoad too — they must never write
            // the status file or answer refresh requests (their epoch would go
            // BACKWARDS and stomp the hot editor's signal).
            if (AssetDatabase.IsAssetImportWorkerProcess()) return;
            try
            {
                Pid = System.Diagnostics.Process.GetCurrentProcess().Id;
                // The static ctor reruns after EVERY domain reload — that IS the epoch.
                Epoch = SessionState.GetInt("uak.epoch", 0) + 1;
                SessionState.SetInt("uak.epoch", Epoch);
                if (string.IsNullOrEmpty(SessionState.GetString("uak.sessionId", "")))
                    SessionState.SetString("uak.sessionId", Guid.NewGuid().ToString("N"));

                // After the epoch is assigned, not before: KitConsole stamps
                // every entry with CurrentEpoch, so installing it earlier would
                // file the first logs of a reload under the previous epoch.
                KitConsole.Install();
                KitBlocked.Install();
                KitRefresh.Install();

                // Never claim ready before looking: initial project open runs
                // InitializeOnLoad while the first import is still going.
                state = (EditorApplication.isCompiling || EditorApplication.isUpdating) ? "compiling" : "ready";

                CompilationPipeline.compilationStarted += _ => { state = "compiling"; Write(); };
                AssemblyReloadEvents.beforeAssemblyReload += () =>
                {
                    // Stamp the file BEFORE the domain dies so pollers can tell an
                    // intentional gap from a hung editor.
                    state = "reloading";
                    Write();
                };
                EditorApplication.update += Tick;
                Write();
            }
            catch { /* a failed signal must never poison the type — a throwing static ctor would re-throw TypeInitializationException on every later touch */ }
        }

        internal static void BumpWorldRevision()
        {
            try { SessionState.SetInt("uak.worldRevision", SessionState.GetInt("uak.worldRevision", 0) + 1); }
            catch { /* never break an import batch over the counter */ }
        }

        static void Tick()
        {
            // Every frame, ahead of the heartbeat throttle: the stall detector
            // needs proof the main thread is running, not proof it wrote a file.
            KitBlocked.MainThreadAlive();
            KitRefresh.Tick();

            var now = EditorApplication.timeSinceStartup;
            if (now - lastWrite < HeartbeatSeconds) return;

            try
            {
                if (File.Exists(RequestPath))
                {
                    File.Delete(RequestPath);
                    // Pessimistic until the refresh visibly starts work (compile or
                    // import) or the grace window passes with nothing to do — Unity
                    // QUEUES compilation, so isCompiling is still false the moment
                    // Refresh() returns.
                    state = "compiling";
                    refreshGraceUntil = now + RefreshGraceSeconds;
                    sawWorkSinceRefresh = false;
                    Write();
                    AssetDatabase.Refresh();
                }
            }
            catch { /* a torn request is retried on the next tick */ }

            KitActions.Pump();

            var busy = EditorApplication.isCompiling || EditorApplication.isUpdating;
            if (state != "reloading")
            {
                if (busy) { state = "compiling"; sawWorkSinceRefresh = true; refreshGraceUntil = -1.0; }
                else if (now < refreshGraceUntil && !sawWorkSinceRefresh) state = "compiling"; // the queue gap
                else state = "ready";
            }
            Write();
        }

        static void Write()
        {
            lastWrite = EditorApplication.timeSinceStartup;
            try
            {
                Directory.CreateDirectory(Dir);
                var s = new Snapshot
                {
                    schema = 1,
                    protocol = 2,
                    pid = Pid,
                    sessionId = SessionState.GetString("uak.sessionId", ""),
                    epoch = Epoch,
                    heartbeatMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    state = state,
                    worldRevision = SessionState.GetInt("uak.worldRevision", 0),
                    probePresent = TryProbe(out var v),
                    probeValue = v,
                };
                File.WriteAllText(StatusPath, JsonUtility.ToJson(s));
            }
            catch { /* never break the editor loop over a status file */ }
        }

        static bool TryProbe(out int value)
        {
            value = -1;
            try
            {
                var t = Type.GetType("UAK.EpochProbe, Assembly-CSharp");
                var f = t == null ? null : t.GetField("Value", BindingFlags.Public | BindingFlags.Static);
                if (f == null) return false;
                value = (int)f.GetRawConstantValue();
                return true;
            }
            catch { return false; }
        }
    }

    // Asset world-revision: bumped once per import batch. Consumers use it to
    // notice "the world changed since I looked" without diffing anything.
    class KanaboAssetWatcher : AssetPostprocessor
    {
        static void OnPostprocessAllAssets(string[] imported, string[] deleted, string[] moved, string[] movedFromAssetPaths)
        {
            KanaboEpoch.BumpWorldRevision();
        }
    }
}
