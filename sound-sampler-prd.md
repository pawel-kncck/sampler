# PRD — Web Sound Sampler (v1)

## 1. Summary

A single-page web app that imitates a hardware sound sampler. It displays a fixed grid of **12 pads**, each with a pre-configured key binding and a pre-loaded sound. A user triggers a sound by **clicking a pad** or **pressing its bound key**. The **space bar** acts as a global transport: pause all currently-playing audio, press again to resume.

This is a deliberately minimal v1: bindings and sounds are configured by the developer (the user of this PRD), not editable in the UI.

## 2. Goals & Non-Goals

**Goals**
- Trigger pre-loaded sounds via keyboard or click with no perceptible latency.
- Zero configuration for the end user — open the page, it works.
- Static hosting only (no app server, no database). Sounds served from S3/CDN.
- Clear visual feedback when a pad is triggered.

**Non-Goals (explicitly out of scope for v1)**
- User-editable key bindings or sound assignment.
- Recording, sequencing, looping, BPM, or tempo sync.
- Volume/pan/pitch controls per pad.
- Uploading sounds from the browser.
- Mobile/touch optimization (works if it works, but desktop is the target).
- Authentication or per-user state.

## 3. Users & Primary Use Case

A single user lands on the page and immediately starts triggering sounds — for demos, beat-making sketches, or as an embeddable toy. No onboarding, no settings.

## 4. User Stories

- As a user, I see 12 labelled pads so I know what's available before I touch anything.
- As a user, I press a bound key and the corresponding sound plays instantly.
- As a user, I click a pad and the same sound plays.
- As a user, I press space to pause everything, and space again to resume from where it paused.
- As a user, I get a visual "flash" on the pad when its sound fires, so triggering feels responsive.

## 5. Functional Requirements

### 5.1 Pad Grid
- Render exactly **12 pads** in a **3 columns × 4 rows** grid (or 4×3 — a layout constant, not user-facing).
- Each pad displays: a **label** (sound name) and its **bound key** (e.g. `A`, `S`, `1`).
- Pads are visually uniform; the only differentiator is the label/key text.

### 5.2 Triggering
- **Click**: clicking a pad triggers its sound.
- **Keyboard**: pressing a pad's bound key triggers its sound. Key matching is case-insensitive and ignores modifier keys.
- A trigger **always restarts the sound from the beginning** (standard sampler "retrigger" behavior), even if that sound is already playing.
- **Polyphony**: multiple different pads can play simultaneously and overlap. (See §8 — open decision.)
- On every trigger, the pad shows a brief active state (e.g. ~120ms highlight/scale) for feedback.

### 5.3 Transport (Space Bar)
- Space bar toggles a global **paused / playing** state.
- On **pause**: all currently-playing voices freeze in place (not stopped — position is retained).
- On **resume**: all paused voices continue from their paused position.
- New triggers while paused: **ignored** (do not start, do not queue). This keeps "pause" meaning pause. (Flag in §8 if a different behavior is wanted.)
- Space must not also scroll the page or activate a focused pad — default behavior is suppressed.

### 5.4 Loading & Config
- A single static **config object** (JSON or inline JS) defines all 12 pads:
  ```json
  [
    { "id": "pad-1", "label": "Kick",  "key": "a", "url": "https://cdn.example.com/kick.mp3" },
    { "id": "pad-2", "label": "Snare", "key": "s", "url": "https://cdn.example.com/snare.mp3" }
    // ... 12 total
  ]
  ```
- Sounds are **pre-fetched and decoded on page load** so the first trigger has no network/decode delay.
- A lightweight loading indicator is shown until all 12 are decoded; pads are non-interactive until ready.
- If a sound fails to load, that pad renders in a disabled/error state; the rest still work.

## 6. Technical Approach

- **Stack**: plain HTML + CSS + vanilla JS. No framework required (a single `index.html` is sufficient and ideal for static hosting).
- **Audio**: **Web Audio API** (`AudioContext` + `AudioBufferSourceNode`).
  - Fetch each URL → `decodeAudioData` once at load → store the `AudioBuffer`.
  - Trigger = create a fresh `AudioBufferSourceNode` from the cached buffer and `start()`. (Buffers are reusable; source nodes are one-shot.)
  - **Pause/resume**: `audioContext.suspend()` / `audioContext.resume()` — this freezes/continues the entire audio graph in one call, which exactly matches the "pause everything" requirement and avoids per-voice bookkeeping.
- **Autoplay policy**: browsers block audio until a user gesture. The first user click/keypress should call `audioContext.resume()` to unlock the context. A "click to start" overlay is the safest pattern.
- **Hosting**:
  - Static site (S3 + CloudFront, Netlify, GitHub Pages, or self-hosted behind Caddy — any will do).
  - Audio files on S3 (or any CDN). **CORS must be configured** on the bucket to allow `GET` from the site's origin, otherwise `fetch`/`decodeAudioData` will fail.
  - Prefer a CDN in front of S3 for latency and to cache decoded-friendly formats.
- **Audio format**: MP3 or AAC for broad support and small size; WAV acceptable for very short one-shots if size is not a concern.

## 7. Non-Functional Requirements

- **Latency**: trigger-to-sound < ~30ms after load (achievable because buffers are pre-decoded).
- **Footprint**: target total page weight (excluding audio) under ~50KB; no build step required.
- **Browser support**: latest Chrome, Firefox, Safari, Edge (desktop).
- **Resilience**: one failed/missing sound never breaks the rest of the grid.
- **Accessibility (light touch for v1)**: pads are focusable buttons with visible focus rings and `aria-label`s; keyboard binding is supplementary to native button activation.

## 8. Open Decision (lock before build)

**What does the space bar pause, and how do new triggers behave while paused?**

Recommended default (assumed in this PRD):
- Space suspends the **entire** audio context → all playing voices freeze.
- Triggers while paused are **ignored**.

Alternatives worth a moment's thought:
- Space pauses only the **last-triggered** voice (more "transport for the current take" feeling, but ambiguous with overlapping pads).
- Triggers while paused **auto-resume** the transport then play (treats space purely as a stop, not a pause).

The `suspend()`/`resume()` approach makes the recommended default essentially free to implement; the alternatives require manual per-voice position tracking and are more work. Recommend shipping the default in v1.

## 9. Milestones

1. **Scaffold** — single `index.html`, 3×4 grid, config object, styling. (≈ half day)
2. **Audio core** — load + decode all buffers, click trigger, retrigger behavior, unlock-on-gesture overlay. (≈ half day)
3. **Keyboard + transport** — key bindings, space pause/resume via context suspend/resume, suppress default space behavior. (≈ half day)
4. **Polish** — loading state, per-pad error state, trigger flash animation, focus styles. (≈ half day)
5. **Deploy** — upload sounds to S3, set CORS, publish static site, verify cross-browser. (≈ half day)

Realistic total for a working v1: **~1–2 focused days**.

## 10. Acceptance Criteria

- [ ] 12 pads render with correct labels and key hints.
- [ ] Clicking any pad plays its sound; pressing its bound key plays the same sound.
- [ ] Retriggering a playing pad restarts it from the beginning.
- [ ] Two different pads can sound at the same time without one cutting the other off.
- [ ] Space pauses all audio; space again resumes from the same position.
- [ ] Page is usable only after all sounds are decoded; a failed sound disables only its own pad.
- [ ] Works from a static host with sounds served cross-origin from S3/CDN with no console CORS errors.
