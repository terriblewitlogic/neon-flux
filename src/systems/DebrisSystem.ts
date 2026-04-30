import * as THREE from 'three';

// ─── DebrisSystem ─────────────────────────────────────────────────────────────
// Pooled wire-segment debris for enemy kill explosions.
// Each "fragment" is a single line segment that flies outward from the explosion
// point with three enhancements over a plain translate+fade:
//
//  1. Tumbling  — each fragment spins around a random axis via Rodrigues rotation.
//  2. Stretch   — stick shrinks toward a short nub as speed bleeds off, giving
//                 a "streaking shard → tumbling chip" feel.
//  3. Hot-flash — starts white and over-bright (bloom spike), transitions to the
//                 base explosion colour, then falls off on a steep power curve so
//                 fragments vanish well before their lifetime expires.

const MAX_SEGS = 512;

export class DebrisSystem {
  // Parallel per-segment state arrays
  private readonly cx: Float32Array = new Float32Array(MAX_SEGS); // centre x
  private readonly cy: Float32Array = new Float32Array(MAX_SEGS);
  private readonly cz: Float32Array = new Float32Array(MAX_SEGS);
  private readonly hx: Float32Array = new Float32Array(MAX_SEGS); // half-extent x
  private readonly hy: Float32Array = new Float32Array(MAX_SEGS);
  private readonly hz: Float32Array = new Float32Array(MAX_SEGS);
  private readonly vx: Float32Array = new Float32Array(MAX_SEGS); // velocity
  private readonly vy: Float32Array = new Float32Array(MAX_SEGS);
  private readonly vz: Float32Array = new Float32Array(MAX_SEGS);
  private readonly cr: Float32Array = new Float32Array(MAX_SEGS); // base colour r
  private readonly cg: Float32Array = new Float32Array(MAX_SEGS);
  private readonly cb: Float32Array = new Float32Array(MAX_SEGS);
  private readonly life:      Float32Array = new Float32Array(MAX_SEGS);
  private readonly maxLife:   Float32Array = new Float32Array(MAX_SEGS);
  // Tumble
  private readonly sax: Float32Array = new Float32Array(MAX_SEGS); // spin axis
  private readonly say: Float32Array = new Float32Array(MAX_SEGS);
  private readonly saz: Float32Array = new Float32Array(MAX_SEGS);
  private readonly spinOmega: Float32Array = new Float32Array(MAX_SEGS); // rad/s
  // Stretch
  private readonly initSpeed: Float32Array = new Float32Array(MAX_SEGS);

  // GPU buffers: 2 vertices per segment → MAX_SEGS*2 entries
  private readonly posArr: Float32Array = new Float32Array(MAX_SEGS * 6);
  private readonly colArr: Float32Array = new Float32Array(MAX_SEGS * 6);

  private geo:     THREE.BufferGeometry;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private lines:   THREE.LineSegments;

  constructor() {
    this.geo     = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.posArr, 3);
    this.colAttr = new THREE.BufferAttribute(this.colArr, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('color',    this.colAttr);
    this.geo.setDrawRange(0, MAX_SEGS * 2);

    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      blending:     THREE.AdditiveBlending,
      depthWrite:   false,
      toneMapped:   false,
    });
    this.lines = new THREE.LineSegments(this.geo, mat);
    this.lines.frustumCulled = false;
  }

  addToScene(scene: THREE.Scene): void {
    scene.add(this.lines);
  }

  /**
   * Burst `count` wire fragments from `pos` in `color`.
   * Silently drops if pool is exhausted.
   */
  spawn(pos: THREE.Vector3, color: THREE.Color, count: number): void {
    let spawned = 0;
    for (let i = 0; i < MAX_SEGS && spawned < count; i++) {
      if (this.life[i] > 0) continue;

      // ── Position ────────────────────────────────────────────────────────────
      this.cx[i] = pos.x;
      this.cy[i] = pos.y;
      this.cz[i] = pos.z;

      // ── Random outward velocity ──────────────────────────────────────────
      const vtheta = Math.random() * Math.PI * 2;
      const vphi   = Math.acos(2 * Math.random() - 1);
      const speed  = 60 + Math.random() * 120;
      this.vx[i] = Math.sin(vphi) * Math.cos(vtheta) * speed;
      this.vy[i] = Math.sin(vphi) * Math.sin(vtheta) * speed;
      this.vz[i] = Math.cos(vphi) * speed;
      this.initSpeed[i] = speed;

      // ── Half-extent: random-orientation stick 4–15 units long ───────────
      const len = 4 + Math.random() * 11;
      const et  = Math.random() * Math.PI * 2;
      const ep  = Math.acos(2 * Math.random() - 1);
      this.hx[i] = Math.sin(ep) * Math.cos(et) * len;
      this.hy[i] = Math.sin(ep) * Math.sin(et) * len;
      this.hz[i] = Math.cos(ep) * len;

      // ── Colour ──────────────────────────────────────────────────────────
      this.cr[i] = color.r;
      this.cg[i] = color.g;
      this.cb[i] = color.b;

      // ── Lifetime ────────────────────────────────────────────────────────
      const lt = 0.4 + Math.random() * 0.4;
      this.life[i]    = lt;
      this.maxLife[i] = lt;

      // ── Spin axis (random normalised) ────────────────────────────────────
      const sa = Math.random() * Math.PI * 2;
      const sp = Math.acos(2 * Math.random() - 1);
      this.sax[i] = Math.sin(sp) * Math.cos(sa);
      this.say[i] = Math.sin(sp) * Math.sin(sa);
      this.saz[i] = Math.cos(sp);
      this.spinOmega[i] = 3 + Math.random() * 7; // 3–10 rad/s

      spawned++;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < MAX_SEGS; i++) {
      const base = i * 6;

      if (this.life[i] <= 0) {
        // Dead slot — zero out so it's invisible
        this.posArr[base]   = 0; this.posArr[base+1] = 0; this.posArr[base+2] = 0;
        this.posArr[base+3] = 0; this.posArr[base+4] = 0; this.posArr[base+5] = 0;
        this.colArr[base]   = 0; this.colArr[base+1] = 0; this.colArr[base+2] = 0;
        this.colArr[base+3] = 0; this.colArr[base+4] = 0; this.colArr[base+5] = 0;
        continue;
      }

      this.life[i] -= dt;
      if (this.life[i] < 0) this.life[i] = 0;

      // ── Translate ───────────────────────────────────────────────────────
      this.cx[i] += this.vx[i] * dt;
      this.cy[i] += this.vy[i] * dt;
      this.cz[i] += this.vz[i] * dt;

      // ── Decelerate ──────────────────────────────────────────────────────
      this.vx[i] *= 0.95;
      this.vy[i] *= 0.95;
      this.vz[i] *= 0.95;

      // ── Tumble: rotate half-extent via Rodrigues' formula ────────────────
      // v' = v·cosθ + (k×v)·sinθ + k·(k·v)·(1−cosθ)
      const angle = this.spinOmega[i] * dt;
      const cosA  = Math.cos(angle);
      const sinA  = Math.sin(angle);
      const kx = this.sax[i], ky = this.say[i], kz = this.saz[i];
      const hvx = this.hx[i],  hvy = this.hy[i],  hvz = this.hz[i];
      const dot = kx*hvx + ky*hvy + kz*hvz;
      this.hx[i] = hvx*cosA + (ky*hvz - kz*hvy)*sinA + kx*dot*(1-cosA);
      this.hy[i] = hvy*cosA + (kz*hvx - kx*hvz)*sinA + ky*dot*(1-cosA);
      this.hz[i] = hvz*cosA + (kx*hvy - ky*hvx)*sinA + kz*dot*(1-cosA);

      // ── Stretch: shrink stick proportional to remaining speed ─────────────
      const curSpeed  = Math.sqrt(this.vx[i]*this.vx[i] + this.vy[i]*this.vy[i] + this.vz[i]*this.vz[i]);
      const speedFrac = Math.min(1.0, curSpeed / (this.initSpeed[i] + 0.001));
      const scale     = 0.2 + speedFrac * 0.8; // 0.2 (nub at rest) → 1.0 (full at launch)
      const shx = this.hx[i] * scale;
      const shy = this.hy[i] * scale;
      const shz = this.hz[i] * scale;

      // ── Hot-flash colour & fade ──────────────────────────────────────────
      const f     = this.life[i] / this.maxLife[i]; // 1=born, 0=dead
      const alpha = Math.pow(f, 2.5) * 2.5;         // bright bloom spike → steep falloff
      // First 20% of lifetime: blend toward white-hot
      const hot = Math.max(0, (f - 0.8) * 5.0);     // 1.0 at birth → 0.0 at 20% elapsed
      const r = (this.cr[i] + hot * (1.0 - this.cr[i])) * alpha;
      const g = (this.cg[i] + hot * (1.0 - this.cg[i])) * alpha;
      const b = (this.cb[i] + hot * (1.0 - this.cb[i])) * alpha;

      // ── Write vertices ──────────────────────────────────────────────────
      this.posArr[base]   = this.cx[i] - shx;
      this.posArr[base+1] = this.cy[i] - shy;
      this.posArr[base+2] = this.cz[i] - shz;
      this.posArr[base+3] = this.cx[i] + shx;
      this.posArr[base+4] = this.cy[i] + shy;
      this.posArr[base+5] = this.cz[i] + shz;

      this.colArr[base]   = r; this.colArr[base+1] = g; this.colArr[base+2] = b;
      this.colArr[base+3] = r; this.colArr[base+4] = g; this.colArr[base+5] = b;
    }

    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
  }
}

const SEGS_PER_KILL = 18;
export { SEGS_PER_KILL };
