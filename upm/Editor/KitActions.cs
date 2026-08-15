using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using UnityEditor;
using UnityEngine;

namespace UnityAgentKit.Doctor
{
    // v3 request channel, editor side. KanaboEpoch.Tick calls Pump() every
    // heartbeat: each req/<id>.json is deleted FIRST (a crash mid-work leaves
    // no result, and the CLI's bounded wait reports it), then dispatched, then
    // answered once with an atomic res/<id>.json. Verbs: invoke (menu item or
    // static method). Every failure is a result, never an exception out of Tick.
    internal static class KitActions
    {
        static readonly string Root = Path.Combine(Path.GetDirectoryName(Application.dataPath), "Temp", "unity-agent-kit");
        static readonly string ReqDir = Path.Combine(Root, "req");
        static readonly string ResDir = Path.Combine(Root, "res");

        [Serializable] class LogLine { public string type; public string message; public string stack; }
        [Serializable] class Result
        {
            public string id; public bool ok; public string error;
            public int startedEpoch; public int finishedEpoch;
            public List<LogLine> log = new List<LogLine>();
        }
        [Serializable] class Request { public string id; public string verb; public string menu; public string method; public string[] args; }

        internal static void Pump()
        {
            string[] files;
            try { if (!Directory.Exists(ReqDir)) return; files = Directory.GetFiles(ReqDir, "*.json"); }
            catch { return; }
            // Windows wildcards also match <id>.json.tmp (the CLI's atomic-write
            // temp) — an exact suffix test keeps a half-written request out.
            foreach (var f in files.Where(x => x.EndsWith(".json", StringComparison.Ordinal)).OrderBy(x => x))
            {
                Request req;
                try { req = JsonUtility.FromJson<Request>(File.ReadAllText(f)); File.Delete(f); }
                catch { continue; } // torn: the CLI renames atomically, so this is a retry-next-tick, not a loss
                if (req == null || string.IsNullOrEmpty(req.id)) continue;
                var res = new Result { id = req.id, startedEpoch = KanaboEpoch.CurrentEpoch };
                Application.LogCallback capture = (msg, stack, type) =>
                    res.log.Add(new LogLine { type = type.ToString(), message = msg, stack = FirstLine(stack) });
                Application.logMessageReceived += capture;
                try
                {
                    switch (req.verb)
                    {
                        case "invoke": Invoke(req, res); break;
                        default: res.error = $"unknown verb: {req.verb}"; break;
                    }
                }
                catch (Exception e) { res.ok = false; res.error = Unwrap(e); }
                finally { Application.logMessageReceived -= capture; }
                res.finishedEpoch = KanaboEpoch.CurrentEpoch;
                Write(res);
            }
        }

        static void Invoke(Request req, Result res)
        {
            if (!string.IsNullOrEmpty(req.menu))
            {
                res.ok = EditorApplication.ExecuteMenuItem(req.menu);
                if (!res.ok) res.error = $"no such menu item: {req.menu}";
                return;
            }
            if (string.IsNullOrEmpty(req.method)) { res.error = "invoke needs menu or method"; return; }
            var dot = req.method.LastIndexOf('.');
            if (dot <= 0) { res.error = $"method must be Namespace.Type.Method: {req.method}"; return; }
            var typeName = req.method.Substring(0, dot);
            var methodName = req.method.Substring(dot + 1);
            var type = AppDomain.CurrentDomain.GetAssemblies().Select(a => { try { return a.GetType(typeName); } catch { return null; } }).FirstOrDefault(t => t != null);
            if (type == null) { res.error = $"type not found in loaded assemblies: {typeName}"; return; }
            var args = req.args ?? Array.Empty<string>();
            var m = type.GetMethods(BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)
                        .FirstOrDefault(x => x.Name == methodName && x.GetParameters().Length == args.Length);
            if (m == null) { res.error = $"no static {methodName}({args.Length} params) on {typeName}"; return; }
            var ps = m.GetParameters();
            var bound = new object[ps.Length];
            for (int i = 0; i < ps.Length; i++)
            {
                var pt = ps[i].ParameterType;
                bound[i] = pt.IsEnum ? Enum.Parse(pt, args[i], true) : Convert.ChangeType(args[i], pt, System.Globalization.CultureInfo.InvariantCulture);
            }
            var ret = m.Invoke(null, bound);
            if (ret != null) res.log.Add(new LogLine { type = "Return", message = ret.ToString(), stack = "" });
            res.ok = true;
        }

        static void Write(Result r)
        {
            try
            {
                Directory.CreateDirectory(ResDir);
                var final = Path.Combine(ResDir, r.id + ".json");
                File.WriteAllText(final + ".tmp", JsonUtility.ToJson(r));
                if (File.Exists(final)) File.Delete(final);
                File.Move(final + ".tmp", final);
            }
            catch { /* the CLI's bounded wait will report timeout; never throw out of Tick */ }
        }

        static string FirstLine(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            var lines = s.Split('\n');
            foreach (var l in lines) { var t = l.Trim(); if (t.Length > 0) return t; }
            return "";
        }

        static string Unwrap(Exception e)
        {
            while (e is TargetInvocationException tie && tie.InnerException != null) e = tie.InnerException;
            return e.GetType().Name + ": " + e.Message;
        }
    }
}
