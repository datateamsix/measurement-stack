PRAGMA foreign_keys = ON;

-- Single-use OAuth requests. State is stored only as a SHA-256 digest and the
-- PKCE verifier is encrypted with OAUTH_TOKEN_ENCRYPTION_KEY.
CREATE TABLE IF NOT EXISTS meridian_oauth_states (
  state_hash TEXT PRIMARY KEY,
  actor_key TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google_gtm')),
  verifier_ciphertext TEXT NOT NULL,
  return_to TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meridian_oauth_states_expiry
  ON meridian_oauth_states(expires_at);

-- OAuth tokens are stored as AES-256-GCM ciphertext. actor_key is a one-way
-- digest of the Clerk user ID or the local test-session identifier.
CREATE TABLE IF NOT EXISTS meridian_integrations (
  id TEXT PRIMARY KEY,
  actor_key TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google_gtm')),
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error', 'revoked')),
  granted_scope TEXT NOT NULL,
  token_ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_tested_at TEXT,
  last_error TEXT,
  UNIQUE(actor_key, provider)
);

CREATE INDEX IF NOT EXISTS idx_meridian_integrations_actor
  ON meridian_integrations(actor_key, provider);
