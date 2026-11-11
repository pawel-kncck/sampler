// Motion planning: turns a fingered score into hand and finger motion.
//
// Everything here is a deterministic function of score time, so playback can
// be paused, scrubbed or slowed down freely.
//
//  * Wrist: one key-frame per chord/note onset. Each onset allows a range of
//    wrist positions (those from which its notes and the keys still held
//    are within the fingers' sideways reach); the wrist takes the calmest
//    path through those ranges. Key-frames are joined with unhurried
//    minimum-jerk moves that arrive just before the onset, then low-pass
//    filtered. The hand turns with the forearm and for thumb crossings, and
//    rolls towards the active fingers. Reach limits, the hand's turn and
//    the resulting wrist travel are calibrated against real pianists (see
//    tools/pianomotion).
//  * Fingers: each finger is either pressing a key (tip locked to the moving
//    key surface), approaching the next key (lift–strike arc that hits the
//    key with velocity), releasing (rides the key up, relaxes), or resting
//    (relaxed curl that follows its neighbours, incl. tendon coupling).
//  * Tips are placed with IK on the anatomical skeleton (see hand.js).
import * as THREE from 'three';
import { keyInfo, keySurfaceY, restSurfaceAt, BLACK_FRONT } from './piano.js';
import { groupByOnset } from './fingering.js';
import { ARM, YAW_PER_METRE } from './hand.js';

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

// How far each fingertip can comfortably deviate sideways from its resting
// place over "its" key, as [towards thumb side, towards little-finger side] in
// metres (hand coordinates). The thumb can pass under the hand; the outer
// fingers have more room to spread outwards than inwards.
const HAND_REACH = [[-0.015, 0.045], [-0.016, 0.015], [-0.015, 0.015], [-0.013, 0.014], [-0.010, 0.015]];
// Pull of the wrist towards the comfortable centre of its reachable range,
// relative to the cost of moving (see _buildTrack). It only matters where the
// reach limits leave the wrist free; the limits themselves shape the path.
const CENTRE_PULL = 0.03;

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
    const baseZ = -0.02 - nat[0].z; // the thumb, the shortest reach, rests 2 cm inside the key fronts
    const baseY = 0.004 + PAD - nat[4].y;
    const pitch = -0.035;
    // The hand stays partly in line with the forearm, so it turns as the
    // wrist travels sideways: theta = K * (x - x0), positive = fingers point
    // towards the high notes. A turn moves each fingertip sideways by its
    // lever (distance ahead of the wrist) times the angle.
    const x0 = side * ARM.straightX;
    const K = YAW_PER_METRE;
    const lever = nat.map((v) => -v.z);
    h.lever = lever;

    const groups = groupByOnset(notes);
    const G = groups.length;

    // Extra turn for genuine thumb crossings (thumb passing under a finger,
    // or a finger crossing over the thumb) close to each onset. Track units:
    // positive = towards the thumb side.
    const cross = new Float64Array(G);
    for (let gi = 0; gi < G; gi++) {
      const g = groups[gi];
      const win = [];
      for (let k = Math.max(0, gi - 3); k < Math.min(G, gi + 4); k++) {
        if (Math.abs(groups[k].t - g.t) < 0.45) win.push(...groups[k].notes);
      }
      let c = 0;
      for (const a of win) {
        if (a.finger !== 0) continue;
        for (const b of win) {
          if (b.finger === 0 || b.finger === 4 || Math.abs(a.start - b.start) > 0.35) continue;
          const over = side * (a.info.x - b.info.x); // > 0: thumb is on the little-finger side
          if (over <= 0) continue;
          const wt = Math.exp(-Math.abs((a.start + b.start) / 2 - g.t) / 0.2);
          const amt = Math.min(0.12, 1.5 * (over + 0.01)) * wt;
          c += a.start > b.start ? -amt : amt; // thumb under vs finger over
        }
      }
      cross[gi] = clamp(c, -0.12, 0.12);
    }

    // Wrist positions for a note at onset gi: `zero` puts the finger exactly
    // over the key; [lo, hi] keeps it within comfortable sideways reach.
    const range = (n, gi) => {
      const f = n.finger;
      const Gf = 1 + lever[f] * K;
      const C = n.info.x - side * nat[f].x + lever[f] * (K * x0 + side * cross[gi]);
      const [a, b] = HAND_REACH[f];
      return side > 0 ? { zero: C / Gf, lo: (C - b) / Gf, hi: (C - a) / Gf } : { zero: C / Gf, lo: (C + a) / Gf, hi: (C + b) / Gf };
    };

    // 1. corridor: for every onset, the wrist positions from which all of its
    //    notes (and the keys still held) can be reached
    const lo = new Float64Array(G), hi = new Float64Array(G), mid = new Float64Array(G);
    for (let gi = 0; gi < G; gi++) {
      const g = groups[gi];
      const rs = g.notes.map((n) => range(n, gi));
      let a = Math.max(...rs.map((r) => r.lo)), b = Math.min(...rs.map((r) => r.hi));
      // comfortable centre: fingers stretch in proportion to their capacity
      let c = rs.reduce((s, r) => s + r.zero, 0) / rs.length;
      if (a > b) {
        // wider than a comfortable hand: share the stretch between the outer fingers
        for (let it = 0; it < 3; it++) {
          let sw = 0, sx = 0;
          g.notes.forEach((n, i) => {
            const dev = side * (rs[i].zero - c);
            const cap = dev < 0 ? -HAND_REACH[n.finger][0] : HAND_REACH[n.finger][1];
            const w = 1 / (cap * cap);
            sw += w; sx += w * rs[i].zero;
          });
          c = sx / sw;
        }
        a = b = c;
      } else {
        c = clamp(c, a, b);
        // keys still held, or only just released (the hand should not leave before they come up)
        for (let k = gi - 1; k >= 0 && g.t - groups[k].t < 6; k--) {
          for (const n of groups[k].notes) {
            if (n.end <= g.t - 0.06) continue;
            const r = range(n, gi);
            const na = Math.max(a, r.lo), nb = Math.min(b, r.hi);
            if (na <= nb) { a = na; b = nb; }
            // just out of reach: stay as close as possible. Further than
            // that, the finger simply lets go of the key (see _planFingers).
            else if (r.hi < a && a - r.hi < 0.005) b = a;
            else if (r.lo > b && r.lo - b < 0.005) a = b;
          }
        }
      }
      lo[gi] = a; hi[gi] = b; mid[gi] = clamp(c, a, b);
    }
    // 2. economy of motion: the calmest path through the corridor. It
    //    minimises wrist speed while being pulled gently towards the
    //    comfortable centre, so the wrist follows slow changes of register
    //    and lets the fingers take care of quick ones.
    const x = Float64Array.from(mid);
    const w = new Float64Array(Math.max(0, G - 1));
    for (let gi = 0; gi < G - 1; gi++) w[gi] = 1 / (groups[gi + 1].t - groups[gi].t + 0.08);
    for (let it = 0; it < 80; it++) {
      let change = 0;
      for (let pass = 0; pass < 2; pass++) {
        for (let q = 0; q < G; q++) {
          const gi = pass ? G - 1 - q : q;
          let sw = CENTRE_PULL, sx = CENTRE_PULL * mid[gi];
          if (gi > 0) { sw += w[gi - 1]; sx += w[gi - 1] * x[gi - 1]; }
          if (gi < G - 1) { sw += w[gi]; sx += w[gi] * x[gi + 1]; }
          const v = clamp(sx / sw, lo[gi], hi[gi]);
          change = Math.max(change, Math.abs(v - x[gi]));
          x[gi] = v;
        }
      }
      if (change < 2e-5) break;
    }

    const frames = [];
    for (let gi = 0; gi < G; gi++) {
      const g = groups[gi];
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
      // turn with the forearm (track units: positive = towards the thumb
      // side), plus the extra for thumb crossings
      const yaw = -side * K * (x[gi] - x0) + cross[gi];
      frames.push({ t: g.t, v: [x[gi], y, z, yaw, roll, pitch, spread], rel: Math.max(...g.notes.map((n) => n.end)) });
    }
    if (!frames.length) {
      frames.push({ t: 0, v: [side * 0.24, baseY + 0.01, baseZ + 0.02, -side * K * (side * 0.24 - x0), 0, pitch, 0], rel: 0 });
    }

    const n = Math.ceil(this.duration / DT) + 2;
    const data = new Float32Array(n * CH);
    // 3. moves between key-frames: unhurried, starting when the previous keys
    //    are released (so the hand arrives early and waits when there is
    //    time) and always arriving just before the next onset
    const moves = [];
    let prevEnd = -Infinity;
    for (let j = 0; j < frames.length - 1; j++) {
      const a = frames[j], b = frames[j + 1];
      const me = b.t - 0.03;
      const dist = Math.abs(b.v[0] - a.v[0]) + Math.abs(b.v[2] - a.v[2]);
      const T = clamp(0.3 + 2.2 * dist, 0.3, 1.0);
      let ms = Math.max(a.t + 0.06, Math.min(a.rel - 0.05, me - T));
      ms = Math.min(ms, me - 0.02);
      if (ms < prevEnd) ms = prevEnd;
      let end = Math.min(me, ms + T);
      if (end < ms + 0.01) end = ms + 0.01;
      moves.push([ms, end]);
      prevEnd = end;
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
    const sm = gaussianSmooth(data, n, CH, 0.03 / DT);
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
    const target = new THREE.Vector3(), tip = new THREE.Vector3();
    const place = (n, f) => {
      // Where along the key does this finger land? Start from where the
      // relaxed fingertip is for the wrist pose at the onset (including the
      // hand's turn).
      this._sampleTrack(h, n.start, tmp);
      const psi = h.side * tmp[3]; // world rotation about the vertical axis
      const lx = h.side * nat[f].x, lz = nat[f].z;
      const natX = tmp[0] + lx * Math.cos(psi) + lz * Math.sin(psi);
      // extended fingers reach further in; the thumb comes forward to the key front
      const natZ = tmp[2] - lx * Math.sin(psi) + lz * Math.cos(psi) + (f ? -0.012 : 0.03) * tmp[6];
      n.cz = n.info.black ? clamp(natZ, -0.14, BLACK_FRONT - 0.008) : clamp(natZ, -0.13, -0.012);
      // strike the part of the key closest to where the finger naturally is
      const play = n.info.black || n.cz < BLACK_FRONT ? (n.info.black ? 0.003 : 0.002) : 0.0075;
      n.cx = clamp(natX, n.info.x - play, n.info.x + play);
      // can the finger get there at all? (a chord wider than the hand cannot be played as written)
      h.hand.setWrist(tmp[0], tmp[1], tmp[2], tmp[3], tmp[4], tmp[5]);
      h.hand.reach(f, this._contact(n, n.start, target));
      n.unreachable = h.hand.fingers[f].tipWorld(tip).distanceTo(target) > 0.008;
    };
    for (let f = 0; f < 5; f++) {
      h.fingers[f].sort((a, b) => a.start - b.start);
      for (const n of h.fingers[f]) place(n, f);
      // keys out of reach still go down and sound, but no finger is sent to them
      const list = h.fingers[f] = h.fingers[f].filter((n) => !n.unreachable);
      for (let k = 0; k < list.length; k++) {
        const n = list[k];
        // If the hand has to move on while the key is still held (e.g. a
        // leap under pedal), the finger lets go as soon as the key is out of
        // its reach.
        for (let tt = n.start + 0.04; tt < n.vEnd; tt += 0.02) {
          this._sampleTrack(h, tt, tmp);
          h.hand.setWrist(tmp[0], tmp[1], tmp[2], tmp[3], tmp[4], tmp[5]);
          h.hand.reach(f, this._contact(n, tt, target));
          if (h.hand.fingers[f].tipWorld(tip).distanceTo(target) > 0.003) { n.vEnd = Math.max(n.start + 0.02, tt - 0.02); break; }
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
