#!/bin/sh
# Fetch the sample, run our planner on each video's MIDI, and compare wrist paths.
#   sh run_all.sh [data_dir] [seed]   (needs: node, python3 with numpy scipy soundfile matplotlib)
# The default seed gives the sample the planner was tuned on; seed 7 gives the validation sample.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
DIR=${1:-$HERE/.data}
python3 "$HERE/fetch_sample.py" "$DIR" 4 "${2:-20241111}"
mkdir -p "$DIR/ours"
for v in $(awk -F/ '{print $2"/"$3}' "$DIR/sample_list.txt" | sort -u); do
  node "$HERE/../wrist-path.mjs" "$DIR/data/midi/$v.mid" "$DIR/ours/$(basename "$v").json" 30
done
python3 "$HERE/sync.py" "$DIR"       # is the MIDI in sync with the audio?
python3 "$HERE/offsets.py" "$DIR"    # per-video offset between pose frames and MIDI
python3 "$HERE/compare.py" "$DIR"    # the main result
python3 "$HERE/diagnose.py" "$DIR"   # units, hand rotation, what-ifs, hand split
python3 "$HERE/calibrate.py" "$DIR"  # how much the wrist follows the notes; speed; rotation
python3 "$HERE/split_labels.py" "$DIR" && node "$HERE/split_eval.mjs" "$DIR"   # hand split vs. the real hands
python3 "$HERE/plot.py" "$DIR" "$DIR/wrist-match.png"
