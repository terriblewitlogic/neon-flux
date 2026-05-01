import * as THREE from 'three';
import { EffectComposer }   from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }        from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass }   from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { AfterimagePass }    from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { ShaderPass }        from 'three/examples/jsm/postprocessing/ShaderPass.js';
import {
  getLocalPlayerName,
  getPersonalBest,
  setPersonalBest,
  writeCloudSave,
  uploadScore,
  getLeaderboard,
} from './platform';

// ─── Chromatic Aberration shader ─────────────────────────────────────────────
const ChromaticAberrationShader = {
  uniforms: { tDiffuse: { value: null }, uStrength: { value: 0.002 } },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    varying vec2 vUv;
    void main() {
      vec2 center = vUv - 0.5;
      float dist  = length(center);
      vec2 offset = normalize(center) * uStrength * dist * dist * 4.0;
      float r = texture2D(tDiffuse, vUv + offset * 1.8).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - offset * 1.8).b;
      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
};

import { CAMERA, ARENA, EEE, VISUAL } from './config';

const R_PORTAL_TRIGGER = 13; // world units — player must be this close to enter a portal
import { StarField }          from './systems/StarField';
import { ParticleSystem }     from './systems/ParticleSystem';
import { VisualEffects }      from './systems/VisualEffects';
import { TunnelRenderer }     from './systems/TunnelRenderer';
import { MusicEngine }        from './systems/MusicEngine';
import { DebrisSystem }       from './systems/DebrisSystem';
import { ChainSystem }        from './systems/ChainSystem';
import { EEEEnemySystem }     from './systems/EEEEnemySystem';
import { EEEPickupSystem }    from './systems/EEEPickupSystem';
import type { PickupType }    from './systems/EEEPickupSystem';
import { InputManager }       from './Input';
import { HUD }                from './HUD';
import type { LeaderboardRecord } from './HUD';
import { buildGameOverGroup }  from './GameOverLogo';
import { InteractiveTutorial } from './InteractiveTutorial';

type GamePhase = 'title' | 'playing' | 'dying' | 'gameover' | 'tutorial';

declare global {
  interface Window {
    emrg?: { track: (event: string, props?: Record<string, unknown>) => void };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────


function getExtendMult(timeRemaining: number): number {
  for (const bracket of EEE.BRACKETS) {
    if (timeRemaining >= bracket.minTime) return bracket.extendMult;
  }
  return EEE.BRACKETS[EEE.BRACKETS.length - 1].extendMult;
}

function calcChainScore(chainCount: number, timeRemaining: number): number {
  const em = getExtendMult(timeRemaining);
  return (chainCount * 50 * Math.floor(chainCount / 3))
       + (em * 5 * Math.abs(chainCount - 3));
}

// ─── Game ─────────────────────────────────────────────────────────────────────

export class Game {
  // Three.js core
  private renderer:       THREE.WebGLRenderer;
  private scene:          THREE.Scene;
  private _bulletScene:   THREE.Scene; // rendered after bloom so bullets are always visible
  private camera:         THREE.PerspectiveCamera;
  private composer:       EffectComposer;
  private bloomPass:      UnrealBloomPass;
  private afterimagePass: AfterimagePass;
  private caPass:         ShaderPass;

  // Background systems (kept from original)
  private starField:  StarField;
  private tunnel:     TunnelRenderer;
  private particles:  ParticleSystem;
  private visualFx:   VisualEffects;
  private music:      MusicEngine;
  private debris:     DebrisSystem;

  // EEE gameplay systems
  private chain:    ChainSystem;
  private enemies:  EEEEnemySystem;
  private pickups:  EEEPickupSystem;
  private input:    InputManager;
  private hud:      HUD;

  // Player star
  private _playerGroup: THREE.Group;
  private _playerMat:   THREE.LineBasicMaterial;

  // Player trail
  private static readonly TRAIL_MAX = 60;
  private _trailBuf:      Float32Array;
  private _trailColBuf:   Float32Array;
  private _trailPosAttr:  THREE.Float32BufferAttribute;
  private _trailColAttr:  THREE.Float32BufferAttribute;
  private _trailGeo:      THREE.BufferGeometry;
  private _trailLine:     THREE.Line;

  // Player state
  private _px = 0;           // player X in arena
  private _py = 0;           // player Y in arena
  private _respawnTimer  = 0; // > 0 = invisible / respawning
  private _invincibleTimer = 0;
  private _flashPhase    = 0; // for invincibility blink
  private _chargePhase   = 0; // for max-charge vibration
  private _hitFreezeTimer    = 0;   // > 0 = time frozen after enemy contact
  private _hitChargeProgress = 0;   // charge level captured at moment of hit
  private _deathSlowmo      = 1.0; // slow-motion multiplier during dying phase
  private _deathCamAngle    = 0;   // accumulated orbit angle during dying
  private _deathCamPos      = new THREE.Vector3(); // lerped camera position during dying
  private _deathLookAt      = new THREE.Vector3(); // lerped lookAt target during dying
  private _tmpVec3          = new THREE.Vector3(); // scratch vector — reused every frame
  private _tmpVec3b         = new THREE.Vector3(); // second scratch vector
  private _titleTime        = 0;   // accumulates during title/gameover for tunnel animation
  private _gameOverText:       THREE.Group | null = null;
  private _gameOverLetters:    THREE.LineSegments[] = [];
  private _gameOverLetterTimer = 0;
  private _gameOverLetterIdx   = 0;
  private _gameOverAnimTime         = 0;
  private _dieDelay:   number = -1;          // ≥0 = counting down to _die(); -1 = idle
  private _dieReason: 'bombs' | 'time' = 'bombs';
  private _shakeAmount = 0;   // camera shake amplitude (world units, decays per frame)
  private _halfW = 130; // visible world bounds at game plane — recomputed on resize
  private _halfH = 96;
  private _glitchTimer = 0;   // >0 = chromatic aberration glitch active

  // Interactive tutorial
  private _tut!:             InteractiveTutorial;
  private _tutStep           = -1;   // -1 = inactive; 0–7 = active; 8 = complete
  private _tutCompleteTimer  = -1;   // countdown after final step before real game starts
  private _tutInfoTimer      = -1;   // auto-advance timer for info-only steps (6 & 7)
  private _tutInitDist       = 0;    // max dist from origin (step-0 move check)
  private _tutCluster        = { x: 0, y: 0 }; // world target for arrow indicator

  // EEE game state
  private phase:         GamePhase = 'title';
  private score:         number = 0;
  private timeRemaining: number = EEE.START_TIME;
  private bombs:         number = EEE.START_BOMBS;
  private quicken:       number = 0;
  private maxChain:      number = 0;
  private kills:         number = 0;
  private extendTarget:  number = 0;

  // Pending kills from chain system (processed after chain.update returns)
  private _pendingKills = new Map<number, number>(); // enemyId → handlerId

  // Pause
  private _isPaused = false;

  // Portals
  private _exitPortal:      THREE.Group | null = null;
  private _startPortal:     THREE.Group | null = null;
  private _portalMats:      Array<THREE.MeshBasicMaterial | THREE.PointsMaterial> = [];
  private _portalDiscMats:  THREE.MeshBasicMaterial[] = [];
  private _portalPBufs:     Array<{ init: Float32Array; attr: THREE.BufferAttribute }> = [];
  private _portalHue           = 0;
  private _portalTrig          = false;
  private _startPortalActive   = false;

  // Analytics
  private _firstChain          = false;
  private _gameCount           = 0;   // total _startGame() calls
  private _milestone60sTracked = false;
  private _gemsThisSession     = 0;
  private _bombsEarnedSession  = 0;
  private _bombsSpentSession   = 0;

  // Session
  private _sessionStart       = 0;
  private _pendingBest        = 0;
  private _pendingRank        = '';
  private _pendingLeaderboard: LeaderboardRecord[] = [];
  private _personalBest       = 0;

  // Cheat flags — applied once at the start of the next real game
  private _cheatExtraBombs = 0;
  private _cheatMaxFlux    = false;
  private _cheatExtraTime  = 0;

  // Mobile detection — matches the CSS (pointer:coarse) query used for mobile controls
  private readonly _isMobile = window.matchMedia('(pointer: coarse)').matches;

  // Haptics via navigator.vibrate where supported
  private readonly _hapticOk = 'vibrate' in navigator;

  // Background scroll (fixed anchor — tunnel/stars scroll via internal wrapping)
  private readonly _bgPos = new THREE.Vector3();
  private _speedFactor = 0;

  // Camera smooth follow
  private _camX = 0;
  private _camY = 0;

  // Loop timing
  private _last = 0;

  // ── Constructor ─────────────────────────────────────────────────────────────

  constructor(container: HTMLElement) {
    (window as any).THREE = THREE; // required by vibej.am/2026/portal/sample.js

    // Renderer — mobile uses lower pixel ratio and skips antialias (high DPI hides it)
    this.renderer = new THREE.WebGLRenderer({ antialias: !this._isMobile });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this._isMobile ? 1.0 : 2.0));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ReinhardToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    // Scene + camera
    this.scene        = new THREE.Scene();
    this._bulletScene = new THREE.Scene(); // overlay: bullets rendered after bloom
    this.camera = new THREE.PerspectiveCamera(
      CAMERA.FOV, window.innerWidth / window.innerHeight, CAMERA.NEAR, CAMERA.FAR,
    );
    const initCamZ = this._isMobile ? 520 : CAMERA.Z;
    this.camera.position.set(0, CAMERA.Y, initCamZ);
    this.camera.lookAt(0, 0, CAMERA.LOOK_Z);
    this._computeBounds();

    // Post-processing — mobile skips afterimage (saves a full render pass)
    const bloomW = this._isMobile ? Math.round(window.innerWidth  * 0.5) : window.innerWidth;
    const bloomH = this._isMobile ? Math.round(window.innerHeight * 0.5) : window.innerHeight;
    this.composer  = new EffectComposer(this.renderer);
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(bloomW, bloomH),
      VISUAL.BLOOM_STRENGTH, VISUAL.BLOOM_RADIUS, VISUAL.BLOOM_THRESHOLD,
    );
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(this.bloomPass);
    this.afterimagePass = new AfterimagePass(0.76);
    if (!this._isMobile) this.composer.addPass(this.afterimagePass);
    this.caPass = new ShaderPass(ChromaticAberrationShader);
    this.composer.addPass(this.caPass);

    // Background / visual systems
    this.visualFx  = new VisualEffects(this.scene);
    this.starField = new StarField();
    this.starField.addToScene(this.scene);
    this.tunnel    = new TunnelRenderer(this.scene);
    this.particles = new ParticleSystem();
    this.particles.addToScene(this.scene);
    this.debris    = new DebrisSystem();
    this.debris.addToScene(this.scene);

    // Music
    this.music = new MusicEngine();
    void this.music.load('./track.mid');

    // EEE gameplay systems
    this.chain   = new ChainSystem(this.scene);
    this.enemies = new EEEEnemySystem(this.scene, this._bulletScene);
    this.pickups = new EEEPickupSystem(this.scene);
    this.input   = new InputManager();
    this.hud     = new HUD(
      (v) => this.music.setMusicVolume(v),
      (v) => this.music.setSfxVolume(v),
      (v) => { this.input.invertY = v; },
    );
    this.hud.setLastBombBeepCb(() => this.music.playLastBombWarning());
    this.hud.setTenSecBeepCb(()   => this.music.playLowTimeWarning());

    // Interactive tutorial
    this._tut = new InteractiveTutorial();
    window.addEventListener('game:tutorial-start', () => this._startTutorial());

    // Callbacks
    this.chain.onEnemyHit = (enemyId, handlerId) => {
      if (!this._pendingKills.has(enemyId)) {
        this._pendingKills.set(enemyId, handlerId);
      }
    };

    this.chain.onChainComplete = (chainCount) => {
      this._onChainComplete(chainCount);
    };

    this.pickups.onCollect = (type, x, y) => {
      this._onPickupCollected(type, x, y);
    };

    this.enemies.onBulletHitPlayer = () => {
      this._onPlayerHit();
    };

    // Player body-hit by enemy — sparks + physics push
    this.enemies.onPlayerEnemyCollision = (x, y, _pushDx, _pushDy, col) => {
      // Spawn sparks at contact point; no push — collision triggers freeze+detonate
      const pos = new THREE.Vector3(x, y, ARENA.GAME_Z + 2);
      this.particles.explode(pos, 10, col.clone(), 1.0);
    };

    // Player: compass rose — 4 diamond arms (N-S, E-W, NE-SW, NW-SE)
    {
      this._playerMat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        blending:   THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      this._playerGroup = new THREE.Group();

      const addDiamond = (pts: [number, number][]): void => {
        const verts = pts.map(([x, y]) => new THREE.Vector3(x, y, 0));
        const geo   = new THREE.BufferGeometry().setFromPoints(verts);
        this._playerGroup.add(new THREE.LineLoop(geo, this._playerMat));
      };

      const L = 6.0;   // cardinal arm length
      const S = 3.8;   // intercardinal arm length
      const cW = 1.4;  // cardinal arm half-width at waist
      const dW = 0.85; // intercardinal arm half-width at waist
      const d  = S * Math.SQRT1_2; // ≈ 2.69

      // N-S arm
      addDiamond([[0, L], [cW, 0], [0, -L], [-cW, 0]]);
      // E-W arm
      addDiamond([[L, 0], [0, cW], [-L, 0], [0, -cW]]);
      // NE-SW arm (45° diagonal, shorter)
      addDiamond([[d, d], [-dW * Math.SQRT1_2, dW * Math.SQRT1_2], [-d, -d], [dW * Math.SQRT1_2, -dW * Math.SQRT1_2]]);
      // NW-SE arm (-45° diagonal, shorter)
      addDiamond([[-d, d], [dW * Math.SQRT1_2, dW * Math.SQRT1_2], [d, -d], [-dW * Math.SQRT1_2, -dW * Math.SQRT1_2]]);
    }
    this._playerGroup.visible = false; // hidden until game starts
    this.scene.add(this._playerGroup);

    // Ship trail
    const TM = Game.TRAIL_MAX;
    this._trailBuf     = new Float32Array(TM * 3);
    this._trailColBuf  = new Float32Array(TM * 3);
    this._trailPosAttr = new THREE.Float32BufferAttribute(this._trailBuf, 3);
    this._trailColAttr = new THREE.Float32BufferAttribute(this._trailColBuf, 3);
    this._trailPosAttr.setUsage(THREE.DynamicDrawUsage);
    this._trailColAttr.setUsage(THREE.DynamicDrawUsage);
    this._trailGeo = new THREE.BufferGeometry();
    this._trailGeo.setAttribute('position', this._trailPosAttr);
    this._trailGeo.setAttribute('color',    this._trailColAttr);
    this._trailLine = new THREE.Line(
      this._trailGeo,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        blending:     THREE.AdditiveBlending,
        depthWrite:   false,
        toneMapped:   false,
      }),
    );
    this._trailLine.frustumCulled = false;
    this._trailLine.visible = false; // hidden until game starts
    this.scene.add(this._trailLine);

    this.scene.add(new THREE.AmbientLight(0x111122, 0.3));

    window.addEventListener('resize',          () => this._resize());
    window.addEventListener('game:start',      () => this._startGame());
    window.addEventListener('game:show-title', () => {
      // Clean up any leftover 3D game-over text and reset to title state
      if (this._gameOverText) {
        this.scene.remove(this._gameOverText);
        this._gameOverText.traverse(obj => {
          const ls = obj as THREE.LineSegments;
          if (ls.geometry) ls.geometry.dispose();
          if (ls.material) (ls.material as THREE.LineBasicMaterial).dispose();
        });
        this._gameOverText    = null;
        this._gameOverLetters = [];
      }
      if (this.phase === 'gameover' || this.phase === 'dying') {
        this.phase = 'title';
        this._titleTime = 0;
        const camZ = this._isMobile ? 520 : CAMERA.Z;
        this.camera.position.set(0, CAMERA.Y, camZ);
        this.camera.lookAt(0, 0, CAMERA.LOOK_Z);
      }
    });
    window.addEventListener('game:leaderboard', () => {
      this.hud.showLeaderboardOverlay([], true);
      void this._fetchTitleLeaderboard();
    });
    window.addEventListener('game:cheat', (e: Event) => {
      const { type } = (e as CustomEvent<{ type: string }>).detail;
      switch (type) {
        case 'bombs':      this._cheatExtraBombs += 5; break;
        case 'flux':       this._cheatMaxFlux = true; break;
        case 'time':       this._cheatExtraTime += 60; break;
        case 'clear-best':
          this._personalBest = 0;
          setPersonalBest(0);
          break;
      }
    });
    this._loadPersonalBest();
    this._initPortals();
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  start(): void {
    this._last = performance.now();
    this._loop(this._last);
  }

  pause(): void {
    if (this._isPaused) return;
    this._isPaused = true;
    this.music.stop();
  }

  resume(): void {
    if (!this._isPaused) return;
    this._isPaused = false;
    if (this.phase === 'playing') void this.music.start();
  }

  // ── Game start / reset ──────────────────────────────────────────────────────

  private _startGame(): void {
    // First time ever — run tutorial instead of jumping straight into the game
    if (!localStorage.getItem('aaa-tutorial-done')) {
      this._startTutorial();
      return;
    }
    this.hud.showForGame();
    this._portalTrig   = false;
    this.phase         = 'playing';
    this.score         = 0;
    this.timeRemaining = EEE.START_TIME;
    this.bombs         = EEE.START_BOMBS;
    this.quicken       = 0;
    this.maxChain      = 0;
    this.kills         = 0;
    this.extendTarget  = 10;
    this._isPaused          = false;
    this._sessionStart      = Date.now();
    this._pendingBest            = 0;
    this._pendingRank            = '';
    this._pendingLeaderboard     = [];
    this._pendingKills.clear();
    this._firstChain             = false;
    this._milestone60sTracked    = false;
    this._gemsThisSession        = 0;
    this._bombsEarnedSession     = 0;
    this._bombsSpentSession      = 0;

    // Reset player
    this._px = 0;
    this._py = 0;
    this._respawnTimer    = 0;
    this._deathSlowmo     = 1.0;
    this._invincibleTimer = 2.0;  // brief grace on game start
    this._hitFreezeTimer  = 0;
    this._dieDelay        = -1;
    this._shakeAmount     = 0;
    this._glitchTimer     = 0;

    // Reset background
    this._speedFactor = 0;
    this._camX = 0;
    this._camY = 0;

    // Reset trail
    for (let i = 0; i < Game.TRAIL_MAX; i++) {
      this._trailBuf[i * 3]     = 0;
      this._trailBuf[i * 3 + 1] = 0;
      this._trailBuf[i * 3 + 2] = ARENA.GAME_Z;
    }
    this._trailLine.visible = true;

    // Clear systems
    this.chain.clearAll();
    this.enemies.clearAll();
    this.pickups.clearAll();
    this.enemies.setQuicken(0);

    // Apply pending cheat flags (consumed once, then cleared)
    if (this._cheatExtraBombs > 0) { this.bombs += this._cheatExtraBombs; this._cheatExtraBombs = 0; }
    if (this._cheatMaxFlux)        { this.quicken = EEE.MAX_QUICKEN; this.enemies.setQuicken(this.quicken); this._cheatMaxFlux = false; }
    if (this._cheatExtraTime > 0)  { this.timeRemaining += this._cheatExtraTime; this._cheatExtraTime = 0; }

    if (this._gameOverText) {
      this.scene.remove(this._gameOverText);
      this._gameOverText.traverse(obj => {
        const ls = obj as THREE.LineSegments;
        if (ls.geometry) ls.geometry.dispose();
        if (ls.material) (ls.material as THREE.LineBasicMaterial).dispose();
      });
      this._gameOverText    = null;
      this._gameOverLetters = [];
    }

    this.visualFx.onDeath();
    this.input.activate();
    this.input.clearHold(); // flush any charge state carried over from the tutorial
    void this.music.start();

    this._playerGroup.visible = true;

    // Show keyboard controls illustration on PC for first few seconds
    if (!this._isMobile) this.hud.showControlsHint();

    this._trackEvent('game_start', {
      platform:     this._isMobile ? 'mobile' : 'desktop',
      attempt_number: this._gameCount + 1,
    });
    this._gameCount++;
  }

  // ── Main loop ───────────────────────────────────────────────────────────────

  private _loop = (now: number): void => {
    requestAnimationFrame(this._loop);
    if (this._isPaused) return;
    const dt = Math.min((now - this._last) / 1000, 0.05);
    this._last = now;
    this._update(dt);
    this._tickPortals(dt);
    this.composer.render();
    // Render bullets on top of all post-processing (bloom, afterimage, CA).
    // Clear depth first so bullets aren't occluded by stale depth data from the passes.
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this._bulletScene, this.camera);
    this.renderer.autoClear = true;
  };

  private _update(dt: number): void {
    if (this.phase === 'title' || this.phase === 'gameover') {
      this._titleTime += dt;
      // Full-intensity wormhole on title/gameover screens
      const titleSpeed = 0.55 + Math.sin(this._titleTime * 0.38) * 0.18;
      this.tunnel.update(this._bgPos, 1.6, dt, 1.0, 0, titleSpeed, 1.0, dt);
      this.starField.scroll(0, dt * 0.9);
      if (this.phase === 'gameover') this.enemies.updateVisual(dt, dt);
    } else if (this.phase === 'tutorial') {
      this._updateTutorial(dt);
    } else if (this.phase === 'playing') {
      this._updatePlaying(dt);
    } else if (this.phase === 'dying') {
      this._respawnTimer -= dt;
      // Slow-mo: exponential decay from 1.0 → 0.06 over ~10 s (k=0.28 → e^(-0.28×10) ≈ 0.061)
      this._deathSlowmo = Math.max(0.06, this._deathSlowmo * (1 - dt * 0.28));
      const sdt = dt * this._deathSlowmo;
      // World animations play in slow-mo; music timing stays real
      this.tunnel.update(this._bgPos, this.visualFx.state.bloomScale, sdt, this.visualFx.multiplier, this.music.beatAccent, this._speedFactor, this.quicken / EEE.MAX_QUICKEN, dt);
      this.starField.scroll(0, sdt);
      this.enemies.updateVisual(sdt, dt);
      this.pickups.updateDying(sdt);

      this.visualFx.pulseBeat(this.music.beatAccent);
      this.music.update(dt);

      // ── Death camera: chase ships INTO the tunnel from behind ──────────────
      this._deathCamAngle += dt * 0.10; // gentle sway
      const dp      = Math.max(0, 1 - this._respawnTimer / 10.0); // 0→1
      const centroid = this.enemies.getAliveCentroid();
      const shipEz   = centroid ? centroid.ez : 0;
      const shipX    = centroid ? centroid.x  : 0;
      const shipY    = centroid ? centroid.y  : 0;
      // Camera stays inside the tunnel axis, 90 units behind the ship centroid
      const sway = 18 + dp * 14;
      const tx = Math.sin(this._deathCamAngle) * sway + shipX * 0.04;
      const ty = CAMERA.Y + Math.cos(this._deathCamAngle * 0.65) * sway * 0.5 + shipY * 0.04;
      const tz = ARENA.GAME_Z + shipEz + (this._isMobile ? 260 : 90);
      // Smooth lerp: fast at first, settles quickly — frame-rate independent
      const ease = 1 - Math.exp(-dt * 4.5);
      this._deathCamPos.lerp(this._tmpVec3.set(tx, ty, tz), ease);
      this._deathLookAt.lerp(
        this._tmpVec3.set(shipX * 0.15, shipY * 0.15, ARENA.GAME_Z + shipEz - 40),
        ease,
      );
      this.camera.position.copy(this._deathCamPos);
      this.camera.lookAt(this._deathLookAt);

      // Reveal letters one by one at real-time speed
      if (this._gameOverLetterIdx < this._gameOverLetters.length) {
        this._gameOverLetterTimer += dt;
        while (this._gameOverLetterTimer >= 0.06 && this._gameOverLetterIdx < this._gameOverLetters.length) {
          this._gameOverLetterTimer -= 0.06;
          this._gameOverLetters[this._gameOverLetterIdx].visible = true;
          this._gameOverLetterIdx++;
        }
      }

      // GAME OVER text continuously recedes — perspective projection naturally shrinks it
      this._gameOverAnimTime += dt;
      if (this._gameOverText) {
        const dist = 120 + this._gameOverAnimTime * 55; // starts at 120 units, moves away at 55/s
        const fwd = this._tmpVec3.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
        const up  = this._tmpVec3b.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
        this._gameOverText.position
          .copy(this.camera.position)
          .addScaledVector(fwd, dist)
          .addScaledVector(up, 12);
        this._gameOverText.quaternion.copy(this.camera.quaternion);
      }

      if (this._respawnTimer <= 0) {
        this.music.fadeOut(5);
        // Hide the tunnel "GAME OVER" text as soon as the summary screen appears
        if (this._gameOverText) this._gameOverText.visible = false;
        this.hud.showGameOver(this.score, this.maxChain, this._pendingBest, this._pendingRank, this._pendingLeaderboard);
        this.phase = 'gameover';
      }
    }

    this.particles.update(dt);
    this.debris.update(dt);
    this.visualFx.update(dt);

    // Post-processing driven by visual intensity
    const minterBoost = (this.visualFx.multiplier - 1) / 8;
    const beatAcc     = this.music.beatAccent;

    // During dying, bloom builds from normal → 3.5× over the 5-second wind-down
    const dyingProgress = this.phase === 'dying' ? Math.max(0, 1 - this._respawnTimer / 10.0) : 0;
    // Pull bloom back during chain reactions so the exploding ships read clearly
    const chainBloomMult = (this.phase === 'playing' && this.chain.hasActive) ? 0.55 : 1.0;
    // Title/gameover screens get a vivid bloom boost so the wormhole pops
    const titleBloomBoost = (this.phase === 'title' || this.phase === 'gameover')
      ? 1.9 + Math.sin(this._titleTime * 0.7) * 0.4 : 1.0;
    this.bloomPass.strength = VISUAL.BLOOM_STRENGTH * this.visualFx.state.bloomScale * (1 + beatAcc * 0.28 + dyingProgress * 2.5) * chainBloomMult * titleBloomBoost * (this._isMobile ? 0.5 : 1.0);
    if (!this._isMobile) this.afterimagePass.uniforms['damp'].value = Math.min(
      0.72 + this._speedFactor * 0.12 + minterBoost * 0.05 + beatAcc * 0.03,
      0.90,
    );
    // Chromatic glitch: spikes hard on hit/death, flickers randomly while active
    this._glitchTimer = Math.max(0, this._glitchTimer - dt);
    const glitchBoost = this._glitchTimer > 0 ? (0.010 + Math.random() * 0.008) : 0;
    this.caPass.uniforms['uStrength'].value = Math.min(
      0.0008 + minterBoost * 0.0025 + beatAcc * 0.004 + glitchBoost,
      this._glitchTimer > 0 ? 0.022 : 0.0045,
    );

    // Screen shake: add random camera offset that decays exponentially
    if (this._shakeAmount > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this._shakeAmount;
      this.camera.position.y += (Math.random() - 0.5) * this._shakeAmount;
      this._shakeAmount *= Math.exp(-dt * 16);
      if (this._shakeAmount < 0.05) this._shakeAmount = 0;
    }
  }

  // ── Playing update ──────────────────────────────────────────────────────────

  private _updatePlaying(dt: number): void {
    // Silence charge tone whenever we're in the hit-freeze or respawn window
    // ── Hit-freeze: brief world-stop + red trace before detonation ──────────
    if (this._hitFreezeTimer > 0) {
      this.music.updateChargeTone(0);
      this._hitFreezeTimer -= dt;
      // Strobe player in red (bright ↔ over-bright bloom)
      const t = (Math.sin(this._hitFreezeTimer * 24) + 1) * 0.5;
      this._playerMat.color.setRGB(1.5 + t * 2.5, 0.05, 0.05);
      this._playerGroup.visible = true;
      this._playerGroup.position.set(this._px, this._py, ARENA.GAME_Z + 2);
      // Background almost frozen (4 % speed)
      const fd = dt * 0.04;
      this.tunnel.update(this._bgPos, this.visualFx.state.bloomScale, fd, this.visualFx.multiplier, this.music.beatAccent, this._speedFactor, this.quicken / EEE.MAX_QUICKEN, dt);
      this.starField.scroll(0, fd);
      this.music.update(dt);
      // Fire detonation as freeze ends — use the charge held at moment of hit
      if (this._hitFreezeTimer <= 0) {
        this._handleDetonate(this._hitChargeProgress);
        this.input.clearHold(); // cancel any held charge so it doesn't immediately re-charge
      }
      return;
    }

    const inp = this.input.update(dt);
    // No bombs left — cancel any held charge so ring, sound, and trail don't activate
    if (this.bombs <= 0 && inp.chargeProgress > 0) this.input.clearHold();
    const chargeProgress = this.bombs > 0 ? inp.chargeProgress : 0;
    const isSlow         = this.bombs > 0 && inp.isSlow;
    this._hitChargeProgress = chargeProgress; // capture in case enemy hits us this frame

    // Charge-up tone: wind up while player holds, silence during respawn or no bombs
    this.music.updateChargeTone(this._respawnTimer <= 0 ? chargeProgress : 0);

    // Chain slow-mo: 72% speed while chain explosions are propagating
    const chainDt = this.chain.hasActive ? dt * 0.72 : dt;

    // ── Invincibility timers ───────────────────────────────────────────────
    if (this._invincibleTimer > 0) this._invincibleTimer -= dt;
    if (this._respawnTimer    > 0) this._respawnTimer    -= dt;
    const isInvincible = this._invincibleTimer > 0;

    // ── Respawn: return to centre ──────────────────────────────────────────
    if (this._respawnTimer > 0) {
      this._playerGroup.visible = false;
    } else if (!this._playerGroup.visible) {
      // Just respawned — stay at detonation position
      this._playerGroup.visible = true;
      this._invincibleTimer = EEE.INVINCIBLE_ADD;
    }

    // ── Player movement ────────────────────────────────────────────────────
    if (this._respawnTimer <= 0) {
      const speed = EEE.PLAYER_SPEED * (isSlow ? EEE.SLOW_MULT : 1.0);
      this._px = Math.max(-this._halfW, Math.min(this._halfW, this._px + inp.moveX * speed * chainDt));
      this._py = Math.max(-this._halfH, Math.min(this._halfH, this._py + inp.moveY * speed * chainDt));
    }

    // ── Detonation ─────────────────────────────────────────────────────────
    if (inp.detonate && this.bombs > 0 && this._respawnTimer <= 0) {
      this._handleDetonate(inp.detonateProgress);
    }

    // ── Timer countdown ────────────────────────────────────────────────────
    this.timeRemaining -= dt;

    // Milestone: survived 60 real-time seconds
    if (!this._milestone60sTracked && (Date.now() - this._sessionStart) >= 60000) {
      this._milestone60sTracked = true;
      this._trackEvent('milestone_reached', {
        name:        'survived_60_seconds',
        final_score: this.score,
      });
    }

    // ── Background scroll ──────────────────────────────────────────────────
    // Tunnel and stars scroll via their own internal offset wrapping.
    // We pass a fixed world anchor (0,0,0) so they stay in front of the camera.
    this._speedFactor += (Math.min(1, this.quicken / EEE.MAX_QUICKEN) * 0.6 - this._speedFactor) * chainDt * 0.4;

    this.tunnel.update(
      this._bgPos,   // _bgPos stays at (0,0,0) — set once in constructor
      this.visualFx.state.bloomScale,
      chainDt,
      this.visualFx.multiplier,
      this.music.beatAccent,
      this._speedFactor,
      this.quicken / EEE.MAX_QUICKEN,
      dt,            // animDt: wave phases run at wall-clock speed (no snap during chain slow-mo)
    );
    this.starField.scroll(0, chainDt);
    this.visualFx.pulseBeat(this.music.beatAccent);

    // ── Enemies ────────────────────────────────────────────────────────────
    const playerHitByEnemy = this.enemies.update(chainDt, this._px, this._py, isInvincible, this.music.beatAccent);
    if (playerHitByEnemy) this._onPlayerHit();

    // ── Pickups ────────────────────────────────────────────────────────────
    if (this._respawnTimer <= 0) {
      this.pickups.update(chainDt, this._px, this._py);
    }

    // ── Chain system ───────────────────────────────────────────────────────
    const aliveRefs = this.enemies.getAliveRefs();
    this.chain.update(chainDt, aliveRefs);

    // Process pending kills (enemies tagged by chain explosions this frame)
    for (const [enemyId, handlerId] of this._pendingKills) {
      const e = this.enemies.killEnemy(enemyId);
      if (!e) continue;

      // Spawn chain explosion at enemy position
      this.chain.addChainExplosion(e.x, e.y, handlerId);

      // Drop pickup
      if (e.dropType) this.pickups.drop(e.dropType, e.x, e.y);

      // Score per red (type 0) ship scales with intensity: 10 × (level + 1)
      if (!e.special && e.type === 0) {
        const killPts = 10 * (this.quicken + 1);
        this.score += killPts;
        const ndc = new THREE.Vector3(e.x, e.y, ARENA.GAME_Z).project(this.camera);
        const ksx = (ndc.x + 1) * 0.5 * window.innerWidth;
        const ksy = (-ndc.y + 1) * 0.5 * window.innerHeight;
        this.hud.showKillScore(killPts, ksx, ksy);
      }

      // Visual effects
      const pos = new THREE.Vector3(e.x, e.y, ARENA.GAME_Z);
      this.particles.explode(pos, 18 + this.quicken * 2, e.color.clone(), 2.8);
      this.debris.spawn(pos, e.color, e.special ? 22 : 12);
      this.music.playChainPop();
      this.visualFx.onKill();
      this.kills++;

      this._haptic('light');
    }
    this._pendingKills.clear();

    // ── Music ──────────────────────────────────────────────────────────────
    this.music.update(dt);
    this.music.setGameState(this.enemies.getAliveCount(), this.visualFx.multiplier, 0);
    this.music.setQuicken(this.quicken / EEE.MAX_QUICKEN);

    // ── Player ship renderer ───────────────────────────────────────────────
    // At max charge: high-frequency vibration (two out-of-phase sines → elliptic shake)
    this._chargePhase += dt * 38; // ~38 rad/s ≈ 6 Hz vibration
    const atMax = chargeProgress >= 1.0 && this._respawnTimer <= 0;
    const shakeAmt = atMax ? 1.8 : 0;
    const sx = Math.sin(this._chargePhase * 1.0) * shakeAmt;
    const sy = Math.sin(this._chargePhase * 1.7) * shakeAmt; // different freq → elliptic, not linear
    this._playerGroup.position.set(this._px + sx, this._py + sy, ARENA.GAME_Z + 2);

    // Invincibility blink — strobe brightness (white ↔ over-bright bloom), never hide
    const shipColor = this.visualFx.getPlayerColor();
    if (isInvincible && this._respawnTimer <= 0) {
      this._flashPhase += dt * 12;
      // 0 → dim white (0.5), 1 → super-bright bloom burst (5.0)
      const t = (Math.sin(this._flashPhase) + 1) * 0.5;
      const bright = 0.5 + t * 4.5;
      this._playerMat.color.setRGB(bright, bright, bright);
      this._playerGroup.visible = true;
    } else {
      this._playerGroup.visible = this._respawnTimer <= 0;
      this._flashPhase = 0;
      this._playerMat.color.copy(shipColor);
    }

    // ── Trail ──────────────────────────────────────────────────────────────
    if (this._respawnTimer <= 0) {
      this._trailBuf.copyWithin(3, 0, (Game.TRAIL_MAX - 1) * 3);
      this._trailBuf[0] = this._px;
      this._trailBuf[1] = this._py;
      this._trailBuf[2] = ARENA.GAME_Z + 2;
      this._trailPosAttr.needsUpdate = true;

      const baseLen   = 20;
      const trailLen  = Math.max(baseLen, Math.floor(baseLen + chargeProgress * (Game.TRAIL_MAX - baseLen)));
      const trailGlow = 0.6 + chargeProgress * 1.4;
      const trailCol  = chargeProgress > 0.05
        ? new THREE.Color().setHSL(0.08, 1.0, 0.6)  // orange while charging
        : new THREE.Color(1, 1, 1);                   // white normally
      this._trailGeo.setDrawRange(0, Math.min(trailLen, Game.TRAIL_MAX));
      for (let ti = 0; ti < Game.TRAIL_MAX; ti++) {
        const f = Math.pow(Math.max(0, 1 - ti / trailLen), 2.2) * trailGlow;
        this._trailColBuf[ti * 3]     = trailCol.r * f;
        this._trailColBuf[ti * 3 + 1] = trailCol.g * f;
        this._trailColBuf[ti * 3 + 2] = trailCol.b * f;
      }
      this._trailColAttr.needsUpdate = true;
    }

    // ── Camera (slight follow of player) ────────────────────────────────────
    this._camX += (this._px * 0.25 - this._camX) * Math.min(chainDt * 3, 1);
    this._camY += (this._py * 0.12 - this._camY) * Math.min(chainDt * 3, 1);

    const camZ    = this._isMobile ? 520 : CAMERA.Z;
    const beatZoom = this.music.beatAccent * 2;
    this.camera.position.set(this._camX, CAMERA.Y + this._camY, camZ - beatZoom);
    this.camera.lookAt(this._camX * 0.5, this._camY * 0.4, CAMERA.LOOK_Z);

    // ── Project player to screen for charge ring ───────────────────────────
    const playerNDC = new THREE.Vector3(this._px, this._py, ARENA.GAME_Z + 2).project(this.camera);
    const psx = (playerNDC.x + 1) / 2 * window.innerWidth;
    const psy = (-playerNDC.y + 1) / 2 * window.innerHeight;

    // Compute actual blast radius in screen pixels so the ring matches the explosion
    const blastT      = Math.pow(chargeProgress, 2.5);
    const worldBlastR = EEE.NORMAL_RADIUS + (EEE.CHARGED_RADIUS - EEE.NORMAL_RADIUS) * blastT;
    const edgeNDC = new THREE.Vector3(this._px + worldBlastR, this._py, ARENA.GAME_Z + 2).project(this.camera);
    const esx     = (edgeNDC.x + 1) / 2 * window.innerWidth;
    const esy     = (-edgeNDC.y + 1) / 2 * window.innerHeight;
    const blastRadiusPx = Math.sqrt((esx - psx) ** 2 + (esy - psy) ** 2);

    // ── HUD ────────────────────────────────────────────────────────────────
    this.hud.update(
      this.score,
      this.timeRemaining,
      this.bombs,
      this.quicken,
      this.extendTarget,
      chargeProgress,
      psx, psy,
      blastRadiusPx,
      dt,
    );

    // ── Game over check ────────────────────────────────────────────────────
    // Wait for any active chain to fully settle before ending — the chain's
    // onChainComplete callback may still award an extend (extra bomb).
    if (this._dieDelay < 0
        && this._respawnTimer <= 0 && this._hitFreezeTimer <= 0
        && (this.bombs <= 0 || this.timeRemaining <= 0)
        && !this.chain.hasPendingChain) {
      // 2-second dramatic pause: flash the depleted element, then transition
      this._dieReason = this.timeRemaining <= 0 ? 'time' : 'bombs';
      this._dieDelay  = 0.05;
      this.hud.flashDanger(this._dieReason);
      this.input.deactivate(); // freeze all player input immediately
    }
    if (this._dieDelay >= 0) {
      this._dieDelay -= dt;
      if (this._dieDelay < 0) this._die();
    }
  }

  // ── Detonation ──────────────────────────────────────────────────────────────

  // ── Tutorial ────────────────────────────────────────────────────────────────

  private _startTutorial(): void {
    this._px = 0; this._py = 0;
    this._respawnTimer    = 0;
    this._invincibleTimer = 2.0;
    this._shakeAmount     = 0;
    this._glitchTimer     = 0;
    this._speedFactor     = 0;
    this._camX            = 0;
    this._camY            = 0;
    this._chargePhase     = 0;
    this._flashPhase      = 0;
    this._dieDelay        = -1;
    this._hitFreezeTimer  = 0;

    for (let i = 0; i < Game.TRAIL_MAX; i++) {
      this._trailBuf[i * 3]     = 0;
      this._trailBuf[i * 3 + 1] = 0;
      this._trailBuf[i * 3 + 2] = ARENA.GAME_Z;
    }
    this._trailPosAttr.needsUpdate = true;

    if (this._gameOverText) {
      this.scene.remove(this._gameOverText);
      this._gameOverText.traverse(obj => {
        const ls = obj as THREE.LineSegments;
        if (ls.geometry) ls.geometry.dispose();
        if (ls.material)  (ls.material as THREE.LineBasicMaterial).dispose();
      });
      this._gameOverText    = null;
      this._gameOverLetters = [];
    }

    this.chain.clearAll();
    this.enemies.clearAll();
    this.pickups.clearAll();
    this.enemies.setQuicken(0);
    this.visualFx.onDeath();

    this._playerGroup.visible = true;
    this._trailLine.visible   = true;

    this._tutStep          = 0;
    this._tutCompleteTimer = -1;
    this._tutInitDist      = 0;
    this._tutCluster       = { x: 0, y: 0 };
    try { window.emrg?.track('ftue_started', {}); } catch (e) { console.error('Analytics error:', e); }
    try { window.emrg?.track('ftue_step_completed', { step: 1, total: 8 }); } catch (e) { console.error('Analytics error:', e); }

    this.hud.hideOverlay();
    this.phase = 'tutorial';
    this.input.activate();
    // Defer music start until first user gesture — browsers block AudioContext
    // creation before any interaction has occurred (autoplay policy).
    const _tutMusicUnlock = () => { void this.music.start(); };
    window.addEventListener('pointerdown', _tutMusicUnlock, { once: true, capture: true });
    window.addEventListener('keydown',     _tutMusicUnlock, { once: true, capture: true });
    this._tut.showStep(0);
    this._tut.hideArrow();
    if (!this._isMobile) this.hud.showControlsHint();
    localStorage.setItem('aaa-tutorial-done', '1');
  }

  private _advanceTutStep(): void {
    this._tutStep++;
    this.hud.setTutorialHighlight(null);
    if (this._tutStep >= 8) {
      try { window.emrg?.track('ftue_completed', {}); } catch (e) { console.error('Analytics error:', e); }
      this._tut.showComplete();
      this._tutCompleteTimer = 2.0;
      return;
    }
    try { window.emrg?.track('ftue_step_completed', { step: this._tutStep + 1, total: 8 }); } catch (e) { console.error('Analytics error:', e); }
    this._setupTutStep(this._tutStep);
    this._tut.showStep(this._tutStep);
  }

  private _setupTutStep(step: number): void {
    // Reset player to centre with brief invincibility on each new step
    this._px = 0;
    this._py = 0;
    this._respawnTimer    = 0;
    this._invincibleTimer = 1.5;
    this._playerGroup.visible = true;

    const TUT_SPEED = 1; // enemies barely drift during tutorial
    switch (step) {
      case 1:
        this.enemies.clearAll();
        for (const [x, y] of [[0,55],[22,48],[-22,48],[12,68],[-12,68]] as [number,number][])
          this.enemies.spawnAt(x, y, 0, TUT_SPEED);
        this._tutCluster = { x: 0, y: 55 };
        break;
      case 3:
        this.enemies.clearAll();
        for (const [x, y] of [[0,50],[22,44],[-22,44],[12,62],[-12,62]] as [number,number][])
          this.enemies.spawnAt(x, y, 0, TUT_SPEED);
        this._tutCluster = { x: 0, y: 50 };
        break;
      case 4:
        // Tight cluster: enemies ≤16 units apart so CHAIN_RADIUS (27) easily propagates
        this.enemies.clearAll();
        for (const [x, y] of [[0,40],[16,40],[-16,40],[8,54],[-8,54],[24,54],[-24,54]] as [number,number][])
          this.enemies.spawnAt(x, y, 0, TUT_SPEED);
        this._tutCluster = { x: 0, y: 46 };
        break;
      case 5:
        this.enemies.clearAll();
        this.pickups.clearAll();
        this.pickups.drop('time', 0, 30);
        this._tutCluster = { x: 0, y: 30 };
        break;
      case 6:
        this.enemies.clearAll();
        this.pickups.clearAll();
        this._tutInfoTimer = 4.0;
        this.hud.setTutorialHighlight('bombs');
        break;
      case 7:
        this.enemies.clearAll();
        this.pickups.clearAll();
        this._tutInfoTimer = 4.0;
        this.hud.setTutorialHighlight('extend');
        break;
    }
  }

  private _handleTutorialDetonate(chargeProgress: number): void {
    this.music.updateChargeTone(0);
    this.music.playChargeRelease(chargeProgress);
    this._respawnTimer    = EEE.RESPAWN_TIME;
    this._invincibleTimer = EEE.RESPAWN_TIME + EEE.INVINCIBLE_ADD;
    this.chain.detonate(this._px, this._py, chargeProgress);
    this.enemies.clearBullets();
    const pos   = new THREE.Vector3(this._px, this._py, ARENA.GAME_Z);
    const count = Math.round(70 + chargeProgress * 60);
    const scale = 2.8 + chargeProgress * 1.2;
    this.particles.explode(pos, count, new THREE.Color(1.0, 0.55, 0.0), scale);
    this.debris.spawn(pos, new THREE.Color(1.0, 0.5, 0.0), Math.round(16 + chargeProgress * 8));
    this.music.playImpact();
    this._haptic(chargeProgress >= 0.95 ? 'heavy' : 'medium');
    if (this._tutStep === 2) this._advanceTutStep();
    else if (this._tutStep === 3 && chargeProgress >= 0.75) this._advanceTutStep();
  }

  private _updateTutorial(dt: number): void {
    // Info-only steps (6 & 7): auto-advance after timer
    if ((this._tutStep === 6 || this._tutStep === 7) && this._tutInfoTimer >= 0) {
      this._tutInfoTimer -= dt;
      if (this._tutInfoTimer < 0) this._advanceTutStep();
    }

    // Complete timer: after final step, wait 2 s then launch real game
    if (this._tutCompleteTimer >= 0) {
      this._tutCompleteTimer -= dt;
      if (this._tutCompleteTimer < 0) {
        this._tut.hide();
        this._tutStep = -1;
        this._startGame();
      }
      this.tunnel.update(this._bgPos, 1.4, dt, 1.0, 0, 0.5, 0, dt);
      this.starField.scroll(0, dt);
      this.music.update(dt);
      return;
    }

    const inp = this.input.update(dt);

    // Respawn: teleport back to origin after detonation
    if (this._respawnTimer > 0) {
      this._respawnTimer -= dt;
      if (this._respawnTimer <= 0) {
        this._px = 0;
        this._py = 0;
        this._playerGroup.visible = true;
        this._invincibleTimer = EEE.INVINCIBLE_ADD;
      }
    }
    const isRespawning = this._respawnTimer > 0;
    if (this._invincibleTimer > 0) this._invincibleTimer -= dt;
    const isInvincible = this._invincibleTimer > 0;

    // Movement
    if (!isRespawning) {
      const speed = EEE.PLAYER_SPEED * (inp.isSlow ? EEE.SLOW_MULT : 1.0);
      this._px = Math.max(-ARENA.HALF_W, Math.min(ARENA.HALF_W, this._px + inp.moveX * speed * dt));
      this._py = Math.max(-ARENA.HALF_H, Math.min(ARENA.HALF_H, this._py + inp.moveY * speed * dt));
    }

    // Detonation — no bombs spent in tutorial
    if (inp.detonate && !isRespawning) this._handleTutorialDetonate(inp.detonateProgress);

    // Step 0: detect movement away from origin
    if (this._tutStep === 0) {
      const d = Math.sqrt(this._px * this._px + this._py * this._py);
      if (d > this._tutInitDist) this._tutInitDist = d;
      if (this._tutInitDist > 35) this._advanceTutStep();
    }
    // Step 1: detect proximity to enemy cluster
    if (this._tutStep === 1) {
      const dx = this._px - this._tutCluster.x;
      const dy = this._py - this._tutCluster.y;
      if (dx * dx + dy * dy < 38 * 38) this._advanceTutStep();
    }

    // Step 5: if the time pickup expired before collection, respawn it
    if (this._tutStep === 5 && this.pickups.count === 0) {
      this.pickups.drop('time', 0, 30);
      this._tutCluster = { x: 0, y: 30 };
    }

    // Steps 6 & 7: advance on any keypress after 0.5 s grace period
    if ((this._tutStep === 6 || this._tutStep === 7) && this._tutInfoTimer > 0 && this._tutInfoTimer < 3.5) {
      if (inp.detonate || Math.abs(inp.moveX) > 0.3 || Math.abs(inp.moveY) > 0.3) {
        this._tutInfoTimer = -1;
        this._advanceTutStep();
      }
    }

    // Scene
    this.tunnel.update(this._bgPos, 1.2, dt, 1.0, 0, 0.3, 0, dt);
    this.starField.scroll(0, dt * 0.5);
    this.enemies.updateVisual(dt, dt);   // visual only — no auto-spawn, no collisions

    // Chain + kills
    const aliveRefs = this.enemies.getAliveRefs();
    this.chain.update(dt, aliveRefs);
    for (const [enemyId, handlerId] of this._pendingKills) {
      const e = this.enemies.killEnemy(enemyId);
      if (!e) continue;
      this.chain.addChainExplosion(e.x, e.y, handlerId);
      const pos = new THREE.Vector3(e.x, e.y, ARENA.GAME_Z);
      this.particles.explode(pos, 18, e.color.clone(), 2.8);
      this.debris.spawn(pos, e.color, 12);
      this.music.playChainPop();
    }
    this._pendingKills.clear();

    // Pickups
    this.pickups.update(dt, this._px, this._py);

    // Music
    this.music.update(dt);
    this.music.updateChargeTone(!isRespawning ? inp.chargeProgress : 0);

    // Player ship visual
    this._chargePhase += dt * 38;
    const atMax    = inp.chargeProgress >= 1.0 && !isRespawning;
    const shakeAmt = atMax ? 1.8 : 0;
    const shipColor = this.visualFx.getPlayerColor();
    if (isInvincible && !isRespawning) {
      this._flashPhase += dt * 12;
      const t      = (Math.sin(this._flashPhase) + 1) * 0.5;
      const bright = 0.5 + t * 4.5;
      this._playerMat.color.setRGB(bright, bright, bright);
      this._playerGroup.visible = true;
    } else {
      this._flashPhase = 0;
      this._playerMat.color.copy(shipColor);
    }
    this._playerGroup.visible = !isRespawning || (isInvincible && !isRespawning);
    this._playerGroup.position.set(
      this._px + Math.sin(this._chargePhase) * shakeAmt,
      this._py + Math.sin(this._chargePhase * 1.7) * shakeAmt,
      ARENA.GAME_Z + 2,
    );

    // Trail
    if (!isRespawning) {
      this._trailBuf.copyWithin(3, 0, (Game.TRAIL_MAX - 1) * 3);
      this._trailBuf[0] = this._px; this._trailBuf[1] = this._py; this._trailBuf[2] = ARENA.GAME_Z + 2;
      this._trailPosAttr.needsUpdate = true;
      const trailLen  = 20;
      const trailGlow = 0.6 + inp.chargeProgress * 1.4;
      const trailCol  = inp.chargeProgress > 0.05
        ? new THREE.Color().setHSL(0.08, 1.0, 0.6) : new THREE.Color(1, 1, 1);
      this._trailGeo.setDrawRange(0, Math.min(trailLen, Game.TRAIL_MAX));
      for (let ti = 0; ti < Game.TRAIL_MAX; ti++) {
        const f = Math.pow(Math.max(0, 1 - ti / trailLen), 2.2) * trailGlow;
        this._trailColBuf[ti * 3]     = trailCol.r * f;
        this._trailColBuf[ti * 3 + 1] = trailCol.g * f;
        this._trailColBuf[ti * 3 + 2] = trailCol.b * f;
      }
      this._trailColAttr.needsUpdate = true;
    }

    // Camera
    this._camX += (this._px * 0.25 - this._camX) * Math.min(dt * 3, 1);
    this._camY += (this._py * 0.12 - this._camY) * Math.min(dt * 3, 1);
    const camZ = this._isMobile ? 520 : CAMERA.Z;
    this.camera.position.set(this._camX, CAMERA.Y + this._camY, camZ);
    this.camera.lookAt(this._camX * 0.5, this._camY * 0.4, CAMERA.LOOK_Z);

    // Project player for charge ring
    const playerNDC = new THREE.Vector3(this._px, this._py, ARENA.GAME_Z + 2).project(this.camera);
    const psx = (playerNDC.x + 1) / 2 * window.innerWidth;
    const psy = (-playerNDC.y + 1) / 2 * window.innerHeight;
    const blastT      = Math.pow(inp.chargeProgress, 2.5);
    const worldBlastR = EEE.NORMAL_RADIUS + (EEE.CHARGED_RADIUS - EEE.NORMAL_RADIUS) * blastT;
    const edgeNDC     = new THREE.Vector3(this._px + worldBlastR, this._py, ARENA.GAME_Z + 2).project(this.camera);
    const esx         = (edgeNDC.x + 1) / 2 * window.innerWidth;
    const esy         = (-edgeNDC.y + 1) / 2 * window.innerHeight;
    const blastRadiusPx = Math.sqrt((esx - psx) ** 2 + (esy - psy) ** 2);
    // HUD: charge ring only — timer/bombs hidden during tutorial
    this.hud.update(0, 999, 10, 0, 0, inp.chargeProgress, psx, psy, blastRadiusPx, dt);
    this.visualFx.pulseBeat(this.music.beatAccent);

    // Arrow indicator
    const needsWorldArrow = this._tutStep >= 1 && this._tutStep !== 2 && this._tutStep !== 3;
    if (needsWorldArrow) {
      const tgt = new THREE.Vector3(this._tutCluster.x, this._tutCluster.y, ARENA.GAME_Z);
      const tn  = tgt.project(this.camera);
      this._tut.setArrow((tn.x + 1) / 2 * window.innerWidth, (-tn.y + 1) / 2 * window.innerHeight);
    } else if ((this._tutStep === 2 || this._tutStep === 3) && this._tut.isMobile) {
      this._tut.setArrow(window.innerWidth * 0.82, window.innerHeight * 0.80);
    } else {
      this._tut.hideArrow();
    }
  }

  private _handleDetonate(chargeProgress: number): void {
    this.music.updateChargeTone(0);
    this.music.playChargeRelease(chargeProgress); // resolution tone on release
    this.bombs--;
    this._bombsSpentSession++;
    const chargeDurationMs = Math.round(chargeProgress * EEE.CHARGE_TIME * 1000);
    const chargeLevel =
      chargeProgress >= 0.75 ? 'full_charge' :
      chargeProgress >= 0.25 ? 'medium_hold' : 'quick_tap';
    this._trackEvent('detonation_triggered', {
      charge_level:          chargeLevel,
      charge_duration_ms:    chargeDurationMs,
      enemies_in_blast_radius: this.enemies.getAliveCount(),
      position_x:            Math.round(this._px),
      position_y:            Math.round(this._py),
      current_flux_level:    this.quicken,
    });
    this._respawnTimer    = EEE.RESPAWN_TIME;
    this._invincibleTimer = EEE.RESPAWN_TIME + EEE.INVINCIBLE_ADD;

    this.chain.detonate(this._px, this._py, chargeProgress);
    this.enemies.clearBullets(); // player explosion clears all bullets

    // Visual effects ramp with charge
    const pos   = new THREE.Vector3(this._px, this._py, ARENA.GAME_Z);
    const count = Math.round(70 + chargeProgress * 60);
    const scale = 2.8 + chargeProgress * 1.2;
    this.particles.explode(pos, count, new THREE.Color(1.0, 0.55, 0.0), scale);
    this.debris.spawn(pos, new THREE.Color(1.0, 0.5, 0.0), Math.round(16 + chargeProgress * 8));
    this.music.playImpact();

    this._haptic(chargeProgress >= 0.95 ? 'heavy' : 'medium');
  }

  // ── Chain complete ──────────────────────────────────────────────────────────

  private _onChainComplete(chainCount: number): void {
    if (chainCount <= 0) return;

    // Tutorial: advance on step 4 when chain reaches 3+
    if (this.phase === 'tutorial') {
      if (this._tutStep === 4 && chainCount >= 3) this._advanceTutStep();
      return;
    }

    // Intensity multiplier: 1.0× at 0 quicken → 2.0× at max quicken
    const intensityMult = 1 + (this.quicken / EEE.MAX_QUICKEN);
    const bonus = Math.max(0, Math.round(calcChainScore(chainCount, this.timeRemaining) * intensityMult));
    const isNewMaxChain = chainCount > this.maxChain;
    this.score += bonus;
    if (isNewMaxChain) this.maxChain = chainCount;

    this._trackEvent('chain_resolved', {
      chain_length:             chainCount,
      score_gained:             bonus,
      bombs_remaining_after:    this.bombs,
      flux_level_when_triggered: this.quicken,
    });
    if (!this._firstChain) this._firstChain = true;

    // Milestone: 35+ chain
    if (chainCount >= 35) {
      this._trackEvent('milestone_reached', {
        name:              'long_chain',
        chain_length:      chainCount,
        enemies_destroyed: chainCount,
      });
    }

    this.hud.showChain(chainCount, bonus);

    // Extend check
    if (chainCount >= this.extendTarget) {
      this.bombs++;
      this._bombsEarnedSession++;
      const prevTarget = this.extendTarget;
      this.extendTarget += 2;
      this._trackEvent('bomb_earned', {
        chain_length_that_triggered_it: chainCount,
        bombs_remaining_after:          this.bombs,
        target_required:                prevTarget,
      });
      this.hud.showMessage('EXTRA BOMB GOAL! +1 BOMB', 2.0);
      this._haptic('success');
    } else {
      this._haptic(chainCount >= 5 ? 'heavy' : 'medium');
    }
  }

  // ── Pickup collected ────────────────────────────────────────────────────────

  private _onPickupCollected(type: PickupType, x: number, y: number): void {
    // Project pickup world-position to screen for fly-particle origin
    const ndc = new THREE.Vector3(x, y, ARENA.GAME_Z).project(this.camera);
    const sx  = (ndc.x + 1) * 0.5 * window.innerWidth;
    const sy  = (-ndc.y + 1) * 0.5 * window.innerHeight;

    switch (type) {
      case 'score':
        this.score += EEE.SCORE_PICKUP;
        this.hud.showMessage(`+${EEE.SCORE_PICKUP}`, 0.7);
        this.hud.spawnFlyParticles(sx, sy, 'score', '#15ff59', 12);
        this.music.playPickupScore();
        this._haptic('light');
        break;

      case 'quicken': {
        if (this.quicken < EEE.MAX_QUICKEN) {
          this.quicken++;
          this.enemies.setQuicken(this.quicken);
        }
        this.hud.showMessage(`+1 FLUX  [${this.quicken}/${EEE.MAX_QUICKEN}]`, 2.0);
        this.hud.spawnFlyParticles(sx, sy, 'quicken', '#33bbff', 22);
        this.hud.flashQuicken();
        this.hud.triggerIntenseFlash();
        this.tunnel.triggerQuickenFlash();
        this.music.playPickupQuicken();
        this._haptic('heavy');
        // Milestone: max flux level
        if (this.quicken >= EEE.MAX_QUICKEN) {
          const elapsed = Math.round((Date.now() - this._sessionStart) / 1000);
          this._trackEvent('milestone_reached', {
            name:             'maxed_flux_level',
            max_level:        this.quicken,
            session_duration: elapsed,
          });
        }
        break;
      }

      case 'time': {
        const timeBefore = this.timeRemaining;
        this.timeRemaining += EEE.TIME_BONUS;
        this._gemsThisSession++;
        this.hud.showMessage(`+${EEE.TIME_BONUS} SECONDS`, 0.9);
        this.hud.spawnFlyParticles(sx, sy, 'time', '#ff8c1a', 12);
        this.music.playPickupTime();
        this._haptic('light');
        this._trackEvent('gem_collected', {
          time_remaining_before: Math.round(timeBefore),
          time_remaining_after:  Math.round(this.timeRemaining),
          total_gems_this_session: this._gemsThisSession,
        });
        if (this.phase === 'tutorial' && this._tutStep === 5) this._advanceTutStep();
        break;
      }
    }
  }

  // ── Player hit ──────────────────────────────────────────────────────────────

  private _onPlayerHit(): void {
    if (this._invincibleTimer > 0 || this._respawnTimer > 0) return;
    if (this.bombs <= 0) return;
    if (this._hitFreezeTimer > 0) return;

    void this._trackEvent('player_hit', { quickenLevel: this.quicken });

    // Freeze world, trace player red, then detonate at minimum charge.
    // On mobile the CA glitch shader causes WebGL artifacts, and the longer freeze
    // feels like a lockup — use a very short freeze with no glitch effect.
    this._hitFreezeTimer = this._isMobile ? 0.15 : 0.55;
    this.quicken = Math.max(0, this.quicken - 1);
    this.enemies.setQuicken(this.quicken);
    this._shakeAmount = Math.max(this._shakeAmount, 5);
    if (!this._isMobile) this._glitchTimer = 0.35;
    this._haptic('heavy');
  }

  // ── Game over ───────────────────────────────────────────────────────────────

  private _die(): void {
    if (this.phase !== 'playing') return;
    this.music.updateChargeTone(0); // kill charge tone on death
    this.hud.clearForDeath();
    this.phase = 'dying';
    this._respawnTimer   = 10.0; // 10-second wind-down window
    this._hitFreezeTimer = 0;
    this._deathSlowmo    = 1.0;  // start at full speed, decay gradually to 0.06
    this._deathCamAngle  = 0;
    this._deathCamPos.copy(this.camera.position);
    this._deathLookAt.set(this._camX * 0.5, this._camY * 0.4, CAMERA.LOOK_Z);

    this._playerGroup.visible = false;
    this.chain.clearAll();
    this.enemies.clearBullets();
    this.enemies.startDeathWarp();
    this.pickups.startDeathWarp();
    this._gameOverLetterTimer    = 0;
    this._gameOverLetterIdx      = 0;
    this._gameOverAnimTime = 0;
    this._createDeathText();
    this.visualFx.onDeath();
    this.music.startDeathFilter(10.0); // squelch + reverb swell over 10 s
    // music.stop() happens when the game-over screen actually appears
    this.input.deactivate();

    const pos = new THREE.Vector3(this._px, this._py, ARENA.GAME_Z);
    this.particles.explode(pos, 130, new THREE.Color(1.0, 0.4, 0.1), 4);

    this._shakeAmount = Math.max(this._shakeAmount, 14);
    if (!this._isMobile) this._glitchTimer = 0.7;
    this._haptic('heavy');

    const dieElapsed = Math.round((Date.now() - this._sessionStart) / 1000);
    this._trackEvent('player_died', {
      cause:                      this._dieReason === 'time' ? 'timeout' : 'no_bombs_left',
      score_at_death:             this.score,
      survival_time_seconds:      dieElapsed,
      highest_chain_before_death: this.maxChain,
      quicken_level_when_died:    this.quicken,
    });

    void this._onGameOver();
  }

  private async _onGameOver(): Promise<void> {
    const duration = Math.round((Date.now() - this._sessionStart) / 1000);

    const isSuccess =
      duration >= 60 || this.maxChain >= 35 || this.quicken >= EEE.MAX_QUICKEN;

    this._trackEvent('game_ended', {
      cause:                this._dieReason === 'time' ? 'time_ran_out' : 'bombs_depleted',
      final_score:          this.score,
      survival_time_seconds: duration,
      bombs_remaining:      this.bombs,
      max_chain_achieved:   this.maxChain,
      gems_collected:       this._gemsThisSession,
      bombs_earned:         this._bombsEarnedSession,
    });

    this._trackEvent('attempt', {
      challenge:              'neon_flux_session',
      outcome:                isSuccess ? 'success' : 'fail',
      attempt_number:         this._gameCount,
      final_score:            this.score,
      survival_time_seconds:  duration,
      furthest_quicken_level: this.quicken,
      bombs_spent:            this._bombsSpentSession,
    });

    if (this.score > this._personalBest) {
      this._personalBest = this.score;
      this._pendingBest  = this.score;
      this._trackEvent('new_personal_best', { score: this.score });
      setPersonalBest(this.score);
      this._haptic('success');
      void writeCloudSave(this.score);
    } else {
      this._pendingBest = this._personalBest;
    }

    try {
      const result = await uploadScore(getLocalPlayerName(), this.score);
      if (result && result.rank != null) {
        this._pendingRank = `LEADERBOARD RANK #${result.rank}`;
      }
    } catch (err) {
      console.error('[NeonFlux] leaderboard_submit', err);
    }

    try {
      const { entries, myRank } = await getLeaderboard(10);
      this._pendingLeaderboard = entries.map(e => ({
        rank:     e.rank,
        username: e.username,
        score:    e.score,
        isPlayer: e.isCurrentUser,
      }));
      if (myRank && !entries.some(e => e.isCurrentUser)) {
        this._pendingLeaderboard.push({
          rank:     myRank.rank,
          username: getLocalPlayerName(),
          score:    myRank.score,
          isPlayer: true,
        });
      }
      this.hud.updateLeaderboard(this._pendingLeaderboard);
    } catch (err) {
      console.error('[NeonFlux] leaderboard_fetch', err);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async _fetchTitleLeaderboard(): Promise<void> {
    try {
      const { entries, myRank } = await getLeaderboard(10);
      const records: LeaderboardRecord[] = entries.map(e => ({
        rank:     e.rank,
        username: e.username,
        score:    e.score,
        isPlayer: e.isCurrentUser,
      }));
      if (myRank && !entries.some(e => e.isCurrentUser)) {
        records.push({
          rank:     myRank.rank,
          username: getLocalPlayerName(),
          score:    myRank.score,
          isPlayer: true,
        });
      }
      this.hud.showLeaderboardOverlay(records, false);
    } catch (err) {
      console.error('[NeonFlux] title_leaderboard_fetch', err);
    }
  }

  private _loadPersonalBest(): void {
    this._personalBest = getPersonalBest();
  }

  private _trackEvent(name: string, payload: Record<string, unknown>): void {
    try {
      window.emrg?.track(name, payload);
    } catch (e) {
      console.error('Analytics error:', e);
    }
  }

  private _haptic(style: 'light' | 'medium' | 'heavy' | 'success'): void {
    if (!this._hapticOk) return;
    const ms = style === 'heavy' || style === 'success' ? 50 : style === 'medium' ? 30 : 15;
    navigator.vibrate(ms);
  }

  private _createDeathText(): void {
    const { group, letters } = buildGameOverGroup();
    group.scale.setScalar(10); // scale block-letter units to world space
    this.scene.add(group);
    this._gameOverText    = group;
    this._gameOverLetters = letters;
  }

  private _computeBounds(): void {
    const camPos = this.camera.position;
    const MARGIN = 0.90; // 90% of visible area — slight inset so player doesn't go fully to edge
    const tmp = new THREE.Vector3();

    const worldAtGamePlane = (ndcX: number, ndcY: number) => {
      tmp.set(ndcX, ndcY, 0.5).unproject(this.camera);
      const dir = tmp.sub(camPos).normalize();
      const t   = (ARENA.GAME_Z - camPos.z) / dir.z;
      return { x: camPos.x + dir.x * t, y: camPos.y + dir.y * t };
    };

    const top   = worldAtGamePlane(0,  1);
    const bot   = worldAtGamePlane(0, -1);
    const right = worldAtGamePlane(1,  0);
    const left  = worldAtGamePlane(-1, 0);

    this._halfH = ((Math.abs(top.y) + Math.abs(bot.y)) / 2) * MARGIN;
    this._halfW = ((Math.abs(right.x) + Math.abs(left.x)) / 2) * MARGIN;
  }

  private _resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._computeBounds();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloomPass.resolution.set(w, h);
  }

  private _initPortals(): void {
    const px = this._halfW * 0.94;
    const py = this._halfH * 0.97;
    this._exitPortal = this._makePortal(-px, py);
    this.scene.add(this._exitPortal);

    // Preload exit-portal destination so the redirect feels instant
    const pre = document.createElement('iframe');
    pre.src = 'https://vibej.am/portal/2026';
    pre.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(pre);

    const qs = new URLSearchParams(window.location.search);
    if ((qs.get('portal') === 'true' || qs.get('portal') === '1') && qs.get('ref')) {
      this._startPortal = this._makePortal(px, py);
      this.scene.add(this._startPortal);
      // 5-second grace period so players don't accidentally teleport back
      setTimeout(() => { this._startPortalActive = true; }, 5000);
    }
  }

  private _makePortal(x: number, y: number): THREE.Group {
    const R     = 10;
    const group = new THREE.Group();
    group.position.set(x, y, ARENA.GAME_Z + 1);
    group.rotation.x = 0.35;

    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.95 });
    const discMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.22, side: THREE.DoubleSide });
    this._portalMats.push(ringMat, discMat);
    this._portalDiscMats.push(discMat);

    group.add(new THREE.Mesh(new THREE.TorusGeometry(R, 1.3, 16, 64), ringMat));
    group.add(new THREE.Mesh(new THREE.CircleGeometry(R - 0.3, 48), discMat));

    // Particle ring
    const pCount = 1000;
    const positions = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      const angle      = (i / pCount) * Math.PI * 2;
      const r          = R + (Math.random() - 0.5) * 3;
      positions[i * 3]     = Math.cos(angle) * r;
      positions[i * 3 + 1] = Math.sin(angle) * r;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
    }
    const initY = positions.slice();
    const attr  = new THREE.BufferAttribute(positions, 3);
    const pGeo  = new THREE.BufferGeometry();
    pGeo.setAttribute('position', attr);
    const pMat = new THREE.PointsMaterial({ color: 0x00ff88, size: 0.45, transparent: true, opacity: 0.75 });
    this._portalMats.push(pMat);
    this._portalPBufs.push({ init: initY, attr });
    group.add(new THREE.Points(pGeo, pMat));

    // "PORTAL" text baked into a canvas texture, rendered inside the disc
    const cv  = document.createElement('canvas');
    cv.width  = 256; cv.height = 64;
    const ctx = cv.getContext('2d')!;
    ctx.font         = 'bold 26px "Courier New", monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = '#ffffff';
    ctx.fillText('PORTAL', 128, 32);
    const textMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(R * 1.55, R * 0.38),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, side: THREE.DoubleSide }),
    );
    group.add(textMesh);

    return group;
  }

  private _tickPortals(dt: number): void {
    if (!this._exitPortal) return;

    const active = this.phase === 'playing' || this.phase === 'dying';
    this._exitPortal.visible = active;
    if (this._startPortal) this._startPortal.visible = active;

    this._portalHue = (this._portalHue + dt * 80) % 360;
    const col = new THREE.Color().setHSL(this._portalHue / 360, 1.0, 0.55);
    for (const mat of this._portalMats) mat.color = col;

    this._exitPortal.rotation.z += dt * 0.4;
    if (this._startPortal) this._startPortal.rotation.z -= dt * 0.4;

    // Animate particle positions with a sin wave
    const t = Date.now() * 0.001;
    for (const { init, attr } of this._portalPBufs) {
      const pos = attr.array as Float32Array;
      for (let i = 0; i < pos.length; i += 3) {
        pos[i + 1] = init[i + 1] + 0.5 * Math.sin(t + i);
      }
      attr.needsUpdate = true;
    }

    // Dim portal disc when player has no bombs (can't afford entry)
    const canAfford = this.bombs > 0;
    for (const dm of this._portalDiscMats) dm.opacity = canAfford ? 0.22 : 0.06;

    if (!active || this._portalTrig || !canAfford) return;

    const ex = Math.hypot(this._px - this._exitPortal.position.x, this._py - this._exitPortal.position.y);
    if (ex < R_PORTAL_TRIGGER) {
      this._portalTrig = true;
      this.bombs--;
      const params = new URLSearchParams(window.location.search);
      params.set('portal',   'true');
      params.set('ref',      window.location.hostname);
      params.set('username', getLocalPlayerName());
      params.set('color',    '00ffcc');
      window.location.href = 'https://vibej.am/portal/2026?' + params.toString();
      return;
    }

    if (this._startPortal && this._startPortalActive) {
      const sx = Math.hypot(this._px - this._startPortal.position.x, this._py - this._startPortal.position.y);
      if (sx < R_PORTAL_TRIGGER) {
        this._portalTrig = true;
        this.bombs--;
        const qs  = new URLSearchParams(window.location.search);
        const ref = qs.get('ref') ?? '';
        const url = /^https?:\/\//i.test(ref) ? ref : 'https://' + ref;
        qs.delete('ref');
        const s = qs.toString();
        window.location.href = url + (s ? '?' + s : '');
      }
    }
  }
}
