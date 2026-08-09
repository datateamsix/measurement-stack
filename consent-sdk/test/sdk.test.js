import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

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

function browser(legacyChoice = null, settings = {}) {
  let cookie = '';
  const events = [];
  const storage = new Map(legacyChoice ? [['meridian_consent_v1', JSON.stringify(legacyChoice)]] : []);
  const dataLayer = [];
  const window = {
    dataLayer,
    MeridianConsentConfig: { autoShow: false, ...(settings.config || {}) },
    addEventListener() {},
    dispatchEvent(event) { events.push(event); },
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
    Uint32Array,
    TypeError,
    crypto: webcrypto,
    navigator: { globalPrivacyControl: settings.gpc === true },
    localStorage: {
      getItem(key) { return storage.get(key) || null; },
      removeItem(key) { storage.delete(key); },
    },
    encodeURIComponent,
    decodeURIComponent,
  });
  vm.runInContext(source, context);
  return { window, document, dataLayer, cookie: () => cookie, storage, events };
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
  assert.equal(window.MeridianConsent.version, '0.2.0');
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

test('migrates the previous site choice into the Meridian cookie once', () => {
  const { window, cookie, storage } = browser({ analytics: true, marketing: false });
  const current = window.MeridianConsent.getState();
  assert.equal(current.has_choice, true);
  assert.equal(current.states.analytics_storage, 'granted');
  assert.equal(current.states.ad_storage, 'denied');
  assert.match(cookie(), /^meridian_consent=/);
  assert.equal(storage.has('meridian_consent_v1'), false);
});

test('GPC remains a distinct policy signal and locks advertising consent', () => {
  const { window, dataLayer } = browser(null, { gpc: true });
  const accepted = window.MeridianConsent.acceptAll();
  assert.equal(accepted.policy.gpc_detected, true);
  assert.equal(accepted.policy.sale_share_opt_out, true);
  assert.equal(accepted.states.analytics_storage, 'granted');
  assert.equal(accepted.states.ad_storage, 'denied');
  assert.equal(accepted.states.ad_user_data, 'denied');
  assert.equal(accepted.states.ad_personalization, 'denied');
  const update = dataLayer.findLast((entry) => entry.event === 'meridian_consent_updated');
  assert.equal(update.meridian_consent.gpc_detected, true);
  assert.equal(update.meridian_consent.sale_share_opt_out, true);
});

test('receipt and revocation hooks report withdrawals without network calls', () => {
  const receipts = [];
  const { window, events } = browser(null, { config: { onReceipt: (receipt) => receipts.push(receipt) } });
  const revocations = [];
  window.MeridianConsent.registerRevocationAction((detail) => revocations.push(detail));
  window.MeridianConsent.acceptAll();
  window.MeridianConsent.rejectOptional();
  assert.equal(receipts.length, 2);
  assert.equal(receipts[1].source, 'api_reject_optional');
  assert.ok(revocations[0].withdrawn.includes('analytics_storage'));
  assert.ok(events.some(({ type }) => type === 'meridian:consent-receipt'));
  assert.ok(events.some(({ type }) => type === 'meridian:consent-revoked'));
});
