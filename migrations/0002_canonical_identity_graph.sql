PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS web_browser_identities (
  web_graph_id TEXT PRIMARY KEY,
  person_id TEXT,
  browser_id TEXT NOT NULL,
  anonymous_id TEXT NOT NULL,
  cdp_anonymous_id TEXT,
  javascript_client_id TEXT,
  network_derived_client_id TEXT,
  ga_client_id TEXT,
  ga_cookie_id TEXT,
  fplc_cookie TEXT,
  fpid_cookie TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_network_observation_id TEXT,
  consent_snapshot_id TEXT,
  storage_schema_version TEXT NOT NULL,
  server_version INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  UNIQUE(browser_id),
  FOREIGN KEY (person_id) REFERENCES persons(person_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_web_identity_person ON web_browser_identities(person_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_web_identity_anonymous ON web_browser_identities(anonymous_id);

CREATE TABLE IF NOT EXISTS external_auth_identities (
  auth_identity_id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  clerk_user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT,
  provider_subject TEXT NOT NULL,
  provider_login TEXT,
  provider_email TEXT,
  verification_status TEXT,
  link_method TEXT NOT NULL DEFAULT 'signup',
  record_status TEXT NOT NULL DEFAULT 'active',
  linked_at TEXT NOT NULL,
  last_authenticated_at TEXT,
  UNIQUE(provider, provider_subject),
  FOREIGN KEY (person_id) REFERENCES persons(person_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_external_auth_person ON external_auth_identities(person_id);
CREATE INDEX IF NOT EXISTS idx_external_auth_clerk ON external_auth_identities(clerk_user_id);

CREATE TABLE IF NOT EXISTS identity_edges (
  edge_id TEXT PRIMARY KEY,
  person_id TEXT,
  left_node_type TEXT NOT NULL,
  left_node_id TEXT NOT NULL,
  right_node_type TEXT NOT NULL,
  right_node_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  resolution_method TEXT NOT NULL,
  evidence_score REAL NOT NULL DEFAULT 0,
  confidence_tier TEXT NOT NULL,
  authoritative_flag INTEGER NOT NULL DEFAULT 0,
  shared_identifier_flag INTEGER NOT NULL DEFAULT 0,
  source_system TEXT NOT NULL,
  source_event_id TEXT,
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  consent_snapshot_id TEXT,
  resolution_version TEXT NOT NULL DEFAULT 'identity-rules-v1',
  edge_status TEXT NOT NULL DEFAULT 'active',
  UNIQUE(left_node_type, left_node_id, right_node_type, right_node_id, relationship_type),
  FOREIGN KEY (person_id) REFERENCES persons(person_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_identity_edges_person ON identity_edges(person_id, last_observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_identity_edges_left ON identity_edges(left_node_type, left_node_id);
CREATE INDEX IF NOT EXISTS idx_identity_edges_right ON identity_edges(right_node_type, right_node_id);

CREATE TABLE IF NOT EXISTS network_observations (
  network_observation_id TEXT PRIMARY KEY,
  browser_id TEXT,
  person_id TEXT,
  ip_mode TEXT NOT NULL,
  anonymized_ip TEXT,
  js_client_id TEXT,
  country_code TEXT,
  region_code TEXT,
  geoid TEXT,
  observed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES persons(person_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_network_browser ON network_observations(browser_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_network_person ON network_observations(person_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS lifecycle_events (
  lifecycle_event_id TEXT PRIMARY KEY,
  person_id TEXT,
  browser_id TEXT,
  event_name TEXT NOT NULL,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  source_event_id TEXT,
  lead_id TEXT,
  checkout_session_id TEXT,
  subscription_id TEXT,
  plan_id TEXT,
  occurred_at TEXT NOT NULL,
  payload_json TEXT,
  FOREIGN KEY (person_id) REFERENCES persons(person_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_lifecycle_person ON lifecycle_events(person_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_lifecycle_browser ON lifecycle_events(browser_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS billing_aliases (
  billing_alias_id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  alias_type TEXT NOT NULL,
  alias_value TEXT NOT NULL,
  relationship_type TEXT NOT NULL DEFAULT 'primary',
  first_linked_at TEXT NOT NULL,
  last_confirmed_at TEXT NOT NULL,
  active_flag INTEGER NOT NULL DEFAULT 1,
  UNIQUE(alias_type, alias_value),
  FOREIGN KEY (person_id) REFERENCES persons(person_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_billing_alias_person ON billing_aliases(person_id);
