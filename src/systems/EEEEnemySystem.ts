// ─── EEEEnemySystem ───────────────────────────────────────────────────────────
// Spawns and drives enemies in the Every Extend Extra arena.
//
// Enemies spawn at the edge of the arena (radius SPAWN_R) in formation patterns
// and drift toward the centre at constant speed + quicken bonus.
// Types 0-3 have different wireframe colours and pickup drops.
// Type "special" (thargoid) grows in scale and fires bullets at the player.

import * as THREE from 'three';
import { WireframeRenderer } from './WireframeRenderer';
import { getModel } from '../data/ShipModels';
import { ARENA, EEE } from '../config';
import type { ChainEnemy } from './ChainSystem';

export type EEEDropType = 'score' | 'quicken' | 'time' | null;

export interface EEEEnemy extends ChainEnemy {
  angle:     number;
  speed:     number;
  dropType:  EEEDropType;
  special:   boolean;
  type:      0 | 1 | 2 | 3;
  scale:     number;
  maxScale:  number;
  group:     THREE.Object3D;   // renderer.group — only rotation.z (spin)
  renderer:  WireframeRenderer;
  color:     THREE.Color;
  hasNeared: boolean;
  shootTimer: number;
  shootCooldown: number;
  ez:        number;   // Z offset from game plane (death-warp tunnel effect)
  evz:       number;   // Z velocity (death-warp)
  warpZAccel: number;  // per-enemy Z acceleration rate (death-warp)
  warpXYMult: number;  // per-enemy random XY speed mult during warp (0.01–0.03)
}

// One unique model per enemy type — no duplicates
const TYPE_SHIPS  = ['sidewinder', 'viper', 'krait', 'gecko'] as const;
// Each type gets its own scale (affects perceived size) and spin speed
const TYPE_SCALES = [0.42, 0.62, 0.56, 0.68] as const;  // magenta small, orange largest
const TYPE_SPINS  = [1.5,  0.75, 1.2,  1.0 ] as const;  // magenta fast, green slow/menacing

export interface EEEBullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  mesh: THREE.Mesh;
}

// ─── Colours per type ─────────────────────────────────────────────────────────
const TYPE_COLORS = [
  new THREE.Color(1.00, 0.18, 0.60),  // 0: magenta (basic)  lum≈0.47 — no bloom
  new THREE.Color(0.15, 0.68, 0.32),  // 1: green   (score)  lum≈0.48 — no bloom
  new THREE.Color(0.20, 0.55, 0.90),  // 2: cyan    (quicken) lum≈0.49 — no bloom
  new THREE.Color(1.00, 0.28, 0.08),  // 3: orange  (time)   lum≈0.47 — no bloom
] as const;


// ─── Formation definitions ────────────────────────────────────────────────────
// Each formation is an array of { da (angle offset), t (type) }
// da values use ~0.11 rad spacing so enemies are ~26 units apart at spawn radius 235
// (each 0.11 rad = 235 * 0.11 ≈ 26 units chord), keeping ships visually separate.
const FORMATIONS: Array<Array<{ da: number; t: 0|1|2|3 }>> = [
  // 0: 1 green + 4 whites
  [{ da:0, t:1 }, { da:0.12, t:0 }, { da:0.24, t:0 }, { da:-0.12, t:0 }, { da:-0.24, t:0 }],
  // 1: 1 green + 6 whites
  [{ da:0, t:1 }, { da:0.12, t:0 }, { da:0.24, t:0 }, { da:0.36, t:0 }, { da:-0.12, t:0 }, { da:-0.24, t:0 }, { da:-0.36, t:0 }],
  // 2: 7 whites
  [{ da:0, t:0 }, { da:0.12, t:0 }, { da:0.24, t:0 }, { da:0.36, t:0 }, { da:-0.12, t:0 }, { da:-0.24, t:0 }, { da:-0.36, t:0 }],
  // 3: 7 greens
  [{ da:0, t:1 }, { da:0.12, t:1 }, { da:0.24, t:1 }, { da:0.36, t:1 }, { da:-0.12, t:1 }, { da:-0.24, t:1 }, { da:-0.36, t:1 }],
  // 4: 1 cyan + 4 whites
  [{ da:0, t:2 }, { da:0.12, t:0 }, { da:0.24, t:0 }, { da:-0.12, t:0 }, { da:-0.24, t:0 }],
  // 5: 1 cyan + 2 oranges + 2 whites
  [{ da:0, t:2 }, { da:0.12, t:3 }, { da:-0.12, t:3 }, { da:0.24, t:0 }, { da:-0.24, t:0 }],
  // 6: 1 orange + 4 whites
  [{ da:0, t:3 }, { da:0.12, t:0 }, { da:0.24, t:0 }, { da:-0.12, t:0 }, { da:-0.24, t:0 }],
  // 7: 1 orange + 6 whites
  [{ da:0, t:3 }, { da:0.12, t:0 }, { da:0.24, t:0 }, { da:0.36, t:0 }, { da:-0.12, t:0 }, { da:-0.24, t:0 }, { da:-0.36, t:0 }],
];

// Approximate visual radius for collision separations
const ENEMY_RADIUS = 13;

// Pool size: 4 special enemies × 4 bullets per shot + headroom
const BULLET_POOL_SIZE = 32;

export class EEEEnemySystem {
  private _scene:       THREE.Scene;
  private _bulletScene: THREE.Scene; // rendered after bloom — bullets always on top
  private _enemies:    EEEEnemy[] = [];
  private _bullets:    EEEBullet[] = [];
  private _spawnTimer  = 0;
  private _quicken     = 0;
  private _nextId      = 0;
  private _warpMode    = false;

  // Shared geometry + material — created once, reused by all bullet meshes
  private _bulletGeo = new THREE.CircleGeometry(2, 8);
  private _bulletMat = new THREE.MeshBasicMaterial({
    color:      new THREE.Color(1.0, 0.2, 0.6),
    blending:   THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  // Pre-allocated pool of dormant meshes
  private _bulletPool: THREE.Mesh[] = [];

  onBulletHitPlayer?: () => void;

  /** Fired when a non-invincible player body-touches an enemy.
   *  pushDx/pushDy is the unit vector pointing from enemy → player. */
  onPlayerEnemyCollision?: (x: number, y: number, pushDx: number, pushDy: number, color: THREE.Color) => void;

  constructor(scene: THREE.Scene, bulletScene: THREE.Scene) {
    this._scene       = scene;
    this._bulletScene = bulletScene;
    // Pre-warm pool so first shots never allocate
    for (let i = 0; i < BULLET_POOL_SIZE; i++) {
      this._bulletPool.push(new THREE.Mesh(this._bulletGeo, this._bulletMat));
    }
  }

  private _acquireBullet(): THREE.Mesh {
    return this._bulletPool.pop() ?? new THREE.Mesh(this._bulletGeo, this._bulletMat);
  }

  // ── Public helpers ─────────────────────────────────────────────────────────

  setQuicken(q: number): void { this._quicken = q; }

  /** Tutorial: place a single enemy at a fixed world position.
   *  Pass a low speed (e.g. 1) so tutorial enemies barely drift. */
  spawnAt(x: number, y: number, type: 0|1|2|3, speed: number = EEE.ENEMY_SPEED): void {
    this._addEnemy(x, y, type);
    this._enemies[this._enemies.length - 1].speed = speed;
  }

  /** Returns alive enemy refs for the chain system. */
  getAliveRefs(): ChainEnemy[] {
    const out: ChainEnemy[] = [];
    for (const e of this._enemies) {
      if (e.alive) out.push({ id: e.id, x: e.x, y: e.y, alive: true });
    }
    return out;
  }

  /** Kill enemy by id; returns the enemy object or null if already dead. */
  killEnemy(id: number): EEEEnemy | null {
    const e = this._enemies.find(e => e.id === id && e.alive);
    if (!e) return null;
    e.alive = false;
    this._removeMesh(e);
    return e;
  }

  getAliveCount(): number {
    return this._enemies.filter(e => e.alive).length;
  }

  /** Returns the average world position of all alive enemies, or null if none. */
  getAliveCentroid(): { x: number; y: number; ez: number } | null {
    const alive = this._enemies.filter(e => e.alive);
    if (alive.length === 0) return null;
    let sx = 0, sy = 0, sez = 0;
    for (const e of alive) { sx += e.x; sy += e.y; sez += e.ez; }
    return { x: sx / alive.length, y: sy / alive.length, ez: sez / alive.length };
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  update(dt: number, playerX: number, playerY: number, playerInvincible: boolean, beatAccent = 0): boolean {
    const speedBoost = 1 + (this._quicken / EEE.MAX_QUICKEN) * 1.12; // max-speed reduced 30% vs old 1.6
    let playerHit = false;

    // ── Enemies ───────────────────────────────────────────────────────────
    for (let i = this._enemies.length - 1; i >= 0; i--) {
      const e = this._enemies[i];
      if (!e.alive) { this._enemies.splice(i, 1); continue; }

      // Move toward centre
      const spd = e.speed * speedBoost;
      e.x += Math.cos(e.angle) * spd * dt;
      e.y += Math.sin(e.angle) * spd * dt;

      // Track proximity to centre for pass-through despawn
      const distSq = e.x * e.x + e.y * e.y;
      if (distSq < 60 * 60) e.hasNeared = true;

      // Despawn once it's travelled through and gone far away
      if (e.hasNeared && distSq > ARENA.SPAWN_R * ARENA.SPAWN_R * 1.1) {
        this._removeMesh(e);
        e.alive = false;
        continue;
      }

      // Special enemy: grow in scale, then shoot
      if (e.special) {
        if (e.scale < e.maxScale) {
          e.scale = Math.min(e.maxScale, e.scale + dt * 0.3);
        }
        if (e.scale >= e.maxScale) {
          e.shootTimer -= dt;
          if (e.shootTimer <= 0) {
            e.shootTimer = e.shootCooldown;
            this._shootAt(e, playerX, playerY);
          }
        }
      }

      // Position / spin on Y axis
      e.group.position.set(e.x, e.y, ARENA.GAME_Z + 2);
      e.group.rotation.y += dt * (e.special ? 0.5 : TYPE_SPINS[e.type]);

      // Beat pulse — all enemies swell noticeably on every beat
      const baseScale = e.special ? e.scale : TYPE_SCALES[e.type];
      e.group.scale.setScalar(baseScale * (1 + beatAccent * 0.55));

      // Player collision (only basic enemies, not special)
      if (!playerInvincible && !e.special) {
        const dx   = playerX - e.x;
        const dy   = playerY - e.y;
        const dSq  = dx * dx + dy * dy;
        const rSum = 12 + ENEMY_RADIUS * 0.6;  // player hitbox + enemy contact radius
        if (dSq < rSum * rSum) {
          playerHit = true;
          if (dSq > 0.001) {
            const dist = Math.sqrt(dSq);
            const cx   = (e.x + playerX) * 0.5;
            const cy   = (e.y + playerY) * 0.5;
            this.onPlayerEnemyCollision?.(cx, cy, dx / dist, dy / dist, e.color);
          }
        }
      }
    }

    // ── Bullets ───────────────────────────────────────────────────────────
    for (let i = this._bullets.length - 1; i >= 0; i--) {
      const b = this._bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.mesh.position.set(b.x, b.y, ARENA.GAME_Z + 3);

      if (!playerInvincible) {
        const dx = b.x - playerX;
        const dy = b.y - playerY;
        if (dx * dx + dy * dy < 8 * 8) {
          this._removeBullet(i);
          this.onBulletHitPlayer?.();
          continue;
        }
      }

      // Despawn off-arena
      if (Math.abs(b.x) > ARENA.HALF_W * 1.6 || Math.abs(b.y) > ARENA.HALF_H * 1.6) {
        this._removeBullet(i);
      }
    }

    // ── Spawn formations ──────────────────────────────────────────────────
    this._spawnTimer += dt;
    const cooldown = Math.max(0.8, EEE.SPAWN_COOLDOWN - this._quicken * 0.05);
    if (this._spawnTimer >= cooldown) {
      this._spawnTimer = 0;
      this._spawnFormation();
    }

    return playerHit;
  }

  /** Visual-only update for the game-over linger: moves and spins enemies; no spawning, no collisions.
   *  sdt = slow-mo'd dt (for XY/spin), realDt = wall-clock dt (for Z tunnel drift so it's always visible). */
  updateVisual(sdt: number, realDt: number): void {
    const speedBoost = 1 + (this._quicken / EEE.MAX_QUICKEN) * 1.12;
    for (const e of this._enemies) {
      if (!e.alive) continue;
      e.x += Math.cos(e.angle) * e.speed * speedBoost * sdt * e.warpXYMult;
      e.y += Math.sin(e.angle) * e.speed * speedBoost * sdt * e.warpXYMult;
      if (this._warpMode) {
        e.evz -= e.warpZAccel * realDt; // each ship has its own acceleration rate
        e.ez  += e.evz * realDt;
      }
      e.group.position.set(e.x, e.y, ARENA.GAME_Z + 2 + e.ez);
      e.group.rotation.y += sdt * (e.special ? 0.5 : TYPE_SPINS[e.type]);
    }
    for (const b of this._bullets) {
      b.x += b.vx * sdt;
      b.y += b.vy * sdt;
      b.mesh.position.set(b.x, b.y, ARENA.GAME_Z + 3);
    }
  }

  /** Called on player death — all alive enemies warp into the tunnel. */
  startDeathWarp(): void {
    this._warpMode = true;
    for (const e of this._enemies) {
      if (!e.alive) continue;
      e.evz        = -(3 + Math.random() * 28);   // 3–31 u/s: wide spread from the start
      e.warpZAccel = 5 + Math.random() * 25;      // 5–30 u/s²: each ship accelerates differently
      e.warpXYMult = 0.01 + Math.random() * 0.02; // 1–3% of normal XY speed
    }
  }

  // ── Formation spawning ─────────────────────────────────────────────────────

  private _spawnFormation(): void {
    const formType = Math.floor(Math.random() * 9);  // 0–8
    const anglePos = Math.random() * Math.PI * 2;
    const R = ARENA.SPAWN_R;

    if (formType === 8) {
      // Special enemy — appears near but not at edge centre
      const x = Math.cos(anglePos) * R * 0.55 + (Math.random() - 0.5) * 50;
      const y = Math.sin(anglePos) * R * 0.55 + (Math.random() - 0.5) * 50;
      this._addSpecialEnemy(x, y);
      return;
    }

    const formation = FORMATIONS[formType] ?? FORMATIONS[0];
    for (const slot of formation) {
      const a  = anglePos + slot.da;
      const x  = Math.cos(a) * R + (Math.random() - 0.5) * 22;
      const y  = Math.sin(a) * R + (Math.random() - 0.5) * 22;
      this._addEnemy(x, y, slot.t);
    }
  }

  private _addEnemy(x: number, y: number, type: 0|1|2|3): void {
    const dropTypes: EEEDropType[] = [null, 'score', 'quicken', 'time'];
    const color    = TYPE_COLORS[type].clone();
    const renderer = new WireframeRenderer(getModel(TYPE_SHIPS[type]), color, 0.5);
    renderer.addToScene(this._scene);
    renderer.group.position.set(x, y, ARENA.GAME_Z + 2);
    renderer.group.rotation.y = Math.random() * Math.PI * 2;
    renderer.group.scale.setScalar(TYPE_SCALES[type]);

    this._enemies.push({
      id:        this._nextId++,
      x, y,
      alive:     true,
      angle:     Math.atan2(-y, -x),
      speed:     EEE.ENEMY_SPEED,
      dropType:  dropTypes[type],
      special:   false,
      type,
      scale:     1,
      maxScale:  1,
      group:     renderer.group,
      renderer,
      color,
      hasNeared: false,
      shootTimer:    0,
      shootCooldown: 0,
      ez: 0, evz: 0, warpZAccel: 0, warpXYMult: 1,
    });
  }

  private _addSpecialEnemy(x: number, y: number): void {
    const color    = new THREE.Color(0.88, 0.35, 0.06); // amber/gold, lum≈0.47 — no bloom
    const renderer = new WireframeRenderer(getModel('thargoid'), color, 0.8);
    renderer.addToScene(this._scene);
    renderer.group.position.set(x, y, ARENA.GAME_Z + 2);
    renderer.group.scale.setScalar(0);

    this._enemies.push({
      id:        this._nextId++,
      x, y,
      alive:     true,
      angle:     Math.atan2(-y, -x),
      speed:     EEE.ENEMY_SPEED * 0.35,
      dropType:  'time',
      special:   true,
      type:      3,
      scale:     0,
      maxScale:  0.55,
      group:     renderer.group,
      renderer,
      color,
      hasNeared: false,
      shootTimer:    1.8,
      shootCooldown: 2.0 + Math.random(),
      ez: 0, evz: 0, warpZAccel: 0, warpXYMult: 1,
    });
  }

  // ── Bullet spawning ────────────────────────────────────────────────────────

  private _shootAt(e: EEEEnemy, px: number, py: number): void {
    const toPlayer = Math.atan2(py - e.y, px - e.x);
    const spread = 3;
    for (let i = -spread; i <= spread; i += 2) {
      const angle = toPlayer + i * 0.12;
      const mesh  = this._acquireBullet();
      mesh.position.set(e.x, e.y, ARENA.GAME_Z + 3);
      this._bulletScene.add(mesh);
      this._bullets.push({
        x: e.x, y: e.y,
        vx: Math.cos(angle) * 72,
        vy: Math.sin(angle) * 72,
        mesh,
      });
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  clearBullets(): void {
    for (let i = this._bullets.length - 1; i >= 0; i--) this._removeBullet(i);
  }

  clearAll(): void {
    for (const e of this._enemies) {
      if (e.alive) this._removeMesh(e);
    }
    this._enemies = [];
    this.clearBullets();
    this._spawnTimer = 0;
    this._warpMode   = false;
  }

  private _removeMesh(e: EEEEnemy): void {
    e.renderer.removeFromScene(this._scene);
    e.renderer.group.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
        else (mesh.material as THREE.Material).dispose();
      }
    });
  }

  private _removeBullet(i: number): void {
    const b = this._bullets[i];
    this._bulletScene.remove(b.mesh);
    this._bulletPool.push(b.mesh); // return to pool — no alloc/dispose
    this._bullets.splice(i, 1);
  }
}
