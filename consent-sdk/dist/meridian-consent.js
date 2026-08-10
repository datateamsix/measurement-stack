(() => {
  'use strict';

  const VERSION = '0.3.0';
  const SCHEMA_VERSION = '1.0';
  const CONSENT_TYPES = Object.freeze([
    'security_storage',
    'functionality_storage',
    'personalization_storage',
    'analytics_storage',
    'ad_storage',
    'ad_user_data',
    'ad_personalization',
  ]);
  const OPTIONAL_TYPES = CONSENT_TYPES.filter((type) => type !== 'security_storage');
  const DENIED_DEFAULTS = Object.freeze(Object.fromEntries(
    CONSENT_TYPES.map((type) => [type, type === 'security_storage' ? 'granted' : 'denied']),
  ));
  const COPY = Object.freeze({
    title: 'Your privacy choices',
    bannerText: 'Choose how this site may use cookies and data. Essential security functions remain active.',
    settingsIntro: 'Each choice maps directly to a Google Consent Mode consent type.',
    acceptAll: 'Accept all',
    rejectOptional: 'Reject optional',
    manage: 'Manage settings',
    save: 'Save choices',
    close: 'Close consent settings',
    gpcHonored: 'Your browser opt-out preference is honored. Advertising choices are restricted.',
  });
  const CATEGORY_COPY = Object.freeze({
    security_storage: ['Security storage', 'Supports authentication, fraud prevention, and user protection.'],
    functionality_storage: ['Functionality storage', 'Remembers choices that support site features and functionality.'],
    personalization_storage: ['Personalization storage', 'Stores information used to personalize content and experiences.'],
    analytics_storage: ['Analytics storage', 'Allows analytics identifiers and cookies used to understand site usage.'],
    ad_storage: ['Advertising storage', 'Allows identifiers and cookies used for advertising measurement.'],
    ad_user_data: ['Advertising user data', 'Allows user data to be sent to Google for advertising purposes.'],
    ad_personalization: ['Advertising personalization', 'Allows data to be used for personalized advertising and remarketing.'],
  });
  const DEFAULT_CONFIG = Object.freeze({
    cookieName: 'meridian_consent',
    legacyStorageKey: 'meridian_consent_v1',
    cookieDays: 180,
    policyVersion: '1.0',
    waitForUpdate: 500,
    googleConsent: true,
    autoShow: true,
    showGoogleKeys: true,
    policyProfile: 'strict-global',
    honorGpc: true,
    gpcLocksAdvertising: true,
    onReceipt: null,
    revocationCookies: {},
    privacyUrl: '',
    cookieUrl: '',
    copy: {},
    categories: {},
    theme: {},
  });

  let config;
  let current;
  let initialized = false;
  let returnFocus = null;
  const listeners = new Set();
  const revocationHandlers = new Set();

  const safeJson = (value, fallback = null) => {
    try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; }
  };

  const bool = (value, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    return value === true || value === 'true';
  };

  const uid = () => {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    if (globalThis.crypto?.getRandomValues) {
      const values = globalThis.crypto.getRandomValues(new Uint32Array(4));
      return `mrc_${[...values].map((value) => value.toString(16).padStart(8, '0')).join('')}`;
    }
    throw new Error('Meridian Consent requires Web Crypto to create consent receipt identifiers.');
  };

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;',
  }[character]));

  const safeUrl = (value) => {
    if (!value) return '';
    try {
      const parsed = new URL(value, location.href);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? escapeHtml(value) : '';
    } catch (_) { return ''; }
  };

  const gpcDetected = () => config?.honorGpc !== false && globalThis.navigator?.globalPrivacyControl === true;

  const state = (input = {}) => {
    const states = Object.fromEntries(CONSENT_TYPES.map((type) => [
      type,
      type === 'security_storage' || input[type] === true || input[type] === 'granted' ? 'granted' : 'denied',
    ]));
    if (gpcDetected() && config?.gpcLocksAdvertising !== false) {
      states.ad_storage = 'denied';
      states.ad_user_data = 'denied';
      states.ad_personalization = 'denied';
    }
    return states;
  };

  function policyState() {
    const detected = gpcDetected();
    return {
      profile: config.policyProfile,
      gpc_detected: detected,
      sale_share_opt_out: detected,
      targeted_advertising_opt_out: detected,
    };
  }

  function scriptConfig() {
    const script = document.currentScript || [...document.scripts].find((item) => /meridian-consent(?:\.min)?\.js/.test(item.src));
    if (!script) return {};
    return {
      policyVersion: script.dataset.policyVersion,
      cookieName: script.dataset.cookieName,
      privacyUrl: script.dataset.privacyUrl,
      cookieUrl: script.dataset.cookieUrl,
      googleConsent: bool(script.dataset.googleConsent, undefined),
      autoShow: bool(script.dataset.autoShow, undefined),
    };
  }

  function mergeConfig(overrides = {}) {
    const source = { ...scriptConfig(), ...(window.MeridianConsentConfig || {}), ...overrides };
    Object.keys(source).forEach((key) => source[key] === undefined && delete source[key]);
    return {
      ...DEFAULT_CONFIG,
      ...source,
      copy: { ...COPY, ...(source.copy || {}) },
      categories: { ...CATEGORY_COPY, ...(source.categories || {}) },
      theme: { ...(source.theme || {}) },
    };
  }

  function readCookie(name) {
    const prefix = `${encodeURIComponent(name)}=`;
    const match = document.cookie.split('; ').find((part) => part.startsWith(prefix));
    return match ? safeJson(decodeURIComponent(match.slice(prefix.length))) : null;
  }

  function writeCookie(value) {
    const expires = new Date(Date.now() + config.cookieDays * 864e5).toUTCString();
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${encodeURIComponent(config.cookieName)}=${encodeURIComponent(JSON.stringify(value))}; Path=/; Expires=${expires}; SameSite=Lax${secure}`;
  }

  function removeCookie() {
    document.cookie = `${encodeURIComponent(config.cookieName)}=; Path=/; Max-Age=0; SameSite=Lax`;
  }

  function storedChoice() {
    const stored = readCookie(config.cookieName);
    if (stored && stored.schema_version === SCHEMA_VERSION && stored.policy_version === config.policyVersion) {
      return { ...stored, states: state(stored.states), policy: policyState(), has_choice: true };
    }
    return migrateLegacyChoice();
  }

  function migrateLegacyChoice() {
    if (!config.legacyStorageKey) return null;
    let legacy;
    try { legacy = safeJson(localStorage.getItem(config.legacyStorageKey)); } catch (_) { return null; }
    if (!legacy) return null;
    const marketing = legacy.marketing === true;
    const migrated = recordFor({
      security_storage: 'granted',
      functionality_storage: legacy.functionality_storage,
      personalization_storage: legacy.personalization_storage,
      analytics_storage: legacy.analytics_storage ?? legacy.analytics,
      ad_storage: legacy.ad_storage ?? marketing,
      ad_user_data: legacy.ad_user_data ?? marketing,
      ad_personalization: legacy.ad_personalization ?? marketing,
    }, true, { consent_id: legacy.consent_id || legacy.consent_snapshot_id });
    writeCookie(migrated);
    try { localStorage.removeItem(config.legacyStorageKey); } catch (_) {}
    return migrated;
  }

  function callGoogle(command, states) {
    if (!config.googleConsent) return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
    window.gtag('consent', command, {
      ...states,
      ...(command === 'default' ? { wait_for_update: Number(config.waitForUpdate) || 500 } : {}),
    });
  }

  function envelope(event, source, record) {
    return {
      event,
      meridian_consent: {
        schema_version: SCHEMA_VERSION,
        sdk_version: VERSION,
        policy_version: config.policyVersion,
        consent_id: record.consent_id,
        revision_id: record.revision_id,
        occurred_at: record.occurred_at,
        source,
        has_choice: record.has_choice,
        policy_profile: record.policy.profile,
        gpc_detected: record.policy.gpc_detected,
        sale_share_opt_out: record.policy.sale_share_opt_out,
        ...record.states,
      },
    };
  }

  function emit(event, source, record) {
    const payload = envelope(event, source, record);
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(payload);
    window.dispatchEvent(new CustomEvent('meridian:consent', { detail: payload.meridian_consent }));
    listeners.forEach((listener) => listener({ ...payload.meridian_consent }));
    return payload;
  }

  function recordFor(states, hasChoice, previous = {}) {
    return {
      consent_id: previous.consent_id || uid(),
      revision_id: uid(),
      schema_version: SCHEMA_VERSION,
      policy_version: config.policyVersion,
      occurred_at: new Date().toISOString(),
      has_choice: hasChoice,
      states: state(states),
      policy: policyState(),
    };
  }

  function receiptFor(record, source) {
    return Object.freeze({
      schema_version: SCHEMA_VERSION,
      receipt_id: record.revision_id,
      consent_id: record.consent_id,
      policy_version: record.policy_version,
      policy_profile: record.policy.profile,
      occurred_at: record.occurred_at,
      source,
      gpc_detected: record.policy.gpc_detected,
      sale_share_opt_out: record.policy.sale_share_opt_out,
      targeted_advertising_opt_out: record.policy.targeted_advertising_opt_out,
      states: Object.freeze({ ...record.states }),
    });
  }

  function publishReceipt(record, source) {
    const receipt = receiptFor(record, source);
    window.dispatchEvent(new CustomEvent('meridian:consent-receipt', { detail: receipt }));
    if (typeof config.onReceipt === 'function') {
      try { config.onReceipt(receipt); } catch (_) { /* Integration callbacks cannot cancel consent updates. */ }
    }
    return receipt;
  }

  function clearKnownCookie(entry) {
    const item = typeof entry === 'string' ? { name: entry } : entry;
    if (!item || !/^[A-Za-z0-9_.-]{1,128}$/.test(item.name || '')) return false;
    const path = typeof item.path === 'string' && item.path.startsWith('/') ? item.path : '/';
    const domain = typeof item.domain === 'string' && /^[A-Za-z0-9.-]+$/.test(item.domain) ? `; Domain=${item.domain}` : '';
    document.cookie = `${encodeURIComponent(item.name)}=; Path=${path}${domain}; Max-Age=0; SameSite=Lax`;
    return true;
  }

  function runRevocations(previous, next, source) {
    if (!previous?.has_choice) return;
    const withdrawn = OPTIONAL_TYPES.filter((type) => previous.states[type] === 'granted' && next.states[type] === 'denied');
    if (!withdrawn.length) return;
    const cleared = [];
    for (const type of withdrawn) {
      for (const cookie of config.revocationCookies?.[type] || []) {
        if (clearKnownCookie(cookie)) cleared.push(typeof cookie === 'string' ? cookie : cookie.name);
      }
    }
    const detail = Object.freeze({ withdrawn: Object.freeze(withdrawn), cleared_cookies: Object.freeze(cleared), source, receipt: receiptFor(next, source) });
    for (const handler of revocationHandlers) {
      try { handler(detail); } catch (_) { /* One vendor callback cannot block the rest. */ }
    }
    window.dispatchEvent(new CustomEvent('meridian:consent-revoked', { detail }));
  }

  function apply(input, source = 'api') {
    const previous = current;
    const next = recordFor(input, true, current || {});
    writeCookie(next);
    current = next;
    callGoogle('update', next.states);
    emit('meridian_consent_updated', source, next);
    publishReceipt(next, source);
    runRevocations(previous, next, source);
    syncForm();
    hideBanner();
    closeSettings();
    return getState();
  }

  const all = (granted) => Object.fromEntries(CONSENT_TYPES.map((type) => [
    type,
    type === 'security_storage' || granted ? 'granted' : 'denied',
  ]));

  function themeStyle() {
    return Object.entries(config.theme)
      .filter(([, value]) => !/[;{}<>]/.test(String(value)))
      .map(([key, value]) => `--mrc-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}:${value}`)
      .join(';');
  }

  function categoryMarkup(type) {
    const [title, description] = config.categories[type] || CATEGORY_COPY[type];
    const required = type === 'security_storage';
    const gpcLocked = gpcDetected() && config.gpcLocksAdvertising !== false && ['ad_storage', 'ad_user_data', 'ad_personalization'].includes(type);
    return `<div class="mrc-option"><div><label for="mrc-${type}">${escapeHtml(title)}</label>${config.showGoogleKeys ? `<code>${type}</code>` : ''}<p>${escapeHtml(description)}</p></div><label class="mrc-switch"><span class="mrc-sr">${escapeHtml(title)}</span><input id="mrc-${type}" name="${type}" type="checkbox"${required ? ' checked disabled' : ''}${gpcLocked ? ' disabled' : ''}><span aria-hidden="true"></span></label></div>`;
  }

  function ensureUi() {
    if (document.getElementById('mrc-root')) return;
    if (!document.body) return;
    const links = [
      safeUrl(config.privacyUrl) && `<a href="${safeUrl(config.privacyUrl)}">Privacy policy</a>`,
      safeUrl(config.cookieUrl) && `<a href="${safeUrl(config.cookieUrl)}">Cookie policy</a>`,
    ].filter(Boolean).join('');
    const root = document.createElement('div');
    root.id = 'mrc-root';
    root.style.cssText = themeStyle();
    root.innerHTML = `<aside class="mrc-banner" aria-label="Cookie preferences" aria-live="polite" hidden><div><strong>${escapeHtml(config.copy.title)}</strong><p>${escapeHtml(config.copy.bannerText)}</p>${links ? `<nav>${links}</nav>` : ''}</div><div class="mrc-actions"><button type="button" data-mrc-action="reject">${escapeHtml(config.copy.rejectOptional)}</button><button type="button" data-mrc-open>${escapeHtml(config.copy.manage)}</button><button type="button" class="mrc-primary" data-mrc-action="accept">${escapeHtml(config.copy.acceptAll)}</button></div></aside><div class="mrc-backdrop" hidden><section class="mrc-dialog" role="dialog" aria-modal="true" aria-labelledby="mrc-title" tabindex="-1"><header><div><small>Privacy choices</small><h2 id="mrc-title">${escapeHtml(config.copy.title)}</h2></div><button class="mrc-close" type="button" aria-label="${escapeHtml(config.copy.close)}">&times;</button></header><p class="mrc-intro">${escapeHtml(config.copy.settingsIntro)}</p>${gpcDetected() ? `<p class="mrc-gpc" role="status">${escapeHtml(config.copy.gpcHonored)}</p>` : ''}<form><div class="mrc-list">${CONSENT_TYPES.map(categoryMarkup).join('')}</div><div class="mrc-footer">${links ? `<nav>${links}</nav>` : '<span></span>'}<div class="mrc-actions"><button type="button" data-mrc-action="reject">${escapeHtml(config.copy.rejectOptional)}</button><button type="button" data-mrc-action="accept">${escapeHtml(config.copy.acceptAll)}</button><button class="mrc-primary" type="submit">${escapeHtml(config.copy.save)}</button></div></div></form></section></div>`;
    document.body.appendChild(root);

    root.querySelectorAll('[data-mrc-action="accept"]').forEach((button) => button.addEventListener('click', () => apply(all(true), 'accept_all')));
    root.querySelectorAll('[data-mrc-action="reject"]').forEach((button) => button.addEventListener('click', () => apply(all(false), 'reject_optional')));
    root.querySelector('[data-mrc-open]').addEventListener('click', (event) => openSettings(event.currentTarget));
    root.querySelector('.mrc-close').addEventListener('click', closeSettings);
    root.querySelector('.mrc-backdrop').addEventListener('click', (event) => event.target === event.currentTarget && closeSettings());
    root.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      apply(Object.fromEntries(CONSENT_TYPES.map((type) => [type, event.currentTarget.elements[type]?.checked ? 'granted' : 'denied'])), 'save_settings');
    });
    document.addEventListener('keydown', onKeydown);
    document.querySelectorAll('[data-meridian-consent-settings]').forEach((element) => element.addEventListener('click', (event) => {
      event.preventDefault();
      openSettings(element);
    }));
    syncForm();
  }

  function syncForm() {
    const form = document.querySelector('#mrc-root form');
    if (!form || !current) return;
    CONSENT_TYPES.forEach((type) => { if (form.elements[type]) form.elements[type].checked = current.states[type] === 'granted'; });
  }

  function showBanner() {
    ensureUi();
    const banner = document.querySelector('#mrc-root .mrc-banner');
    if (banner) banner.hidden = false;
  }

  function hideBanner() {
    const banner = document.querySelector('#mrc-root .mrc-banner');
    if (banner) banner.hidden = true;
  }

  function openSettings(trigger = document.activeElement) {
    ensureUi();
    const backdrop = document.querySelector('#mrc-root .mrc-backdrop');
    if (!backdrop) {
      document.addEventListener('DOMContentLoaded', () => openSettings(trigger), { once: true });
      return;
    }
    returnFocus = trigger;
    syncForm();
    backdrop.hidden = false;
    document.documentElement.classList.add('mrc-open');
    backdrop.querySelector('.mrc-dialog').focus();
  }

  function closeSettings() {
    const backdrop = document.querySelector('#mrc-root .mrc-backdrop');
    if (!backdrop || backdrop.hidden) return;
    backdrop.hidden = true;
    document.documentElement.classList.remove('mrc-open');
    returnFocus?.focus?.();
  }

  function onKeydown(event) {
    const dialog = document.querySelector('#mrc-root .mrc-dialog');
    if (!dialog || dialog.parentElement.hidden) return;
    if (event.key === 'Escape') return closeSettings();
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function getState() {
    if (!current) return null;
    return Object.freeze({
      consent_id: current.consent_id,
      revision_id: current.revision_id,
      schema_version: SCHEMA_VERSION,
      policy_version: config.policyVersion,
      occurred_at: current.occurred_at,
      has_choice: current.has_choice,
      states: Object.freeze({ ...current.states }),
      policy: Object.freeze({ ...current.policy }),
    });
  }

  function reset() {
    const previous = current;
    removeCookie();
    current = recordFor(DENIED_DEFAULTS, false);
    callGoogle('update', current.states);
    emit('meridian_consent_updated', 'reset', current);
    publishReceipt(current, 'reset');
    runRevocations(previous, current, 'reset');
    showBanner();
    return getState();
  }

  function init(overrides = {}) {
    if (initialized) return getState();
    config = mergeConfig(overrides);
    current = storedChoice() || recordFor(DENIED_DEFAULTS, false);
    callGoogle('default', current.states);
    emit('meridian_consent_ready', current.has_choice ? 'stored_choice' : 'default', current);
    const mount = () => {
      ensureUi();
      if (config.autoShow && !current.has_choice) showBanner();
    };
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', mount, { once: true }) : mount();
    initialized = true;
    return getState();
  }

  window.MeridianConsent = Object.freeze({
    version: VERSION,
    consentTypes: CONSENT_TYPES,
    init,
    getState,
    acceptAll: () => apply(all(true), 'api_accept_all'),
    rejectOptional: () => apply(all(false), 'api_reject_optional'),
    save: (states) => apply(states, 'api_save'),
    open: openSettings,
    close: closeSettings,
    reset,
    has: (type) => CONSENT_TYPES.includes(type) && current?.states[type] === 'granted',
    getReceipt: () => current ? receiptFor(current, current.has_choice ? 'current_choice' : 'default') : null,
    gpcDetected,
    registerRevocationAction(handler) {
      if (typeof handler !== 'function') throw new TypeError('Revocation action must be a function.');
      revocationHandlers.add(handler);
      return () => revocationHandlers.delete(handler);
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Consent subscriber must be a function.');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });

  init();
})();
