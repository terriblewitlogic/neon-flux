CREATE TABLE IF NOT EXISTS scores (
  player_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Player',
  score INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_submit_ms INTEGER NOT NULL DEFAULT 0,
  submit_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_scores_score_updated
ON scores(score DESC, updated_at ASC);
