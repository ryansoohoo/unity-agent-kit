using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace UnityAgentKit.Doctor
{
    public class KitDoctorWindow : EditorWindow
    {
        List<KitRow> rows;
        string error;
        string lastApply;
        Vector2 scroll;

        [MenuItem("Window/Unity Agent Kit")]
        public static void Open()
        {
            var w = GetWindow<KitDoctorWindow>("Agent Kit");
            w.minSize = new Vector2(520, 300);
            w.Refresh();
        }

        void Refresh()
        {
            rows = KitDoctor.RunDoctor();
            error = KitDoctor.LastError;
            Repaint();
        }

        static Color StatusColor(string s) =>
            s == "pass" ? new Color(0.35f, 0.8f, 0.35f) :
            s == "fail" ? new Color(0.9f, 0.35f, 0.35f) :
            s == "warn" ? new Color(0.9f, 0.7f, 0.2f) : Color.gray;

        void OnGUI()
        {
            if (GUILayout.Button("Run doctor", GUILayout.Height(24))) Refresh();
            if (!string.IsNullOrEmpty(error)) { EditorGUILayout.HelpBox(error, MessageType.Error); return; }
            if (rows == null) { EditorGUILayout.HelpBox("Run doctor to inspect this project.", MessageType.Info); return; }

            scroll = EditorGUILayout.BeginScrollView(scroll);
            foreach (var r in rows)
            {
                EditorGUILayout.BeginHorizontal("box");
                var prev = GUI.color;
                GUI.color = StatusColor(r.status);
                GUILayout.Label(r.status.ToUpperInvariant(), EditorStyles.boldLabel, GUILayout.Width(46));
                GUI.color = prev;
                EditorGUILayout.BeginVertical();
                GUILayout.Label(r.title, EditorStyles.boldLabel);
                GUILayout.Label(r.evidence, EditorStyles.wordWrappedMiniLabel);
                EditorGUILayout.EndVertical();
                if (r.status == "fail" && r.canApply && GUILayout.Button("Fix…", GUILayout.Width(48)))
                {
                    // Per-check consent lives HERE; the CLI below runs non-interactive.
                    if (EditorUtility.DisplayDialog("Unity Agent Kit — " + r.id, r.explain + "\n\nApply this fix?", "Apply", "Cancel"))
                    {
                        lastApply = KitDoctor.ApplyOne(r.id);
                        rows = KitDoctor.RunDoctor();
                        error = KitDoctor.LastError;
                    }
                }
                EditorGUILayout.EndHorizontal();
            }
            EditorGUILayout.EndScrollView();
            if (!string.IsNullOrEmpty(lastApply)) EditorGUILayout.HelpBox(lastApply, MessageType.Info);
        }
    }
}
