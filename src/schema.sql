CREATE TABLE IF NOT EXISTS short_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  url TEXT NOT NULL,
  owner_user_id INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  click_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_short_links_code_ci ON short_links(code COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS short_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  ip TEXT,
  initial_url TEXT NOT NULL,
  visited_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_short_visits_code ON short_visits(code);
CREATE INDEX IF NOT EXISTS idx_short_visits_visited ON short_visits(visited_at);
