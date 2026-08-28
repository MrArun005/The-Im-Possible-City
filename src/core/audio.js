import * as THREE from 'three';
import { clamp } from '../util/math.js';

/**
 * Audio (Tasks 2.4 / 2.5 / 5.5).
 *
 * DEVIATION FROM THE PLAN: the plan lists Howler.js over recorded .mp3 beds.
 * There are no licensed recordings in this repo, and a silent city fails the
 * Phase 2 exit gate ("standing still for 30 seconds is interesting") harder
 * than a synthetic one does. So the primary path is a small WebAudio synth --
 * wind, carriage, sirens, fireplace, piano, footsteps -- and the fallback
 * ladder runs the other way for once: if a real recording is present at
 * `/districts/{id}/ambience.*` it is fetched and used instead of the synth.
 * Positional audio is native PannerNode, which Howler wraps anyway.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.emitters = new Map();
    this.maxEmitters = 4;
    this._nodes = [];
    this._districtNodes = [];
    this._rainGain = null;
    this._stepPhase = 0;
    this._listenerPos = new THREE.Vector3();
  }

  /** Must be called from a user gesture (autoplay policy). */
  async start() {
    if (this.ctx) { await this.ctx.resume?.(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;

    this.ctx = new Ctx({ latencyHint: 'interactive' });
    await this.ctx.resume?.();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(this.ctx.destination);

    this.ambientBus = this.ctx.createGain();
    this.ambientBus.gain.value = 0.9;
    this.ambientBus.connect(this.master);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 1.0;
    this.sfxBus.connect(this.master);

    this.noise = makeNoiseBuffer(this.ctx, 3);
    this.ready = true;
    this.master.gain.linearRampToValueAtTime(0.85, this.ctx.currentTime + 3);
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.ready) return;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(muted ? 0 : 0.85, this.ctx.currentTime + 0.4);
  }

  // ---------------------------------------------------------------- ambience
  /** Swap the whole ambient bed when districts change. */
  async setDistrict(config) {
    if (!this.ready) return;
    this._teardownDistrict();

    if (config.audio) {
      const buffer = await this._tryLoad(config.audio);
      if (buffer) { this._playBed(buffer); return; }
    }
    this._synthBed(config.id, config.ambience || {});
  }

  async _tryLoad(url) {
    // No point asking for it from a file:// page - the fetch is guaranteed to
    // fail on CORS grounds and only produces a wall of red in the console.
    if (location.protocol === 'file:') return null;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      return null; // Synth fallback. A missing file is a shrug, not a crash.
    }
  }

  _playBed(buffer) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.6;
    src.connect(gain).connect(this.ambientBus);
    src.start();
    this._districtNodes.push(src, gain);
  }

  _synthBed(id, opts) {
    const ctx = this.ctx;
    const out = this.ambientBus;

    // --- wind / traffic: filtered noise with a slow breathing LFO ---
    const bedSrc = ctx.createBufferSource();
    bedSrc.buffer = this.noise;
    bedSrc.loop = true;

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = id === 'nyc' ? 'bandpass' : 'lowpass';
    bandpass.frequency.value = id === 'nyc' ? 220 : 420;
    bandpass.Q.value = id === 'nyc' ? 0.9 : 0.6;

    const bedGain = ctx.createGain();
    bedGain.gain.value = opts.bedGain ?? (id === 'nyc' ? 0.16 : 0.1);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = bedGain.gain.value * 0.55;
    lfo.connect(lfoGain).connect(bedGain.gain);
    lfo.start();

    bedSrc.connect(bandpass).connect(bedGain).connect(out);
    bedSrc.start();

    // --- rain layer, kept at zero until Weather turns it on (Task 3.3) ---
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = this.noise;
    rainSrc.loop = true;
    const rainHi = ctx.createBiquadFilter();
    rainHi.type = 'highpass';
    rainHi.frequency.value = 1400;
    const rainGain = ctx.createGain();
    rainGain.gain.value = 0;
    rainSrc.connect(rainHi).connect(rainGain).connect(out);
    rainSrc.start();
    this._rainGain = rainGain;

    // --- sparse events: hooves in London, sirens and horns in New York ---
    const scheduleEvent = () => {
      if (!this.ready) return;
      const delay = id === 'nyc' ? 5 + Math.random() * 12 : 8 + Math.random() * 16;
      this._eventTimer = setTimeout(() => {
        if (id === 'nyc') Math.random() < 0.45 ? this._siren() : this._carHorn();
        else Math.random() < 0.65 ? this._carriage() : this._distantBell();
        scheduleEvent();
      }, delay * 1000);
    };
    scheduleEvent();

    this._districtNodes.push(bedSrc, bandpass, bedGain, lfo, lfoGain, rainSrc, rainHi, rainGain);
  }

  _teardownDistrict() {
    clearTimeout(this._eventTimer);
    for (const node of this._districtNodes) {
      try { node.stop?.(); } catch { /* already stopped */ }
      try { node.disconnect(); } catch { /* already gone */ }
    }
    this._districtNodes = [];
    this._rainGain = null;
    for (const key of [...this.emitters.keys()]) this.removeEmitter(key);
  }

  setRain(amount) {
    if (!this._rainGain) return;
    this._rainGain.gain.setTargetAtTime(clamp(amount, 0, 1) * 0.13, this.ctx.currentTime, 0.8);
  }

  // ------------------------------------------------------------------ events
  _carriage() {
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    const gain = ctx.createGain();
    gain.gain.value = 0.0;
    pan.connect(this.ambientBus);
    gain.connect(pan);

    // A trotting horse is a 4-beat clop pattern, receding.
    const beats = 14;
    for (let i = 0; i < beats; i++) {
      const t = t0 + i * 0.31 + (i % 4 === 0 ? 0 : 0.02);
      const fade = 1 - i / beats;
      clop(ctx, gain, t, 0.5 * fade * fade);
    }
    gain.gain.setValueAtTime(0.5, t0);
    setTimeout(() => { pan.disconnect(); gain.disconnect(); }, (beats * 0.31 + 1) * 1000);
  }

  _distantBell() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    [1, 2.76, 5.4].forEach((mult, i) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = 220 * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05 / (i + 1), t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
      osc.connect(g).connect(this.ambientBus);
      osc.start(t);
      osc.stop(t + 4.2);
    });
  }

  _siren() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.045, t + 1.5);
    g.gain.linearRampToValueAtTime(0, t + 9);

    // Wailing two-tone, doppler-ish drift downward as it "passes".
    for (let i = 0; i < 12; i++) {
      osc.frequency.setValueAtTime(660 - i * 12, t + i * 0.72);
      osc.frequency.linearRampToValueAtTime(880 - i * 16, t + i * 0.72 + 0.36);
      osc.frequency.linearRampToValueAtTime(660 - i * 14, t + i * 0.72 + 0.71);
    }
    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime(-0.8, t);
    pan.pan.linearRampToValueAtTime(0.8, t + 9);
    osc.connect(lp).connect(g).connect(pan).connect(this.ambientBus);
    osc.start(t);
    osc.stop(t + 9.4);
  }

  _carHorn() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.02);
    g.gain.setValueAtTime(0.05, t + 0.28);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.4 - 0.7;
    [370, 466].forEach((f) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(g);
      o.start(t);
      o.stop(t + 0.55);
    });
    g.connect(pan).connect(this.ambientBus);
  }

  thunder() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.4 + Math.random() * 1.6;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(70, t + 3.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + 0.14);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
    src.connect(lp).connect(g).connect(this.ambientBus);
    src.start(t);
    src.stop(t + 3.6);
  }

  // ------------------------------------------------------------------- doors
  creak(open = true) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const from = open ? 74 : 128;
    const to = open ? 132 : 68;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.linearRampToValueAtTime(to, t + 1.05);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 5.5;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.11, t + 0.12);
    // Stick-slip: a real hinge stutters instead of gliding.
    for (let i = 0; i < 7; i++) {
      g.gain.linearRampToValueAtTime(0.03 + Math.random() * 0.1, t + 0.16 + i * 0.12);
    }
    g.gain.exponentialRampToValueAtTime(0.0005, t + 1.25);

    osc.connect(bp).connect(g).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + 1.3);

    // Latch click at the end of a close.
    if (!open) this._click(t + 1.0, 0.16);
  }

  rattle() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 4; i++) this._click(t + i * 0.085, 0.1 + Math.random() * 0.05);
  }

  _click(when, level) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2100 + Math.random() * 900;
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.07);
    src.connect(bp).connect(g).connect(this.sfxBus);
    src.start(when, Math.random() * 2, 0.09);
  }

  footstep(surface = 'stone', intensity = 1) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = surface === 'wet' ? 1500 : surface === 'wood' ? 420 : 780;
    bp.Q.value = surface === 'wet' ? 1.2 : 2.4;
    const g = ctx.createGain();
    const level = 0.075 * intensity * (0.8 + Math.random() * 0.4);
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (surface === 'wet' ? 0.19 : 0.12));
    src.playbackRate.value = 0.85 + Math.random() * 0.3;
    src.connect(bp).connect(g).connect(this.sfxBus);
    src.start(t, Math.random() * 2, 0.25);
  }

  /** Drives footsteps from actual movement so the rhythm matches the legs. */
  updateFootsteps(speed, dt, surface) {
    if (!this.ready || speed < 0.4) { this._stepPhase = 0.55; return; }
    this._stepPhase += dt * speed * 0.62;
    if (this._stepPhase >= 1) {
      this._stepPhase -= 1;
      this.footstep(surface, clamp(speed / 3.4, 0.4, 1.2));
    }
  }

  // -------------------------------------------------------------- positional
  /**
   * Positional emitter. `kind` picks a generator; `position` is world space.
   * Only the nearest few are kept alive - see `updateEmitters`.
   */
  addEmitter(id, { position, kind, refDistance = 2.4, maxDistance = 34, gain = 1 }) {
    if (!this.ready || this.emitters.has(id)) return;
    const ctx = this.ctx;

    const panner = ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'exponential';
    panner.refDistance = refDistance;
    panner.maxDistance = maxDistance;
    panner.rolloffFactor = 1.7;
    panner.positionX.value = position.x;
    panner.positionY.value = position.y;
    panner.positionZ.value = position.z;

    const out = ctx.createGain();
    out.gain.value = gain;
    out.connect(panner).connect(this.ambientBus);

    const emitter = { id, kind, panner, out, position: position.clone(), nodes: [], timers: [] };
    EMITTERS[kind]?.(this, emitter, out);
    this.emitters.set(id, emitter);
  }

  removeEmitter(id) {
    const e = this.emitters.get(id);
    if (!e) return;
    e.timers.forEach(clearTimeout);
    for (const node of e.nodes) {
      try { node.stop?.(); } catch { /* noop */ }
      try { node.disconnect(); } catch { /* noop */ }
    }
    try { e.out.disconnect(); } catch { /* noop */ }
    try { e.panner.disconnect(); } catch { /* noop */ }
    this.emitters.delete(id);
  }

  /** Keeps the listener glued to the camera and culls distant emitters. */
  updateListener(camera) {
    if (!this.ready) return;
    const l = this.ctx.listener;
    camera.getWorldPosition(this._listenerPos);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

    if (l.positionX) {
      l.positionX.value = this._listenerPos.x;
      l.positionY.value = this._listenerPos.y;
      l.positionZ.value = this._listenerPos.z;
      l.forwardX.value = dir.x; l.forwardY.value = dir.y; l.forwardZ.value = dir.z;
      l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z;
    } else {
      l.setPosition(this._listenerPos.x, this._listenerPos.y, this._listenerPos.z);
      l.setOrientation(dir.x, dir.y, dir.z, up.x, up.y, up.z);
    }
  }

  /**
   * `wanted` is a list of {id, position, kind, gain}. Nearest `maxEmitters`
   * become live; the rest are torn down. Same streaming idea as interiors.
   */
  updateEmitters(wanted, listenerPos) {
    if (!this.ready) return;
    const ranked = wanted
      .map((w) => ({ ...w, d: listenerPos.distanceTo(w.position) }))
      .filter((w) => w.d < (w.maxDistance ?? 34))
      .sort((a, b) => a.d - b.d)
      .slice(0, this.maxEmitters);

    const keep = new Set(ranked.map((r) => r.id));
    for (const id of [...this.emitters.keys()]) if (!keep.has(id)) this.removeEmitter(id);
    for (const r of ranked) this.addEmitter(r.id, r);
  }

  dispose() {
    this._teardownDistrict();
    this.ready = false;
    this.ctx?.close?.();
    this.ctx = null;
  }
}

// --------------------------------------------------------------- generators

const EMITTERS = {
  /** Muffled piano behind a specific door (Task 2.5). */
  piano(engine, emitter, out) {
    const ctx = engine.ctx;
    const muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 760; // Through a door, you lose the top end.
    muffle.Q.value = 0.7;
    muffle.connect(out);
    emitter.nodes.push(muffle);

    // A slow, sad little progression in A minor.
    const scale = [220, 246.94, 261.63, 293.66, 329.63, 349.23, 415.3, 440];
    const note = () => {
      const t = ctx.currentTime;
      const root = scale[Math.floor(Math.random() * scale.length)];
      [1, 2, 3].forEach((h, i) => {
        const o = ctx.createOscillator();
        o.type = i === 0 ? 'triangle' : 'sine';
        o.frequency.value = root * h;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.19 / (i + 1.6), t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6 + Math.random());
        o.connect(g).connect(muffle);
        o.start(t);
        o.stop(t + 2.8);
      });
      emitter.timers.push(setTimeout(note, 420 + Math.random() * 900));
    };
    note();
  },

  /** Fireplace: low rumble plus irregular crackle (Tasks 2.5 / 3.2). */
  fireplace(engine, emitter, out) {
    const ctx = engine.ctx;
    const src = ctx.createBufferSource();
    src.buffer = engine.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 340;
    const g = ctx.createGain();
    g.gain.value = 0.3;
    src.connect(lp).connect(g).connect(out);
    src.start();
    emitter.nodes.push(src, lp, g);

    const crackle = () => {
      const t = ctx.currentTime;
      const s = ctx.createBufferSource();
      s.buffer = engine.noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1200 + Math.random() * 2600;
      bp.Q.value = 6;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.22 + Math.random() * 0.3, t);
      cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05 + Math.random() * 0.08);
      s.connect(bp).connect(cg).connect(out);
      s.start(t, Math.random() * 2, 0.2);
      emitter.timers.push(setTimeout(crackle, 60 + Math.random() * 420));
    };
    crackle();
  },

  /** Jazz bar: walking bass and brushed snare, heard through brick. */
  jazz(engine, emitter, out) {
    const ctx = engine.ctx;
    const muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 620;
    muffle.connect(out);
    emitter.nodes.push(muffle);

    const walk = [110, 123.47, 130.81, 146.83, 164.81, 146.83, 130.81, 123.47];
    let step = 0;
    const beat = () => {
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = walk[step % walk.length];
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
      o.connect(g).connect(muffle);
      o.start(t);
      o.stop(t + 0.5);

      if (step % 2 === 1) {
        const s = ctx.createBufferSource();
        s.buffer = engine.noise;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 2600;
        const sg = ctx.createGain();
        sg.gain.setValueAtTime(0.1, t);
        sg.gain.exponentialRampToValueAtTime(0.0005, t + 0.16);
        s.connect(hp).connect(sg).connect(out);
        s.start(t, Math.random() * 2, 0.2);
      }
      step++;
      emitter.timers.push(setTimeout(beat, 430));
    };
    beat();
  },

  /** Gaslight hiss - almost inaudible, but you miss it when it's gone. */
  gaslight(engine, emitter, out) {
    const ctx = engine.ctx;
    const src = ctx.createBufferSource();
    src.buffer = engine.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3800;
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.value = 0.12;
    src.connect(bp).connect(g).connect(out);
    src.start();
    emitter.nodes.push(src, bp, g);
  },

  /** Manhole steam (Task 5.5). */
  steam(engine, emitter, out) {
    const ctx = engine.ctx;
    const src = ctx.createBufferSource();
    src.buffer = engine.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.value = 0.0;
    src.connect(bp).connect(g).connect(out);
    src.start();
    emitter.nodes.push(src, bp, g);

    // Steam comes in slow sighs, not a constant hiss.
    const breathe = () => {
      const t = ctx.currentTime;
      g.gain.setTargetAtTime(0.2, t, 0.9);
      g.gain.setTargetAtTime(0.02, t + 3.2, 1.4);
      emitter.timers.push(setTimeout(breathe, 7000 + Math.random() * 5000));
    };
    breathe();
  },
};

function makeNoiseBuffer(ctx, seconds) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Slightly brown-ish noise: less fizzy than white, better for wind and fire.
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.2 + white * 0.35;
  }
  return buffer;
}

function clop(ctx, dest, when, level) {
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(180 + Math.random() * 60, when);
  o.frequency.exponentialRampToValueAtTime(70, when + 0.07);
  const g = ctx.createGain();
  g.gain.setValueAtTime(level * 0.09, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.1);
  o.connect(g).connect(dest);
  o.start(when);
  o.stop(when + 0.12);
}
