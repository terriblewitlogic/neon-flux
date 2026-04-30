// ─── Neon Flux platform — name + recovery code identity, cloud leaderboard ────

const LOCAL_PLAYER_ID_KEY    = 'neon-flux_player_id_v1';
const LOCAL_PLAYER_NAME_KEY  = 'neon-flux_player_name_v1';
const LOCAL_RECOVERY_CODE_KEY = 'neon-flux_recovery_code_v1';
const LOCAL_BEST_KEY         = 'neonvoid_best';

export interface LeaderboardEntry {
  rank:         number;
  playerId:     string;
  username:     string;
  score:        number;
  isCurrentUser: boolean;
}

function getApiBase(): string {
  const h = window.location.hostname;
  if (h === 'neon-flux.org' || h === 'www.neon-flux.org') return '/api';
  return 'https://neon-flux.org/api';
}

function apiUrl(path: string): string {
  return getApiBase().replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}

export function getLocalPlayerId(): string {
  let id = '';
  try { id = localStorage.getItem(LOCAL_PLAYER_ID_KEY) || ''; } catch (_) {}
  if (!id) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    id = Array.from(bytes, (b: number) => b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem(LOCAL_PLAYER_ID_KEY, id); } catch (_) {}
  }
  return id;
}

export function getLocalPlayerName(): string {
  try { return localStorage.getItem(LOCAL_PLAYER_NAME_KEY) || 'Player'; } catch (_) { return 'Player'; }
}

export function setLocalPlayerName(name: string): string {
  const cleaned = String(name || 'Player')
    .replace(/[^\w .'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 18) || 'Player';
  try { localStorage.setItem(LOCAL_PLAYER_NAME_KEY, cleaned); } catch (_) {}
  return cleaned;
}

export function getRecoveryCode(): string {
  let code = '';
  try { code = localStorage.getItem(LOCAL_RECOVERY_CODE_KEY) || ''; } catch (_) {}
  if (!code) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    const raw = Array.from(bytes, (b: number) => chars[b % chars.length]).join('');
    code = raw.match(/.{1,5}/g)!.join('-');
    try { localStorage.setItem(LOCAL_RECOVERY_CODE_KEY, code); } catch (_) {}
  }
  return code;
}

function normalizeRecoveryCode(code: string): string {
  const raw = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return raw.match(/.{1,5}/g)?.join('-') || raw;
}

export function getPersonalBest(): number {
  try { return parseInt(localStorage.getItem(LOCAL_BEST_KEY) || '0', 10) || 0; } catch (_) { return 0; }
}

export function setPersonalBest(score: number): void {
  try { localStorage.setItem(LOCAL_BEST_KEY, String(score)); } catch (_) {}
}

export async function getLeaderboard(limit = 10): Promise<{
  entries: LeaderboardEntry[];
  myRank: { rank: number; score: number } | null;
}> {
  try {
    const u = new URL(apiUrl('leaderboard'), window.location.href);
    u.searchParams.set('limit', String(limit));
    u.searchParams.set('playerId', getLocalPlayerId());
    const res  = await fetch(u.toString(), { headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) return { entries: [], myRank: null };
    return {
      entries: (data.entries as LeaderboardEntry[]) || [],
      myRank:  (data.myRank as { rank: number; score: number } | null) || null,
    };
  } catch (_) {
    return { entries: [], myRank: null };
  }
}

export async function uploadScore(
  name: string,
  score: number,
): Promise<{ rank?: number; error?: string }> {
  try {
    const res  = await fetch(apiUrl('leaderboard'), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ playerId: getLocalPlayerId(), name, score }),
    });
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) return { error: (data.error as string) || `${res.status}` };
    return data as { rank?: number };
  } catch (err) {
    return { error: String(err) };
  }
}

export async function writeCloudSave(bestScore: number): Promise<void> {
  try {
    await fetch(apiUrl('save'), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        playerId:     getLocalPlayerId(),
        recoveryCode: getRecoveryCode(),
        name:         getLocalPlayerName(),
        save:         { version: 1, bestScore },
      }),
    });
  } catch (_) { /* non-critical */ }
}

export async function recoverSave(rawCode: string): Promise<{
  error?: string;
  name?: string;
  bestScore?: number;
}> {
  const code = normalizeRecoveryCode(rawCode);
  try {
    const res  = await fetch(apiUrl('recover'), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ recoveryCode: code }),
    });
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) return { error: (body.error as string) || `${res.status}` };
    try {
      if (body.playerId) localStorage.setItem(LOCAL_PLAYER_ID_KEY, body.playerId as string);
      localStorage.setItem(LOCAL_RECOVERY_CODE_KEY, code);
      const restoredName = body.name as string | undefined;
      if (restoredName) setLocalPlayerName(restoredName);
      const save = body.save as Record<string, unknown> | undefined;
      const savedBest = Number(save?.bestScore || 0);
      if (savedBest > 0) setPersonalBest(savedBest);
    } catch (_) {}
    const save = body.save as Record<string, unknown> | undefined;
    return {
      name:      body.name as string | undefined,
      bestScore: Number(save?.bestScore || 0),
    };
  } catch (err) {
    return { error: String(err) };
  }
}
