PRAGMA foreign_keys = ON;

-- Privacy-preserving counters only. One row represents an aggregate bucket;
-- no browser, client, user, session, IP, URL, or click identifiers are stored.
CREATE TABLE IF NOT EXISTS consent_impact_hourly (
  site_id TEXT NOT NULL,
  bucket_start TEXT NOT NULL,
  country_code TEXT NOT NULL DEFAULT 'XX',
  region_group TEXT NOT NULL DEFAULT 'OTHER',
  event_name TEXT NOT NULL,
  consent_profile TEXT NOT NULL,
  analytics_outcome TEXT NOT NULL,
  advertising_outcome TEXT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (
    site_id,
    bucket_start,
    country_code,
    event_name,
    consent_profile,
    analytics_outcome,
    advertising_outcome
  )
);

CREATE INDEX IF NOT EXISTS idx_consent_impact_site_time
  ON consent_impact_hourly(site_id, bucket_start);

CREATE INDEX IF NOT EXISTS idx_consent_impact_region_time
  ON consent_impact_hourly(site_id, region_group, bucket_start);
