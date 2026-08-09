(() => {
  'use strict';

  const VERSION = '0.1.0';
  const SCHEMA_VERSION = '1.0';
  const EVENT_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
  let initialized = false;
  let config = null;
  let trackedEvents = new Set();
  let originalPush = null;
  let unsubscribe = null;

  function consentStates() {
    const states = window.MeridianConsent?.getState?.()?.states || {};
    const value = (key) => states[key] === 'granted' ? 'granted' : 'denied';
    return {
      analytics_storage: value('analytics_storage'),
      ad_storage: value('ad_storage'),
      ad_user_data: value('ad_user_data'),
      ad_personalization: value('ad_personalization'),
    };
  }

  function envelope(eventName) {
    return {
      schema_version: SCHEMA_VERSION,
      sdk_version: VERSION,
      site_id: config.siteId,
      event_name: eventName,
      occurred_at: new Date().toISOString(),
      ...consentStates(),
    };
  }

  function transmit(payload) {
    const body = JSON.stringify(payload);
    if (window.fetch) {
      void window.fetch(config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body,
        credentials: 'omit',
        keepalive: true,
      }).catch(() => {});
      return true;
    }
    if (navigator.sendBeacon) {
      return navigator.sendBeacon(config.endpoint, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
    }
    return false;
  }

  function track(eventName) {
    const normalized = String(eventName || '').trim().toLowerCase();
    if (!EVENT_PATTERN.test(normalized)) throw new TypeError('Consent impact event names must use lower_snake_case.');
    return transmit(envelope(normalized));
  }

  function observeDataLayer() {
    window.dataLayer = window.dataLayer || [];
    originalPush = window.dataLayer.push;
    window.dataLayer.push = function meridianImpactPush(...items) {
      const result = originalPush.apply(this, items);
      for (const item of items) {
        if (item && typeof item === 'object' && trackedEvents.has(item.event)) track(item.event);
      }
      return result;
    };
  }

  function init(overrides = {}) {
    if (initialized) return api;
    const input = { ...(window.MeridianConsentAnalyticsConfig || {}), ...overrides };
    const siteId = String(input.siteId || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(siteId)) throw new TypeError('A valid consent analytics siteId is required.');
    config = {
      siteId,
      endpoint: input.endpoint || '/api/consent-impact',
      autoPageView: input.autoPageView !== false,
      observeDataLayer: input.observeDataLayer !== false,
    };
    trackedEvents = new Set((input.trackedEvents || [])
      .map((value) => String(value).trim().toLowerCase())
      .filter((value) => EVENT_PATTERN.test(value)));
    if (config.observeDataLayer && trackedEvents.size) observeDataLayer();
    if (window.MeridianConsent?.subscribe) {
      unsubscribe = window.MeridianConsent.subscribe(() => track('consent_updated'));
    }
    track('consent_ready');
    if (config.autoPageView) track('page_view');
    initialized = true;
    return api;
  }

  function destroy() {
    if (originalPush && window.dataLayer) window.dataLayer.push = originalPush;
    unsubscribe?.();
    originalPush = null;
    unsubscribe = null;
    initialized = false;
  }

  const api = Object.freeze({ version: VERSION, init, track, destroy });
  window.MeridianConsentAnalytics = api;
  if (window.MeridianConsentAnalyticsConfig) init();
})();
