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
    // blocked.json naming the modal responsible. The modal is found by
    // enumerating THIS process's visible top-level windows, not by asking
    // which window is in front: a modal disables the window it owns, so a
    // visible-but-disabled window means some other visible, enabled, titled
    // window of ours is the modal — "API Update Required", a file panel, and
    // so on. Foreground never enters into it, because the normal agent case
    // is an editor sitting unfocused behind the agent's terminal.
    // The main thread deletes the file on its next tick. The timer dies with
    // the domain on reload, so a reload never masquerades as a stall.
    internal static class KitBlocked
    {
        const int StallMs = 2000;
        const int PeriodMs = 500;
        static readonly string PathJson = Path.Combine(Path.GetDirectoryName(Application.dataPath), "Temp", "unity-agent-kit", "blocked.json");
        static Timer timer;
        static long lastMainMs;
        static long stallStartMs;
        static int pid;
        static bool installed;

        [Serializable] class Blocked { public string kind; public string title; public long sinceMs; public long threadHeartbeatMs; public long mainStalledMs; }

        internal static void Install()
        {
            if (installed) return;
            installed = true;
            pid = Process.GetCurrentProcess().Id;
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
                var title = ModalTitleIfAny();
                var b = new Blocked
                {
                    kind = title != null ? "modal" : "main-thread-stalled",
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
        delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
        [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
        [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr hWnd);
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

        // A modal disables the window it owns. So: if any of our visible
        // top-level windows is disabled, the editor is behind a modal, and the
        // modal is a visible enabled sibling with a title. No match → the main
        // thread is stalled on something with no window at all (a long import,
        // a Thread.Sleep), which is a different diagnosis.
        //
        // Two passes on purpose. GetWindowText on a window owned by our OWN
        // process sends WM_GETTEXT and blocks until that window's thread pumps
        // — and in a pure stall the main thread is exactly the thread that is
        // not pumping, so reading titles eagerly parks this probe until the
        // stall ends and blocked.json lands too late to be worth anything.
        // Pass 1 uses only non-blocking window-state calls; pass 2 reads titles
        // only once a disabled window has proven a modal is up, and a modal
        // runs its own message loop, so there the read returns promptly.
        static string ModalTitleIfAny()
        {
            var ours = new System.Collections.Generic.List<IntPtr>();
            var sawDisabled = false;
            EnumWindows((h, _) =>
            {
                if (!IsWindowVisible(h)) return true;
                GetWindowThreadProcessId(h, out var owner);
                if (owner != (uint)pid) return true;
                if (IsWindowEnabled(h)) ours.Add(h);
                else sawDisabled = true;
                return true;
            }, IntPtr.Zero);
            if (!sawDisabled) return null;
            foreach (var h in ours)
            {
                var sb = new StringBuilder(512);
                GetWindowText(h, sb, sb.Capacity);
                var t = sb.ToString();
                if (t.Length > 0) return t;
            }
            return null;
        }
#else
        static string ModalTitleIfAny() => null;
#endif
    }
}
