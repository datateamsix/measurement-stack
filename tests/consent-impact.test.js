import assert from 'node:assert/strict';
import test from 'node:test';
import {
  geographicBucket,
  normalizeImpactEnvelope,
} from '../functions/lib/consent-impact.js';
import { onRequestGet, onRequestPost } from '../functions/api/consent-impact.js';

const env = { CONSENT_ANALYTICS_SITE_IDS: 'measurementstack' };

test('collector derives denied outcomes instead of trusting the client', () => {
  const result = normalizeImpactEnvelope({
    schema_version: '1.0',
    site_id: 'measurementstack',
    event_name: 'page_view',
    analytics_storage: 'denied',
    ad_storage: 'granted',
    ad_user_data: 'denied',
    ad_personalization: 'granted',
    analytics_outcome: 'observed',
    advertising_outcome: 'eligible',
  }, env);
  assert.equal(result.analytics_outcome, 'modeled_signal');
  assert.equal(result.advertising_outcome, 'blocked');
  assert.equal(result.consent_profile, 'analytics_denied_ads_denied');
});

test('collector accepts only registered sites and stable event names', () => {
  assert.throws(() => normalizeImpactEnvelope({
    schema_version: '1.0', site_id: 'other', event_name: 'page_view',
  }, env), /not registered/);
  assert.throws(() => normalizeImpactEnvelope({
    schema_version: '1.0', site_id: 'measurementstack', event_name: 'Page View!',
  }, env), /event_name is invalid/);
});

test('geography is derived from Cloudflare request metadata', () => {
  const request = { cf: { country: 'DE' }, headers: new Headers(), url: 'https://example.com' };
  assert.deepEqual(geographicBucket(request), { country_code: 'DE', region_group: 'EEA_UK' });
});

test('ingestion aggregates the fixed envelope and summary reads require a token', async () => {
  const writes = [];
  const database = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() { writes.push({ sql, values }); return { success: true }; },
            async all() {
              return {
                results: [{
                  dimension: 'page_view',
                  total_events: 10,
                  observed_events: 4,
                  consent_denied_events: 6,
                  advertising_eligible_events: 3,
                  advertising_blocked_events: 7,
                }],
              };
            },
          };
        },
      };
    },
  };
  const functionEnv = {
    ...env,
    DB: database,
    CONSENT_ANALYTICS_READ_TOKEN: 'test-token',
  };
  const request = new Request('https://measurementstack.com/api/consent-impact', {
    method: 'POST',
    headers: { Origin: 'https://measurementstack.com', 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({
      schema_version: '1.0',
      site_id: 'measurementstack',
      event_name: 'page_view',
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    }),
  });
  Object.defineProperty(request, 'cf', { value: { country: 'DE' } });
  const ingestion = await onRequestPost({ request, env: functionEnv });
  assert.equal(ingestion.status, 202);
  assert.equal(writes.length, 1);
  assert.ok(writes[0].values.includes('DE'));
  assert.equal(writes[0].values.some((value) => String(value).includes('test-token')), false);

  const unauthorized = await onRequestGet({
    request: new Request('https://measurementstack.com/api/consent-impact?site_id=measurementstack'),
    env: functionEnv,
  });
  assert.equal(unauthorized.status, 401);

  const summary = await onRequestGet({
    request: new Request('https://measurementstack.com/api/consent-impact?site_id=measurementstack&group_by=event', {
      headers: { Authorization: 'Bearer test-token' },
    }),
    env: functionEnv,
  });
  assert.equal(summary.status, 200);
  const result = await summary.json();
  assert.equal(result.totals.analytics_denied_rate, 0.6);
  assert.equal(result.totals.advertising_blocked_rate, 0.7);
});
