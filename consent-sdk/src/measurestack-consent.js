(() => {
  'use strict';

  const VERSION = '0.1.0';
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
    cookieName: 'ms_consent',
    cookieDays: 180,
    policyVersion: '1.0',
    waitForUpdate: 500,
    googleConsent: true,
    autoShow: true,
    showGoogleKeys: true,
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

  const safeJson = (value, fallback = null) => {
    try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; }
  };

  const bool = (value, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    return value === true || value === 'true';
  };

  const uid = () => {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `msc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
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

  const state = (input = {}) => Object.fromEntries(CONSENT_TYPES.map((type) => [
    type,
    type === 'security_storage' || input[type] === true || input[type] === 'granted' ? 'granted' : 'denied',
  ]));

  function scriptConfig() {
    const script = document.currentScript || [...document.scripts].find((item) => /measurestack-consent(?:\.min)?\.js/.test(item.src));
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
    const source = { ...scriptConfig(), ...(window.MeasureStackConsentConfig || {}), ...overrides };
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
    if (!stored || stored.schema_version !== SCHEMA_VERSION || stored.policy_version !== config.policyVersion) return null;
    return {
      ...stored,
      states: state(stored.states),
      has_choice: true,
    };
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
      measurestack_consent: {
        schema_version: SCHEMA_VERSION,
        sdk_version: VERSION,
        policy_version: config.policyVersion,
        consent_id: record.consent_id,
        revision_id: record.revision_id,
        occurred_at: record.occurred_at,
        source,
        has_choice: record.has_choice,
        ...record.states,
      },
    };
  }

  function emit(event, source, record) {
    const payload = envelope(event, source, record);
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(payload);
    window.dispatchEvent(new CustomEvent('measurestack:consent', { detail: payload.measurestack_consent }));
    listeners.forEach((listener) => listener({ ...payload.measurestack_consent }));
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
    };
  }

  function apply(input, source = 'api') {
    const next = recordFor(input, true, current || {});
    writeCookie(next);
    current = next;
    callGoogle('update', next.states);
    emit('measurestack_consent_updated', source, next);
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
      .map(([key, value]) => `--msc-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}:${value}`)
      .join(';');
  }

  function categoryMarkup(type) {
    const [title, description] = config.categories[type] || CATEGORY_COPY[type];
    const required = type === 'security_storage';
    return `<div class="msc-option"><div><label for="msc-${type}">${escapeHtml(title)}</label>${config.showGoogleKeys ? `<code>${type}</code>` : ''}<p>${escapeHtml(description)}</p></div><label class="msc-switch"><span class="msc-sr">${escapeHtml(title)}</span><input id="msc-${type}" name="${type}" type="checkbox"${required ? ' checked disabled' : ''}><span aria-hidden="true"></span></label></div>`;
  }

  function ensureUi() {
    if (document.getElementById('msc-root')) return;
    if (!document.body) return;
    const links = [
      safeUrl(config.privacyUrl) && `<a href="${safeUrl(config.privacyUrl)}">Privacy policy</a>`,
      safeUrl(config.cookieUrl) && `<a href="${safeUrl(config.cookieUrl)}">Cookie policy</a>`,
    ].filter(Boolean).join('');
    const root = document.createElement('div');
    root.id = 'msc-root';
    root.style.cssText = themeStyle();
    root.innerHTML = `<aside class="msc-banner" aria-label="Cookie preferences" aria-live="polite" hidden><div><strong>${escapeHtml(config.copy.title)}</strong><p>${escapeHtml(config.copy.bannerText)}</p>${links ? `<nav>${links}</nav>` : ''}</div><div class="msc-actions"><button type="button" data-msc-action="reject">${escapeHtml(config.copy.rejectOptional)}</button><button type="button" data-msc-open>${escapeHtml(config.copy.manage)}</button><button type="button" class="msc-primary" data-msc-action="accept">${escapeHtml(config.copy.acceptAll)}</button></div></aside><div class="msc-backdrop" hidden><section class="msc-dialog" role="dialog" aria-modal="true" aria-labelledby="msc-title" tabindex="-1"><header><div><small>Privacy choices</small><h2 id="msc-title">${escapeHtml(config.copy.title)}</h2></div><button class="msc-close" type="button" aria-label="${escapeHtml(config.copy.close)}">&times;</button></header><p class="msc-intro">${escapeHtml(config.copy.settingsIntro)}</p><form><div class="msc-list">${CONSENT_TYPES.map(categoryMarkup).join('')}</div><div class="msc-footer">${links ? `<nav>${links}</nav>` : '<span></span>'}<div class="msc-actions"><button type="button" data-msc-action="reject">${escapeHtml(config.copy.rejectOptional)}</button><button type="button" data-msc-action="accept">${escapeHtml(config.copy.acceptAll)}</button><button class="msc-primary" type="submit">${escapeHtml(config.copy.save)}</button></div></div></form></section></div>`;
    document.body.appendChild(root);

    root.querySelectorAll('[data-msc-action="accept"]').forEach((button) => button.addEventListener('click', () => apply(all(true), 'accept_all')));
    root.querySelectorAll('[data-msc-action="reject"]').forEach((button) => button.addEventListener('click', () => apply(all(false), 'reject_optional')));
    root.querySelector('[data-msc-open]').addEventListener('click', (event) => openSettings(event.currentTarget));
    root.querySelector('.msc-close').addEventListener('click', closeSettings);
    root.querySelector('.msc-backdrop').addEventListener('click', (event) => event.target === event.currentTarget && closeSettings());
    root.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      apply(Object.fromEntries(CONSENT_TYPES.map((type) => [type, event.currentTarget.elements[type]?.checked ? 'granted' : 'denied'])), 'save_settings');
    });
    document.addEventListener('keydown', onKeydown);
    document.querySelectorAll('[data-measurestack-consent-settings]').forEach((element) => element.addEventListener('click', (event) => {
      event.preventDefault();
      openSettings(element);
    }));
    syncForm();
  }

  function syncForm() {
    const form = document.querySelector('#msc-root form');
    if (!form || !current) return;
    CONSENT_TYPES.forEach((type) => { if (form.elements[type]) form.elements[type].checked = current.states[type] === 'granted'; });
  }

  function showBanner() {
    ensureUi();
    const banner = document.querySelector('#msc-root .msc-banner');
    if (banner) banner.hidden = false;
  }

  function hideBanner() {
    const banner = document.querySelector('#msc-root .msc-banner');
    if (banner) banner.hidden = true;
  }

  function openSettings(trigger = document.activeElement) {
    ensureUi();
    const backdrop = document.querySelector('#msc-root .msc-backdrop');
    if (!backdrop) {
      document.addEventListener('DOMContentLoaded', () => openSettings(trigger), { once: true });
      return;
    }
    returnFocus = trigger;
    syncForm();
    backdrop.hidden = false;
    document.documentElement.classList.add('msc-open');
    backdrop.querySelector('.msc-dialog').focus();
  }

  function closeSettings() {
    const backdrop = document.querySelector('#msc-root .msc-backdrop');
    if (!backdrop || backdrop.hidden) return;
    backdrop.hidden = true;
    document.documentElement.classList.remove('msc-open');
    returnFocus?.focus?.();
  }

  function onKeydown(event) {
    const dialog = document.querySelector('#msc-root .msc-dialog');
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
    });
  }

  function reset() {
    removeCookie();
    current = recordFor(DENIED_DEFAULTS, false);
    callGoogle('update', current.states);
    emit('measurestack_consent_updated', 'reset', current);
    showBanner();
    return getState();
  }

  function init(overrides = {}) {
    if (initialized) return getState();
    config = mergeConfig(overrides);
    current = storedChoice() || recordFor(DENIED_DEFAULTS, false);
    callGoogle('default', current.states);
    emit('measurestack_consent_ready', current.has_choice ? 'stored_choice' : 'default', current);
    const mount = () => {
      ensureUi();
      if (config.autoShow && !current.has_choice) showBanner();
    };
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', mount, { once: true }) : mount();
    initialized = true;
    return getState();
  }

  window.MeasureStackConsent = Object.freeze({
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
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Consent subscriber must be a function.');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });

  init();
})();
