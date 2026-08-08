import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/meridian-consent.js', import.meta.url), 'utf8');
const TYPES = [
  'security_storage',
  'functionality_storage',
  'personalization_storage',
  'analytics_storage',
  'ad_storage',
  'ad_user_data',
  'ad_personalization',
];

function browser() {
  let cookie = '';
  const dataLayer = [];
  const window = {
    dataLayer,
    MeridianConsentConfig: { autoShow: false },
    addEventListener() {},
    dispatchEvent() {},
  };
  const document = {
    currentScript: { dataset: {} },
    scripts: [],
    readyState: 'loading',
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    get cookie() { return cookie; },
    set cookie(value) { cookie = value; },
  };
  const context = vm.createContext({
    window,
    document,
    location: { protocol: 'https:' },
    CustomEvent: class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    console,
    Date,
    Math,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Set,
    TypeError,
    encodeURIComponent,
    decodeURIComponent,
  });
  vm.runInContext(source, context);
  return { window, document, dataLayer, cookie: () => cookie };
}

test('initializes denied-by-default before emitting the ready event', () => {
  const { window, dataLayer } = browser();
  const defaultCommand = dataLayer.find((entry) => Object.prototype.toString.call(entry) === '[object Arguments]');
  const ready = dataLayer.find((entry) => entry.event === 'meridian_consent_ready');

  assert.equal(defaultCommand[0], 'consent');
  assert.equal(defaultCommand[1], 'default');
  assert.equal(defaultCommand[2].security_storage, 'granted');
  for (const type of TYPES.filter((type) => type !== 'security_storage')) assert.equal(defaultCommand[2][type], 'denied');
  assert.equal(ready.meridian_consent.has_choice, false);
  assert.equal(window.MeridianConsent.version, '0.1.0');
});

test('saves a granular choice, updates Google, and emits one stable GTM envelope', () => {
  const { window, dataLayer, cookie } = browser();
  const result = window.MeridianConsent.save({ analytics_storage: 'granted', security_storage: 'denied' });
  const update = dataLayer.find((entry) => entry.event === 'meridian_consent_updated');

  assert.equal(result.states.analytics_storage, 'granted');
  assert.equal(result.states.security_storage, 'granted');
  assert.equal(result.states.ad_storage, 'denied');
  assert.equal(update.meridian_consent.source, 'api_save');
  assert.equal(update.meridian_consent.schema_version, '1.0');
  assert.match(cookie(), /^meridian_consent=/);
  assert.equal(window.MeridianConsent.has('analytics_storage'), true);
  assert.equal(window.MeridianConsent.has('ad_storage'), false);
});

test('accept and reject helpers always preserve required security storage', () => {
  const { window } = browser();
  const accepted = window.MeridianConsent.acceptAll();
  for (const type of TYPES) assert.equal(accepted.states[type], 'granted');

  const rejected = window.MeridianConsent.rejectOptional();
  assert.equal(rejected.states.security_storage, 'granted');
  for (const type of TYPES.filter((type) => type !== 'security_storage')) assert.equal(rejected.states[type], 'denied');
});

test('subscription returns an unsubscribe function', () => {
  const { window } = browser();
  let calls = 0;
  const unsubscribe = window.MeridianConsent.subscribe(() => { calls += 1; });
  window.MeridianConsent.rejectOptional();
  unsubscribe();
  window.MeridianConsent.acceptAll();
  assert.equal(calls, 1);
});
