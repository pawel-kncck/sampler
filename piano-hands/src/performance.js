// Motion planning: turns a fingered score into hand and finger motion.
//
// Everything here is a deterministic function of score time, so playback can
// be paused, scrubbed or slowed down freely.
//
//  * Wrist: one key-frame per chord/note onset (least-squares fit of the
//    hand position to the fingers that are about to play or are holding
//    keys), joined with minimum-jerk moves that arrive just before the
//    onset, then low-pass filtered. Roll (pronation/supination) and yaw
//    follow which fingers are active and thumb crossings.
//  * Fingers: each finger is either pressing a key (tip locked to the moving
//    key surface), approaching the next key (lift–strike arc that hits the
//    key with velocity), releasing (rides the key up, relaxes), or resting
//    (relaxed curl that follows its neighbours, incl. tendon coupling).
//  * Tips are placed with IK on the anatomical skeleton (see hand.js).
import * as THREE from 'three';
import { keyInfo, keySurfaceY, restSurfaceAt, BLACK_FRONT } from './piano.js';
import { groupByOnset } from './fingering.js';

const DT = 1 / 120;
const PAD = 0.0068; // fingertip pad: bone end sits this far above the contact point
const KEY_UP = 0.065; // key return time
const RELEASE = 0.16; // finger relax time after leaving a key
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const minJerk = (s) => s * s * s * (10 + s * (-15 + 6 * s));
const lerp = (a, b, t) => a + (b - a) * t;

function upperBound(arr, t, key) {
  // index of last element with el[key] <= t, or -1
  let lo = 0, hi = arr.length - 1, r = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (arr[m][key] <= t) { r = m; lo = m + 1; } else hi = m - 1;
  }
  return r;
}

function keyDepth(n, t) {
  if (t < n.tContact) return 0;
  if (t < n.start) return Math.pow((t - n.tContact) / n.press, 1.6);
  if (t <= n.vEnd) return 1;
  const u = (t - n.vEnd) / KEY_UP;
  return u >= 1 ? 0 : (1 - u) * (1 - u);
}

const CH = 7; // x, y, z, yaw, roll, pitch, spread

// How far each fingertip can comfortably deviate sideways from its relaxed
// position, as [towards thumb side, towards little-finger side] in metres
// (hand coordinates). The thumb can pass under the hand and fingers can
// cross over the thumb (helped by wrist yaw); otherwise curled fingers only
// get ~1 cm from MCP abduction.
const HAND_REACH = [[-0.02, 0.036], [-0.014, 0.010], [-0.012, 0.010], [-0.010, 0.010], [-0.008, 0.013]];

export class Performance {
  constructor(score, hands) {
    this.score = score;
    this.notes = score.notes;
    this.pedal = (score.pedal || []).slice().sort((a, b) => a.start - b.start);
    this.duration = this.notes.reduce((m, n) => Math.max(m, n.end), 0) + 1.0;

    for (const n of this.notes) {
      n.info = keyInfo(n.pitch);
      const v = n.velocity ?? 0.6;
      n.press = 0.036 - 0.02 * v;
      n.tContact = n.start - n.press;
      n.vEnd = Math.max(n.end, n.start + 0.02);
    }

    this.byPitch = new Map();
    for (const n of this.notes) {
      if (!this.byPitch.has(n.pitch)) this.byPitch.set(n.pitch, []);
      this.byPitch.get(n.pitch).push(n);
    }
    for (const arr of this.byPitch.values()) arr.sort((a, b) => a.tContact - b.tContact);

    this.hands = [];
    for (const [key, side] of [['L', -1], ['R', 1]]) {
      const hand = hands[key];
      const notes = this.notes.filter((n) => n.hand === key && n.finger != null).sort((a, b) => a.start - b.start);
      const h = { key, side, hand, notes, fingers: [[], [], [], [], []], state: [] };
      for (const n of notes) h.fingers[n.finger].push(n);
      this._buildTrack(h);
      this._planFingers(h);
      for (let f = 0; f < 5; f++) h.state.push({ mode: 'rest', pos: new THREE.Vector3(), note: null, w: 0, dev: 0 });
      this.hands.push(h);
    }
    // pressing finger labels (for UI)
    this.pressing = [];
  }

  // ---------------------------------------------------------------- wrist
  _buildTrack(h) {
    const { side, hand, notes } = h;
    const nat = hand.natural;
    const baseZ = -0.040 - nat[2].z;
    const baseY = 0.004 + PAD - nat[4].y;
    const pitch = -0.035;

    const groups = groupByOnset(notes);
    const frames = [];
    // wrist positions that keep a note's finger within comfortable reach
    const range = (n) => {
      const nx = nat[n.finger].x;
      const [a, b] = HAND_REACH[n.finger];
      return side > 0 ? [n.info.x - nx - b, n.info.x - nx - a] : [n.info.x + nx + a, n.info.x + nx + b];
    };
    let prevX = null;
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      // least-squares position for this onset (used when constraints conflict),
      // weighted so each finger stretches in proportion to its capacity
      let ls = 0;
      for (let it = 0; it < 3; it++) {
        let sw = 0, sx = 0;
        for (const n of g.notes) {
          const want = n.info.x - side * nat[n.finger].x;
          let w = 1;
          if (it > 0) {
            const dev = side * (n.info.x - ls) - nat[n.finger].x;
            const cap = dev < 0 ? -HAND_REACH[n.finger][0] : HAND_REACH[n.finger][1];
            w = 1 / (cap * cap);
          }
          sw += w; sx += w * want;
        }
        ls = sx / sw;
      }
      // feasible wrist interval: this chord, then held notes, then upcoming notes
      let lo = -Infinity, hi = Infinity;
      const take = (n) => {
        const [a, b] = range(n);
        const nlo = Math.max(lo, a), nhi = Math.min(hi, b);
        if (nlo > nhi) return false;
        lo = nlo; hi = nhi; return true;
      };
      let ok = true;
      for (const n of g.notes) if (!take(n)) { ok = false; break; }
      let x;
      if (!ok) x = ls;
      else {
        // keys still held (or only just released, so the hand does not
        // leave them before they come up)
        for (let k = gi - 1; k >= 0 && g.t - groups[k].t < 6; k--)
          for (const n of groups[k].notes) if (n.end > g.t - 0.06) take(n);
        outer: for (let k = gi + 1; k < groups.length && groups[k].t - g.t < 0.45; k++)
          for (const n of groups[k].notes) if (!take(n)) break outer;
        const center = (lo + hi) / 2;
        const from = prevX ?? ls;
        x = Math.min(hi, Math.max(lo, from + (center - from) * 0.35));
      }
      prevX = x;
      const blacks = g.notes.filter((n) => n.info.black).length / g.notes.length;
      const thumbBlack = g.notes.some((n) => n.finger === 0 && n.info.black);
      // wide chords / stretches: the hand lowers and moves in so the fingers
      // can extend and spread
      let spanX = 0;
      for (const n of g.notes) for (const m of g.notes) spanX = Math.max(spanX, side * (m.info.x - n.info.x) - (nat[m.finger].x - nat[n.finger].x));
      const spread = clamp((spanX - 0.02) / 0.06, 0, 1);
      const z = baseZ - 0.028 * blacks - (thumbBlack ? 0.022 : 0) - 0.022 * spread;
      const y = baseY + 0.006 * blacks - 0.012 * spread;

      // roll towards the active side of the hand
      const fc = g.notes.reduce((s, n) => s + n.finger, 0) / g.notes.length;
      const roll = (fc - 2) * 0.04;
      // yaw from genuine thumb crossings (thumb passing under a finger, or a
      // finger crossing over the thumb) close to this onset
      let yaw = 0;
      const win = [];
      for (let k = Math.max(0, gi - 3); k < Math.min(groups.length, gi + 4); k++) {
        if (Math.abs(groups[k].t - g.t) < 0.45) win.push(...groups[k].notes);
      }
      for (const a of win) {
        if (a.finger !== 0) continue;
        for (const b of win) {
          if (b.finger === 0 || b.finger === 4 || Math.abs(a.start - b.start) > 0.35) continue;
          const cross = side * (a.info.x - b.info.x); // > 0: thumb is on the little-finger side
          if (cross <= 0) continue;
          const w = Math.exp(-Math.abs((a.start + b.start) / 2 - g.t) / 0.2);
          const amt = Math.min(0.2, 2.2 * (cross + 0.01)) * w;
          yaw += a.start > b.start ? -amt : amt; // thumb under vs finger over
        }
      }
      yaw = clamp(yaw, -0.24, 0.24);
      frames.push({ t: g.t, v: [x, y, z, yaw, roll, pitch, spread] });
    }
    if (!frames.length) {
      frames.push({ t: 0, v: [side * 0.24, baseY + 0.01, baseZ + 0.02, 0, 0, pitch, 0] });
    }

    const n = Math.ceil(this.duration / DT) + 2;
    const data = new Float32Array(n * CH);
    // transitions
    const moves = [];
    let prevEnd = -Infinity;
    for (let j = 0; j < frames.length - 1; j++) {
      const a = frames[j], b = frames[j + 1];
      let me = b.t - 0.03;
      const dist = Math.abs(b.v[0] - a.v[0]) + Math.abs(b.v[2] - a.v[2]);
      const T = clamp(0.13 + 1.4 * dist, 0.13, 0.5);
      let ms = Math.max(me - T, a.t + 0.05);
      ms = Math.min(ms, me - 0.02);
      if (ms < prevEnd) ms = prevEnd;
      if (me < ms + 0.01) me = ms + 0.01;
      moves.push([ms, me]);
      prevEnd = me;
    }
    let j = 0;
    for (let i = 0; i < n; i++) {
      const t = i * DT;
      while (j < frames.length - 1 && t >= moves[j][1]) j++;
      const o = i * CH;
      if (j < frames.length - 1 && t > moves[j][0]) {
        const s = minJerk((t - moves[j][0]) / (moves[j][1] - moves[j][0]));
        for (let c = 0; c < CH; c++) data[o + c] = lerp(frames[j].v[c], frames[j + 1].v[c], s);
      } else {
        for (let c = 0; c < CH; c++) data[o + c] = frames[j].v[c];
      }
    }
    // zero-phase Gaussian low-pass (muscle/limb inertia)
    const sm = gaussianSmooth(data, n, CH, 0.022 / DT);
    // arm-weight dip into accented notes
    for (const nt of notes) {
      const v = nt.velocity ?? 0.6;
      const i0 = Math.max(0, Math.floor((nt.start - 0.06) / DT));
      const i1 = Math.min(n - 1, Math.ceil((nt.start + 0.3) / DT));
      for (let i = i0; i <= i1; i++) {
        const u = i * DT - nt.start;
        const b = u < 0 ? Math.exp(-((u / 0.03) ** 2)) : Math.exp(-u / 0.09);
        sm[i * CH + 1] -= 0.0018 * v * b;
      }
    }
    h.track = sm;
    h.trackLen = n;
  }

  _sampleTrack(h, t, out) {
    const f = clamp(t / DT, 0, h.trackLen - 1.001);
    const i = Math.floor(f), u = f - i;
    const a = i * CH, b = a + CH;
    for (let c = 0; c < CH; c++) out[c] = h.track[a + c] * (1 - u) + h.track[b + c] * u;
    return out;
  }

  /** Planned wrist pose of a hand ('L' or 'R') at score time t (metres / radians). */
  wristAt(key, t) {
    const h = this.hands.find((x) => x.key === key);
    const w = this._sampleTrack(h, t, new Array(CH));
    return { x: w[0], y: w[1], z: w[2], yaw: w[3], roll: w[4], pitch: w[5], spread: w[6] };
  }

  // -------------------------------------------------------------- fingers
  _planFingers(h) {
    const nat = h.hand.natural;
    const tmp = new Array(CH);
    for (let f = 0; f < 5; f++) {
      const list = h.fingers[f];
      list.sort((a, b) => a.start - b.start);
      for (let k = 0; k < list.length; k++) {
        const n = list[k];
        // where along the key does this finger land?
        this._sampleTrack(h, n.start, tmp);
        // extended fingers reach further in; the thumb comes forward to the key front
        const natZ = tmp[2] + nat[f].z + (f ? -0.012 : 0.03) * tmp[6];
        n.cz = n.info.black ? clamp(natZ, -0.14, BLACK_FRONT - 0.008) : clamp(natZ, -0.13, -0.012);
        // strike the part of the key closest to where the finger naturally is
        const natX = tmp[0] + h.side * nat[f].x;
        const play = n.info.black || n.cz < BLACK_FRONT ? (n.info.black ? 0.003 : 0.002) : 0.0075;
        n.cx = clamp(natX, n.info.x - play, n.info.x + play);
        // If the hand has to move on while the key is still held (e.g. a
        // leap under pedal), the finger lets go as soon as it is out of reach.
        const dev0 = h.side * (n.cx - tmp[0]) - nat[f].x;
        const [ra, rb] = HAND_REACH[f];
        const lo = Math.min(ra, dev0) - 0.008, hi = Math.max(rb, dev0) + 0.008;
        for (let tt = n.start + 0.05; tt < n.vEnd; tt += 0.01) {
          this._sampleTrack(h, tt, tmp);
          const dev = h.side * (n.cx - tmp[0]) - nat[f].x;
          if (dev < lo || dev > hi) { n.vEnd = tt; break; }
        }
        // a finger cannot hold a key while it plays another one
        const next = list[k + 1];
        if (next && n.vEnd > next.tContact - 0.03) n.vEnd = Math.max(n.start + 0.015, next.tContact - 0.03);
      }
      for (let k = 0; k < list.length; k++) {
        const n = list[k], prev = list[k - 1];
        const free = prev ? prev.vEnd : -Infinity;
        const dx = prev ? Math.abs(n.cx - prev.cx) : 0.03;
        const A0 = clamp(0.10 + 0.9 * dx, 0.10, 0.28);
        let a = Math.max(free + 0.012, n.tContact - A0);
        if (a > n.tContact - 0.03) a = n.tContact - 0.03;
        n.aStart = a;
        n.A = n.tContact - a;
        const v = n.velocity ?? 0.6;
        n.lift = (0.006 + 0.017 * v) * clamp(n.A / 0.15, 0.3, 1) * (f === 0 ? 0.65 : 1);
      }
    }
  }

  _contact(n, t, out) {
    const d = keyDepth(n, t);
    return out.set(n.cx, keySurfaceY(n.info, d, n.cz) + PAD, n.cz);
  }

  keyDepthAt(pitch, t) {
    const arr = this.byPitch.get(pitch);
    if (!arr) return 0;
    const k = upperBound(arr, t, 'tContact');
    if (k < 0) return 0;
    let d = keyDepth(arr[k], t);
    for (let i = k - 1; i >= 0 && i >= k - 3; i--) d = Math.max(d, keyDepth(arr[i], t));
    return d;
  }

  sustainAt(t) {
    for (const p of this.pedal) {
      if (p.start - 0.06 > t) break;
      if (t <= p.end + 0.06) {
        return Math.min(smooth(p.start - 0.06, p.start, t), 1 - smooth(p.end, p.end + 0.06, t));
      }
    }
    return 0;
  }

  /** Pose both hands for score time t. */
  update(t) {
    this.pressing.length = 0;
    for (const h of this.hands) this._poseHand(h, t);
  }

  _poseHand(h, t) {
    const { hand, side } = h;
    const nat = hand.natural;
    const w = this._sampleTrack(h, t, this._w || (this._w = new Array(CH)));
    hand.setWrist(w[0], w[1], w[2], w[3], w[4], w[5]);

    const S = h.state;
    const vLocal = this._vl || (this._vl = new THREE.Vector3());
    const tmp = this._tmp || (this._tmp = new THREE.Vector3());

    // 1. classify each finger
    for (let f = 0; f < 5; f++) {
      const list = h.fingers[f];
      const st = S[f];
      const k = upperBound(list, t, 'tContact');
      const cur = k >= 0 ? list[k] : null;
      const next = list[k + 1] || null;
      st.cur = cur; st.next = next;
      st.w = 0; st.dev = 0;
      if (cur && t <= cur.vEnd) {
        st.mode = 'press';
        this._contact(cur, t, st.pos);
        st.w = 1;
      } else {
        const rel = cur && t < cur.vEnd + RELEASE;
        const app = next && t >= next.aStart;
        st.mode = app ? 'approach' : rel ? 'release' : 'rest';
        if (app) {
          st.s = clamp((t - next.aStart) / next.A, 0, 1);
          st.target = this._contact(next, next.tContact, st.target || new THREE.Vector3());
          st.w = smooth(0, 0.6, st.s);
        } else if (rel) {
          st.u = (t - cur.vEnd) / RELEASE;
          st.w = 1 - smooth(0, 1, st.u);
        }
      }
      if (st.w > 0) {
        const ref = st.mode === 'approach' ? st.target : st.mode === 'press' ? st.pos : this._contact(cur, t, tmp);
        hand.toLocal(ref, vLocal);
        st.dev = vLocal.x - nat[f].x;
      }
    }

    // 2. relaxed position of every finger, following engaged neighbours
    const rest = this._rest || (this._rest = [0, 1, 2, 3, 4].map(() => new THREE.Vector3()));
    for (let f = 0; f < 5; f++) {
      let lo = -1, hi = -1;
      for (let a = f - 1; a >= 1; a--) if (S[a].w > 0) { lo = a; break; }
      for (let b = f + 1; b <= 4; b++) if (S[b].w > 0) { hi = b; break; }
      let dev = 0;
      if (f === 0) dev = S[1].w > 0 ? 0.45 * S[1].dev * S[1].w : 0;
      else if (lo > 0 && hi > 0) dev = 0.8 * lerp(S[lo].dev * S[lo].w, S[hi].dev * S[hi].w, (f - lo) / (hi - lo));
      else if (lo > 0) dev = 0.5 * S[lo].dev * S[lo].w;
      else if (hi > 0) dev = 0.5 * S[hi].dev * S[hi].w;
      vLocal.copy(nat[f]);
      vLocal.x += clamp(dev, -0.03, 0.03);
      hand.toWorld(vLocal, rest[f]);
      // tendon coupling: idle fingers sag a little when neighbours press
      let sag = 0;
      const nb = [f - 1, f + 1].filter((i) => i >= 0 && i <= 4);
      for (const i of nb) if (S[i].mode === 'press') sag += (f === 3 || i === 3 ? 0.0045 : 0.0028);
      rest[f].y -= sag;
      const floor = restSurfaceAt(rest[f].x, rest[f].z) + PAD + 0.0035;
      if (rest[f].y < floor) rest[f].y = floor;
    }

    // 3. final targets
    const thumbPressX = S[0].mode === 'press' ? S[0].pos.x : null;
    for (let f = 0; f < 5; f++) {
      const st = S[f];
      if (st.mode === 'press') {
        this.pressing.push({ hand: h.key, finger: f, pos: st.pos });
      } else {
        // free position: relaxing after a release, or resting
        const free = tmp;
        if (st.cur && t < st.cur.vEnd + RELEASE) {
          const u = clamp((t - st.cur.vEnd) / RELEASE, 0, 1);
          this._contact(st.cur, t, free);
          const e = smooth(0, 1, u);
          free.lerp(rest[f], e);
          free.y += 0.004 * Math.sin(Math.PI * u);
        } else free.copy(rest[f]);

        if (st.mode === 'approach') {
          const s = st.s, n = st.next;
          const hb = smooth(0, 0.78, s);
          const to = st.target;
          let lift = n.lift;
          if (f > 0 && thumbPressX != null && (free.x - thumbPressX) * (to.x - thumbPressX) < 0) lift += 0.016;
          st.pos.set(lerp(free.x, to.x, hb), 0, lerp(free.z, to.z, hb));
          const yb = lerp(free.y, to.y, smooth(0, 1, s));
          st.pos.y = yb + lift * Math.sin(Math.PI * Math.pow(s, 0.7));
        } else {
          st.pos.copy(free);
        }
      }
      hand.reach(f, st.pos);
    }
  }
}

function gaussianSmooth(data, n, ch, sigma) {
  const r = Math.ceil(sigma * 3);
  const k = [];
  let ks = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); ks += v; }
  for (let i = 0; i < k.length; i++) k[i] /= ks;
  const out = new Float32Array(data.length);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      let s = 0;
      for (let q = -r; q <= r; q++) {
        const ii = clamp(i + q, 0, n - 1);
        s += data[ii * ch + c] * k[q + r];
      }
      out[i * ch + c] = s;
    }
  }
  return out;
}
