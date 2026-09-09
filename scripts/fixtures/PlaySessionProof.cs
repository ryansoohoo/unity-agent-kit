using System;
using UnityEditor;
using UnityEngine;

// Copy into a proof project's Assets/Editor. These callbacks exercise real Play
// frames, boolean failure, exceptions and cleanup across Unity's domain reloads.
public static class PlaySessionProof
{
    public static string Setup()
    {
        SessionState.SetInt("uak.proof.play.frames", 0);
        SessionState.SetBool("uak.proof.play.teardown", false);
        Time.timeScale = 0.75f;
        return "setup-in-play=" + Application.isPlaying;
    }

    public static void Step(int frame)
    {
        if (!Application.isPlaying) throw new InvalidOperationException("Step ran outside Play.");
        SessionState.SetInt("uak.proof.play.frames", frame + 1);
    }

    public static bool Check() => Application.isPlaying && SessionState.GetInt("uak.proof.play.frames", 0) >= 2;
    public static bool Fail() => false;
    public static bool Throw() => throw new InvalidOperationException("intentional Play proof failure");

    public static string Teardown()
    {
        SessionState.SetBool("uak.proof.play.teardown", true);
        return "teardown-ran";
    }

    public static string Evidence() => "frames=" + SessionState.GetInt("uak.proof.play.frames", 0)
        + ";teardown=" + SessionState.GetBool("uak.proof.play.teardown", false)
        + ";play=" + Application.isPlaying + ";timeScale=" + Time.timeScale;
}
