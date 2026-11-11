// Automatic fingering and hand assignment.
//
// Fingering is found with dynamic programming (Viterbi) over chord groups.
// The cost model follows the ergonomic rules of Parncutt et al. (1997),
// "An ergonomic model of keyboard fingering for melodic fragments",
// extended to chords, black keys, held notes and timing.
import { isBlack } from './piano.js';

// Finger indices: 0 = thumb … 4 = little finger.
// Span table (semitones) for finger pairs (lower index first), right hand:
// [MinPrac, MinComf, MinRel, MaxRel, MaxComf, MaxPrac]
// Values from Jacobs (2001), "Refinements to the ergonomic model for keyboard
// fingering of Parncutt, Sloboda, Clarke, Raekallio and Desain", which revised
// the original table using measured hand spans.
const SPAN = {
  '0-1': [-8, -6, 1, 5, 9, 10],
  '0-2': [-7, -5, 3, 9, 13, 15],
  '0-3': [-5, -3, 5, 11, 14, 16],
  '0-4': [-2, 0, 7, 12, 15, 17],
  '1-2': [1, 1, 1, 2, 5, 6],
  '1-3': [1, 1, 3, 4, 6, 8],
  '1-4': [2, 2, 5, 6, 10, 12],
  '2-3': [1, 1, 1, 2, 2, 4],
  '2-4': [1, 1, 3, 4, 6, 8],
  '3-4': [1, 1, 1, 2, 4, 6],
};
// natural offset of each finger from the thumb, in semitones (for hand position estimates)
const FINGER_OFFSET = [0, 2, 4, 5.5, 7];

const CHORD_EPS = 0.035;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v); // notes starting within this window form a chord

export function groupByOnset(notes, eps = CHORD_EPS) {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const groups = [];
  for (const n of sorted) {
    const g = groups[groups.length - 1];
    if (g && n.start - g.t < eps) g.notes.push(n);
    else groups.push({ t: n.start, notes: [n] });
  }
  for (const g of groups) g.notes.sort((a, b) => a.pitch - b.pitch);
  return groups;
}

/** Cost of using fingers fa, fb on pitches pa, pb (side +1 right, -1 left). */
function pairCost(fa, pa, fb, pb, side, chord) {
  if (fa > fb) { [fa, fb] = [fb, fa]; [pa, pb] = [pb, pa]; }
  const d = (pb - pa) * side;
  const [minP, minC, minR, maxR, maxC, maxP] = SPAN[fa + '-' + fb];
  let c = 0;
  if (d > maxC) c += 2 * (d - maxC);
  if (d < minC) c += 2 * (minC - d);
  if (d > maxP) c += 10 * (d - maxP);
  if (d < minP) c += 10 * (minP - d);
  if (!chord) {
    if (d < minR && !(fa === 0 && d < 0)) c += (fa === 0 ? 2 : 1) * (minR - Math.max(d, 0)) * 0.5;
    if (d > maxR) c += d - maxR;
  } else {
    if (d > maxR) c += 0.5 * (d - maxR);
  }
  if (fa === 0 && d < 0) {
    // passing the thumb under / a finger over the thumb
    c += 2.5 + 0.3 * -d + (d <= -3 ? 1 : 0) + (d <= -4 && fb === 1 ? 1.5 : 0); // each crossing is a hand position change
    if (fb === 3) c += 0.8; // ring finger crossing: fine, slightly less natural
    if (fb === 4) c += 6;
    const tb = isBlack(pa), ob = isBlack(pb);
    if (tb && !ob) c += 3; // thumb on black, finger on white: awkward cross
    if (!tb && ob) c -= 0.5; // crossing onto a black key is the comfortable case
  }
  return c;
}

/** Is the pair outside the practical span (e.g. fingers in the wrong order)? */
function impractical(fa, pa, fb, pb, side) {
  if (fa > fb) { [fa, fb] = [fb, fa]; [pa, pb] = [pb, pa]; }
  const d = (pb - pa) * side;
  const t = SPAN[fa + '-' + fb];
  return d < t[0] || d > t[5];
}

function stateCost(fingers, pitches, side) {
  let c = 0;
  // wide chords want the outer fingers (an average hand spans about a 9th)
  if (pitches.length > 1) {
    const span = pitches.at(-1) - pitches[0];
    const outer = side > 0 ? fingers.at(-1) : fingers[0];
    const inner = side > 0 ? fingers[0] : fingers.at(-1);
    if (span >= 10 && outer !== 4) c += 3;
    if (span >= 10 && inner !== 0) c += 2;
  }
  for (let i = 0; i < fingers.length; i++) {
    const f = fingers[i], p = pitches[i], b = isBlack(p);
    if (b && f === 0) c += pitches.length > 1 ? 1.5 : 2.2;
    if (b && f === 4) c += 0.8;
    if (f === 3) c += 0.25;
    if (f === 4) c += 0.1;
    for (let j = i + 1; j < fingers.length; j++) c += pairCost(f, p, fingers[j], pitches[j], side, true);
  }
  return c;
}

function handCenter(fingers, pitches, side) {
  let s = 0;
  for (let i = 0; i < fingers.length; i++) s += pitches[i] - side * FINGER_OFFSET[fingers[i]];
  return s / fingers.length;
}

function combos(k) {
  const out = [];
  const rec = (start, cur) => {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (let f = start; f < 5; f++) { cur.push(f); rec(f + 1, cur); cur.pop(); }
  };
  rec(0, []);
  return out;
}
const COMBOS = [null, combos(1), combos(2), combos(3), combos(4), combos(5)];

/**
 * Assign fingers (0..4) to the notes of one hand. Mutates note.finger.
 * side: +1 right hand, -1 left hand.
 */
export function assignFingers(notes, side) {
  const groups = groupByOnset(notes);
  if (!groups.length) return;
  // A hand has five fingers – extra notes in a cluster are left unfingered
  for (const g of groups) {
    if (g.notes.length > 5) {
      const keep = [g.notes[0], g.notes[1], g.notes[Math.floor(g.notes.length / 2)], g.notes.at(-2), g.notes.at(-1)];
      for (const n of g.notes) if (!keep.includes(n)) n.finger = null;
      g.notes = keep;
    }
  }

  // states for each group: fingers listed in ascending pitch order
  const layers = groups.map((g) => {
    const pitches = g.notes.map((n) => n.pitch);
    const k = pitches.length;
    return COMBOS[k].map((combo) => {
      const fingers = side > 0 ? combo : combo.slice().reverse();
      return {
        fingers,
        pitches,
        local: stateCost(fingers, pitches, side),
        center: handCenter(fingers, pitches, side),
        cost: Infinity,
        back: -1,
      };
    });
  });

  for (const s of layers[0]) s.cost = s.local;
  for (let gi = 1; gi < groups.length; gi++) {
    const g = groups[gi], pg = groups[gi - 1];
    const gap = g.t - pg.t;
    const tf = gap < 0.22 ? 1 : Math.max(0.15, 1 - (gap - 0.22) * 0.9);
    for (const s of layers[gi]) {
      let best = Infinity, bi = -1;
      for (let pi = 0; pi < layers[gi - 1].length; pi++) {
        const ps = layers[gi - 1][pi];
        if (ps.cost === Infinity) continue;
        let tc = 0, cnt = 0, hard = 0;
        // Moving the whole hand is always an alternative to stretching;
        // it is cheap when there is time and expensive in fast passages.
        const shift = 2 + 0.25 * Math.abs(s.center - ps.center) * clamp(0.35 / Math.max(gap, 0.05), 0.3, 4);
        for (let a = 0; a < ps.fingers.length; a++) {
          const pf = ps.fingers[a], pp = ps.pitches[a], pend = pg.notes[a].end;
          const held = pend > g.t + 0.02;
          for (let b = 0; b < s.fingers.length; b++) {
            const f = s.fingers[b], p = s.pitches[b];
            let c;
            if (pf === f) {
              if (pp === p) c = gap < 0.12 ? 1.5 : 0;
              else {
                c = shift + 1.5 + (gap < 0.25 ? 2 : 0);
                if (held) hard += 50; // finger still holding the previous key
              }
            } else if (pp === p) {
              c = gap < 0.12 ? 0 : 1; // finger change on a repeated note
            } else {
              c = pairCost(pf, pp, f, p, side, false) * tf;
              // a hand jump needs time: impossible finger orders stay expensive in fast passages
              if (!held && (gap > 0.32 || !impractical(pf, pp, f, p, side))) c = Math.min(c, shift);
            }
            tc += c; cnt++;
          }
        }
        let cost = tc / cnt + hard;
        // single-note specific rules
        if (ps.fingers.length === 1 && s.fingers.length === 1) {
          const pf = ps.fingers[0], f = s.fingers[0];
          if (pf === 2 && f === 3) cost += 1 * tf;
          if (pf === 3 && f === 2) cost += 0.5 * tf;
          if (pf === 2 && f === 3 && isBlack(s.pitches[0]) && !isBlack(ps.pitches[0])) cost += 1 * tf;
        }
        cost += 0.12 * Math.abs(s.center - ps.center) * tf;
        const total = ps.cost + cost;
        if (total < best) { best = total; bi = pi; }
      }
      s.cost = best + s.local;
      s.back = bi;
    }
  }
  // backtrack
  let last = layers.at(-1);
  let si = 0;
  for (let i = 1; i < last.length; i++) if (last[i].cost < last[si].cost) si = i;
  for (let gi = groups.length - 1; gi >= 0; gi--) {
    const s = layers[gi][si];
    groups[gi].notes.forEach((n, i) => { n.finger = s.fingers[i]; });
    si = s.back;
  }
}

/**
 * Decide which hand plays each note (when the source does not say), then
 * work out when pedal-sustained keys are really released.
 *
 * Two piano staves (two tracks or channels) are taken as the two hands.
 * Otherwise the notes are split by `splitByReach`.
 */
export function assignHands(notes, pedal = []) {
  if (!notes.every((n) => n.hand === 'L' || n.hand === 'R')) {
    // two tracks/channels with notes → treat as two staves
    const keyOf = (n) => `${n.track ?? 0}:${n.channel ?? 0}`;
    const parts = new Map();
    for (const n of notes) {
      if (!parts.has(keyOf(n))) parts.set(keyOf(n), []);
      parts.get(keyOf(n)).push(n);
    }
    let staves = false;
    if (parts.size === 2) {
      const [a, b] = [...parts.values()];
      const avg = (arr) => arr.reduce((s, n) => s + n.pitch, 0) / arr.length;
      const [lo, hi] = avg(a) < avg(b) ? [a, b] : [b, a];
      if (avg(hi) - avg(lo) > 5) {
        lo.forEach((n) => { n.hand = 'L'; });
        hi.forEach((n) => { n.hand = 'R'; });
        fixReach(notes);
        staves = true;
      }
    }
    if (!staves) splitByReach(notes, pedal);
  }
  releaseSustained(notes, pedal);
}

/** Notes whose written end coincides with a pedal release: sustained by the pedal, not the finger. */
function pedalSustained(notes, pedal) {
  const out = new Map();
  if (!pedal.length) return out;
  const ends = pedal.map((p) => p.end).sort((a, b) => a - b);
  const byEnd = pedal.slice().sort((a, b) => a.end - b.end);
  for (const n of notes) {
    let lo = 0, hi = ends.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (ends[m] < n.end - 0.08) lo = m + 1; else hi = m; }
    for (let i = lo; i < ends.length && ends[i] <= n.end + 0.08; i++) {
      if (byEnd[i].start < n.end) { out.set(n, byEnd[i]); break; }
    }
  }
  return out;
}

/**
 * MIDI made by transcribing audio (and some sequenced files) writes how long
 * a note sounds, so a pedalled note "lasts" until the pedal lifts. A finger
 * does not stay on such a key for seconds: it holds until the pedal has
 * caught the note and the hand plays again. Shortens `note.end` to that key
 * release and keeps the written end in `note.sounding`.
 */
function releaseSustained(notes, pedal) {
  const sustained = pedalSustained(notes, pedal);
  if (!sustained.size) return;
  for (const hand of ['L', 'R']) {
    const groups = groupByOnset(notes.filter((n) => n.hand === hand));
    groups.forEach((g, gi) => {
      const next = gi + 1 < groups.length ? groups[gi + 1].t : Infinity;
      for (const n of g.notes) {
        const p = sustained.get(n);
        if (!p) continue;
        const caught = Math.max(n.start + 0.1, p.start + 0.04); // hold at least until the pedal is down
        const release = Math.min(n.end, Math.max(next + 0.02, caught));
        if (release < n.end) { n.sounding = n.end; n.end = release; }
      }
    });
  }
}

/**
 * Split a single stream of notes between the hands.
 *
 * Dynamic programming over chord groups: every group can be cut at any point
 * of its pitch order (lower notes left, higher notes right). A cut costs
 * what it asks of each hand: stretching beyond an octave, travelling (the
 * further and the faster, the worse), crossing the other hand, or playing far
 * outside its usual register. Because whole paths are compared, a hand is
 * not sent somewhere it cannot get back from in time.
 */
function splitByReach(notes, pedal) {
  const groups = groupByOnset(notes);
  const sustained = pedalSustained(notes, pedal);
  // how long a key is assumed held, as far as the split is concerned
  const holdEnd = (n) => Math.min(n.end, n.start + (sustained.has(n) ? 0.3 : 1.5));
  const centreOf = (p) => (p[0] + p[p.length - 1]) / 2;

  const handCost = (hs, p, t, side) => {
    if (!p.length) return 0;
    let c = p.length > 5 ? 100 : 0;
    let lo = p[0], hi = p[p.length - 1];
    for (const h of hs.held) if (h.end > t + 0.03) { if (h.pitch < lo) lo = h.pitch; if (h.pitch > hi) hi = h.pitch; }
    const span = hi - lo;
    c += SPLIT.overSpan * Math.max(0, span - 12) + SPLIT.impossible * Math.max(0, span - 16) + SPLIT.wide * Math.max(0, span - 9);
    const centre = centreOf(p);
    if (hs.pos != null) {
      const d = Math.max(0, Math.abs(centre - hs.pos) - SPLIT.free);
      c += SPLIT.distance * d + (SPLIT.speed * d) / Math.max(t - hs.t, 0.06);
    }
    c += SPLIT.register * (side < 0 ? Math.max(0, centre - 60) : Math.max(0, 60 - centre));
    return c;
  };
  const advance = (hs, groupNotes, p, t) => {
    if (!p.length) return hs;
    const held = hs.held.filter((h) => h.end > t + 0.03);
    for (const n of groupNotes) held.push({ pitch: n.pitch, end: holdEnd(n) });
    return { pos: centreOf(p), t, held };
  };

  const idle = { pos: null, t: -Infinity, held: [] };
  let prev = [{ cost: 0, back: -1, L: idle, R: idle }];
  const layers = [];
  for (const g of groups) {
    const p = g.notes.map((n) => n.pitch);
    const cur = [];
    for (let s = 0; s <= p.length; s++) {
      const lp = p.slice(0, s), rp = p.slice(s);
      let best = Infinity, bi = -1;
      for (let pi = 0; pi < prev.length; pi++) {
        const ps = prev[pi];
        let c = ps.cost + handCost(ps.L, lp, g.t, -1) + handCost(ps.R, rp, g.t, 1);
        const cl = lp.length ? centreOf(lp) : ps.L.pos, cr = rp.length ? centreOf(rp) : ps.R.pos;
        if (cl != null && cr != null && cl > cr) c += SPLIT.crossing + 0.5 * (cl - cr);
        if (c < best) { best = c; bi = pi; }
      }
      const from = prev[bi];
      cur.push({ cost: best, back: bi, s, L: advance(from.L, g.notes.slice(0, s), lp, g.t), R: advance(from.R, g.notes.slice(s), rp, g.t) });
    }
    layers.push(cur);
    prev = cur;
  }
  let si = 0;
  for (let i = 1; i < prev.length; i++) if (prev[i].cost < prev[si].cost) si = i;
  for (let gi = groups.length - 1; gi >= 0; gi--) {
    const st = layers[gi][si];
    groups[gi].notes.forEach((n, i) => { n.hand = i < st.s ? 'L' : 'R'; });
    si = st.back;
  }
}

// Weights of the hand-split costs (units: semitones, seconds).
const SPLIT = {
  overSpan: 2.5,  // per semitone a hand must span beyond an octave (with the keys it still holds)
  impossible: 8,  // ... and beyond a tenth
  wide: 0.15,     // per semitone beyond a comfortable 6th/7th
  free: 2.5,      // how far the hand's centre may shift for free
  distance: 0.12, // per semitone of travel
  speed: 0.06,    // per semitone/second of travel
  crossing: 3,    // hands crossed
  register: 0.05, // per semitone the left hand is above / the right hand below middle C
};

// If a staff-based split gives one hand a chord it cannot span, hand the
// outlying note to the other hand when that hand is free.
function fixReach(notes) {
  for (const g of groupByOnset(notes)) {
    const L = g.notes.filter((n) => n.hand === 'L');
    const R = g.notes.filter((n) => n.hand === 'R');
    if (R.length > 1 && R.at(-1).pitch - R[0].pitch > 14 && (!L.length || L.at(-1).pitch < R[0].pitch)) {
      if (L.length < 5 && (!L.length || R[0].pitch - L[0].pitch <= 13)) R[0].hand = 'L';
    }
    if (L.length > 1 && L.at(-1).pitch - L[0].pitch > 14 && (!R.length || R[0].pitch > L.at(-1).pitch)) {
      if (R.length < 5 && (!R.length || R.at(-1).pitch - L.at(-1).pitch <= 13)) L.at(-1).hand = 'R';
    }
  }
}
