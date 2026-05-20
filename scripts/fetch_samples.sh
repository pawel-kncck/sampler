#!/usr/bin/env bash
# Fetch 11 meme sound samples from YouTube, trim leading silence so they play instantly.
set -uo pipefail

SAMPLES_DIR="$(cd "$(dirname "$0")/.." && pwd)/samples"
RAW_DIR="$SAMPLES_DIR/_raw"
mkdir -p "$SAMPLES_DIR" "$RAW_DIR"

# name|search-query
SOUNDS=(
  "badumtss|ba dum tss rimshot sound effect joke"
  "wah-wah-wah|wah wah wah sad trombone sound effect"
  "oh-no|oh no oh no oh no no no sound effect"
  "5-minutes-later|spongebob 5 minutes later sound effect"
  "school-bell|school bell ring sound effect"
  "woo-yeah-baby|woooo yeah baby flex tape sound effect"
  "disgusting|spongebob disgusting sound effect"
  "bad-to-the-bone|bad to the bone sound effect meme"
  "alert|alert meme sound effect"
  "vine-boom|vine boom sound effect bass drop"
  "crickets|crickets awkward silence sound effect"
)

download_one() {
  local name="$1" query="$2"
  local raw="$RAW_DIR/${name}.mp3"
  local out="$SAMPLES_DIR/${name}.mp3"
  echo ">>> [$name] searching: $query"
  yt-dlp \
    --quiet --no-warnings \
    --no-playlist \
    -x --audio-format mp3 --audio-quality 0 \
    --match-filter "duration < 180" \
    -o "$RAW_DIR/${name}.%(ext)s" \
    "ytsearch1:$query" \
    || { echo "!!! [$name] download FAILED"; return 1; }

  if [[ ! -s "$raw" ]]; then
    echo "!!! [$name] empty file"
    return 1
  fi

  # Strip leading silence (anything below -45dB before first sound).
  ffmpeg -y -loglevel error -i "$raw" \
    -af "silenceremove=start_periods=1:start_duration=0.02:start_threshold=-45dB,aformat=sample_fmts=s16:sample_rates=44100" \
    -c:a libmp3lame -q:a 2 \
    "$out"

  local before after
  before=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$raw" | head -c 6)
  after=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out"  | head -c 6)
  echo "<<< [$name] ok  raw=${before}s trimmed=${after}s"
}

export -f download_one
export SAMPLES_DIR RAW_DIR

# Run in parallel (up to 4 at a time to be gentle with YouTube).
printf '%s\n' "${SOUNDS[@]}" | \
  xargs -P 4 -I {} bash -c '
    pair="{}"
    name="${pair%%|*}"
    query="${pair#*|}"
    download_one "$name" "$query"
  '

echo
echo "=== Done. Files in $SAMPLES_DIR ==="
ls -la "$SAMPLES_DIR"/*.mp3 2>/dev/null || echo "(no files written)"
