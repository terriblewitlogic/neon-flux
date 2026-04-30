import './style.css';
import { Game } from './Game';
import { getRecoveryCode } from './platform';

// Ensure a recovery code exists on first load (generates + caches it)
getRecoveryCode();

async function bootstrap(): Promise<void> {
  try {
    const container = document.getElementById('app');
    if (!container) throw new Error('No #app container found');

    const game = new Game(container);
    game.start();
  } catch (err) {
    console.error('[NeonFlux] Boot error', err);
  }
}

window.addEventListener('error', (e) => {
  console.error('[NeonFlux] Uncaught error', e.error ?? e.message);
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[NeonFlux] Unhandled rejection', e.reason);
});

bootstrap();
