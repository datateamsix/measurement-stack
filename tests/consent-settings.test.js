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

test('Meridian Consent is the only site consent runtime', async () => {
  const core = await read('public/core.js');
  assert.match(core, /meridian\.getState/);
  assert.match(core, /MeridianConsent.*subscribe|meridian\.subscribe/);
  assert.doesNotMatch(core, /initializeConsent|consent_update|data-consent-settings|gtag\('consent'/);
});

test('every GTM page loads Meridian synchronously before the container', async () => {
  for (const page of ['index.html', 'pricing.html', 'sign-in.html', 'app.html', 'checkout-success.html']) {
    const html = await read(`public/${page}`);
    const configAt = html.indexOf('window.MeridianConsentConfig');
    const sdkAt = html.indexOf('/consent/meridian-consent.min.js');
    const gtmAt = html.indexOf('GTM-5MQ3QDNF');
    assert.ok(configAt >= 0 && configAt < sdkAt && sdkAt < gtmAt, `${page} must load Meridian before GTM`);
    assert.match(html, /\/consent\/meridian-consent\.min\.css/);
    assert.match(html, /data-meridian-consent-settings/, `${page} is missing the settings link`);
    assert.doesNotMatch(html, /id="consent-banner"|data-consent-settings|gtag\('consent', 'default'/);
  }
});

test('identity graph consumes granular Meridian state without owning consent storage', async () => {
  const graph = await read('public/identity-graph.js');
  for (const type of consentTypes) assert.match(graph, new RegExp(type));
  assert.match(graph, /MeridianConsent\?\.getState/);
  assert.match(graph, /meridian_revision_id/);
  assert.doesNotMatch(graph, /LEGACY\.consent|localStorage\.setItem\(LEGACY\.consent/);
});

test('deployed consent assets exactly match the package build', async () => {
  for (const asset of ['meridian-consent.min.js', 'meridian-consent.min.css']) {
    assert.equal(await read(`public/consent/${asset}`), await read(`consent-sdk/dist/${asset}`));
  }
});
