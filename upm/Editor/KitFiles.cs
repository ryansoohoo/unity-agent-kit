using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using UnityEngine;

namespace UnityAgentKit.Doctor
{
    // Publish complete metadata in one rename. Windows Mono's File.Replace can
    // fail while replacing an existing file; use the native replacement operation.
    internal static class KitFiles
    {
        const int ReplaceExisting = 1, WriteThrough = 8, RetryBudgetMs = 300;
        static readonly Encoding Utf8 = new UTF8Encoding(false);

        [DllImport("kernel32.dll", EntryPoint = "MoveFileExW", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        static extern bool MoveFileEx(string existing, string replacement, int flags);

        internal static void WriteJson(string path, object value, bool pretty = false) => WriteTextAtomic(path, JsonUtility.ToJson(value, pretty));

        internal static void WriteTextAtomic(string path, string text)
        {
            path = Path.GetFullPath(path);
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            string temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                using (var file = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.Read))
                {
                    byte[] bytes = Utf8.GetBytes(text);
                    file.Write(bytes, 0, bytes.Length);
                    file.Flush(true);
                }
                var watch = Stopwatch.StartNew();
                for (;;)
                {
                    if (Environment.OSVersion.Platform == PlatformID.Win32NT)
                    {
                        if (MoveFileEx(WindowsPath(temp), WindowsPath(path), ReplaceExisting | WriteThrough)) return;
                        int error = Marshal.GetLastWin32Error();
                        if (!SharingError(error) || watch.ElapsedMilliseconds >= RetryBudgetMs)
                            throw new IOException("Cannot atomically publish '" + path + "' (Win32 " + error + "): " + new Win32Exception(error).Message);
                    }
                    else
                    {
                        try
                        {
                            if (File.Exists(path)) File.Replace(temp, path, null);
                            else File.Move(temp, path);
                            return;
                        }
                        catch (IOException e)
                        {
                            if (!SharingError(e.HResult & 0xffff) || watch.ElapsedMilliseconds >= RetryBudgetMs)
                                throw new IOException("Cannot atomically publish '" + path + "': " + e.Message, e);
                        }
                    }
                    int remaining = RetryBudgetMs - (int)watch.ElapsedMilliseconds;
                    if (remaining > 0) Thread.Sleep(Math.Min(10, remaining));
                }
            }
            catch (Exception e) when (!(e is IOException && e.Message.Contains(path)))
            {
                throw new IOException("Cannot write metadata '" + path + "': " + e.Message, e);
            }
            finally
            {
                // A failed publication retains the old destination. Only our own
                // unpublished temporary file is eligible for cleanup.
                try { if (File.Exists(temp)) File.Delete(temp); } catch { }
            }
        }

        static bool SharingError(int error) => error == 5 || error == 32 || error == 33 || error == 1224;

        static string WindowsPath(string path) => path.StartsWith(@"\\?\", StringComparison.Ordinal) ? path
            : path.StartsWith(@"\\", StringComparison.Ordinal) ? @"\\?\UNC\" + path.Substring(2) : @"\\?\" + path;
    }
}
