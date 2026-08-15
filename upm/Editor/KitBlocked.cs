using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using UnityEditor;
using UnityEngine;

namespace UnityAgentKit.Doctor
{
    // Answers "WHY is the editor stuck?". A background timer stamps its own
    // heartbeat; when the main thread (which writes epoch.json from
    // EditorApplication.update) has been silent for StallMs, the timer writes
    // blocked.json naming the foreground window if it belongs to this editor
    // process — a modal like "API Update Required" or "Hold on…" is exactly
    // that. The main thread deletes the file on its next tick. The timer dies
    // with the domain on reload, so a reload never masquerades as a stall.
    internal static class KitBlocked
    {
        const int StallMs = 2000;
        const int PeriodMs = 500;
        static readonly string PathJson = Path.Combine(Path.GetDirectoryName(Application.dataPath), "Temp", "unity-agent-kit", "blocked.json");
        static Timer timer;
        static long lastMainMs;
        static long stallStartMs;
        static string mainWindowTitle = "";
        static int pid;
        static bool installed;

        [Serializable] class Blocked { public string kind; public string title; public long sinceMs; public long threadHeartbeatMs; public long mainStalledMs; }

        internal static void Install()
        {
            if (installed) return;
            installed = true;
            pid = Process.GetCurrentProcess().Id;
            try { mainWindowTitle = Process.GetCurrentProcess().MainWindowTitle ?? ""; } catch { }
            Interlocked.Exchange(ref lastMainMs, Now());
            timer = new Timer(_ => Probe(), null, PeriodMs, PeriodMs);
            AssemblyReloadEvents.beforeAssemblyReload += () => { try { timer?.Dispose(); } catch { } };
        }

        internal static void MainThreadAlive()
        {
            Interlocked.Exchange(ref lastMainMs, Now());
            if (stallStartMs != 0)
            {
                stallStartMs = 0;
                try { if (File.Exists(PathJson)) File.Delete(PathJson); } catch { }
            }
        }

        static void Probe()
        {
            try
            {
                var now = Now();
                var stalled = now - Interlocked.Read(ref lastMainMs);
                if (stalled < StallMs) return;
                if (stallStartMs == 0) stallStartMs = now - stalled;
                var title = ForegroundTitleIfOurs();
                var b = new Blocked
                {
                    kind = title != null && title != mainWindowTitle ? "modal" : "main-thread-stalled",
                    title = title,
                    sinceMs = stallStartMs,
                    threadHeartbeatMs = now,
                    mainStalledMs = stalled,
                };
                Directory.CreateDirectory(Path.GetDirectoryName(PathJson));
                File.WriteAllText(PathJson + ".tmp", JsonUtility.ToJson(b));
                if (File.Exists(PathJson)) File.Delete(PathJson);
                File.Move(PathJson + ".tmp", PathJson);
            }
            catch { /* a probe that fails is retried next period */ }
        }

        static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

#if UNITY_EDITOR_WIN
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

        static string ForegroundTitleIfOurs()
        {
            var h = GetForegroundWindow();
            if (h == IntPtr.Zero) return null;
            GetWindowThreadProcessId(h, out var owner);
            if (owner != (uint)pid) return null;
            var sb = new StringBuilder(512);
            GetWindowText(h, sb, sb.Capacity);
            return sb.ToString();
        }
#else
        static string ForegroundTitleIfOurs() => null;
#endif
    }
}
