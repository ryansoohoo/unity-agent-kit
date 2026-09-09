using System;
using System.Diagnostics;
using System.Threading;
using Unity.Profiling;
using UnityEditor;
using UnityEngine.Profiling;

public static class ProfilerProof
{
    static readonly ProfilerMarker Parent = new ProfilerMarker("Proof.Parent");
    static readonly ProfilerMarker Child = new ProfilerMarker("Proof.Child");
    static readonly ProfilerMarker Leaf = new ProfilerMarker("Proof.Leaf");
    static readonly ProfilerMarker Worker = new ProfilerMarker("Proof.Worker");
    static volatile bool active;
    static Thread thread;
    static double deadline;
    static byte[] allocation;

    public static void Begin()
    {
        Stop();
        active = true;
        deadline = EditorApplication.timeSinceStartup + 45;
        thread = new Thread(() => {
            Profiler.BeginThreadProfiling("Proof", "Worker");
            try {
                while (active) {
                    using (Worker.Auto()) Busy(1);
                    Thread.Sleep(5);
                }
            } finally { Profiler.EndThreadProfiling(); }
        }) { IsBackground = true };
        thread.Start();
        EditorApplication.update += Tick;
        AssemblyReloadEvents.beforeAssemblyReload += Stop;
    }

    static void Tick()
    {
        if (!active || EditorApplication.timeSinceStartup > deadline) { Stop(); return; }
        using (Parent.Auto()) {
            Busy(2);
            for (int i = 0; i < 3; i++)
            using (Child.Auto()) {
                using (Leaf.Auto()) Busy(1);
                Busy(1);
            }
            allocation = new byte[128];
        }
    }

    static void Busy(double ms)
    {
        long end = Stopwatch.GetTimestamp() + (long)(ms * Stopwatch.Frequency / 1000);
        while (Stopwatch.GetTimestamp() < end) Thread.SpinWait(10);
    }

    public static void Stop()
    {
        active = false;
        EditorApplication.update -= Tick;
        AssemblyReloadEvents.beforeAssemblyReload -= Stop;
        if (thread != null) { thread.Join(1000); thread = null; }
    }
}
