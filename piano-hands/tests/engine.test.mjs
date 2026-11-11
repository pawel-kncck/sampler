// Engine tests (run with `npm test` after `npm install`): fingering quality,
// hand splitting, MIDI parsing and how accurately fingertips meet the keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Hand } from '../src/hand.js';
import { furElise, technicalStudy, noteNumber } from '../src/scores.js';
import { assignHands, assignFingers } from '../src/fingering.js';
import { Performance } from '../src/performance.js';
import { parseMidi } from '../src/midi.js';

const mats = new Proxy({}, { get: () => new THREE.MeshBasicMaterial() });
const hands = { L: new Hand(-1, mats), R: new Hand(1, mats) };

function prepare(score) {
  assignHands(score.notes, score.pedal);
  assignFingers(score.notes.filter((n) => n.hand === 'L'), -1);
  assignFingers(score.notes.filter((n) => n.hand === 'R'), 1);
  return score;
}

const fingersOf = (notes, hand, from, count) =>
  notes.filter((n) => n.hand === hand).sort((a, b) => a.start - b.start).slice(from, from + count).map((n) => n.finger + 1);

test('C major scale gets the standard fingering (thumb under after 3 and 4)', () => {
  const s = prepare(technicalStudy());
  assert.deepEqual(fingersOf(s.notes, 'R', 0, 15), [1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 1, 2, 3, 4, 5]);
  assert.deepEqual(fingersOf(s.notes, 'R', 15, 14), [4, 3, 2, 1, 3, 2, 1, 4, 3, 2, 1, 3, 2, 1]);
});

test('arpeggio fingering is 1-2-3-1-2-3-5', () => {
  const s = prepare(technicalStudy());
  assert.deepEqual(fingersOf(s.notes, 'R', 29, 7), [1, 2, 3, 1, 2, 3, 5]);
});

test('Für Elise: motif 5-4-5-4-5 and left-hand broken chords 5-2-1', () => {
  const s = prepare(furElise());
  assert.deepEqual(fingersOf(s.notes, 'R', 0, 5), [5, 4, 5, 4, 5]);
  assert.deepEqual(fingersOf(s.notes, 'L', 0, 6), [5, 2, 1, 5, 2, 1]);
});

test('a finger never plays a new key while still holding another', () => {
  for (const s of [prepare(furElise()), prepare(technicalStudy())]) {
    for (const h of ['L', 'R']) for (let f = 0; f < 5; f++) {
      const list = s.notes.filter((n) => n.hand === h && n.finger === f).sort((a, b) => a.start - b.start);
      for (let i = 1; i < list.length; i++) {
        if (list[i].pitch !== list[i - 1].pitch) assert.ok(list[i - 1].end <= list[i].start + 0.03);
      }
    }
  }
});

test('fingertips stay on their keys while the keys are down', () => {
  for (const [mk, p99] of [[furElise, 0.003], [technicalStudy, 0.008]]) {
    const s = prepare(mk());
    const perf = new Performance(s, hands);
    const v = new THREE.Vector3();
    const errs = [];
    assert.equal(s.notes.filter((n) => n.unreachable).length, 0, `${s.title}: every key can be reached`);
    for (const n of s.notes) {
      for (let t = n.start; t <= n.vEnd; t += 0.03) {
        perf.update(t);
        const st = perf.hands.find((h) => h.key === n.hand).state[n.finger];
        assert.equal(st.mode, 'press');
        errs.push(hands[n.hand].fingers[n.finger].tipWorld(v).distanceTo(st.pos));
      }
    }
    errs.sort((a, b) => a - b);
    assert.ok(errs[Math.floor(errs.length * 0.5)] < 0.001, `${s.title}: median contact error`);
    assert.ok(errs[Math.floor(errs.length * 0.99)] < p99, `${s.title}: p99 contact error ${errs[Math.floor(errs.length * 0.99)]}`);
  }
});

test('keys go down exactly when notes sound', () => {
  const s = prepare(furElise());
  const perf = new Performance(s, hands);
  const n = s.notes[10];
  assert.equal(perf.keyDepthAt(n.pitch, n.start), 1);
  assert.equal(perf.keyDepthAt(n.pitch, n.tContact - 0.01), 0);
});

// --- hand shape and wrist ----------------------------------------------------
const melody = (names, step = 0.2, hand = 'R') => ({
  title: 'test',
  pedal: [],
  notes: names.map((nm, i) => ({ pitch: noteNumber(nm), start: 1 + i * step, end: 1 + (i + 0.9) * step, velocity: 0.6, hand })),
});

test('relaxed fingertips rest over five neighbouring white keys', () => {
  for (const h of [hands.L, hands.R]) {
    for (let f = 0; f < 4; f++) {
      const gap = h.natural[f + 1].x - h.natural[f].x;
      assert.ok(Math.abs(gap - 0.0235) < 0.0005, `fingers ${f + 1}-${f + 2}: ${gap}`);
    }
  }
});

test('a five-finger pattern is played without moving the wrist', () => {
  const up = ['C4', 'D4', 'E4', 'F4', 'G4', 'F4', 'E4', 'D4'];
  const s = prepare(melody([...up, ...up, ...up, 'C4']));
  assert.deepEqual(fingersOf(s.notes, 'R', 0, 5), [1, 2, 3, 4, 5]);
  const perf = new Performance(s, hands);
  const xs = [];
  for (let t = 1; t < 5.8; t += 0.02) xs.push(perf.wristAt('R', t).x);
  assert.ok(Math.max(...xs) - Math.min(...xs) < 0.004, `wrist travelled ${Math.max(...xs) - Math.min(...xs)} m`);
});

test('the hand turns with the forearm: outwards when far from the body', () => {
  const yawAt = (names, hand) => new Performance(prepare(melody(names, 0.3, hand)), hands).wristAt(hand, 1.5).yaw;
  // track units: positive = fingers turned towards the thumb side
  assert.ok(yawAt(['C7', 'D7', 'E7', 'D7', 'C7'], 'R') < -0.1, 'right hand in the top octaves points outwards');
  assert.ok(yawAt(['C3', 'D3', 'E3', 'D3', 'C3'], 'R') > 0.1, 'right hand crossing to the bass points inwards');
  assert.ok(yawAt(['C1', 'D1', 'E1', 'D1', 'C1'], 'L') < -0.1, 'left hand in the bottom octaves points outwards');
});

test('pedal-sustained notes are released when the hand plays again', () => {
  const n = (nm, start, end) => ({ pitch: noteNumber(nm), start, end, velocity: 0.6, hand: 'R' });
  const notes = [n('C4', 1, 3), n('E4', 1.5, 3), n('G4', 2, 3), n('A4', 2.5, 2.7)];
  assignHands(notes, [{ start: 1.05, end: 3 }]);
  assert.ok(Math.abs(notes[0].end - 1.52) < 1e-9 && notes[0].sounding === 3, 'held until the next note of the hand');
  assert.ok(Math.abs(notes[1].end - 2.02) < 1e-9);
  assert.equal(notes[3].end, 2.7, 'a note released under the pedal keeps its written length');
  assert.equal(notes[3].sounding, undefined);
});

test('single stream: bass, chords and melody go to the hands that can reach them', () => {
  const notes = [];
  const add = (nm, start, dur) => notes.push({ pitch: noteNumber(nm), start, end: start + dur, velocity: 0.6 });
  const tune = ['E5', 'D5', 'C5', 'D5', 'E5', 'E5', 'E5', 'G5'];
  tune.forEach((nm, i) => {
    add(nm, 1 + i * 0.5, 0.45);
    if (i % 2 === 0) add('C2', 1 + i * 0.5, 0.2);                    // bass note ...
    else ['E3', 'G3', 'C4'].forEach((c) => add(c, 1 + i * 0.5, 0.4)); // ... then the chord, a leap away
  });
  assignHands(notes, []);
  for (const x of notes) assert.equal(x.hand, x.pitch >= noteNumber('C5') ? 'R' : 'L', `pitch ${x.pitch}`);
});

// --- MIDI ----------------------------------------------------------------
function midiFile(notes, tracks = 1) {
  const TPQ = 480;
  const vlq = (v) => { const b = [v & 0x7f]; while ((v >>= 7)) b.unshift((v & 0x7f) | 0x80); return b; };
  const chunks = [];
  for (let tr = 0; tr < tracks; tr++) {
    const ev = [];
    for (const n of notes.filter((x) => (x.track ?? 0) === tr)) {
      ev.push([Math.round(n.start * 2 * TPQ), 0x90, n.pitch, 80]);
      ev.push([Math.round(n.end * 2 * TPQ), 0x80, n.pitch, 0]);
    }
    ev.sort((a, b) => a[0] - b[0]);
    const data = tr === 0 ? [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20] : [];
    let last = 0;
    for (const [t, ...d] of ev) { data.push(...vlq(t - last), ...d); last = t; }
    data.push(0, 0xff, 0x2f, 0);
    chunks.push([0x4d, 0x54, 0x72, 0x6b, 0, 0, data.length >> 8, data.length & 255, ...data]);
  }
  return new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, tracks > 1 ? 1 : 0, 0, tracks, TPQ >> 8, TPQ & 255, ...chunks.flat()]).buffer;
}

test('MIDI parser reads notes and timing (120 bpm)', () => {
  const s = parseMidi(midiFile([{ pitch: 60, start: 0, end: 0.5 }, { pitch: 64, start: 0.5, end: 1 }]), 'x.mid');
  assert.equal(s.notes.length, 2);
  assert.ok(Math.abs(s.notes[1].start - s.notes[0].start - 0.5) < 1e-6);
  assert.ok(Math.abs(s.notes[0].end - s.notes[0].start - 0.5) < 1e-6);
});

test('two-track MIDI: lower staff goes to the left hand', () => {
  const notes = [];
  for (let i = 0; i < 8; i++) {
    notes.push({ pitch: noteNumber('C5') + (i % 3), start: i * 0.25, end: i * 0.25 + 0.2, track: 0 });
    notes.push({ pitch: noteNumber('C3') + (i % 4), start: i * 0.25, end: i * 0.25 + 0.2, track: 1 });
  }
  const s = parseMidi(midiFile(notes, 2), 'two.mid');
  assignHands(s.notes, s.pedal);
  assert.ok(s.notes.filter((n) => n.pitch < 60).every((n) => n.hand === 'L'));
  assert.ok(s.notes.filter((n) => n.pitch >= 70).every((n) => n.hand === 'R'));
});

test('single-track MIDI is split between the hands by register and reach', () => {
  const src = technicalStudy();
  const s = parseMidi(midiFile(src.notes.map((n) => ({ ...n, track: 0 }))), 'study.mid');
  assignHands(s.notes, s.pedal);
  const agree = s.notes.filter((n) => {
    const o = src.notes.find((m) => m.pitch === n.pitch && Math.abs(m.start + (s.notes[0].start - src.notes[0].start) - n.start) < 0.01);
    return o && o.hand === n.hand;
  }).length;
  assert.ok(agree / s.notes.length > 0.95, `agreement ${agree}/${s.notes.length}`);
});
