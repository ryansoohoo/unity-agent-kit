using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using UnityEditor;
using UnityEditor.Compilation;
using PackageInfo = UnityEditor.PackageManager.PackageInfo;
using UnityEditorInternal;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAgentKit.Doctor
{
    // Discovery reads loaded assemblies and Editor state. It never invokes discovered methods.
    internal static class KitCapabilities
    {
        [Serializable] sealed class Query { public string filter; public int offset, limit = 100; public bool details; }
        [Serializable] internal sealed class AssemblyIdentity { public string name, version, mvid, location; }
        [Serializable] sealed class SceneInfo { public string path, name; public bool active, dirty, loaded; }
        [Serializable] sealed class MethodInfoRow { public string method, signature, returns, assembly, mvid; public string[] parameters; }
        [Serializable] sealed class Response
        {
            public int protocol = 2, pid, epoch, worldRevision;
            public string projectPath, sessionId, unityVersion, state, runtimeVersion, runtimePath, editorLogPath, processRole;
            public bool compiling, importing, playing, playTransition, recording, pipelineInstalled, editorFocused, runInBackground, paused;
            public string pipelineVersion, pipelineReachability = "unknown: query the vendor backend separately";
            public string[] commands, limitations;
            public SceneInfo[] scenes;
            public AssemblyIdentity[] assemblies;
            public MethodInfoRow[] methods;
            public int matchedMethods, offset, limit, assemblyCount;
            public bool assembliesIncluded, detailsAvailable = true;
            public bool methodsTruncated;
            public bool scanTruncated;
        }

        internal static string Handle(string payloadJson)
        {
            var q = new Query();
            if (!string.IsNullOrEmpty(payloadJson)) JsonUtility.FromJsonOverwrite(payloadJson, q);
            if (q.limit < 1 || q.limit > 200 || q.offset < 0) throw new ArgumentException("Discovery limit must be 1..200; offset must be nonnegative");
            if (!string.IsNullOrEmpty(q.filter) && q.filter.Length < 3) throw new ArgumentException("Method discovery filter needs at least three characters");
            var kit = PackageInfo.FindForAssembly(typeof(KitActions).Assembly);
            var pipeline = PackageInfo.GetAllRegisteredPackages().FirstOrDefault(p => p.name == "com.unity.pipeline");
            var loaded = AppDomain.CurrentDomain.GetAssemblies();
            var sourceAssemblies = new HashSet<string>(CompilationPipeline.GetAssemblies(AssembliesType.Editor).Select(a => a.name));
            var relevant = loaded.Where(a => sourceAssemblies.Contains(a.GetName().Name)).OrderBy(a => a.GetName().Name).ToArray();
            var scenes = new List<SceneInfo>();
            for (int i = 0; i < SceneManager.sceneCount; i++)
            {
                var s = SceneManager.GetSceneAt(i);
                scenes.Add(new SceneInfo { path = s.path, name = s.name, dirty = s.isDirty, loaded = s.isLoaded, active = s == SceneManager.GetActiveScene() });
            }
            var methods = new List<MethodInfoRow>();
            int matched = 0;
            var scan = System.Diagnostics.Stopwatch.StartNew();
            bool scanTruncated = false;
            if (!string.IsNullOrEmpty(q.filter))
            {
                foreach (var assembly in relevant)
                    foreach (var type in Types(assembly).OrderBy(t => t.FullName))
                        foreach (var method in type.GetMethods(BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly).OrderBy(m => m.Name))
                        {
                            if (scan.ElapsedMilliseconds > 500) { scanTruncated = true; goto Discovered; }
                            string name = type.FullName + "." + method.Name;
                            if (method.ContainsGenericParameters || name.IndexOf(q.filter, StringComparison.OrdinalIgnoreCase) < 0) continue;
                            int position = matched++;
                            if (position < q.offset || methods.Count >= q.limit) continue;
                            var parameters = method.GetParameters().Select(p => p.ParameterType.FullName + " " + p.Name).ToArray();
                            methods.Add(new MethodInfoRow { method = name, signature = name + "(" + string.Join(", ", parameters) + ")",
                                returns = method.ReturnType.FullName, parameters = parameters,
                                assembly = assembly.GetName().Name, mvid = assembly.ManifestModule.ModuleVersionId.ToString("D") });
                        }
            }
            Discovered:
            var response = new Response {
                projectPath = KitActions.ProjectPath, sessionId = KanaboEpoch.CurrentSession,
                pid = KanaboEpoch.CurrentPid, epoch = KanaboEpoch.CurrentEpoch, worldRevision = KanaboEpoch.WorldRevision,
                unityVersion = Application.unityVersion, state = KanaboEpoch.CurrentState,
                runtimeVersion = kit?.version ?? typeof(KitActions).Assembly.GetName().Version.ToString(), runtimePath = kit?.resolvedPath,
                compiling = EditorApplication.isCompiling, importing = EditorApplication.isUpdating,
                playing = EditorApplication.isPlaying, playTransition = EditorApplication.isPlayingOrWillChangePlaymode != EditorApplication.isPlaying,
                recording = ProfilerDriver.enabled, editorLogPath = Application.consoleLogPath,
                processRole = "main-editor", editorFocused = InternalEditorUtility.isApplicationActive,
                runInBackground = Application.runInBackground, paused = EditorApplication.isPaused,
                pipelineInstalled = pipeline != null, pipelineVersion = pipeline?.version,
                scenes = scenes.ToArray(), assemblies = q.details ? relevant.Select(Identity).ToArray() : Array.Empty<AssemblyIdentity>(), methods = methods.ToArray(),
                assemblyCount = relevant.Length, assembliesIncluded = q.details,
                matchedMethods = matched, offset = q.offset, limit = q.limit, methodsTruncated = q.offset + methods.Count < matched,
                scanTruncated = scanTruncated,
                commands = new[] { "status", "capabilities", "refresh", "invoke", "check", "session", "console", "operation status/wait/cancel", "lease acquire/status/renew/release", "profiler" },
                limitations = new[] {
                    "Protocol 2 cancellation can prevent a queued request from starting; running synchronous calls and Tasks cannot be forcibly interrupted.",
                    "invoke success means returned without throwing. check requires an explicit boolean or structured ok result.",
                    "Method discovery searches compiled project and package assemblies; supply filter to list methods.",
                    "Disk hashes alone do not prove loaded code. Use a successful refresh receipt with compiled assembly evidence or a loaded-field probe.",
                    "CLI and skill paths/versions belong to the caller; this response identifies the runtime actually loaded in this Editor." }
            };
            return JsonUtility.ToJson(response);
        }

        internal static AssemblyIdentity Identity(System.Reflection.Assembly assembly) => new AssemblyIdentity {
            name = assembly.GetName().Name, version = assembly.GetName().Version.ToString(),
            mvid = assembly.ManifestModule.ModuleVersionId.ToString("D"), location = assembly.IsDynamic ? "" : assembly.Location
        };

        static IEnumerable<Type> Types(System.Reflection.Assembly assembly)
        {
            try { return assembly.GetTypes(); }
            catch (ReflectionTypeLoadException e) { return e.Types.Where(t => t != null); }
        }
    }
}
