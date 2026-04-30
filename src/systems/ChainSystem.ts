// ─── ChainSystem ──────────────────────────────────────────────────────────────
// Handles player detonation and cascading chain explosions.
//
// Usage pattern (from Game.ts):
//   1. Call detonate(x, y, charged) when the player explodes.
//   2. Call addChainExplosion(x, y, handlerId) for each enemy hit.
//   3. Call update(dt, enemies) every frame.
//   4. Listen to onEnemyHit and onChainComplete callbacks.
//
// The chain system does NOT directly kill enemies — it reports hits via callback,
// and the caller (Game.ts) is responsible for actually killing the enemy and
// calling addChainExplosion at the enemy's position.

import * as THREE from 'three';
import { EEE, ARENA } from '../config';

export interface ChainEnemy {
  id:    number;
  x:     number;
  y:     number;
  alive: boolean;
}

interface ActiveExplosion {
  handlerId:   number;
  x:           number;
  y:           number;
  radius:      number;
  maxRadius:   number;
  rings:       THREE.Line[];
  hitIds:      Set<number>;
  echosFired:  boolean;     // true once circumference pulses have been spawned
}

interface EchoRing {
  line: THREE.Line;
  life: number;  // 0 → 1 over its lifetime
  sr:   number;  // start scale (scene units)
}

interface ChainHandler {
  id:          number;
  chainCount:  number;
  settleTimer: number;
  complete:    boolean;
}

// Create a circle outline geometry (LineLoop)
function makeCircleLine(segments = 40): THREE.Line {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({
    color:      0xffffff,
    transparent: true,
    opacity:     1.0,
    blending:   THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  return new THREE.Line(geo, mat);
}

export class ChainSystem {
  private _scene:      THREE.Scene;
  private _explosions: ActiveExplosion[] = [];
  private _handlers:   ChainHandler[] = [];
  private _echoRings:  EchoRing[] = [];
  private _nextId = 0;

  /** Fired for each enemy inside an expanding explosion ring.
   *  The caller should: kill the enemy and call addChainExplosion() at its position. */
  onEnemyHit?: (enemyId: number, handlerId: number) => void;

  /** Fired once per chain when all explosions settle.
   *  chainCount = total enemies killed; 0 means detonation hit nothing. */
  onChainComplete?: (chainCount: number) => void;

  constructor(scene: THREE.Scene) {
    this._scene = scene;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Player presses detonate. chargeProgress 0–1 sets blast radius.
   *  Uses a convex power curve so the radius ramps sharply with hold time,
   *  rewarding patience the way the original EEE does. */
  detonate(x: number, y: number, chargeProgress: number): void {
    const id = this._nextId++;
    this._handlers.push({
      id,
      chainCount:  0,
      settleTimer: EEE.CHAIN_SETTLE,
      complete:    false,
    });
    // Steep convex ramp: small blast until ~60% charge, then explodes in size
    const t         = Math.pow(Math.max(0, Math.min(1, chargeProgress)), 2.5);
    const maxRadius = EEE.NORMAL_RADIUS + (EEE.CHARGED_RADIUS - EEE.NORMAL_RADIUS) * t;
    this._addExplosion(id, x, y, maxRadius);
  }

  /** Spawn a chain explosion at a killed enemy's position. */
  addChainExplosion(x: number, y: number, handlerId: number): void {
    this._addExplosion(handlerId, x, y, EEE.CHAIN_RADIUS);
  }

  update(dt: number, enemies: ChainEnemy[]): void {
    // ── Expand explosions ─────────────────────────────────────────────────
    for (let i = this._explosions.length - 1; i >= 0; i--) {
      const exp = this._explosions[i];
      exp.radius += EEE.EXPAND_SPEED * dt;

      const progress = Math.min(1, exp.radius / exp.maxRadius);

      // Update ring visuals
      for (let r = 0; r < exp.rings.length; r++) {
        const ring   = exp.rings[r];
        const offset = r * 0.08;  // rings slightly staggered
        const p2     = Math.min(1, Math.max(0, progress - offset));
        const scale  = exp.radius * (1 + r * 0.06);
        ring.scale.set(scale, scale, 1);

        const mat = ring.material as THREE.LineBasicMaterial;
        // Colour: white → yellow → orange
        const hue = 0.12 - p2 * 0.10;
        mat.color.setHSL(hue, 1.0, 0.9 - p2 * 0.2);
        mat.opacity = Math.max(0, (1 - p2) * 0.9);
      }

      // ── Hit test against alive enemies ─────────────────────────────────
      for (const e of enemies) {
        if (!e.alive || exp.hitIds.has(e.id)) continue;
        const dx = e.x - exp.x;
        const dy = e.y - exp.y;
        if (Math.sqrt(dx * dx + dy * dy) <= exp.radius + 5) {
          exp.hitIds.add(e.id);
          const h = this._handlers.find(h => h.id === exp.handlerId);
          if (h) {
            h.chainCount++;
            h.settleTimer = EEE.CHAIN_SETTLE;  // reset the settle window
          }
          this.onEnemyHit?.(e.id, exp.handlerId);
        }
      }

      // ── Spawn circumference echo rings at ~90% expansion ──────────────
      if (!exp.echosFired && exp.radius >= exp.maxRadius * 0.88) {
        exp.echosFired = true;
        this._spawnEchoRings(exp.x, exp.y, exp.maxRadius);
      }

      // ── Remove explosion when max radius reached ───────────────────────
      if (exp.radius >= exp.maxRadius) {
        for (const ring of exp.rings) {
          this._scene.remove(ring);
          ring.geometry.dispose();
          (ring.material as THREE.LineBasicMaterial).dispose();
        }
        this._explosions.splice(i, 1);
      }
    }

    // ── Animate echo rings ────────────────────────────────────────────────
    for (let i = this._echoRings.length - 1; i >= 0; i--) {
      const er = this._echoRings[i];
      er.life += dt / 0.45;  // 0.45 s lifetime
      if (er.life >= 1) {
        this._scene.remove(er.line);
        er.line.geometry.dispose();
        (er.line.material as THREE.LineBasicMaterial).dispose();
        this._echoRings.splice(i, 1);
        continue;
      }
      const r   = er.sr + er.life * 18;
      const mat = er.line.material as THREE.LineBasicMaterial;
      er.line.scale.set(r, r, 1);
      // Colour: white → yellow → fade
      const hue = 0.14 - er.life * 0.10;
      mat.color.setHSL(hue, 1.0, 0.9);
      mat.opacity = Math.pow(1 - er.life, 1.5) * 0.95;
    }

    // ── Settle handlers ───────────────────────────────────────────────────
    for (let i = this._handlers.length - 1; i >= 0; i--) {
      const h = this._handlers[i];
      if (h.complete) { this._handlers.splice(i, 1); continue; }

      const hasActive = this._explosions.some(e => e.handlerId === h.id);
      if (hasActive) {
        h.settleTimer = EEE.CHAIN_SETTLE;  // keep alive while explosions run
      } else {
        h.settleTimer -= dt;
        if (h.settleTimer <= 0) {
          h.complete = true;
          this.onChainComplete?.(h.chainCount);
        }
      }
    }
  }

  clearAll(): void {
    for (const exp of this._explosions) {
      for (const ring of exp.rings) {
        this._scene.remove(ring);
        ring.geometry.dispose();
        (ring.material as THREE.LineBasicMaterial).dispose();
      }
    }
    for (const er of this._echoRings) {
      this._scene.remove(er.line);
      er.line.geometry.dispose();
      (er.line.material as THREE.LineBasicMaterial).dispose();
    }
    this._explosions = [];
    this._handlers   = [];
    this._echoRings  = [];
  }

  get hasActive(): boolean { return this._explosions.length > 0; }

  /** True from detonation until onChainComplete fires — includes the settle window.
   *  Use this to prevent game-over triggering before an extend can be awarded. */
  get hasPendingChain(): boolean { return this._handlers.length > 0; }

  // ── Private ────────────────────────────────────────────────────────────────

  private _addExplosion(handlerId: number, x: number, y: number, maxRadius: number): void {
    const ringCount = 3;
    const rings: THREE.Line[] = [];
    for (let r = 0; r < ringCount; r++) {
      const line = makeCircleLine(44 - r * 4);
      line.position.set(x, y, ARENA.GAME_Z + 1 + r * 0.3);
      this._scene.add(line);
      rings.push(line);
    }

    this._explosions.push({
      handlerId,
      x, y,
      radius:     1,
      maxRadius,
      rings,
      hitIds:     new Set(),
      echosFired: false,
    });
  }

  /** Spawn 8 small rings equally spaced around the explosion circumference */
  private _spawnEchoRings(cx: number, cy: number, maxRadius: number): void {
    const N = 8;
    for (let d = 0; d < N; d++) {
      const a  = (d / N) * Math.PI * 2;
      const ex = cx + Math.cos(a) * maxRadius;
      const ey = cy + Math.sin(a) * maxRadius;
      const line = makeCircleLine(10);
      line.position.set(ex, ey, ARENA.GAME_Z + 2);
      line.scale.set(1, 1, 1);
      this._scene.add(line);
      this._echoRings.push({ line, life: 0, sr: 1 });
    }
  }
}
