using System;
using System.IO;
using System.Reflection;
using UnityEditor;
using UnityEditor.Compilation;
using UnityEngine;

namespace UnityAgentKit.Doctor
{
    // Kanabō (v2, minimal): the reload-boundary correctness signal.
    // Writes <project>/Temp/unity-agent-kit/epoch.json — epoch (per domain
    // reload), 0.5 s heartbeat, compile/reload state, asset world-revision,
    // and the reflected UAK.EpochProbe.Value used by the proof harness.
    // Also answers Temp/unity-agent-kit/refresh.request with
    // AssetDatabase.Refresh() — the explicit import trigger that works with
    // the editor unfocused or headless.
    // ZERO tool surface by design (docs/kanabo/KILL-CRITERIA.md scope
    // ceiling): no scene ops, no eval, no serializers. A status file out,
    // one refresh verb in. That's all this will ever be.
    [InitializeOnLoad]
    public static class KanaboEpoch
    {
        const double HeartbeatSeconds = 0.5;

        static readonly string Dir = Path.Combine(Path.GetDirectoryName(Application.dataPath), "Temp", "unity-agent-kit");
        static readonly string StatusPath = Path.Combine(Dir, "epoch.json");
        static readonly string RequestPath = Path.Combine(Dir, "refresh.request");

        static readonly int Epoch;
        static string state = "ready";
        static double lastWrite;

        [Serializable]
        class Snapshot
        {
            public int schema;
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
            // The static ctor reruns after EVERY domain reload — that IS the epoch.
            Epoch = SessionState.GetInt("uak.epoch", 0) + 1;
            SessionState.SetInt("uak.epoch", Epoch);
            if (string.IsNullOrEmpty(SessionState.GetString("uak.sessionId", "")))
                SessionState.SetString("uak.sessionId", Guid.NewGuid().ToString("N"));

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

        internal static void BumpWorldRevision()
        {
            SessionState.SetInt("uak.worldRevision", SessionState.GetInt("uak.worldRevision", 0) + 1);
        }

        static void Tick()
        {
            var now = EditorApplication.timeSinceStartup;
            if (now - lastWrite < HeartbeatSeconds) return;

            try
            {
                if (File.Exists(RequestPath))
                {
                    File.Delete(RequestPath);
                    state = "compiling"; // pessimistic: a refresh may trigger imports + reload
                    Write();
                    AssetDatabase.Refresh();
                }
            }
            catch { /* a torn request is retried on the next tick */ }

            if (state != "reloading")
                state = EditorApplication.isCompiling ? "compiling" : "ready";
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
                    pid = System.Diagnostics.Process.GetCurrentProcess().Id,
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
