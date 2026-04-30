import './style.css';
import { Game } from './Game';
import {
  getLocalPlayerName,
  setLocalPlayerName,
  getRecoveryCode,
  recoverSave,
} from './platform';

// Ensure recovery code is generated on first visit
getRecoveryCode();

async function runSplash(): Promise<void> {
  const screen       = document.getElementById('startScreen')!;
  const nameInput    = document.getElementById('startNameInput')    as HTMLInputElement;
  const recoveryInput = document.getElementById('startRecoveryInput') as HTMLInputElement;
  const startBtn     = document.getElementById('startBtn')           as HTMLButtonElement;
  const hint         = document.getElementById('startHint')!;

  // Pre-fill saved name
  nameInput.value = getLocalPlayerName();
  startBtn.disabled = !nameInput.value.trim();

  nameInput.addEventListener('input', () => {
    startBtn.disabled = !nameInput.value.trim();
  });

  return new Promise(resolve => {
    const go = async () => {
      const name = nameInput.value.trim();
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
    await runSplash();

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
