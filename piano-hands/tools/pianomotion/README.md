# Checking our wrist paths against real pianists (PianoMotion10M)

[PianoMotion10M](https://github.com/agnJason/PianoMotion10M) has 116 hours of
top-down piano videos with estimated hand poses, audio and MIDI. These scripts
take a small sample, run each video's MIDI through our planner, and compare
where our wrists go with where the pianists' wrists went. The planner was then
recalibrated against that sample and checked on a second one.

No dataset files are stored here. The dataset is for non-commercial use only
(the paper says CC BY-NC 4.0, the Zenodo record says CC BY-NC-ND 4.0), so the
sample is downloaded on demand into `.data/`, which git ignores.

## Run

```bash
pip install numpy scipy soundfile matplotlib
sh tools/pianomotion/run_all.sh                      # from piano-hands/; ~40 MB download
sh tools/pianomotion/run_all.sh /tmp/validation 7    # the validation sample
```

| Script | What it does |
|---|---|
| `fetch_sample.py` | 32 clips (16 videos, 4 pianists, 16 minutes): poses, audio, MIDI. The seed picks the sample |
| `../wrist-path.mjs` | our planner's wrist path for a MIDI file, as JSON |
| `sync.py` | checks the MIDI against the audio (onset cross-correlation) |
| `offsets.py` | per-video timing offset between the pose frames and the MIDI |
| `compare.py` | the main result: correlation, error, spread and travel, with two naive baselines |
| `diagnose.py` | unit check, hand rotation, what-if smoothing |
| `calibrate.py` | how much the wrist follows the notes at slow and fast time scales, peak speed, what drives hand rotation |
| `split_labels.py`, `split_eval.mjs` | scores the hand split against "which real wrist was nearer to this key" |
| `plot.py` | example traces |

## Method

* Only sideways wrist position (along the keyboard) is compared. The camera
  looks straight down, so this is the axis it sees best.
* The keyboard is not located in the dataset. Each hand's position offset is
  therefore fitted on one clip of a video and applied to the other clip of the
  same video. The scale is not fitted: the dataset's units are used as metres.
  The average distance between the two wrists agrees to within 1% (30.2 cm
  real, 29.9 cm ours), so the units are sound.
* Our path is smoothed with the same filter the dataset applied to its poses
  (Savitzky–Golay, order 3, 11 frames).
* Frames where a hand was not detected are ignored; hands visible in fewer than
  90% of a clip's frames are skipped.
* "Follows the notes" is the regression slope of the wrist on the position of
  the hand's latest chord, after splitting both into a slow part (0.5 s
  Gaussian) and the remainder.

## Results

Medians over hand-clips. The tuning sample (default seed, 52 hand-clips) is
the one the planner was recalibrated on; the validation sample (seed 7, 54
hand-clips from 15 other videos) was only looked at afterwards.

| | Tuning: before | Tuning: after | Validation: before | Validation: after | Real pianists |
|---|---|---|---|---|---|
| Correlation with the real wrist | 0.72 | 0.79 | 0.68 | 0.77 | – |
| Error (RMS) | 5.3 cm | 3.4 cm | 4.9 cm | 3.4 cm | – |
| Hand-clips correlating above 0.8 | 40% | 48% | 17% | 41% | – |
| Wrist spread (SD) | 7.2 cm | 4.9 cm | 6.6 cm | 4.7 cm | 5.2–5.3 cm |
| Wrist speed, 95th percentile | 41 cm/s | 20 cm/s | 43 cm/s | 23 cm/s | 22–24 cm/s |
| Wrist travel | 8.6 cm/s | 4.4 cm/s | 8.9 cm/s | 5.1 cm/s | 6.7–6.8 cm/s |
| Follows slow note changes | 0.92 | 0.70 | 0.90 | 0.69 | 0.54–0.60 |
| Follows quick note changes | 0.43 | 0.20 | 0.43 | 0.22 | 0.15–0.18 |
| Hand direction, swing within a clip (SD) | about 1° | about 4° | about 1° | about 4° | 6–9° |
| Right hand's direction, correlation with real | 0.00 | 0.41 | 0.00 | 0.25 | – |
| Hand split agrees with the real hands | 95.3% | 98.2% | 96.0% | 97.3% | – |

"Before" is the planner at commit `efc06f3`. For reference, two naive
baselines on the validation sample (after): wrist at the latest chord, lightly
smoothed, 5.0 cm; the same smoothed over about 1 s, 4.3 cm. Before the
recalibration the second baseline beat our planner.

### What was changed

* **Rest shape of the hand.** The five fingertips now rest over five
  neighbouring white keys, as a pianist's do; before, the relaxed hand was only
  6 cm wide, so the wrist had to shift for notes a real hand simply has under
  its fingers.
* **Wrist path.** For every onset the planner works out from where the notes
  can be reached, then takes the calmest path through those ranges. Reach
  limits are set from what the finger joints can actually do.
* **Hand turn.** The hand follows the forearm. The data shows the right hand
  turning about 9° outward per 10 cm of travel; the left-hand estimates are too
  noisy to confirm the same, so both hands use a slightly lower value. The data
  does not support hands turning to reach individual notes, so that is not
  modelled.
* **Hand split.** Dynamic programming over whole passages instead of a
  note-by-note choice.
* **Pedalled notes.** Transcribed MIDI writes how long a note sounds: 27–70% of
  the notes in these files end exactly when the pedal lifts. Such keys are now
  released when the hand plays again; before, fingers were treated as stuck on
  them for seconds.

### What still differs

* Our wrist now travels less than the real one (about 5 vs 7 cm/s), although
  its spread and peak speed match. Some of the real travel is jitter in the
  pose estimates.
* Hands turn about half as much as real ones.
* The split still gets 2–3% of clear-cut notes wrong, mostly left-hand
  stretches of a tenth and melody notes in the middle register. In one
  validation video it agrees on only 80% of the notes.

## Caveats

* **Timing cannot be calibrated from this data.** The MIDI matches the audio to
  within 10 ms, but the pose frames run 0.1–0.6 s ahead of both, by a different
  constant for each video. That is too early to be anticipation: in fast leaps
  the hand would have to leave before striking the note it is leaving. The
  offset is estimated per video and removed, which also removes any real
  anticipation.
* The samples are small: 16 minutes from 4 pianists each.
* The poses are single-camera estimates, smoothed over about 0.4 s.
* The hand-split labels come from wrist positions aligned with our own planner's
  output, so they are not fully independent of it.
