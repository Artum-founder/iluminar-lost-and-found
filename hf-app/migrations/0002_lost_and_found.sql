-- Lost & found: claims, bin votes, item statuses and the crew key (hash only).
-- Additive only.
CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  tag TEXT NOT NULL,
  type TEXT NOT NULL,
  wish TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '',
  how TEXT NOT NULL DEFAULT '',
  owner_contact TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '',
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS claims_tag ON claims (tag);
CREATE INDEX IF NOT EXISTS claims_ip_time ON claims (ip_hash, created_at);

CREATE TABLE IF NOT EXISTS votes (
  tag TEXT NOT NULL,
  voter TEXT NOT NULL,
  vote TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tag, voter)
);

CREATE TABLE IF NOT EXISTS item_status (
  tag TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS crew_keys (
  hash TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO crew_keys (hash, label) VALUES ('125038e383de15a74aabe587515c3b429a788eae193cb23fd35bc0d32a6bd6e3', 'Peder');
