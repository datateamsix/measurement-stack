import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildLead, onRequestPost } from '../functions/api/lead.js';

const body = {
  firstName: 'Test',
  lastName: 'Lead',
  workEmail: 'test@example.com',
  company: 'Example Co',
  jobTitle: 'Analytics Lead',
  companySize: '51-250',
  useCase: 'attribution',
  privacyAccepted: true,
  marketingMeasurementConsent: true,
  eventId: 'event-test-001',
  conversionHappenedAt: 1785904180000,
  person_id: 'person_test_001',
  analytics_user_id: 'user_test_001',
  ga_cookie_id: 'GA1.1.123456789.1785904000',
  utm_source: 'linkedin',
  utm_medium: 'paid_social',
  utm_content: 'founder_ad',
  utm_campaign: 'measurestack_demo',
  tracking: { client_id: '123456789.1785904000' }
};

test('buildLead preserves identity and attribution fields', () => {
  const request = new Request('https://example.pages.dev/api/lead');
  const lead = buildLead(body, request);
  assert.equal(lead.eventId, 'event-test-001');
  assert.equal(lead.identity.person_id, 'person_test_001');
  assert.equal(lead.attributionFields.utm_campaign, 'measurestack_demo');
});

test('valid lead returns 201 and shared event ID', async () => {
  const request = new Request('https://example.pages.dev/api/lead', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const response = await onRequestPost({ request, env: {} });
  const result = await response.json();
  assert.equal(response.status, 201);
  assert.equal(result.eventId, 'event-test-001');
  assert.match(result.leadId, /^[0-9a-f-]{36}$/i);
});

test('privacy acceptance is required', async () => {
  const request = new Request('https://example.pages.dev/api/lead', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, privacyAccepted: false })
  });
  const response = await onRequestPost({ request, env: {} });
  assert.equal(response.status, 400);
});

test('HTML includes GTM and required hidden fields', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /GTM-5MQ3QDNF/);
  for (const name of ['person_id','analytics_user_id','ga_cookie_id','utm_source','utm_medium','utm_content','utm_campaign']) {
    assert.match(html, new RegExp(`type="hidden" name="${name}"`));
  }
});
