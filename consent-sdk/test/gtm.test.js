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

const PARAMETER_TYPES = new Set([
  'BOOLEAN',
  'INTEGER',
  'LIST',
  'MAP',
  'TEMPLATE',
  'TRIGGER_REFERENCE',
  'TAG_REFERENCE',
]);

function assertValidParameterEnums(value) {
  if (Array.isArray(value)) {
    value.forEach(assertValidParameterEnums);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const isParameter = 'type' in value && ['key', 'value', 'list', 'map'].some((key) => key in value);
  if (isParameter) assert.ok(PARAMETER_TYPES.has(value.type), `Unsupported GTM Parameter.Type: ${value.type}`);
  Object.values(value).forEach(assertValidParameterEnums);
}

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
  assertValidParameterEnums(exported);
  for (const tag of version.tag) {
    assert.deepEqual(tag.consentSettings, { consentStatus: 'NOT_SET' });
  }
});

test('versioned starter artifact is cache-safe and contains no STRING enum', async () => {
  const contents = await readFile(
    new URL('../gtm/meridian-consent-starter-container-v0.1.2.json', import.meta.url),
    'utf8',
  );
  const exported = JSON.parse(contents);

  assert.doesNotMatch(contents, /"type"\s*:\s*"STRING"/);
  assertValidParameterEnums(exported);
  assert.equal(exported.containerVersion.variable.length, 9);
  assert.equal(exported.containerVersion.trigger.length, 4);
  assert.equal(exported.containerVersion.tag.length, 2);
  assert.ok(exported.containerVersion.tag.every(({ consentSettings }) => (
    consentSettings.consentStatus === 'NOT_SET' && !('consentType' in consentSettings)
  )));
});
