import * as THREE from 'three';
import { RAIL } from '../config';

// ─── TunnelRenderer ────────────────────────────────────────────────────────────
// Minter-mode hyperspace tunnel.
//
//  • 48 rings, tightly spaced, scrolling at 3.5× rail speed
//  • Per-ring: random rotation speed (CW or CCW), random phase offset
//  • 3 alternating ring sizes give depth illusion (outer / mid / inner)
//  • Rolling rainbow hue-wave sweeps front-to-back every few seconds
//  • Scale "breathing" with sinusoidal per-ring oscillators
//  • Minter multiplier drives hue-cycle speed, breath amplitude, rotation frenzy
//  • Beat accent sends a radius pulse + brightness spike through every ring

const NUM_RINGS    = 62;
const RING_SPACING = 28;      // tighter spacing — denser tube
const RING_RADIUS  = 215;     // base ring radius
const SEGMENTS     = 24;      // smoother circle
const TOTAL_DEPTH  = NUM_RINGS * RING_SPACING;
const SCROLL_MULT  = 4.5;     // base visual scroll speed vs. rail speed

export class TunnelRenderer {
  private rings: { mesh: THREE.LineLoop; mat: THREE.LineBasicMaterial }[] = [];
  private scene:    THREE.Scene;
  private offsets:  Float32Array;   // per-ring distance ahead
  private phases:   Float32Array;   // per-ring animation phase
  private rotSpeeds: Float32Array;  // per-ring spin speed (rad/s, signed)
  private sizeScale: Float32Array;  // per-ring base scale from SIZE_CYCLE
  private rotAngles: Float32Array;  // accumulated rotation per ring
  private _time = 0;
  private _quickenFlash = 0; // 1→0 on quicken pickup, pulses rings white

  constructor(scene: THREE.Scene) {
    this.scene     = scene;
    this.offsets   = new Float32Array(NUM_RINGS);
    this.phases    = new Float32Array(NUM_RINGS);
    this.rotSpeeds = new Float32Array(NUM_RINGS);
    this.sizeScale = new Float32Array(NUM_RINGS);
    this.rotAngles = new Float32Array(NUM_RINGS);

    for (let i = 0; i < NUM_RINGS; i++) {
      this.offsets[i]   = (i + 1) * RING_SPACING;
      this.phases[i]    = Math.random() * Math.PI * 2;
      // Very slow drift — enough to feel alive, not enough to break the tunnel feel
      this.rotSpeeds[i] = ((Math.random() > 0.5 ? 1 : -1))
                        * (0.008 + Math.random() * 0.04);
      this.sizeScale[i] = 1.0;   // uniform — perspective projection creates depth
    }
    this._build();
  }

  private _build(): void {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * RING_RADIUS, Math.sin(a) * RING_RADIUS, 0));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);

    for (let i = 0; i < NUM_RINGS; i++) {
      const mat = new THREE.LineBasicMaterial({
        color:       0x001133,
        transparent: true,
        opacity:     0,
        depthWrite:  false,
      });
      const mesh = new THREE.LineLoop(geo, mat);
      this.scene.add(mesh);
      this.rings.push({ mesh, mat });
    }
  }

  update(
    playerPos:   THREE.Vector3,
    _bloomScale: number,
    dt:          number,
    minterMult:  number = 1,
    beatAccent:  number = 0,
    speedFactor: number = 0,
    quickenFrac: number = 0,
    animDt?:     number,   // real-clock dt for wave/hue/breath — avoids snap on slow-mo entry
  ): void {
    const adt = animDt ?? dt;  // wave animation always ticks at wall-clock speed
    this._time += adt;
    // Flash decays in ~0.67 s — matched to HUD edge-glow so both fade together
    if (this._quickenFlash > 0) this._quickenFlash = Math.max(0, this._quickenFlash - dt * 1.5);

    const mBoost    = (minterMult - 1) / 8;   // 0 (×1) → 1 (×9)
    const beatFlash = beatAccent;
    const qSq       = quickenFrac * quickenFrac; // accelerating curve

    // Hue wave — quicken pushes it much faster so colors stream in a frenzy
    const hueSpeed = 0.10 + mBoost * 0.50 + speedFactor * 0.10 + quickenFrac * 0.80;
    const hueBase  = this._time * hueSpeed;

    // Breathing: subtle at rest, gets wilder with quicken
    const breathAmp = 0.025 + mBoost * 0.08 + qSq * 0.11;

    // Rotation: creeps normally, spins hard at high quicken
    const rotMult = 1.0 + mBoost * 1.2 + qSq * 2.5;

    // Scroll speed climbs with both progression and quicken
    const scrollSpeed = RAIL.SPEED * SCROLL_MULT * (1.0 + speedFactor * 0.45 + quickenFrac * 2.5);

    // ── Wormhole traveling waves ─────────────────────────────────────────────────
    // Two overlapping waves travel along the tube axis at different temporal AND
    // spatial frequencies.  Each ring's lateral offset depends on both time and
    // its own depth, so the tube writhes like a living worm rather than rotating
    // as a rigid body.  The incommensurate frequency ratios (f2/f1 ≈ 1.81,
    // k2/k1 ≈ 1.59) produce aperiodic, organic-feeling motion.
    const swirlAmp = 220 + quickenFrac * 310;   // amplitude at full depth (world units)
    const f1 = 0.27 + quickenFrac * 0.65;       // temporal freq, wave 1 (slow)
    const f2 = 0.49 + quickenFrac * 1.175;      // temporal freq, wave 2 (faster)
    const k1 = 3.2;   // spatial wavelengths across tube depth, wave 1
    const k2 = 5.1;   // spatial wavelengths, wave 2

    for (let i = 0; i < NUM_RINGS; i++) {
      // ── Scroll ──────────────────────────────────────────────────────────
      this.offsets[i] -= scrollSpeed * dt;
      if (this.offsets[i] <= 0) this.offsets[i] += TOTAL_DEPTH;

      const distAhead = this.offsets[i];
      const depthFrac = distAhead / TOTAL_DEPTH;   // 0 = near camera, 1 = far end
      const t         = 1 - depthFrac;             // brightness proxy: 1=near, 0=far
      const tSq       = t * t;
      const tCube     = tSq * t;

      // ── Per-ring traveling wave bend ─────────────────────────────────────
      // power-of-0.7 gives mid-visible rings more amplitude than pure linear
      const bendDepth = Math.pow(depthFrac, 0.7);
      const tWave1 = this._time * f1 - depthFrac * k1;
      const tWave2 = this._time * f2 - depthFrac * k2;
      const ringBendX = swirlAmp * bendDepth * (Math.sin(tWave1) * 0.60 + Math.sin(tWave2 + 1.30) * 0.40);
      const ringBendY = swirlAmp * bendDepth * (Math.cos(tWave1 + 1.10) * 0.55 + Math.cos(tWave2 + 2.70) * 0.45);

      // Z compression at bends: rings bunch where the tube curves most, giving
      // variable perceived spacing that strongly signals curvature
      const bendMag = Math.hypot(ringBendX, ringBendY);
      this.rings[i].mesh.position.set(
        ringBendX,
        ringBendY,
        playerPos.z - distAhead + bendMag * 0.04,
      );

      // ── Rotation ────────────────────────────────────────────────────────
      this.rotAngles[i] += this.rotSpeeds[i] * rotMult * dt;
      this.rings[i].mesh.rotation.z = this.rotAngles[i];

      // ── Scale breathing ──────────────────────────────────────────────────
      const breathFreq = 1.2 + (i % 9) * 0.14;
      const breath     = 1.0 + Math.sin(this._time * breathFreq + this.phases[i]) * breathAmp;
      this.rings[i].mesh.scale.setScalar(this.sizeScale[i] * breath);

      // ── Hue wave ─────────────────────────────────────────────────────────
      const ringFrac = i / NUM_RINGS;
      const shimmer  = mBoost > 0.5
        ? Math.sin(this._time * 4.0 + this.phases[i] * 2) * mBoost * 0.06
        : 0;
      const hue = ((hueBase + ringFrac * 0.80 + shimmer) % 1 + 1) % 1;

      // ── Luminance — quadratic falloff reveals more mid-depth rings ───────
      const baseL   = 0.04 + t * 0.14 + tSq * 0.30 + tCube * 0.18;
      const minterL = mBoost * 0.10 * t;
      const beatL   = beatFlash * 0.06 * t;
      const quickL  = quickenFrac * 0.20 * t;
      const flashL  = this._quickenFlash * 1.0 * Math.min(t * 2, 1);
      const lum     = Math.min(baseL + minterL + beatL + quickL + flashL, 0.92);

      const sat = (0.70 + mBoost * 0.30 + beatFlash * 0.10) * (1 - this._quickenFlash * 0.95);
      this.rings[i].mat.color.setHSL(hue, sat, lum);

      // ── Opacity — more visible at mid-depth so the writhing reads clearly ─
      const baseOp  = 0.04 + t * 0.22 + tSq * 0.55;
      const mOp     = mBoost * t * 0.06;
      const beatOp  = beatFlash * t * 0.06;
      const quickOp = quickenFrac * t * 0.12;
      const flashOp = this._quickenFlash * 0.70 * t;
      this.rings[i].mat.opacity = Math.min(baseOp + mOp + beatOp + quickOp + flashOp, 0.97);
    }
  }

  /** Call when a quicken pickup is collected — flashes rings white-cyan */
  triggerQuickenFlash(): void { this._quickenFlash = 1.0; }

  dispose(): void {
    for (const { mesh } of this.rings) this.scene.remove(mesh);
    this.rings = [];
  }
}
