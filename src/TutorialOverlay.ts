// ─── TutorialOverlay ─────────────────────────────────────────────────────────
// 8-slide how-to-play overlay accessible from the title screen.
// Illustrations use inline SVG with the game's neon wireframe aesthetic.

export class TutorialOverlay {
  private readonly _el: HTMLElement;
  private _slide = 0;
  private static readonly N = 8;

  constructor() {
    this._el = document.createElement('div');
    this._el.id = 'tutorial-overlay';
    this._el.classList.add('tut-hidden');
    document.getElementById('app')!.appendChild(this._el);
  }

  show(): void {
    this._slide = 0;
    this._el.classList.remove('tut-hidden');
    this._render();
  }

  hide(): void { this._el.classList.add('tut-hidden'); }

  private _render(): void {
    const N   = TutorialOverlay.N;
    const s   = this._slide;
    const mob = window.matchMedia('(pointer: coarse)').matches;
    const cur = _buildSlide(s, mob);

    this._el.innerHTML = `
      <div class="tut-inner">
        <button class="tut-skip">SKIP</button>
        <div class="tut-illo">${cur.illo}</div>
        <div class="tut-text">
          <p class="tut-title">${cur.title}</p>
          <p class="tut-sub">${cur.sub}</p>
        </div>
        <div class="tut-footer">
          <button class="tut-nav-btn tut-prev"${s === 0 ? ' disabled' : ''}>◀</button>
          <span class="tut-dots">${Array.from({ length: N }, (_, i) =>
            `<span class="tut-dot${i === s ? ' on' : ''}"></span>`).join('')}</span>
          <button class="tut-nav-btn tut-next">${s === N - 1 ? 'PLAY ▶' : 'NEXT ▶'}</button>
        </div>
      </div>
    `;

    this._on('.tut-skip', () => this._done());
    this._on('.tut-prev', () => { if (s > 0)     { this._slide--; this._render(); } });
    this._on('.tut-next', () => { if (s < N - 1) { this._slide++; this._render(); } else this._done(); });

    // Swipe to navigate
    const inner = this._el.querySelector<HTMLElement>('.tut-inner')!;
    let tx = 0;
    inner.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
    inner.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - tx;
      if (Math.abs(dx) < 50) return;
      if (dx < 0 && s < N - 1) { this._slide++; this._render(); }
      if (dx > 0 && s > 0)     { this._slide--; this._render(); }
    }, { passive: true });
  }

  private _on(sel: string, fn: () => void): void {
    const el = this._el.querySelector(sel);
    if (!el) return;
    el.addEventListener('click', fn);
    el.addEventListener('touchend', (e: Event) => {
      (e as TouchEvent).preventDefault();
      fn();
    }, { passive: false } as AddEventListenerOptions);
  }

  private _done(): void {
    this.hide();
    window.dispatchEvent(new CustomEvent('game:tutorial-done'));
  }
}

// ── SVG helpers ──────────────────────────────────────────────────────────────

function _gf(id: string): string {
  return `<defs><filter id="${id}" x="-80%" y="-80%" width="260%" height="260%">` +
    `<feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="b"/>` +
    `<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>` +
    `</filter></defs>`;
}

function _svg(body: string, id: string): string {
  return `<svg viewBox="0 0 280 150" xmlns="http://www.w3.org/2000/svg" ` +
    `class="tut-svg" role="img" aria-hidden="true">` +
    `${_gf(id)}<rect width="280" height="150" rx="4" fill="rgba(0,0,6,.75)"/>` +
    `${body}</svg>`;
}

function _ship(x: number, y: number, id: string, col = '#00ffcc'): string {
  return `<g transform="translate(${x},${y})" filter="url(#${id})" ` +
    `stroke="${col}" stroke-width="1.5" fill="none">` +
    `<polygon points="0,-20 -14,15 0,8 14,15"/>` +
    `<line x1="-6" y1="12" x2="-6" y2="23" stroke="#3366ff" stroke-width="2" opacity=".7"/>` +
    `<line x1="0"  y1="9"  x2="0"  y2="26" stroke="#88aaff" stroke-width="2"/>` +
    `<line x1="6"  y1="12" x2="6"  y2="23" stroke="#3366ff" stroke-width="2" opacity=".7"/>` +
    `</g>`;
}

function _enemy(x: number, y: number, id: string, col = '#ff1c5e', r = 12): string {
  const w = (r * .75).toFixed(1);
  return `<g transform="translate(${x},${y})" filter="url(#${id})" ` +
    `stroke="${col}" stroke-width="1.5" fill="none">` +
    `<polygon points="0,${-r} ${w},0 0,${r} ${-w},0"/>` +
    `<line x1="${-w}" y1="0" x2="${w}" y2="0" opacity=".3"/>` +
    `<line x1="0" y1="${-r}" x2="0" y2="${r}" opacity=".3"/>` +
    `</g>`;
}

function _ring(cx: number, cy: number, r: number, id: string,
    col = '#ffaa00', op = 0.9, dash = ''): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" ` +
    `stroke-width="2" opacity="${op}" filter="url(#${id})"` +
    (dash ? ` stroke-dasharray="${dash}"` : '') + `/>`;
}

function _gem(cx: number, cy: number, id: string, col: string, r = 12): string {
  const h = (r * .55).toFixed(1);
  return `<g transform="translate(${cx},${cy})" filter="url(#${id})" ` +
    `stroke="${col}" stroke-width="1.5" fill="none">` +
    `<polygon points="0,${-r} ${r},0 0,${r} ${-r},0"/>` +
    `<polygon points="0,${-h} ${h},0 0,${h} ${-h},0" opacity=".5"/>` +
    `</g>`;
}

function _txt(x: number, y: number, txt: string, col: string, size: number,
    anchor = 'middle', id = '', ls = '1'): string {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${col}" ` +
    `font-size="${size}" font-family="Courier New,monospace" letter-spacing="${ls}"` +
    (id ? ` filter="url(#${id})"` : '') + `>${txt}</text>`;
}

// ── Slide data ────────────────────────────────────────────────────────────────

interface _Slide { title: string; sub: string; illo: string; }

function _buildSlide(n: number, mob: boolean): _Slide {
  const btn = mob ? 'HOLD THE BUTTON' : 'HOLD SPACE';

  const slides: _Slide[] = [

    // 0 ── The Golden Rule
    {
      title: "You don't have guns. <em>YOU</em> are the weapon.",
      sub:   'Position your ship near a crowd of enemies — then blow yourself up.',
      illo: _svg(
        _ship(140, 76, 's1') +
        _enemy( 55,  36, 's1', '#ff1c5e', 13) +
        _enemy(225,  36, 's1', '#ff1c5e', 13) +
        _enemy( 36,  86, 's1', '#ff1c5e', 11) +
        _enemy(244,  86, 's1', '#ff1c5e', 11) +
        _enemy( 98,  22, 's1', '#ff1c5e', 11) +
        _enemy(182,  22, 's1', '#ff1c5e', 11) +
        _enemy( 88, 126, 's1', '#ff1c5e', 10) +
        _enemy(192, 126, 's1', '#ff1c5e', 10),
      's1'),
    },

    // 1 ── Self-destruct / charging
    {
      title: `${btn} to charge. Release to detonate!`,
      sub:   'Quick tap = small blast. Full charge = massive explosion.',
      illo: _svg(
        _ship(140, 80, 's2') +
        _ring(140, 80, 26, 's2', '#ffcc00', .45, '4 3') +
        _ring(140, 80, 70, 's2', '#ffcc00', .95) +
        _txt(170, 68, 'TAP', '#ffcc0066', 9, 'start', '', '1') +
        `<line x1="140" y1="52" x2="140" y2="14" stroke="#ffcc0033" stroke-width="1" stroke-dasharray="2 3"/>` +
        _txt(140, 10, 'FULL CHARGE', '#ffcc00', 9, 'middle', 's2', '1'),
      's2'),
    },

    // 2 ── Chain Reactions
    {
      title: 'Exploding enemies destroy other enemies!',
      sub:   'Group enemies together before detonating to trigger massive chain reactions.',
      illo: _svg(
        _enemy(100, 65, 's3', '#ff1c5e', 12) +
        _enemy(138, 52, 's3', '#ff1c5e', 12) +
        _enemy(138, 84, 's3', '#ff1c5e', 12) +
        _ring(100, 65, 40, 's3', '#ffaa00', .9) +
        _ring(138, 68, 30, 's3', '#ff7700', .75) +
        _enemy(196, 58, 's3', '#ff1c5e', 11) +
        _enemy(200, 88, 's3', '#ff1c5e', 11) +
        _ring(198, 72, 22, 's3', '#ff4400', .6) +
        _txt(14, 142, 'CHAIN  REACTION  \u2192', '#ffaa0055', 8, 'start', '', '2'),
      's3'),
    },

    // 3 ── The Cost
    {
      title: 'Every detonation spends 1 BOMB.',
      sub:   'Run out of bombs and your run is over. Make every explosion count!',
      illo: _svg(
        _txt(140, 46, 'BOMBS', '#00ffcc55', 10, 'middle', '', '4') +
        Array.from({ length: 10 }, (_, i) =>
          `<text x="${14 + i * 25}" y="90" fill="${i < 7 ? '#00ff88' : '#113322'}" ` +
          `font-size="18" font-family="Courier New,monospace"` +
          (i < 7 ? ` filter="url(#s4)"` : '') + `>\u25C6</text>`
        ).join('') +
        _txt(14, 118, '\u2212 1 per detonation', '#ff333355', 9, 'start', '', '1'),
      's4'),
    },

    // 4 ── Extra Bomb Goal
    {
      title: 'Earn bombs back!',
      sub:   'Hit the chain kill TARGET shown on screen to earn +1 BOMB. Earn faster than you spend!',
      illo: _svg(
        _txt(140,  40, 'EXTRA BOMB GOAL \u00D78', '#ffcc00', 9, 'middle', 's5', '2') +
        _txt(140,  74, 'CHAIN  8',           '#ffffff',  24, 'middle', 's5', '4') +
        `<line x1="60" y1="84" x2="220" y2="84" stroke="#00ffcc22" stroke-width="1"/>` +
        _txt(140, 108, '+1  BOMB  \u25C6',   '#00ff88', 14, 'middle', 's5', '2') +
        _txt(140, 132, 'target resets to \u00D710', '#00ffcc33', 9, 'middle', '', '1'),
      's5'),
    },

    // 5 ── Beat the Clock
    {
      title: 'The clock is always ticking!',
      sub:   'Collect ORANGE items dropped by enemies to add seconds to the timer.',
      illo: _svg(
        _txt( 72,  80, '0:08', '#ff2200', 28, 'middle', 's6', '2') +
        _txt(116,  78, '+',    '#00ffcc66', 20, 'middle') +
        _gem(172,  68, 's6', '#ff8800', 20) +
        `<line x1="72" y1="94" x2="72" y2="110" stroke="#00ffcc22" stroke-width="1" stroke-dasharray="2 2"/>` +
        _txt( 72, 128, '0:22', '#ffcc00', 20, 'middle', 's6', '2') +
        _txt(172, 102, 'ORANGE = TIME', '#ff880088', 9, 'middle', '', '1'),
      's6'),
    },

    // 6 ── Score
    {
      title: 'Grab the loot!',
      sub:   'GREEN items boost your score. Compete for the top of the leaderboard!',
      illo: _svg(
        _gem( 85, 74, 's7', '#00ff88', 22) +
        _txt(178, 60, '+200', '#00ff88', 18, 'middle', 's7', '1') +
        _txt(178, 82, '+200', '#00ff8844', 13, 'middle', '', '1') +
        _txt(140, 116, 'GREEN = SCORE', '#00ff8877', 10, 'middle', '', '2') +
        _txt(140, 134, 'climb the leaderboard', '#00ffcc33', 8, 'middle', '', '1'),
      's7'),
    },

    // 7 ── Flux
    {
      title: 'Risk = Reward.',
      sub:   'BLUE items raise FLUX — speed, enemy count, and scoring multipliers all increase. Perfect for massive chains.',
      illo: _svg(
        _gem(68, 74, 's8', '#4488ff', 22) +
        _txt(200, 32, 'FLUX', '#4488ffcc', 10, 'middle', 's8', '3') +
        Array.from({ length: 10 }, (_, i) =>
          `<text x="${152 + i * 12}" y="54" fill="${i < 6 ? '#00ffcc' : '#002222'}" ` +
          `font-size="11" font-family="Courier New,monospace"` +
          (i < 6 ? ` filter="url(#s8)"` : '') + `>\u2191</text>`
        ).join('') +
        _txt(200,  76, '\u26A1 SPEED UP',          '#4488ff88', 9, 'middle', '', '1') +
        _txt(200,  92, '\u26A1 MORE ENEMIES',       '#4488ff88', 9, 'middle', '', '1') +
        _txt(200, 108, '\u26A1 SCORE \u00D7MULT',   '#4488ff88', 9, 'middle', '', '1') +
        _txt(200, 124, '\u26A1 BIGGER CHAINS',      '#4488ff88', 9, 'middle', '', '1'),
      's8'),
    },
  ];

  return slides[n];
}
