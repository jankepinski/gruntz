/**
 * All game audio is synthesised with WebAudio (no sample files): punchy clay SFX,
 * gibberish "grunt" voices built from formant-filtered buzzes, and a small generative
 * music loop per theme.
 */

type Sfx =
  | 'step'
  | 'hit'
  | 'hitBig'
  | 'explosion'
  | 'dig'
  | 'smash'
  | 'pickup'
  | 'powerup'
  | 'splash'
  | 'teleport'
  | 'switch'
  | 'pyramid'
  | 'throw'
  | 'impact'
  | 'suck'
  | 'fuse'
  | 'toy'
  | 'death'
  | 'win'
  | 'lose'
  | 'click'
  | 'error'
  | 'spell'
  | 'brick'
  | 'coin'
  | 'geyser'
  | 'flare'
  | 'trapdoor'
  | 'zap'
  | 'whistle'
  | 'splat'
  | 'rumble';

export interface Volumes {
  master: number;
  sfx: number;
  music: number;
  voices: number;
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private voiceBus!: GainNode;
  private noise: AudioBuffer | null = null;
  private musicTimer = 0;
  private musicStep = 0;
  private musicTheme = '';
  private lastPlayed = new Map<string, number>();
  volumes: Volumes = { master: 0.8, sfx: 0.8, music: 0.35, voices: 0.8 };

  /** Browsers only allow audio after a user gesture. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.voiceBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.voiceBus.connect(this.master);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
  }

  setVolumes(v: Partial<Volumes>): void {
    this.volumes = { ...this.volumes, ...v };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.volumes.master;
    this.sfxBus.gain.value = this.volumes.sfx;
    this.musicBus.gain.value = this.volumes.music;
    this.voiceBus.gain.value = this.volumes.voices;
  }

  // --- building blocks -----------------------------------------------------------

  private env(g: GainNode, t: number, a: number, peak: number, d: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private tone(
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    vol: number,
    out: AudioNode,
    delay = 0,
  ): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.005, vol, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noiseBurst(
    dur: number,
    vol: number,
    filter: BiquadFilterType,
    f0: number,
    f1: number,
    out: AudioNode,
    delay = 0,
    q = 1,
  ): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.004, vol, dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private panned(pan: number, vol: number): AudioNode {
    const ctx = this.ctx!;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    const g = ctx.createGain();
    g.gain.value = vol;
    p.connect(g).connect(this.sfxBus);
    return p;
  }

  /** Play a sound effect. `pan` -1..1 and `volume` 0..1 come from the camera. */
  play(name: Sfx, pan = 0, volume = 1): void {
    if (!this.ctx || volume <= 0.02) return;
    // Rate limit identical sounds so crowds don't clip.
    const now = this.ctx.currentTime;
    const last = this.lastPlayed.get(name) ?? 0;
    if (now - last < 0.035) return;
    this.lastPlayed.set(name, now);
    const out = this.panned(pan, volume);
    const r = () => 0.9 + Math.random() * 0.2;
    switch (name) {
      case 'step':
        this.noiseBurst(0.05, 0.08, 'lowpass', 900, 300, out);
        break;
      case 'hit':
        this.tone('sine', 180 * r(), 60, 0.12, 0.6, out);
        this.noiseBurst(0.08, 0.4, 'bandpass', 2200, 800, out, 0, 2);
        break;
      case 'hitBig':
        this.tone('sine', 140 * r(), 40, 0.2, 0.8, out);
        this.noiseBurst(0.12, 0.5, 'bandpass', 1600, 500, out, 0, 1.5);
        break;
      case 'explosion':
        this.tone('sine', 90, 30, 0.6, 0.9, out);
        this.noiseBurst(0.8, 0.9, 'lowpass', 3000, 120, out);
        this.noiseBurst(0.3, 0.4, 'highpass', 4000, 1500, out, 0.02);
        break;
      case 'dig':
        this.noiseBurst(0.12, 0.35, 'bandpass', 700 * r(), 300, out, 0, 3);
        break;
      case 'smash':
        this.tone('square', 220 * r(), 80, 0.08, 0.25, out);
        this.noiseBurst(0.25, 0.6, 'bandpass', 1400, 300, out, 0, 1.2);
        break;
      case 'pickup':
        this.tone('triangle', 660, 990, 0.09, 0.35, out);
        this.tone('triangle', 990, 1320, 0.12, 0.3, out, 0.07);
        break;
      case 'powerup':
        for (let i = 0; i < 5; i++) this.tone('square', 400 + i * 160, 500 + i * 160, 0.07, 0.15, out, i * 0.05);
        break;
      case 'coin':
        this.tone('square', 988, 988, 0.06, 0.2, out);
        this.tone('square', 1318, 1318, 0.2, 0.2, out, 0.06);
        break;
      case 'splash':
        this.noiseBurst(0.4, 0.5, 'bandpass', 1200, 400, out, 0, 0.8);
        this.tone('sine', 400, 120, 0.15, 0.2, out);
        break;
      case 'teleport':
        this.tone('sine', 200, 1600, 0.4, 0.3, out);
        this.tone('triangle', 300, 2400, 0.4, 0.15, out, 0.05);
        break;
      case 'switch':
        this.tone('square', 520, 520, 0.03, 0.2, out);
        this.tone('square', 780, 780, 0.05, 0.18, out, 0.04);
        break;
      case 'pyramid':
        this.noiseBurst(0.45, 0.3, 'lowpass', 400, 120, out);
        this.tone('sawtooth', 80, 60, 0.4, 0.1, out);
        break;
      case 'throw':
        this.noiseBurst(0.15, 0.25, 'bandpass', 800, 2400, out, 0, 4);
        break;
      case 'impact':
        this.tone('sine', 160, 50, 0.12, 0.5, out);
        this.noiseBurst(0.1, 0.35, 'lowpass', 1800, 200, out);
        break;
      case 'suck':
        this.noiseBurst(0.5, 0.25, 'bandpass', 300, 1800, out, 0, 6);
        break;
      case 'fuse':
        this.noiseBurst(0.6, 0.15, 'highpass', 5000, 3000, out);
        break;
      case 'toy':
        this.tone('square', 880, 1320, 0.08, 0.2, out);
        this.tone('square', 1320, 880, 0.08, 0.2, out, 0.08);
        break;
      case 'death':
        this.tone('sawtooth', 400 * r(), 60, 0.5, 0.25, out);
        this.noiseBurst(0.3, 0.2, 'lowpass', 1200, 200, out, 0.1);
        break;
      case 'brick':
        this.tone('square', 300, 280, 0.05, 0.2, out);
        this.noiseBurst(0.06, 0.2, 'bandpass', 2500, 1500, out, 0, 3);
        break;
      case 'spell':
        for (let i = 0; i < 6; i++) this.tone('sine', 600 + Math.random() * 900, 1500, 0.3, 0.12, out, i * 0.04);
        break;
      case 'win':
        [523, 659, 784, 1046].forEach((f, i) => this.tone('square', f, f, 0.18, 0.2, out, i * 0.12));
        break;
      case 'lose':
        [392, 330, 262, 196].forEach((f, i) => this.tone('triangle', f, f * 0.98, 0.25, 0.25, out, i * 0.18));
        break;
      case 'click':
        this.tone('square', 900, 700, 0.03, 0.12, out);
        break;
      case 'geyser':
        // Lava bursting out: a low roar and hissing spray.
        this.noiseBurst(0.9, 0.55, 'lowpass', 700, 150, out);
        this.noiseBurst(0.7, 0.25, 'highpass', 3500, 6000, out, 0.1);
        break;
      case 'flare':
        this.noiseBurst(0.7, 0.35, 'bandpass', 900, 2400, out, 0, 1.5);
        this.tone('sine', 120, 70, 0.5, 0.2, out);
        break;
      case 'trapdoor':
        this.tone('sawtooth', 110, 70, 0.35, 0.25, out);
        this.noiseBurst(0.12, 0.35, 'lowpass', 1500, 400, out, 0.3);
        break;
      case 'zap':
        for (let i = 0; i < 4; i++) this.tone('square', 1800 + Math.random() * 900, 400, 0.06, 0.12, out, i * 0.07);
        this.noiseBurst(0.35, 0.2, 'highpass', 5000, 3000, out);
        break;
      case 'whistle':
        this.tone('sine', 1800, 500, 1.6, 0.12, out);
        break;
      case 'splat':
        this.tone('sine', 150, 50, 0.2, 0.5, out);
        this.noiseBurst(0.18, 0.45, 'lowpass', 1200, 150, out);
        break;
      case 'rumble':
        this.noiseBurst(1.2, 0.5, 'lowpass', 300, 60, out);
        this.tone('sine', 55, 40, 1.0, 0.3, out);
        break;
      case 'error':
        this.tone('square', 200, 160, 0.12, 0.2, out);
        break;
    }
  }

  /**
   * A grunt says something: 1-3 gibberish syllables through vowel formant filters.
   * `voice` picks a stable pitch per grunt; `mood` shifts the melody.
   */
  voice(voice: number, mood: 'ack' | 'attack' | 'hurt' | 'die' | 'happy' | 'confused', pan = 0, volume = 1): void {
    if (!this.ctx || volume <= 0.05) return;
    const ctx = this.ctx;
    const base = 150 + (voice % 7) * 18;
    const syllables = mood === 'die' ? 1 : 1 + Math.floor(Math.random() * 3);
    const out = ctx.createStereoPanner();
    out.pan.value = pan;
    const vg = ctx.createGain();
    vg.gain.value = volume;
    out.connect(vg).connect(this.voiceBus);
    const vowels = [
      [730, 1090],
      [270, 2290],
      [300, 870],
      [530, 1840],
      [640, 1190],
    ];
    let t = ctx.currentTime;
    for (let s = 0; s < syllables; s++) {
      const dur = mood === 'die' ? 0.55 : 0.09 + Math.random() * 0.07;
      const [f1, f2] = vowels[Math.floor(Math.random() * vowels.length)]!;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const up = mood === 'happy' || mood === 'ack' ? 1.25 : mood === 'hurt' ? 1.6 : mood === 'die' ? 0.5 : 1;
      o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.3), t);
      o.frequency.exponentialRampToValueAtTime(base * up, t + dur);
      const a = ctx.createBiquadFilter();
      a.type = 'bandpass';
      a.frequency.value = f1;
      a.Q.value = 6;
      const b = ctx.createBiquadFilter();
      b.type = 'bandpass';
      b.frequency.value = f2;
      b.Q.value = 8;
      const g = ctx.createGain();
      this.env(g, t, 0.012, 0.9, dur);
      o.connect(a).connect(g);
      o.connect(b).connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + dur + 0.05);
      t += dur + 0.02;
    }
  }

  // --- music ------------------------------------------------------------------------

  /** A cheerful generative loop: bass, marimba-ish lead and a soft beat. */
  music(theme: string): void {
    if (!this.ctx || this.musicTheme === theme) return;
    this.stopMusic();
    this.musicTheme = theme;
    const scales: Record<string, number[]> = {
      training: [0, 2, 4, 7, 9],
      rocky: [0, 3, 5, 7, 10],
      ice: [0, 2, 3, 7, 8],
      tropics: [0, 2, 4, 7, 9, 11],
      sweetz: [0, 4, 5, 7, 11],
      rollerz: [0, 2, 5, 7, 9],
      shrunk: [0, 1, 5, 7, 8],
      minis: [0, 2, 4, 5, 7],
      space: [0, 2, 3, 6, 7, 10],
    };
    const scale = scales[theme] ?? scales.training!;
    const root = theme === 'space' ? 45 : theme === 'ice' ? 50 : 48;
    const bpm = theme === 'rollerz' ? 128 : theme === 'space' ? 96 : 112;
    const stepDur = 60 / bpm / 2;
    const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);
    const pattern = Array.from({ length: 32 }, () =>
      Math.random() < 0.55 ? scale[Math.floor(Math.random() * scale.length)]! : -1,
    );
    const bassLine = [0, 0, 5, 5, 3, 3, 4, 4].map(i => scale[i % scale.length]!);
    let next = this.ctx.currentTime + 0.1;
    const schedule = () => {
      const ctx = this.ctx!;
      while (next < ctx.currentTime + 0.3) {
        const i = this.musicStep % 32;
        const bar = Math.floor(this.musicStep / 8) % bassLine.length;
        if (i % 4 === 0) this.musicNote('triangle', midi(root - 12 + bassLine[bar]!), next, stepDur * 3, 0.22);
        const n = pattern[i]!;
        if (n >= 0) this.musicNote('sine', midi(root + 12 + n), next, stepDur * 0.9, 0.12, true);
        if (i % 8 === 4) this.musicPerc(next, 0.08);
        if (i % 2 === 0) this.musicHat(next, 0.02);
        next += stepDur;
        this.musicStep++;
        // Every 64 steps, mutate the melody a little so it doesn't get boring.
        if (this.musicStep % 64 === 0) {
          for (let k = 0; k < 6; k++)
            pattern[Math.floor(Math.random() * 32)] =
              Math.random() < 0.5 ? scale[Math.floor(Math.random() * scale.length)]! : -1;
        }
      }
    };
    this.musicTimer = window.setInterval(schedule, 100);
  }

  stopMusic(): void {
    clearInterval(this.musicTimer);
    this.musicTheme = '';
  }

  private musicNote(type: OscillatorType, f: number, t: number, dur: number, vol: number, mallet = false): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = ctx.createGain();
    this.env(g, t, mallet ? 0.004 : 0.02, vol, dur);
    o.connect(g).connect(this.musicBus);
    if (mallet) {
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = f * 4;
      const g2 = ctx.createGain();
      this.env(g2, t, 0.002, vol * 0.3, dur * 0.25);
      o2.connect(g2).connect(this.musicBus);
      o2.start(t);
      o2.stop(t + dur);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private musicPerc(t: number, vol: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    const g = ctx.createGain();
    this.env(g, t, 0.002, vol, 0.12);
    src.connect(f).connect(g).connect(this.musicBus);
    src.start(t);
    src.stop(t + 0.15);
  }

  private musicHat(t: number, vol: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = ctx.createGain();
    this.env(g, t, 0.001, vol, 0.04);
    src.connect(f).connect(g).connect(this.musicBus);
    src.start(t);
    src.stop(t + 0.06);
  }
}

export const audio = new AudioEngine();
export type { Sfx };
