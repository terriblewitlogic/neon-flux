// ─── InteractiveTutorial ─────────────────────────────────────────────────────
// Step-by-step in-game tutorial overlay.
// All step logic lives in Game.ts — this class only manages the DOM elements.

const STEP_COUNT = 8;

const STEPS: Array<{ title: string; text: string; mobileText?: string }> = [
  {
    title:      'MOVE',
    text:       'Use arrow keys or WASD to fly your ship',
    mobileText: 'Drag the left joystick to fly your ship',
  },
  {
    title: 'APPROACH',
    text:  'Fly toward the enemy group',
  },
  {
    title:      'DETONATE',
    text:       'Press SPACE to detonate!',
    mobileText: 'Tap ⊕ to detonate!',
  },
  {
    title:      'CHARGE UP',
    text:       'Hold SPACE until the ring fills — then release!',
    mobileText: 'Hold ⊕ until the ring fills — then release!',
  },
  {
    title: 'CHAIN REACTION',
    text:  'Fly into the group and detonate in the middle!',
  },
  {
    title: 'GRAB IT',
    text:  'Collect the orange gem for more time!',
  },
  {
    title: 'BOMBS',
    text:  'Each detonation costs 1 bomb. Run out and the game ends — make every blast count!',
  },
  {
    title: 'EXTRA BOMB GOAL',
    text:  'Hit the chain kill target shown on screen to earn +1 bomb back. Earn faster than you spend!',
  },
];

export class InteractiveTutorial {
  private _panel: HTMLElement;
  private _arrow: HTMLElement;
  readonly isMobile = window.matchMedia('(pointer: coarse)').matches;

  constructor() {
    const app = document.getElementById('app')!;

    this._panel = document.createElement('div');
    this._panel.id = 'itut-panel';
    this._panel.classList.add('itut-hidden');
    app.appendChild(this._panel);

    this._arrow = document.createElement('div');
    this._arrow.id = 'itut-arrow';
    this._arrow.classList.add('itut-hidden');
    app.appendChild(this._arrow);
  }

  showStep(step: number): void {
    const s = STEPS[step];
    if (!s) return;
    const text = (this.isMobile && s.mobileText) ? s.mobileText : s.text;
    this._panel.innerHTML = `
      <div class="itut-counter">${step + 1} / ${STEP_COUNT}</div>
      <div class="itut-title">${s.title}</div>
      <div class="itut-text">${text}</div>
    `;
    this._panel.classList.remove('itut-hidden');
  }

  showComplete(): void {
    this._arrow.classList.add('itut-hidden');
    this._panel.innerHTML = `
      <div class="itut-title">YOU'RE READY!</div>
      <div class="itut-text">Good luck out there — earn more than you spend!</div>
    `;
    this._panel.classList.remove('itut-hidden');
  }

  hide(): void {
    this._panel.classList.add('itut-hidden');
    this._arrow.classList.add('itut-hidden');
  }

  /** Position the pulsing target indicator at a screen-space point. */
  setArrow(screenX: number, screenY: number): void {
    this._arrow.classList.remove('itut-hidden');
    this._arrow.style.left = `${screenX}px`;
    this._arrow.style.top  = `${screenY}px`;
  }

  hideArrow(): void {
    this._arrow.classList.add('itut-hidden');
  }

  /** Position the panel below a screen-space point (e.g. below the player ship). */
  setPanelPosition(screenX: number, screenY: number): void {
    this._panel.style.left = `${screenX}px`;
    this._panel.style.top  = `${screenY}px`;
  }
}
