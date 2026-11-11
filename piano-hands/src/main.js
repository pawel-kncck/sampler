import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { Piano, LOWEST, HIGHEST } from './piano.js';
import { Hand } from './hand.js';
import { sketchMaterial, outlineMaterial, lineMaterial, setSketchPixelRatio, INK } from './sketch.js';
import { assignHands, assignFingers } from './fingering.js';
import { Performance } from './performance.js';
import { PianoSynth } from './audio.js';
import { parseMidi } from './midi.js';
import { furElise, technicalStudy } from './scores.js';

// ------------------------------------------------------------------ scene
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 20);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.12;
controls.maxDistance = 4;
controls.maxPolarAngle = Math.PI * 0.62;

scene.add(new THREE.AmbientLight(0xffffff, 1.25));
const sun = new THREE.DirectionalLight(0xffffff, 2.3);
sun.position.set(-0.55, 1.35, 0.75);
sun.target.position.set(0, 0, -0.05);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -0.85, right: 0.85, top: 0.6, bottom: -0.6, near: 0.3, far: 3.5 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.0015;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0xffffff, 0.45);
fill.position.set(0.8, 0.4, 0.6);
scene.add(fill);

const mats = {
  whiteKey: sketchMaterial(1.0),
  blackKey: sketchMaterial(0.10, { density: 1.25 }),
  case: sketchMaterial(0.8),
  caseDark: sketchMaterial(0.45),
  panel: sketchMaterial(0.68),
  skin: sketchMaterial(0.98, { density: 1.1 }),
  nail: sketchMaterial(1.0),
  outline: outlineMaterial(0.0024),
  arm: sketchMaterial(0.98, { density: 1.1, fade: [0.1, 0.25] }),
  armOutline: outlineMaterial(0.0024, INK, [0.1, 0.25]),
  outlineThin: outlineMaterial(0.0011),
  line: lineMaterial(0.8),
};

const piano = new Piano(mats);
scene.add(piano.group);

const hands = { L: new Hand(-1, mats), R: new Hand(1, mats) };
scene.add(hands.L.object, hands.R.object);

// floor shadow catcher (keeps the drawing grounded without a visible floor)
const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.ShadowMaterial({ opacity: 0.12 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.7;
floor.receiveShadow = true;
scene.add(floor);

// finger number labels
function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(245,244,240,0.92)';
  g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.fill();
  g.lineWidth = 3; g.strokeStyle = `rgb(${INK.map((v) => Math.round(v * 255)).join(',')})`; g.stroke();
  g.fillStyle = g.strokeStyle;
  g.font = 'italic 600 34px Georgia, serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.setScalar(0.017);
  s.renderOrder = 10;
  s.visible = false;
  scene.add(s);
  return s;
}
const labels = { L: [1, 2, 3, 4, 5].map((i) => makeLabel(String(i))), R: [1, 2, 3, 4, 5].map((i) => makeLabel(String(i))) };

// ------------------------------------------------------------------ camera views
const VIEWS = {
  front: { pos: [0.46, 0.5, -0.74], target: [0, 0.02, -0.04] },
  pianist: { pos: [0, 0.56, 0.5], target: [0, 0.0, -0.07] },
  above: { pos: [0, 1.0, -0.06], target: [0, 0, -0.07] },
  side: { pos: [0.95, 0.24, 0.12], target: [0.0, 0.02, -0.05] },
  close: { pos: [0.22, 0.2, -0.3], target: [0.02, 0.02, -0.04] },
};
let camAnim = null;
function setView(name, instant = false) {
  const v = VIEWS[name];
  const off = follow ? THREE.MathUtils.clamp(handsCenterX(), -0.45, 0.45) : 0;
  followX = off;
  const pos = new THREE.Vector3(...v.pos).add(new THREE.Vector3(off, 0, 0));
  const target = new THREE.Vector3(...v.target).add(new THREE.Vector3(off, 0, 0));
  if (instant) { camera.position.copy(pos); controls.target.copy(target); controls.update(); return; }
  camAnim = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target };
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
}

// ------------------------------------------------------------------ state
const synth = new PianoSynth();
let perf = null;
let score = null;
let notesByStart = [];
let playing = false;
let scoreTime = 0;
let rate = 1;
let anchorCtx = 0, anchorScore = 0, anchorPerf = 0;
let nextNote = 0;
let follow = true;
let showNumbers = true;
let muted = false;

const $ = (id) => document.getElementById(id);
const ui = {
  play: $('play'), restart: $('restart'), seek: $('seek'), time: $('time'),
  tempo: $('tempo'), tempoVal: $('tempoVal'), volume: $('volume'), piece: $('piece'),
  file: $('file'), title: $('title'), info: $('info'), follow: $('follow'),
  numbers: $('numbers'), drop: $('drop'), toast: $('toast'), mute: $('mute'),
};

function fmt(t) {
  t = Math.max(0, t);
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function toast(msg, ms = 3200) {
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => ui.toast.classList.remove('show'), ms);
}

function loadScore(src) {
  pause();
  const notes = src.notes.map((n) => ({ ...n }));
  score = { title: src.title, notes, pedal: (src.pedal || []).map((p) => ({ ...p })) };
  assignHands(notes, score.pedal);
  assignFingers(notes.filter((n) => n.hand === 'L'), -1);
  assignFingers(notes.filter((n) => n.hand === 'R'), 1);

  // how long each note actually sounds (dampers vs. sustain pedal)
  const byPitch = new Map();
  for (const n of notes) {
    const written = n.sounding ?? n.end; // `sounding`: written end of a pedal-sustained note
    let end = written;
    for (const p of score.pedal) if (p.start <= written && written < p.end) { end = Math.max(end, p.end); break; }
    n.soundEnd = end;
    if (!byPitch.has(n.pitch)) byPitch.set(n.pitch, []);
    byPitch.get(n.pitch).push(n);
  }
  for (const arr of byPitch.values()) {
    arr.sort((a, b) => a.start - b.start);
    for (let i = 0; i < arr.length - 1; i++) arr[i].soundEnd = Math.min(arr[i].soundEnd, arr[i + 1].start);
  }
  notesByStart = notes.slice().sort((a, b) => a.start - b.start);

  perf = new Performance(score, hands);
  scoreTime = 0;
  perf.update(0);
  ui.seek.max = perf.duration;
  ui.seek.value = 0;
  ui.title.textContent = score.title;
  const nl = notes.filter((n) => n.hand === 'L').length;
  const unf = notes.filter((n) => n.finger == null || n.unreachable).length;
  ui.info.textContent = `${notes.length} notes · right hand ${notes.length - nl} · left hand ${nl} · ${fmt(perf.duration)}` +
    (unf ? ` · ${unf} notes out of reach` : '');
  updateTime();
}

// ------------------------------------------------------------------ transport
function audioNow() {
  return synth.ctx ? synth.ctx.currentTime : performance.now() / 1000;
}

function currentScoreTime() {
  if (!playing) return scoreTime;
  return anchorScore + (audioNow() - anchorCtx) * rate;
}

function firstNoteAfter(t) {
  let lo = 0, hi = notesByStart.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (notesByStart[m].start < t) lo = m + 1; else hi = m; }
  return lo;
}

function anchor() {
  anchorScore = scoreTime;
  anchorCtx = audioNow() + 0.06;
  nextNote = firstNoteAfter(scoreTime);
}

function play() {
  if (!perf) return;
  try {
    synth.ensure();
    synth.ctx.resume();
    synth.setVolume(muted ? 0 : Number(ui.volume.value));
  } catch (e) {
    console.warn('Audio unavailable', e);
  }
  if (scoreTime >= perf.duration - 0.05) scoreTime = 0;
  playing = true;
  anchor();
  ui.play.classList.add('playing');
  ui.play.setAttribute('aria-label', 'Pause');
}

function pause() {
  if (playing) scoreTime = currentScoreTime();
  playing = false;
  synth.stopAll();
  ui.play.classList.remove('playing');
  ui.play.setAttribute('aria-label', 'Play');
}

function seek(t) {
  scoreTime = Math.max(0, Math.min(perf.duration, t));
  if (playing) { synth.stopAll(); anchor(); }
  updateTime();
}

function scheduleAudio(now) {
  if (!synth.ctx) return;
  const horizon = now + 0.2 * rate;
  while (nextNote < notesByStart.length && notesByStart[nextNote].start < horizon) {
    const n = notesByStart[nextNote++];
    if (n.start < now - 0.05) continue;
    const when = anchorCtx + (n.start - anchorScore) / rate;
    const end = anchorCtx + (n.soundEnd - anchorScore) / rate;
    synth.play(n.pitch, n.velocity ?? 0.6, Math.max(when, synth.ctx.currentTime), Math.max(end, when + 0.05));
  }
}

function updateTime() {
  ui.time.textContent = `${fmt(scoreTime)} / ${fmt(perf ? perf.duration : 0)}`;
  if (document.activeElement !== ui.seek) ui.seek.value = scoreTime;
}

// ------------------------------------------------------------------ UI wiring
ui.play.addEventListener('click', () => (playing ? pause() : play()));
ui.restart.addEventListener('click', () => seek(0));
ui.seek.addEventListener('input', () => seek(Number(ui.seek.value)));
ui.tempo.addEventListener('input', () => {
  const r = Number(ui.tempo.value) / 100;
  if (playing) { scoreTime = currentScoreTime(); rate = r; synth.stopAll(); anchor(); } else rate = r;
  ui.tempoVal.textContent = `${ui.tempo.value}%`;
});
ui.volume.addEventListener('input', () => { muted = false; ui.mute.classList.remove('muted'); synth.setVolume(Number(ui.volume.value)); });
ui.mute.addEventListener('click', () => {
  muted = !muted;
  ui.mute.classList.toggle('muted', muted);
  synth.setVolume(muted ? 0 : Number(ui.volume.value));
});
ui.follow.addEventListener('change', () => { follow = ui.follow.checked; });
ui.numbers.addEventListener('change', () => { showNumbers = ui.numbers.checked; });
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

const builtIn = { elise: furElise, study: technicalStudy };
const loaded = new Map();
ui.piece.addEventListener('change', () => {
  const v = ui.piece.value;
  if (builtIn[v]) loadScore(builtIn[v]());
  else if (loaded.has(v)) loadScore(loaded.get(v));
});

async function loadMidiFile(file) {
  try {
    const s = parseMidi(await file.arrayBuffer(), file.name);
    const id = 'midi-' + loaded.size;
    loaded.set(id, s);
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = s.title;
    ui.piece.querySelector('optgroup[label="Loaded"]').appendChild(opt);
    ui.piece.value = id;
    loadScore(s);
    toast(`Loaded “${s.title}” — fingering computed for ${s.notes.length} notes`);
  } catch (e) {
    console.error(e);
    toast(`Could not read ${file.name}: ${e.message}`);
  }
}
ui.file.addEventListener('change', () => { if (ui.file.files[0]) loadMidiFile(ui.file.files[0]); ui.file.value = ''; });
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; ui.drop.classList.add('show'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; ui.drop.classList.remove('show'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; ui.drop.classList.remove('show');
  const f = e.dataTransfer.files[0];
  if (f) loadMidiFile(f);
});

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
  if (e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); playing ? pause() : play(); }
  else if (e.code === 'ArrowLeft') { e.preventDefault(); seek(currentScoreTime() - 5); }
  else if (e.code === 'ArrowRight') { e.preventDefault(); seek(currentScoreTime() + 5); }
  else if (e.code === 'Home') seek(0);
  else if (e.key === '1') setView('front');
  else if (e.key === '2') setView('pianist');
  else if (e.key === '3') setView('above');
  else if (e.key === '4') setView('side');
  else if (e.key === '5') setView('close');
  else if (e.key === 'f') { ui.follow.checked = follow = !follow; }
  else if (e.key === 'n') { ui.numbers.checked = showNumbers = !showNumbers; }
});

// ------------------------------------------------------------------ loop
function handsCenterX() {
  return (hands.L.root.position.x + hands.R.root.position.x) / 2;
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const pr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pr);
  setSketchPixelRatio(pr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // keep the whole keyboard in frame on narrow screens
  camera.fov = w / h < 1 ? 32 + (1 - w / h) * 34 : 32;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let followX = 0;
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (playing) {
    const now = currentScoreTime();
    if (now >= perf.duration) { scoreTime = perf.duration; pause(); }
    else { scoreTime = now; scheduleAudio(now); }
  }
  if (perf) {
    perf.update(scoreTime);
    for (let p = LOWEST; p <= HIGHEST; p++) piano.setDepth(p, perf.keyDepthAt(p, scoreTime));
    piano.setSustain(perf.sustainAt(scoreTime));
    for (const k of ['L', 'R']) for (const s of labels[k]) s.visible = false;
    if (showNumbers) {
      for (const pr of perf.pressing) {
        const s = labels[pr.hand][pr.finger];
        s.visible = true;
        s.position.set(pr.pos.x, pr.pos.y + 0.03, pr.pos.z - 0.035);
      }
    }
    updateTime();
  }

  if (camAnim) {
    camAnim.t = Math.min(1, camAnim.t + dt / 0.9);
    const e = camAnim.t < 0.5 ? 4 * camAnim.t ** 3 : 1 - (-2 * camAnim.t + 2) ** 3 / 2;
    camera.position.lerpVectors(camAnim.p0, camAnim.p1, e);
    controls.target.lerpVectors(camAnim.t0, camAnim.t1, e);
    if (camAnim.t >= 1) camAnim = null;
  } else if (follow && perf) {
    // gently pan with the hands
    const target = THREE.MathUtils.clamp(handsCenterX(), -0.45, 0.45);
    const step = (target - followX) * Math.min(1, dt * 1.2);
    followX += step;
    camera.position.x += step;
    controls.target.x += step;
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

loadScore(furElise());
setView('front', true);
requestAnimationFrame(frame);

// expose for debugging / automation
window.pianoHands = { play, pause, seek, setView, scene, camera, controls, hands, piano, get time() { return scoreTime; }, get perf() { return perf; } };
