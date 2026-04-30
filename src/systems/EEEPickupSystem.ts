// ─── EEEPickupSystem ──────────────────────────────────────────────────────────
// Manages the three EEE pickup types that drift around the arena.
//   score   – dropped by green enemies  → +200 pts
//   quicken – dropped by cyan enemies   → +1 quicken (speeds up game)
//   time    – dropped by orange/special → +15 seconds

import * as THREE from 'three';
import { ARENA, EEE } from '../config';

export type PickupType = 'score' | 'quicken' | 'time';

interface EEEPickup {
  type:      PickupType;
  x:         number;
  y:         number;
  vx:        number;
  vy:        number;
  lifetime:  number;
  mesh:      THREE.Mesh;    // spinning octahedron
  halo:      THREE.Line;    // glow ring
  warpMult:  number;        // 1.0 normally; 0.01–0.03 during death warp
}

const TYPE_COLORS: Record<PickupType, THREE.Color> = {
  score:   new THREE.Color(0.15, 1.00, 0.35),  // green
  quicken: new THREE.Color(0.20, 0.70, 1.00),  // blue
  time:    new THREE.Color(1.00, 0.58, 0.10),  // orange
};

function makePickupHalo(col: THREE.Color): THREE.Line {
  const segments = 24;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * 8, Math.sin(a) * 8, 0));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({
    color:       col,
    transparent: true,
    opacity:     0.6,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    toneMapped:  false,
  });
  return new THREE.Line(geo, mat);
}

export class EEEPickupSystem {
  private _scene:   THREE.Scene;
  private _pickups: EEEPickup[] = [];

  onCollect?: (type: PickupType, x: number, y: number) => void;

  constructor(scene: THREE.Scene) {
    this._scene = scene;
  }

  drop(type: PickupType, x: number, y: number): void {
    const col = TYPE_COLORS[type].clone().multiplyScalar(0.5);

    const geo = new THREE.OctahedronGeometry(5);
    const mat = new THREE.MeshBasicMaterial({
      color:       col,
      wireframe:   true,
      transparent: true,
      opacity:     0.95,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
      toneMapped:  false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, ARENA.GAME_Z + 5);
    this._scene.add(mesh);

    const halo = makePickupHalo(col);
    halo.position.set(x, y, ARENA.GAME_Z + 5);
    this._scene.add(halo);

    const angle = Math.random() * Math.PI * 2;
    const speed = 10 + Math.random() * 14;

    this._pickups.push({
      type, x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      lifetime: EEE.PICKUP_LIFETIME,
      mesh, halo,
      warpMult: 1,
    });
  }

  update(dt: number, playerX: number, playerY: number): void {
    const t = performance.now() / 1000;

    for (let i = this._pickups.length - 1; i >= 0; i--) {
      const p = this._pickups[i];
      p.lifetime -= dt;

      // Drift (warpMult = 1 normally; 0.01–0.03 during death sequence)
      p.x += p.vx * p.warpMult * dt;
      p.y += p.vy * p.warpMult * dt;

      // Bounce off arena walls
      if (Math.abs(p.x) > ARENA.HALF_W) { p.vx *= -0.75; p.x = Math.sign(p.x) * ARENA.HALF_W; }
      if (Math.abs(p.y) > ARENA.HALF_H) { p.vy *= -0.75; p.y = Math.sign(p.y) * ARENA.HALF_H; }

      // Drag
      const drag = Math.pow(0.975, dt * 60);
      p.vx *= drag;
      p.vy *= drag;

      // Fade out in final 3 seconds
      const fade = Math.min(1, p.lifetime / 3);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity  = 0.95 * fade;
      (p.halo.material as THREE.LineBasicMaterial).opacity  = 0.60 * fade;

      // Spin and bob
      const bob = Math.sin(t * 2.8 + i * 1.3) * 1.8;
      p.mesh.rotation.y = t * 2.2;
      p.mesh.rotation.x = t * 1.6;
      p.halo.rotation.z = t * 0.9;
      p.mesh.position.set(p.x, p.y + bob, ARENA.GAME_Z + 5);
      p.halo.position.set(p.x, p.y + bob, ARENA.GAME_Z + 5);

      // Player collection
      const dx = playerX - p.x;
      const dy = playerY - p.y;
      if (dx * dx + dy * dy < EEE.PICKUP_RADIUS * EEE.PICKUP_RADIUS) {
        // Remove first so onCollect callbacks that call clearAll() don't double-free
        const { type, x, y } = p;
        this._remove(i);
        this.onCollect?.(type, x, y);
        continue;
      }

      // Despawn
      if (p.lifetime <= 0) this._remove(i);
    }
  }

  startDeathWarp(): void {
    for (const p of this._pickups) {
      p.warpMult = 0.01 + Math.random() * 0.02; // 1–3% of normal XY speed
    }
  }

  /** Drift-only update during dying phase — no collection, no despawn. */
  updateDying(dt: number): void {
    const t = performance.now() / 1000;
    for (let i = 0; i < this._pickups.length; i++) {
      const p = this._pickups[i];
      p.x += p.vx * p.warpMult * dt;
      p.y += p.vy * p.warpMult * dt;
      const bob = Math.sin(t * 2.8 + i * 1.3) * 1.8;
      p.mesh.rotation.y = t * 2.2;
      p.mesh.rotation.x = t * 1.6;
      p.halo.rotation.z = t * 0.9;
      p.mesh.position.set(p.x, p.y + bob, ARENA.GAME_Z + 5);
      p.halo.position.set(p.x, p.y + bob, ARENA.GAME_Z + 5);
    }
  }

  clearAll(): void {
    for (let i = this._pickups.length - 1; i >= 0; i--) this._remove(i);
  }

  private _remove(i: number): void {
    const p = this._pickups[i];
    this._scene.remove(p.mesh);
    this._scene.remove(p.halo);
    p.mesh.geometry.dispose();
    (p.mesh.material as THREE.MeshBasicMaterial).dispose();
    p.halo.geometry.dispose();
    (p.halo.material as THREE.LineBasicMaterial).dispose();
    this._pickups.splice(i, 1);
  }
}
