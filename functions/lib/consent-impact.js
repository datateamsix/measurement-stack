import { HttpError, text } from './http.js';

export const CONSENT_IMPACT_SCHEMA_VERSION = '1.0';
const STATES = new Set(['granted', 'denied']);
const EVENT_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const SITE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const EEA_UK = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'GB',
]);

function storage(env) {
  return env.CONSENT_ANALYTICS_DB || env.DB || null;
}

function allowedSites(env) {
  return new Set(text(env.CONSENT_ANALYTICS_SITE_IDS, 2000)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean));
}

function state(value) {
  return STATES.has(value) ? value : 'denied';
}

function fullAdvertising(states) {
  return states.ad_storage === 'granted'
    && states.ad_user_data === 'granted'
    && states.ad_personalization === 'granted';
}

export function normalizeImpactEnvelope(input, env) {
  const siteId = text(input?.site_id, 64).toLowerCase();
  const eventName = text(input?.event_name, 64).toLowerCase();
  if (!SITE_PATTERN.test(siteId)) throw new HttpError(400, 'site_id is invalid.');
  if (!EVENT_PATTERN.test(eventName)) throw new HttpError(400, 'event_name is invalid.');
  if (input?.schema_version !== CONSENT_IMPACT_SCHEMA_VERSION) {
    throw new HttpError(400, `schema_version must be ${CONSENT_IMPACT_SCHEMA_VERSION}.`);
  }
  const sites = allowedSites(env);
  if (sites.size && !sites.has(siteId)) throw new HttpError(403, 'site_id is not registered.');

  const states = {
    analytics_storage: state(input.analytics_storage),
    ad_storage: state(input.ad_storage),
    ad_user_data: state(input.ad_user_data),
    ad_personalization: state(input.ad_personalization),
  };
  const adsGranted = fullAdvertising(states);
  return {
    site_id: siteId,
    event_name: eventName,
    consent_profile: `${states.analytics_storage === 'granted' ? 'analytics_granted' : 'analytics_denied'}_${adsGranted ? 'ads_granted' : 'ads_denied'}`,
    analytics_outcome: states.analytics_storage === 'granted' ? 'observed' : 'modeled_signal',
    advertising_outcome: adsGranted ? 'eligible' : 'blocked',
  };
}

export function geographicBucket(request) {
  const country = text(request.cf?.country || request.headers.get('cf-ipcountry'), 2).toUpperCase();
  const countryCode = /^[A-Z]{2}$/.test(country) ? country : 'XX';
  return {
    country_code: countryCode,
    region_group: EEA_UK.has(countryCode) ? 'EEA_UK' : 'OTHER',
  };
}

export async function incrementImpact(env, impact, geography, now = new Date()) {
  const db = storage(env);
  if (!db) throw new HttpError(503, 'Consent analytics storage is not configured.');
  const bucketStart = now.toISOString().slice(0, 13) + ':00:00.000Z';
  const updatedAt = now.toISOString();
  await db.prepare(`
    INSERT INTO consent_impact_hourly (
      site_id, bucket_start, country_code, region_group, event_name,
      consent_profile, analytics_outcome, advertising_outcome, event_count, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT (
      site_id, bucket_start, country_code, event_name, consent_profile,
      analytics_outcome, advertising_outcome
    ) DO UPDATE SET
      event_count = event_count + 1,
      updated_at = excluded.updated_at
  `).bind(
    impact.site_id,
    bucketStart,
    geography.country_code,
    geography.region_group,
    impact.event_name,
    impact.consent_profile,
    impact.analytics_outcome,
    impact.advertising_outcome,
    updatedAt,
  ).run();
}

const GROUPS = Object.freeze({
  day: "substr(bucket_start, 1, 10)",
  country: 'country_code',
  region: 'region_group',
  event: 'event_name',
  consent: 'consent_profile',
});

export async function impactSummary(env, { siteId, from, to, groupBy = 'day' }) {
  const db = storage(env);
  if (!db) throw new HttpError(503, 'Consent analytics storage is not configured.');
  const groupExpression = GROUPS[groupBy];
  if (!groupExpression) throw new HttpError(400, 'group_by must be day, country, region, event, or consent.');
  if (!SITE_PATTERN.test(siteId)) throw new HttpError(400, 'site_id is invalid.');
  const sites = allowedSites(env);
  if (sites.size && !sites.has(siteId)) throw new HttpError(403, 'site_id is not registered.');

  const result = await db.prepare(`
    SELECT
      ${groupExpression} AS dimension,
      SUM(event_count) AS total_events,
      SUM(CASE WHEN analytics_outcome = 'observed' THEN event_count ELSE 0 END) AS observed_events,
      SUM(CASE WHEN analytics_outcome = 'modeled_signal' THEN event_count ELSE 0 END) AS consent_denied_events,
      SUM(CASE WHEN advertising_outcome = 'eligible' THEN event_count ELSE 0 END) AS advertising_eligible_events,
      SUM(CASE WHEN advertising_outcome = 'blocked' THEN event_count ELSE 0 END) AS advertising_blocked_events
    FROM consent_impact_hourly
    WHERE site_id = ? AND bucket_start >= ? AND bucket_start < ?
    GROUP BY ${groupExpression}
    ORDER BY ${groupExpression} ASC
  `).bind(siteId, from, to).all();
  return result.results || [];
}
