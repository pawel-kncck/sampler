// Small synthesized piano (no samples needed): inharmonic partials, two
// slightly detuned "strings", brightness that decays over time, hammer
// knock, damper release and sustain-pedal handling.

export class PianoSynth {
  constructor() {
    this.ctx = null;
    this.voices = new Set();
    this.waves = new Map();
    this.volume = 0.8;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.003; comp.release.value = 0.2;
    // simple room reverb
    const conv = ctx.createConvolver();
    conv.buffer = this._impulse(2.2);
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    this.bus = ctx.createGain();
    this.bus.connect(comp);
    this.bus.connect(conv); conv.connect(wet); wet.connect(comp);
    comp.connect(this.master);
    this.master.connect(ctx.destination);
    // noise for hammer
    const nb = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
    const data = nb.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.012));
    this.noise = nb;
    return ctx;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  _impulse(seconds) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < 200 ? i / 200 : 1);
    }
    return b;
  }

  _wave(pitch, vel) {
    const pb = Math.max(0, Math.min(7, Math.floor((pitch - 21) / 12)));
    const vb = Math.max(0, Math.min(3, Math.floor(vel * 4)));
    const key = pb * 4 + vb;
    if (this.waves.has(key)) return this.waves.get(key);
    const N = 24;
    const real = new Float32Array(N + 1), imag = new Float32Array(N + 1);
    const bright = 0.6 + vb * 0.35;
    for (let k = 1; k <= N; k++) {
      // hammer strikes ~1/7 along the string → weak 7th harmonic; high notes have fewer partials
      const strike = Math.abs(Math.sin((Math.PI * k) / 7.3));
      const roll = Math.pow(k, -(1.55 - bright * 0.35)) * Math.exp(-k * (0.05 + pb * 0.04));
      imag[k] = roll * (0.35 + 0.65 * strike);
    }
    const w = this.ctx.createPeriodicWave(real, imag);
    this.waves.set(key, w);
    return w;
  }

  /** Schedule a note. when/end in AudioContext seconds. */
  play(pitch, vel, when, end) {
    const ctx = this.ctx;
    if (!ctx) return;
    const f = 440 * Math.pow(2, (pitch - 69) / 12);
    const v = Math.max(0.05, Math.min(1, vel));
    const out = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.4;
    const startCut = Math.min(16000, f * (3 + 14 * v * v) + 600);
    lp.frequency.setValueAtTime(startCut, when);
    lp.frequency.setTargetAtTime(Math.min(16000, f * 2.2 + 300), when + 0.02, 0.6 + 2.5 * (1 - (pitch - 21) / 88));
    lp.connect(out);
    out.connect(this.bus);

    const gain = 0.22 * Math.pow(v, 1.4) * (1 - (pitch - 21) / 220);
    const sustainT = 0.5 + 6.0 * Math.pow(1 - (pitch - 21) / 88, 2); // low strings ring longer
    const g = out.gain;
    g.setValueAtTime(0, when);
    g.linearRampToValueAtTime(gain, when + 0.003);
    g.setTargetAtTime(gain * 0.45, when + 0.003, 0.09); // prompt sound
    if (end > when + 0.25) g.setTargetAtTime(0.0001, when + 0.25, sustainT); // aftersound
    const stopAt = end + 0.6;
    const damp = pitch >= 89 ? 0.6 : 0.07; // top octaves have no dampers
    g.setTargetAtTime(0, Math.max(end, when + 0.004), damp);

    const oscs = [];
    const wave = this._wave(pitch, v);
    for (const [det, amp] of [[0, 0.6], [f > 110 ? 0.9 : 0.5, 0.45], [f > 220 ? -1.4 : -0.4, 0.3]]) {
      const o = ctx.createOscillator();
      o.setPeriodicWave(wave);
      o.frequency.value = f;
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = amp;
      o.connect(og); og.connect(lp);
      o.start(when);
      o.stop(stopAt + damp * 6);
      oscs.push(o);
    }
    // hammer knock
    const ns = ctx.createBufferSource();
    ns.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(6000, f * 3 + 800);
    bp.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.value = 0.05 * v * v;
    ns.connect(bp); bp.connect(ng); ng.connect(out);
    ns.start(when);

    const voice = { out, oscs, end: stopAt + damp * 6 };
    this.voices.add(voice);
    oscs[0].onended = () => { out.disconnect(); this.voices.delete(voice); };
    return voice;
  }

  stopAll() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const v of this.voices) {
      v.out.gain.cancelScheduledValues(t);
      v.out.gain.setTargetAtTime(0, t, 0.03);
      for (const o of v.oscs) { try { o.stop(t + 0.2); } catch (e) { /* already stopped */ } }
    }
    this.voices.clear();
  }
}
