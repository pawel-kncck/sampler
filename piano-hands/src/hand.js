// Skeletal hand with anthropometric bone lengths and analytic finger IK.
//
// Hand-local frame (right-hand convention; the left hand is a mirror image,
// obtained with scale.x = -1 on the root):
//   origin = wrist joint centre, -z = towards the fingertips,
//   +y = back of the hand, thumb on the -x side.
import * as THREE from 'three';

// Bone lengths in metres for an average adult hand (hand length ≈ 19 cm,
// breadth ≈ 8.5 cm, span thumb–little finger ≈ 21 cm). Values follow
// published phalanx/metacarpal measurements.
//
// `home` is where each fingertip rests, in hand-local coordinates: a relaxed,
// gently arched hand with the five tips over five neighbouring white keys
// (23.5 mm apart) and the thumb, being shorter, nearer the front of the keys. The resting
// joint angles are solved from it. `coupling` is DIP flexion as a fraction of
// PIP flexion; it is lower than in free-air curling because the pad rests on
// a key.
export const KEY_PITCH = 0.0235;
export const FINGERS = [
  { // thumb – the "metacarpal" segment pivots at the CMC (saddle) joint and
    // runs along the radial edge of the palm; flexion curls the tip down and
    // in towards the palm (the frame is rolled accordingly)
    name: 'thumb',
    base: [-0.03, -0.012, -0.03],
    yaw: 0.45, pitch: -0.16, roll: 0.6,
    len: [0.046, 0.032, 0.025],
    rad: [0.0128, 0.0102, 0.0094],
    coupling: 0.6,
    abd: [-0.6, 0.6], flex1: [-0.8, 1.0], flex2: 1.2,
    home: [-0.0085 - 2 * KEY_PITCH, -0.046, -0.108],
  },
  {
    name: 'index', base: [-0.027, 0.004, -0.088], yaw: 0.10, pitch: 0, roll: 0,
    len: [0.040, 0.0235, 0.0195], rad: [0.0094, 0.0084, 0.0077],
    coupling: 0.5, abd: [-0.4, 0.4], flex1: [-0.35, 1.55], flex2: 1.85,
    home: [-0.0085 - KEY_PITCH, -0.0455, -0.129],
  },
  {
    name: 'middle', base: [-0.0085, 0.0065, -0.091], yaw: 0, pitch: 0, roll: 0,
    len: [0.0445, 0.0275, 0.0205], rad: [0.0097, 0.0087, 0.0079],
    coupling: 0.5, abd: [-0.35, 0.35], flex1: [-0.35, 1.55], flex2: 1.85,
    home: [-0.0085, -0.0455, -0.135],
  },
  {
    name: 'ring', base: [0.0095, 0.0045, -0.0855], yaw: -0.105, pitch: 0, roll: 0,
    len: [0.0415, 0.026, 0.020], rad: [0.0091, 0.0082, 0.0075],
    coupling: 0.5, abd: [-0.33, 0.33], flex1: [-0.35, 1.55], flex2: 1.85,
    home: [-0.0085 + KEY_PITCH, -0.0455, -0.127],
  },
  {
    name: 'little', base: [0.0265, -0.001, -0.0755], yaw: -0.25, pitch: 0, roll: 0.06,
    len: [0.0335, 0.0195, 0.018], rad: [0.0082, 0.0074, 0.0069],
    coupling: 0.5, abd: [-0.5, 0.35], flex1: [-0.35, 1.55], flex2: 1.85,
    home: [-0.0085 + 2 * KEY_PITCH, -0.041, -0.1135],
  },
];

// Forearm model: the elbow sits beside the body and follows part of the
// wrist's sideways travel. The hand takes up most of the forearm's turn, and
// points straight along the keys a little inside the elbow's rest position
// (pianists' wrists are slightly bent outwards when playing in front of the
// body). The last two values are fitted to real pianists' hand directions.
export const ARM = {
  shoulderX: 0.21,   // elbow rest position, metres from the keyboard middle
  elbowFollow: 0.45, // fraction of the wrist's sideways travel the elbow follows
  length: 0.29,      // wrist to elbow, along the keys' depth
  handFollow: 0.75,  // fraction of the forearm's turn that the hand takes up
  straightX: 0.12,   // wrist position (metres from the middle) where the hand points straight ahead
};
/** How much the hand turns (radians) per metre the wrist moves sideways. */
export const YAW_PER_METRE = (ARM.handFollow * (1 - ARM.elbowFollow)) / ARM.length;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function capsule(radius, length, radiusEnd = radius) {
  // a slightly tapered capsule along -z, starting at the origin
  const g = new THREE.CapsuleGeometry(1, 1, 6, 14);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // CapsuleGeometry: along y, cylinder part from -0.5..0.5, caps beyond
    const tt = clamp(y + 0.5, 0, 1); // 0 at start, 1 at end
    const r = radius + (radiusEnd - radius) * tt;
    let ny;
    if (y > 0.5) ny = length + (y - 0.5) * radiusEnd;
    else if (y < -0.5) ny = (y + 0.5) * radius;
    else ny = tt * length;
    pos.setXYZ(i, x * r, z * r * 0.92, -ny);
  }
  g.computeVertexNormals();
  return g;
}

function palmGeometry() {
  // Superellipsoid slab, reshaped so the front edge follows the knuckle line
  // and the back of the hand is gently arched.
  const g = new THREE.SphereGeometry(1, 40, 28);
  const pos = g.attributes.position;
  const kn = FINGERS.slice(1).map((f) => f.base); // knuckles
  const xL = kn[0][0] - 0.0085, xR = kn[3][0] + 0.0085;
  const frontAt = (x) => {
    for (let i = 0; i < 3; i++) {
      if (x <= kn[i + 1][0]) {
        const t = clamp((x - kn[i][0]) / (kn[i + 1][0] - kn[i][0]), 0, 1);
        return kn[i][2] + (kn[i + 1][2] - kn[i][2]) * t;
      }
    }
    return kn[3][2];
  };
  const se = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    x = se(x, 0.55); z = se(z, 0.6); y = se(y, 0.8);
    const u = (x + 1) / 2; // 0 thumb side .. 1 little finger side
    const hx = xL + (xR - xL) * u;
    const front = frontAt(hx) - 0.002;
    const back = 0.012 + 0.008 * Math.abs(x);
    const v = (z + 1) / 2; // 0 front .. 1 wrist
    const hz = front + (back - front) * v;
    const arch = 0.0065 * (1 - x * x) * (1 - 0.4 * v);
    const top = 0.0125 + arch, bottom = -0.0165 - 0.003 * (1 - u) * (1 - v);
    const thin = 1 - 0.25 * v; // slightly thinner towards the wrist
    const hy = (y > 0 ? y * top : -y * bottom) * thin + (1 - thin) * 0.002;
    pos.setXYZ(i, hx, hy, hz);
  }
  g.computeVertexNormals();
  return g;
}

class Finger {
  constructor(root, def, mats, index) {
    this.def = def;
    this.index = index;
    this.base = new THREE.Object3D();
    this.base.position.set(...def.base);
    this.base.rotation.set(def.pitch, def.yaw, def.roll, 'YXZ');
    root.add(this.base);

    this.abd = new THREE.Object3D();
    this.base.add(this.abd);
    this.j = [];
    let parent = this.abd;
    for (let s = 0; s < 3; s++) {
      const j = new THREE.Object3D();
      if (s > 0) j.position.set(0, 0, -def.len[s - 1]);
      parent.add(j);
      const r0 = def.rad[s];
      const r1 = s < 2 ? def.rad[s + 1] : def.rad[s] * 0.9;
      const geo = capsule(r0, def.len[s], r1 * (s === 2 ? 1 : 0.98));
      addMesh(j, geo, mats);
      this.j.push(j);
      parent = j;
    }
    // fingernail
    const tipJ = this.j[2];
    const nailGeo = new THREE.SphereGeometry(1, 14, 8);
    const nail = new THREE.Mesh(nailGeo, mats.nail);
    const dl = def.len[2];
    nail.scale.set(def.rad[2] * 0.72, def.rad[2] * 0.2, dl * 0.36);
    nail.position.set(0, def.rad[2] * 0.82, -dl * 0.62);
    nail.rotation.x = -0.08;
    if (index === 0) nail.position.y = def.rad[2] * 0.85;
    tipJ.add(nail);
    const nailOutline = new THREE.Mesh(nailGeo, mats.outlineThin);
    nail.add(nailOutline);

    this.tipOffset = new THREE.Vector3(0, 0, -def.len[2]);
    this.angles = { abd: 0, f1: 0, f2: 0 };
  }

  setAngles(abd, f1, f2) {
    const d = this.def;
    abd = clamp(abd, d.abd[0], d.abd[1]);
    f1 = clamp(f1, d.flex1[0], d.flex1[1]);
    f2 = clamp(f2, 0, d.flex2);
    this.angles.abd = abd; this.angles.f1 = f1; this.angles.f2 = f2;
    this.abd.rotation.y = abd;
    this.j[0].rotation.x = -f1;
    this.j[1].rotation.x = -f2;
    this.j[2].rotation.x = -f2 * d.coupling;
  }

  /** Planar chain position (forward u, up w) of the tip for flexion f2 with f1 = 0. */
  _chain(f2) {
    const [L1, L2, L3] = this.def.len;
    const f3 = f2 * this.def.coupling;
    return [
      L1 + L2 * Math.cos(f2) + L3 * Math.cos(f2 + f3),
      -L2 * Math.sin(f2) - L3 * Math.sin(f2 + f3),
    ];
  }

  /** Solve IK so that the tip reaches `t` given in this finger's base frame. */
  solveLocal(t, bias = 0) {
    const d = this.def;
    const h = Math.hypot(t.x, t.z);
    const abd = Math.atan2(-t.x, -t.z);
    const u = h, w = t.y;
    const D = Math.hypot(u, w);
    let lo = 0, hi = d.flex2;
    const len = (f2) => { const c = this._chain(f2); return Math.hypot(c[0], c[1]); };
    let f2;
    if (D >= len(0)) f2 = 0;
    else if (D <= len(hi)) f2 = hi;
    else {
      for (let i = 0; i < 22; i++) {
        const m = (lo + hi) / 2;
        if (len(m) > D) lo = m; else hi = m;
      }
      f2 = (lo + hi) / 2;
    }
    const c = this._chain(f2);
    const f1 = Math.atan2(c[1], c[0]) - Math.atan2(w, u) + bias;
    this.setAngles(abd, f1, f2);
  }

  tipWorld(out) {
    return this.j[2].localToWorld(out.copy(this.tipOffset));
  }
}

function addMesh(parent, geo, mats) {
  const m = new THREE.Mesh(geo, mats.skin);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  const o = new THREE.Mesh(geo, mats.outline);
  parent.add(o);
  return m;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class Hand {
  /** side: +1 right hand, -1 left hand */
  constructor(side, mats) {
    this.side = side;
    this.root = new THREE.Group();
    this.root.scale.x = side; // mirror for the left hand
    this.hand = new THREE.Group();
    this.root.add(this.hand);

    addMesh(this.hand, palmGeometry(), mats);
    this.fingers = FINGERS.map((def, i) => new Finger(this.hand, def, mats, i));

    // Forearm (in world space, not mirrored, so build it separately)
    this.arm = new THREE.Group();
    // forearm: a tapered, slightly flattened tube that fades out towards the
    // elbow (in metres along +z of the arm group)
    const ARM_LEN = 0.26;
    const armGeo = new THREE.CylinderGeometry(0.034, 0.0225, ARM_LEN, 24, 12, true);
    armGeo.rotateX(Math.PI / 2);
    armGeo.translate(0, 0, ARM_LEN / 2);
    {
      // muscle bulge in the upper forearm
      const pos = armGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i) / ARM_LEN;
        const k = 1 + 0.12 * Math.sin(Math.PI * Math.min(1, z * 1.3)) * z;
        pos.setXY(i, pos.getX(i) * k, pos.getY(i) * k);
      }
      armGeo.computeVertexNormals();
    }
    this.armMesh = new THREE.Mesh(armGeo, mats.arm);
    this.armMesh.castShadow = true;
    this.armMesh.scale.set(1.3, 0.8, 1);
    this.arm.add(this.armMesh);
    const armOutline = new THREE.Mesh(armGeo, mats.armOutline);
    this.armMesh.add(armOutline);
    const wristGeo = new THREE.SphereGeometry(0.0225, 20, 14);
    const wrist = new THREE.Mesh(wristGeo, mats.skin);
    wrist.scale.set(1.3, 0.78, 0.9);
    wrist.castShadow = true;
    wrist.add(new THREE.Mesh(wristGeo, mats.outline));
    this.arm.add(wrist);

    this.object = new THREE.Group();
    this.object.add(this.root, this.arm);

    // Natural (relaxed) pose: solve each finger for its home position, then
    // record where the tips actually are, in hand-local coordinates.
    this.root.updateMatrixWorld(true);
    for (const f of this.fingers) {
      const t = this.hand.localToWorld(new THREE.Vector3(...f.def.home));
      f.solveLocal(f.base.worldToLocal(t));
      f.restAngles = { ...f.angles };
    }
    this.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.hand.matrixWorld).invert();
    this.natural = this.fingers.map((f) => f.tipWorld(new THREE.Vector3()).applyMatrix4(inv));
  }

  /** Pose the wrist: position (world), yaw/roll/pitch in hand-symmetric units. */
  setWrist(x, y, z, yaw, roll, pitch) {
    this.root.position.set(x, y, z);
    // yaw > 0: fingers turn towards the thumb side; roll > 0: little finger side down
    this.root.rotation.set(pitch, this.side * yaw, -this.side * roll, 'YXZ');
    this.root.updateMatrixWorld(true);

    // forearm: from the wrist back towards an elbow beside the body
    const sx = this.side * ARM.shoulderX;
    const elbow = _w.set(sx + (x - sx) * ARM.elbowFollow, y + 0.02, z + ARM.length);
    _v.set(0, 0, 0.004);
    this.root.localToWorld(_v);
    this.arm.position.copy(_v);
    this.arm.lookAt(elbow);
  }

  /** World -> hand-local conversion (accounts for mirroring). */
  toLocal(vWorld, out) {
    return this.hand.worldToLocal(out.copy(vWorld));
  }

  toWorld(vLocal, out) {
    return this.hand.localToWorld(out.copy(vLocal));
  }

  /** Point finger i's tip at a world-space target. */
  reach(i, targetWorld, bias = 0) {
    const f = this.fingers[i];
    const t = f.base.worldToLocal(_v.copy(targetWorld));
    f.solveLocal(t, bias);
  }

}
