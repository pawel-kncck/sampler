# Checking our wrist paths against real pianists (PianoMotion10M)

[PianoMotion10M](https://github.com/agnJason/PianoMotion10M) has 116 hours of
top-down piano videos with estimated hand poses, audio and MIDI. These scripts
take a small sample, run each video's MIDI through our planner, and compare
where our wrists go with where the pianists' wrists went.

No dataset files are stored here. The dataset is for non-commercial use only
(the paper says CC BY-NC 4.0, the Zenodo record says CC BY-NC-ND 4.0), so the
sample is downloaded on demand into `.data/`, which git ignores.

## Run

```bash
pip install numpy scipy soundfile matplotlib
sh tools/pianomotion/run_all.sh          # from piano-hands/; ~40 MB download
```

| Script | What it does |
|---|---|
| `fetch_sample.py` | 32 clips (16 videos, 4 pianists, 16 minutes): poses, audio, MIDI. Fixed seed |
| `../wrist-path.mjs` | our planner's wrist path for a MIDI file, as JSON |
| `sync.py` | checks the MIDI against the audio (onset cross-correlation) |
| `offsets.py` | per-video timing offset between the pose frames and the MIDI |
| `compare.py` | the main result: correlation, error, spread and travel, with two naive baselines |
| `diagnose.py` | unit check, hand rotation, what-if smoothing, hand-split agreement |
| `plot.py` | example traces |

## Method

* Only sideways wrist position (along the keyboard) is compared. The camera
  looks straight down, so this is the axis it sees best.
* The keyboard is not located in the dataset. Each hand's position offset is
  therefore fitted on one clip of a video and applied to the other clip of the
  same video. The scale is not fitted: the dataset's units are used as metres.
  The average distance between the two wrists agrees to within 1% (30.2 cm
  real, 29.8 cm ours), so the units are sound.
* Our path is smoothed with the same filter the dataset applied to its poses
  (Savitzky–Golay, order 3, 11 frames).
* Frames where a hand was not detected are ignored; hands visible in fewer than
  90% of a clip's frames are skipped.

## Results (planner as of the commit that added this folder)

Medians over 52 hand-clips:

| | Correlation | Error (RMS) | Spread (SD) | Travel |
|---|---|---|---|---|
| Real pianists | – | – | 5.2 cm | 6.7 cm/s |
| Our planner | 0.72 | 5.3 cm | 7.2 cm | 8.6 cm/s |
| Baseline: latest chord's position, lightly smoothed | 0.71 | 5.6 cm | 7.8 cm | 12.2 cm/s |
| Baseline: the same, smoothed over ~1 s | 0.69 | 4.6 cm | 5.8 cm | 4.2 cm/s |

* 40% of hand-clips correlate above 0.8, 63% above 0.6 and 12% below 0.3.
* **Our wrists move too much.** Real wrists follow slow changes of register
  fully but make only about half of the quick note-to-note excursions ours do.
  Halving our fast excursions in post-processing cuts the shape error from
  4.6 to 3.5 cm and brings the spread to 5.3 cm.
* **Real hands turn; ours barely do.** Within a clip the real hand's direction
  swings by about 7–9° (SD); ours by about 1°. The real right hand turns about
  7° outward for every 10 cm it moves to the right.
* **The worst matches are hand-split errors.** Our split agrees with "nearest
  real wrist" for 97% of clear-cut notes in the median clip, but only 86–90% in
  the clips that match worst.

## Caveats

* **Timing cannot be calibrated from this data.** The MIDI matches the audio to
  within 10 ms, but the pose frames run 0.1–0.6 s ahead of both, by a different
  constant for each video. That is too early to be anticipation: in fast leaps
  the hand would have to leave before striking the note it is leaving. The
  offset is estimated per video and removed, which also removes any real
  anticipation.
* 16 minutes from 4 pianists is a small sample.
* The poses are single-camera estimates, smoothed over about 0.4 s.
