// ─── HUD (EEE Edition) ───────────────────────────────────────────────────────
// HTML overlay for Every Extend Extra gameplay display.
//
// Shows: score, timer, bombs (lives), quicken, max chain, extend target,
//        detonation charge ring, chain announcements, floating messages.

import { EEE } from './config';
import { NeonFluxLogo } from './NeonFluxLogo';
import { GameOverLogo } from './GameOverLogo';
import { downloadBundle } from './GameBundle';
import {
  getLocalPlayerName,
  setLocalPlayerName,
  getRecoveryCode,
  recoverSave,
} from './platform';

export interface LeaderboardRecord {
  rank:     number;
  username: string;
  score:    number;
  isPlayer: boolean;
}

export class HUD {
  private elScore:    HTMLElement;
  private elTimer:    HTMLElement;
  private elBombs:    HTMLElement;
  private elQuicken:  HTMLElement;
  private elChain:    HTMLElement;
  private elExtend:   HTMLElement;
  private elMessage:  HTMLElement;
  private elOverlay:  HTMLElement;

  // Charge ring canvas
  private chargeCanvas: HTMLCanvasElement;
  private chargeCtx:    CanvasRenderingContext2D;

  private readonly _onMusicVol:  (v: number)  => void;
  private readonly _onSfxVol:    (v: number)  => void;
  private readonly _onInvertY:   (v: boolean) => void;
  private _settingsOpen   = false;
  private _lbMode         = false; // true while leaderboard overlay is shown from title
  private _msgTimer     = 0;
  private _msgFullText  = '';
  private _msgCharCount = 0;
  private _msgCharTimer = 0;
  private _msgPhase: 'in' | 'hold' | 'out' | 'idle' = 'idle';
  private _msgVisSpan!: HTMLSpanElement;
  private _msgHidSpan!: HTMLSpanElement;
  private readonly MSG_CHAR_SPEED = 0.03; // seconds per character
  private _chainTimer   = 0;
  private _chainText    = '';
  private _chainColor   = '#ffffff';
  private _lastScore    = -1;
  private _tick         = 0;
  private _intenseFlash = 0; // 1→0 on INTENSE! pickup, synced with tunnel flash

  private _lastBombFlashTimer = 0;
  private _lastBombFlashOn    = false;
  private _lastBombBeepCb: (() => void) | null = null;

  private _timerFlashTimer = 0;
  private _timerFlashOn    = false;
  private _tenSecBeepCb: (() => void) | null = null;

  private _logoNeon: NeonFluxLogo | null = null;
  private _logoFlux: NeonFluxLogo | null = null;
  private _logoRaf  = 0;
  private _logoT    = 0;
  private _gameOverLogo: GameOverLogo | null = null;

  setLastBombBeepCb(cb: () => void): void { this._lastBombBeepCb = cb; }
  setTenSecBeepCb(cb: () => void): void   { this._tenSecBeepCb   = cb; }

  // Fly-to particles (pickup → HUD element)
  private _flyParticles: Array<{
    sx: number; sy: number; tx: number; ty: number; t: number; color: string;
  }> = [];

  constructor(
    onMusicVol: (v: number)  => void = () => {},
    onSfxVol:   (v: number)  => void = () => {},
    onInvertY:  (v: boolean) => void = () => {},
  ) {
    this._onMusicVol = onMusicVol;
    this._onSfxVol   = onSfxVol;
    this._onInvertY  = onInvertY;

    // Load saved volumes and apply immediately
    const initMusicVol = Math.max(0, Math.min(1, parseFloat(localStorage.getItem('aaa-music-vol') ?? '1')));
    const initSfxVol   = Math.max(0, Math.min(1, parseFloat(localStorage.getItem('aaa-sfx-vol')   ?? '1')));
    this._onMusicVol(initMusicVol);
    this._onSfxVol(initSfxVol);

    const app = document.getElementById('app')!;

    // Charge ring canvas (full-screen, drawn every frame)
    this.chargeCanvas = document.createElement('canvas');
    this.chargeCanvas.id = 'charge-canvas';
    this.chargeCanvas.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;';
    app.appendChild(this.chargeCanvas);
    this.chargeCtx = this.chargeCanvas.getContext('2d')!;

    // HUD layer
    const hud = this._el('div', { id: 'hud' });

    this.elScore   = this._el('div', { id: 'hud-score',   textContent: '0000000' });
    this.elTimer   = this._el('div', { id: 'hud-timer',   textContent: '1:00' });
    this.elBombs   = this._el('div', { id: 'hud-bombs' });
    this.elQuicken = this._el('div', { id: 'hud-quicken' });
    this.elChain   = this._el('div', { id: 'hud-chain' });
    this.elChain.style.opacity = '0';
    this.elExtend  = this._el('div', { id: 'hud-extend',  textContent: 'EXTEND: —' });
    this.elMessage = this._el('div', { id: 'hud-message' });
    this.elMessage.style.opacity = '0';
    this._msgVisSpan = document.createElement('span');
    this._msgHidSpan = document.createElement('span');
    this._msgHidSpan.style.cssText = 'color:transparent;text-shadow:none;';
    this.elMessage.appendChild(this._msgVisSpan);
    this.elMessage.appendChild(this._msgHidSpan);

    hud.appendChild(this.elScore);
    hud.appendChild(this.elTimer);
    hud.appendChild(this.elBombs);
    hud.appendChild(this.elQuicken);
    hud.appendChild(this.elChain);
    hud.appendChild(this.elExtend);
    hud.appendChild(this.elMessage);
    app.appendChild(hud);

    // Overlay
    this.elOverlay = this._el('div', { id: 'overlay' });
    app.appendChild(this.elOverlay);

    // Settings gear + panel
    this._buildSettings(app, initMusicVol, initSfxVol, localStorage.getItem('neon-flux-invert-y') === '1');

    this._showTitle();
  }

  // ── Per-frame update ───────────────────────────────────────────────────────

  update(
    score:          number,
    timeRemaining:  number,
    bombs:          number,
    quicken:        number,
    extendTarget:   number,
    chargeProgress: number,  // 0-1
    playerScreenX:  number,  // px for charge ring
    playerScreenY:  number,
    blastRadiusPx:  number,  // screen-space radius of actual blast preview
    dt:             number,
  ): void {
    this._chainTimer -= dt;

    // Typewriter: type in → hold → type out
    this._msgCharTimer += dt;
    if (this._msgPhase === 'in') {
      while (this._msgCharTimer >= this.MSG_CHAR_SPEED && this._msgCharCount < this._msgFullText.length) {
        this._msgCharTimer -= this.MSG_CHAR_SPEED;
        this._msgCharCount++;
        this._msgVisSpan.textContent = this._msgFullText.slice(0, this._msgCharCount);
        this._msgHidSpan.textContent = this._msgFullText.slice(this._msgCharCount);
      }
      if (this._msgCharCount >= this._msgFullText.length) {
        this._msgPhase = 'hold';
        this._msgCharTimer = 0;
      }
    } else if (this._msgPhase === 'hold') {
      this._msgTimer -= dt;
      if (this._msgTimer <= 0) { this._msgPhase = 'out'; this._msgCharTimer = 0; }
    } else if (this._msgPhase === 'out') {
      while (this._msgCharTimer >= this.MSG_CHAR_SPEED && this._msgCharCount > 0) {
        this._msgCharTimer -= this.MSG_CHAR_SPEED;
        this._msgCharCount--;
        this._msgVisSpan.textContent = this._msgFullText.slice(0, this._msgCharCount);
        this._msgHidSpan.textContent = this._msgFullText.slice(this._msgCharCount);
      }
      if (this._msgCharCount <= 0) {
        this._msgPhase = 'idle';
        this.elMessage.style.opacity = '0';
      }
    }

    // Chain text: hold bright, then fade out over the last 1.2 s with expanding glow (afterimage)
    if (this._chainTimer <= 0) {
      this.elChain.style.opacity    = '0';
      this.elChain.style.textShadow = `0 0 20px ${this._chainColor}`;
    } else {
      const FADE_WIN = 1.2;
      if (this._chainTimer < FADE_WIN) {
        const t      = this._chainTimer / FADE_WIN;          // 1 → 0 as it expires
        const glow   = Math.round(20 + (1 - t) * 60);       // shadow blooms out: 20 → 80 px
        this.elChain.style.opacity    = String(Math.pow(t, 0.6).toFixed(3));
        this.elChain.style.textShadow = `0 0 ${glow}px ${this._chainColor}, 0 0 ${glow * 2}px ${this._chainColor}`;
      }
    }

    // Draw charge ring + fly particles every frame (no throttle)
    this._drawCharge(chargeProgress, playerScreenX, playerScreenY, blastRadiusPx);
    this._drawFlyParticles(dt);

    // 10-second countdown flash + beep — takes precedence over last-bomb beep
    const lowTime = timeRemaining > 0 && timeRemaining < 10;
    if (lowTime) {
      this._timerFlashTimer -= dt;
      if (this._timerFlashTimer <= 0) {
        this._timerFlashOn    = !this._timerFlashOn;
        this._timerFlashTimer = 0.5;
        if (this._timerFlashOn) this._tenSecBeepCb?.();
      }
    } else {
      this._timerFlashTimer = 0;
      this._timerFlashOn    = false;
    }

    // Last-bomb flash + beep (every 0.35 s while exactly 1 bomb remains)
    // Suppressed when the 10-second timer beep has precedence
    if (bombs === 1) {
      this._lastBombFlashTimer -= dt;
      if (this._lastBombFlashTimer <= 0) {
        this._lastBombFlashOn = !this._lastBombFlashOn;
        this._lastBombFlashTimer = 0.35;
        if (this._lastBombFlashOn && !lowTime) this._lastBombBeepCb?.();
      }
    } else {
      this._lastBombFlashTimer = 0;
      this._lastBombFlashOn    = false;
    }

    // Throttle DOM updates
    this._tick += dt;
    if (this._tick < 0.05) return;
    this._tick = 0;

    // Score
    if (score !== this._lastScore) {
      this._lastScore = score;
      this.elScore.textContent = score.toString().padStart(7, '0');
    }

    // Timer
    const secs   = Math.max(0, timeRemaining);
    const m      = Math.floor(secs / 60);
    const s      = Math.floor(secs % 60);
    this.elTimer.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    this.elTimer.style.color =
      secs < 10 ? '#ff2200' : secs < 20 ? '#ffcc00' : '#00ffcc';
    this.elTimer.style.textShadow =
      secs < 10 ? '0 0 16px #ff2200' : secs < 20 ? '0 0 12px #ffcc00' : '0 0 8px #00ffcc';
    this.elTimer.classList.toggle('timer-flash-on', this._timerFlashOn);

    // Bombs
    this._renderBombs(bombs);

    // Quicken
    this._renderQuicken(quicken);

    // Extend
    this.elExtend.style.visibility = 'visible';
    this.elExtend.textContent = extendTarget > 0 ? `EXTRA BOMB GOAL ×${extendTarget}` : 'EXTRA BOMB GOAL ×—';
  }

  // ── Chain announcement ────────────────────────────────────────────────────

  showChain(chainCount: number, bonus: number): void {
    if (chainCount <= 0) return;
    this._chainText  = `CHAIN ${chainCount}  +${bonus}`;
    this._chainTimer = 3.0;
    this._chainColor =
      chainCount >= 10 ? '#ff4400'  :
      chainCount >= 5  ? '#ffaa00'  :
      chainCount >= 3  ? '#ffff00'  : '#ffffff';
    this.elChain.textContent = this._chainText;
    this.elChain.style.color       = this._chainColor;
    this.elChain.style.textShadow  = `0 0 20px ${this._chainColor}`;
    this.elChain.style.opacity     = '1';
  }

  /** Hide all HUD elements except the score — call when the player dies. */
  clearForDeath(): void {
    // Chain announcement
    this._chainTimer = 0;
    this.elChain.style.opacity = '0';

    // Floating message
    this._msgPhase = 'idle';
    this._msgVisSpan.textContent = '';
    this._msgHidSpan.textContent = '';
    this.elMessage.style.opacity = '0';

    // Timer, bombs, extend, quicken
    this.elTimer.classList.remove('hud-flash-danger', 'timer-flash-on');
    this._timerFlashTimer = 0;
    this._timerFlashOn    = false;
    this.elBombs.classList.remove('hud-flash-danger');
    this.elTimer.style.opacity   = '0';
    this.elBombs.style.opacity   = '0';
    this.elExtend.style.opacity  = '0';
    this.elQuicken.style.opacity = '0';

    // Clear charge ring canvas
    const W = this.chargeCanvas.width;
    const H = this.chargeCanvas.height;
    this.chargeCtx.clearRect(0, 0, W, H);
  }

  /** Restore all in-game HUD elements to visible — call at the start of every new game. */
  showForGame(): void {
    this.elBombs.style.opacity   = '1';
    this.elTimer.style.opacity   = '1';
    this.elExtend.style.opacity  = '1';
    this.elQuicken.style.opacity = '1';
  }

  /** Flash the bombs or timer element red to signal what ended the game. */
  flashDanger(which: 'bombs' | 'time'): void {
    const el = which === 'time' ? this.elTimer : this.elBombs;
    el.classList.add('hud-flash-danger');
  }

  showMessage(text: string, duration = 1.4): void {
    this._msgFullText  = text;
    this._msgCharCount = 0;
    this._msgCharTimer = 0;
    this._msgTimer     = duration;
    this._msgPhase     = 'in';
    this._msgVisSpan.textContent = '';
    this._msgHidSpan.textContent = this._msgFullText;
    this.elMessage.style.opacity = '1';
  }

  /** Floating "+N" score popup at a screen position (for per-kill bonuses). */
  showKillScore(amount: number, sx: number, sy: number): void {
    const el = document.createElement('div');
    el.className   = 'kill-score';
    el.textContent = `+${amount}`;
    el.style.left  = `${sx}px`;
    el.style.top   = `${sy}px`;
    (document.getElementById('app') ?? document.body).appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }

  // ── Overlay screens ────────────────────────────────────────────────────────

  private _showTitle(): void {
    // Tear down any previous logo instances and shared loop before rebuilding
    if (this._logoRaf) { cancelAnimationFrame(this._logoRaf); this._logoRaf = 0; }
    this._logoT = 0;
    if (this._logoNeon) { this._logoNeon.dispose(); this._logoNeon = null; }
    if (this._logoFlux) { this._logoFlux.dispose(); this._logoFlux = null; }

    this._lbMode = false;
    this.elExtend.style.visibility = 'hidden';
    this.elOverlay.classList.add('title-mode');

    const existingName   = getLocalPlayerName();
    const recoveryCode   = getRecoveryCode();

    this.elOverlay.innerHTML = `
      <div class="neon-flux-logo-wrap" id="neon-flux-logo-mount">
        <div id="neon-word-mount"></div>
        <div id="flux-word-mount"></div>
      </div>
      <div style="flex:1"></div>
      <div class="title-ship-wrap">
        <img class="title-ship" src="./ship.png" alt="">
        <!-- upper exhaust -->
        <span class="jet-core" style="width:13px;height:13px;left:calc(15% - 8px);top:calc(59% + 1px);animation-delay:0s;"></span>
        <span class="jet-p" style="width:11px;height:11px;left:calc(15% - 8px);top:calc(59% + 1px);animation-delay:0.00s;"></span>
        <span class="jet-p" style="width:9px; height:9px; left:calc(15% - 8px);top:calc(59% + 1px);animation-delay:0.07s;"></span>
        <span class="jet-p" style="width:8px; height:8px; left:calc(15% - 8px);top:calc(59% + 1px);animation-delay:0.14s;"></span>
        <span class="jet-p" style="width:7px; height:7px; left:calc(15% - 8px);top:calc(59% + 1px);animation-delay:0.21s;"></span>
        <span class="jet-p" style="width:6px; height:6px; left:calc(15% - 8px);top:calc(59% + 1px);animation-delay:0.28s;"></span>
        <span class="jet-p" style="width:5px; height:5px; left:calc(15% - 8px);top:calc(59% + 1px);animation-delay:0.35s;"></span>
        <span class="jet-p" style="width:4px; height:4px; left:calc(15% - 8px);top:calc(59% + 1px);animation-delay:0.42s;"></span>
        <span class="jet-p" style="width:3px; height:3px; left:calc(15% - 8px);top:calc(59% + 1px);animation-delay:0.49s;"></span>
        <!-- lower exhaust -->
        <span class="jet-core" style="width:12px;height:12px;left:29%;top:calc(75% + 8px);animation-delay:0.14s;"></span>
        <span class="jet-p-r" style="width:10px;height:10px;left:29%;top:calc(75% + 8px);animation-delay:0.04s;"></span>
        <span class="jet-p-r" style="width:8px; height:8px; left:29%;top:calc(75% + 8px);animation-delay:0.11s;"></span>
        <span class="jet-p-r" style="width:7px; height:7px; left:29%;top:calc(75% + 8px);animation-delay:0.18s;"></span>
        <span class="jet-p-r" style="width:6px; height:6px; left:29%;top:calc(75% + 8px);animation-delay:0.25s;"></span>
        <span class="jet-p-r" style="width:5px; height:5px; left:29%;top:calc(75% + 8px);animation-delay:0.32s;"></span>
        <span class="jet-p-r" style="width:4px; height:4px; left:29%;top:calc(75% + 8px);animation-delay:0.39s;"></span>
        <span class="jet-p-r" style="width:3px; height:3px; left:29%;top:calc(75% + 8px);animation-delay:0.46s;"></span>
        <span class="jet-p-r" style="width:2px; height:2px; left:29%;top:calc(75% + 8px);animation-delay:0.53s;"></span>
      </div>
      <div style="flex:1"></div>
      <div class="subtitle">CHAIN · REACT · SURVIVE</div>
      <div class="player-setup">
        <input id="player-name-input" type="text" maxlength="18" autocomplete="off"
          spellcheck="false" placeholder="YOUR NAME"
          value="${existingName.replace(/"/g, '&quot;')}">
        <div class="player-code-row">
          <span class="pc-label">SAVE CODE</span>
          <span id="player-rc" title="Write this down to recover your score on another device">${recoveryCode}</span>
          <button id="btn-copy-rc" title="Copy to clipboard">⎘</button>
        </div>
      </div>
      <button id="btn-start">ENGAGE</button>
      <button id="btn-how" style="border-color:#00ffcc55;color:#00ffcc88;text-shadow:none;box-shadow:none;font-size:clamp(9px,2.2vw,12px);">HOW TO PLAY</button>
      <button id="btn-lb" style="border-color:#4488ff;color:#4488ff;text-shadow:0 0 8px #4488ff;box-shadow:0 0 12px rgba(68,136,255,0.3);">LEADERBOARD</button>
      <button id="btn-recover" style="border-color:#ff880044;color:#ff880088;text-shadow:none;box-shadow:none;font-size:clamp(9px,2.2vw,12px);">RECOVER SAVE</button>
    `;
    this.elOverlay.classList.remove('hidden');

    // Mount NEON and FLUX as separate canvases so each gets its own CSS glow
    const neonMount = this.elOverlay.querySelector('#neon-word-mount') as HTMLElement | null;
    const fluxMount = this.elOverlay.querySelector('#flux-word-mount') as HTMLElement | null;
    if (neonMount && fluxMount) {
      this._logoNeon = new NeonFluxLogo('neon');
      this._logoFlux = new NeonFluxLogo('flux');
      neonMount.appendChild(this._logoNeon.canvas);
      fluxMount.appendChild(this._logoFlux.canvas);
      // Defer measurement by one frame so CSS layout (incl. media queries) has settled
      requestAnimationFrame(() => {
        ([
          [this._logoNeon, neonMount],
          [this._logoFlux, fluxMount],
        ] as [NeonFluxLogo | null, HTMLElement][]).forEach(([logo, el]) => {
          if (!logo) return;
          const rect = el.getBoundingClientRect();
          logo.resize(Math.max(rect.width, 180), Math.max(rect.height, 52));
        });
        // Single shared loop drives both logos at identical time → locked motion
        const drive = () => {
          this._logoRaf = requestAnimationFrame(drive);
          this._logoT += 0.008;
          this._logoNeon?.renderAtTime(this._logoT);
          this._logoFlux?.renderAtTime(this._logoT);
        };
        drive();
      });
    }

    window.dispatchEvent(new CustomEvent('game:show-title'));

    // Save name on every keystroke so it persists immediately
    const nameInput = this.elOverlay.querySelector('#player-name-input') as HTMLInputElement | null;
    if (nameInput) {
      nameInput.addEventListener('input', () => setLocalPlayerName(nameInput.value));
      nameInput.addEventListener('blur',  () => setLocalPlayerName(nameInput.value));
    }

    // Copy recovery code to clipboard
    const copyBtn = this.elOverlay.querySelector('#btn-copy-rc') as HTMLButtonElement | null;
    if (copyBtn) {
      const doCopy = () => {
        const code = (this.elOverlay.querySelector('#player-rc') as HTMLElement)?.textContent || '';
        navigator.clipboard?.writeText(code).catch(() => {});
        copyBtn.textContent = '✓';
        setTimeout(() => { copyBtn.textContent = '⎘'; }, 1200);
      };
      copyBtn.addEventListener('click', doCopy);
      copyBtn.addEventListener('touchend', (e) => { e.preventDefault(); doCopy(); }, { passive: false });
    }

    this._wireBtnWithNameSave('#btn-start');
    const howBtn = this.elOverlay.querySelector('#btn-how')!;
    const openHow = () => window.dispatchEvent(new CustomEvent('game:tutorial-start'));
    howBtn.addEventListener('click', openHow);
    howBtn.addEventListener('touchend', (e) => { e.preventDefault(); openHow(); }, { passive: false });
    const lbBtn = this.elOverlay.querySelector('#btn-lb')!;
    const openLb = () => window.dispatchEvent(new CustomEvent('game:leaderboard'));
    lbBtn.addEventListener('click', openLb);
    lbBtn.addEventListener('touchend', (e) => { e.preventDefault(); openLb(); }, { passive: false });
    const recoverBtn = this.elOverlay.querySelector('#btn-recover')!;
    const openRecover = () => this._showRecoverModal();
    recoverBtn.addEventListener('click', openRecover);
    recoverBtn.addEventListener('touchend', (e) => { e.preventDefault(); openRecover(); }, { passive: false });

    // Secret cheat menu: tap the ship 5 times within 3 seconds
    const shipWrap = this.elOverlay.querySelector('.title-ship-wrap') as HTMLElement | null;
    if (shipWrap) {
      let tapCount = 0;
      let tapTimeout: ReturnType<typeof setTimeout> | null = null;
      const onShipTap = () => {
        tapCount++;
        if (tapTimeout) clearTimeout(tapTimeout);
        tapTimeout = setTimeout(() => { tapCount = 0; }, 3000);
        if (tapCount >= 5) {
          tapCount = 0;
          if (tapTimeout) { clearTimeout(tapTimeout); tapTimeout = null; }
          this._openCheatMenu();
        }
      };
      shipWrap.addEventListener('click', onShipTap);
      shipWrap.addEventListener('touchend', (e) => { e.preventDefault(); onShipTap(); }, { passive: false });
    }
  }

  showLeaderboardOverlay(entries: LeaderboardRecord[], loading: boolean): void {
    if (!loading) {
      // Update in-place if still showing
      if (!this._lbMode) return;
      const placeholder = this.elOverlay.querySelector('#title-lb-loading');
      if (placeholder) {
        const tmp = document.createElement('div');
        tmp.innerHTML = this._renderLeaderboard(entries);
        placeholder.replaceWith(tmp.firstElementChild!);
      }
      return;
    }
    this._lbMode = true;
    this.elOverlay.classList.remove('title-mode');
    this.elOverlay.innerHTML = `
      <div class="subtitle" style="letter-spacing:6px;margin-bottom:14px;">TOP SCORES</div>
      <div id="title-lb-loading" class="lb-loading">FETCHING SCORES\u2026</div>
      <button id="btn-back">BACK</button>
    `;
    this.elOverlay.classList.remove('hidden');
    const back = this.elOverlay.querySelector('#btn-back')!;
    const goBack = () => this._showTitle();
    back.addEventListener('click', goBack);
    back.addEventListener('touchend', (e) => { e.preventDefault(); goBack(); }, { passive: false });
  }

  showGameOver(score: number, maxChain: number, personalBest = 0, rank = '', leaderboard: LeaderboardRecord[] = []): void {
    const pbLine = (personalBest > 0 && score >= personalBest)
      ? '<div class="subtitle" style="color:#ffcc00;text-shadow:0 0 12px #ffcc00;">★ NEW PERSONAL BEST ★</div>'
      : personalBest > 0
        ? `<div class="subtitle" style="font-size:clamp(10px,2.5vw,12px);color:#4488ff88;">BEST: ${personalBest.toString().padStart(7, '0')}</div>`
        : '';

    const rankLine = rank
      ? `<div class="subtitle" style="font-size:clamp(10px,2.5vw,12px);color:#4488ff88;">${rank}</div>`
      : '';

    const lbHtml = leaderboard.length
      ? this._renderLeaderboard(leaderboard)
      : '<div id="lb-loading" class="lb-loading">FETCHING SCORES\u2026</div>';

    this.elOverlay.classList.remove('title-mode');
    this.elOverlay.innerHTML = `
      <div id="game-over-logo-mount" class="neon-flux-logo-wrap"></div>
      <div class="final-score">${score.toString().padStart(7, '0')}</div>
      <div class="subtitle">MAX CHAIN: ${maxChain}</div>
      ${pbLine}
      ${rankLine}
      ${lbHtml}
      <button id="btn-restart">TRY AGAIN</button>
      <button id="btn-go-lb" style="border-color:#4488ff;color:#4488ff;text-shadow:0 0 8px #4488ff;box-shadow:0 0 12px rgba(68,136,255,0.3);">LEADERBOARD</button>
    `;
    this.elOverlay.classList.remove('hidden');

    // Mount the 3D GAME OVER logo
    const goMount = this.elOverlay.querySelector('#game-over-logo-mount') as HTMLElement | null;
    if (goMount) {
      this._gameOverLogo = new GameOverLogo();
      goMount.appendChild(this._gameOverLogo.canvas);
      const rect = goMount.getBoundingClientRect();
      this._gameOverLogo.resize(Math.max(rect.width, 240), Math.max(rect.height, 110));
      this._gameOverLogo.start();
    }

    this._wireBtn('#btn-restart');
    const lbBtn = this.elOverlay.querySelector('#btn-go-lb')!;
    const openLb = () => window.dispatchEvent(new CustomEvent('game:leaderboard'));
    lbBtn.addEventListener('click', openLb);
    lbBtn.addEventListener('touchend', (e) => { e.preventDefault(); openLb(); }, { passive: false });
  }

  /** Call once leaderboard data has loaded — updates the overlay if it's still showing. */
  updateLeaderboard(entries: LeaderboardRecord[]): void {
    if (!entries.length) return;
    const placeholder = this.elOverlay.querySelector('#lb-loading');
    const existing    = this.elOverlay.querySelector('#game-leaderboard');
    const target      = placeholder ?? existing;
    if (!target) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = this._renderLeaderboard(entries);
    const replacement = tmp.firstElementChild;
    if (replacement) target.replaceWith(replacement);
  }

  hideOverlay(): void {
    this.elOverlay.classList.add('hidden');
    if (this._logoRaf) { cancelAnimationFrame(this._logoRaf); this._logoRaf = 0; }
    if (this._logoNeon) { this._logoNeon.dispose(); this._logoNeon = null; }
    if (this._logoFlux) { this._logoFlux.dispose(); this._logoFlux = null; }
    if (this._gameOverLogo) { this._gameOverLogo.dispose(); this._gameOverLogo = null; }
    document.getElementById('cheat-menu')?.remove();
  }

  showTitle(): void { this._showTitle(); }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _renderBombs(bombs: number): void {
    let html = '<span class="hud-label">BOMBS</span> ';
    for (let i = 0; i < EEE.START_BOMBS; i++) {
      const isActive = i < bombs;
      const isLast   = bombs === 1 && i === 0;
      const flashCls = isLast && this._lastBombFlashOn ? ' flash-on' : '';
      html += `<span class="bomb-icon${isActive ? ' active' : ''}${isLast ? ' last-bomb' : ''}${flashCls}">◆</span>`;
    }
    this.elBombs.innerHTML = html;
  }

  private _renderQuicken(q: number): void {
    let html = '<span class="hud-label">FLUX</span> ';
    for (let i = 0; i < EEE.MAX_QUICKEN; i++) {
      html += `<span class="qk-arrow${i < q ? ' active' : ''}">↑</span>`;
    }
    this.elQuicken.innerHTML = html;
  }

  /** Spawn glowing dots that fly from a world-projected pickup position to the relevant HUD element. */
  spawnFlyParticles(
    fromX: number, fromY: number,
    target: 'score' | 'time' | 'quicken',
    color: string,
    count: number,
  ): void {
    const el   = target === 'score' ? this.elScore : target === 'time' ? this.elTimer : this.elQuicken;
    const rect = el.getBoundingClientRect();
    const tx   = rect.left + rect.width  * 0.5;
    const ty   = rect.top  + rect.height * 0.5;
    for (let i = 0; i < count; i++) {
      const jitter = 22;
      this._flyParticles.push({
        sx: fromX + (Math.random() - 0.5) * jitter,
        sy: fromY + (Math.random() - 0.5) * jitter,
        tx, ty, t: 0, color,
      });
    }
  }

  /** Full-screen edge flash — call when INTENSE! pickup collected, syncs with tunnel */
  triggerIntenseFlash(): void { this._intenseFlash = 1.0; }

  /** Highlight a HUD element with a pulsing glow during tutorial steps 6 & 7. Pass null to clear. */
  setTutorialHighlight(which: 'bombs' | 'extend' | null): void {
    this.elBombs.classList.remove('tut-hl-bombs');
    this.elExtend.classList.remove('tut-hl-extend');
    if (which === 'bombs')  this.elBombs.classList.add('tut-hl-bombs');
    if (which === 'extend') this.elExtend.classList.add('tut-hl-extend');
  }

  /** Briefly flash the quicken arrow pips white */
  flashQuicken(): void {
    this.elQuicken.classList.remove('quicken-flash');
    void this.elQuicken.offsetWidth; // reflow so animation restarts
    this.elQuicken.classList.add('quicken-flash');
  }

  private _drawFlyParticles(dt: number): void {
    // Decay INTENSE! flash (same rate as tunnel, ~0.67 s)
    if (this._intenseFlash > 0) this._intenseFlash = Math.max(0, this._intenseFlash - dt * 1.5);

    const ctx = this.chargeCtx;
    for (let i = this._flyParticles.length - 1; i >= 0; i--) {
      const p = this._flyParticles[i];
      p.t += dt / 0.55; // 0.55 s flight
      if (p.t >= 1) { this._flyParticles.splice(i, 1); continue; }
      const et = p.t * p.t * (3 - 2 * p.t); // smoothstep
      const x  = p.sx + (p.tx - p.sx) * et;
      const y  = p.sy + (p.ty - p.sy) * et;
      const a  = Math.pow(1 - p.t, 0.45);
      const r  = Math.max(1.5, 6.5 - p.t * 5.5);
      ctx.save();
      ctx.globalAlpha = a;

      // Outer glow orb
      ctx.fillStyle   = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur  = 22;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();

      // Bright white core for visibility
      ctx.shadowBlur = 8;
      ctx.fillStyle  = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, r * 0.45), 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  private _drawCharge(progress: number, cx: number, cy: number, radiusPx: number): void {
    const canvas = this.chargeCanvas;
    const ctx    = this.chargeCtx;
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W; canvas.height = H;
    }
    ctx.clearRect(0, 0, W, H);

    // ── INTENSE! coordinated edge-glow (synced with tunnel whiteout) ──────────
    if (this._intenseFlash > 0) {
      const fa = this._intenseFlash;
      const r  = Math.sqrt(W * W + H * H) * 0.5;
      const g  = ctx.createRadialGradient(W * 0.5, H * 0.5, r * 0.15, W * 0.5, H * 0.5, r);
      g.addColorStop(0,   `rgba(100, 200, 255, 0)`);
      g.addColorStop(0.45, `rgba(60,  180, 255, ${(fa * 0.18).toFixed(3)})`);
      g.addColorStop(1,   `rgba(210, 245, 255, ${(fa * 0.80).toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    if (progress <= 0.02) return;

    ctx.save();

    // ── Blast radius preview ring (full circle, sized to actual blast footprint) ──
    // This ring grows dramatically as charge builds — from small to massive
    const ringAlpha = 0.18 + progress * 0.45;
    ctx.strokeStyle = `rgba(255, 190, 40, ${ringAlpha})`;
    ctx.lineWidth   = 1.5 + progress * 2.5;
    ctx.shadowColor = '#ff8800';
    ctx.shadowBlur  = 10 + progress * 20;
    ctx.beginPath();
    ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
    ctx.stroke();

    // ── Inner progress arc (small fixed ring showing charge %) ────────────────
    const innerR = 20;
    ctx.strokeStyle = `rgba(255, 140, 0, ${0.5 + progress * 0.4})`;
    ctx.lineWidth   = 4 + progress * 3;
    ctx.shadowColor = '#ff8800';
    ctx.shadowBlur  = 12;
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.stroke();

    // Bright yellow leading edge of progress arc
    ctx.strokeStyle = `rgba(255, 230, 80, ${0.85 + progress * 0.15})`;
    ctx.lineWidth   = 2;
    ctx.shadowBlur  = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.stroke();

    // ── Full-charge white flash on both rings ──────────────────────────────────
    if (progress >= 0.98) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth   = 3;
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur  = 30;
      ctx.beginPath();
      ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  // ── Cheat menu ────────────────────────────────────────────────────────────

  private _openCheatMenu(): void {
    document.getElementById('cheat-menu')?.remove();

    const menu = document.createElement('div');
    menu.id = 'cheat-menu';
    menu.innerHTML = `
      <div class="cheat-title">◈ CHEATS ◈</div>
      <button class="cheat-btn" id="cheat-skip-tut">SKIP TUTORIAL</button>
      <button class="cheat-btn" id="cheat-reset-tut">RESET TUTORIAL</button>
      <button class="cheat-btn" id="cheat-bombs">+5 BOMBS (NEXT GAME)</button>
      <button class="cheat-btn" id="cheat-flux">MAX FLUX (NEXT GAME)</button>
      <button class="cheat-btn" id="cheat-time">+60 SECONDS (NEXT GAME)</button>
      <button class="cheat-btn cheat-btn-danger" id="cheat-clear-best">CLEAR BEST SCORE</button>
      <button class="cheat-btn cheat-btn-dl" id="cheat-download">⬇ DOWNLOAD ZIP</button>
      <button class="cheat-btn cheat-btn-close" id="cheat-close">✕  CLOSE</button>
    `;
    document.getElementById('app')!.appendChild(menu);

    const wire = (id: string, fn: () => void) => {
      const btn = menu.querySelector(`#${id}`) as HTMLElement;
      btn.addEventListener('click', fn);
      btn.addEventListener('touchend', (e) => { e.preventDefault(); fn(); }, { passive: false });
    };

    wire('cheat-skip-tut', () => {
      localStorage.setItem('aaa-tutorial-done', '1');
      this._cheatFlash(menu.querySelector('#cheat-skip-tut') as HTMLElement, 'DONE!');
    });
    wire('cheat-reset-tut', () => {
      localStorage.removeItem('aaa-tutorial-done');
      this._cheatFlash(menu.querySelector('#cheat-reset-tut') as HTMLElement, 'RESET!');
    });
    wire('cheat-bombs', () => {
      window.dispatchEvent(new CustomEvent('game:cheat', { detail: { type: 'bombs' } }));
      this._cheatFlash(menu.querySelector('#cheat-bombs') as HTMLElement, '+5 ARMED!');
    });
    wire('cheat-flux', () => {
      window.dispatchEvent(new CustomEvent('game:cheat', { detail: { type: 'flux' } }));
      this._cheatFlash(menu.querySelector('#cheat-flux') as HTMLElement, 'MAXED!');
    });
    wire('cheat-time', () => {
      window.dispatchEvent(new CustomEvent('game:cheat', { detail: { type: 'time' } }));
      this._cheatFlash(menu.querySelector('#cheat-time') as HTMLElement, '+60s ARMED!');
    });
    wire('cheat-clear-best', () => {
      window.dispatchEvent(new CustomEvent('game:cheat', { detail: { type: 'clear-best' } }));
      this._cheatFlash(menu.querySelector('#cheat-clear-best') as HTMLElement, 'CLEARED!');
    });
    wire('cheat-download', () => {
      const btn = menu.querySelector('#cheat-download') as HTMLElement;
      this._cheatFlash(btn, 'BUILDING...');
      void downloadBundle().then(() => {
        const b = menu.querySelector('#cheat-download') as HTMLElement | null;
        if (b) this._cheatFlash(b, 'DONE!');
      });
    });
    wire('cheat-close', () => { menu.remove(); });

    // Dismiss on outside tap (with small delay to avoid instant dismiss)
    setTimeout(() => {
      const onOutside = (e: PointerEvent) => {
        if (!menu.contains(e.target as Node)) {
          menu.remove();
          document.removeEventListener('pointerdown', onOutside);
        }
      };
      document.addEventListener('pointerdown', onOutside);
    }, 120);
  }

  private _cheatFlash(btn: HTMLElement, msg: string): void {
    const orig = btn.textContent ?? '';
    btn.textContent = msg;
    btn.classList.add('cheat-btn-flash');
    setTimeout(() => {
      btn.textContent = orig;
      btn.classList.remove('cheat-btn-flash');
    }, 900);
  }

  // ── Settings gear + panel ─────────────────────────────────────────────────

  private _buildSettings(app: HTMLElement, initMusicVol: number, initSfxVol: number, initInvertY: boolean): void {
    // Gear button
    const gear = document.createElement('button');
    gear.id = 'settings-btn';
    gear.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>`;
    app.appendChild(gear);

    // Panel
    const panel = document.createElement('div');
    panel.id = 'settings-panel';
    panel.classList.add('settings-hidden');
    panel.innerHTML = `
      <div class="set-row">
        <span class="set-label">MUSIC</span>
        <input class="set-slider" id="set-music" type="range" min="0" max="100" value="${Math.round(initMusicVol * 100)}">
        <span class="set-val" id="set-music-val">${Math.round(initMusicVol * 100)}</span>
      </div>
      <div class="set-row">
        <span class="set-label">SFX</span>
        <input class="set-slider" id="set-sfx" type="range" min="0" max="100" value="${Math.round(initSfxVol * 100)}">
        <span class="set-val" id="set-sfx-val">${Math.round(initSfxVol * 100)}</span>
      </div>
      <div class="set-row set-row-mobile-only">
        <span class="set-label" style="width:auto;flex:1;">INVERT Y</span>
        <label class="set-toggle">
          <input type="checkbox" id="set-invert-y"${initInvertY ? ' checked' : ''}>
          <span class="set-toggle-track"></span>
        </label>
      </div>
    `;
    app.appendChild(panel);

    // Gear toggle
    const toggle = () => {
      this._settingsOpen = !this._settingsOpen;
      panel.classList.toggle('settings-hidden', !this._settingsOpen);
      gear.classList.toggle('settings-active', this._settingsOpen);
    };
    gear.addEventListener('click', toggle);
    gear.addEventListener('touchend', (e) => { e.preventDefault(); toggle(); }, { passive: false });

    // Sliders
    const musicSlider = panel.querySelector('#set-music') as HTMLInputElement;
    const musicVal    = panel.querySelector('#set-music-val') as HTMLElement;
    const sfxSlider   = panel.querySelector('#set-sfx') as HTMLInputElement;
    const sfxVal      = panel.querySelector('#set-sfx-val') as HTMLElement;

    musicSlider.addEventListener('input', () => {
      const v = parseInt(musicSlider.value) / 100;
      musicVal.textContent = musicSlider.value;
      localStorage.setItem('aaa-music-vol', String(v));
      this._onMusicVol(v);
    });
    sfxSlider.addEventListener('input', () => {
      const v = parseInt(sfxSlider.value) / 100;
      sfxVal.textContent = sfxSlider.value;
      localStorage.setItem('aaa-sfx-vol', String(v));
      this._onSfxVol(v);
    });

    const invertCheck = panel.querySelector('#set-invert-y') as HTMLInputElement;
    invertCheck.addEventListener('change', () => {
      localStorage.setItem('neon-flux-invert-y', invertCheck.checked ? '1' : '0');
      this._onInvertY(invertCheck.checked);
    });

    // Close panel on outside click
    document.addEventListener('pointerdown', (e) => {
      if (this._settingsOpen && !panel.contains(e.target as Node) && e.target !== gear) {
        this._settingsOpen = false;
        panel.classList.add('settings-hidden');
        gear.classList.remove('settings-active');
      }
    });
  }

  /** Show the keyboard controls illustration on PC for 3 seconds. */
  showControlsHint(): void {
    const existing = document.getElementById('controls-hint');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.id = 'controls-hint';
    el.innerHTML = _controlsHintHTML();
    document.getElementById('app')!.appendChild(el);

    let gone = false;
    const dismiss = () => {
      if (gone) return;
      gone = true;
      el.classList.add('ctrl-out');
      el.addEventListener('animationend', () => el.remove(), { once: true });
      window.removeEventListener('keydown', dismiss);
    };
    window.addEventListener('keydown', dismiss, { once: true });
    setTimeout(dismiss, 3000);
  }

  private _showRecoverModal(): void {
    this.elOverlay.classList.remove('title-mode');
    this.elOverlay.innerHTML = `
      <div class="subtitle" style="letter-spacing:6px;margin-bottom:14px;">RECOVER SAVE</div>
      <div class="subtitle" style="font-size:clamp(9px,2vw,11px);color:#ff880088;margin-bottom:16px;max-width:320px;text-align:center;">
        Enter the save code from your previous device or browser.
      </div>
      <input id="recover-code-input" type="text" maxlength="28" autocomplete="off"
        spellcheck="false" placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
        style="width:100%;max-width:300px;text-transform:uppercase;letter-spacing:2px;text-align:center;">
      <div id="recover-status" style="min-height:20px;font-size:clamp(9px,2vw,11px);color:#ff4444;margin-top:8px;"></div>
      <button id="btn-recover-submit" style="margin-top:8px;">RECOVER</button>
      <button id="btn-recover-back" style="border-color:#00ffcc55;color:#00ffcc88;text-shadow:none;box-shadow:none;font-size:clamp(9px,2.2vw,12px);">BACK</button>
    `;
    this.elOverlay.classList.remove('hidden');

    const codeInput   = this.elOverlay.querySelector('#recover-code-input')    as HTMLInputElement;
    const statusEl    = this.elOverlay.querySelector('#recover-status')         as HTMLElement;
    const submitBtn   = this.elOverlay.querySelector('#btn-recover-submit')     as HTMLButtonElement;
    const backBtn     = this.elOverlay.querySelector('#btn-recover-back')!;

    const goBack = () => this._showTitle();
    backBtn.addEventListener('click', goBack);
    backBtn.addEventListener('touchend', (e) => { e.preventDefault(); goBack(); }, { passive: false });

    const doRecover = async () => {
      const code = codeInput.value.trim();
      if (code.replace(/[^A-Za-z0-9]/g, '').length < 15) {
        statusEl.textContent = 'CODE TOO SHORT — CHECK AND TRY AGAIN';
        statusEl.style.color = '#ff4444';
        return;
      }
      submitBtn.disabled = true;
      statusEl.style.color = '#00ffcc88';
      statusEl.textContent = 'RECOVERING…';
      const result = await recoverSave(code);
      submitBtn.disabled = false;
      if (result.error) {
        statusEl.style.color = '#ff4444';
        statusEl.textContent = result.error.includes('not found')
          ? 'CODE NOT FOUND — CHECK AND TRY AGAIN'
          : `ERROR: ${result.error.toUpperCase()}`;
      } else {
        statusEl.style.color = '#00ffcc';
        const best = result.bestScore ?? 0;
        statusEl.textContent = `RECOVERED! BEST SCORE: ${best.toString().padStart(7, '0')}`;
        setTimeout(() => this._showTitle(), 1800);
      }
    };

    submitBtn.addEventListener('click', () => { void doRecover(); });
    submitBtn.addEventListener('touchend', (e) => { e.preventDefault(); void doRecover(); }, { passive: false });
    codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') void doRecover(); });
    setTimeout(() => codeInput.focus(), 80);
  }

  private _renderLeaderboard(entries: LeaderboardRecord[]): string {
    const rows = entries.map(e => {
      const cls   = e.isPlayer ? 'lb-row lb-player' : 'lb-row';
      const name  = e.username.substring(0, 12).toUpperCase();
      const score = e.score.toString().padStart(7, '0');
      return `<div class="${cls}"><span class="lb-rank">#${e.rank}</span><span class="lb-name">${name}</span><span class="lb-score">${score}</span></div>`;
    }).join('');
    return `<div id="game-leaderboard"><div class="lb-title">TOP SCORES</div>${rows}</div>`;
  }

  private _el(tag: string, props: Partial<Record<string, string>> = {}): HTMLElement {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'textContent') el.textContent = v ?? '';
      else el.setAttribute(k === 'id' ? 'id' : k, v ?? '');
    }
    return el;
  }

  private _wireBtnWithNameSave(sel: string): void {
    const btn = this.elOverlay.querySelector(sel)!;
    let fired = false;
    const go  = () => {
      if (fired) return;
      fired = true;
      const nameInput = this.elOverlay.querySelector('#player-name-input') as HTMLInputElement | null;
      if (nameInput) setLocalPlayerName(nameInput.value);
      this.hideOverlay();
      window.dispatchEvent(new CustomEvent('game:start'));
    };
    btn.addEventListener('click',    go);
    btn.addEventListener('touchend', e => { e.preventDefault(); go(); }, { passive: false });
  }

  private _wireBtn(sel: string): void {
    const btn = this.elOverlay.querySelector(sel)!;
    let fired = false;
    const go  = () => {
      if (fired) return;
      fired = true;
      this.hideOverlay();
      window.dispatchEvent(new CustomEvent('game:start'));
    };
    btn.addEventListener('click',    go);
    btn.addEventListener('touchend', e => { e.preventDefault(); go(); }, { passive: false });
  }
}

// ── Keyboard controls SVG illustration ────────────────────────────────────────

function _controlsHintHTML(): string {
  // Key geometry (all keys same height: 46px)
  const kw = 46, kh = 46, gap = 10, r = 9;
  // Three bottom keys span: 3*46 + 2*10 = 158px wide; space bar matches that width
  const totalW = kw * 3 + gap * 2;  // 158
  const svgW   = totalW;
  const svgH   = kh * 3 + gap * 2;  // 158

  // Up arrow: centered over bottom row
  const ux = kw + gap, uy = 0;
  // Bottom row
  const lx = 0,       ly = kh + gap;  // ←
  const dx = kw + gap, dy = kh + gap;  // ↓
  const rx = kw * 2 + gap * 2, ry = kh + gap; // →
  // Space bar
  const sx = 0, sy = kh * 2 + gap * 2, sw = totalW;

  const col   = '#00ffcc';
  const dim   = 'rgba(0,255,204,0.28)';
  const glow  = 'drop-shadow(0 0 6px #00ffcc88)';
  const arrow = `fill:none;stroke:${col};stroke-width:2;stroke-linecap:round;stroke-linejoin:round`;
  const txt   = `font-family:Courier New,monospace;font-size:11px;fill:${col};text-anchor:middle;dominant-baseline:middle`;

  const key = (x: number, y: number, w: number, label: string, isArrow = false) => {
    const cx = x + w / 2, cy = y + kh / 2;
    const arrowSvg = isArrow ? _arrowSVG(label, cx, cy, arrow) : '';
    const textSvg  = isArrow ? '' : `<text x="${cx}" y="${cy}" style="${txt};font-size:10px;letter-spacing:1px">${label}</text>`;
    return `<rect x="${x}" y="${y}" width="${w}" height="${kh}" rx="${r}" ry="${r}" fill="${dim}" stroke="${col}" stroke-width="1.2"/>
${arrowSvg}${textSvg}`;
  };

  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}"
    width="${svgW}" height="${svgH}" style="filter:${glow}">
    ${key(ux, uy, kw, '↑', true)}
    ${key(lx, ly, kw, '←', true)}
    ${key(dx, dy, kw, '↓', true)}
    ${key(rx, ry, kw, '→', true)}
    ${key(sx, sy, sw, 'SPACE')}
  </svg>`;

  const labels = `
    <div class="ctrl-label" style="text-align:center;margin-bottom:6px;letter-spacing:3px;font-size:10px;color:rgba(0,255,204,0.5)">MOVE</div>
    <div class="ctrl-keys">${svgStr}</div>
    <div class="ctrl-label" style="text-align:center;margin-top:10px;letter-spacing:3px;font-size:9px;color:rgba(0,255,204,0.4)">HOLD TO CHARGE · RELEASE TO DETONATE</div>
  `;
  return `<div class="ctrl-inner">${labels}</div>`;
}

function _arrowSVG(dir: string, cx: number, cy: number, style: string): string {
  const s = 11; // arrow size — point order: foot → tip → foot for symmetric V shape
  if (dir === '↑') return `<polyline points="${cx - s * 0.6},${cy + s * 0.4} ${cx},${cy - s} ${cx + s * 0.6},${cy + s * 0.4}" style="${style}"/>`;
  if (dir === '↓') return `<polyline points="${cx - s * 0.6},${cy - s * 0.4} ${cx},${cy + s} ${cx + s * 0.6},${cy - s * 0.4}" style="${style}"/>`;
  if (dir === '←') return `<polyline points="${cx + s * 0.4},${cy - s * 0.6} ${cx - s},${cy} ${cx + s * 0.4},${cy + s * 0.6}" style="${style}"/>`;
  if (dir === '→') return `<polyline points="${cx - s * 0.4},${cy - s * 0.6} ${cx + s},${cy} ${cx - s * 0.4},${cy + s * 0.6}" style="${style}"/>`;
  return '';
}
