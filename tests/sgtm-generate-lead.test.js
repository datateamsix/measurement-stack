import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Wrangler points sGTM traffic to the Stape Data Client path', async () => {
  const wrangler = await read('wrangler.toml');
  assert.match(wrangler, /SGTM_EVENT_ENDPOINT = "https:\/\/edge\.measurementstack\.com\/data"/);
  assert.match(wrangler, /SGTM_PROTOCOL_VERSION = "2"/);
});

test('server relay uses Stape Data Client protocol and supports preview header', async () => {
  const integrations = await read('functions/lib/integrations.js');
  assert.match(integrations, /searchParams\.set\('v', protocolVersion\)/);
  assert.match(integrations, /searchParams\.set\('event_name', eventName\)/);
  assert.match(integrations, /X-Gtm-Server-Preview/);
  assert.match(integrations, /stape_data_client/);
});

test('generate_lead server payload keeps the shared event ID and consent gates match data', async () => {
  const conversion = await read('functions/lib/conversion-event.js');
  assert.match(conversion, /event_name: 'generate_lead'/);
  assert.match(conversion, /event_id: lead\.eventId/);
  assert.match(conversion, /event_source: 'backend'/);
  assert.match(conversion, /advertising_measurement_consent: advertisingGranted/);
  assert.match(conversion, /sha256_email_address/);
  assert.match(conversion, /sha256_external_id/);
  assert.match(conversion, /cf-connecting-ip/);
  assert.match(conversion, /if \(advertisingGranted\)/);
});

test('lead API sends the authoritative conversion to sGTM only with measurement consent', async () => {
  const lead = await read('functions/api/lead.js');
  assert.match(lead, /buildGenerateLeadServerEvent/);
  assert.match(lead, /serverMeasurementAllowed/);
  assert.match(lead, /\? sendServerEvent\(env, serverEvent\)/);
  assert.match(lead, /settleDelivery\('sgtm', sgtmDelivery\)/);
  assert.match(lead, /skipped: 'consent_denied'/);
});
