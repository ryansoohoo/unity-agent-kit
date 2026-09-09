using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Threading.Tasks;
using UnityEditor;
using UnityEngine;

namespace UnityAgentKit.Doctor
{
    // Requests are claimed by rename. Client cancellation competes for that same file,
    // so a successful queued cancellation cannot race with later Editor execution.
    internal static class KitActions
    {
        internal static readonly string ProjectPath = Path.GetFullPath(Path.GetDirectoryName(Application.dataPath));
        internal static readonly string Root = Path.Combine(ProjectPath, "Temp", "unity-agent-kit");
        static readonly string ReqDir = Path.Combine(Root, "req");
        static readonly string RunningDir = Path.Combine(Root, "running");
        static readonly string OpsDir = Path.Combine(Root, "ops");
        static readonly string ResDir = Path.Combine(Root, "res");
        static readonly Dictionary<string, PendingTask> Tasks = new Dictionary<string, PendingTask>();
        static bool recovered;
        const int MaxLogLines = 100;

        [Serializable] internal sealed class LogLine { public string type, message, stack; }
        [Serializable] internal sealed class Request
        {
            public string id, verb, menu, method;
            public string[] args;
            public long requestedMs, deadlineMs;
            public string expectedSession, leaseToken, payloadJson, requiredReceipt;
            public int expectedEpoch;
        }
        [Serializable] internal sealed class Result
        {
            public string id, state, code, error, sessionId, projectPath, dataJson;
            public bool ok;
            public int startedEpoch, finishedEpoch, droppedLogLines;
            public long startedMs, completedMs;
            public List<LogLine> log = new List<LogLine>();
        }
        [Serializable] sealed class Lease { public string token, owner, sessionId, projectPath; public long expiresMs, acquiredMs; }
        [Serializable] sealed class CheckValue { public bool ok; public string error; }
        [Serializable] sealed class ActionName { public string action; }
        [Serializable] sealed class PlayLease { public string state, leaseToken, editorSession; }
        [Serializable] sealed class CaptureLease { public string leaseToken, editorSession; public bool active; }
        sealed class PendingTask { internal Request request; internal Result result; internal Task task; }

        internal static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        internal static bool ValidId(string id) => !string.IsNullOrEmpty(id) && id.Length <= 128 && id.All(c => char.IsLetterOrDigit(c) || c == '-' || c == '_');

        internal static void Pump()
        {
            if (!recovered) { recovered = true; Recover(); }
            PollTasks();
            string[] files;
            try { files = Directory.Exists(ReqDir) ? Directory.GetFiles(ReqDir, "*.json") : Array.Empty<string>(); }
            catch { return; }
            foreach (var file in files.Where(f => f.EndsWith(".json", StringComparison.Ordinal)).OrderBy(f => f))
            {
                string id = Path.GetFileNameWithoutExtension(file);
                if (!ValidId(id)) continue;
                string claimed = Path.Combine(RunningDir, id + ".json");
                try { Directory.CreateDirectory(RunningDir); File.Move(file, claimed); }
                catch (IOException) { continue; }
                catch (UnauthorizedAccessException) { continue; }
                Request req = null;
                try
                {
                    req = JsonUtility.FromJson<Request>(File.ReadAllText(claimed));
                    if (req == null || req.id != id) throw new ArgumentException("Request id must match its filename");
                    var prior = ReadOperation(id);
                    if (prior != null && prior.completedMs > 0)
                    {
                        WriteJson(Path.Combine(ResDir, id + ".json"), prior);
                        File.Delete(claimed);
                        continue;
                    }
                    var result = NewResult(req);
                    WriteOperation(result);
                    Dispatch(req, result);
                }
                catch (Exception e)
                {
                    req = req ?? new Request { id = id };
                    req.id = id;
                    Complete(req, false, "dispatch_error", Unwrap(e), null);
                }
            }
        }

        static Result NewResult(Request req) => new Result {
            id = req.id, state = "running", startedMs = Now, startedEpoch = KanaboEpoch.CurrentEpoch,
            sessionId = KanaboEpoch.CurrentSession, projectPath = ProjectPath
        };

        static void Recover()
        {
            if (!Directory.Exists(RunningDir)) return;
            foreach (var file in Directory.GetFiles(RunningDir, "*.json"))
            {
                try
                {
                    var req = JsonUtility.FromJson<Request>(File.ReadAllText(file));
                    if (req == null || !ValidId(req.id)) continue;
                    var prior = ReadOperation(req.id);
                    if (prior != null && prior.completedMs > 0) { File.Delete(file); continue; }
                    if (req.verb == "refresh" && KitRefresh.CanResume(req.id)) continue;
                    Complete(req, false, "interrupted", "Editor reload or restart interrupted the operation; execution may have changed state.", null);
                }
                catch (Exception e) { Debug.LogError("[KitActions] Recovery failed: " + e.Message); }
            }
        }

        static void Dispatch(Request req, Result result)
        {
            long deadline = req.deadlineMs > 0 ? req.deadlineMs : req.requestedMs > 0 ? req.requestedMs + 120000 : 0;
            req.deadlineMs = deadline;
            if (deadline > 0 && Now > deadline) { Finish(req, result, false, "expired", "Request expired before execution"); return; }
            if (!string.IsNullOrEmpty(req.expectedSession) && req.expectedSession != KanaboEpoch.CurrentSession)
            { Finish(req, result, false, "wrong_session", "The Editor session changed before execution"); return; }
            if (req.expectedEpoch > 0 && req.expectedEpoch != KanaboEpoch.CurrentEpoch)
            { Finish(req, result, false, "wrong_epoch", "The loaded domain changed before execution"); return; }
            if (!ReadOnly(req))
            {
                var leaseError = ValidateLease(req.leaseToken, req.id);
                if (leaseError != null) { Finish(req, result, false, "lease_conflict", leaseError); return; }
                if (KitRefresh.ActiveId != null && KitRefresh.ActiveId != req.id)
                { Finish(req, result, false, "editor_busy", "An import receipt is still running"); return; }
                if (Tasks.Count > 0)
                { Finish(req, result, false, "editor_busy", "A previous asynchronous invocation is still running"); return; }
                if (!string.IsNullOrEmpty(req.requiredReceipt))
                {
                    var receiptError = KitRefresh.ValidateReceipt(req.requiredReceipt);
                    if (receiptError != null) { Finish(req, result, false, "invalid_receipt", receiptError); return; }
                }
            }
            Application.LogCallback capture = (msg, stack, type) => AddLog(result, type.ToString(), msg, stack);
            Application.logMessageReceived += capture;
            try
            {
                switch (req.verb)
                {
                    case "status":
                    case "capabilities":
                        result.dataJson = KitCapabilities.Handle(req.payloadJson);
                        Finish(req, result, true, "completed", null); break;
                    case "refresh": KitRefresh.Begin(req); break;
                    case "session":
                        result.dataJson = KitPlaySession.Handle(req.payloadJson, req.leaseToken);
                        var sessionFailure = new CheckValue { ok = true };
                        JsonUtility.FromJsonOverwrite(result.dataJson, sessionFailure);
                        if (!sessionFailure.ok)
                            Finish(req, result, false, "session_failed", sessionFailure.error);
                        else Finish(req, result, true, "completed", null);
                        break;
                    case "invoke":
                    case "check": Invoke(req, result); break;
                    default: Finish(req, result, false, "unsupported_verb", "Unknown verb: " + req.verb); break;
                }
            }
            catch (Exception e) { Finish(req, result, false, "execution_failed", Unwrap(e)); }
            finally { Application.logMessageReceived -= capture; }
        }

        static bool ReadOnly(Request req)
        {
            if (req.verb == "status" || req.verb == "capabilities") return true;
            if (req.verb == "session")
            {
                try { return string.IsNullOrEmpty(req.payloadJson) || (JsonUtility.FromJson<ActionName>(req.payloadJson)?.action ?? "status") == "status"; }
                catch { return false; }
            }
            if (req.verb != "invoke" || !string.IsNullOrEmpty(req.menu) || req.method != "UnityAgentKit.Doctor.KitProfiler.Execute" || req.args == null || req.args.Length != 1) return false;
            try
            {
                string action = JsonUtility.FromJson<ActionName>(req.args[0])?.action;
                return new[] { "status", "targets", "sessions", "frames", "threads", "frame", "sample" }.Contains(action);
            }
            catch { return false; }
        }

        static void Invoke(Request req, Result result)
        {
            if (!string.IsNullOrEmpty(req.menu))
            {
                if (req.verb == "check") throw new ArgumentException("check requires a method with an explicit result");
                bool ran = EditorApplication.ExecuteMenuItem(req.menu);
                Finish(req, result, ran, ran ? "completed" : "missing_menu", ran ? null : "No such menu item: " + req.menu);
                return;
            }
            var args = req.args ?? Array.Empty<string>();
            var method = ResolveMethod(req.method, args.Length);
            if (method.ReturnType == typeof(void) && method.IsDefined(typeof(AsyncStateMachineAttribute), false))
                throw new ArgumentException("async void cannot report completion; return Task instead");
            if (typeof(IEnumerator).IsAssignableFrom(method.ReturnType) || (method.ReturnType.FullName ?? "").StartsWith("System.Threading.Tasks.ValueTask", StringComparison.Ordinal))
                throw new ArgumentException("Coroutine/ValueTask completion is unsupported; return Task instead");
            var ps = method.GetParameters();
            var bound = new object[ps.Length];
            for (int i = 0; i < ps.Length; i++)
                bound[i] = ps[i].ParameterType.IsEnum ? Enum.Parse(ps[i].ParameterType, args[i], true) : Convert.ChangeType(args[i], ps[i].ParameterType, CultureInfo.InvariantCulture);
            object returned = req.method == "UnityAgentKit.Doctor.KitProfiler.Execute" && args.Length == 1
                ? KitProfiler.ExecuteWithLease(args[0], req.leaseToken)
                : method.Invoke(null, bound);
            if (returned is Task task)
            {
                Tasks.Add(req.id, new PendingTask { request = req, result = result, task = task });
                WriteOperation(result);
                return;
            }
            FinishValue(req, result, returned);
        }

        internal static MethodInfo ResolveMethod(string name, int argc)
        {
            int dot = name == null ? -1 : name.LastIndexOf('.');
            if (dot <= 0) throw new ArgumentException("Method must be Namespace.Type.Method");
            var type = AppDomain.CurrentDomain.GetAssemblies().Select(a => a.GetType(name.Substring(0, dot), false)).FirstOrDefault(t => t != null);
            if (type == null) throw new ArgumentException("Type is not loaded: " + name.Substring(0, dot));
            var matches = type.GetMethods(BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)
                .Where(m => m.Name == name.Substring(dot + 1) && m.GetParameters().Length == argc && !m.ContainsGenericParameters).ToArray();
            if (matches.Length != 1) throw new ArgumentException(matches.Length == 0 ? "No static method has that name and argument count" : "Ambiguous overload; use an unambiguous wrapper method");
            return matches[0];
        }

        static void PollTasks()
        {
            foreach (var pending in Tasks.Values.ToArray())
            {
                if (!pending.task.IsCompleted)
                {
                    if (pending.request.deadlineMs > 0 && Now > pending.request.deadlineMs && pending.result.code != "deadline_exceeded")
                    {
                        pending.result.code = "deadline_exceeded";
                        pending.result.error = "Caller deadline passed; the running Task cannot be forcibly cancelled. Wait for its terminal result.";
                        WriteOperation(pending.result);
                    }
                    continue;
                }
                Tasks.Remove(pending.request.id);
                try
                {
                    pending.task.GetAwaiter().GetResult();
                    var property = pending.task.GetType().GetProperty("Result", BindingFlags.Public | BindingFlags.Instance);
                    FinishValue(pending.request, pending.result, property?.GetValue(pending.task));
                }
                catch (Exception e) { Finish(pending.request, pending.result, false, "execution_failed", Unwrap(e)); }
            }
        }

        static void FinishValue(Request req, Result result, object value)
        {
            if (value != null) AddLog(result, "Return", value.ToString(), "");
            if (req.verb != "check") { Finish(req, result, true, "completed", null); return; }
            if (value is bool passed) { Finish(req, result, passed, passed ? "passed" : "check_failed", passed ? null : "Check returned false"); return; }
            string json = value as string;
            if (json == null && value != null && value.GetType().GetField("ok")?.FieldType == typeof(bool)) json = JsonUtility.ToJson(value);
            if (string.IsNullOrEmpty(json)) throw new ArgumentException("check must return bool or JSON/object with an explicit boolean ok field");
            var check = new CheckValue { ok = true };
            var presence = new CheckValue { ok = false };
            JsonUtility.FromJsonOverwrite(json, check);
            JsonUtility.FromJsonOverwrite(json, presence);
            if (check.ok != presence.ok) throw new ArgumentException("check result has no explicit boolean ok field");
            result.dataJson = json;
            Finish(req, result, check.ok, check.ok ? "passed" : "check_failed", check.ok ? null : check.error ?? "Check returned ok=false");
        }

        internal static string ValidateLease(string token) => ValidateLease(token, null);
        static string ValidateLease(string token, string excludeId)
        {
            var path = Path.Combine(Root, "lease.json");
            if (!File.Exists(path)) return string.IsNullOrEmpty(token) ? null : "The requested lease no longer exists";
            try
            {
                var lease = JsonUtility.FromJson<Lease>(ReadShared(path));
                if (lease == null || string.IsNullOrEmpty(lease.token)) return "Lease metadata is unreadable";
                bool ownsRunning = Directory.Exists(RunningDir) && Directory.GetFiles(RunningDir, "*.json").Any(file => {
                    try { var req = JsonUtility.FromJson<Request>(File.ReadAllText(file)); return req != null && req.id != excludeId && req.leaseToken == lease.token; }
                    catch { return true; }
                });
                string playPath = Path.Combine(Root, "play-session.json");
                if (File.Exists(playPath))
                {
                    var play = JsonUtility.FromJson<PlayLease>(ReadShared(playPath));
                    if (play != null && play.leaseToken == lease.token && play.editorSession == KanaboEpoch.CurrentSession
                        && new[] { "queued", "entering", "warmup", "running", "stopping" }.Contains(play.state)) ownsRunning = true;
                }
                string capturePath = Path.Combine(Root, "profiler-capture.json");
                if (File.Exists(capturePath))
                {
                    var capture = JsonUtility.FromJson<CaptureLease>(ReadShared(capturePath));
                    if (capture != null && capture.active && capture.leaseToken == lease.token
                        && capture.editorSession == KanaboEpoch.CurrentSession) ownsRunning = true;
                }
                if (lease.expiresMs <= Now && !ownsRunning) return string.IsNullOrEmpty(token) ? null : "The requested lease expired";
                if (token != lease.token) return "Editor is leased by " + lease.owner;
                if (!string.IsNullOrEmpty(lease.sessionId) && lease.sessionId != KanaboEpoch.CurrentSession) return "Lease belongs to a different Editor session";
                if (!string.IsNullOrEmpty(lease.projectPath) && !string.Equals(Path.GetFullPath(lease.projectPath), ProjectPath, StringComparison.OrdinalIgnoreCase)) return "Lease belongs to a different project";
                return null;
            }
            catch (Exception e) { return "Cannot validate Editor lease: " + e.Message; }
        }

        internal static void Complete(Request req, bool ok, string code, string error, string dataJson)
        {
            var result = ReadOperation(req.id) ?? NewResult(req);
            result.dataJson = dataJson;
            Finish(req, result, ok, code, error);
        }

        static void Finish(Request req, Result result, bool ok, string code, string error)
        {
            result.ok = ok;
            result.state = ok ? "completed" : code == "expired" ? "expired" : code == "interrupted" ? "interrupted" : "failed";
            result.code = code; result.error = error;
            result.finishedEpoch = KanaboEpoch.CurrentEpoch; result.completedMs = Now;
            WriteOperation(result);
            WriteJson(Path.Combine(ResDir, req.id + ".json"), result);
            string running = Path.Combine(RunningDir, req.id + ".json");
            if (File.Exists(running)) File.Delete(running);
        }

        internal static Result ReadOperation(string id)
        {
            if (!ValidId(id)) return null;
            try { return JsonUtility.FromJson<Result>(File.ReadAllText(Path.Combine(OpsDir, id + ".json"))); }
            catch { return null; }
        }

        // Cross-process metadata is replaced atomically. Permit replacement while
        // reading the previous complete file so Windows readers do not block renewals.
        internal static string ReadShared(string path)
        {
            using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var reader = new StreamReader(stream)) return reader.ReadToEnd();
        }
        static void WriteOperation(Result result) => WriteJson(Path.Combine(OpsDir, result.id + ".json"), result);

        internal static void WriteJson(string path, object value) => KitFiles.WriteJson(path, value);

        static void AddLog(Result result, string type, string message, string stack)
        {
            if (result.log.Count >= MaxLogLines)
            {
                result.droppedLogLines++;
                if (type != "Return") return;
                result.log.RemoveAt(result.log.Count - 1);
            }
            result.log.Add(new LogLine { type = type, message = message, stack = stack });
        }
        static string Unwrap(Exception e)
        {
            while (e is TargetInvocationException tie && tie.InnerException != null) e = tie.InnerException;
            return e.GetType().Name + ": " + e.Message;
        }
    }
}
