// Built-in pieces, written as plain note data (pitch, start, duration, hand).
// Fingering is NOT written here – it is computed by the fingering engine,
// exactly as it is for any loaded MIDI file.

const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function noteNumber(name) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error('bad note ' + name);
  return 12 * (Number(m[3]) + 1) + NOTE_INDEX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

/**
 * Für Elise (Bagatelle No. 25 in A minor, WoO 59) – L. van Beethoven.
 * The A section with its repeats and the middle phrase, in 3/8.
 */
export function furElise() {
  const SIX = 60 / 69 / 4; // sixteenth note at ♩ = 69 (♪ = 138)
  const BAR = 6; // sixteenths per 3/8 bar
  const notes = [];
  const pedal = [];
  // n(hand, bar, sixteenth, pitch, durationInSixteenths, velocity)
  const n = (hand, bar, pos, name, dur = 1, vel) => {
    const start = (bar * BAR + pos) * SIX;
    notes.push({
      pitch: noteNumber(name),
      start,
      end: start + dur * SIX * 0.94,
      velocity: vel ?? (hand === 'R' ? 0.58 : 0.42),
      hand,
    });
  };
  const ped = (bar, fromPos = 0, len = BAR) => {
    pedal.push({ start: (bar * BAR + fromPos) * SIX + 0.02, end: (bar * BAR + fromPos + len) * SIX - 0.04 });
  };
  const arp = (bar, a, b, c) => { n('L', bar, 0, a, 1); n('L', bar, 1, b, 1); n('L', bar, 2, c, 1); ped(bar); };

  const motif = (bar, v = 0.6) => {
    ['E5', 'D#5', 'E5', 'B4', 'D5', 'C5'].forEach((p, i) => n('R', bar, i, p, 1, v - (i === 1 ? 0.06 : 0)));
  };

  // A phrase (8 bars). ending: 1 = back to the start, 2 = into the middle phrase, 3 = final
  const phraseA = (b, ending) => {
    motif(b, 0.62);
    n('R', b + 1, 0, 'A4', 2, 0.6); arp(b + 1, 'A2', 'E3', 'A3');
    n('R', b + 1, 3, 'C4'); n('R', b + 1, 4, 'E4'); n('R', b + 1, 5, 'A4');
    n('R', b + 2, 0, 'B4', 2, 0.6); arp(b + 2, 'E2', 'E3', 'G#3');
    n('R', b + 2, 3, 'E4'); n('R', b + 2, 4, 'G#4'); n('R', b + 2, 5, 'B4');
    n('R', b + 3, 0, 'C5', 2, 0.62); arp(b + 3, 'A2', 'E3', 'A3');
    n('R', b + 3, 3, 'E4'); n('R', b + 3, 4, 'E5', 1, 0.6); n('R', b + 3, 5, 'D#5', 1, 0.55);
    motif(b + 4, 0.6);
    n('R', b + 5, 0, 'A4', 2, 0.58); arp(b + 5, 'A2', 'E3', 'A3');
    n('R', b + 5, 3, 'C4'); n('R', b + 5, 4, 'E4'); n('R', b + 5, 5, 'A4');
    n('R', b + 6, 0, 'B4', 2, 0.58); arp(b + 6, 'E2', 'E3', 'G#3');
    n('R', b + 6, 3, 'E4'); n('R', b + 6, 4, 'C5'); n('R', b + 6, 5, 'B4', 1, 0.5);
    if (ending === 3) {
      n('R', b + 7, 0, 'A4', 6, 0.5);
      n('L', b + 7, 0, 'A2', 6, 0.38); n('L', b + 7, 1, 'E3', 5, 0.34); n('L', b + 7, 2, 'A3', 4, 0.34);
      ped(b + 7, 0, 9);
      return;
    }
    n('R', b + 7, 0, 'A4', 2, 0.55); arp(b + 7, 'A2', 'E3', 'A3');
    if (ending === 1) { n('R', b + 7, 4, 'E5', 1, 0.6); n('R', b + 7, 5, 'D#5', 1, 0.55); }
    else { n('R', b + 7, 3, 'B4'); n('R', b + 7, 4, 'C5'); n('R', b + 7, 5, 'D5'); }
  };

  // middle phrase (C major → A minor, 5 bars), ends with the pickup to the motif
  const phraseB = (c) => {
    n('L', c, 0, 'C3'); n('L', c, 1, 'G3'); n('L', c, 2, 'C4'); ped(c);
    n('R', c, 0, 'E5', 3, 0.64); n('R', c, 3, 'G4'); n('R', c, 4, 'F5', 1, 0.62); n('R', c, 5, 'E5');
    n('L', c + 1, 0, 'G2'); n('L', c + 1, 1, 'G3'); n('L', c + 1, 2, 'B3'); ped(c + 1);
    n('R', c + 1, 0, 'D5', 3, 0.62); n('R', c + 1, 3, 'F4'); n('R', c + 1, 4, 'E5', 1, 0.6); n('R', c + 1, 5, 'D5');
    arp(c + 2, 'A2', 'E3', 'A3');
    n('R', c + 2, 0, 'C5', 3, 0.6); n('R', c + 2, 3, 'E4'); n('R', c + 2, 4, 'D5', 1, 0.58); n('R', c + 2, 5, 'C5');
    n('L', c + 3, 0, 'E2'); n('L', c + 3, 1, 'E3'); ped(c + 3, 0, 3);
    n('R', c + 3, 0, 'B4', 2, 0.58); n('R', c + 3, 3, 'E4', 1, 0.5); n('R', c + 3, 4, 'E5', 1, 0.52); n('R', c + 3, 5, 'D#5', 1, 0.48);
    ['E5', 'D#5', 'E5', 'D#5', 'E5', 'D#5'].forEach((p, i) => n('R', c + 4, i, p, 1, 0.5 + i * 0.015));
  };

  // pickup
  n('R', 0, 4, 'E5', 1, 0.55); n('R', 0, 5, 'D#5', 1, 0.5);
  phraseA(1, 1);
  phraseA(9, 2);
  phraseB(17);
  phraseA(22, 2);
  phraseB(30);
  phraseA(35, 3);

  // gentle ritardando into the last bars
  const total = 43 * BAR * SIX;
  const ritStart = 41 * BAR * SIX;
  const warp = (t) => (t <= ritStart ? t : ritStart + (t - ritStart) * (1 + ((t - ritStart) / (total - ritStart)) * 0.35));
  for (const x of notes) { x.start = warp(x.start); x.end = warp(x.end); }
  for (const p of pedal) { p.start = warp(p.start); p.end = warp(p.end); }

  // shift so the piece starts after a short breath
  const offset = 1.2 - notes.reduce((m, x) => Math.min(m, x.start), Infinity);
  for (const x of notes) { x.start += offset; x.end += offset; }
  for (const p of pedal) { p.start += offset; p.end += offset; }
  return { title: 'Für Elise — L. van Beethoven', notes, pedal };
}

/** Scales, arpeggios and chords – shows thumb-under, crossings and hand shapes. */
export function technicalStudy() {
  const notes = [];
  const q = 0.16;
  let t = 1.0;
  const add = (hand, name, start, dur, vel = 0.55) =>
    notes.push({ pitch: noteNumber(name), start, end: start + dur * 0.92, velocity: vel, hand });
  const C = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  // two-octave C major scale, hands an octave apart, up and down
  const scale = [];
  for (let o = 0; o < 2; o++) for (const c of C) scale.push(c + (4 + o));
  scale.push('C6');
  const seq = scale.concat(scale.slice(0, -1).reverse());
  seq.forEach((p, i) => {
    add('R', p, t + i * q, q, 0.5 + 0.1 * Math.sin(i / 4));
    add('L', p.replace(/\d/, (d) => String(Number(d) - 2)), t + i * q, q, 0.45);
  });
  t += seq.length * q + 0.5;
  // arpeggios C, F, G7 – broken chords across two octaves
  const arps = [['C', 'E', 'G'], ['F', 'A', 'C'], ['G', 'B', 'D']];
  for (const chord of arps) {
    const up = [];
    for (let o = 4; o < 6; o++) for (const c of chord) up.push(c + o);
    up.push(chord[0] + 6);
    const s = up.concat(up.slice(0, -1).reverse());
    s.forEach((p, i) => {
      add('R', p, t + i * q, q, 0.5);
    });
    add('L', chord[0] + 2, t, s.length * q * 0.5, 0.4);
    add('L', chord[0] + 3, t, s.length * q * 0.5, 0.36);
    add('L', chord[0] + 2, t + s.length * q * 0.5, s.length * q * 0.5, 0.4);
    add('L', chord[2] + 2, t + s.length * q * 0.5, s.length * q * 0.5, 0.36);
    t += s.length * q + 0.35;
  }
  // chord progression with black keys
  const prog = [
    [['C3', 'G3'], ['E4', 'G4', 'C5']],
    [['A2', 'E3'], ['E4', 'A4', 'C5']],
    [['D3', 'A3'], ['F#4', 'A4', 'D5']],
    [['G2', 'D3'], ['F4', 'G4', 'B4', 'D5']],
    [['Eb3', 'Bb3'], ['G4', 'Bb4', 'Eb5']],
    [['Ab2', 'Eb3'], ['Ab4', 'C5', 'Eb5']],
    [['G2', 'D3', 'G3'], ['F4', 'G4', 'B4', 'D5']],
    [['C3', 'G3', 'C4'], ['E4', 'G4', 'C5', 'E5']],
  ];
  prog.forEach(([l, r], i) => {
    const d = i === prog.length - 1 ? 2.4 : 0.75;
    l.forEach((p) => add('L', p, t, d, 0.5));
    r.forEach((p) => add('R', p, t + 0.01, d, 0.55));
    t += 0.8;
  });
  return { title: 'Technical study — scales, arpeggios, chords', notes, pedal: [] };
}
