using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace UnityAgentKit.Doctor
{
    // Headless proof for dogfood/CI:
    //   Unity.exe -batchmode -nographics -projectPath <proj>
    //     -executeMethod UnityAgentKit.Doctor.KitDoctorBatchProof.Run -logFile <log>
    // Exit codes: 0 = doctor ran, no fails · 1 = doctor ran, fails present · 2 = doctor did not run.
    public static class KitDoctorBatchProof
    {
        public static void Run()
        {
            List<KitRow> rows;
            try { rows = KitDoctor.RunDoctor(); }
            catch (System.Exception e)
            {
                Debug.LogError("[unity-agent-kit] doctor did not run: " + e);
                EditorApplication.Exit(2);
                return;
            }
            if (rows == null)
            {
                Debug.LogError("[unity-agent-kit] doctor did not run: " + KitDoctor.LastError);
                EditorApplication.Exit(2);
                return;
            }
            foreach (var r in rows)
                Debug.Log("[unity-agent-kit] " + r.status.PadRight(4) + " " + r.id + " — " + r.evidence);
            EditorApplication.Exit(rows.Any(r => r.status == "fail") ? 1 : 0);
        }
    }
}
