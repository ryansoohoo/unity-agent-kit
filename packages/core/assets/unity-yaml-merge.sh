#!/bin/sh
# Git merge driver for Unity YAML assets (scenes, prefabs, materials, .meta, ...).
#
# Two non-obvious problems this wrapper solves. Both make the naive one-line
# driver config that circulates online silently drop the incoming side's edits:
#
#   1. UnityYAMLMerge dispatches on FILE EXTENSION. Git hands merge drivers
#      temp files named like "merge_file_ReZ03G" with no extension at all, so
#      the tool refuses with "Don't know how to merge ... files" and git falls
#      back to a plain text merge of YAML. We copy the inputs to temp files
#      carrying the real extension, taken from %P.
#
#   2. Git's %A is BOTH the "ours" input and the required output path. Handing
#      the tool "%A %A" makes it truncate the file it is still reading. We keep
#      inputs and output distinct and only copy the result over %A on success.
#
# --fallback none is deliberate: the default fallback launches an interactive
# GUI merge tool, which blocks forever under an agent or in CI (verified: it
# hung a test merge until it was killed). With it off, an unresolvable file is
# left as valid YAML and git marks the path conflicted (UU), so nothing is
# committed silently. Resolve those with `git mergetool` or by hand.
#
# Configured by tools/setup-merge-driver.sh as:
#   git config merge.unityyamlmerge.driver "sh '<abs path>' %O %A %B %P"
#
# Override the editor after a Unity upgrade, or if auto-discovery below picks
# the wrong install:
#   UNITY_YAML_MERGE=/path/to/UnityYAMLMerge.exe

set -u

# Locate UnityYAMLMerge.exe across installed Unity Hub editors, newest first.
# Multiple Unity 6.x patch releases can be installed side by side (Hub default
# layout is Editor/<version>/Editor/Data/Tools/UnityYAMLMerge.exe); hardcoding
# one version silently no-ops the moment a project upgrades. We glob both the
# MSYS-mount form ("/c/Program Files/...") and the Windows-drive form
# ("C:/Program Files/...") of the same Hub install root, since this script is
# invoked by git via different shells that can hand paths either way.
#
# Unmatched globs (no Hub install present) expand to the literal pattern
# string under plain sh, so every candidate is existence-checked before use.
find_unity_yaml_merge() {
  hub_root="${UNITY_HUB_EDITOR_ROOT:-}"
  if [ -n "$hub_root" ]; then
    set -- "$hub_root"/*/Editor/Data/Tools/UnityYAMLMerge.exe
  else
    set -- "/c/Program Files/Unity/Hub/Editor/"*/Editor/Data/Tools/UnityYAMLMerge.exe \
           "C:/Program Files/Unity/Hub/Editor/"*/Editor/Data/Tools/UnityYAMLMerge.exe
  fi

  found=""
  for candidate in "$@"; do
    [ -f "$candidate" ] && found="${found}${candidate}
"
  done
  [ -n "$found" ] || return 1

  # Version-sort descending (6000.10.x above 6000.5.x above 6000.2.x) so the
  # newest installed editor wins; take the first match.
  printf '%s' "$found" | sort -rV | head -n1
}

if [ "$#" -lt 4 ]; then
  echo "usage: unity-yaml-merge.sh <base %O> <ours %A> <theirs %B> <pathname %P>" >&2
  echo "  (invoked by git as a merge driver; not meant to be run by hand)" >&2
  exit 2
fi

BASE="$1"   # %O - common ancestor
OURS="$2"   # %A - our version on input; result must end up here
THEIRS="$3" # %B - their version
PATHNAME="$4" # %P - real repo path, e.g. Assets/Scenes/Outdoors.unity

UYM="${UNITY_YAML_MERGE:-}"
if [ -z "$UYM" ]; then
  UYM="$(find_unity_yaml_merge)" || UYM=""
fi

if [ -z "$UYM" ] || [ ! -f "$UYM" ]; then
  echo "unity-yaml-merge: UnityYAMLMerge not found (searched installed Unity Hub editors)." >&2
  echo "unity-yaml-merge: set UNITY_YAML_MERGE to override. Leaving '$PATHNAME' conflicted." >&2
  exit 1
fi

# Recover the extension UnityYAMLMerge needs in order to pick its ruleset.
# "Assets/Scenes/Outdoors.unity" -> "unity";  "Thing.mat.meta" -> "meta"
EXT="${PATHNAME##*.}"
case "$EXT" in
  "$PATHNAME"|"") EXT="asset" ;;   # no dot in the name; give the tool something known
esac

WORK="$(mktemp -d "${TMPDIR:-/tmp}/uym-XXXXXX")" || exit 1
B="$WORK/base.$EXT"
L="$WORK/theirs.$EXT"
R="$WORK/ours.$EXT"
O="$WORK/merged.$EXT"

cleanup() { rm -rf -- "$WORK"; }
trap cleanup EXIT HUP INT TERM

cp -- "$BASE" "$B"   || exit 1
cp -- "$THEIRS" "$L" || exit 1
cp -- "$OURS" "$R"   || exit 1

if [ "$EXT" = "meta" ]; then
  # .meta files are flat YAML with no "--- !u!" documents, so UnityYAMLMerge
  # rejects them outright ("File is not a valid text serialized YAML file").
  # Routing them to it would conflict on EVERY difference, including disjoint
  # importer-setting edits that merge fine as text.
  #
  # So: do a normal 3-way text merge, but never let conflict markers reach the
  # file. Markers inside a "guid:" line are the dangerous case - Unity treats
  # such a .meta as corrupt and may regenerate the GUID, silently repointing
  # every reference to that asset. On any conflict we leave %A untouched and
  # let git mark it UU instead.
  git merge-file -q -p "$R" "$B" "$L" > "$O" 2>/dev/null
  rc=$?
  if [ "$rc" -eq 0 ]; then
    cp -- "$O" "$OURS" || exit 1
  fi
  exit $rc
fi

# UnityYAMLMerge merge <base> <left/theirs> <right/ours> <dest>
"$UYM" merge -h --fallback none "$B" "$L" "$R" "$O"
rc=$?

# Only overwrite the working file when the tool fully resolved the merge.
# On conflict we leave %A untouched (still "ours") and let git mark it UU,
# which keeps the file valid YAML instead of injecting conflict markers into
# a guid: line.
if [ "$rc" -eq 0 ] && [ -f "$O" ]; then
  cp -- "$O" "$OURS" || exit 1
fi

exit $rc
