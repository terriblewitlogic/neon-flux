const MAX_SCORE    = 9999999;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT     = 10000;

const ALLOWED_ORIGINS = new Set([
  'https://neon-flux.org',
  'https://www.neon-flux.org',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://localhost:5173',
  'http://localhost:5174',
]);

const BAD_WORDS = [
  'fuck','shit','bitch','cunt','dick','pussy','asshole','bastard','nigger','nigga',
  'fag','faggot','retard','whore','slut','kike','chink','spic',
];

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : 'https://neon-flux.org';
  return {
    'Access-Control-Allow-Origin':  allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function json(request, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(request),
    },
  });
}

function sanitizeName(value) {
  const cleaned = String(value || 'Player')
    .replace(/[^\w .'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 21);
  const name    = cleaned || 'Player';
  const compact = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return BAD_WORDS.some(w => compact.includes(w)) ? 'Player' : name;
}

function sanitizePlayerId(value) {
  const id = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return id.length >= 12 ? id : null;
}

function sanitizeRecoveryCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 48);
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const hash  = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

function clampScore(value) {
  return Math.max(0, Math.min(MAX_SCORE, Math.floor(Number(value) || 0)));
}

async function getRank(db, score) {
  const row = await db
    .prepare('SELECT COUNT(*) + 1 AS rank FROM scores WHERE score > ?1')
    .bind(score)
    .first();
  return row?.rank || 1;
}

async function upsertScore(db, playerId, name, score, now) {
  await db.prepare(`
    INSERT INTO scores (player_id, name, score, created_at, updated_at, last_submit_ms, submit_count, suspicious)
    VALUES (?1, ?2, ?3, datetime('now'), datetime('now'), ?4, 1, 0)
    ON CONFLICT(player_id) DO UPDATE SET
      name           = excluded.name,
      score          = CASE WHEN excluded.score > scores.score THEN excluded.score ELSE scores.score END,
      updated_at     = CASE WHEN excluded.score > scores.score THEN datetime('now') ELSE scores.updated_at END,
      last_submit_ms = excluded.last_submit_ms,
      submit_count   = scores.submit_count + 1,
      suspicious     = 0
  `).bind(playerId, name, score, now).run();
}

// ── GET /api/leaderboard ──────────────────────────────────────────────────────

async function getLeaderboard(request, env) {
  const url      = new URL(request.url);
  const limit    = Math.max(1, Math.min(MAX_LIMIT, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT));
  const playerId = sanitizePlayerId(url.searchParams.get('playerId'));

  const result = await env.DB.prepare(`
    SELECT player_id AS playerId, name, score, updated_at AS updatedAt
    FROM scores
    ORDER BY score DESC, updated_at ASC
    LIMIT ?1
  `).bind(limit).all();

  const entries = (result.results || []).map((row, index) => ({
    rank:          index + 1,
    playerId:      row.playerId,
    username:      row.name,
    displayName:   row.name,
    score:         row.score,
    updatedAt:     row.updatedAt,
    isCurrentUser: playerId ? row.playerId === playerId : false,
  }));

  let myRank = null;
  if (playerId) {
    const mine = await env.DB
      .prepare('SELECT score FROM scores WHERE player_id = ?1')
      .bind(playerId)
      .first();
    if (mine) myRank = { rank: await getRank(env.DB, mine.score), score: mine.score };
  }

  return json(request, { entries, myRank });
}

// ── POST /api/leaderboard ─────────────────────────────────────────────────────

async function submitScore(request, env) {
  let payload;
  try { payload = await request.json(); } catch (_) {
    return json(request, { error: 'invalid json' }, 400);
  }

  const playerId = sanitizePlayerId(payload.playerId);
  if (!playerId) return json(request, { error: 'invalid player id' }, 400);

  const score = clampScore(payload.score);
  if (score <= 0) return json(request, { error: 'score must be positive' }, 400);

  const name = sanitizeName(payload.name);
  await upsertScore(env.DB, playerId, name, score, Date.now());

  return json(request, {
    ok:   true,
    rank: await getRank(env.DB, score),
    score,
  });
}

// ── GET /api/save ─────────────────────────────────────────────────────────────

async function getSave(request, env) {
  const url      = new URL(request.url);
  const playerId = sanitizePlayerId(url.searchParams.get('playerId'));
  if (!playerId) return json(request, { error: 'invalid player id' }, 400);

  const row = await env.DB.prepare(`
    SELECT player_id AS playerId, name, save_json AS saveJson, updated_at AS updatedAt
    FROM player_saves WHERE player_id = ?1
  `).bind(playerId).first();

  if (!row) return json(request, { save: null });

  return json(request, {
    playerId:  row.playerId,
    name:      row.name,
    save:      JSON.parse(row.saveJson),
    updatedAt: row.updatedAt,
  });
}

// ── POST /api/save ────────────────────────────────────────────────────────────

async function postSave(request, env) {
  let payload;
  try { payload = await request.json(); } catch (_) {
    return json(request, { error: 'invalid json' }, 400);
  }

  const playerId     = sanitizePlayerId(payload.playerId);
  const recoveryCode = sanitizeRecoveryCode(payload.recoveryCode);
  if (!playerId)              return json(request, { error: 'invalid player id' }, 400);
  if (recoveryCode.length < 15) return json(request, { error: 'invalid recovery code' }, 400);

  const save = payload.save;
  if (!save || save.version !== 1 || typeof save !== 'object') {
    return json(request, { error: 'invalid save' }, 400);
  }

  const name         = sanitizeName(payload.name);
  const score        = clampScore(save.bestScore);
  const now          = Date.now();
  const recoveryHash = await sha256Hex(recoveryCode);
  const saveJson     = JSON.stringify({ version: 1, bestScore: score }).slice(0, 4096);

  await env.DB.prepare(`
    INSERT INTO player_saves
      (player_id, recovery_hash, name, save_json, accepted_score,
       created_at, updated_at, last_accept_ms, submit_count)
    VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'), datetime('now'), ?6, 1)
    ON CONFLICT(player_id) DO UPDATE SET
      recovery_hash  = excluded.recovery_hash,
      name           = excluded.name,
      save_json      = excluded.save_json,
      accepted_score = excluded.accepted_score,
      updated_at     = datetime('now'),
      last_accept_ms = excluded.last_accept_ms,
      submit_count   = player_saves.submit_count + 1
  `).bind(playerId, recoveryHash, name, saveJson, score, now).run();

  if (score > 0) {
    await upsertScore(env.DB, playerId, name, score, now);
  }

  return json(request, { ok: true, score, rank: score > 0 ? await getRank(env.DB, score) : null });
}

// ── POST /api/recover ─────────────────────────────────────────────────────────

async function recoverSave(request, env) {
  let payload;
  try { payload = await request.json(); } catch (_) {
    return json(request, { error: 'invalid json' }, 400);
  }

  const recoveryCode = sanitizeRecoveryCode(payload.recoveryCode);
  if (recoveryCode.length < 15) return json(request, { error: 'invalid recovery code' }, 400);

  const recoveryHash = await sha256Hex(recoveryCode);
  const row = await env.DB.prepare(`
    SELECT player_id AS playerId, name, save_json AS saveJson, updated_at AS updatedAt
    FROM player_saves WHERE recovery_hash = ?1
  `).bind(recoveryHash).first();

  if (!row) return json(request, { error: 'recovery code not found' }, 404);

  return json(request, {
    playerId:  row.playerId,
    name:      row.name,
    save:      JSON.parse(row.saveJson),
    bestScore: clampScore(JSON.parse(row.saveJson)?.bestScore),
    updatedAt: row.updatedAt,
  });
}

// ── Router ────────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (!env.DB) return json(request, { error: 'database not configured' }, 500);

    const path = new URL(request.url).pathname.replace(/\/+$/, '');

    if (path.endsWith('/api/leaderboard')) {
      if (request.method === 'GET')  return getLeaderboard(request, env);
      if (request.method === 'POST') return submitScore(request, env);
    }
    if (path.endsWith('/api/save')) {
      if (request.method === 'GET')  return getSave(request, env);
      if (request.method === 'POST') return postSave(request, env);
    }
    if (path.endsWith('/api/recover') && request.method === 'POST') {
      return recoverSave(request, env);
    }

    return json(request, { error: 'not found' }, 404);
  },
};
