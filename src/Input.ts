// ─── InputManager (EEE Edition) ──────────────────────────────────────────────
// Controls for Every Extend Extra gameplay.
//
//   Desktop
//     WASD / Arrow keys  → move player
//     Space / F          → hold to charge, release → instant detonate
//                          hold ≥ CHARGE_TIME → charged detonation (auto-fires)
//
//   Mobile
//     Left joystick      → move player
//     Right fire button  → same charge / release mechanic

import { EEE } from './config';

const JOY_RADIUS   = 58;    // px max deflection

export interface EEEInputState {
  moveX:            number;   // -1 (left) to +1 (right)
  moveY:            number;   // -1 (down) to +1 (up)
  detonate:         boolean;  // one-shot: triggered this frame
  charged:          boolean;  // was it a charged detonation?
  chargeProgress:   number;   // 0-1 (for visual feedback while holding)
  detonateProgress: number;   // 0-1 captured at moment of release (for blast radius)
  isSlow:           boolean;  // true while charging (player moves at half speed)
}

export class InputManager {
  // Fire / detonate button state
  private _holdTime         = 0;
  private _isHolding        = false;
  private _detonateNow      = false;  // one-shot flag set when button is released
  private _wasCharged       = false;
  private _detonateProgress = 0;     // captured hold progress at moment of release

  // Activated only during gameplay
  private _active = false;

  // Mobile joystick
  private _joyTouchId = -1;
  private _joyOrigin  = { x: 0, y: 0 };
  private _joyDelta   = { x: 0, y: 0 };
  private _joyEl!:    HTMLElement;
  private _joyKnob!:  HTMLElement;

  // Mobile fire button
  private _fireTouchId = -1;
  private _fireBtn!:   HTMLElement;

  // Inverted Y-axis (mobile joystick only)
  private _invertY = localStorage.getItem('neon-flux-invert-y') === '1';

  get invertY(): boolean { return this._invertY; }
  set invertY(v: boolean) {
    this._invertY = v;
    localStorage.setItem('neon-flux-invert-y', v ? '1' : '0');
  }

  // Keyboard held keys
  private _keys = new Set<string>();

  constructor() {
    this._createMobileUI();
    this._bindKeyboard();
  }

  // ── Mobile UI ───────────────────────────────────────────────────────────────

  private _createMobileUI(): void {
    const app = document.getElementById('app') ?? document.body;

    // Left side: joystick
    const joyZone = document.createElement('div'); joyZone.id = 'joystick-zone';
    const pad     = document.createElement('div'); pad.id  = 'joystick-pad';
    const knob    = document.createElement('div'); knob.id = 'joystick-knob';
    pad.appendChild(knob);
    joyZone.appendChild(pad);
    this._joyEl   = pad;
    this._joyKnob = knob;
    app.appendChild(joyZone);

    // Right side: single DETONATE button
    const fireZone = document.createElement('div'); fireZone.id = 'fire-zone';
    const fireBtn  = document.createElement('div'); fireBtn.id  = 'fire-btn';
    fireBtn.innerHTML = '<span>⊕</span>';
    fireZone.appendChild(fireBtn);
    this._fireBtn = fireBtn;
    app.appendChild(fireZone);

    // ── Joystick events ────────────────────────────────────────────────────
    joyZone.addEventListener('touchstart', e => {
      e.preventDefault();
      if (this._joyTouchId !== -1) return;
      const t = e.changedTouches[0];
      this._joyTouchId = t.identifier;
      const rect = this._joyEl.getBoundingClientRect();
      this._joyOrigin.x = rect.left + rect.width  / 2;
      this._joyOrigin.y = rect.top  + rect.height / 2;
      this._updateJoyDelta(t.clientX, t.clientY);
    }, { passive: false });

    joyZone.addEventListener('touchmove', e => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === this._joyTouchId) this._updateJoyDelta(t.clientX, t.clientY);
      }
    }, { passive: false });

    const endJoy = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier !== this._joyTouchId) continue;
        this._joyTouchId = -1;
        this._joyDelta.x = 0;
        this._joyDelta.y = 0;
        this._joyKnob.style.transform = 'translate(-50%, -50%)';
      }
    };
    joyZone.addEventListener('touchend',    endJoy, { passive: true });
    joyZone.addEventListener('touchcancel', endJoy, { passive: true });

    // ── Fire button events ─────────────────────────────────────────────────
    fireZone.addEventListener('touchstart', e => {
      e.preventDefault();
      if (!this._active) return;
      const t = e.changedTouches[0];
      if (this._fireTouchId !== -1) return;
      this._fireTouchId = t.identifier;
      this._isHolding   = true;
      fireBtn.classList.add('charging');
    }, { passive: false });

    const endFire = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier !== this._fireTouchId) continue;
        this._fireTouchId = -1;
        if (this._isHolding) {
          this._detonateProgress = Math.min(1, this._holdTime / EEE.CHARGE_TIME);
          this._detonateNow = true;
          this._wasCharged  = false;
        }
        this._isHolding = false;
        fireBtn.classList.remove('charging');
      }
    };
    fireZone.addEventListener('touchend',    endFire, { passive: true });
    fireZone.addEventListener('touchcancel', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier !== this._fireTouchId) continue;
        this._fireTouchId = -1;
        this._isHolding   = false;
        fireBtn.classList.remove('charging');
      }
    }, { passive: true });
  }

  private _updateJoyDelta(cx: number, cy: number): void {
    let dx = cx - this._joyOrigin.x;
    let dy = cy - this._joyOrigin.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > JOY_RADIUS) { dx = dx / len * JOY_RADIUS; dy = dy / len * JOY_RADIUS; }
    this._joyDelta.x = dx / JOY_RADIUS;
    this._joyDelta.y = dy / JOY_RADIUS;
    this._joyKnob.style.transform =
      `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  // ── Keyboard ────────────────────────────────────────────────────────────────

  private _bindKeyboard(): void {
    window.addEventListener('keydown', e => {
      this._keys.add(e.code);

      if ((e.code === 'Space' || e.code === 'KeyF') && !e.repeat && this._active) {
        if (!this._isHolding) {
          this._isHolding  = true;
        }
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', e => {
      this._keys.delete(e.code);

      if ((e.code === 'Space' || e.code === 'KeyF') && this._active) {
        if (this._isHolding) {
          this._detonateProgress = Math.min(1, this._holdTime / EEE.CHARGE_TIME);
          this._detonateNow = true;
          this._wasCharged  = false;
        }
        this._isHolding = false;
        e.preventDefault();
      }
    });
  }

  // ── Update (call once per frame) ────────────────────────────────────────────

  update(dt: number): EEEInputState {
    // Keyboard movement
    let kx = 0, ky = 0;
    if (this._keys.has('ArrowLeft')  || this._keys.has('KeyA')) kx -= 1;
    if (this._keys.has('ArrowRight') || this._keys.has('KeyD')) kx += 1;
    if (this._keys.has('ArrowUp')    || this._keys.has('KeyW')) ky += 1;
    if (this._keys.has('ArrowDown')  || this._keys.has('KeyS')) ky -= 1;

    // Normalise diagonal
    if (kx !== 0 && ky !== 0) { kx *= 0.707; ky *= 0.707; }

    // Combine keyboard + joystick (joystick Y is flipped: down-drag = negative world Y)
    const moveX = kx !== 0 ? kx : this._joyDelta.x;
    const joyY  = -this._joyDelta.y;  // screen-down → world-up
    const moveY = ky !== 0 ? ky : (this._invertY ? -joyY : joyY);

    // Charge accumulation — clamps at 1.0 and holds until released
    let chargeProgress = 0;
    if (this._isHolding && this._active) {
      this._holdTime += dt;
      chargeProgress = Math.min(1, this._holdTime / EEE.CHARGE_TIME);
    } else if (!this._isHolding) {
      this._holdTime = 0;
    }

    // Read + clear one-shot flags
    const detonate         = this._detonateNow;
    const charged          = this._wasCharged;
    const detonateProgress = detonate ? this._detonateProgress : 0;
    this._detonateNow = false;
    this._wasCharged  = false;

    const isSlow = this._isHolding && chargeProgress > 0.05;

    // Update mobile fire button visual intensity
    if (this._fireBtn) {
      if (isSlow) {
        const glow = chargeProgress;
        this._fireBtn.style.setProperty('--charge', String(glow));
      }
    }

    return { moveX, moveY, detonate, charged, chargeProgress, detonateProgress, isSlow };
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  activate(): void {
    this._active      = true;
    this._isHolding   = false;
    this._detonateNow = false;
    this._wasCharged  = false;
    this._holdTime    = 0;
    // Reset touch IDs so any touch held during a previous phase (e.g. tutorial)
    // doesn't block new input in the game.
    this._fireTouchId = -1;
    this._joyTouchId  = -1;
    this._joyDelta.x  = 0;
    this._joyDelta.y  = 0;
    if (this._joyKnob) this._joyKnob.style.transform = 'translate(-50%, -50%)';
    if (this._fireBtn) this._fireBtn.classList.remove('charging');
    document.getElementById('app')?.classList.add('controls-active');
  }

  deactivate(): void {
    this._active      = false;
    this._isHolding   = false;
    this._detonateNow = false;
    this._holdTime    = 0;
    document.getElementById('app')?.classList.remove('controls-active');
  }

  /** Cancel any in-progress charge without firing. Used after a forced detonate on hit. */
  clearHold(): void {
    this._isHolding   = false;
    this._holdTime    = 0;
    this._fireTouchId = -1;
    if (this._fireBtn) this._fireBtn.classList.remove('charging');
  }

  // ── Cursor compat (unused in EEE, kept for call-site safety) ────────────────
  get cursor(): { x: number; y: number } { return { x: 0.5, y: 0.5 }; }
  drawJoystick(): void {}
}
