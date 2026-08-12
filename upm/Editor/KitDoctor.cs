using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace UnityAgentKit.Doctor
{
    [Serializable]
    public class KitRow
    {
        public string id;
        public string layer;
        public string title;
        public string status;
        public string evidence;
        public string explain;
        public bool canApply;
    }

    [Serializable]
    internal class KitRowList { public List<KitRow> rows; }

    // Thin runner: locates the bundled Node core and shells out to it.
    // Contains ZERO check logic (wrappers stay dumb) — spawn, parse, relay only.
    public static class KitDoctor
    {
        public static string LastError { get; private set; }

        static string PackageRoot()
        {
            var info = UnityEditor.PackageManager.PackageInfo.FindForAssembly(typeof(KitDoctor).Assembly);
            return info != null ? Path.GetFullPath(info.resolvedPath) : null;
        }

        static string ProjectRoot() => Path.GetDirectoryName(Application.dataPath).TrimEnd('\\');

        static bool Exec(string args, out int code, out string stdout, out string stderr)
        {
            code = -1; stdout = ""; stderr = "";
            var root = PackageRoot();
            if (root == null) { LastError = "package root not found (is this asmdef inside a UPM package?)"; return false; }
            var kitJs = Path.Combine(root, "Core~", "cli", "bin", "kit.js");
            if (!File.Exists(kitJs))
            {
                LastError = "bundled core missing: " + kitJs + "\nRun `npm run build:upm` in the kit repo.";
                return false;
            }
            var psi = new ProcessStartInfo
            {
                FileName = "node",
                Arguments = "\"" + kitJs + "\" \"" + ProjectRoot() + "\" " + args,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            try
            {
                using (var p = Process.Start(psi))
                {
                    // Drain BOTH pipes concurrently — a sequential ReadToEnd pair can
                    // deadlock when the un-drained pipe's buffer fills. The timeout is
                    // load-bearing: on expiry we kill node and fail loudly.
                    var so = p.StandardOutput.ReadToEndAsync();
                    var se = p.StandardError.ReadToEndAsync();
                    if (!p.WaitForExit(120000))
                    {
                        try { p.Kill(); } catch { }
                        LastError = "doctor timed out after 120s — kill any stuck node process and run again.";
                        return false;
                    }
                    stdout = so.Result;
                    stderr = se.Result;
                    code = p.ExitCode;
                    return true;
                }
            }
            catch (System.ComponentModel.Win32Exception e) // node not on PATH lands here
            {
                LastError = "Could not run `node` — the doctor needs Node >= 20 on PATH.\n" +
                            "Install it from https://nodejs.org, restart Unity (PATH is read at launch), then run again.\n(" + e.Message + ")";
                return false;
            }
            catch (Exception e)
            {
                LastError = "doctor process failed: " + e.Message;
                return false;
            }
        }

        // Doctor exit code 1 means "some check failed" — that is a report, not an error.
        public static List<KitRow> RunDoctor()
        {
            LastError = null;
            if (!Exec("--json", out _, out var stdout, out var stderr)) return null;
            var start = stdout.IndexOf('[');
            var end = stdout.LastIndexOf(']');
            if (start < 0 || end <= start)
            {
                LastError = "unexpected doctor output:\n" + Truncate(stdout + stderr, 400);
                return null;
            }
            try
            {
                var wrapped = "{\"rows\":" + stdout.Substring(start, end - start + 1) + "}";
                return JsonUtility.FromJson<KitRowList>(wrapped).rows;
            }
            catch (Exception e)
            {
                LastError = "could not parse doctor JSON: " + e.Message;
                return null;
            }
        }

        // Consent already happened in the window's dialog; --yes makes the CLI non-interactive.
        public static string ApplyOne(string id)
        {
            LastError = null;
            if (!Exec("--fix --yes --only " + id, out _, out var stdout, out var stderr)) return LastError;
            return Truncate((stdout + "\n" + stderr).Trim(), 2000);
        }

        static string Truncate(string s, int n) => string.IsNullOrEmpty(s) || s.Length <= n ? s : s.Substring(0, n) + "…";
    }
}
