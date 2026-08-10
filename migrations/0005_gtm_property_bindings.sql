PRAGMA foreign_keys = ON;

-- A Measurement Stack property owns one explicit GTM workspace selection per
-- authenticated Meridian actor. Names are snapshots for display; numeric IDs
-- remain the source of truth for every Google API request.
CREATE TABLE IF NOT EXISTS meridian_gtm_property_bindings (
  actor_key TEXT NOT NULL,
  property_key TEXT NOT NULL,
  property_name TEXT NOT NULL,
  property_domain TEXT NOT NULL,
  account_id TEXT NOT NULL,
  account_name TEXT,
  container_id TEXT NOT NULL,
  container_name TEXT,
  container_public_id TEXT,
  workspace_id TEXT NOT NULL,
  workspace_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (actor_key, property_key)
);

CREATE INDEX IF NOT EXISTS idx_meridian_gtm_bindings_actor
  ON meridian_gtm_property_bindings(actor_key, updated_at DESC);

-- Explicit review decisions are fingerprint-bound. A GTM edit invalidates the
-- decision automatically because the stored fingerprint no longer matches.
CREATE TABLE IF NOT EXISTS meridian_gtm_tag_decisions (
  actor_key TEXT NOT NULL,
  property_key TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  tag_fingerprint TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  purposes_json TEXT NOT NULL,
  consent_types_json TEXT NOT NULL,
  enforcement TEXT NOT NULL CHECK (enforcement IN ('additional', 'built_in', 'essential')),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (actor_key, property_key, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_meridian_gtm_decisions_property
  ON meridian_gtm_tag_decisions(actor_key, property_key);

-- Records the handoff from a validated workspace to an unpublished GTM
-- container version. Publishing is intentionally outside Meridian.
CREATE TABLE IF NOT EXISTS meridian_gtm_version_exports (
  id TEXT PRIMARY KEY,
  actor_key TEXT NOT NULL,
  property_key TEXT NOT NULL,
  account_id TEXT NOT NULL,
  container_id TEXT NOT NULL,
  source_workspace_id TEXT NOT NULL,
  container_version_id TEXT,
  version_name TEXT,
  unpublished INTEGER NOT NULL CHECK (unpublished = 1),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meridian_gtm_version_exports_property
  ON meridian_gtm_version_exports(actor_key, property_key, created_at DESC);
