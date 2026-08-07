import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const consentTypes = [
  'ad_storage',
  'analytics_storage',
  'ad_user_data',
  'ad_personalization',
  'functionality_storage',
  'personalization_storage',
  'security_storage',
];

test('consent settings map one-to-one to every Google consent type', async () => {
  const core = await read('public/core.js');
  for (const type of consentTypes) assert.match(core, new RegExp(type));
  assert.match(core, /security_storage:\s*true/);
  assert.match(core, /gtag\('consent', type/);
  assert.match(core, /consent_update/);
  assert.match(core, /data-consent-settings/);
});

test('every GTM page establishes all consent defaults before the container', async () => {
  for (const page of ['index.html', 'pricing.html', 'sign-in.html', 'app.html', 'checkout-success.html']) {
    const html = await read(`public/${page}`);
    const defaultsAt = html.indexOf("gtag('consent', 'default'");
    const gtmAt = html.indexOf('GTM-5MQ3QDNF');
    assert.ok(defaultsAt >= 0 && defaultsAt < gtmAt, `${page} must establish defaults before GTM`);
    for (const type of consentTypes) assert.match(html, new RegExp(type), `${page} is missing ${type}`);
    assert.match(html, /data-consent-settings/, `${page} is missing the settings link`);
  }
});

test('identity graph persists granular consent while retaining compatibility aliases', async () => {
  const graph = await read('public/identity-graph.js');
  for (const type of consentTypes) assert.match(graph, new RegExp(type));
  assert.match(graph, /marketing:\s*adStorage \|\| adUserData \|\| adPersonalization/);
});
