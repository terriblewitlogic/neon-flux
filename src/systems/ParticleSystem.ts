import * as THREE from 'three';
import { VISUAL } from '../config';

// ─── Pooled particle system ─────────────────────────────────────────────────
// Pre-allocated flat arrays — no GC pressure in the hot loop.
// Each particle has: position (3), velocity (3), color (3), lifetime, maxLifetime.

const MAX = VISUAL.MAX_PARTICLES;

interface ParticleEmitOptions {
  origin: THREE.Vector3;
  count: number;
  speed: number;        // base ejection speed
  speedVariance: number;
  color: THREE.Color;
  colorVariance?: number;  // hue variance (0–1)
  lifetime: number;
  lifetimeVariance: number;
  gravity?: number;
}

export class ParticleSystem {
  readonly mesh: THREE.Points;

  private positions  = new Float32Array(MAX * 3);
  private velocities = new Float32Array(MAX * 3);
  private colors     = new Float32Array(MAX * 3);
  private lifetimes  = new Float32Array(MAX);
  private maxLives   = new Float32Array(MAX);
  private active     = 0;

  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;

  constructor() {
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.colAttr = new THREE.BufferAttribute(this.colors, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color',    this.colAttr);
    geo.setDrawRange(0, 0);

    const mat = new THREE.PointsMaterial({
      size: VISUAL.PARTICLE_SIZE,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.mesh = new THREE.Points(geo, mat);
  }

  emit(opts: ParticleEmitOptions): void {
    const {
      origin, count, speed, speedVariance,
      color, colorVariance = 0,
      lifetime, lifetimeVariance,
      gravity = 0,
    } = opts;

    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);

    let spawned = 0;
    let idx = 0;
    while (spawned < count && idx < MAX) {
      // If this slot is dead, reuse it
      if (idx >= this.active || this.lifetimes[idx] <= 0) {
        const s = speed + (Math.random() - 0.5) * 2 * speedVariance;
        // Random direction on unit sphere
        const theta = Math.random() * Math.PI * 2;
        const phi   = Math.acos(2 * Math.random() - 1);
        this.positions[idx * 3]     = origin.x;
        this.positions[idx * 3 + 1] = origin.y;
        this.positions[idx * 3 + 2] = origin.z;
        this.velocities[idx * 3]     = s * Math.sin(phi) * Math.cos(theta);
        this.velocities[idx * 3 + 1] = s * Math.sin(phi) * Math.sin(theta) + gravity;
        this.velocities[idx * 3 + 2] = s * Math.cos(phi);

        const hv = colorVariance > 0 ? (Math.random() - 0.5) * colorVariance : 0;
        const pc = new THREE.Color().setHSL(
          (hsl.h + hv + 1) % 1,
          hsl.s,
          hsl.l,
        );
        this.colors[idx * 3]     = pc.r;
        this.colors[idx * 3 + 1] = pc.g;
        this.colors[idx * 3 + 2] = pc.b;

        const lt = lifetime + (Math.random() - 0.5) * 2 * lifetimeVariance;
        this.lifetimes[idx] = lt;
        this.maxLives[idx]  = lt;

        if (idx >= this.active) this.active = idx + 1;
        spawned++;
      }
      idx++;
    }
  }

  /** Burst radially outward then fade — standard explosion */
  explode(pos: THREE.Vector3, count: number, color: THREE.Color, multiplier: number): void {
    this.emit({
      origin: pos,
      count: Math.min(count * multiplier, 200),
      speed: 25 + multiplier * 8,
      speedVariance: 18,
      color,
      colorVariance: 0.18,
      lifetime: 1.0 + multiplier * 0.2,
      lifetimeVariance: 0.4,
    });
  }

  /** Spark spray in a direction (laser hit) */
  spark(pos: THREE.Vector3, dir: THREE.Vector3, color: THREE.Color, count = 8): void {
    // Emit a cone of sparks around dir
    const tmp = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * 0.8;
      tmp.copy(dir).multiplyScalar(40 + Math.random() * 30);
      tmp.x += (Math.random() - 0.5) * spread * 20;
      tmp.y += (Math.random() - 0.5) * spread * 20;
      tmp.z += (Math.random() - 0.5) * spread * 20;

      const idx = this._findSlot();
      if (idx < 0) return;
      this.positions[idx * 3]     = pos.x;
      this.positions[idx * 3 + 1] = pos.y;
      this.positions[idx * 3 + 2] = pos.z;
      this.velocities[idx * 3]     = tmp.x;
      this.velocities[idx * 3 + 1] = tmp.y;
      this.velocities[idx * 3 + 2] = tmp.z;
      this.colors[idx * 3]     = color.r;
      this.colors[idx * 3 + 1] = color.g;
      this.colors[idx * 3 + 2] = color.b;
      const lt = 0.3 + Math.random() * 0.3;
      this.lifetimes[idx] = lt;
      this.maxLives[idx]  = lt;
    }
  }

  private _findSlot(): number {
    for (let i = 0; i < MAX; i++) {
      if (i >= this.active || this.lifetimes[i] <= 0) {
        if (i >= this.active) this.active = i + 1;
        return i;
      }
    }
    return -1;
  }

  update(dt: number): void {
    let maxAlive = 0;
    for (let i = 0; i < this.active; i++) {
      if (this.lifetimes[i] <= 0) continue;
      this.lifetimes[i] -= dt;
      if (this.lifetimes[i] <= 0) continue;

      maxAlive = i + 1;
      const f = this.lifetimes[i] / this.maxLives[i]; // 1 = new, 0 = dying

      // Move
      this.positions[i * 3]     += this.velocities[i * 3]     * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;

      // Slow down
      this.velocities[i * 3]     *= 0.96;
      this.velocities[i * 3 + 1] *= 0.96;
      this.velocities[i * 3 + 2] *= 0.96;

      // Fade out: full brightness → dim
      const bright = f * 1.4;
      this.colors[i * 3]     = Math.min(this.colors[i * 3] * bright, 1);
      this.colors[i * 3 + 1] = Math.min(this.colors[i * 3 + 1] * bright, 1);
      this.colors[i * 3 + 2] = Math.min(this.colors[i * 3 + 2] * bright, 1);
    }
    this.active = maxAlive;

    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, this.active);
  }

  addToScene(scene: THREE.Scene): void {
    scene.add(this.mesh);
  }
}
