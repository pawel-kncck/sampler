# Piano Hands

A 3D pair of hands that plays the piano, drawn like a pencil sketch. The hands work out their own fingering and movements, so they can play any MIDI file an intermediate pianist could play. Für Elise is built in as a demo.

![Pencil-sketch hands playing Für Elise](screenshot.png)

## Run it

It's a static site with no build step (three.js is vendored in `vendor/`):

```bash
cd piano-hands
python3 -m http.server 8000      # or: npm start
# open http://localhost:8000
```

On GitHub Pages it is served at `/piano-hands/`.

### Controls

| | |
|---|---|
| Drag / right-drag / wheel | orbit / pan / zoom (touch: one finger, two fingers, pinch) |
| `Space` | play / pause |
| `← →` | seek ±5 s, `Home` back to start |
| `1`–`5` | camera views: front, pianist, above, side, close |
| `F` / `N` | follow the hands / show finger numbers |
| **Load MIDI…** or drag & drop | play any `.mid` file |

The tempo slider slows the piece down (25–150%) so you can study the fingering.

## How it works

All motion is a deterministic function of score time, so playback can be paused, scrubbed and slowed down.

```
MIDI / built-in score
   │  notes (pitch, start, end, velocity) + sustain pedal
   ▼
hand split ── fingering.js: by staff when there are two tracks, otherwise a
   │          reach-aware split that follows each hand's register
   ▼
fingering ─── fingering.js: dynamic programming (Viterbi) over chord groups,
   │          with the ergonomic cost model of Parncutt et al. (1997) and the
   │          span table measured by Jacobs (2001). It also covers chords, black
   │          keys (thumb/little finger), thumb crossings, held keys, and hand
   │          shifts, which cost more the less time there is
   ▼
motion plan ─ performance.js
   │  wrist: for every onset, the interval of wrist positions that keeps the
   │         current, held and upcoming notes within each finger's lateral
   │         reach ("economy of motion"). Minimum-jerk moves arrive just
   │         before the onset, then a low-pass filter. Roll follows the
   │         active fingers, yaw follows thumb-under / finger-over, the hand
   │         lowers and flattens for wide chords, and the arm-weight dips into
   │         accents
   │  fingers: press (tip rides the moving key surface), approach (a lift and
   │         strike arc that hits the key with speed, higher when crossing over
   │         the thumb), release (follows the key up, relaxes) or rest
   │         (relaxed curl that follows its neighbours, with tendon coupling:
   │         idle fingers sag when a neighbour presses)
   ▼
skeleton ──── hand.js: anatomical bone lengths (≈19 cm hand, 8.5 cm palm).
   │          Each finger is solved analytically: MCP abduction, then MCP/PIP
   │          flexion with DIP coupled to PIP (DIP ≈ 0.7·PIP). The thumb has a
   │          mobile CMC saddle joint. All joints are clamped to anatomical
   │          ranges
   ▼
render ────── piano.js: 88 keys at real dimensions (23.5 mm white key pitch,
              10 mm dip at the front, black keys raised 12.5 mm), pivoting
              like real key levers
              sketch.js: lighting and shadows turned into screen-space
              cross-hatching on paper, with ink outlines
```

The sound comes from a small synthesiser in `audio.js`: inharmonic partials, two detuned strings, a hammer knock, dampers and the sustain pedal. No samples are needed.

### What it can't do

* At most five notes per hand at once. If a chord is wider than a hand can stretch (more than about a 10th), the extra notes still sound but are not fingered.
* MIDI files without a separate staff for each hand get split automatically. That works for most piano music, but crossed-hands passages may come out differently from the score.
* Fingering is computed, not read from the score. It is usually what a teacher would write (scales 1-2-3-1-2-3-4-1, arpeggios 1-2-3-1-2-3-5, Für Elise 5-4-5-4-5), but not always.

## Tests

```bash
npm install   # dev dependency: three (same version as vendor/)
npm test
```

The tests check standard fingerings, that no finger plays a new key while holding another, how closely fingertips stay on the keys (median < 1 mm), MIDI parsing and hand splitting.

## Files

```
index.html, style.css   UI
src/main.js             scene, transport, audio scheduling, camera
src/piano.js            keyboard geometry & layout
src/hand.js             skeleton, meshes, IK
src/fingering.js        hand split + fingering
src/performance.js      motion planning
src/sketch.js           pencil-hatching materials
src/audio.js            piano synthesiser
src/midi.js             Standard MIDI File parser
src/scores.js           Für Elise + technical study
vendor/                 three.js r170 (MIT)
```
