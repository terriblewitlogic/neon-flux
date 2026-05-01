import * as THREE from 'three';
import { MINTER } from '../config';
import { ParticleSystem } from './ParticleSystem';

// ─── VisualIntensityState ──────────────────────────────────────────────────────
// Tracks Minter's intensity multiplier and drives bloom/color-cycling.
// All values are plain numbers — no React state, no events.

export interface IntensityState {
  multiplier: number;       // 1–9 (kill-chain multiplier)
  bloomScale: number;       // 1.0–3.0 (applied to UnrealBloomPass strength)
  cycleSpeed: number;       // hue rotation speed (radians/sec)
  particleDensity: number;  // particle spawn count multiplier
  trailScale: number;       // trail length multiplier
}

export class VisualEffects {
  private _multiplier    = 1;
  private _chainTimer    = 0;   // time since last kill
  private _decayTimer    = 0;   // time since multiplier fell — for decay step timing

  // Per-object hue offsets (ships, lasers)
  private _playerHue     = 0.48; // cyan-ish
  private _baseTime      = 0;

  readonly state: IntensityState = {
    multiplier: 1,
    bloomScale: 1.0,
    cycleSpeed: 0.06,
    particleDensity: 1,
    trailScale: 1,
  };

  // Background shader plane
  private bgMesh: THREE.Mesh | null = null;
  private bgUniforms: { uTime: THREE.IUniform; uIntensity: THREE.IUniform } | null = null;

  constructor(scene: THREE.Scene) {
    this._buildBackground(scene);
  }

  private _buildBackground(scene: THREE.Scene): void {
    // Full-screen plane behind the scene (renderOrder -1)
    const geo = new THREE.PlaneGeometry(2, 2);
    const uniforms = {
      uTime:      { value: 0.0 },
      uIntensity: { value: 0.0 },
    };
    this.bgUniforms = uniforms;

    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 1.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform float uTime;
        uniform float uIntensity;
        varying vec2 vUv;

        vec3 hsb2rgb(vec3 c) {
          vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0);
          rgb = rgb*rgb*(3.0-2.0*rgb);
          return c.z * mix(vec3(1.0), rgb, c.y);
        }

        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float r = length(p);
          float angle = atan(p.y, p.x);

          // Concentric pulsing rings (Minter Psychedelia)
          float rings = sin(r * 8.0 - uTime * 2.2) * 0.5 + 0.5;
          // Kaleidoscopic sectors
          float kal = sin(angle * 6.0 + uTime * 0.6 + r * 2.5) * 0.5 + 0.5;

          float pattern = mix(rings * 0.5, kal, uIntensity) * uIntensity * 0.22;
          vec3 col = hsb2rgb(vec3(fract(uTime * 0.08 + r * 0.18), 0.9, pattern));

          gl_FragColor = vec4(col, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    this.bgMesh = new THREE.Mesh(geo, mat);
    this.bgMesh.renderOrder = -1;
    scene.add(this.bgMesh);
  }

  /** Call when player scores a kill */
  onKill(): void {
    if (this._chainTimer < MINTER.KILL_CHAIN_WINDOW && this._multiplier < MINTER.MAX_MULTIPLIER) {
      this._multiplier++;
    } else if (this._chainTimer >= MINTER.KILL_CHAIN_WINDOW) {
      this._multiplier = Math.min(2, this._multiplier);
    }
    this._chainTimer = 0;
    this._decayTimer = 0;
    this._syncState();
  }

  /** Call when player dies — reset to base */
  onDeath(): void {
    this._multiplier = 1;
    this._chainTimer = 0;
    this._syncState();
  }

  private _syncState(): void {
    const t = (this._multiplier - 1) / (MINTER.MAX_MULTIPLIER - 1); // 0–1
    this.state.multiplier      = this._multiplier;
    this.state.bloomScale      = MINTER.INTENSITY_MIN + t * (MINTER.INTENSITY_MAX - MINTER.INTENSITY_MIN);
    this.state.cycleSpeed      = 0.06 + t * 0.44;
    this.state.particleDensity = 1 + Math.round(t * 7);
    this.state.trailScale      = 1 + t * 2;
  }

  update(dt: number): void {
    this._baseTime    += dt;
    this._chainTimer  += dt;
    this._decayTimer  += dt;

    // Decay multiplier after window
    if (this._multiplier > 1 && this._chainTimer > MINTER.KILL_CHAIN_DECAY) {
      // Step down once per second
      if (this._decayTimer > 1.0) {
        this._multiplier = Math.max(1, this._multiplier - 1);
        this._decayTimer = 0;
        this._syncState();
      }
    }

    // Player hue cycles slowly — enemies stay fixed warm colors (set per-type in EnemyManager)
    this._playerHue = (this._playerHue + this.state.cycleSpeed * dt * 0.25) % 1;

    // Background pulse — lerp target capped at 0.65 so gameplay stays readable
    if (this.bgUniforms) {
      this.bgUniforms.uTime.value      = this._baseTime;
      const bgTarget = Math.min((this._multiplier - 1) / (MINTER.MAX_MULTIPLIER - 1), 0.28);
      this.bgUniforms.uIntensity.value = THREE.MathUtils.lerp(
        this.bgUniforms.uIntensity.value,
        bgTarget,
        dt * 2.0,
      );
    }
  }

  /** Current player ship color — always white */
  getPlayerColor(): THREE.Color {
    return new THREE.Color(1, 1, 1);
  }

  /** Enemy color — fixed warm hue per type, never cycles */
  getEnemyColor(typeOffset = 0): THREE.Color {
    return new THREE.Color().setHSL(typeOffset, 1.0, 0.58);
  }

  /** Laser color for player */
  getPlayerLaserColor(): THREE.Color {
    return new THREE.Color().setHSL(this._playerHue, 1.0, 0.7);
  }

  /** Laser color for enemies */
  getEnemyLaserColor(): THREE.Color {
    return new THREE.Color(1.0, 0.25, 0.05);
  }

  /** Transient beat-accent flash — call once per frame with MusicEngine.beatAccent */
  pulseBeat(accent: number): void {
    if (this.bgUniforms) {
      this.bgUniforms.uIntensity.value = Math.min(
        this.bgUniforms.uIntensity.value + accent * 0.08,
        0.42,
      );
    }
  }

  get multiplier(): number { return this._multiplier; }

  spawnMinterParticles(
    playerPos:  THREE.Vector3,
    mult:       number,
    beatAccent: number,
    dt:         number,
    particles:  ParticleSystem,
  ): void {
    const t = (mult - 1) / 8;   // 0–1
    if (t < 0.12) return;

    // ── 1. Tunnel-wall sparks: appear at ring perimeter, drift inward ──────
    const wallRate = t * t * 14 + beatAccent * 7;
    if (Math.random() < wallRate * dt) {
      const angle    = Math.random() * Math.PI * 2;
      const r        = 170 + Math.random() * 110;
      const spawnPos = new THREE.Vector3(
        playerPos.x + Math.cos(angle) * r,
        playerPos.y + Math.sin(angle) * r,
        playerPos.z - Math.random() * 500,
      );
      // Drift inward toward tunnel centre
      const inward = new THREE.Vector3(-Math.cos(angle), -Math.sin(angle), 0)
        .multiplyScalar(0.25 + t * 0.3);
      const hue   = ((this._baseTime * 0.25 + angle / (Math.PI * 2)) % 1 + 1) % 1;
      const color = new THREE.Color().setHSL(hue, 1, 0.65 + t * 0.25);
      particles.spark(spawnPos, inward, color, 0.5 + t * 1.5);
    }

    // ── 2. Spiral wake trail behind the player ────────────────────────────
    if (t > 0.3) {
      const wakeRate = (t - 0.3) / 0.7 * 11 + beatAccent * 5;
      if (Math.random() < wakeRate * dt) {
        const spiralAngle = this._baseTime * 5 + Math.random() * 0.5;
        const sr          = 12 + Math.random() * 28;
        const wakePos     = new THREE.Vector3(
          playerPos.x + Math.cos(spiralAngle) * sr,
          playerPos.y + Math.sin(spiralAngle) * sr * 0.6,
          playerPos.z + 15 + Math.random() * 100,  // behind player
        );
        // Drift backward (increasing Z) — trails away into the tunnel
        const drift = new THREE.Vector3(
          Math.cos(spiralAngle) * 0.1,
          Math.sin(spiralAngle) * 0.1,
          0.4 + t * 0.5,
        );
        const wakeHue   = ((this._baseTime * 0.6 + spiralAngle * 0.15) % 1 + 1) % 1;
        const wakeColor = new THREE.Color().setHSL(wakeHue, 1, 0.72);
        particles.spark(wakePos, drift, wakeColor, 0.4 + t * 1.2);
      }
    }

    // ── 3. Beat-pulse burst: scatters from player on every strong beat ────
    if (beatAccent > 0.55 && t > 0.65 && Math.random() < 0.25) {
      const burstAngle = Math.random() * Math.PI * 2;
      const burstPos   = new THREE.Vector3(
        playerPos.x + Math.cos(burstAngle) * 20,
        playerPos.y + Math.sin(burstAngle) * 20,
        playerPos.z - Math.random() * 80,
      );
      const burstDir = new THREE.Vector3(
        Math.cos(burstAngle) * (0.3 + t * 0.5),
        Math.sin(burstAngle) * (0.3 + t * 0.5),
        -(0.1 + Math.random() * 0.3),
      );
      const burstHue   = ((this._baseTime * 0.4 + Math.random()) % 1 + 1) % 1;
      const burstColor = new THREE.Color().setHSL(burstHue, 1, 0.8);
      particles.spark(burstPos, burstDir, burstColor, 1.0 + t * 2);
    }
  }
}
