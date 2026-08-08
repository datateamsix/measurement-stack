import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const TYPES = [
  'security_storage',
  'functionality_storage',
  'personalization_storage',
  'analytics_storage',
  'ad_storage',
  'ad_user_data',
  'ad_personalization',
];

test('GTM template uses native consent APIs and has least-purpose permissions', async () => {
  const template = await readFile(new URL('../gtm/meridian-consent-template.tpl', import.meta.url), 'utf8');
  assert.match(template, /setDefaultConsentState/);
  assert.match(template, /updateConsentState/);
  assert.doesNotMatch(template, /gtag\(['"]consent/);
  assert.match(template, /get_cookies/);
  assert.match(template, /read_data_layer/);
  assert.match(template, /access_consent/);
  for (const type of TYPES) assert.match(template, new RegExp(type));
});

test('starter container imports the full event contract with inert examples', async () => {
  const contents = await readFile(new URL('../gtm/meridian-consent-starter-container.json', import.meta.url), 'utf8');
  const exported = JSON.parse(contents);
  const version = exported.containerVersion;
  const names = version.variable.map(({ name }) => name);

  assert.equal(exported.exportFormatVersion, 2);
  assert.equal(version.variable.length, 9);
  assert.ok(names.some((name) => name.includes('Analytics Storage')));
  assert.ok(names.some((name) => name.includes('Ad User Data')));
  assert.ok(version.trigger.some(({ name }) => name.includes('Analytics Granted')));
  assert.ok(version.trigger.some(({ name }) => name.includes('Advertising Granted')));
  assert.ok(version.tag.length >= 2);
  assert.ok(version.tag.every(({ paused }) => paused === true));
  for (const tag of version.tag) {
    assert.equal(tag.consentSettings.consentType.type, 'LIST');
    assert.ok(tag.consentSettings.consentType.list.every(({ type }) => type === 'STRING'));
  }
});
