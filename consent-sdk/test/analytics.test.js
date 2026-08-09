import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { summaryCsv, summaryTable } from '../analytics/index.js';

const source = await readFile(new URL('../src/meridian-consent-analytics.js', import.meta.url), 'utf8');

function browser(states = {}) {
  const payloads = [];
  const subscribers = [];
  const window = {
    dataLayer: [],
    MeridianConsentAnalyticsConfig: {
      siteId: 'measurementstack',
      endpoint: '/api/consent-impact',
      trackedEvents: ['generate_lead'],
    },
    MeridianConsent: {
      getState: () => ({ states }),
      subscribe(listener) { subscribers.push(listener); return () => {}; },
    },
  };
  const context = vm.createContext({
    window,
    navigator: {
      sendBeacon(url, body) {
        payloads.push({ url, body });
        return true;
      },
    },
    Blob,
    Date,
    Set,
    String,
    TypeError,
  });
  vm.runInContext(source, context);
  return { window, payloads, subscribers };
}

async function payloadOf(record) {
  return JSON.parse(await record.body.text());
}

test('analytics module emits only the fixed consent-impact envelope', async () => {
  const { payloads } = browser({ analytics_storage: 'denied', ad_storage: 'denied' });
  assert.equal(payloads.length, 2);
  const payload = await payloadOf(payloads[1]);
  assert.deepEqual(Object.keys(payload).sort(), [
    'ad_personalization', 'ad_storage', 'ad_user_data', 'analytics_storage',
    'event_name', 'occurred_at', 'schema_version', 'sdk_version', 'site_id',
  ]);
  assert.equal(payload.event_name, 'page_view');
  assert.equal(payload.analytics_storage, 'denied');
  assert.equal('client_id' in payload, false);
  assert.equal('url' in payload, false);
});

test('dataLayer observation is allowlist-only', async () => {
  const { window, payloads } = browser({ analytics_storage: 'granted' });
  window.dataLayer.push({ event: 'unapproved_event', email: 'do-not-send@example.com' });
  assert.equal(payloads.length, 2);
  window.dataLayer.push({ event: 'generate_lead', email: 'do-not-send@example.com' });
  assert.equal(payloads.length, 3);
  const payload = await payloadOf(payloads[2]);
  assert.equal(payload.event_name, 'generate_lead');
  assert.equal('email' in payload, false);
});

test('summary table normalizes D1 numeric results', () => {
  assert.deepEqual(summaryTable([{
    dimension: '2026-08-08',
    total_events: '5',
    observed_events: 2,
    consent_denied_events: 3,
    advertising_eligible_events: 1,
    advertising_blocked_events: 4,
  }]), [{
    Dimension: '2026-08-08',
    Events: 5,
    Observed: 2,
    'Consent denied': 3,
    'Denied %': '60.0%',
    'Ads eligible': 1,
    'Ads blocked': 4,
    'Ads blocked %': '80.0%',
  }]);
});

test('CSV export has a stable warehouse-friendly schema and numeric rates', () => {
  const csv = summaryCsv({
    schema_version: '1.0',
    site_id: 'measurementstack',
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-08-09T00:00:00.000Z',
    group_by: 'day',
    rows: [{
      dimension: '2026-08-08',
      total_events: '5',
      observed_events: 2,
      consent_denied_events: 3,
      advertising_eligible_events: 1,
      advertising_blocked_events: 4,
    }],
  });
  const [header, row] = csv.trim().split('\n');
  assert.equal(header, [
    'schema_version', 'site_id', 'period_start', 'period_end', 'group_by', 'dimension',
    'total_events', 'observed_events', 'consent_denied_events', 'analytics_denied_rate',
    'advertising_eligible_events', 'advertising_blocked_events', 'advertising_blocked_rate',
  ].join(','));
  assert.equal(row, [
    '1.0', 'measurementstack', '2026-08-01T00:00:00.000Z', '2026-08-09T00:00:00.000Z',
    'day', '2026-08-08', '5', '2', '3', '0.6', '1', '4', '0.8',
  ].join(','));
});
