// Procedural Web Audio: ambience (wind, rain, birds, crickets), footsteps, rifle and animal calls.
// No audio files are loaded — everything is synthesised.
import { G, settings } from './state.js';
import { clamp } from './utils.js';

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.ready = false;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = settings.volume;
    this.master.connect(ctx.destination);

    // shared noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // brown-ish noise for wind
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + (Math.random() * 2 - 1) * 0.02) / 1.02; b[i] = last * 3.5; }

    // simple echo send for outdoor reverb
    this.echo = ctx.createDelay(1.5);
    this.echo.delayTime.value = 0.42;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const ef = ctx.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 1400;
    this.echo.connect(ef); ef.connect(fb); fb.connect(this.echo);
    this.echoOut = ctx.createGain(); this.echoOut.gain.value = 0.5;
    ef.connect(this.echoOut); this.echoOut.connect(this.master);

    this.wind = this.loop(this.brown, 'lowpass', 500, 0);
    this.rain = this.loop(this.noise, 'highpass', 1800, 0);
    this.water = this.loop(this.noise, 'bandpass', 900, 0);
    // crickets: amplitude-modulated high sine
    const osc = ctx.createOscillator(); osc.frequency.value = 4400;
    const am = ctx.createGain(); am.gain.value = 0;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 28;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain); lfoGain.connect(am.gain);
    this.cricketGain = ctx.createGain(); this.cricketGain.gain.value = 0;
    osc.connect(am); am.connect(this.cricketGain); this.cricketGain.connect(this.master);
    osc.start(); lfo.start();
    this.birdT = 2;
    this.ready = true;
  }

  loop(buffer, type, freq, gain) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
    return { src, f, g };
  }

  setVolume(v) { if (this.master) this.master.gain.value = v; }

  // Distance attenuation and stereo panning relative to the listener.
  spatial(pos, maxD = 400) {
    const cam = G.camera;
    const dx = pos.x - cam.position.x, dz = pos.z - cam.position.z;
    const d = Math.hypot(dx, dz);
    if (d > maxD) return null;
    const gain = clamp(1 / (1 + d / 25), 0, 1);
    const yaw = G.player.yaw;
    // listener right vector = (cos yaw, -sin yaw)
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const pan = d > 0.1 ? clamp((dx * rx + dz * rz) / d, -1, 1) : 0;
    const lp = clamp(18000 / (1 + d / 30), 600, 18000);
    return { gain, pan, lp, d };
  }

  chain(sp, gainValue) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = gainValue * (sp ? sp.gain : 1);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = sp ? sp.lp : 18000;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    g.connect(f);
    if (p) { p.pan.value = sp ? sp.pan : 0; f.connect(p); p.connect(this.master); } else f.connect(this.master);
    return { input: g, f };
  }

  noiseBurst({ dur = 0.1, freq = 800, type = 'bandpass', q = 1, gain = 0.5, attack = 0.002, sp = null, echo = 0, when = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + attack);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const out = this.chain(sp, gain);
    src.connect(f); f.connect(env); env.connect(out.input);
    if (echo) { const e = ctx.createGain(); e.gain.value = echo; env.connect(e); e.connect(this.echo); }
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  tone({ f0 = 440, f1 = 440, dur = 0.3, type = 'sine', gain = 0.3, sp = null, attack = 0.02, vibrato = 0, when = 0, echo = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    if (vibrato) {
      const l = ctx.createOscillator(); l.frequency.value = 5.5;
      const lg = ctx.createGain(); lg.gain.value = vibrato;
      l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur + 0.1);
    }
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + attack);
    env.gain.setValueAtTime(1, t + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const out = this.chain(sp, gain);
    o.connect(env); env.connect(out.input);
    if (echo) { const e = ctx.createGain(); e.gain.value = echo; env.connect(e); e.connect(this.echo); }
    o.start(t); o.stop(t + dur + 0.05);
  }

  // --- game sounds ---
  footstep(intensity, water) {
    if (!this.ready) return;
    if (water) this.noiseBurst({ dur: 0.25, freq: 700, q: 0.7, gain: 0.18 * intensity });
    else this.noiseBurst({ dur: 0.09 + intensity * 0.05, freq: 350 + Math.random() * 300, q: 0.8, gain: 0.12 * intensity });
  }

  gunshot() {
    if (!this.ready) return;
    this.noiseBurst({ dur: 0.35, freq: 1200, type: 'lowpass', q: 0.5, gain: 1.0, attack: 0.001, echo: 0.9 });
    this.noiseBurst({ dur: 0.9, freq: 220, type: 'lowpass', q: 0.4, gain: 0.8, attack: 0.002, echo: 0.6 });
    this.tone({ f0: 90, f1: 35, dur: 0.4, type: 'sine', gain: 0.6, attack: 0.001 });
    // rolling echo off the hills
    this.noiseBurst({ dur: 1.4, freq: 300, type: 'lowpass', gain: 0.18, attack: 0.25, when: 0.6 });
  }

  boltCycle() {
    if (!this.ready) return;
    this.noiseBurst({ dur: 0.05, freq: 3200, q: 4, gain: 0.25, when: 0.05 });
    this.noiseBurst({ dur: 0.07, freq: 2200, q: 3, gain: 0.25, when: 0.3 });
    this.noiseBurst({ dur: 0.05, freq: 2800, q: 4, gain: 0.3, when: 0.55 });
  }

  reloadSound() {
    if (!this.ready) return;
    this.noiseBurst({ dur: 0.06, freq: 2400, q: 3, gain: 0.25, when: 0.2 });
    for (let i = 0; i < 4; i++) this.noiseBurst({ dur: 0.04, freq: 3600, q: 5, gain: 0.2, when: 0.7 + i * 0.28 });
    this.noiseBurst({ dur: 0.07, freq: 2000, q: 3, gain: 0.3, when: 2.0 });
  }

  dryFire() { this.noiseBurst({ dur: 0.03, freq: 4000, q: 6, gain: 0.2 }); }

  impact(pos, soft) {
    const sp = this.spatial(pos, 300);
    if (!sp) return;
    this.noiseBurst({ dur: soft ? 0.12 : 0.08, freq: soft ? 500 : 1800, q: 1, gain: 0.5, sp, when: sp.d / 340 });
  }

  thunder(delay) {
    if (!this.ready) return;
    this.noiseBurst({ dur: 3.5, freq: 160, type: 'lowpass', gain: 0.9, attack: 0.3, when: delay, echo: 0.4 });
    this.noiseBurst({ dur: 0.5, freq: 400, type: 'lowpass', gain: 0.4, attack: 0.02, when: delay });
  }

  animalCall(kind, pos) {
    if (!this.ready) return;
    const sp = this.spatial(pos, 600);
    if (!sp) return;
    const when = sp.d / 340;
    switch (kind) {
      case 'snort':
        this.noiseBurst({ dur: 0.35, freq: 900, q: 1.5, gain: 0.6, sp, when, attack: 0.01 });
        this.noiseBurst({ dur: 0.25, freq: 700, q: 1.5, gain: 0.4, sp, when: when + 0.45 });
        break;
      case 'bugle':
        this.tone({ f0: 500, f1: 1700, dur: 1.2, type: 'sine', gain: 0.35, sp, when, attack: 0.3, vibrato: 18, echo: 0.6 });
        this.tone({ f0: 1700, f1: 1500, dur: 1.0, type: 'triangle', gain: 0.2, sp, when: when + 1.1, vibrato: 25, echo: 0.6 });
        this.noiseBurst({ dur: 0.4, freq: 300, q: 1, gain: 0.3, sp, when: when + 2.1 });
        break;
      case 'howl':
        this.tone({ f0: 330, f1: 520, dur: 1.4, type: 'sine', gain: 0.32, sp, when, attack: 0.4, vibrato: 6, echo: 0.8 });
        this.tone({ f0: 520, f1: 380, dur: 2.0, type: 'sine', gain: 0.3, sp, when: when + 1.35, vibrato: 8, echo: 0.8 });
        break;
      case 'grunt':
        for (let i = 0; i < 3; i++) this.tone({ f0: 110, f1: 80, dur: 0.18, type: 'sawtooth', gain: 0.15, sp, when: when + i * 0.3, attack: 0.02 });
        break;
      case 'bark':
        this.tone({ f0: 900, f1: 500, dur: 0.18, type: 'sawtooth', gain: 0.12, sp, when, attack: 0.005 });
        this.tone({ f0: 950, f1: 520, dur: 0.16, type: 'sawtooth', gain: 0.1, sp, when: when + 0.5, attack: 0.005 });
        break;
    }
  }

  birdCall(kind, pos) {
    if (!this.ready || !kind) return;
    const sp = this.spatial(pos, 450);
    if (!sp) return;
    const w = sp.d / 340;
    switch (kind) {
      case 'gobble':
        for (let i = 0; i < 7; i++) this.tone({ f0: 700 - i * 30, f1: 420, dur: 0.07, type: 'triangle', gain: 0.25, sp, when: w + i * 0.075, attack: 0.005 });
        break;
      case 'quack':
        for (let i = 0; i < 3; i++) this.tone({ f0: 520, f1: 380, dur: 0.16, type: 'sawtooth', gain: 0.1, sp, when: w + i * 0.22, attack: 0.01 });
        break;
      case 'honk':
        for (let i = 0; i < 2; i++) this.tone({ f0: 340, f1: 400, dur: 0.22, type: 'sawtooth', gain: 0.12, sp, when: w + i * 0.35, attack: 0.02 });
        break;
      case 'eagle':
        for (let i = 0; i < 5; i++) this.tone({ f0: 2600, f1: 2200, dur: 0.08, gain: 0.08, sp, when: w + i * 0.11, attack: 0.005 });
        break;
      case 'hawk':
        this.tone({ f0: 3200, f1: 1600, dur: 1.1, type: 'sawtooth', gain: 0.05, sp, when: w, attack: 0.05, echo: 0.4 });
        this.noiseBurst({ dur: 1.0, freq: 2400, q: 2, gain: 0.08, sp, when: w });
        break;
      case 'hoot':
        [0, 0.5, 0.75, 1.0, 1.35].forEach((t, i) => this.tone({ f0: i === 1 ? 330 : 290, f1: i === 1 ? 320 : 270, dur: i === 1 ? 0.35 : 0.22, gain: 0.18, sp, when: w + t, attack: 0.04, echo: 0.4 }));
        break;
      case 'caw':
        for (let i = 0; i < 3; i++) { this.tone({ f0: 720, f1: 520, dur: 0.24, type: 'sawtooth', gain: 0.07, sp, when: w + i * 0.45, attack: 0.01 }); }
        break;
      case 'coo':
        this.tone({ f0: 420, f1: 500, dur: 0.35, gain: 0.06, sp, when: w, attack: 0.08, vibrato: 12 });
        this.tone({ f0: 500, f1: 420, dur: 0.5, gain: 0.05, sp, when: w + 0.45, attack: 0.1, vibrato: 10 });
        break;
      case 'drum':
        for (let i = 0; i < 12; i++) this.tone({ f0: 70, f1: 50, dur: 0.12, gain: 0.2, sp, when: w + 1.6 * (1 - Math.pow(0.85, i)), attack: 0.005 });
        break;
      case 'croak':
        this.noiseBurst({ dur: 0.4, freq: 300, q: 2, gain: 0.25, sp, when: w });
        break;
    }
  }

  distantShot(pos) {
    const sp = this.spatial(pos, 900);
    if (!this.ready || !sp) return;
    const w = sp.d / 340;
    this.noiseBurst({ dur: 0.5, freq: 900, type: 'lowpass', gain: 0.9, sp, when: w, attack: 0.002, echo: 0.6 });
    this.tone({ f0: 80, f1: 35, dur: 0.4, gain: 0.4, sp, when: w, attack: 0.002 });
  }

  whiz() { this.noiseBurst({ dur: 0.18, freq: 3000, q: 3, gain: 0.25, attack: 0.05 }); }
  hurt() { this.tone({ f0: 140, f1: 60, dur: 0.25, gain: 0.5, attack: 0.005 }); this.noiseBurst({ dur: 0.15, freq: 400, gain: 0.4 }); }
  shout(pos) { const sp = this.spatial(pos, 300); if (sp) { this.tone({ f0: 220, f1: 180, dur: 0.4, type: 'sawtooth', gain: 0.18, sp, attack: 0.03 }); this.tone({ f0: 250, f1: 200, dur: 0.35, type: 'sawtooth', gain: 0.15, sp, when: 0.5, attack: 0.03 }); } }
  doorSound() { this.noiseBurst({ dur: 0.35, freq: 600, q: 4, gain: 0.25 }); this.tone({ f0: 240, f1: 180, dur: 0.3, type: 'triangle', gain: 0.06, when: 0.05 }); }
  growl(pos, species) {
    const sp = this.spatial(pos, 120);
    if (!this.ready || !sp) return;
    const low = species === 'bear' ? 70 : species === 'boar' || species === 'moose' ? 110 : species === 'cougar' ? 240 : 160;
    this.tone({ f0: low * 1.3, f1: low, dur: 0.6, type: 'sawtooth', gain: 0.22, sp, attack: 0.05, vibrato: 12 });
    this.noiseBurst({ dur: 0.5, freq: low * 3, q: 1.5, gain: 0.3, sp });
  }
  pistolShot() {
    if (!this.ready) return;
    this.noiseBurst({ dur: 0.22, freq: 1600, type: 'lowpass', q: 0.6, gain: 0.8, attack: 0.001, echo: 0.6 });
    this.tone({ f0: 140, f1: 50, dur: 0.2, gain: 0.4, attack: 0.001 });
  }
  shotgunShot() {
    if (!this.ready) return;
    this.noiseBurst({ dur: 0.45, freq: 900, type: 'lowpass', q: 0.5, gain: 1.0, attack: 0.001, echo: 0.8 });
    this.tone({ f0: 70, f1: 30, dur: 0.45, gain: 0.7, attack: 0.001 });
  }
  pump() { this.noiseBurst({ dur: 0.08, freq: 1800, q: 3, gain: 0.3 }); this.noiseBurst({ dur: 0.08, freq: 1400, q: 3, gain: 0.3, when: 0.18 }); }
  bowDraw() { this.tone({ f0: 180, f1: 260, dur: 0.8, type: 'triangle', gain: 0.03, attack: 0.3 }); }
  bowShot() { this.tone({ f0: 160, f1: 90, dur: 0.18, type: 'triangle', gain: 0.25, attack: 0.002 }); this.noiseBurst({ dur: 0.25, freq: 2400, q: 1, gain: 0.08, attack: 0.02 }); }
  gruntCall() { for (let i = 0; i < 2; i++) this.tone({ f0: 180, f1: 140, dur: 0.35, type: 'sawtooth', gain: 0.2, when: i * 0.5, attack: 0.03 }); }
  slash() { this.noiseBurst({ dur: 0.18, freq: 2600, q: 1.2, gain: 0.25, attack: 0.03 }); }
  sizzle() { this.noiseBurst({ dur: 1.4, freq: 5000, type: 'highpass', gain: 0.12, attack: 0.1 }); }
  strike() { this.noiseBurst({ dur: 0.12, freq: 2500, q: 2, gain: 0.3 }); }
  chop() { this.noiseBurst({ dur: 0.09, freq: 750, q: 2.5, gain: 0.55, attack: 0.001 }); this.tone({ f0: 190, f1: 95, dur: 0.12, type: 'triangle', gain: 0.25, attack: 0.001 }); }
  treeFall() {
    this.tone({ f0: 110, f1: 70, dur: 1.4, type: 'sawtooth', gain: 0.05, attack: 0.4 });
    this.noiseBurst({ dur: 0.9, freq: 260, q: 0.8, gain: 0.7, attack: 0.01, when: 1.5 });
    this.noiseBurst({ dur: 0.6, freq: 1800, q: 0.7, gain: 0.2, attack: 0.02, when: 1.5 });
  }
  eatSound() { for (let i = 0; i < 3; i++) this.noiseBurst({ dur: 0.08, freq: 900, q: 1, gain: 0.15, when: i * 0.25 }); }

  bird() {
    const n = 2 + Math.floor(Math.random() * 4);
    const base = 2500 + Math.random() * 2500;
    const pan = { gain: 0.3 + Math.random() * 0.3, pan: Math.random() * 2 - 1, lp: 12000 };
    for (let i = 0; i < n; i++) {
      this.tone({ f0: base * (0.9 + Math.random() * 0.3), f1: base * (1.1 + Math.random() * 0.4), dur: 0.08 + Math.random() * 0.1, gain: 0.06, sp: pan, when: i * 0.14, attack: 0.01 });
    }
  }

  update(dt) {
    if (!this.ready) return;
    const env = G.env, t = this.ctx.currentTime;
    const ws = Math.hypot(env.wind.x, env.wind.z);
    this.wind.g.gain.setTargetAtTime(0.05 + ws * 0.022, t, 0.5);
    this.wind.f.frequency.setTargetAtTime(300 + ws * 60, t, 0.5);
    this.rain.g.gain.setTargetAtTime(env.w.rain * 0.14, t, 0.6);
    // river proximity
    const p = G.player.pos;
    const near = G.world.terrain.nearestDrinkSpot(p.x, p.z).d;
    this.water.g.gain.setTargetAtTime(clamp(1 - near / 40, 0, 1) * 0.05, t, 0.5);
    this.cricketGain.gain.setTargetAtTime((1 - env.daylight) * (1 - env.w.rain) * (1 - env.w.snow) * 0.012, t, 1);
    // crackling of a nearby lit campfire
    const fire = G.world.fires.find((f) => f.lit && Math.hypot(f.x - p.x, f.z - p.z) < 12);
    if (fire && Math.random() < dt * 6) {
      const sp = this.spatial({ x: fire.x, z: fire.z }, 15);
      if (sp) this.noiseBurst({ dur: 0.03 + Math.random() * 0.05, freq: 1500 + Math.random() * 2500, q: 2, gain: 0.25, sp });
    }
    // daytime birds
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = 2 + Math.random() * 6;
      if (env.daylight > 0.3 && env.w.rain < 0.3) this.bird();
    }
  }
}
