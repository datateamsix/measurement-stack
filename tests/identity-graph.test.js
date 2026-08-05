import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('identity graph browser runtime defines versioned envelopes and structured dataLayer schema', async () => {
  const script = await read('public/identity-graph.js');
  for (const key of [
    'measurementstack.identity_graph.v1',
    'measurementstack.attribution.v1',
    'measurementstack.lifecycle.v1',
    'measurementstack.network.v1',
    'measurementstack.collection_policy.v1',
  ]) {
    assert.match(script, new RegExp(key.replaceAll('.', '\\.')));
  }
  assert.match(script, /measurement_stack\.event/);
  assert.match(script, /measurement_stack\.identity_graph/);
  assert.match(script, /raw_personal_data_in_local_storage:\s*'never'/);
  assert.match(script, /raw_payment_data_in_local_storage:\s*'never'/);
});

test('core loads the canonical identity graph before product initialization', async () => {
  const script = await read('public/core.js');
  assert.match(script, /identity-graph\.js/);
  assert.match(script, /identityReady/);
  assert.match(script, /eventEnvelope/);
  assert.match(script, /trackingContext\(\)/);
});

test('network context defaults to strict IP minimization and never returns raw user-agent', async () => {
  const script = await read('functions/api/network-context.js');
  assert.match(script, /DEFAULT_IP_MODE = 'anonymize_strict'/);
  assert.match(script, /raw_user_agent_returned:\s*false/);
  assert.match(script, /IDENTITY_HASH_SECRET/);
  assert.match(script, /country:/);
});

test('canonical graph migration defines browser, provider, edge, network, lifecycle, and billing tables', async () => {
  const sql = await read('migrations/0002_canonical_identity_graph.sql');
  for (const table of [
    'web_browser_identities',
    'external_auth_identities',
    'identity_edges',
    'network_observations',
    'lifecycle_events',
    'billing_aliases',
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
});

test('Stripe checkout reuses a resolved customer and carries graph metadata', async () => {
  const checkout = await read('functions/api/checkout.js');
  assert.match(checkout, /params\.set\('customer', identity\.stripe_customer_id\)/);
  for (const field of [
    'browser_id',
    'web_graph_id',
    'network_observation_id',
    'consent_snapshot_id',
    'first_touch_id',
    'last_touch_id',
  ]) {
    assert.match(checkout, new RegExp(field));
  }
});

test('pricing exposes copyable Stripe test payment values', async () => {
  const html = await read('public/pricing.html');
  assert.match(html, /4242 4242 4242 4242/);
  assert.match(html, /data-copy-field="card_number"/);
  assert.match(html, /Stripe-hosted Checkout does not permit a site to inject card numbers/);
});

test('workspace renders graph, collection policy, local envelopes, and structured events', async () => {
  const html = await read('public/app.html');
  for (const id of ['graph-summary', 'graph-node-list', 'policy-list', 'envelope-viewer', 'event-stream']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  const dashboard = await read('public/dashboard.js');
  assert.match(dashboard, /identitySnapshot/);
  assert.match(dashboard, /external_auth_identities/);
  assert.match(dashboard, /item\.schema\?\.name/);
});
