(() => {
  'use strict';

  const STORAGE = {
    consent: 'measurestack_consent_v1',
    attribution: 'measurestack_attribution_v1',
    person: 'measurestack_person_id',
    analyticsUser: 'measurestack_analytics_user_id',
    anonymous: 'measurestack_anonymous_user_id',
    session: 'measurestack_session_id'
  };
  const TRACKED_QUERY_KEYS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
    'gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'li_fat_id'
  ];

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };

  const parseJson = (value, fallback = null) => {
    try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
  };

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
  }[character]));

  const track = (event, parameters = {}) => {
    window.dataLayer.push({ event, event_timestamp: new Date().toISOString(), ...parameters });
  };

  function setConsent(type, consent) {
    window.gtag('consent', type, {
      analytics_storage: consent.analytics ? 'granted' : 'denied',
      ad_storage: consent.marketing ? 'granted' : 'denied',
      ad_user_data: consent.marketing ? 'granted' : 'denied',
      ad_personalization: consent.marketing ? 'granted' : 'denied',
      ...(type === 'default' ? { wait_for_update: 500 } : {})
    });
  }

  function initializeConsent() {
    const stored = parseJson(localStorage.getItem(STORAGE.consent));
    setConsent('default', stored || { analytics: false, marketing: false });
    const banner = document.getElementById('consent-banner');
    if (!banner) return;
    if (!stored) banner.hidden = false;

    function choose(consent) {
      localStorage.setItem(STORAGE.consent, JSON.stringify(consent));
      setConsent('update', consent);
      track('consent_update', {
        analytics_consent: consent.analytics ? 'granted' : 'denied',
        marketing_consent: consent.marketing ? 'granted' : 'denied'
      });
      banner.hidden = true;
    }

    document.getElementById('essential-only')?.addEventListener('click', () => choose({ analytics: false, marketing: false }));
    document.getElementById('accept-measurement')?.addEventListener('click', () => choose({ analytics: true, marketing: true }));
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
      captured_at: new Date().toISOString()
    };
  }

  function captureAttribution() {
    const previous = parseJson(localStorage.getItem(STORAGE.attribution), {});
    const touch = currentTouch();
    const hasCampaignTouch = TRACKED_QUERY_KEYS.some((key) => Boolean(touch[key]));
    const attribution = {
      first_touch: previous.first_touch || touch,
      last_touch: hasCampaignTouch ? touch : (previous.last_touch || touch)
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
    const gaCookieId = decodeURIComponent(getCookie('_ga'));
    return {
      attribution: parseJson(localStorage.getItem(STORAGE.attribution), {}),
      person_id: getQueryOrStoredId('person_id', STORAGE.person, 'person'),
      analytics_user_id: getQueryOrStoredId('analytics_user_id', STORAGE.analyticsUser, 'analytics'),
      anonymous_user_id: getOrCreate(STORAGE.anonymous, localStorage, () => `anon_${crypto.randomUUID()}`),
      ga_cookie_id: gaCookieId,
      client_id: gaCookieId.match(/^GA\d+\.\d+\.(\d+\.\d+)$/)?.[1] || '',
      session_id: getOrCreate(STORAGE.session, sessionStorage, () => String(Math.floor(Date.now() / 1000))),
      page_location: location.href,
      page_referrer: document.referrer,
      page_title: document.title
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
        error: error.message
      };
    }
    return window.__measureStackConfig;
  }

  function loadScript(src, attributes = {}) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === 'true') resolve();
        else existing.addEventListener('load', resolve, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.crossOrigin = 'anonymous';
      Object.entries(attributes).forEach(([key, value]) => script.setAttribute(key, value));
      script.addEventListener('load', () => { script.dataset.loaded = 'true'; resolve(); }, { once: true });
      script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      document.head.appendChild(script);
    });
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
        'data-clerk-publishable-key': publishableKey
      });
      await window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
      return { configured: true, clerk: window.Clerk };
    } catch (error) {
      console.error('MeasureStack Clerk initialization failed', error);
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
  }

  async function syncIdentity() {
    const auth = await loadClerk();
    if (!auth.clerk?.isSignedIn) return { configured: auth.configured, signedIn: false };
    const response = await authFetch('/api/identity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracking: trackingContext() })
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok) {
      applyResolvedIdentity(result.identity);
      const marker = `measurestack_identity_synced_${auth.clerk.user?.id || 'user'}`;
      if (!sessionStorage.getItem(marker)) {
        track('identity_resolved', {
          person_id: result.identity?.person_id || '',
          analytics_user_id: result.identity?.analytics_user_id || '',
          auth_user_id: result.identity?.clerk_user_id || '',
          authentication_status: 'authenticated',
          identity_storage: result.identity?.storage || 'unknown'
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
  captureAttribution();
  const ready = Promise.all([runtimeConfig(), renderAuthNav()]).then(async ([config]) => {
    track('measurement_initialized', {
      measurement_environment: config.environment || 'development',
      gtm_container_id: 'GTM-5MQ3QDNF',
      auth_configured: Boolean(config.clerkPublishableKey),
      stripe_configured: Boolean(config.integrations?.stripe),
      loops_configured: Boolean(config.integrations?.loops),
      d1_configured: Boolean(config.integrations?.d1)
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
    ready
  };
})();
