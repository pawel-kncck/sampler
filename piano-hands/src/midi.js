// Minimal Standard MIDI File (SMF type 0/1) parser → { notes, pedal } in seconds.

export function parseMidi(buffer, name = 'MIDI file') {
  const d = new DataView(buffer);
  let p = 0;
  const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(d.getUint8(p + i)); p += n; return s; };
  const u32 = () => { const v = d.getUint32(p); p += 4; return v; };
  const u16 = () => { const v = d.getUint16(p); p += 2; return v; };
  const vlq = () => { let v = 0, b; do { b = d.getUint8(p++); v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };

  if (str(4) !== 'MThd') throw new Error('Not a MIDI file');
  const hlen = u32();
  const format = u16();
  const ntrk = u16();
  const division = u16();
  p = 8 + hlen;
  if (division & 0x8000) throw new Error('SMPTE time division is not supported');

  const events = []; // {tick, track, type, ...}
  for (let t = 0; t < ntrk && p < d.byteLength; t++) {
    const id = str(4);
    const len = u32();
    const end = p + len;
    if (id !== 'MTrk') { p = end; continue; }
    let tick = 0, status = 0;
    while (p < end) {
      tick += vlq();
      let b = d.getUint8(p);
      if (b & 0x80) { status = b; p++; } else if (status < 0x80) { p++; continue; }
      const type = status & 0xf0, ch = status & 0x0f;
      if (status === 0xff) {
        const mt = d.getUint8(p++);
        const ml = vlq();
        if (mt === 0x51 && ml === 3) {
          const mpqn = (d.getUint8(p) << 16) | (d.getUint8(p + 1) << 8) | d.getUint8(p + 2);
          events.push({ tick, track: t, kind: 'tempo', mpqn });
        }
        p += ml;
        if (mt === 0x2f) break;
      } else if (status === 0xf0 || status === 0xf7) {
        p += vlq();
      } else if (type === 0x90 || type === 0x80) {
        const note = d.getUint8(p++), vel = d.getUint8(p++);
        events.push({ tick, track: t, ch, kind: type === 0x90 && vel > 0 ? 'on' : 'off', note, vel });
      } else if (type === 0xb0) {
        const c = d.getUint8(p++), v = d.getUint8(p++);
        if (c === 64) events.push({ tick, track: t, ch, kind: 'pedal', down: v >= 64 });
      } else if (type === 0xc0 || type === 0xd0) p += 1;
      else p += 2; // 0xa0, 0xe0
    }
    p = end;
  }

  events.sort((a, b) => a.tick - b.tick || order(a) - order(b));
  // tempo map → seconds
  let mpqn = 500000, lastTick = 0, lastSec = 0;
  const sec = (tick) => lastSec + ((tick - lastTick) * mpqn) / 1e6 / division;
  const notes = [];
  const open = new Map();
  const pedal = [];
  let pedalDown = null;
  for (const e of events) {
    const s = sec(e.tick);
    if (e.kind === 'tempo') { lastSec = s; lastTick = e.tick; mpqn = e.mpqn; continue; }
    if (e.ch === 9) continue; // percussion
    if (e.kind === 'on') {
      const k = e.ch * 128 + e.note;
      if (open.has(k)) close(open.get(k), s);
      const n = { pitch: e.note, start: s, end: s + 0.2, velocity: e.vel / 127, track: e.track, channel: e.ch };
      open.set(k, n);
      notes.push(n);
    } else if (e.kind === 'off') {
      const k = e.ch * 128 + e.note;
      if (open.has(k)) { close(open.get(k), s); open.delete(k); }
    } else if (e.kind === 'pedal') {
      if (e.down && pedalDown == null) pedalDown = s;
      else if (!e.down && pedalDown != null) { pedal.push({ start: pedalDown, end: s }); pedalDown = null; }
    }
  }
  const last = notes.reduce((m, n) => Math.max(m, n.end), 0);
  for (const n of open.values()) n.end = Math.max(n.start + 0.3, last);
  if (pedalDown != null) pedal.push({ start: pedalDown, end: last });
  function close(n, s) { n.end = Math.max(s, n.start + 0.03); }

  // keep notes on an 88-key piano
  const playable = notes.filter((n) => n.pitch >= 21 && n.pitch <= 108);
  if (!playable.length) throw new Error('No playable notes found');
  // start shortly after t = 0
  const first = playable.reduce((m, n) => Math.min(m, n.start), Infinity);
  const shift = 1.0 - first;
  for (const n of playable) { n.start += shift; n.end += shift; }
  for (const q of pedal) { q.start += shift; q.end += shift; }
  return { title: name.replace(/\.midi?$/i, ''), notes: playable, pedal, format };
}

function order(e) {
  // at the same tick: tempo first, then note-offs before note-ons
  return e.kind === 'tempo' ? 0 : e.kind === 'off' ? 1 : e.kind === 'pedal' ? 2 : 3;
}
