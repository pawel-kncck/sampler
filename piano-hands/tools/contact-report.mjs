// How well do the fingertips stay on their keys? Prints error quantiles and
// the worst cases for the built-in pieces or a MIDI file.
//
//   node tools/contact-report.mjs [file.mid]
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Hand } from '../src/hand.js';
import { furElise, technicalStudy } from '../src/scores.js';
import { assignHands, assignFingers } from '../src/fingering.js';
import { Performance } from '../src/performance.js';
import { parseMidi } from '../src/midi.js';

const mats = new Proxy({}, { get: () => new THREE.MeshBasicMaterial() });
const hands = { L: new Hand(-1, mats), R: new Hand(1, mats) };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const name = (p) => NAMES[p % 12] + (Math.floor(p / 12) - 1);

const scores = [];
if (process.argv[2]) {
  const buf = readFileSync(process.argv[2]);
  scores.push(parseMidi(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), process.argv[2]));
} else scores.push(furElise(), technicalStudy());

for (const score of scores) {
  assignHands(score.notes, score.pedal);
  assignFingers(score.notes.filter((n) => n.hand === 'L'), -1);
  assignFingers(score.notes.filter((n) => n.hand === 'R'), 1);
  const perf = new Performance(score, hands);
  const v = new THREE.Vector3();
  const errs = [], worst = [];
  let early = 0, out = 0;
  for (const n of score.notes) {
    if (n.finger == null || n.unreachable) { out++; continue; }
    if (n.vEnd < n.end - 0.02) early++;
    let max = 0, info = null;
    for (let t = n.start; t <= n.vEnd; t += 0.03) {
      perf.update(t);
      const H = perf.hands.find((h) => h.key === n.hand), st = H.state[n.finger], f = hands[n.hand].fingers[n.finger];
      const e = f.tipWorld(v).distanceTo(st.pos);
      errs.push(e);
      if (e >= max) {
        max = e;
        const loc = f.base.worldToLocal(st.pos.clone());
        const w = perf.wristAt(n.hand, t);
        info = `${n.hand}${n.finger + 1} ${name(n.pitch)} t=${t.toFixed(2)} (+${(t - n.start).toFixed(2)}) err ${(e * 1000).toFixed(1)} mm | target in finger frame ${loc.toArray().map((x) => (x * 100).toFixed(1)).join(',')} cm` +
          ` | abd ${f.angles.abd.toFixed(2)} f1 ${f.angles.f1.toFixed(2)} f2 ${f.angles.f2.toFixed(2)} | wrist x ${(w.x * 100).toFixed(1)} y ${(w.y * 100).toFixed(1)} yaw ${w.yaw.toFixed(2)} spread ${w.spread.toFixed(2)} | key x ${(n.info.x * 100).toFixed(1)}`;
      }
    }
    worst.push([max, info]);
  }
  errs.sort((a, b) => a - b);
  const q = (p) => (errs[Math.floor(errs.length * p)] * 1000).toFixed(1);
  console.log(`${score.title}: contact error mm p50 ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} max ${(errs.at(-1) * 1000).toFixed(1)} | early releases ${early}/${score.notes.length} | out of reach ${out}`);
  worst.sort((a, b) => b[0] - a[0]);
  for (const [, info] of worst.slice(0, Number(process.env.WORST || 6))) console.log('   ' + info);
}
