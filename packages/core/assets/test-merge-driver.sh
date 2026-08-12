#!/bin/sh
# Regression suite for the Unity YAML merge driver (tools/unity-yaml-merge.sh).
# Run after tools/setup-merge-driver.sh. Exits non-zero if any case regresses.
# Each case: build a repo, branch twice, merge, assert on outcome.
W="$(cd "$(dirname "$0")/.." && pwd)/tools/unity-yaml-merge.sh"
W="${UAK_DRIVER:-$W}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/uym-suite-XXXXXX")"
rm -rf "$ROOT"; mkdir -p "$ROOT"
PASS=0; FAIL=0

SCENE='%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &100000
GameObject:
  m_ObjectHideFlags: 0
  m_Name: Alpha
  m_IsActive: 1
--- !u!1 &200000
GameObject:
  m_ObjectHideFlags: 0
  m_Name: Beta
  m_IsActive: 1
'
META='fileFormatVersion: 2
guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
TextureImporter:
  mipmaps:
    mipMapMode: 0
  textureSettings:
    filterMode: 1
  userData:
'

run() { # name file content sedA sedB expect_status
  NAME="$1"; FILE="$2"; CONTENT="$3"; SA="$4"; SB="$5"; EXPECT="$6"
  D="$ROOT/$NAME"; mkdir -p "$D"; cd "$D" || return
  git init -q .; git config user.email t@t.t; git config user.name t
  git config merge.unityyamlmerge.driver "sh '$W' %O %A %B %P"
  printf '*.unity merge=unityyamlmerge\n*.meta merge=unityyamlmerge\n*.prefab merge=unityyamlmerge\n' > .gitattributes
  printf '%s' "$CONTENT" > "$FILE"
  git add -A >/dev/null 2>&1; git commit -qm base >/dev/null 2>&1
  BR=$(git rev-parse --abbrev-ref HEAD)
  git checkout -qb sideA 2>/dev/null; sed -i "$SA" "$FILE"; git commit -qam a >/dev/null 2>&1
  git checkout -q "$BR" 2>/dev/null; git checkout -qb sideB 2>/dev/null; sed -i "$SB" "$FILE"; git commit -qam b >/dev/null 2>&1
  timeout 60 git merge sideA >/dev/null 2>&1
  ST=$(git status --porcelain "$FILE" | cut -c1-2)
  MARK=$(grep -c '<<<<<<<' "$FILE" 2>/dev/null); [ -n "$MARK" ] || MARK=0
  case "$EXPECT" in
    merged) OK=$([ "$ST" != "UU" ] && echo 1 || echo 0) ;;
    conflict) OK=$([ "$ST" = "UU" ] && echo 1 || echo 0) ;;
  esac
  # markers are NEVER acceptable in these files
  [ "$MARK" != "0" ] && OK=0
  if [ "$OK" = "1" ]; then PASS=$((PASS+1)); R="PASS"; else FAIL=$((FAIL+1)); R="FAIL"; fi
  printf '%-42s expect=%-8s status=%-3s markers=%s  %s\n' "$NAME" "$EXPECT" "${ST:-  }" "$MARK" "$R"
}

echo "=== Unity YAML merge driver regression suite ==="
run "scene-disjoint-objects"  Main.unity   "$SCENE" 's/m_Name: Alpha/m_Name: AlphaByA/' 's/m_Name: Beta/m_Name: BetaByB/'   merged
run "scene-same-field-conflict" Main.unity "$SCENE" 's/m_Name: Alpha/m_Name: FromA/'    's/m_Name: Alpha/m_Name: FromB/'    conflict
run "prefab-disjoint-objects" Thing.prefab "$SCENE" 's/m_Name: Alpha/m_Name: AlphaByA/' 's/m_Name: Beta/m_Name: BetaByB/'   merged
run "meta-disjoint-fields"    Tex.png.meta "$META"  's/mipMapMode: 0/mipMapMode: 1/'     's/filterMode: 1/filterMode: 2/'    merged
run "meta-guid-conflict"      Tex.png.meta "$META"  's/guid: a*$/guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/' 's/guid: a*$/guid: cccccccccccccccccccccccccccccccc/' conflict

echo "-----------------------------------------------"
echo "PASS=$PASS  FAIL=$FAIL"
[ "$FAIL" = "0" ] || exit 1
