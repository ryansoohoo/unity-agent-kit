using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using UnityEditor.Profiling;
using UnityEditorInternal;

namespace UnityAgentKit.Doctor
{
    // Reads recorded samples with frame-local thread indices, separate from
    // persistent thread IDs. All views are disposed before returning to the bridge.
    internal static class KitProfilerReader
    {
        [Serializable] internal sealed class FramesResult {
            public int firstFrame, lastFrame, matched, offset, limit;
            public bool truncated; public FrameDto[] frames;
        }
        [Serializable] internal sealed class FrameDto {
            public int frame; public double startMs, cpuMs, gpuMs;
            public bool gpuAvailable; public string gpuAvailability;
        }
        [Serializable] internal sealed class ThreadsResult { public int frame; public ThreadDto[] threads; }
        [Serializable] internal sealed class ThreadDto { public int index, sampleCount; public string threadId, name, group; }
        [Serializable] internal sealed class FrameResult {
            public int frame, thread, sampleCount, matched, offset, limit;
            public string threadName, threadGroup;
            public bool mainThreadDefaulted, truncated; public SampleDto[] samples;
        }
        [Serializable] internal sealed class SampleDto {
            public int index, parent, depth;
            public double startMs, durationMs, selfMs, childOverlapMs;
            public string name, callerPath; public long gcBytes;
        }
        [Serializable] internal sealed class SampleResult {
            public int frame, thread; public string threadName, threadGroup;
            public SampleDto sample; public StackEntry[] callstack;
            public FlowEntry[] flowEvents; public MetadataEntry[] metadata; public string callstackNote;
        }
        [Serializable] internal sealed class StackEntry { public string address, method, sourceFile; public uint sourceLine; }
        [Serializable] internal sealed class FlowEntry { public uint id; public int parentSampleIndex; public string type; }
        [Serializable] internal sealed class MetadataEntry { public string name, type, unit, value; }
        [Serializable] internal sealed class AnalyzeResult {
            public int schema = 1, firstFrame, lastFrame, frameCount, markerTotal, offset, limit, threadFilter;
            public string filter, unityVersion; public StatsDto frameStats;
            public MarkerDto[] markers; public bool markersTruncated;
            public string sourceSession;
            public KitProfilerCapture.Gap[] archiveGaps;
            public KitProfilerCapture.CaptureContext captureContext;
            public KitProfilerCapture.Bookmark[] bookmarks;
            [NonSerialized] internal double[] frameTimes;
        }
        [Serializable] internal sealed class StatsDto { public double mean, median, p95, p99, max, overBudget; public int overBudgetCount; }
        [Serializable] internal sealed class MarkerDto {
            public string path, thread, threadGroup;
            public double totalMs, selfMs, maxMs, maxFrameMs, childOverlapMs;
            public long calls, gcBytes; public int frames;
            [NonSerialized] internal int lastFrame = -1;
            [NonSerialized] internal double frameTotal;
        }

        public static object Frames(KitProfiler.Request r)
        {
            Range(r, out int first, out int last);
            var rows = new List<FrameDto>();
            foreach (int f in FrameIndices(first, last))
            using (var v = ProfilerDriver.GetRawFrameDataView(f, 0))
            {
                if (!v.valid || v.frameTimeMs < r.minMs) continue;
                var gpu = ProfilerDriver.GetGpuStatisticsAvailabilityState(f);
                bool available = (gpu & GpuProfilingStatisticsAvailabilityStates.Gathered) != 0;
                rows.Add(new FrameDto { frame = f, startMs = v.frameStartTimeMs, cpuMs = v.frameTimeMs,
                    gpuAvailable = available, gpuAvailability = gpu.ToString(), gpuMs = available ? v.frameGpuTimeMs : 0 });
            }
            return new FramesResult { firstFrame = first, lastFrame = last, matched = rows.Count, offset = r.offset, limit = r.limit,
                truncated = r.offset + (long)r.limit < rows.Count, frames = rows.Skip(r.offset).Take(r.limit).ToArray() };
        }

        public static object Threads(KitProfiler.Request r)
        {
            int frame = Resolve(r);
            var rows = new List<ThreadDto>();
            for (int t = 0; ; t++)
            using (var v = ProfilerDriver.GetRawFrameDataView(frame, t))
            {
                if (!v.valid) break;
                rows.Add(new ThreadDto { index = t, threadId = v.threadId.ToString(), name = v.threadName, group = v.threadGroupName, sampleCount = v.sampleCount });
            }
            if (rows.Count == 0) throw new InvalidOperationException("Frame data is not available");
            return new ThreadsResult { frame = frame, threads = rows.ToArray() };
        }

        public static object Frame(KitProfiler.Request r)
        {
            int frame = Resolve(r), thread = Math.Max(0, r.thread);
            using (var v = ProfilerDriver.GetRawFrameDataView(frame, thread))
            {
                RequireValid(v);
                var samples = ReadSamples(v).Where(s => Matches(s, r.filter)).ToArray();
                return new FrameResult { frame = frame, thread = thread, threadName = v.threadName, threadGroup = v.threadGroupName,
                    mainThreadDefaulted = r.thread < 0, sampleCount = v.sampleCount, matched = samples.Length, offset = r.offset, limit = r.limit,
                    truncated = r.offset + (long)r.limit < samples.Length, samples = samples.Skip(r.offset).Take(r.limit).ToArray() };
            }
        }

        public static object Sample(KitProfiler.Request r)
        {
            int frame = Resolve(r), thread = Math.Max(0, r.thread);
            using (var v = ProfilerDriver.GetRawFrameDataView(frame, thread))
            {
                RequireValid(v);
                if (r.sample < 0 || r.sample >= v.sampleCount) throw new ArgumentException("sample index is outside the recorded thread");
                var addresses = new List<ulong>();
                v.GetSampleCallstack(r.sample, addresses);
                var stacks = new List<StackEntry>();
                foreach (ulong address in addresses)
                {
                    var method = v.ResolveMethodInfo(address);
                    stacks.Add(new StackEntry { address = "0x" + address.ToString("X"), method = method.methodName,
                        sourceFile = method.sourceFileName, sourceLine = method.sourceFileLine });
                }
                var flows = new List<RawFrameDataView.FlowEvent>();
                v.GetSampleFlowEvents(r.sample, flows);
                var info = v.GetMarkerMetadataInfo(v.GetSampleMarkerId(r.sample)) ?? Array.Empty<FrameDataView.MarkerMetadataInfo>();
                var metadata = new List<MetadataEntry>();
                for (int i = 0; i < v.GetSampleMetadataCount(r.sample); i++)
                    metadata.Add(new MetadataEntry { name = i < info.Length ? info[i].name : "metadata-" + i,
                        type = i < info.Length ? info[i].type.ToString() : "unknown", unit = i < info.Length ? info[i].unit.ToString() : "unknown",
                        value = v.GetSampleMetadataAsString(r.sample, i) });
                return new SampleResult { frame = frame, thread = thread, threadName = v.threadName, threadGroup = v.threadGroupName,
                    sample = ReadSamples(v)[r.sample], callstack = stacks.ToArray(), metadata = metadata.ToArray(),
                    flowEvents = flows.Select(f => new FlowEntry { id = f.FlowId, type = f.FlowEventType.ToString(), parentSampleIndex = f.ParentSampleIndex }).ToArray(),
                    callstackNote = stacks.Count == 0 ? "No call stack recorded for this sample. Enable supported call-stack recording before reproducing." : "Source locations depend on captured symbols." };
            }
        }

        public static object Analyze(KitProfiler.Request r)
        {
            Range(r, out int first, out int last);
            var times = new List<double>();
            var markers = new Dictionary<string, MarkerDto>(StringComparer.Ordinal);
            var watch = Stopwatch.StartNew();
            foreach (int frame in FrameIndices(first, last))
            {
                if (watch.Elapsed.TotalSeconds > 8) throw new InvalidOperationException("Analysis exceeded its 8-second Editor budget. Query a narrower frame range.");
                using (var main = ProfilerDriver.GetRawFrameDataView(frame, 0))
                {
                    if (!main.valid) continue;
                    times.Add(main.frameTimeMs);
                }
                for (int thread = 0; ; thread++)
                using (var v = ProfilerDriver.GetRawFrameDataView(frame, thread))
                {
                    if (!v.valid) break;
                    if (r.thread >= 0 && r.thread != thread) continue;
                    foreach (var sample in ReadSamples(v))
                    {
                        if (!Matches(sample, r.filter)) continue;
                        string group = v.threadGroupName ?? "", threadName = v.threadName ?? "";
                        string key = group.Length + ":" + group + threadName.Length + ":" + threadName + sample.callerPath;
                        if (!markers.TryGetValue(key, out var marker))
                        {
                            marker = new MarkerDto { path = sample.callerPath, thread = threadName, threadGroup = group };
                            markers.Add(key, marker);
                        }
                        if (marker.lastFrame != frame) { marker.frames++; marker.lastFrame = frame; marker.frameTotal = 0; }
                        marker.frameTotal += sample.durationMs;
                        marker.totalMs += sample.durationMs; marker.selfMs += sample.selfMs; marker.calls++;
                        marker.gcBytes += sample.gcBytes; marker.childOverlapMs += sample.childOverlapMs;
                        marker.maxMs = Math.Max(marker.maxMs, sample.durationMs);
                        marker.maxFrameMs = Math.Max(marker.maxFrameMs, marker.frameTotal);
                    }
                }
            }
            var ordered = markers.Values.OrderByDescending(m => m.selfMs).ThenBy(m => m.path, StringComparer.Ordinal).ToArray();
            var context = KitProfilerCapture.ContextForRange(first, last);
            return new AnalyzeResult { firstFrame = first, lastFrame = last, frameCount = times.Count, frameStats = Stats(times, r.minMs > 0 ? r.minMs : 16.667),
                threadFilter = r.thread, filter = r.filter, unityVersion = UnityEngine.Application.unityVersion,
                captureContext = context, bookmarks = context == null ? null : KitProfilerCapture.Current.bookmarks.ToArray(),
                offset = r.offset, limit = r.limit, markerTotal = ordered.Length, markersTruncated = r.offset > 0 || r.limit < ordered.Length,
                markers = ordered.Skip(r.offset).Take(r.limit).ToArray(), frameTimes = times.ToArray() };
        }

        static List<SampleDto> ReadSamples(RawFrameDataView v)
        {
            var rows = new List<SampleDto>(v.sampleCount);
            var parents = new Stack<(int index, int end)>();
            for (int i = 0; i < v.sampleCount; i++)
            {
                while (parents.Count > 0 && i > parents.Peek().end) parents.Pop();
                int parent = parents.Count == 0 ? -1 : parents.Peek().index;
                string name = v.GetSampleName(i) ?? "<unnamed>";
                double duration = v.GetSampleTimeMs(i);
                string escaped = name.Replace("\\", "\\\\").Replace("/", "\\/");
                rows.Add(new SampleDto { index = i, parent = parent, depth = parents.Count,
                    name = name, callerPath = parent < 0 ? escaped : rows[parent].callerPath + "/" + escaped,
                    startMs = v.GetSampleStartTimeMs(i), durationMs = duration, selfMs = duration,
                    gcBytes = name == "GC.Alloc" && v.GetSampleMetadataCount(i) > 0 ? v.GetSampleMetadataAsLong(i, 0) : 0 });
                if (parent >= 0) rows[parent].selfMs -= duration;
                int descendants = v.GetSampleChildrenCountRecursive(i);
                if (descendants > 0) parents.Push((i, i + descendants));
            }
            foreach (var row in rows)
            {
                row.childOverlapMs = Math.Max(0, -row.selfMs);
                row.selfMs = Math.Max(0, row.selfMs);
            }
            return rows;
        }

        static bool Matches(SampleDto sample, string filter) => string.IsNullOrEmpty(filter) || sample.callerPath.IndexOf(filter, StringComparison.OrdinalIgnoreCase) >= 0;

        internal static void Range(KitProfiler.Request r, out int first, out int last)
        {
            int availableFirst = ProfilerDriver.firstFrameIndex, availableLast = ProfilerDriver.lastFrameIndex;
            if (availableFirst < 0 || availableLast < availableFirst) throw new InvalidOperationException("Profiler has no retained frames");
            first = r.first < 0 ? availableFirst : r.first;
            last = r.last < 0 ? availableLast : r.last;
            if (first < availableFirst || last > availableLast || first > last)
                throw new ArgumentException("Requested range is unavailable. Retained range: " + availableFirst + ".." + availableLast);
        }

        internal static IEnumerable<int> FrameIndices(int first, int last)
        {
            for (int frame = first; frame >= 0 && frame <= last;)
            {
                yield return frame;
                int next = ProfilerDriver.GetNextFrameIndex(frame);
                if (next <= frame) yield break;
                frame = next;
            }
        }

        static int Resolve(KitProfiler.Request r)
        {
            Range(r, out int first, out int last);
            int frame = r.frame < 0 ? last : r.frame;
            if (frame < first || frame > last) throw new ArgumentException("Requested frame is outside the retained range");
            return frame;
        }

        static void RequireValid(RawFrameDataView v)
        {
            if (!v.valid) throw new ArgumentException("Requested frame/thread data is unavailable");
        }

        internal static StatsDto Stats(List<double> values, double threshold)
        {
            if (values.Count == 0) throw new InvalidOperationException("No valid CPU frame timings in the requested range");
            values.Sort();
            double Percentile(double p) => values[Math.Max(0, (int)Math.Ceiling(values.Count * p) - 1)];
            return new StatsDto { mean = values.Average(), median = Percentile(.5), p95 = Percentile(.95), p99 = Percentile(.99),
                max = values[values.Count - 1], overBudget = threshold, overBudgetCount = values.Count(v => v > threshold) };
        }
    }
}
