using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using UnityEditor;
using UnityEditor.Compilation;
using PackageInfo = UnityEditor.PackageManager.PackageInfo;
using UnityEngine;

namespace UnityAgentKit.Doctor
{
    // Import receipts survive a domain reload. Source hashes describe requested disk
    // content; compilation events plus the next loaded domain establish code evidence.
    internal static class KitRefresh
    {
        static readonly string ActivePath = Path.Combine(KitActions.Root, "refresh-active.json");
        static readonly string ReceiptDir = Path.Combine(KitActions.Root, "receipts");
        static Receipt active;
        static bool installed;

        [Serializable] internal sealed class FileEvidence { public string path, sha256, assetPath, assembly; }
        [Serializable] sealed class Probe { public string type, field, expected; }
        [Serializable] sealed class Payload { public FileEvidence[] files = Array.Empty<FileEvidence>(); public Probe probe; }
        [Serializable] sealed class Diagnostic { public string assembly, type, message, file; public int line, column; }
        [Serializable] sealed class Receipt
        {
            public string id, sessionId, projectPath, outcome, error, probeActual;
            public bool ok, needsCompilation, compileStarted, compileFinished, hasProbe, probeLoaded, loadedCodeProven;
            public int beforeEpoch, afterEpoch, beforeRevision, afterRevision;
            public long startedMs, completedMs, deadlineMs, importReturnedMs;
            public KitActions.Request request;
            public FileEvidence[] files;
            public Probe probe;
            public List<string> compiledAssemblies = new List<string>();
            public List<Diagnostic> diagnostics = new List<Diagnostic>();
            public KitCapabilities.AssemblyIdentity[] loadedAssemblies;
        }

        internal static string ActiveId => active?.id;
        internal static bool CanResume(string id) => active != null && active.id == id && active.sessionId == KanaboEpoch.CurrentSession;

        internal static void Install()
        {
            if (installed) return;
            installed = true;
            if (File.Exists(ActivePath))
            {
                try
                {
                    active = JsonUtility.FromJson<Receipt>(File.ReadAllText(ActivePath));
                    // A receipt begun by the previous runtime may lack hasProbe.
                    // Its original payload string preserves optional-field presence.
                    if (active != null && !active.hasProbe && !string.IsNullOrEmpty(active.request?.payloadJson))
                    {
                        var original = new Payload();
                        JsonUtility.FromJsonOverwrite(active.request.payloadJson, original);
                        if (original.probe != null && !string.IsNullOrEmpty(original.probe.type) && !string.IsNullOrEmpty(original.probe.field))
                            active.hasProbe = true;
                    }
                }
                catch (Exception e) { Debug.LogError("[KitRefresh] Cannot read pending receipt: " + e.Message); }
            }
            CompilationPipeline.compilationStarted += OnCompilationStarted;
            CompilationPipeline.assemblyCompilationFinished += OnAssemblyFinished;
            CompilationPipeline.compilationFinished += OnCompilationFinished;
            AssemblyReloadEvents.beforeAssemblyReload += Persist;
        }

        internal static void Begin(KitActions.Request request)
        {
            if (active != null) throw new InvalidOperationException("An import receipt is already running: " + active.id);
            if (EditorApplication.isPlayingOrWillChangePlaymode) throw new InvalidOperationException("Stop Play mode before requesting a code import receipt");
            if (EditorApplication.isCompiling || EditorApplication.isUpdating) throw new InvalidOperationException("Wait for the current import/compile before requesting a correlated refresh");
            var payload = new Payload();
            if (!string.IsNullOrEmpty(request.payloadJson)) JsonUtility.FromJsonOverwrite(request.payloadJson, payload);
            if (payload.files == null || payload.files.Length > 256) throw new ArgumentException("files must contain at most 256 source paths");
            // Unity materializes null nested objects as empty instances. Presence
            // comes from meaningful fields, not the nested object's reference.
            bool hasProbe = payload.probe != null && (!string.IsNullOrEmpty(payload.probe.type)
                || !string.IsNullOrEmpty(payload.probe.field) || !string.IsNullOrEmpty(payload.probe.expected));
            if (hasProbe && (string.IsNullOrEmpty(payload.probe.type) || string.IsNullOrEmpty(payload.probe.field) || payload.probe.expected == null))
                throw new ArgumentException("Probe needs type, field, and expected before refresh starts");
            foreach (var file in payload.files)
            {
                if (file == null || string.IsNullOrEmpty(file.path) || string.IsNullOrEmpty(file.sha256) || file.sha256.Length != 64)
                    throw new ArgumentException("Every requested file needs path and SHA-256");
                file.path = Path.GetFullPath(Path.IsPathRooted(file.path) ? file.path : Path.Combine(KitActions.ProjectPath, file.path));
                file.assetPath = AssetPath(file.path);
                VerifyHash(file);
            }
            active = new Receipt {
                id = request.id, sessionId = KanaboEpoch.CurrentSession, projectPath = KitActions.ProjectPath,
                request = request, files = payload.files, probe = payload.probe, hasProbe = hasProbe,
                beforeEpoch = KanaboEpoch.CurrentEpoch, beforeRevision = KanaboEpoch.WorldRevision,
                startedMs = KitActions.Now, deadlineMs = request.deadlineMs > 0 ? request.deadlineMs : KitActions.Now + 120000,
                outcome = "running", needsCompilation = payload.files.Any(f => CodeInput(f.path))
            };
            Persist();
            try
            {
                AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
                if (active == null) return;
                active.importReturnedMs = KitActions.Now;
                // Explicitly schedule compilation even when the Editor is unfocused.
                // Receipts never infer a successful compile from this call's return value.
                if (active.needsCompilation) CompilationPipeline.RequestScriptCompilation();
                Persist();
            }
            catch (Exception e) { Finish(false, "import_failed", e.GetType().Name + ": " + e.Message); }
        }

        static void OnCompilationStarted(object context)
        {
            if (active == null) return;
            active.compileStarted = true; active.compileFinished = false;
            active.compiledAssemblies.Clear(); active.diagnostics.Clear();
            Persist();
        }

        static void OnAssemblyFinished(string path, CompilerMessage[] messages)
        {
            if (active == null) return;
            string name = Path.GetFileNameWithoutExtension(path);
            foreach (var message in messages)
                if (active.diagnostics.Count < 200)
                    active.diagnostics.Add(new Diagnostic { assembly = name, type = message.type.ToString(), message = message.message,
                        file = message.file, line = message.line, column = message.column });
            if (!messages.Any(m => m.type == CompilerMessageType.Error) && !active.compiledAssemblies.Contains(name)) active.compiledAssemblies.Add(name);
            Persist();
            if (messages.Any(m => m.type == CompilerMessageType.Error)) Finish(false, "compile_failed", "Compilation failed; see receipt diagnostics");
        }

        static void OnCompilationFinished(object context)
        {
            if (active == null) return;
            active.compileFinished = true;
            Persist();
        }

        internal static void Tick()
        {
            if (active == null) return;
            try
            {
                if (active.sessionId != KanaboEpoch.CurrentSession) { Finish(false, "interrupted", "Editor restarted during the refresh"); return; }
                if (KitActions.Now > active.deadlineMs) { Finish(false, "expired", "Import receipt deadline passed before content could be verified"); return; }
                if (EditorApplication.isCompiling || EditorApplication.isUpdating) return;
                if (active.needsCompilation || active.compileStarted)
                {
                    if (!active.compileStarted || !active.compileFinished || KanaboEpoch.CurrentEpoch <= active.beforeEpoch) return;
                }
                else if (active.importReturnedMs == 0 || KitActions.Now - active.importReturnedMs < 1000) return;
                foreach (var file in active.files) VerifyHash(file);
                var assemblies = CompilationPipeline.GetAssemblies(AssembliesType.Editor);
                var wanted = new HashSet<string>();
                foreach (var file in active.files.Where(f => f.path.EndsWith(".cs", StringComparison.OrdinalIgnoreCase)))
                {
                    var owner = assemblies.FirstOrDefault(a => a.sourceFiles.Any(source =>
                        source.Replace('\\', '/') == file.assetPath || SamePath(source, file.path)));
                    if (owner == null) throw new InvalidOperationException("Requested C# file is not part of a loaded Editor compilation: " + file.path);
                    file.assembly = owner.name; wanted.Add(owner.name);
                    if (!active.compiledAssemblies.Contains(owner.name)) throw new InvalidOperationException("No successful compilation event for requested source assembly: " + owner.name);
                }
                if (active.needsCompilation && wanted.Count == 0)
                    foreach (var name in active.compiledAssemblies) wanted.Add(name);
                var loaded = AppDomain.CurrentDomain.GetAssemblies().Where(a => wanted.Contains(a.GetName().Name)).ToArray();
                if (active.needsCompilation && (wanted.Count == 0 || loaded.Length != wanted.Count))
                    throw new InvalidOperationException("Compiled assembly identity could not be confirmed in the loaded domain");
                active.loadedAssemblies = loaded.Select(KitCapabilities.Identity).ToArray();
                active.loadedCodeProven = active.needsCompilation && loaded.Length > 0;
                if (active.hasProbe)
                {
                    active.probeActual = ReadProbe(active.probe);
                    if (active.probeActual != active.probe.expected) throw new InvalidOperationException("Loaded probe value differs from expected: " + active.probeActual);
                    active.probeLoaded = true;
                    // A probe proves its requested field, not every unrelated script in the project.
                    active.loadedCodeProven = true;
                }
                string outcome = active.needsCompilation || active.compileStarted ? "compiled" : KanaboEpoch.WorldRevision > active.beforeRevision ? "imported_assets" : "no_op";
                Finish(true, outcome, null);
            }
            catch (Exception e) { Finish(false, "content_unverified", e.GetType().Name + ": " + e.Message); }
        }

        static void Finish(bool ok, string outcome, string error)
        {
            var receipt = active;
            if (receipt == null) return;
            receipt.ok = ok; receipt.outcome = outcome; receipt.error = error;
            receipt.completedMs = KitActions.Now;
            receipt.afterEpoch = KanaboEpoch.CurrentEpoch; receipt.afterRevision = KanaboEpoch.WorldRevision;
            KitActions.WriteJson(Path.Combine(ReceiptDir, receipt.id + ".json"), receipt);
            KitActions.Complete(receipt.request, ok, outcome, error, JsonUtility.ToJson(receipt));
            active = null;
            if (File.Exists(ActivePath)) File.Delete(ActivePath);
        }

        internal static string ValidateReceipt(string id)
        {
            if (!KitActions.ValidId(id)) return "Invalid receipt id";
            try
            {
                var receipt = JsonUtility.FromJson<Receipt>(File.ReadAllText(Path.Combine(ReceiptDir, id + ".json")));
                if (receipt == null || !receipt.ok) return "The required refresh did not succeed";
                if (receipt.sessionId != KanaboEpoch.CurrentSession || receipt.afterEpoch != KanaboEpoch.CurrentEpoch || receipt.afterRevision != KanaboEpoch.WorldRevision)
                    return "The Editor session, loaded domain, or asset revision changed after the required receipt";
                if (EditorApplication.isCompiling || EditorApplication.isUpdating) return "The Editor is importing or compiling after the required receipt";
                foreach (var file in receipt.files) VerifyHash(file);
                foreach (var identity in receipt.loadedAssemblies ?? Array.Empty<KitCapabilities.AssemblyIdentity>())
                {
                    var loaded = AppDomain.CurrentDomain.GetAssemblies().FirstOrDefault(a => a.GetName().Name == identity.name);
                    if (loaded == null || loaded.ManifestModule.ModuleVersionId.ToString("D") != identity.mvid) return "Loaded assembly differs from the required receipt";
                }
                if ((receipt.hasProbe || receipt.probeLoaded) && ReadProbe(receipt.probe) != receipt.probe.expected) return "Loaded field differs from the required receipt";
                return null;
            }
            catch (Exception e) { return "Cannot use refresh receipt: " + e.Message; }
        }

        static string ReadProbe(Probe probe)
        {
            if (string.IsNullOrEmpty(probe.type) || string.IsNullOrEmpty(probe.field)) throw new ArgumentException("Probe needs type and field");
            var type = Type.GetType(probe.type, false) ?? AppDomain.CurrentDomain.GetAssemblies().Select(a => a.GetType(probe.type, false)).FirstOrDefault(t => t != null);
            var field = type?.GetField(probe.field, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static);
            if (field == null) throw new ArgumentException("Probe static field is not loaded: " + probe.type + "." + probe.field);
            return Convert.ToString(field.IsLiteral ? field.GetRawConstantValue() : field.GetValue(null), CultureInfo.InvariantCulture);
        }

        static bool CodeInput(string path) => new[] { ".cs", ".asmdef", ".asmref", ".rsp" }.Contains(Path.GetExtension(path).ToLowerInvariant());

        static bool SamePath(string first, string second) => string.Equals(Path.GetFullPath(Path.IsPathRooted(first) ? first : Path.Combine(KitActions.ProjectPath, first)), second, StringComparison.OrdinalIgnoreCase);

        static bool Under(string path, string root) => path.StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);

        static string AssetPath(string full)
        {
            if (Under(full, KitActions.ProjectPath)) return full.Substring(KitActions.ProjectPath.Length + 1).Replace('\\', '/');
            foreach (var package in PackageInfo.GetAllRegisteredPackages())
                if (!string.IsNullOrEmpty(package.resolvedPath) && Under(full, package.resolvedPath))
                    return "Packages/" + package.name + "/" + full.Substring(Path.GetFullPath(package.resolvedPath).TrimEnd(Path.DirectorySeparatorChar).Length + 1).Replace('\\', '/');
            throw new ArgumentException("Refresh source must be in this project or an installed package: " + full);
        }

        static void VerifyHash(FileEvidence file)
        {
            using (var sha = SHA256.Create())
            using (var stream = File.OpenRead(file.path))
            {
                string actual = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
                if (!actual.Equals(file.sha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Source changed since the requested snapshot: " + file.path);
            }
        }

        static void Persist()
        {
            if (active != null) KitActions.WriteJson(ActivePath, active);
        }
    }
}
