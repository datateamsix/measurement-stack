import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildLead } from '../functions/lib/lead-model.js';
import { parseStripeSignature } from '../functions/lib/stripe-signature.js';

const validBody = {
  firstName: 'Test',
  lastName: 'Lead',
  workEmail: 'TEST@example.com',
  phone: '2405550101',
  company: 'Example Co',
  jobTitle: 'Analytics Lead',
  companySize: '51-250',
  useCase: 'attribution',
  privacyAccepted: true,
  marketingMeasurementConsent: true,
  eventId: 'event-test-001',
  conversionHappenedAt: 1785904180000,
  person_id: 'person_test_001',
  analytics_user_id: 'analytics_test_001',
  ga_cookie_id: 'GA1.1.123456789.1785904000',
  utm_source: 'linkedin',
  utm_medium: 'paid_social',
  utm_content: 'founder_ad',
  utm_campaign: 'measurestack_demo',
  tracking: {
    person_id: 'person_test_001',
    analytics_user_id: 'analytics_test_001',
    anonymous_user_id: 'anon_test_001',
    ga_cookie_id: 'GA1.1.123456789.1785904000',
    client_id: '123456789.1785904000',
    session_id: '1785904000',
    page_location: 'https://example.pages.dev/',
    page_referrer: '',
    page_title: 'Measurement Stack',
    attribution: {
      first_touch: { utm_source: 'linkedin' },
      last_touch: { utm_source: 'linkedin' }
    }
  }
};

test('buildLead preserves sanitized identity and attribution fields', () => {
  const request = new Request('https://example.pages.dev/api/lead', {
    method: 'POST',
    headers: { 'user-agent': 'node-test' }
  });
  const lead = buildLead(validBody, request);

  assert.equal(lead.eventId, 'event-test-001');
  assert.equal(lead.workEmail, 'test@example.com');
  assert.equal(lead.identity.person_id, 'person_test_001');
  assert.equal(lead.identity.analytics_user_id, 'analytics_test_001');
  assert.equal(lead.identity.ga_client_id, '123456789.1785904000');
  assert.equal(lead.attributionFields.utm_campaign, 'measurestack_demo');
});

test('Stripe signature parser captures timestamp and every v1 signature', () => {
  assert.deepEqual(parseStripeSignature('t=123,v1=abc,v0=old,v1=def'), {
    timestamp: 123,
    signatures: ['abc', 'def']
  });
});

test('every product page includes GTM and shared identity runtime', async () => {
  for (const file of ['index.html', 'pricing.html', 'sign-in.html', 'app.html', 'checkout-success.html']) {
    const html = await readFile(new URL(`../public/${file}`, import.meta.url), 'utf8');
    assert.match(html, /GTM-5MQ3QDNF/);
    assert.match(html, /\/core\.js/);
  }
});

test('lead form contains required hidden identity and UTM fields', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const name of ['person_id', 'analytics_user_id', 'ga_cookie_id', 'utm_source', 'utm_medium', 'utm_content', 'utm_campaign']) {
    assert.match(html, new RegExp(`type="hidden" name="${name}"`));
  }
});

test('D1 migration defines person, identifier, lead, checkout and conversion tables', async () => {
  const sql = await readFile(new URL('../migrations/0001_identity_resolution.sql', import.meta.url), 'utf8');
  for (const table of ['persons', 'identifiers', 'leads', 'checkout_sessions', 'conversion_events']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
});

test('Wrangler binds the production identity database as DB', async () => {
  const config = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(config, /\[\[d1_databases\]\]/);
  assert.match(config, /binding\s*=\s*"DB"/);
  assert.match(config, /database_name\s*=\s*"measurestack-identity"/);
});

test('paid pricing buttons support guest checkout rather than requiring Clerk', async () => {
  const pricing = await readFile(new URL('../public/pricing.js', import.meta.url), 'utf8');
  const checkout = await readFile(new URL('../functions/api/checkout.js', import.meta.url), 'utf8');
  const success = await readFile(new URL('../public/checkout-success.js', import.meta.url), 'utf8');

  assert.match(pricing, /Continue as a guest/);
  assert.match(checkout, /required:\s*false/);
  assert.match(checkout, /authentication_status/);
  assert.match(success, /person_id:\s*tracking\.person_id/);
});
