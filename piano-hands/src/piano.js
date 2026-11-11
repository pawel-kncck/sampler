// Piano keyboard: real-world dimensions (metres), key layout and 3D model.
//
// Coordinate system used everywhere in the app:
//   x – along the keyboard (low notes at -x, high notes at +x)
//   y – up (top surface of the white keys is y = 0)
//   z – towards the player (front edge of the white keys is z = 0,
//       keys extend to z = -WHITE_L)
import * as THREE from 'three';

export const WHITE_W = 0.0235;      // white key pitch (octave = 164.5 mm)
export const KEY_GAP = 0.0011;
export const WHITE_L = 0.150;
export const WHITE_H = 0.022;
export const BLACK_W = 0.0137;
export const BLACK_L = 0.095;
export const BLACK_H = 0.0125;      // black key top above white key top
export const BLACK_FRONT = -(WHITE_L - BLACK_L); // z of black key front edge
export const KEY_TRAVEL = 0.010;    // key dip measured at the white key front
export const PIVOT_Z = -0.50;       // virtual balance point of the key lever
export const LOWEST = 21;           // A0
export const HIGHEST = 108;         // C8

const BLACK_PC = new Set([1, 3, 6, 8, 10]);
// Offsets of black keys from the gap between their white neighbours,
// in units of white key width (real pianos are not symmetric).
const BLACK_OFFSET = { 1: -0.10, 3: 0.10, 6: -0.13, 8: 0, 10: 0.13 };

export const isBlack = (p) => BLACK_PC.has(((p % 12) + 12) % 12);

const whiteIndex = new Map();
{
  let wi = 0;
  for (let p = LOWEST; p <= HIGHEST; p++) if (!isBlack(p)) whiteIndex.set(p, wi++);
}
export const WHITE_COUNT = whiteIndex.size; // 52
const KEYBOARD_HALF = (WHITE_COUNT * WHITE_W) / 2;

export function keyX(p) {
  if (!isBlack(p)) return (whiteIndex.get(p) + 0.5) * WHITE_W - KEYBOARD_HALF;
  const lower = (whiteIndex.get(p - 1) + 1) * WHITE_W - KEYBOARD_HALF; // boundary
  return lower + BLACK_OFFSET[((p % 12) + 12) % 12] * WHITE_W;
}

export function keyInfo(p) {
  const black = isBlack(p);
  return {
    pitch: p,
    black,
    x: keyX(p),
    halfWidth: (black ? BLACK_W : WHITE_W - KEY_GAP) / 2,
    topY: black ? BLACK_H : 0,
    zFront: black ? BLACK_FRONT : 0,
    zBack: -WHITE_L,
  };
}

const MAX_ANGLE = Math.atan(KEY_TRAVEL / -PIVOT_Z);

/** Height of a key's top surface at depth z, for a key depressed by `depth` (0..1). */
export function keySurfaceY(info, depth, z) {
  return info.topY - depth * KEY_TRAVEL * ((z - PIVOT_Z) / -PIVOT_Z);
}

/** Highest key surface under the point (x, z) with all keys at rest. */
export function restSurfaceAt(x, z) {
  if (z < BLACK_FRONT + 0.002) {
    // is there a black key under us?
    const approx = Math.round(((x + KEYBOARD_HALF) / WHITE_W) * (12 / 7)) + LOWEST;
    for (let p = approx - 3; p <= approx + 3; p++) {
      if (p < LOWEST || p > HIGHEST || !isBlack(p)) continue;
      if (Math.abs(keyX(p) - x) < BLACK_W / 2 + 0.002) return BLACK_H;
    }
  }
  return 0;
}

/** Horizontal extent of the keyboard. */
export function keyboardBounds() {
  return { minX: -KEYBOARD_HALF, maxX: KEYBOARD_HALF };
}

// ---------------------------------------------------------------------------
// 3D model

function whiteKeyGeometry(p) {
  const info = keyInfo(p);
  const w = (WHITE_W - KEY_GAP) / 2;
  const notchY = -BLACK_FRONT + KEY_GAP * 0.5; // distance from front where black keys start
  let left = -w;
  let right = w;
  if (p - 1 >= LOWEST && isBlack(p - 1)) left = keyX(p - 1) + BLACK_W / 2 + KEY_GAP - info.x;
  if (p + 1 <= HIGHEST && isBlack(p + 1)) right = keyX(p + 1) - BLACK_W / 2 - KEY_GAP - info.x;

  // Shape drawn in (x, distance-from-front) and extruded upwards.
  const s = new THREE.Shape();
  s.moveTo(-w, 0);
  s.lineTo(w, 0);
  if (right < w) { s.lineTo(w, notchY); s.lineTo(right, notchY); s.lineTo(right, WHITE_L); }
  else s.lineTo(w, WHITE_L);
  if (left > -w) { s.lineTo(left, WHITE_L); s.lineTo(left, notchY); s.lineTo(-w, notchY); }
  else s.lineTo(-w, WHITE_L);
  s.lineTo(-w, 0);

  const g = new THREE.ExtrudeGeometry(s, { depth: WHITE_H, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); // (sx, sy, sz) -> (sx, sz, -sy)
  g.translate(0, -WHITE_H, 0);
  return g;
}

function blackKeyGeometry() {
  const h = BLACK_H + 0.012;
  const g = new THREE.BoxGeometry(BLACK_W, h, BLACK_L, 1, 1, 1).toNonIndexed();
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (y > 0) {
      x *= 0.80; // tapered top
      if (z > 0) z -= 0.009; // sloped front
    }
    pos.setXYZ(i, x, y + BLACK_H - h / 2, z - BLACK_L / 2);
  }
  g.computeVertexNormals();
  return g;
}

export class Piano {
  constructor(materials) {
    this.group = new THREE.Group();
    this.keys = new Map(); // pitch -> { pivot, info }
    const lineMat = materials.line;

    const blackGeo = blackKeyGeometry();
    const blackEdges = new THREE.EdgesGeometry(blackGeo, 25);

    for (let p = LOWEST; p <= HIGHEST; p++) {
      const info = keyInfo(p);
      const pivot = new THREE.Group();
      pivot.position.set(info.x, 0, PIVOT_Z);
      const holder = new THREE.Group();
      holder.position.set(0, 0, -PIVOT_Z); // key front at local z=0 relative to pivot
      pivot.add(holder);
      let geo, edges, mat;
      if (info.black) {
        geo = blackGeo; edges = blackEdges; mat = materials.blackKey;
        holder.position.z = -PIVOT_Z + BLACK_FRONT;
      } else {
        geo = whiteKeyGeometry(p); edges = new THREE.EdgesGeometry(geo, 25); mat = materials.whiteKey;
      }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      holder.add(mesh);
      holder.add(new THREE.LineSegments(edges, lineMat));
      this.group.add(pivot);
      this.keys.set(p, { pivot, info, depth: 0 });
    }
    this._buildCase(materials);
  }

  setDepth(p, depth) {
    const k = this.keys.get(p);
    if (!k || k.depth === depth) return;
    k.depth = depth;
    k.pivot.rotation.x = depth * MAX_ANGLE;
  }

  _box(w, h, d, x, y, z, mat, lineMat, parent = this.group) {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), lineMat));
    parent.add(m);
    return m;
  }

  _buildCase(materials) {
    const mat = materials.case;
    const dark = materials.caseDark;
    const L = materials.line;
    const half = KEYBOARD_HALF;
    const W = 2 * half;
    // key bed & key slip (front rail)
    this._box(W + 0.004, 0.02, 0.17, 0, -WHITE_H - 0.012, -0.075, dark, L);
    this._box(W + 0.11, 0.035, 0.022, 0, -WHITE_H - 0.012, 0.014, mat, L);
    // cheek blocks
    for (const s of [-1, 1]) this._box(0.05, 0.075, 0.24, s * (half + 0.028), -0.006, -0.085, mat, L);
    // low back rail behind the keys (slim console – leaves the hands
    // visible from every side)
    this._box(W + 0.006, 0.05, 0.03, 0, 0.012, -WHITE_L - 0.018, mat, L);
    this._box(W + 0.11, 0.012, 0.09, 0, 0.042, -WHITE_L - 0.04, mat, L);
    // case under the keys
    this._box(W + 0.11, 0.06, 0.25, 0, -WHITE_H - 0.05, -0.1, mat, L);
    // side panels / legs and a stretcher with the pedal box
    for (const s of [-1, 1]) this._box(0.035, 0.62, 0.30, s * (half + 0.037), -0.39, -0.11, mat, L);
    this._box(W + 0.04, 0.12, 0.018, 0, -0.56, -0.2, materials.panel, L);
    this._box(0.26, 0.05, 0.12, 0, -0.675, -0.12, mat, L);
    // pedals
    this.pedals = [];
    for (const [i, x] of [-0.06, 0, 0.06].entries()) {
      const pivot = new THREE.Group();
      pivot.position.set(x, -0.66, -0.1);
      this.group.add(pivot);
      const pedal = this._box(0.03, 0.008, 0.11, 0, 0, 0.055, dark, L, pivot);
      pedal.castShadow = false;
      this.pedals.push(pivot);
      if (i === 2) this.sustainPedal = pivot;
    }
  }

  setSustain(amount) {
    if (this.sustainPedal) this.sustainPedal.rotation.x = amount * 0.12;
  }
}
