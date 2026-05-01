const OCTAVE_SHIFT = -12;
const PITCH_MIN    = 21;
const PITCH_MAX    = 91;

interface ParsedNote {
  time:     number;
  dur:      number;
  pitch:    number;
  velocity: number;
  isDrum?:  boolean;
}

const _DRUM_FREQS: Record<number, number> = {
  35: 58,  36: 65,                      // bass kick
  37: 260, 38: 220, 40: 220, 39: 280,   // snare / clap
  41: 130, 43: 155, 45: 185, 47: 215, 48: 260, 50: 310,  // toms
  42: 820, 44: 750, 46: 980,            // hi-hat (closed / pedal / open)
  49: 1900, 51: 1350, 52: 1600, 53: 1100, 57: 1750, 59: 1250,  // cymbals
};
function _drumFreq(p: number): number { return _DRUM_FREQS[p] ?? 400; }

// Raise G (pitch class 7 relative to C) to G# — natural minor → harmonic minor
function _harmonicMinor(pitch: number): number {
  return (pitch % 12 === 7) ? pitch + 1 : pitch;
}

function extractNotes(buf: ArrayBuffer): ParsedNote[] {
  const d = new Uint8Array(buf);
  let p = 0;

  const u32 = () => { const v=(d[p]<<24|d[p+1]<<16|d[p+2]<<8|d[p+3])>>>0; p+=4; return v; };
  const u16 = () => { const v=(d[p]<<8|d[p+1]); p+=2; return v; };
  const u8  = () => d[p++];
  const vl  = () => {
    let v = 0;
    for (;;) { const b = u8(); v = (v << 7) | (b & 0x7F); if (!(b & 0x80)) break; }
    return v;
  };

  p = 4; // skip 'MThd'
  const hLen    = u32();
  const _fmt    = u16();  void _fmt;
  const nTracks = u16();
  const tpqn    = u16();
  p = 4 + 4 + hLen;        // seek past header chunk

  let tempo = 612245; // default 98 BPM — matches track.mid
  const pending = new Map<number, { time: number; vel: number; isDrum?: boolean }>();
  const notes: ParsedNote[] = [];

  for (let ti = 0; ti < nTracks; ti++) {
    p += 4; // skip 'MTrk'
    const cLen = u32();
    const cEnd = p + cLen;
    let absT = 0;
    let rs   = 0;

    while (p < cEnd) {
      absT += vl();
      const peek = d[p];

      if (peek === 0xFF) {                          // meta event
        p++;
        const mt = u8();
        const ml = vl();
        if (mt === 0x51 && ml === 3) {             // set tempo
          tempo = (d[p] << 16) | (d[p+1] << 8) | d[p+2];
        }
        p += ml;

      } else if (peek === 0xF0 || peek === 0xF7) { // sysex
        p++; p += vl();

      } else {
        if (peek & 0x80) { rs = peek; p++; }       // update running status
        const ev  = (rs & 0xF0) >> 4;
        const ch  = rs & 0x0F;
        const sec = (absT / tpqn) * (tempo / 1e6); // note time in seconds

        if (ev === 0x9) {                           // Note On
          const pitch = u8(), vel = u8();
          const k = (ch << 7) | pitch;
          if (vel > 0) {
            pending.set(k, { time: sec, vel: vel / 127, isDrum: ch === 9 });
          } else {                                  // vel=0 → Note Off
            const s = pending.get(k);
            if (s) {
              if (s.isDrum) {
                notes.push({ time: s.time, dur: 0.05, pitch, velocity: s.vel, isDrum: true });
              } else {
                const shifted = _harmonicMinor(pitch + OCTAVE_SHIFT);
                if (shifted >= PITCH_MIN && shifted <= PITCH_MAX) {
                  notes.push({ time: s.time, dur: Math.max(0.05, sec - s.time), pitch: shifted, velocity: s.vel });
                }
              }
              pending.delete(k);
            }
          }
        } else if (ev === 0x8) {                    // Note Off
          const pitch = u8(); u8();
          const k = (ch << 7) | pitch;
          const s = pending.get(k);
          if (s) {
            if (s.isDrum) {
              notes.push({ time: s.time, dur: 0.05, pitch, velocity: s.vel, isDrum: true });
            } else {
              const shifted = _harmonicMinor(pitch + OCTAVE_SHIFT);
              if (shifted >= PITCH_MIN && shifted <= PITCH_MAX) {
                notes.push({ time: s.time, dur: Math.max(0.05, sec - s.time), pitch: shifted, velocity: s.vel });
              }
            }
            pending.delete(k);
          }
        } else if (ev === 0xA || ev === 0xB || ev === 0xE) { p += 2; }
          else if (ev === 0xC || ev === 0xD)                { p += 1; }
          else { p = cEnd; break; } // bail on unrecognised status
      }
    }
    p = cEnd;
  }

  notes.sort((a, b) => a.time - b.time);
  return notes;
}

// ─── Voice pool ───────────────────────────────────────────────────────────────

const VOICE_COUNT  = 12;
const LOOK_AHEAD   = 0.25; // schedule up to 250ms ahead

interface Voice {
  osc:       OscillatorNode;
  env:       GainNode;
  startTime: number;
  active:    boolean;
}

// ─── Filter modulation constants ─────────────────────────────────────────────

const FREQ_MIN = 780;   // never close filter enough to go silent
const FREQ_MAX = 8000;

// ─── MusicEngine class ────────────────────────────────────────────────────────

export class MusicEngine {
  private ctx:          AudioContext | null = null;
  private mfilt:        BiquadFilterNode  | null = null;
  private masterGain:   GainNode          | null = null;
  private _feedbackGain: GainNode         | null = null;
  private _sfxBus:      GainNode          | null = null;  // all SFX → masterGain → glueComp
  private _musicVolNode: GainNode         | null = null;  // user-controlled music volume
  private _sfxVolNode:   GainNode         | null = null;  // user-controlled SFX volume
  private _musicVolScale = 1.0;           // persists across restarts
  private _sfxVolScale   = 1.0;
  private _chargeToneOsc:  OscillatorNode | null = null;  // sustained charge-up tone
  private _chargeToneGain: GainNode       | null = null;
  private voices:       Voice[] = [];
  private notes:        ParsedNote[] = [];

  // Playback state
  private _playing   = false;
  private _startAt   = 0;   // ctx.currentTime when note[0] is scheduled
  private _noteIdx   = 0;
  private _rafId:    number | null = null;
  private _lastKillTime  = -999;  // debounce simultaneous multi-kill
  private _chainPopIdx   = 0;     // sequential index for staggered chain pops
  private _chainPopBase  = -999;  // ctx.currentTime of first pop in this burst

  // ── Filter modulation state ─────────────────────────────────────────────────
  private _sectionFreq  = 1200;  // set by setGameState() from beat position
  private _combatOffset = 0;     // negative: closes filter with enemy pressure
  private _chainBoost   = 0;     // positive: rewards kill chains
  private _beatAccent   = 0;     // transient 0→1, decays per frame
  private _lfoPhase     = 0;     // slow breathing oscillation
  private _quickenFrac  = 0;     // 0–1, set by setQuicken()

  async load(path: string): Promise<void> {
    try {
      const res = await fetch(path);
      if (!res.ok) { console.warn('[MusicEngine] Failed to fetch', path); return; }
      const buf = await res.arrayBuffer();
      this.notes = extractNotes(buf);
      console.log(`[MusicEngine] ${this.notes.length} notes loaded from ${path}`);
    } catch (e) {
      console.warn('[MusicEngine] load error:', e);
    }
  }

  async start(): Promise<void> {
    if (this._playing) this.stop();
    if (this.notes.length === 0) { console.warn('[MusicEngine] No notes — did you call load()?'); return; }

    try {
      this.ctx = new AudioContext();
      await this.ctx.resume();
    } catch (e) {
      console.warn('[MusicEngine] AudioContext error:', e);
      return;
    }

    this._buildChain();

    this._startAt      = this.ctx.currentTime + 0.2;
    this._noteIdx      = 0;
    this._playing      = true;
    this._lfoPhase     = 0;
    this._beatAccent   = 0;
    // Reset SFX burst state — the new AudioContext has its own clock starting near 0,
    // so stale timestamps from the previous context would break the burst-reset logic.
    this._chainPopBase = -999;
    this._chainPopIdx  = 0;
    this._lastKillTime = -999;

    this.masterGain!.gain.setValueAtTime(0, this.ctx.currentTime);
    this.masterGain!.gain.linearRampToValueAtTime(1.248, this.ctx.currentTime + 2.5);

    this._tick();
  }

  stop(): void {
    this._fadeAndClose(0.4);
  }

  fadeOut(duration: number): void {
    this._fadeAndClose(duration);
  }

  startDeathFilter(duration = 0.7): void {
    if (!this.mfilt || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.mfilt.frequency.cancelScheduledValues(now);
    this.mfilt.frequency.setValueAtTime(this.mfilt.frequency.value, now);
    this.mfilt.frequency.linearRampToValueAtTime(240, now + duration);
    this.mfilt.Q.cancelScheduledValues(now);
    this.mfilt.Q.setValueAtTime(this.mfilt.Q.value, now);
    this.mfilt.Q.linearRampToValueAtTime(12.0, now + duration * 0.7);
    if (this._feedbackGain) {
      this._feedbackGain.gain.cancelScheduledValues(now);
      this._feedbackGain.gain.setValueAtTime(this._feedbackGain.gain.value, now);
      this._feedbackGain.gain.linearRampToValueAtTime(0.96, now + duration * 0.6);
    }
  }

  private _fadeAndClose(duration: number): void {
    this._playing = false;
    if (this._rafId !== null) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    if (this._chargeToneOsc) {
      try { this._chargeToneOsc.stop(); } catch {}
      this._chargeToneOsc  = null;
      this._chargeToneGain = null;
    }

    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
      this.masterGain.gain.linearRampToValueAtTime(0, now + duration);
      const ctxRef = this.ctx;
      this.ctx = null;
      setTimeout(() => { try { ctxRef.close(); } catch {} }, (duration + 0.3) * 1000);
    } else {
      this.ctx = null;
    }
  }

  update(dt: number): void {
    if (!this._playing || !this.mfilt || !this.ctx) return;

    const q   = this._quickenFrac;
    const qSq = q * q;

    this._lfoPhase   += dt * (Math.PI * 2 / 15) * (1 + q * 2.5);
    this._beatAccent  = Math.max(0, this._beatAccent - dt * 6);
    const lfo         = Math.sin(this._lfoPhase) * 0.22 + 0.78;

    const target = Math.max(FREQ_MIN, Math.min(FREQ_MAX,
      this._sectionFreq * lfo
      + this._combatOffset
      + this._chainBoost
      + this._beatAccent * 700
      + q * 2200,
    ));

    const now = this.ctx.currentTime;
    this.mfilt.frequency.setTargetAtTime(target, now, 0.025);
    this.mfilt.Q.setTargetAtTime(
      0.8 + this._beatAccent * 2.6 + (this._combatOffset < -500 ? 0.6 : 0) + qSq * 5.5,
      now, 0.04,
    );

    if (this._feedbackGain) {
      this._feedbackGain.gain.setTargetAtTime(Math.min(0.38 + qSq * 0.25, 0.63), now, 0.15);
    }
  }

  setGameState(enemyCount: number, killChain: number, beat: number): void {
    this._sectionFreq  = this._sectionBaseFreq(beat);
    this._combatOffset = -(enemyCount / 12) * 900;
    this._chainBoost   = Math.min(killChain - 1, 7) * 450;
  }

  setQuicken(qFrac: number): void {
    this._quickenFrac = Math.max(0, Math.min(1, qFrac));
  }

  onBeat(beat: number): void {
    this._beatAccent = beat % 4 === 0 ? 1.8 : 1.0;
  }

  get isPlaying(): boolean { return this._playing; }
  get beatAccent(): number { return this._beatAccent; }

  setMusicVolume(v: number): void {
    this._musicVolScale = Math.max(0, Math.min(1, v));
    if (this._musicVolNode) this._musicVolNode.gain.value = this._musicVolScale;
  }

  setSfxVolume(v: number): void {
    this._sfxVolScale = Math.max(0, Math.min(1, v));
    if (this._sfxVolNode) this._sfxVolNode.gain.value = this._sfxVolScale;
  }

  playChargeRelease(chargeProgress: number): void {
    if (!this.ctx || !this._sfxBus) return;
    const now       = this.ctx.currentTime;
    const startFreq = 220 + chargeProgress * 220;
    const endFreq   = 207.7; // G#3

    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.18);

    const vol = 0.10 + chargeProgress * 0.10;
    env.gain.setValueAtTime(vol, now);
    env.gain.linearRampToValueAtTime(0, now + 0.22);

    osc.connect(env);
    env.connect(this._sfxBus);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  updateChargeTone(progress: number): void {
    if (!this.ctx || !this._sfxBus) return;
    const now = this.ctx.currentTime;

    if (progress <= 0) {
      if (this._chargeToneGain) {
        this._chargeToneGain.gain.setTargetAtTime(0, now, 0.02);
        const osc = this._chargeToneOsc!;
        const env = this._chargeToneGain;
        setTimeout(() => { try { osc.stop(); } catch {} env.disconnect(); }, 80);
        this._chargeToneOsc  = null;
        this._chargeToneGain = null;
      }
      return;
    }

    if (!this._chargeToneOsc) {
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = 110;
      env.gain.value = 0;
      osc.connect(env);
      env.connect(this._sfxBus);
      osc.start();
      this._chargeToneOsc  = osc;
      this._chargeToneGain = env;
    }

    const freq = 110 * Math.pow(4, progress);
    const vol  = progress * 0.015;
    this._chargeToneOsc.frequency.setTargetAtTime(freq, now, 0.04);
    this._chargeToneGain!.gain.setTargetAtTime(vol, now, 0.04);
  }

  playKill(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    if (now - this._lastKillTime < 0.13) return;
    this._lastKillTime = now;

    const vol = 0.22 + this._beatAccent * 0.10;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.linearRampToValueAtTime(45, now + 0.20);
    env.gain.setValueAtTime(0,   now);
    env.gain.linearRampToValueAtTime(vol, now + 0.015);
    env.gain.linearRampToValueAtTime(0,   now + 0.22);

    osc.connect(env);
    env.connect(this._sfxBus!);
    osc.start(now);
    osc.stop(now + 0.28);
  }

  playChainPop(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    if (now - this._chainPopBase > 0.5) {
      this._chainPopIdx  = 0;
      this._chainPopBase = now;
    }
    const when = now + this._chainPopIdx++ * 0.07;
    const osc  = this.ctx.createOscillator();
    const env  = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, when);
    osc.frequency.linearRampToValueAtTime(75, when + 0.022);
    env.gain.setValueAtTime(0,    when);
    env.gain.linearRampToValueAtTime(0.14, when + 0.001);
    env.gain.linearRampToValueAtTime(0,    when + 0.025);
    osc.connect(env);
    env.connect(this._sfxBus!);
    osc.start(when);
    osc.stop(when + 0.03);
  }

  playLastBombWarning(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    [880.0, 830.6].forEach((freq, i) => {
      const when = now + i * 0.06;
      const osc  = this.ctx!.createOscillator();
      const env  = this.ctx!.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      env.gain.setValueAtTime(0,     when);
      env.gain.linearRampToValueAtTime(0.07, when + 0.004);
      env.gain.linearRampToValueAtTime(0,    when + 0.09);
      osc.connect(env);
      env.connect(this._sfxBus!);
      osc.start(when);
      osc.stop(when + 0.11);
    });
  }

  playLowTimeWarning(): void {
    if (!this.ctx || !this._sfxBus) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 1046.5;  // C6
    env.gain.setValueAtTime(0,     now);
    env.gain.linearRampToValueAtTime(0.09, now + 0.003);
    env.gain.linearRampToValueAtTime(0,    now + 0.08);
    osc.connect(env);
    env.connect(this._sfxBus);
    osc.start(now);
    osc.stop(now + 0.10);
  }

  playPickupScore(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    [587.3, 659.3].forEach((freq, i) => {
      const when = now + i * 0.085;
      const osc  = this.ctx!.createOscillator();
      const env  = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      env.gain.setValueAtTime(0,    when);
      env.gain.linearRampToValueAtTime(0.13, when + 0.006);
      env.gain.linearRampToValueAtTime(0,    when + 0.14);
      osc.connect(env);
      env.connect(this._sfxBus!);
      osc.start(when);
      osc.stop(when + 0.17);
    });
  }

  playPickupTime(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    [220.0, 329.6].forEach((freq, i) => {
      const when = now + i * 0.11;
      const osc  = this.ctx!.createOscillator();
      const env  = this.ctx!.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      env.gain.setValueAtTime(0,    when);
      env.gain.linearRampToValueAtTime(0.15, when + 0.008);
      env.gain.linearRampToValueAtTime(0,    when + 0.22);
      osc.connect(env);
      env.connect(this._sfxBus!);
      osc.start(when);
      osc.stop(when + 0.26);
    });
  }

  playPickupQuicken(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    [220.0, 261.6, 329.6, 415.3, 440.0].forEach((freq, i) => {
      const when = now + i * 0.08;
      const osc  = this.ctx!.createOscillator();
      const env  = this.ctx!.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const vol = 0.12 + i * 0.022;
      env.gain.setValueAtTime(0,   when);
      env.gain.linearRampToValueAtTime(vol, when + 0.007);
      env.gain.linearRampToValueAtTime(0,   when + 0.19);
      osc.connect(env);
      env.connect(this._sfxBus!);
      osc.start(when);
      osc.stop(when + 0.22);
    });
  }

  playImpact(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;

    const kick = this.ctx.createOscillator();
    const kEnv = this.ctx.createGain();
    kick.type = 'sine';
    kick.frequency.setValueAtTime(90, now);
    kick.frequency.linearRampToValueAtTime(28, now + 0.18);
    kEnv.gain.setValueAtTime(0,    now);
    kEnv.gain.linearRampToValueAtTime(0.55, now + 0.008);
    kEnv.gain.linearRampToValueAtTime(0,    now + 0.22);
    kick.connect(kEnv); kEnv.connect(this._sfxBus!);
    kick.start(now); kick.stop(now + 0.25);

    const crack = this.ctx.createOscillator();
    const cEnv  = this.ctx.createGain();
    crack.type = 'triangle';
    crack.frequency.setValueAtTime(320, now);
    crack.frequency.linearRampToValueAtTime(80, now + 0.10);
    cEnv.gain.setValueAtTime(0,    now);
    cEnv.gain.linearRampToValueAtTime(0.30, now + 0.006);
    cEnv.gain.linearRampToValueAtTime(0,    now + 0.12);
    crack.connect(cEnv); cEnv.connect(this._sfxBus!);
    crack.start(now); crack.stop(now + 0.15);
  }

  private _sectionBaseFreq(beat: number): number {
    if (beat <  16) return 1050;
    if (beat <  32) return 1400;
    if (beat <  48) return 1900;
    if (beat <  64) return 2600;
    if (beat <  80) return 3200;
    if (beat <  96) return 4500;
    if (beat < 112) return 4200;
    if (beat < 144) return  750;
    if (beat < 160) return 4500;
    if (beat < 224) return 1800;
    return 5800;
  }

  private _buildChain(): void {
    const ctx = this.ctx!;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value     =  5;
    comp.knee.value      =  6;
    comp.attack.value    =  0.008;
    comp.release.value   =  0.10;
    comp.connect(ctx.destination);

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0;
    this._musicVolNode = ctx.createGain();
    this._musicVolNode.gain.value = this._musicVolScale;
    this.masterGain.connect(this._musicVolNode);
    this._musicVolNode.connect(comp);

    this._sfxBus = ctx.createGain();
    this._sfxBus.gain.value = 0.85;
    this._sfxVolNode = ctx.createGain();
    this._sfxVolNode.gain.value = this._sfxVolScale;
    this._sfxBus.connect(this._sfxVolNode);
    this._sfxVolNode.connect(comp);

    const delay    = ctx.createDelay(1.0);
    delay.delayTime.value = 0.22;
    const feedback = ctx.createGain(); feedback.gain.value = 0.38;
    const delWet   = ctx.createGain(); delWet.gain.value   = 0.28;
    this._feedbackGain = feedback;
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(delWet);
    delWet.connect(this.masterGain);

    this.mfilt = ctx.createBiquadFilter();
    this.mfilt.type            = 'lowpass';
    this.mfilt.frequency.value = 1200;
    this.mfilt.Q.value         = 0.8;
    this.mfilt.connect(this.masterGain);
    this.mfilt.connect(delay);

    const voiceBus = ctx.createGain();
    voiceBus.gain.value = 0.75 / VOICE_COUNT;
    voiceBus.connect(this.mfilt);

    this.voices = [];
    for (let i = 0; i < VOICE_COUNT; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const env = ctx.createGain();
      env.gain.value = 0;
      osc.connect(env);
      env.connect(voiceBus);
      osc.start();
      this.voices.push({ osc, env, startTime: 0, active: false });
    }
  }

  private _tick = (): void => {
    if (!this._playing) return;
    this._scheduleUpcoming();
    this._rafId = requestAnimationFrame(this._tick);
  };

  private _scheduleUpcoming(): void {
    if (!this.ctx || !this._playing || this.notes.length === 0) return;
    const now     = this.ctx.currentTime;
    const horizon = now + LOOK_AHEAD;

    while (
      this._noteIdx < this.notes.length &&
      this._startAt + this.notes[this._noteIdx].time <= horizon
    ) {
      const n    = this.notes[this._noteIdx++];
      const when = this._startAt + n.time;
      if (when < now - 0.05) continue; // already past — skip stale note
      this._triggerVoice(n.pitch, n.dur, n.velocity, when, n.isDrum ?? false);
    }

    // Loop: when all notes have been dispatched, reschedule from the top
    if (this._noteIdx >= this.notes.length) {
      const last  = this.notes[this.notes.length - 1];
      this._startAt = this._startAt + last.time + last.dur + 0.5;
      this._noteIdx = 0;
    }
  }

  private _triggerVoice(
    pitch:    number,
    dur:      number,
    velocity: number,
    when:     number,
    isDrum:   boolean = false,
  ): void {
    if (!this.ctx) return;

    // Pick a free voice; if all are busy, steal the oldest one
    let v = this.voices.find(x => !x.active);
    if (!v) {
      v = this.voices.reduce((oldest, x) => x.startTime < oldest.startTime ? x : oldest);
    }

    let freq: number, vol: number, attack: number, decay: number, sustain: number, release: number;

    if (isDrum) {
      // Percussion: very short punchy envelope, freq mapped from drum id
      freq    = _drumFreq(pitch);
      vol     = velocity * (freq < 200 ? 0.30 : freq < 700 ? 0.14 : 0.08);
      attack  = 0.001;
      decay   = freq < 200 ? 0.06 : 0.025;
      sustain = 0.0;
      release = freq < 200 ? 0.10 : 0.04;
    } else {
      // Melodic: pitch-derived frequency, bass vs treble envelope
      freq    = 440 * Math.pow(2, (pitch - 69) / 12);
      const isLow = pitch < 50;
      vol     = velocity * (isLow ? 0.18 : 0.11);
      attack  = isLow ? 0.012 : 0.008;
      decay   = isLow ? 0.3   : 0.12;
      sustain = isLow ? 0.50  : 0.65;
      release = isLow ? 0.40  : 0.28;
    }

    v.osc.frequency.cancelScheduledValues(when);
    v.osc.frequency.setValueAtTime(freq, when);

    v.env.gain.cancelScheduledValues(when);
    v.env.gain.setValueAtTime(0, when);
    v.env.gain.linearRampToValueAtTime(vol, when + attack);
    v.env.gain.setTargetAtTime(vol * sustain, when + attack + attack * 0.1, decay * 0.4);

    const offTime = when + Math.max(dur, attack + 0.02);
    v.env.gain.setTargetAtTime(0, offTime, release * 0.4);

    v.active    = true;
    v.startTime = when;

    const freeInMs = Math.max(0, (offTime - this.ctx.currentTime + release * 2)) * 1000;
    setTimeout(() => { if (v) v.active = false; }, freeInMs);
  }
}
