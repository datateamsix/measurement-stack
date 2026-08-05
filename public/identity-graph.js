(() => {
  'use strict';

  const VERSION = '1.0.0';
  const RETENTION_DAYS = 395;
  const MAX_RECENT_TOUCHES = 12;
  const LEGACY = {
    consent: 'measurestack_consent_v1',
    attribution: 'measurestack_attribution_v1',
    person: 'measurestack_person_id',
    analyticsUser: 'measurestack_analytics_user_id',
    anonymous: 'measurestack_anonymous_user_id',
    session: 'measurestack_session_id'
  };
  const STORAGE = {
    identity: 'measurementstack.identity_graph.v1',
    attribution: 'measurementstack.attribution.v1',
    lifecycle: 'measurementstack.lifecycle.v1',
    network: 'measurementstack.network.v1',
    policy: 'measurementstack.collection_policy.v1',
    sequence: 'measurementstack.event_sequence.v1'
  };
  const QUERY_KEYS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
    'gclid', 'dclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'li_fat_id'
  ];
  const DEFAULT_POLICY = {
    schema_version: VERSION,
    ip: 'anonymize_strict',
    network_history: 'latest_only',
    javascript_client_id: 'first_party_uuid',
    network_derived_client_id: 'monthly_hmac_when_configured',
    ga_client_id: 'leave_as_is',
    ga_cookie: 'leave_as_is',
    ga_session_cookies: 'leave_as_is',
    fplc_cookie: 'leave_as_is',
    fpid_cookie: 'leave_as_is',
    user_id: 'opaque_pseudonymous_only',
    firebase_id: 'remove_on_web',
    session_id: 'leave_as_is',
    query_parameters: 'campaign_allowlist_only',
    referrer: 'origin_and_path',
    user_agent: 'parsed_only',
    geography: 'country_region_only',
    screen: 'analytics_consent',
    language: 'analytics_consent',
    advertising_ids: 'marketing_consent',
    raw_personal_data_in_local_storage: 'never',
    raw_payment_data_in_local_storage: 'never'
  };

  window.dataLayer = window.dataLayer || [];

  const nowIso = () => new Date().toISOString();
  const expiresIso = () => new Date(Date.now() + RETENTION_DAYS * 86400000).toISOString();
  const parseJson = (value, fallback = null) => {
    try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
  };
  const readLocal = (key, fallback = null) => parseJson(localStorage.getItem(key), fallback);
  const writeLocal = (key, value) => {
    localStorage.setItem(key, JSON.stringify(value));
    return value;
  };
  const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
  const safeText = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

  function getCookie(name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : '';
  }

  function allGaSessionCookies() {
    return document.cookie
      .split(';')
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith('_ga_'))
      .reduce((accumulator, entry) => {
        const splitAt = entry.indexOf('=');
        const name = entry.slice(0, splitAt);
        const value = decodeURIComponent(entry.slice(splitAt + 1));
        accumulator[name] = value.slice(0, 500);
        return accumulator;
      }, {});
  }

  function gaClientId(rawGaCookie) {
    return safeText(rawGaCookie, 200).match(/^GA\d+\.\d+\.(\d+\.\d+)$/)?.[1] || '';
  }

  function currentConsent() {
    const stored = parseJson(localStorage.getItem(LEGACY.consent), null);
    const analytics = Boolean(stored?.analytics);
    const marketing = Boolean(stored?.marketing);
    let snapshotId = stored?.consent_snapshot_id || sessionStorage.getItem('measurementstack.default_consent_snapshot');
    if (!snapshotId) {
      snapshotId = id('consent');
      sessionStorage.setItem('measurementstack.default_consent_snapshot', snapshotId);
    }
    return {
      consent_snapshot_id: snapshotId,
      analytics_storage: analytics ? 'granted' : 'denied',
      ad_storage: marketing ? 'granted' : 'denied',
      ad_user_data: marketing ? 'granted' : 'denied',
      ad_personalization: marketing ? 'granted' : 'denied',
      identity_resolution: 'granted',
      captured_at: stored?.captured_at || nowIso(),
      policy_version: VERSION
    };
  }

  function updateConsent(consent) {
    const snapshot = {
      consent_snapshot_id: id('consent'),
      analytics: Boolean(consent.analytics),
      marketing: Boolean(consent.marketing),
      captured_at: nowIso(),
      policy_version: VERSION
    };
    localStorage.setItem(LEGACY.consent, JSON.stringify(snapshot));
    const identity = identityEnvelope();
    identity.consent_snapshot_id = snapshot.consent_snapshot_id;
    identity.updated_at = snapshot.captured_at;
    writeLocal(STORAGE.identity, identity);
    return currentConsent();
  }

  function referrerHost(value) {
    try { return value ? new URL(value).hostname : ''; } catch { return ''; }
  }

  function currentTouch() {
    const params = new URLSearchParams(location.search);
    const campaign = {};
    QUERY_KEYS.forEach((key) => {
      const value = params.get(key);
      if (value) campaign[key] = value.slice(0, 500);
    });
    let referrer = '';
    try {
      if (document.referrer) {
        const url = new URL(document.referrer);
        referrer = `${url.origin}${url.pathname}`.slice(0, 1000);
      }
    } catch {
      referrer = document.referrer.slice(0, 1000);
    }
    const nonDirect = Object.keys(campaign).length > 0 || Boolean(referrer);
    return {
      touch_id: id('touch'),
      touch_type: Object.keys(campaign).length ? 'campaign_visit' : (referrer ? 'referral_visit' : 'direct_visit'),
      channel: campaign.utm_medium || (campaign.gclid ? 'paid_search' : campaign.fbclid || campaign.li_fat_id ? 'paid_social' : referrer ? 'referral' : 'direct'),
      source: campaign.utm_source || (campaign.gclid ? 'google' : campaign.fbclid ? 'meta' : campaign.li_fat_id ? 'linkedin' : referrerHost(referrer) || 'direct'),
      medium: campaign.utm_medium || '',
      campaign_id: campaign.utm_id || '',
      campaign_name: campaign.utm_campaign || '',
      campaign_content: campaign.utm_content || '',
      campaign_term: campaign.utm_term || '',
      click_ids: {
        gclid: campaign.gclid || '',
        dclid: campaign.dclid || '',
        gbraid: campaign.gbraid || '',
        wbraid: campaign.wbraid || '',
        fbclid: campaign.fbclid || '',
        msclkid: campaign.msclkid || '',
        li_fat_id: campaign.li_fat_id || ''
      },
      landing_page: `${location.origin}${location.pathname}`.slice(0, 1000),
      page_path: `${location.pathname}${location.search}`.slice(0, 1000),
      referrer,
      occurred_at: nowIso(),
      attribution_eligible: true,
      non_direct: nonDirect
    };
  }

  function captureAttribution() {
    const previous = readLocal(STORAGE.attribution, null);
    const legacy = parseJson(localStorage.getItem(LEGACY.attribution), {});
    const touch = currentTouch();
    const hasCampaignTouch = QUERY_KEYS.some((key) => Boolean(touch.click_ids[key] || new URLSearchParams(location.search).get(key)));
    const shouldAddTouch = hasCampaignTouch || !previous?.last_touch || previous.last_touch.page_path !== touch.page_path;
    const recent = Array.isArray(previous?.recent_touches) ? [...previous.recent_touches] : [];
    if (shouldAddTouch) recent.push(touch);

    const firstTouch = previous?.first_touch || legacy.first_touch || touch;
    const lastTouch = shouldAddTouch ? touch : (previous?.last_touch || legacy.last_touch || touch);
    const lastNonDirect = touch.non_direct
      ? touch
      : previous?.last_non_direct_touch || (firstTouch.non_direct ? firstTouch : null);
    const envelope = {
      schema_name: 'measurement_stack.attribution',
      schema_version: VERSION,
      first_touch_id: firstTouch.touch_id || '',
      last_touch_id: lastTouch.touch_id || '',
      last_non_direct_touch_id: lastNonDirect?.touch_id || '',
      first_touch: firstTouch,
      last_touch: lastTouch,
      last_non_direct_touch: lastNonDirect,
      recent_touches: recent.slice(-MAX_RECENT_TOUCHES),
      active_click_ids: Object.fromEntries(Object.entries(lastTouch.click_ids || {}).filter(([, value]) => Boolean(value))),
      updated_at: nowIso(),
      expires_at: expiresIso()
    };
    writeLocal(STORAGE.attribution, envelope);

    const legacyEnvelope = {
      first_touch: {
        ...firstTouch,
        ...firstTouch.click_ids,
        utm_source: firstTouch.source === 'direct' ? '' : firstTouch.source,
        utm_medium: firstTouch.medium,
        utm_campaign: firstTouch.campaign_name,
        utm_content: firstTouch.campaign_content,
        utm_term: firstTouch.campaign_term,
        captured_at: firstTouch.occurred_at
      },
      last_touch: {
        ...lastTouch,
        ...lastTouch.click_ids,
        utm_source: lastTouch.source === 'direct' ? '' : lastTouch.source,
        utm_medium: lastTouch.medium,
        utm_campaign: lastTouch.campaign_name,
        utm_content: lastTouch.campaign_content,
        utm_term: lastTouch.campaign_term,
        captured_at: lastTouch.occurred_at
      }
    };
    localStorage.setItem(LEGACY.attribution, JSON.stringify(legacyEnvelope));
    return envelope;
  }

  function sessionIdentity() {
    let sessionId = sessionStorage.getItem(LEGACY.session);
    if (!sessionId) {
      sessionId = id('session');
      sessionStorage.setItem(LEGACY.session, sessionId);
    }
    return sessionId;
  }

  function clientHints() {
    const uaData = navigator.userAgentData;
    return {
      architecture: safeText(uaData?.architecture || '', 50),
      bitness: safeText(uaData?.bitness || '', 20),
      mobile: Boolean(uaData?.mobile),
      model: safeText(uaData?.model || '', 100),
      platform: safeText(uaData?.platform || navigator.platform || '', 100),
      platform_version: safeText(uaData?.platformVersion || '', 100),
      full_version_list: Array.isArray(uaData?.fullVersionList)
        ? uaData.fullVersionList.map((item) => ({ brand: safeText(item.brand, 100), version: safeText(item.version, 100) }))
        : [],
      wow64: Boolean(uaData?.wow64)
    };
  }

  function systemInfo(consent = currentConsent()) {
    const analyticsGranted = consent.analytics_storage === 'granted';
    const hints = clientHints();
    return {
      user_agent_collection: 'parsed_only',
      user_agent: '',
      user_agent_architecture: hints.architecture,
      user_agent_bitness: hints.bitness,
      user_agent_full_version_list: hints.full_version_list,
      user_agent_mobile: hints.mobile,
      user_agent_model: hints.model,
      user_agent_platform: hints.platform,
      user_agent_platform_version: hints.platform_version,
      user_agent_wow64: hints.wow64,
      language: analyticsGranted ? safeText(navigator.language || '', 50) : '',
      screen_resolution: analyticsGranted ? `${screen.width}x${screen.height}` : '',
      viewport_size: analyticsGranted ? `${window.innerWidth}x${window.innerHeight}` : '',
      screen_color_depth: analyticsGranted ? Number(screen.colorDepth || 0) : 0,
      java_enabled: false,
      flash_version: ''
    };
  }

  function identityEnvelope() {
    const stored = readLocal(STORAGE.identity, {});
    const timestamp = nowIso();
    const gaCookie = getCookie('_ga');
    const browserId = stored.web?.browser_id || id('browser');
    const anonymousId = stored.web?.anonymous_id || localStorage.getItem(LEGACY.anonymous) || id('anon');
    const personId = stored.canonical?.person_id || localStorage.getItem(LEGACY.person) || id('person');
    const analyticsUserId = stored.canonical?.analytics_user_id || localStorage.getItem(LEGACY.analyticsUser) || id('analytics');
    const currentSessionId = sessionIdentity();
    const isNewSession = stored.web?.last_session_id !== currentSessionId;
    const sessionCount = Math.max(1, Number(stored.web?.session_count || 0) + (isNewSession ? 1 : 0));
    const consent = currentConsent();
    const attribution = readLocal(STORAGE.attribution, null) || captureAttribution();
    const network = readLocal(STORAGE.network, {});

    localStorage.setItem(LEGACY.anonymous, anonymousId);
    localStorage.setItem(LEGACY.person, personId);
    localStorage.setItem(LEGACY.analyticsUser, analyticsUserId);

    const envelope = {
      schema_name: 'measurement_stack.identity_graph',
      schema_version: VERSION,
      web_graph_id: stored.web_graph_id || id('webgraph'),
      origin: location.origin,
      canonical: {
        person_id: personId,
        analytics_user_id: analyticsUserId,
        person_status: stored.canonical?.person_status || 'unresolved',
        identity_confidence: stored.canonical?.identity_confidence || 'probabilistic',
        cluster_version: Number(stored.canonical?.cluster_version || 1),
        merged_into_person_id: stored.canonical?.merged_into_person_id || ''
      },
      web: {
        browser_id: browserId,
        anonymous_id: anonymousId,
        cdp_anonymous_id: stored.web?.cdp_anonymous_id || '',
        javascript_client_id: stored.web?.javascript_client_id || browserId,
        network_derived_client_id: network.js_client_id || stored.web?.network_derived_client_id || '',
        ga_client_id: gaClientId(gaCookie),
        ga_cookie_id: gaCookie,
        ga_session_cookies: allGaSessionCookies(),
        fplc_cookie: getCookie('FPLC'),
        fpid_cookie: getCookie('FPID'),
        fbp_cookie: getCookie('_fbp'),
        fbc_cookie: getCookie('_fbc'),
        session_id: currentSessionId,
        session_count: sessionCount,
        last_session_id: currentSessionId,
        first_visit_at: stored.web?.first_visit_at || timestamp,
        last_visit_at: timestamp,
        last_network_observation_id: network.network_observation_id || stored.web?.last_network_observation_id || ''
      },
      auth: {
        state: stored.auth?.state || 'anonymous',
        clerk_user_id: stored.auth?.clerk_user_id || '',
        clerk_session_id: '',
        primary_auth_method: stored.auth?.primary_auth_method || '',
        providers: Array.isArray(stored.auth?.providers) ? stored.auth.providers : []
      },
      billing: {
        stripe_customer_ids: Array.isArray(stored.billing?.stripe_customer_ids) ? stored.billing.stripe_customer_ids : [],
        checkout_session_ids: Array.isArray(stored.billing?.checkout_session_ids) ? stored.billing.checkout_session_ids : [],
        subscription_ids: Array.isArray(stored.billing?.subscription_ids) ? stored.billing.subscription_ids : [],
        current_plan: stored.billing?.current_plan || 'starter',
        billing_status: stored.billing?.billing_status || 'none'
      },
      marketing: {
        first_touch_id: attribution.first_touch_id || '',
        last_touch_id: attribution.last_touch_id || '',
        last_non_direct_touch_id: attribution.last_non_direct_touch_id || '',
        active_click_ids: attribution.active_click_ids || {}
      },
      consent_snapshot_id: consent.consent_snapshot_id,
      first_seen_at: stored.first_seen_at || timestamp,
      first_identified_at: stored.first_identified_at || '',
      last_seen_at: timestamp,
      last_synced_at: stored.last_synced_at || '',
      server_version: Number(stored.server_version || 0),
      expires_at: expiresIso()
    };
    return writeLocal(STORAGE.identity, envelope);
  }

  function lifecycleEnvelope() {
    const stored = readLocal(STORAGE.lifecycle, {});
    const timestamp = nowIso();
    const envelope = {
      schema_name: 'measurement_stack.lifecycle',
      schema_version: VERSION,
      stage: stored.stage || 'visitor',
      stage_entered_at: stored.stage_entered_at || timestamp,
      first_seen_at: stored.first_seen_at || timestamp,
      last_activity_at: timestamp,
      lead_id: stored.lead_id || '',
      checkout_attempt_id: stored.checkout_attempt_id || '',
      stripe_checkout_session_id: stored.stripe_checkout_session_id || '',
      subscription_id: stored.subscription_id || '',
      current_plan: stored.current_plan || 'starter',
      conversion_count: Number(stored.conversion_count || 0),
      history: Array.isArray(stored.history) ? stored.history.slice(-30) : []
    };
    return writeLocal(STORAGE.lifecycle, envelope);
  }

  function recordLifecycle(stage, details = {}) {
    const previous = lifecycleEnvelope();
    const timestamp = nowIso();
    const changed = stage && previous.stage !== stage;
    const envelope = {
      ...previous,
      ...details,
      stage: stage || previous.stage,
      stage_entered_at: changed ? timestamp : previous.stage_entered_at,
      last_activity_at: timestamp,
      conversion_count: previous.conversion_count + (['lead', 'customer', 'subscriber'].includes(stage) && changed ? 1 : 0),
      history: [
        ...previous.history,
        {
          lifecycle_event_id: id('lifecycle'),
          from_stage: previous.stage,
          to_stage: stage || previous.stage,
          occurred_at: timestamp,
          source_event_id: details.source_event_id || ''
        }
      ].slice(-30)
    };
    return writeLocal(STORAGE.lifecycle, envelope);
  }

  function applyResolvedIdentity(identity = {}) {
    const graph = identityEnvelope();
    const timestamp = nowIso();
    if (safeText(identity.person_id, 100)) {
      graph.canonical.person_id = safeText(identity.person_id, 100);
      localStorage.setItem(LEGACY.person, graph.canonical.person_id);
    }
    if (safeText(identity.analytics_user_id, 100)) {
      graph.canonical.analytics_user_id = safeText(identity.analytics_user_id, 100);
      localStorage.setItem(LEGACY.analyticsUser, graph.canonical.analytics_user_id);
    }
    if (safeText(identity.clerk_user_id, 100)) {
      graph.auth.state = 'authenticated';
      graph.auth.clerk_user_id = safeText(identity.clerk_user_id, 100);
      graph.canonical.person_status = 'active';
      graph.canonical.identity_confidence = 'verified';
      graph.first_identified_at = graph.first_identified_at || timestamp;
    }
    if (Array.isArray(identity.auth_providers)) {
      graph.auth.providers = identity.auth_providers
        .filter(isObject)
        .map((provider) => ({
          provider: safeText(provider.provider, 50),
          provider_subject: safeText(provider.provider_subject, 200),
          provider_account_id: safeText(provider.provider_account_id, 100),
          verification_status: safeText(provider.verification_status, 30),
          linked_at: provider.linked_at || timestamp
        }));
      graph.auth.primary_auth_method = graph.auth.providers[0]?.provider || graph.auth.primary_auth_method;
    }
    if (safeText(identity.stripe_customer_id, 100)) {
      graph.billing.stripe_customer_ids = [...new Set([...graph.billing.stripe_customer_ids, safeText(identity.stripe_customer_id, 100)])].slice(-10);
      graph.billing.billing_status = 'customer';
    }
    if (safeText(identity.current_plan, 50)) graph.billing.current_plan = safeText(identity.current_plan, 50);
    graph.last_synced_at = timestamp;
    graph.last_seen_at = timestamp;
    graph.server_version = Math.max(graph.server_version, Number(identity.cluster_version || 1));
    return writeLocal(STORAGE.identity, graph);
  }

  function recordBilling(details = {}) {
    const graph = identityEnvelope();
    const lifecycle = lifecycleEnvelope();
    const timestamp = nowIso();
    const checkoutId = safeText(details.checkout_session_id || details.session_id, 200);
    const customerId = safeText(details.stripe_customer_id, 100);
    const subscriptionId = safeText(details.subscription_id, 100);
    if (checkoutId) graph.billing.checkout_session_ids = [...new Set([...graph.billing.checkout_session_ids, checkoutId])].slice(-20);
    if (customerId) graph.billing.stripe_customer_ids = [...new Set([...graph.billing.stripe_customer_ids, customerId])].slice(-10);
    if (subscriptionId) graph.billing.subscription_ids = [...new Set([...graph.billing.subscription_ids, subscriptionId])].slice(-10);
    if (details.plan) graph.billing.current_plan = safeText(details.plan, 50);
    graph.billing.billing_status = details.payment_status === 'paid' || details.payment_status === 'no_payment_required' ? 'active' : 'checkout';
    graph.last_seen_at = timestamp;
    writeLocal(STORAGE.identity, graph);
    return recordLifecycle(
      graph.billing.billing_status === 'active' ? 'customer' : 'checkout_started',
      {
        stripe_checkout_session_id: checkoutId || lifecycle.stripe_checkout_session_id,
        subscription_id: subscriptionId || lifecycle.subscription_id,
        current_plan: graph.billing.current_plan,
        source_event_id: safeText(details.event_id, 100)
      }
    );
  }

  function nextSequence() {
    const value = Number(sessionStorage.getItem(STORAGE.sequence) || 0) + 1;
    sessionStorage.setItem(STORAGE.sequence, String(value));
    return value;
  }

  function compatibilityAttribution(attribution) {
    const touch = attribution.last_touch || {};
    return {
      utm_source: touch.source === 'direct' ? '' : touch.source || '',
      utm_medium: touch.medium || '',
      utm_campaign: touch.campaign_name || '',
      utm_content: touch.campaign_content || '',
      utm_term: touch.campaign_term || '',
      ...touch.click_ids
    };
  }

  function snapshot() {
    const consent = currentConsent();
    const attribution = readLocal(STORAGE.attribution, null) || captureAttribution();
    const identity = identityEnvelope();
    const lifecycle = lifecycleEnvelope();
    const network = readLocal(STORAGE.network, {});
    return {
      schema_version: VERSION,
      identity,
      attribution,
      lifecycle,
      network,
      consent,
      system: systemInfo(consent),
      policy: readLocal(STORAGE.policy, DEFAULT_POLICY)
    };
  }

  function trackingContext() {
    const state = snapshot();
    const identity = state.identity;
    const legacyAttribution = parseJson(localStorage.getItem(LEGACY.attribution), {});
    return {
      attribution: legacyAttribution,
      attribution_envelope: state.attribution,
      identity_graph: identity,
      lifecycle: state.lifecycle,
      network: state.network,
      consent: state.consent,
      system: state.system,
      collection_policy: state.policy,
      person_id: identity.canonical.person_id,
      analytics_user_id: identity.canonical.analytics_user_id,
      anonymous_user_id: identity.web.anonymous_id,
      browser_id: identity.web.browser_id,
      web_graph_id: identity.web_graph_id,
      cdp_anonymous_id: identity.web.cdp_anonymous_id,
      js_client_id: identity.web.javascript_client_id,
      network_derived_client_id: identity.web.network_derived_client_id,
      network_observation_id: identity.web.last_network_observation_id,
      ga_cookie_id: identity.web.ga_cookie_id,
      client_id: identity.web.ga_client_id,
      ga_session_cookies: identity.web.ga_session_cookies,
      fplc_cookie: identity.web.fplc_cookie,
      fpid_cookie: identity.web.fpid_cookie,
      session_id: identity.web.session_id,
      session_count: identity.web.session_count,
      first_visit_at: identity.web.first_visit_at,
      page_location: location.href,
      page_referrer: document.referrer,
      page_title: document.title
    };
  }

  function eventEnvelope(eventName, parameters = {}) {
    const state = snapshot();
    const eventId = safeText(parameters.event_id, 100) || id('event');
    const timestamp = parameters.event_timestamp || nowIso();
    const identity = state.identity;
    const attributionCompat = compatibilityAttribution(state.attribution);
    const payload = {
      ...parameters,
      event: eventName,
      event_id: eventId,
      event_timestamp: timestamp,
      event_time: parameters.event_time || Math.floor(new Date(timestamp).getTime() / 1000),
      schema: {
        name: 'measurement_stack.event',
        version: VERSION
      },
      measurement_stack: {
        event: {
          name: eventName,
          id: eventId,
          sequence: nextSequence(),
          occurred_at: timestamp,
          source: 'web',
          surface: document.body?.classList.contains('workspace-page') ? 'web_app' : 'marketing_web'
        },
        identity: {
          person_id: identity.canonical.person_id,
          analytics_user_id: identity.canonical.analytics_user_id,
          person_status: identity.canonical.person_status,
          identity_confidence: identity.canonical.identity_confidence,
          web_graph_id: identity.web_graph_id,
          browser_id: identity.web.browser_id,
          anonymous_id: identity.web.anonymous_id,
          cdp_anonymous_id: identity.web.cdp_anonymous_id,
          javascript_client_id: identity.web.javascript_client_id,
          network_derived_client_id: identity.web.network_derived_client_id,
          ga_client_id: identity.web.ga_client_id,
          auth_state: identity.auth.state,
          clerk_user_id: identity.auth.clerk_user_id,
          auth_providers: identity.auth.providers
        },
        session: {
          session_id: identity.web.session_id,
          session_count: identity.web.session_count,
          first_visit_at: identity.web.first_visit_at,
          page_location: location.href,
          page_path: `${location.pathname}${location.search}`,
          page_referrer: document.referrer,
          page_title: document.title
        },
        attribution: state.attribution,
        consent: state.consent,
        network: {
          network_observation_id: state.network.network_observation_id || '',
          ip_mode: state.network.ip_mode || DEFAULT_POLICY.ip,
          anonymized_ip: state.network.anonymized_ip || '',
          country: state.network.country || '',
          region: state.network.region || '',
          geoid: state.network.geoid || ''
        },
        system: state.system,
        lifecycle: state.lifecycle,
        billing: identity.billing,
        collection_policy: state.policy
      },
      user_id: parameters.user_id || identity.canonical.analytics_user_id,
      person_id: parameters.person_id || identity.canonical.person_id,
      analytics_user_id: parameters.analytics_user_id || identity.canonical.analytics_user_id,
      anonymous_user_id: parameters.anonymous_user_id || identity.web.anonymous_id,
      browser_id: parameters.browser_id || identity.web.browser_id,
      client_id: parameters.client_id || identity.web.ga_client_id,
      session_id: parameters.session_id || identity.web.session_id,
      consent_snapshot_id: parameters.consent_snapshot_id || state.consent.consent_snapshot_id,
      ...attributionCompat
    };
    return payload;
  }

  async function refreshNetworkContext() {
    try {
      const response = await fetch('/api/network-context', {
        headers: {
          Accept: 'application/json',
          'X-Measurement-Browser-Id': identityEnvelope().web.browser_id
        }
      });
      if (!response.ok) throw new Error(`Network context returned ${response.status}`);
      const result = await response.json();
      const network = {
        schema_name: 'measurement_stack.network_context',
        schema_version: VERSION,
        network_observation_id: safeText(result.network_observation_id, 100),
        ip_mode: safeText(result.ip_mode, 50),
        anonymized_ip: safeText(result.anonymized_ip, 100),
        js_client_id: safeText(result.js_client_id, 150),
        js_client_id_mode: safeText(result.js_client_id_mode, 50),
        country: safeText(result.country, 10),
        region: safeText(result.region, 100),
        geoid: safeText(result.geoid, 100),
        observed_at: result.observed_at || nowIso(),
        expires_at: result.expires_at || new Date(Date.now() + 30 * 86400000).toISOString()
      };
      writeLocal(STORAGE.network, network);
      const graph = identityEnvelope();
      graph.web.last_network_observation_id = network.network_observation_id;
      graph.web.network_derived_client_id = network.js_client_id;
      graph.last_synced_at = nowIso();
      writeLocal(STORAGE.identity, graph);
      return network;
    } catch (error) {
      return { error: error.message };
    }
  }

  function initialize() {
    writeLocal(STORAGE.policy, { ...DEFAULT_POLICY, ...(readLocal(STORAGE.policy, {}) || {}) });
    captureAttribution();
    identityEnvelope();
    lifecycleEnvelope();
    const network = readLocal(STORAGE.network, {});
    if (!network.observed_at || Date.now() - new Date(network.observed_at).getTime() > 6 * 60 * 60 * 1000) {
      refreshNetworkContext();
    }
    return snapshot();
  }

  const ready = Promise.resolve().then(initialize);

  window.MeasurementStackIdentity = {
    VERSION,
    STORAGE,
    LEGACY,
    DEFAULT_POLICY,
    ready,
    snapshot,
    trackingContext,
    eventEnvelope,
    captureAttribution,
    identityEnvelope,
    lifecycleEnvelope,
    recordLifecycle,
    recordBilling,
    applyResolvedIdentity,
    updateConsent,
    refreshNetworkContext
  };
})();
