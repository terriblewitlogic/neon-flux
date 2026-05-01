import './style.css';
import { Game } from './Game';
import { NeonFluxLogo } from './NeonFluxLogo';
import {
  getLocalPlayerName,
  setLocalPlayerName,
  getRecoveryCode,
  recoverSave,
} from './platform';

function startSplashHero(): () => void {
  const wormhole = document.getElementById('ss-wormhole') as HTMLCanvasElement;
  const logoEl   = document.getElementById('ss-logo')!;

  // ── Wormhole canvas ──────────────────────────────────────────────────────
  const hero = wormhole.parentElement!;
  wormhole.width  = hero.clientWidth  || 340;
  wormhole.height = hero.clientHeight || 191;
  const ctx = wormhole.getContext('2d')!;
  const NUM_RINGS = 14;
  let t = 0;
  let wraf = 0;

  const drawWormhole = () => {
    const w = wormhole.width, h = wormhole.height;
    const cx = w / 2, cy = h / 2;
    ctx.fillStyle = 'rgba(2, 0, 12, 0.18)';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < NUM_RINGS; i++) {
      const phase = ((t * 0.45 + i / NUM_RINGS) % 1);
      const r     = phase * Math.max(cx, cy) * 1.55;
      const hue   = (t * 55 + i * 26) % 360;
      const alpha = (1 - phase) * 0.85;
      ctx.strokeStyle = `hsla(${hue},100%,62%,${alpha})`;
      ctx.lineWidth   = 1.2 + (1 - phase) * 1.2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.42, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    t += 0.016;
    wraf = requestAnimationFrame(drawWormhole);
  };
  wraf = requestAnimationFrame(drawWormhole);

  // ── Logo ─────────────────────────────────────────────────────────────────
  const logo = new NeonFluxLogo('both');
  logo.resize(wormhole.width, Math.round(wormhole.width / 2.8));
  logoEl.appendChild(logo.canvas);
  logo.start();

  return () => {
    cancelAnimationFrame(wraf);
    logo.stop();
    logo.dispose();
  };
}

const ADJS = [
  'ANCIENT','BINARY','BURNING','COLD','COSMIC','CRIMSON','DARK','DEAD',
  'DISTANT','DRIFTING','DYING','ELECTRIC','FALLEN','FROZEN','GHOST',
  'GLOWING','HOLLOW','INFINITE','IRON','LAST','LOST','MOLTEN','NEBULA',
  'NEON','NULL','PHANTOM','QUANTUM','ROGUE','SHATTERED','SILENT',
  'SOLAR','STELLAR','STRANGE','SUPER','TOXIC','ULTRA','VOID','WANDERING',
  'WARPED','WILD','ZERO',
];
const NOUNS = [
  'ANDROID','ASTEROID','BEACON','BINARY','CLONE','CLUSTER','COMET',
  'CONSTRUCT','COSMOS','CYBORG','DRONE','DWARF','ECHO','ENTITY','FLUX',
  'GIANT','HORIZON','HUNTER','ION','LASER','MATTER','MATRIX','MOON',
  'NEBULA','NODE','NOVA','ORBIT','PHOTON','PILOT','PROBE','PULSAR',
  'QUASAR','REACTOR','RELAY','RIFT','SENTINEL','SIGNAL','SINGULARITY',
  'SPECTER','STAR','STORM','SYSTEM','TITAN','VECTOR','VOID','WARP',
];

function randomName(): string {
  const adj  = ADJS[Math.floor(Math.random() * ADJS.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun}`;
}

// Ensure recovery code is generated on first visit
getRecoveryCode();

async function runSplash(): Promise<void> {
  const stopHero  = startSplashHero();
  const screen       = document.getElementById('startScreen')!;
  const nameInput    = document.getElementById('startNameInput')    as HTMLInputElement;
  const recoveryInput = document.getElementById('startRecoveryInput') as HTMLInputElement;
  const startBtn     = document.getElementById('startBtn')           as HTMLButtonElement;
  const hint         = document.getElementById('startHint')!;

  // Pre-fill saved name, or generate a random one for first-time visitors
  const hasSaved = !!localStorage.getItem('neon-flux_player_name_v1');
  nameInput.value = hasSaved ? getLocalPlayerName() : randomName();
  startBtn.disabled = !nameInput.value.trim();

  nameInput.addEventListener('input', () => {
    const clean = nameInput.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/  +/g, ' ');
    if (nameInput.value !== clean) {
      const pos = nameInput.selectionStart ?? clean.length;
      nameInput.value = clean;
      nameInput.setSelectionRange(pos, pos);
    }
    startBtn.disabled = !clean;
  });

  return new Promise(resolve => {
    const go = async () => {
      const name = nameInput.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/  +/g, ' ').trim();
      const code = recoveryInput.value.trim();
      if (!name) return;

      startBtn.disabled = true;
      setLocalPlayerName(name);

      if (code) {
        hint.textContent = 'RESTORING SAVE…';
        hint.className   = '';
        const result = await recoverSave(code);
        if (result.error) {
          hint.textContent = result.error.toLowerCase().includes('not found')
            ? 'CODE NOT FOUND — CHECK AND TRY AGAIN'
            : `ERROR: ${result.error.toUpperCase()}`;
          hint.className   = 'err';
          startBtn.disabled = false;
          return;
        }
        const best = result.bestScore ?? 0;
        hint.textContent = `RESTORED — BEST ${best.toString().padStart(7, '0')}`;
        hint.className   = '';
        await new Promise(r => setTimeout(r, 900));
      }

      screen.classList.add('done');
      stopHero();
      resolve();
    };

    startBtn.addEventListener('click', () => { void go(); });
    startBtn.addEventListener('touchend', e => { e.preventDefault(); void go(); }, { passive: false });
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') void go(); });
    recoveryInput.addEventListener('keydown', e => { if (e.key === 'Enter') void go(); });
  });
}

async function bootstrap(): Promise<void> {
  try {
    const qs = new URLSearchParams(window.location.search);

    if (qs.get('portal') === 'true' || qs.get('portal') === '1') {
      // Arrived via portal — skip splash, use URL username if provided
      const urlName = (qs.get('username') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (urlName) setLocalPlayerName(urlName);
      document.getElementById('startScreen')!.classList.add('done');
    } else {
      await runSplash();
    }

    const container = document.getElementById('app');
    if (!container) throw new Error('No #app container found');

    const game = new Game(container);
    game.start();
  } catch (err) {
    console.error('[NeonFlux] Boot error', err);
  }
}

window.addEventListener('error', e => {
  console.error('[NeonFlux] Uncaught error', e.error ?? e.message);
});
window.addEventListener('unhandledrejection', e => {
  console.error('[NeonFlux] Unhandled rejection', e.reason);
});

bootstrap();
