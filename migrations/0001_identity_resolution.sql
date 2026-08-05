PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS persons (
  person_id TEXT PRIMARY KEY,
  analytics_user_id TEXT NOT NULL UNIQUE,
  clerk_user_id TEXT UNIQUE,
  primary_email TEXT,
  first_name TEXT,
  last_name TEXT,
  current_plan TEXT NOT NULL DEFAULT 'starter',
  stripe_customer_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS identifiers (
  identifier_id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  identifier_value TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(namespace, identifier_value),
  FOREIGN KEY (person_id) REFERENCES persons(person_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_identifiers_person ON identifiers(person_id);

CREATE TABLE IF NOT EXISTS attribution_touches (
  touch_id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  touch_type TEXT NOT NULL,
  source TEXT,
  medium TEXT,
  campaign TEXT,
  content TEXT,
  landing_page TEXT,
  referrer TEXT,
  click_ids_json TEXT,
  captured_at TEXT NOT NULL,
  FOREIGN KEY (person_id) REFERENCES persons(person_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_touches_person_time ON attribution_touches(person_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS leads (
  lead_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  person_id TEXT,
  email TEXT NOT NULL,
  company TEXT,
  job_title TEXT,
  company_size TEXT,
  use_case TEXT,
  attribution_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_leads_person ON leads(person_id, created_at DESC);

CREATE TABLE IF NOT EXISTS checkout_sessions (
  stripe_session_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  amount_total INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'usd',
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  stripe_customer_id TEXT,
  webhook_received INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checkout_person ON checkout_sessions(person_id, created_at DESC);

CREATE TABLE IF NOT EXISTS conversion_events (
  conversion_id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  person_id TEXT,
  source TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  payload_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(event_id, event_name, source)
);
CREATE INDEX IF NOT EXISTS idx_conversion_person ON conversion_events(person_id, created_at DESC);
