-- Local runtime staff sessions; intentionally not synchronized between Pi and Cloudflare.
CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','staff')),
  display_name TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT '{}',
  scope TEXT NOT NULL CHECK (scope IN ('admin','kitchen')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_auth_sessions_expiry ON auth_sessions(expires_at);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(username, scope);
