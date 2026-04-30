CREATE TABLE IF NOT EXISTS player_saves (
  player_id TEXT PRIMARY KEY,
  recovery_hash TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT 'Player',
  save_json TEXT NOT NULL,
  accepted_score INTEGER NOT NULL DEFAULT 0,
  suspicious INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_accept_ms INTEGER NOT NULL DEFAULT 0,
  submit_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_player_saves_recovery_hash
ON player_saves(recovery_hash);

CREATE INDEX IF NOT EXISTS idx_player_saves_score
ON player_saves(accepted_score DESC, updated_at ASC);

ALTER TABLE scores ADD COLUMN suspicious INTEGER NOT NULL DEFAULT 0;
