// Score the automatic hand split against labels derived from the real wrists
// ("which real wrist was nearer to this key?", see split_labels.py).
//
//   node tools/pianomotion/split_eval.mjs <data_dir>
import { readFileSync, readdirSync } from 'node:fs';
import { assignHands } from '../../src/fingering.js';
import { parseMidi } from '../../src/midi.js';

const root = process.argv[2];
const labels = JSON.parse(readFileSync(`${root}/labels.json`));
let agree = 0, total = 0;
const rows = [];
for (const up of readdirSync(`${root}/data/midi`)) {
  for (const f of readdirSync(`${root}/data/midi/${up}`)) {
    const bv = f.replace('.mid', '');
    if (!labels[bv]) continue;
    const buf = readFileSync(`${root}/data/midi/${up}/${f}`);
    const score = parseMidi(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), f);
    assignHands(score.notes, score.pedal);
    const byKey = new Map(score.notes.map((n) => [`${(n.start - score.offset).toFixed(3)}:${n.pitch}`, n]));
    let a = 0, t = 0;
    for (const [start, pitch, lab] of labels[bv]) {
      const n = byKey.get(`${start.toFixed(3)}:${pitch}`);
      if (process.env.SHOW === bv && n) console.log(`${start.toFixed(2).padStart(7)} pitch ${pitch} ours ${n.hand} real ${lab ?? '?'}${lab && lab !== n.hand ? '  <-- MISMATCH' : ''}`);
      if (!lab || !n) continue;
      t++; if (n.hand === lab) a++;
    }
    agree += a; total += t;
    rows.push([bv, a / t, t]);
  }
}
rows.sort((x, y) => x[1] - y[1]);
console.log(`hand split agrees with the real hands on ${(agree / total * 100).toFixed(1)}% of ${total} clear-cut notes`);
console.log('per video: ' + rows.map((r) => `${r[0].slice(0, 8)} ${(r[1] * 100).toFixed(0)}%`).join(', '));
