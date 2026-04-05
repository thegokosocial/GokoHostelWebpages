#!/usr/bin/env bash
# Regenerate / slow how-to-reach route GIFs.
#
# Steps 1–4 & 6: optional load from git at GIT_REF_FOR_1X (1×-speed sources) so
# re-runs don’t stack slowdown. If unset, uses files already in public/.../route/.
# Step 5: cut from walkthrough MP4 after the step-4 span (see STEP4_VIDEO_START).
#
# PLAYBACK_SPEED: 1 = natural; 0.75 = 25% slower motion (setpts = PTS / speed).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VIDEO="$ROOT/public/videos/how-to-reach/goko-hostel-parking-walkthrough.mp4"
ROUT="$ROOT/public/images/how-to-reach/route"

PLAYBACK_SPEED="${PLAYBACK_SPEED:-0.75}"
# setpts multiplier = 1 / PLAYBACK_SPEED (stretch timeline)
if [[ -n "${SETPTS_FACTOR:-}" ]]; then
  SLOW="$SETPTS_FACTOR"
else
  SLOW="$(awk -v p="$PLAYBACK_SPEED" 'BEGIN{printf "%.10f", 1/p}')"
fi

# MP4 timeline (full speed): step 4 ~STEP4_VIDEO_START; step 5 after ~STEP4_SOURCE_SPAN
STEP4_VIDEO_START="${STEP4_VIDEO_START:-53}"
STEP4_SOURCE_SPAN="${STEP4_SOURCE_SPAN:-3}"
STEP5_START="${STEP5_START:-$((STEP4_VIDEO_START + STEP4_SOURCE_SPAN))}"
CLIP_STEP5_SECONDS="${CLIP_STEP5_SECONDS:-3.5}"

GIT_REF_FOR_1X="${GIT_REF_FOR_1X:-}"

GIF_FILTER="setpts=${SLOW}*PTS,fps=6,scale=300:540:flags=lanczos,split[s0][s1];[s0]palettegen=reserve_transparent=on:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle"

slow_gif() {
  local in="$1" out="$2"
  ffmpeg -y -i "$in" -vf "$GIF_FILTER" -loop 0 "$out"
}

from_video_step5() {
  local ss="$1" out="$2"
  ffmpeg -y -ss "$ss" -t "$CLIP_STEP5_SECONDS" -i "$VIDEO" -an -vf "$GIF_FILTER" -loop 0 "$out"
}

src_gif() {
  local name="$1" out="$2"
  if [[ -n "$GIT_REF_FOR_1X" ]]; then
    git -C "$ROOT" show "${GIT_REF_FOR_1X}:public/images/how-to-reach/route/${name}" > "$out"
  else
    cp "$ROUT/$name" "$out"
  fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

for pair in \
  "01-goko-hostel-parking.gif" \
  "02-cross-the-first-fence.gif" \
  "03-take-a-left.gif" \
  "04-take-a-left-from-here.gif" \
  "06-youve-reached-goko-hostel.gif"; do
  src_gif "$pair" "$TMP/in-$pair"
  slow_gif "$TMP/in-$pair" "$TMP/$pair"
done

from_video_step5 "$STEP5_START" "$TMP/05-keep-walking-straight.gif"

for f in "$TMP"/*.gif; do
  [[ "$(basename "$f")" == in-* ]] && continue
  mv "$f" "$ROUT/$(basename "$f")"
done

echo "Done. PLAYBACK_SPEED=${PLAYBACK_SPEED} (setpts × ${SLOW}). step5 from ${STEP5_START}s (${CLIP_STEP5_SECONDS}s source). Optional: GIT_REF_FOR_1X=<commit> to read 1× GIFs from git."
