const MAX_SCORE = 9999999;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 10000;
const INITIAL_LEADERBOARD_CAP = 250000;

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
    'Access-Control-Allow-Origin': allowOrigin,
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
    .slice(0, 18);
  const name = cleaned || 'Player';
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

function scoreFromSave(save) {
  return clampScore(Number(save?.bestScore || 0));
}

// Antifraud: neon-flux is a pure skill game — rate-limit score increases.
// Allow 50k base + 5k/second elapsed + 100% of previous score as increase.
// This is generous enough for legitimate skilled play while blocking instant inflation.
function validateProgress(existing, save, score, now) {
  if (!existing) {
    return {
      accepted:   Math.min(score, INITIAL_LEADERBOARD_CAP),
      suspicious: score > INITIAL_LEADERBOARD_CAP ? 1 : 0,
      reason:     score > INITIAL_LEADERBOARD_CAP ? 'initial score cap' : '',
    };
  }
  const previous = Number(existing.accepted_score || 0);
  if (score <= previous) {
    return { accepted: previous, suspicious: Number(existing.suspicious || 0), reason: '' };
  }
  const elapsed = Math.max(1, (now - Number(existing.last_accept_ms || now - 60000)) / 1000);
  const allowedIncrease = 50000 + elapsed * 5000 + previous;
  const delta = score - previous;
  if (delta > allowedIncrease) {
    return { accepted: previous, suspicious: 1, reason: 'score increased too quickly' };
  }
  return {
    accepted:   Math.min(score, MAX_SCORE),
    suspicious: Number(existing.suspicious || 0),
    reason:     '',
  };
}

async function getRank(db, score) {
  const row = await db
    .prepare('SELECT COUNT(*) + 1 AS rank FROM scores WHERE score > ?1 AND suspicious = 0')
    .bind(score)
    .first();
  return row?.rank || 1;
}

// ── GET /api/leaderboard ──────────────────────────────────────────────────────

async function getLeaderboard(request, env) {
  const url      = new URL(request.url);
  const limit    = Math.max(1, Math.min(MAX_LIMIT, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT));
  const playerId = sanitizePlayerId(url.searchParams.get('playerId'));

  const result = await env.DB.prepare(`
    SELECT player_id AS playerId, name, score, updated_at AS updatedAt
    FROM scores
    WHERE suspicious = 0
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
      .prepare('SELECT score FROM scores WHERE player_id = ?1 AND suspicious = 0')
      .bind(playerId)
      .first();
    if (mine) myRank = { rank: await getRank(env.DB, mine.score), score: mine.score };
  }

  return json(request, { entries, myRank });
}

// ── POST /api/leaderboard (submit score) ─────────────────────────────────────

async function submitScore(request, env) {
  let payload;
  try { payload = await request.json(); } catch (_) {
    return json(request, { error: 'invalid json' }, 400);
  }

  const playerId = sanitizePlayerId(payload.playerId);
  if (!playerId) return json(request, { error: 'invalid player id' }, 400);

  const requestedScore = clampScore(payload.score);
  if (requestedScore <= 0) return json(request, { error: 'score must be positive' }, 400);

  // Trust only the server-validated accepted_score to guard against client inflation
  const saveRow = await env.DB
    .prepare('SELECT accepted_score, suspicious FROM player_saves WHERE player_id = ?1')
    .bind(playerId)
    .first();

  const trustedScore = saveRow
    ? Math.min(requestedScore, Number(saveRow.accepted_score || 0))
    : requestedScore;
  const suspicious = Number(saveRow?.suspicious || 0);

  if (trustedScore <= 0) return json(request, { error: 'save not validated yet' }, 409);

  await upsertScore(env.DB, playerId, sanitizeName(payload.name), trustedScore, Date.now(), suspicious);

  return json(request, {
    ok:         true,
    rank:       suspicious ? null : await getRank(env.DB, trustedScore),
    score:      trustedScore,
    suspicious: !!suspicious,
  });
}

async function upsertScore(db, playerId, name, score, now, suspicious = 0) {
  await db.prepare(`
    INSERT INTO scores (player_id, name, score, created_at, updated_at, last_submit_ms, submit_count, suspicious)
    VALUES (?1, ?2, ?3, datetime('now'), datetime('now'), ?4, 1, ?5)
    ON CONFLICT(player_id) DO UPDATE SET
      name         = excluded.name,
      score        = CASE WHEN excluded.score > scores.score THEN excluded.score ELSE scores.score END,
      updated_at   = CASE WHEN excluded.score > scores.score THEN datetime('now') ELSE scores.updated_at END,
      last_submit_ms = excluded.last_submit_ms,
      submit_count = scores.submit_count + 1,
      suspicious   = excluded.suspicious
  `).bind(playerId, name, score, now, suspicious ? 1 : 0).run();
}

// ── GET /api/save ─────────────────────────────────────────────────────────────

async function getSave(request, env) {
  const url      = new URL(request.url);
  const playerId = sanitizePlayerId(url.searchParams.get('playerId'));
  if (!playerId) return json(request, { error: 'invalid player id' }, 400);

  const row = await env.DB.prepare(`
    SELECT player_id AS playerId, name, save_json AS saveJson,
           accepted_score AS acceptedScore, suspicious, updated_at AS updatedAt
    FROM player_saves WHERE player_id = ?1
  `).bind(playerId).first();

  if (!row) return json(request, { save: null });

  const save = JSON.parse(row.saveJson);
  const acceptedScore = clampScore(row.acceptedScore);
  if (Number(save?.bestScore || 0) > acceptedScore) save.bestScore = acceptedScore;

  return json(request, {
    playerId:      row.playerId,
    name:          row.name,
    save,
    acceptedScore: acceptedScore,
    suspicious:    !!row.suspicious,
    updatedAt:     row.updatedAt,
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
  if (!playerId) return json(request, { error: 'invalid player id' }, 400);
  if (recoveryCode.length < 15) return json(request, { error: 'invalid recovery code' }, 400);

  const save = payload.save;
  if (!save || save.version !== 1 || typeof save !== 'object') {
    return json(request, { error: 'invalid save' }, 400);
  }

  const name         = sanitizeName(payload.name);
  const now          = Date.now();
  const recoveryHash = await sha256Hex(recoveryCode);

  const existing = await env.DB.prepare(`
    SELECT accepted_score, suspicious, last_accept_ms AS lastAcceptMs
    FROM player_saves WHERE player_id = ?1
  `).bind(playerId).first();

  const score   = scoreFromSave(save);
  const verdict = validateProgress(existing, save, score, now);

  const sanitizedSave = { version: 1, bestScore: verdict.accepted };
  const saveJson      = JSON.stringify(sanitizedSave).slice(0, 4096);

  await env.DB.prepare(`
    INSERT INTO player_saves
      (player_id, recovery_hash, name, save_json, accepted_score, suspicious,
       created_at, updated_at, last_accept_ms, submit_count)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'), datetime('now'), ?7, 1)
    ON CONFLICT(player_id) DO UPDATE SET
      recovery_hash  = excluded.recovery_hash,
      name           = excluded.name,
      save_json      = excluded.save_json,
      accepted_score = excluded.accepted_score,
      suspicious     = CASE WHEN player_saves.suspicious = 1 OR excluded.suspicious = 1 THEN 1 ELSE 0 END,
      updated_at     = datetime('now'),
      last_accept_ms = excluded.last_accept_ms,
      submit_count   = player_saves.submit_count + 1
  `).bind(playerId, recoveryHash, name, saveJson, verdict.accepted, verdict.suspicious ? 1 : 0, now).run();

  if (verdict.accepted > 0) {
    await upsertScore(env.DB, playerId, name, verdict.accepted, now, verdict.suspicious);
  }

  return json(request, {
    ok:            true,
    acceptedScore: verdict.accepted,
    suspicious:    !!verdict.suspicious,
    reason:        verdict.reason,
    rank:          verdict.suspicious ? null : await getRank(env.DB, verdict.accepted),
  });
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
    SELECT player_id AS playerId, name, save_json AS saveJson,
           accepted_score AS acceptedScore, suspicious, updated_at AS updatedAt
    FROM player_saves WHERE recovery_hash = ?1
  `).bind(recoveryHash).first();

  if (!row) return json(request, { error: 'recovery code not found' }, 404);

  const save          = JSON.parse(row.saveJson);
  const acceptedScore = clampScore(row.acceptedScore);
  if (Number(save?.bestScore || 0) > acceptedScore) save.bestScore = acceptedScore;

  return json(request, {
    playerId:      row.playerId,
    name:          row.name,
    save,
    acceptedScore: acceptedScore,
    suspicious:    !!row.suspicious,
    updatedAt:     row.updatedAt,
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
