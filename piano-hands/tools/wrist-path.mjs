// Export the wrist paths our planner produces for a MIDI file, as JSON, on the
// file's own timeline. Used to compare the planner with motion-capture data.
//
//   node tools/wrist-path.mjs <in.mid> <out.json> [fps=30]
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import * as THREE from 'three';
import { Hand } from '../src/hand.js';
import { assignHands, assignFingers } from '../src/fingering.js';
import { Performance } from '../src/performance.js';
import { parseMidi } from '../src/midi.js';
import { keyX } from '../src/piano.js';

const [, , input, output, fpsArg] = process.argv;
if (!input || !output) {
  console.error('usage: node tools/wrist-path.mjs <in.mid> <out.json> [fps]');
  process.exit(1);
}
const fps = Number(fpsArg) || 30;
const buf = readFileSync(input);
const score = parseMidi(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), basename(input));
assignHands(score.notes);
assignFingers(score.notes.filter((n) => n.hand === 'L'), -1);
assignFingers(score.notes.filter((n) => n.hand === 'R'), 1);

const mats = new Proxy({}, { get: () => new THREE.MeshBasicMaterial() });
const perf = new Performance(score, { L: new Hand(-1, mats), R: new Hand(1, mats) });

const frames = Math.ceil((perf.duration - score.offset) * fps);
const hands = {};
for (const key of ['L', 'R']) {
  const tr = { x: [], y: [], z: [], yaw: [], roll: [] };
  for (let i = 0; i < frames; i++) {
    const w = perf.wristAt(key, i / fps + score.offset);
    for (const c in tr) tr[c].push(+w[c].toFixed(5));
  }
  hands[key] = tr;
}
const r3 = (v) => +v.toFixed(4);
writeFileSync(output, JSON.stringify({
  file: basename(input),
  fps,
  offset: score.offset,
  tracks: new Set(score.notes.map((n) => `${n.track}:${n.channel}`)).size,
  hands, // wrist joint: x along the keyboard (0 = middle), z towards the player, y up
  notes: score.notes.map((n) => ({
    pitch: n.pitch, x: r3(keyX(n.pitch)), start: r3(n.start - score.offset), end: r3(n.end - score.offset),
    hand: n.hand, finger: n.finger,
  })),
}));
console.log(`${basename(input)}: ${score.notes.length} notes, ${frames} frames @ ${fps} fps`);
