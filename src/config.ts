// ─── Game constants — Every Extend Extra: Any Additional Advantage Edition ───

export const CAMERA = {
  FOV:    55,
  NEAR:   0.5,
  FAR:    4000,
  Z:      220,
  Y:      22,
  LOOK_Z: -40,
} as const;

// 2D gameplay arena (everything lives at Z ≈ 0)
export const ARENA = {
  GAME_Z:  0,     // Z plane for all gameplay objects
  HALF_W:  130,   // ±X player movement limit
  HALF_H:  96,    // ±Y player movement limit
  SPAWN_R: 235,   // enemy spawn radius from origin
} as const;

// Every Extend Extra core rules
export const EEE = {
  // Time / lives
  START_TIME:  60.0,   // starting seconds
  START_BOMBS: 10,     // starting "lives" (bombs)
  MAX_QUICKEN: 10,

  // Player movement
  PLAYER_SPEED: 88,    // units / sec
  SLOW_MULT:    0.5,   // fraction of speed when charging

  // Detonation
  CHARGE_TIME:    1.5,  // seconds hold before charged blast auto-fires
  RESPAWN_TIME:   0.65, // seconds player is invisible / invincible after detonating
  INVINCIBLE_ADD: 1.2,  // extra seconds of invincibility after respawn
  NORMAL_RADIUS:  15,   // quick-tap blast (small)
  CHARGED_RADIUS: 58,   // full-charge blast
  CHAIN_RADIUS:   27,   // chain explosion radius (independent — keeps chaining between formation enemies)
  EXPAND_SPEED:    65,  // radius units / sec (slow enough to read each explosion)

  // Chain
  CHAIN_SETTLE: 0.4,   // seconds after last explosion before chain finalises

  // Enemy spawning
  ENEMY_SPEED:    20,  // drift speed toward centre
  SPAWN_COOLDOWN: 1.25, // seconds between formation spawns (+20% density)

  // Pickups
  SCORE_PICKUP:    200,
  TIME_BONUS:        2,  // seconds added by time pickup
  PICKUP_RADIUS:    22,  // collection distance
  PICKUP_LIFETIME:  12.0,

  // Extend target ranges
  EXTEND_FIRST_MIN:  5,
  EXTEND_FIRST_MAX: 14,
  EXTEND_NEXT_MIN:  15,
  EXTEND_NEXT_MAX:  22,

  // Score formula: chainScore × 50 × ⌊chain/3⌋  +  extendMult × 5 × |chain-3|
  BRACKETS: [
    { minTime: 150, extendMult: 44 },
    { minTime: 120, extendMult: 37 },
    { minTime:  90, extendMult: 31 },
    { minTime:  60, extendMult: 21 },
    { minTime:   0, extendMult: 11 },
  ] as const,
} as const;

// Visual post-processing  (+50% environment: bloom, particles, stars)
const _mobile = window.matchMedia('(pointer: coarse)').matches;
export const VISUAL = {
  BLOOM_STRENGTH:  0.62,
  BLOOM_RADIUS:    0.60,
  BLOOM_THRESHOLD: 0.50,
  MAX_PARTICLES: _mobile ? 2200 : 4500,  // mobile: ~half to stay within GPU budget
  PARTICLE_SIZE:   1.8,
  STAR_COUNT:    _mobile ? 1600 : 3300,  // mobile: fewer background stars
  STAR_RADIUS:   3500,
} as const;

// Compatibility shim — StarField and TunnelRenderer reference RAIL.SPEED
// as their base scroll rate (units/sec).
export const RAIL = { SPEED: 80 } as const;

// Minter-mode kill chain (drives bloom/intensity)
export const MINTER = {
  KILL_CHAIN_WINDOW: 1.8,
  KILL_CHAIN_DECAY:  5.5,
  MAX_MULTIPLIER: 9,
  INTENSITY_MIN: 1.0,
  INTENSITY_MAX: 3.0,
} as const;
