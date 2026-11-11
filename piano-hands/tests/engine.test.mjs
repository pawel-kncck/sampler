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
  assignHands(score.notes);
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
  for (const [mk, p99] of [[furElise, 0.008], [technicalStudy, 0.016]]) {
    const s = prepare(mk());
    const perf = new Performance(s, hands);
    const v = new THREE.Vector3();
    const errs = [];
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
  assignHands(s.notes);
  assert.ok(s.notes.filter((n) => n.pitch < 60).every((n) => n.hand === 'L'));
  assert.ok(s.notes.filter((n) => n.pitch >= 70).every((n) => n.hand === 'R'));
});

test('single-track MIDI is split between the hands by register and reach', () => {
  const src = technicalStudy();
  const s = parseMidi(midiFile(src.notes.map((n) => ({ ...n, track: 0 }))), 'study.mid');
  assignHands(s.notes);
  const agree = s.notes.filter((n) => {
    const o = src.notes.find((m) => m.pitch === n.pitch && Math.abs(m.start + (s.notes[0].start - src.notes[0].start) - n.start) < 0.01);
    return o && o.hand === n.hand;
  }).length;
  assert.ok(agree / s.notes.length > 0.95, `agreement ${agree}/${s.notes.length}`);
});
