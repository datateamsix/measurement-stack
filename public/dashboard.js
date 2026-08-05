(() => {
  'use strict';

  const loading = document.getElementById('workspace-loading');
  const content = document.getElementById('workspace-content');
  const escape = window.MeasureStack.escapeHtml;

  const row = (label, value) => `<div><dt>${escape(label)}</dt><dd>${escape(value || 'Not captured')}</dd></div>`;

  async function getServerIdentity() {
    const response = await window.MeasureStack.authFetch('/api/identity', { headers: { Accept: 'application/json' } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Identity profile could not be loaded.');
    return result;
  }

  function renderEvents() {
    const events = window.dataLayer
      .filter((item) => item && item.event && !String(item.event).startsWith('gtm.'))
      .slice(-20)
      .reverse();
    document.getElementById('event-stream').innerHTML = events.length
      ? events.map((item) => {
          const schema = item.schema?.name
            ? `${item.schema.name}@${item.schema.version || ''}`
            : 'legacy event';
          return `<article><strong>${escape(item.event)}</strong><span>${escape(item.event_id || item.event_timestamp || '')}</span><small>${escape(schema)}</small></article>`;
        }).join('')
      : '<p>No Measurement Stack dataLayer events have been observed yet.</p>';
  }

  function graphNode(type, identifier, relationship) {
    if (!identifier) return '';
    return `<div class="graph-node"><strong>${escape(type)}</strong><code>${escape(identifier)}</code><span>${escape(relationship)}</span></div>`;
  }

  function renderGraph(snapshot, serverGraph = {}) {
    const identity = snapshot.identity;
    const external = serverGraph.external_auth_identities || [];
    const edges = serverGraph.edges || [];
    const aliases = serverGraph.billing_aliases || [];
    const browserCount = Math.max(1, serverGraph.browser_identities?.length || 0);
    const providerCount = external.length || identity.auth.providers.length;
    const billingCount = aliases.length
      || identity.billing.stripe_customer_ids.length
      + identity.billing.checkout_session_ids.length
      + identity.billing.subscription_ids.length;
    const authoritative = serverGraph.cluster?.authoritative_edge_count || edges.filter((edge) => edge.authoritative_flag).length;

    document.getElementById('graph-summary').innerHTML = [
      ['Browser identities', browserCount],
      ['Auth providers', providerCount],
      ['Billing aliases', billingCount],
      ['Authoritative edges', authoritative],
    ].map(([label, value]) => `<article><span>${escape(label)}</span><strong>${escape(value)}</strong></article>`).join('');

    const nodes = [
      graphNode('Canonical person', identity.canonical.person_id, identity.canonical.identity_confidence),
      graphNode('Analytics user', identity.canonical.analytics_user_id, 'GA4 User-ID projection'),
      graphNode('Web graph', identity.web_graph_id, 'browser graph instance'),
      graphNode('Browser', identity.web.browser_id, 'observed_on'),
      graphNode('Anonymous visitor', identity.web.anonymous_id, 'aliased_to browser'),
      graphNode('JavaScript client', identity.web.javascript_client_id, 'first-party browser ID'),
      graphNode('Network client', identity.web.network_derived_client_id, snapshot.network.js_client_id_mode || 'privacy reduced'),
      graphNode('GA client', identity.web.ga_client_id, 'analytics alias'),
      graphNode('Clerk user', identity.auth.clerk_user_id, 'authenticated_as'),
      ...external.map((account) => graphNode(
        `${account.provider || 'OAuth'} identity`,
        account.provider_subject,
        'authoritative provider subject',
      )),
      ...identity.billing.stripe_customer_ids.map((value) => graphNode('Stripe customer', value, 'paid_by')),
      ...identity.billing.checkout_session_ids.slice(-3).map((value) => graphNode('Checkout session', value, 'owns')),
      ...identity.billing.subscription_ids.slice(-3).map((value) => graphNode('Subscription', value, 'owns')),
    ].filter(Boolean);

    document.getElementById('graph-node-list').innerHTML = nodes.length
      ? nodes.join('')
      : '<p>No graph nodes are available yet.</p>';
  }

  function renderPolicy(policy) {
    const priority = [
      'ip',
      'javascript_client_id',
      'network_derived_client_id',
      'ga_client_id',
      'ga_cookie',
      'ga_session_cookies',
      'fplc_cookie',
      'fpid_cookie',
      'user_id',
      'session_id',
      'query_parameters',
      'referrer',
      'user_agent',
      'geography',
      'screen',
      'language',
      'advertising_ids',
      'raw_personal_data_in_local_storage',
      'raw_payment_data_in_local_storage',
    ];
    document.getElementById('policy-list').innerHTML = priority
      .filter((key) => Object.prototype.hasOwnProperty.call(policy, key))
      .map((key) => `<div><dt>${escape(key.replaceAll('_', ' '))}</dt><dd>${escape(policy[key])}</dd></div>`)
      .join('');
  }

  function renderEnvelope(snapshot) {
    document.getElementById('envelope-viewer').textContent = JSON.stringify({
      identity: snapshot.identity,
      attribution: snapshot.attribution,
      lifecycle: snapshot.lifecycle,
      network: snapshot.network,
      consent: snapshot.consent,
      collection_policy: snapshot.policy,
    }, null, 2);
  }

  async function render() {
    const config = await window.MeasureStack.ready;
    await window.MeasureStack.identityReady;
    const auth = await window.MeasureStack.loadClerk();
    let serverResult = null;

    try {
      if (auth.clerk?.isSignedIn) {
        await window.MeasureStack.syncIdentity();
        serverResult = await getServerIdentity();
        if (serverResult.identity) window.MeasureStack.applyResolvedIdentity({
          ...serverResult.identity,
          auth_providers: serverResult.graph?.external_auth_identities || [],
        });
      }

      const snapshot = window.MeasureStack.identitySnapshot();
      const identity = serverResult?.identity || snapshot.identity.canonical;
      const graph = serverResult?.graph || {};
      const touch = snapshot.attribution.last_touch || {};
      const authState = auth.clerk?.isSignedIn ? 'Authenticated' : 'Anonymous';
      const storageLabel = serverResult?.identity?.storage === 'd1'
        ? 'D1 + local envelope'
        : 'Local envelope';

      document.getElementById('current-plan').textContent =
        serverResult?.identity?.current_plan || snapshot.identity.billing.current_plan || 'starter';
      document.getElementById('identity-storage').textContent = storageLabel;
      document.getElementById('auth-state').textContent = authState;
      document.getElementById('lifecycle-stage').textContent = snapshot.lifecycle.stage || 'visitor';

      document.getElementById('identity-list').innerHTML = [
        row('Person ID', serverResult?.identity?.person_id || snapshot.identity.canonical.person_id),
        row('Analytics User ID', serverResult?.identity?.analytics_user_id || snapshot.identity.canonical.analytics_user_id),
        row('Person status', snapshot.identity.canonical.person_status),
        row('Identity confidence', snapshot.identity.canonical.identity_confidence),
        row('Web graph ID', snapshot.identity.web_graph_id),
        row('Browser ID', snapshot.identity.web.browser_id),
        row('Anonymous ID', snapshot.identity.web.anonymous_id),
        row('JavaScript Client ID', snapshot.identity.web.javascript_client_id),
        row('Network-derived Client ID', snapshot.identity.web.network_derived_client_id),
        row('GA Client ID', snapshot.identity.web.ga_client_id),
        row('Clerk User ID', serverResult?.identity?.clerk_user_id || snapshot.identity.auth.clerk_user_id),
        row('Stripe Customer', serverResult?.identity?.stripe_customer_id || snapshot.identity.billing.stripe_customer_ids.at(-1)),
        row('Consent snapshot', snapshot.identity.consent_snapshot_id),
      ].join('');

      document.getElementById('attribution-list').innerHTML = [
        row('Touch ID', touch.touch_id),
        row('Channel', touch.channel),
        row('Source', touch.source),
        row('Medium', touch.medium),
        row('Campaign', touch.campaign_name),
        row('Content', touch.campaign_content),
        row('Google click ID', touch.click_ids?.gclid),
        row('Display click ID', touch.click_ids?.dclid),
        row('LinkedIn click ID', touch.click_ids?.li_fat_id),
        row('Meta click ID', touch.click_ids?.fbclid),
        row('Landing page', touch.landing_page),
      ].join('');

      const integrations = [
        ['Clerk auth', Boolean(config.clerkPublishableKey)],
        ['Cloudflare D1', Boolean(config.integrations?.d1)],
        ['Canonical graph migration', Boolean(graph.configured && !graph.migration_required)],
        ['Loops CRM', Boolean(config.integrations?.loops)],
        ['Stripe test mode', Boolean(config.integrations?.stripe)],
        ['sGTM relay', Boolean(config.integrations?.sgtm)],
        ['Network context', Boolean(snapshot.network.network_observation_id)],
      ];
      document.getElementById('integration-list').innerHTML = integrations
        .map(([name, ready]) => `<div><span>${escape(name)}</span><b class="${ready ? 'status-ready' : 'status-pending'}">${ready ? 'Ready' : 'Setup needed'}</b></div>`)
        .join('');

      renderGraph(snapshot, graph);
      renderPolicy(snapshot.policy);
      renderEnvelope(snapshot);
      renderEvents();

      loading.hidden = true;
      content.hidden = false;
      window.MeasureStack.track('view_identity_workspace', {
        person_id: identity.person_id || snapshot.identity.canonical.person_id,
        analytics_user_id: identity.analytics_user_id || snapshot.identity.canonical.analytics_user_id,
        identity_storage: storageLabel,
        authentication_status: auth.clerk?.isSignedIn ? 'authenticated' : 'anonymous',
        graph_edge_count: graph.edges?.length || 0,
      });
      setTimeout(renderEvents, 0);
    } catch (error) {
      loading.innerHTML = `<strong>Workspace error</strong><p>${escape(error.message)}</p>`;
    }
  }

  document.getElementById('refresh-identity')?.addEventListener('click', async () => {
    await window.MeasureStack.refreshNetworkContext?.();
    location.reload();
  });

  render();
})();
