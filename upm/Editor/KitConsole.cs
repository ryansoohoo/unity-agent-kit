using System;
using System.IO;
using System.Text;
using System.Threading;
using UnityEditor;
using UnityEngine;

namespace UnityAgentKit.Doctor
{
    // Mirrors every console entry to Temp/unity-agent-kit/console.jsonl (one
    // JSON object per line) so the CLI can read the console as data, mid-reload
    // or not. Ring-trimmed to MaxLines on the main thread every TrimEvery
    // writes. Threaded callback: entries from worker threads are captured too;
    // the write is serialized under a lock. Never throws into Unity's logger.
    internal static class KitConsole
    {
        const int MaxLines = 2000;
        const int TrimEvery = 500;
        static readonly string PathJsonl = Path.Combine(Path.GetDirectoryName(Application.dataPath), "Temp", "unity-agent-kit", "console.jsonl");
        static readonly object Gate = new object();
        // No BOM: the CLI splits the file on '\n' and JSON.parse's each line —
        // a leading U+FEFF would make the first entry unparseable forever.
        static readonly Encoding Utf8NoBom = new UTF8Encoding(false);
        static int writesSinceTrim;
        static bool installed;
        // Time.frameCount is a main-thread-only API, but OnLog runs on whatever
        // thread logged. Sampled once per editor update and read as a plain int
        // off-thread — a frame or two stale at worst, which is all the field is
        // for (ordering entries within a session, not exact timing).
        static int lastFrame;

        [Serializable] class Entry { public int epoch; public int frame; public long timeMs; public string type; public string message; public string stack; }

        internal static void Install()
        {
            if (installed) return;
            installed = true;
            Application.logMessageReceivedThreaded += OnLog;
            EditorApplication.update += OnUpdate;
        }

        static void OnLog(string message, string stack, LogType type)
        {
            try
            {
                var e = new Entry
                {
                    epoch = KanaboEpoch.CurrentEpoch,
                    frame = lastFrame,
                    timeMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                    type = type.ToString(),
                    message = message ?? "",
                    stack = FirstLine(stack),
                };
                var line = JsonUtility.ToJson(e) + "\n";
                lock (Gate)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(PathJsonl));
                    File.AppendAllText(PathJsonl, line, Utf8NoBom);
                    writesSinceTrim++;
                }
            }
            catch { /* the console must never break because of its mirror */ }
        }

        // The only main-thread tick this class has: sample the frame counter for
        // the threaded callback, then do the periodic trim.
        static void OnUpdate()
        {
            lastFrame = Time.frameCount;
            MaybeTrim();
        }

        static void MaybeTrim()
        {
            // Incremented under Gate from any thread; this cheap pre-check runs
            // every frame outside the lock, so read it volatile.
            if (Volatile.Read(ref writesSinceTrim) < TrimEvery) return;
            try
            {
                lock (Gate)
                {
                    writesSinceTrim = 0;
                    var lines = File.ReadAllLines(PathJsonl);
                    if (lines.Length <= MaxLines) return;
                    var keep = new string[MaxLines];
                    Array.Copy(lines, lines.Length - MaxLines, keep, 0, MaxLines);
                    File.WriteAllText(PathJsonl + ".tmp", string.Join("\n", keep) + "\n", Utf8NoBom);
                    File.Delete(PathJsonl);
                    File.Move(PathJsonl + ".tmp", PathJsonl);
                }
            }
            catch { /* trim again on the next threshold */ }
        }

        static string FirstLine(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            foreach (var l in s.Split('\n')) { var t = l.Trim(); if (t.Length > 0) return t; }
            return "";
        }
    }
}
