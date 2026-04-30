// ─── MusicEngine ──────────────────────────────────────────────────────────────
//
// Web Audio API music system for Any Additional Advantage.
//
// Signal chain (ported from music-engine.js):
//   voice pool (sawtooth oscillators)
//     → mfilt   (lowpass BiquadFilter  ← PRIMARY MODULATION POINT)
//       → delay  (FeedbackDelay, 220ms)
//         → masterGain → compressor → destination
//
// Filter modulation runs every frame and blends four independent signals:
//   1. Section frequency  — opens as the track builds (650 Hz intro → 5800 Hz climax)
//   2. Combat offset      — closes proportionally to live enemy count (-2800 Hz max)
//   3. Kill-chain boost   — rewards kill chains with brighter sound (+450 Hz per level)
//   4. Beat accent        — transient spike on every beat (decays in ~125ms)
//
// A slow LFO (15-second period) multiplies the section frequency so the
// filter always has organic motion even with no combat activity.
//
// Usage:
//   const engine = new MusicEngine();
//   await engine.load('/track.mid');   // call once, before first game start
//   engine.start();                    // call on user gesture (game start click)
//   engine.setGameState(n, chain, beat); // call every frame
//   engine.onBeat(beat);               // call from WaveScheduler per beat
//   engine.update(dt);                 // call every frame
//   engine.stop();                     // call on game over / restart

// ─── MIDI note extractor ──────────────────────────────────────────────────────
// Minimal parser — extracts Note On/Off pairs, skips drums (ch 9), applies
// octave shift.  Handles running status and variable-length quantities.

const OCTAVE_SHIFT  = -12;   // shift all notes one octave down (space atmosphere)
const PITCH_MIN     = 21;    // ignore notes below A0
const PITCH_MAX     = 91;    // ignore notes above G#6 (very high harmonics)

interface ParsedNote {
  time:     number;   // seconds from track start
  dur:      number;   // duration in seconds
  pitch:    number;   // MIDI note number after shift (or drum id for ch9)
  velocity: number;   // 0.0 – 1.0
  isDrum?:  boolean;  // true for channel-9 percussion notes
}

// General MIDI ch9 drum id → synthesised frequency
const _DRUM_FREQS: Record<number, number> = {
  35: 58,  36: 65,                      // bass kick
  37: 260, 38: 220, 40: 220, 39: 280,   // snare / clap
  41: 130, 43: 155, 45: 185, 47: 215, 48: 260, 50: 310,  // toms
  42: 820, 44: 750, 46: 980,            // hi-hat (closed / pedal / open)
  49: 1900, 51: 1350, 52: 1600, 53: 1100, 57: 1750, 59: 1250,  // cymbals
};
function _drumFreq(p: number): number { return _DRUM_FREQS[p] ?? 400; }

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
                const shifted = pitch + OCTAVE_SHIFT;
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
              const shifted = pitch + OCTAVE_SHIFT;
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

  // ─────────────────────────────────────────────────────────────────────────────

  /** Fetch and parse the MIDI file — call once before first start() */
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

  /** Start playback — must be called from a user-gesture context (click/tap) */
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

    // Fade in over 2.5s — 1.248 (+30% from previous 0.96) to push MIDI further front
    this.masterGain!.gain.setValueAtTime(0, this.ctx.currentTime);
    this.masterGain!.gain.linearRampToValueAtTime(1.248, this.ctx.currentTime + 2.5);

    this._tick();
  }

  /** Immediate stop — fades out over 0.4 s then closes AudioContext */
  stop(): void {
    this._fadeAndClose(0.4);
  }

  /** Slow fade — lets music linger for `duration` seconds before silence */
  fadeOut(duration: number): void {
    this._fadeAndClose(duration);
  }

  /**
   * Gradual slow-mo death filter — closes the sound over `duration` seconds.
   * Squelches the filter, swells reverb, and rises Q for a "tape wind-down" timbre.
   */
  startDeathFilter(duration = 0.7): void {
    if (!this.mfilt || !this.ctx) return;
    const now = this.ctx.currentTime;
    // Ramp filter from current freq down to a deep muffled 240 Hz
    this.mfilt.frequency.cancelScheduledValues(now);
    this.mfilt.frequency.setValueAtTime(this.mfilt.frequency.value, now);
    this.mfilt.frequency.linearRampToValueAtTime(240, now + duration);
    // Q climbs to 12.0 — heavy woozy resonance, like a tape slowing down
    this.mfilt.Q.cancelScheduledValues(now);
    this.mfilt.Q.setValueAtTime(this.mfilt.Q.value, now);
    this.mfilt.Q.linearRampToValueAtTime(12.0, now + duration * 0.7);
    // Swell feedback to near-max — infinite wash of echo through the death sequence
    if (this._feedbackGain) {
      this._feedbackGain.gain.cancelScheduledValues(now);
      this._feedbackGain.gain.setValueAtTime(this._feedbackGain.gain.value, now);
      this._feedbackGain.gain.linearRampToValueAtTime(0.96, now + duration * 0.6);
    }
  }

  private _fadeAndClose(duration: number): void {
    this._playing = false;
    if (this._rafId !== null) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    // Kill charge tone immediately on stop
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

  // ── Per-frame update ────────────────────────────────────────────────────────

  /**
   * Call every game frame.  Drives all filter modulation:
   * LFO breathing + beat accent decay + game-state targets → mfilt.frequency
   */
  update(dt: number): void {
    if (!this._playing || !this.mfilt || !this.ctx) return;

    const q = this._quickenFrac;
    const qSq = q * q; // accelerating curve for more dramatic high-end effect

    // ── 1. LFO — period shrinks from 15s down to ~4s at full quicken ───────
    this._lfoPhase += dt * (Math.PI * 2 / 15) * (1 + q * 2.5);
    // Oscillates between 0.56 and 1.0 — multiplies section frequency
    const lfo = Math.sin(this._lfoPhase) * 0.22 + 0.78;

    // ── 2. Beat accent decay ────────────────────────────────────────────────
    this._beatAccent = Math.max(0, this._beatAccent - dt * 6);

    // ── 3. Compute target filter frequency ─────────────────────────────────
    // Quicken pushes the filter wide open (brighter, more intense tone)
    const quickenFreqBoost = q * 2200;
    const target = Math.max(FREQ_MIN, Math.min(FREQ_MAX,
      this._sectionFreq * lfo   // section baseline, breathing with LFO
      + this._combatOffset      // enemy pressure closes the filter
      + this._chainBoost        // kill chain reward opens it
      + this._beatAccent * 700  // transient peak on each beat hit
      + quickenFreqBoost,       // quicken brightens and opens the sound
    ));

    // ── 4. Smooth ramp to target ────────────────────────────────────────────
    const now = this.ctx.currentTime;
    this.mfilt.frequency.setTargetAtTime(target, now, 0.025);

    // ── 5. Q modulation — resonance spikes with beat + rises hard with quicken
    // At rest: Q ≈ 0.8; at full quicken: screaming resonance up to ~7.0
    const combatQ  = this._combatOffset < -500 ? 0.6 : 0;
    const quickenQ = qSq * 5.5;
    this.mfilt.Q.setTargetAtTime(0.8 + this._beatAccent * 2.6 + combatQ + quickenQ, now, 0.04);

    // ── 6. Delay feedback swells with quicken (more echo chaos at high levels)
    if (this._feedbackGain) {
      const targetFeedback = 0.38 + qSq * 0.25; // 0.38 → 0.63 max
      this._feedbackGain.gain.setTargetAtTime(Math.min(targetFeedback, 0.63), now, 0.15);
    }
  }

  /**
   * Feed current game state every frame.
   * @param enemyCount   number of alive enemies (0–MAX_ACTIVE)
   * @param killChain    current kill-chain multiplier (1 = no chain)
   * @param beat         current beat index from WaveScheduler
   */
  setGameState(enemyCount: number, killChain: number, beat: number): void {
    this._sectionFreq  = this._sectionBaseFreq(beat);
    this._combatOffset = -(enemyCount / 12) * 900;  // 0 → -900 Hz (darkens without silencing)
    this._chainBoost   = Math.min(killChain - 1, 7) * 450; // 0 → +3150 Hz
  }

  /** Feed quicken level every frame (0–1 fraction of max quicken). */
  setQuicken(qFrac: number): void {
    this._quickenFrac = Math.max(0, Math.min(1, qFrac));
  }

  /**
   * Trigger beat-accent pulse — wire to WaveScheduler.onBeatCallback.
   * Downbeats (every 4th) get a stronger accent + audible kick.
   */
  onBeat(beat: number): void {
    const isDownbeat = beat % 4 === 0;
    this._beatAccent = isDownbeat ? 1.8 : 1.0;
  }

  get isPlaying():   boolean { return this._playing; }
  /** Current beat-accent value (1 = just fired, 0 = decayed) — read by Game.ts */
  get beatAccent():  number  { return this._beatAccent; }

  /** Set music volume (0–1). Persists across restarts. */
  setMusicVolume(v: number): void {
    this._musicVolScale = Math.max(0, Math.min(1, v));
    if (this._musicVolNode) this._musicVolNode.gain.value = this._musicVolScale;
  }

  /** Set SFX volume (0–1). Persists across restarts. */
  setSfxVolume(v: number): void {
    this._sfxVolScale = Math.max(0, Math.min(1, v));
    if (this._sfxVolNode) this._sfxVolNode.gain.value = this._sfxVolScale;
  }

  /**
   * Short resolution tone played on detonation release.
   * The charge sweeps UP (A2→A4); this resolves DOWN to E3 (fifth below root)
   * giving a satisfying "thunk" of tension releasing.
   */
  playChargeRelease(chargeProgress: number): void {
    if (!this.ctx || !this._sfxBus) return;
    const now = this.ctx.currentTime;

    // Pitch tracks charge: full charge resolves from A4 (440Hz) down to E3 (165Hz);
    // low charge resolves from A3 (220Hz) down to E3 — always lands on the fifth.
    const startFreq = 220 + chargeProgress * 220; // 220–440 Hz
    const endFreq   = 164.8;                       // E3 — the fifth below

    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.18);

    const vol = 0.10 + chargeProgress * 0.10; // louder at full charge
    env.gain.setValueAtTime(vol, now);
    env.gain.linearRampToValueAtTime(0, now + 0.22);

    osc.connect(env);
    env.connect(this._sfxBus);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  /**
   * Call every frame while the player is charging.
   * Starts a sustained sawtooth tone that sweeps A2 (110 Hz) → A4 (440 Hz)
   * as progress goes 0 → 1.  Pass progress=0 to silence and clean up.
   * Exponential frequency curve gives the satisfying "winding up" feel.
   */
  updateChargeTone(progress: number): void {
    if (!this.ctx || !this._sfxBus) return;
    const now = this.ctx.currentTime;

    if (progress <= 0) {
      if (this._chargeToneGain) {
        this._chargeToneGain.gain.setTargetAtTime(0, now, 0.02);
        const osc  = this._chargeToneOsc!;
        const env  = this._chargeToneGain;
        setTimeout(() => { try { osc.stop(); } catch {} env.disconnect(); }, 80);
        this._chargeToneOsc  = null;
        this._chargeToneGain = null;
      }
      return;
    }

    // Create oscillator on first non-zero call
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

    // Exponential sweep: 110 Hz (A2) at 0 → 440 Hz (A4) at 1
    const freq = 110 * Math.pow(4, progress);   // 110 · 4^p
    const vol  = progress * 0.015;              // silent at 0, quiet at full charge
    this._chargeToneOsc.frequency.setTargetAtTime(freq, now, 0.04);
    this._chargeToneGain!.gain.setTargetAtTime(vol, now, 0.04);
  }

  /**
   * Descending triangle thud on enemy kill.
   * Debounced so a full salvo only fires one sound.
   * Linear ramps are the most reliable envelope shape across browsers.
   */
  playKill(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;

    // Debounce: ignore if another kill sound fired within 130 ms
    if (now - this._lastKillTime < 0.13) return;
    this._lastKillTime = now;

    const vol = 0.22 + this._beatAccent * 0.10;

    // Low triangle descend: 200 Hz → 45 Hz over 200 ms
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.linearRampToValueAtTime(45, now + 0.20);

    // Simple linear attack + decay — guaranteed to be heard
    env.gain.setValueAtTime(0,   now);
    env.gain.linearRampToValueAtTime(vol, now + 0.015);
    env.gain.linearRampToValueAtTime(0,   now + 0.22);

    osc.connect(env);
    env.connect(this._sfxBus!);
    osc.start(now);
    osc.stop(now + 0.28);
  }

  /**
   * Short descending pop for each enemy killed in a chain.
   * Calls in rapid succession (same frame) are staggered 70 ms apart using
   * Web Audio scheduling, so the chain sounds sequential, not all-at-once.
   */
  playChainPop(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    // New burst if more than 500 ms since the chain started
    if (now - this._chainPopBase > 0.5) {
      this._chainPopIdx  = 0;
      this._chainPopBase = now;
    }
    const when = now + this._chainPopIdx * 0.07;  // 70 ms between each pop
    this._chainPopIdx++;

    // Crisp tick: sawtooth 300 Hz → 75 Hz (two octaves lower), near-instant attack, 25 ms total
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, when);
    osc.frequency.linearRampToValueAtTime(75, when + 0.022);
    env.gain.setValueAtTime(0,    when);
    env.gain.linearRampToValueAtTime(0.14, when + 0.001);  // snap attack
    env.gain.linearRampToValueAtTime(0,    when + 0.025);  // fast decay
    osc.connect(env);
    env.connect(this._sfxBus!);
    osc.start(when);
    osc.stop(when + 0.03);
  }

  /**
   * Last-bomb warning pulse — urgent descending two-tone beep (A5 → C#5).
   * Square wave keeps it harsh and attention-grabbing.
   */
  playLastBombWarning(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    [880.0, 554.4].forEach((freq, i) => {
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

  /**
   * 10-second countdown tick — single crisp triangle pulse at C6 (1047 Hz).
   * Higher and shorter than the last-bomb warning; feels like a metronome tick.
   */
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

  /**
   * Score pickup chime — two-note ascending pair (D5 → E5) in A minor pentatonic.
   * Bright, clean sine tone that cuts through the mix.
   */
  playPickupScore(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    // D5 (587 Hz) → E5 (659 Hz) — tight bright step, 85 ms apart
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

  /**
   * Time pickup tone — hollow perfect fifth (A3 → E4) in A minor pentatonic.
   * Warm triangle pair that feels like a ticking bonus.
   */
  playPickupTime(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    // A3 (220 Hz) → E4 (330 Hz) — perfect fifth, 110 ms apart
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

  /**
   * Quicken pickup arpeggio — ascending 5-note run through A minor pentatonic.
   * A3 → C4 → E4 → G4 → A4, each note 80 ms apart, rising in volume.
   */
  playPickupQuicken(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    // A minor pentatonic: A3 C4 E4 G4 A4
    [220.0, 261.6, 329.6, 392.0, 440.0].forEach((freq, i) => {
      const when = now + i * 0.08;
      const osc  = this.ctx!.createOscillator();
      const env  = this.ctx!.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const vol = 0.12 + i * 0.022; // crescendo as it climbs
      env.gain.setValueAtTime(0,   when);
      env.gain.linearRampToValueAtTime(vol, when + 0.007);
      env.gain.linearRampToValueAtTime(0,   when + 0.19);
      osc.connect(env);
      env.connect(this._sfxBus!);
      osc.start(when);
      osc.stop(when + 0.22);
    });
  }

  /**
   * Missile impact on-beat — big percussive BOOM.
   * Called when a missile hits its target; sounds best when synced to beat.
   */
  playImpact(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;

    // Sub-bass kick: 90 Hz → 28 Hz over 180 ms
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

    // Mid crack: short triangle 320 → 80 Hz
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

  // ── Section frequency table ─────────────────────────────────────────────────
  // Maps beat index → base filter frequency (Hz), matching WaveSchedule sections.
  // Values chosen to mirror the preset table from music-engine.js:
  //   intro ≈ tubby/basic (closed), full ≈ synthwave (wide), climax = maximum.

  private _sectionBaseFreq(beat: number): number {
    if (beat <  16) return 1050;   // Intro       — tight, mysterious
    if (beat <  32) return 1400;   // Build A #1  — bass enters, opening up
    if (beat <  48) return 1900;   // Build A #2  — paired sweeps
    if (beat <  64) return 2600;   // Build B #1  — radial clusters emerge
    if (beat <  80) return 3200;   // Build B #2  — density increases
    if (beat <  96) return 4500;   // Full #1     — all layers, arcs, wide open
    if (beat < 112) return 4200;   // Full #2     — linear rows
    if (beat < 144) return  750;   // Break       — drums drop, closed down
    if (beat < 160) return 4500;   // Section 2   — full return, wide again
    if (beat < 224) return 1800;   // Long Break  — moderate, paired threats
    return 5800;                   // Climax      — maximum brightness
  }

  // ── Signal chain ────────────────────────────────────────────────────────────

  private _buildChain(): void {
    const ctx = this.ctx!;

    // ── Output ───────────────────────────────────────────────────────────────
    // Glue compressor: catches peaks from both MIDI voices and SFX together,
    // giving the whole mix a unified punchy character.
    //   threshold −18 dBFS: catches musical peaks without killing dynamics
    //   ratio 5:1: noticeable squeeze without squashing all life out
    //   knee 6 dB: soft onset — transparent on quieter notes
    //   attack 8ms: lets the initial hit of SFX transients through (= punch)
    //   release 100ms: fast enough to recover between beats without pumping
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

    // SFX bus: bypasses masterGain so MIDI volume changes don't affect SFX.
    // Goes straight to the glue compressor so the whole mix still gets glued.
    this._sfxBus = ctx.createGain();
    this._sfxBus.gain.value = 0.85;
    this._sfxVolNode = ctx.createGain();
    this._sfxVolNode.gain.value = this._sfxVolScale;
    this._sfxBus.connect(this._sfxVolNode);
    this._sfxVolNode.connect(comp);

    // ── Feedback delay (8n. ≈ 220ms @ 136 bpm — synthwave preset) ───────────
    const delay    = ctx.createDelay(1.0);
    delay.delayTime.value = 0.22;
    const feedback = ctx.createGain(); feedback.gain.value = 0.38;
    const delWet   = ctx.createGain(); delWet.gain.value   = 0.28;
    this._feedbackGain = feedback;   // store so update() can modulate it
    delay.connect(feedback);
    feedback.connect(delay);     // feedback loop
    delay.connect(delWet);
    delWet.connect(this.masterGain);

    // ── mfilt — primary modulation point ────────────────────────────────────
    // Equivalent to music-engine.js:
    //   mfilt = new Tone.Filter({ frequency:1200, type:'lowpass', rolloff:-24 })
    this.mfilt = ctx.createBiquadFilter();
    this.mfilt.type           = 'lowpass';
    this.mfilt.frequency.value = 1200;
    this.mfilt.Q.value         = 0.8;

    this.mfilt.connect(this.masterGain); // dry path
    this.mfilt.connect(delay);           // wet path → feedback delay

    // ── Voice pool ───────────────────────────────────────────────────────────
    // 12 sawtooth oscillators with individual gain envelopes (ADSR).
    // All route through a shared mix bus into mfilt.
    const voiceBus = ctx.createGain();
    voiceBus.gain.value = 0.75 / VOICE_COUNT; // normalise per-voice contribution
    voiceBus.connect(this.mfilt);

    this.voices = [];
    for (let i = 0; i < VOICE_COUNT; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth'; // synthwave preset oscillator type
      const env = ctx.createGain();
      env.gain.value = 0;
      osc.connect(env);
      env.connect(voiceBus);
      osc.start();
      this.voices.push({ osc, env, startTime: 0, active: false });
    }
  }

  // ── Note scheduling loop ─────────────────────────────────────────────────

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
