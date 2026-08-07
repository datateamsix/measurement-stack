(() => {
  'use strict';

  const STORAGE = {
    consent: 'measurestack_consent_v1',
    attribution: 'measurestack_attribution_v1',
    person: 'measurestack_person_id',
    analyticsUser: 'measurestack_analytics_user_id',
    anonymous: 'measurestack_anonymous_user_id',
    session: 'measurestack_session_id',
  };
  const TRACKED_QUERY_KEYS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
    'gclid', 'dclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'li_fat_id',
  ];
  const GOOGLE_CONSENT_DEFAULTS = Object.freeze({
    ad_storage: false,
    analytics_storage: false,
    ad_user_data: false,
    ad_personalization: false,
    functionality_storage: false,
    personalization_storage: false,
    security_storage: true,
  });
  const CONSENT_OPTIONS = [
    {
      key: 'security_storage',
      title: 'Security storage',
      description: 'Supports authentication, fraud prevention, and other security-related functions.',
      required: true,
    },
    {
      key: 'functionality_storage',
      title: 'Functionality storage',
      description: 'Remembers choices that improve site features and functionality.',
    },
    {
      key: 'personalization_storage',
      title: 'Personalization storage',
      description: 'Stores information used to personalize content and experiences.',
    },
    {
      key: 'analytics_storage',
      title: 'Analytics storage',
      description: 'Allows analytics identifiers and cookies used to understand site usage.',
    },
    {
      key: 'ad_storage',
      title: 'Advertising storage',
      description: 'Allows identifiers and cookies used for advertising measurement.',
    },
    {
      key: 'ad_user_data',
      title: 'Advertising user data',
      description: 'Allows user data to be sent to Google for advertising purposes.',
    },
    {
      key: 'ad_personalization',
      title: 'Advertising personalization',
      description: 'Allows data to be used for personalized advertising and remarketing.',
    },
  ];

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };

  const parseJson = (value, fallback = null) => {
    try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
  };

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;',
  }[character]));

  function loadScript(src, attributes = {}) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === 'true') resolve();
        else {
          existing.addEventListener('load', resolve, { once: true });
          existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
        }
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.crossOrigin = 'anonymous';
      Object.entries(attributes).forEach(([key, value]) => script.setAttribute(key, value));
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      document.head.appendChild(script);
    });
  }

  const identityReady = loadScript('/identity-graph.js?v=20260807a')
    .then(() => window.MeasurementStackIdentity?.ready)
    .catch((error) => {
      console.error('Measurement Stack identity graph failed to load', error);
      return null;
    });

  function track(event, parameters = {}) {
    const graph = window.MeasurementStackIdentity;
    const payload = graph
      ? graph.eventEnvelope(event, parameters)
      : { event, event_timestamp: new Date().toISOString(), ...parameters };
    window.dataLayer.push(payload);

    if (graph) {
      if (event === 'form_submit_attempt') {
        graph.recordLifecycle('lead_started', { source_event_id: payload.event_id });
      } else if (event === 'generate_lead') {
        graph.recordLifecycle('lead', {
          lead_id: parameters.lead_id || '',
          source_event_id: payload.event_id,
        });
      } else if (event === 'begin_checkout') {
        graph.recordLifecycle('checkout_started', {
          checkout_attempt_id: payload.event_id,
          current_plan: parameters.plan_id || '',
          source_event_id: payload.event_id,
        });
      } else if (event === 'purchase') {
        graph.recordBilling({
          event_id: payload.event_id,
          checkout_session_id: parameters.transaction_id || '',
          stripe_customer_id: parameters.stripe_customer_id || '',
          subscription_id: parameters.subscription_id || '',
          payment_status: 'paid',
          plan: parameters.plan_id || '',
        });
      } else if (event === 'identity_resolved') {
        graph.recordLifecycle('identified', { source_event_id: payload.event_id });
      }
    }
    return payload;
  }

  function normalizeConsent(consent = {}) {
    const analytics = typeof consent.analytics_storage === 'boolean'
      ? consent.analytics_storage
      : Boolean(consent.analytics);
    const marketing = Boolean(consent.marketing);
    const normalized = {
      ...GOOGLE_CONSENT_DEFAULTS,
      ad_storage: typeof consent.ad_storage === 'boolean' ? consent.ad_storage : marketing,
      analytics_storage: analytics,
      ad_user_data: typeof consent.ad_user_data === 'boolean' ? consent.ad_user_data : marketing,
      ad_personalization: typeof consent.ad_personalization === 'boolean' ? consent.ad_personalization : marketing,
      functionality_storage: Boolean(consent.functionality_storage),
      personalization_storage: Boolean(consent.personalization_storage),
      security_storage: true,
    };
    return {
      ...consent,
      ...normalized,
      analytics: normalized.analytics_storage,
      marketing: normalized.ad_storage || normalized.ad_user_data || normalized.ad_personalization,
    };
  }

  function consentState(consent) {
    const normalized = normalizeConsent(consent);
    return Object.fromEntries(Object.keys(GOOGLE_CONSENT_DEFAULTS).map((key) => [
      key,
      normalized[key] ? 'granted' : 'denied',
    ]));
  }

  function setConsent(type, consent) {
    window.gtag('consent', type, {
      ...consentState(consent),
      ...(type === 'default' ? { wait_for_update: 500 } : {}),
    });
  }

  function ensureConsentDialog() {
    let dialog = document.getElementById('consent-settings-dialog');
    if (dialog) return dialog;
    const options = CONSENT_OPTIONS.map((option) => `
      <div class="consent-option">
        <div>
          <label for="consent-${option.key}">${escapeHtml(option.title)}</label>
          <code>${escapeHtml(option.key)}</code>
          <p>${escapeHtml(option.description)}</p>
        </div>
        <label class="consent-switch">
          <span class="sr-only">${escapeHtml(option.title)}</span>
          <input id="consent-${option.key}" name="${option.key}" type="checkbox"${option.required ? ' checked disabled' : ''}>
          <span aria-hidden="true"></span>
        </label>
      </div>`).join('');
    document.body.insertAdjacentHTML('beforeend', `
      <div class="consent-dialog-backdrop" id="consent-settings-dialog" hidden>
        <section class="consent-dialog" role="dialog" aria-modal="true" aria-labelledby="consent-dialog-title" tabindex="-1">
          <header>
            <div><p class="eyebrow">Privacy choices</p><h2 id="consent-dialog-title">Consent settings</h2></div>
            <button class="consent-dialog-close" type="button" aria-label="Close consent settings">&times;</button>
          </header>
          <div class="consent-dialog-intro">
            <p>Choose how this site may use storage and data. Each setting maps directly to a Google Consent Mode consent type.</p>
          </div>
          <form id="consent-settings-form">
            <div class="consent-option-list">${options}</div>
            <div class="consent-dialog-actions">
              <button type="button" data-consent-action="reject">Reject optional</button>
              <button type="button" data-consent-action="accept">Accept all</button>
              <button class="consent-save" type="submit">Save choices</button>
            </div>
          </form>
        </section>
      </div>`);
    return document.getElementById('consent-settings-dialog');
  }

  function initializeConsent() {
    const storedRaw = parseJson(localStorage.getItem(STORAGE.consent));
    const stored = storedRaw ? normalizeConsent(storedRaw) : null;
    setConsent('default', stored || GOOGLE_CONSENT_DEFAULTS);
    const banner = document.getElementById('consent-banner');
    const dialog = ensureConsentDialog();
    const dialogPanel = dialog.querySelector('.consent-dialog');
    const form = dialog.querySelector('#consent-settings-form');
    let returnFocus = null;
    if (banner && !stored) banner.hidden = false;

    function choose(consent, source = 'banner') {
      const normalized = normalizeConsent(consent);
      const graphConsent = window.MeasurementStackIdentity?.updateConsent(normalized);
      if (!graphConsent) localStorage.setItem(STORAGE.consent, JSON.stringify(normalized));
      setConsent('update', normalized);
      const state = consentState(normalized);
      track('consent_update', {
        consent_source: source,
        ...state,
        analytics_consent: state.analytics_storage,
        marketing_consent: normalized.marketing ? 'granted' : 'denied',
        consent_snapshot_id: graphConsent?.consent_snapshot_id || '',
      });
      if (banner) banner.hidden = true;
      closeDialog();
    }

    function populateDialog(consent = stored || GOOGLE_CONSENT_DEFAULTS) {
      const normalized = normalizeConsent(consent);
      CONSENT_OPTIONS.forEach(({ key, required }) => {
        const input = form.elements.namedItem(key);
        if (input) input.checked = required || normalized[key];
      });
    }

    function openDialog(trigger) {
      returnFocus = trigger || document.activeElement;
      populateDialog(parseJson(localStorage.getItem(STORAGE.consent)) || stored || GOOGLE_CONSENT_DEFAULTS);
      dialog.hidden = false;
      document.body.classList.add('consent-dialog-open');
      dialogPanel.focus();
    }

    function closeDialog() {
      if (dialog.hidden) return;
      dialog.hidden = true;
      document.body.classList.remove('consent-dialog-open');
      returnFocus?.focus?.();
    }

    document.getElementById('essential-only')?.addEventListener('click', () => choose({
      ...GOOGLE_CONSENT_DEFAULTS,
    }, 'banner_reject'));
    document.getElementById('accept-measurement')?.addEventListener('click', () => choose(
      Object.fromEntries(Object.keys(GOOGLE_CONSENT_DEFAULTS).map((key) => [key, true])),
      'banner_accept',
    ));
    document.querySelectorAll('[data-consent-settings]').forEach((trigger) => {
      trigger.addEventListener('click', () => openDialog(trigger));
    });
    dialog.querySelector('.consent-dialog-close').addEventListener('click', closeDialog);
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog();
    });
    dialog.querySelector('[data-consent-action="reject"]').addEventListener('click', () => {
      choose(GOOGLE_CONSENT_DEFAULTS, 'settings_reject');
    });
    dialog.querySelector('[data-consent-action="accept"]').addEventListener('click', () => {
      choose(
        Object.fromEntries(Object.keys(GOOGLE_CONSENT_DEFAULTS).map((key) => [key, true])),
        'settings_accept',
      );
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      choose(Object.fromEntries(CONSENT_OPTIONS.map(({ key, required }) => [
        key,
        required || Boolean(form.elements.namedItem(key)?.checked),
      ])), 'settings');
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !dialog.hidden) closeDialog();
    });
  }

  function currentTouch() {
    const params = new URLSearchParams(location.search);
    const touch = {};
    TRACKED_QUERY_KEYS.forEach((key) => {
      const value = params.get(key);
      if (value) touch[key] = value.slice(0, 500);
    });
    return {
      ...touch,
      landing_page: location.href.slice(0, 1000),
      page_path: `${location.pathname}${location.search}`.slice(0, 1000),
      referrer: document.referrer.slice(0, 1000),
      captured_at: new Date().toISOString(),
    };
  }

  function captureAttributionFallback() {
    const previous = parseJson(localStorage.getItem(STORAGE.attribution), {});
    const touch = currentTouch();
    const hasCampaignTouch = TRACKED_QUERY_KEYS.some((key) => Boolean(touch[key]));
    const attribution = {
      first_touch: previous.first_touch || touch,
      last_touch: hasCampaignTouch ? touch : (previous.last_touch || touch),
    };
    localStorage.setItem(STORAGE.attribution, JSON.stringify(attribution));
    return attribution;
  }

  function getOrCreate(key, storage, generator) {
    let value = storage.getItem(key);
    if (!value) {
      value = generator();
      storage.setItem(key, value);
    }
    return value;
  }

  function getQueryOrStoredId(queryKey, storageKey, prefix) {
    const supplied = new URLSearchParams(location.search).get(queryKey)?.trim().slice(0, 100);
    if (supplied) localStorage.setItem(storageKey, supplied);
    return getOrCreate(storageKey, localStorage, () => `${prefix}_${crypto.randomUUID()}`);
  }

  function getCookie(name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`))?.[1] || '';
  }

  function trackingContext() {
    if (window.MeasurementStackIdentity) return window.MeasurementStackIdentity.trackingContext();

    const gaCookieId = decodeURIComponent(getCookie('_ga'));
    return {
      attribution: parseJson(localStorage.getItem(STORAGE.attribution), {}),
      person_id: getQueryOrStoredId('person_id', STORAGE.person, 'person'),
      analytics_user_id: getQueryOrStoredId('analytics_user_id', STORAGE.analyticsUser, 'analytics'),
      anonymous_user_id: getOrCreate(STORAGE.anonymous, localStorage, () => `anon_${crypto.randomUUID()}`),
      ga_cookie_id: gaCookieId,
      client_id: gaCookieId.match(/^GA\d+\.\d+\.(\d+\.\d+)$/)?.[1] || '',
      session_id: getOrCreate(STORAGE.session, sessionStorage, () => `session_${crypto.randomUUID()}`),
      page_location: location.href,
      page_referrer: document.referrer,
      page_title: document.title,
    };
  }

  async function runtimeConfig() {
    if (window.__measureStackConfig) return window.__measureStackConfig;
    try {
      const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Config returned ${response.status}`);
      window.__measureStackConfig = await response.json();
    } catch (error) {
      window.__measureStackConfig = {
        environment: 'development',
        clerkPublishableKey: '',
        integrations: {},
        error: error.message,
      };
    }
    return window.__measureStackConfig;
  }

  let clerkPromise;

  async function initializeClerk() {
    const config = await runtimeConfig();
    const publishableKey = config.clerkPublishableKey || '';
    if (!publishableKey) return { configured: false, clerk: null };
    if (window.Clerk?.loaded) return { configured: true, clerk: window.Clerk };

    try {
      const encodedDomain = publishableKey.split('_')[2];
      const clerkDomain = atob(encodedDomain).slice(0, -1);
      await loadScript(`https://${clerkDomain}/npm/@clerk/ui@1/dist/ui.browser.js`);
      await loadScript(`https://${clerkDomain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, {
        'data-clerk-publishable-key': publishableKey,
      });
      await window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
      return { configured: true, clerk: window.Clerk };
    } catch (error) {
      console.error('Measurement Stack Clerk initialization failed', error);
      return { configured: true, clerk: null, error: error.message };
    }
  }

  function loadClerk() {
    if (!clerkPromise) clerkPromise = initializeClerk();
    return clerkPromise;
  }

  async function authFetch(url, options = {}) {
    const { clerk } = await loadClerk();
    const token = clerk?.session ? await clerk.session.getToken() : null;
    const headers = new Headers(options.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...options, headers });
  }

  function applyResolvedIdentity(identity) {
    if (identity?.person_id) localStorage.setItem(STORAGE.person, identity.person_id);
    if (identity?.analytics_user_id) localStorage.setItem(STORAGE.analyticsUser, identity.analytics_user_id);
    return window.MeasurementStackIdentity?.applyResolvedIdentity(identity) || identity;
  }

  async function syncIdentity() {
    await identityReady;
    const auth = await loadClerk();
    if (!auth.clerk?.isSignedIn) return { configured: auth.configured, signedIn: false };

    const response = await authFetch('/api/identity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracking: trackingContext() }),
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok) {
      applyResolvedIdentity({
        ...(result.identity || {}),
        auth_providers: result.graph?.external_auth_identities || result.identity?.auth_providers || [],
      });
      const marker = `measurementstack_identity_synced_${auth.clerk.user?.id || 'user'}`;
      if (!sessionStorage.getItem(marker)) {
        track('identity_resolved', {
          person_id: result.identity?.person_id || '',
          analytics_user_id: result.identity?.analytics_user_id || '',
          auth_user_id: result.identity?.clerk_user_id || '',
          authentication_status: 'authenticated',
          identity_storage: result.identity?.storage || 'unknown',
          provider_count: result.graph?.external_auth_identities?.length || 0,
        });
        sessionStorage.setItem(marker, 'true');
      }
    }
    return { ...result, signedIn: true, clerk: auth.clerk };
  }

  async function renderAuthNav() {
    const target = document.getElementById('auth-nav');
    if (!target) return;
    const auth = await loadClerk();
    if (!auth.configured) {
      target.innerHTML = '<a class="nav-link" href="/sign-in.html">Sign in</a><a class="nav-button" href="/pricing.html">Start free</a>';
      return;
    }
    if (!auth.clerk) {
      target.innerHTML = '<span class="integration-warning">Auth unavailable</span>';
      return;
    }
    if (auth.clerk.isSignedIn) {
      target.innerHTML = '<a class="nav-link" href="/app.html">Workspace</a><span id="clerk-user-button"></span>';
      auth.clerk.mountUserButton(document.getElementById('clerk-user-button'));
    } else {
      target.innerHTML = '<a class="nav-link" href="/sign-in.html">Sign in</a><a class="nav-button" href="/pricing.html">Start free</a>';
    }
  }

  initializeConsent();
  captureAttributionFallback();

  const ready = Promise.all([identityReady, runtimeConfig(), renderAuthNav()]).then(async ([, config]) => {
    track('measurement_initialized', {
      measurement_environment: config.environment || 'development',
      gtm_container_id: 'GTM-5MQ3QDNF',
      auth_configured: Boolean(config.clerkPublishableKey),
      stripe_configured: Boolean(config.integrations?.stripe),
      loops_configured: Boolean(config.integrations?.loops),
      d1_configured: Boolean(config.integrations?.d1),
      identity_graph_version: window.MeasurementStackIdentity?.VERSION || 'fallback',
    });
    if ((await loadClerk()).clerk?.isSignedIn) await syncIdentity();
    return config;
  });

  window.MeasureStack = {
    STORAGE,
    parseJson,
    escapeHtml,
    track,
    trackingContext,
    runtimeConfig,
    loadClerk,
    authFetch,
    syncIdentity,
    applyResolvedIdentity,
    ready,
    identityReady,
    identitySnapshot: () => window.MeasurementStackIdentity?.snapshot() || null,
    recordLifecycle: (...args) => window.MeasurementStackIdentity?.recordLifecycle(...args),
    recordBilling: (...args) => window.MeasurementStackIdentity?.recordBilling(...args),
    refreshNetworkContext: () => window.MeasurementStackIdentity?.refreshNetworkContext(),
    IDENTITY_STORAGE: () => window.MeasurementStackIdentity?.STORAGE || {},
    openConsentSettings: () => document.querySelector('[data-consent-settings]')?.click(),
  };
})();
