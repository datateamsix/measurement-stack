(() => {
  'use strict';

  const loading = document.getElementById('workspace-loading');
  const content = document.getElementById('workspace-content');

  const row = (label, value) => `<div><dt>${window.MeasureStack.escapeHtml(label)}</dt><dd>${window.MeasureStack.escapeHtml(value || 'Not captured')}</dd></div>`;

  async function getIdentity() {
    const response = await window.MeasureStack.authFetch('/api/identity', { headers: { Accept: 'application/json' } });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      location.replace(`/sign-in.html?redirect_url=${encodeURIComponent('/app.html')}`);
      return null;
    }
    if (!response.ok) throw new Error(result.error || 'Identity profile could not be loaded.');
    return result;
  }

  function renderEvents() {
    const events = window.dataLayer.filter((item) => item && item.event).slice(-12).reverse();
    document.getElementById('event-stream').innerHTML = events.length
      ? events.map((item) => `<article><strong>${window.MeasureStack.escapeHtml(item.event)}</strong><span>${window.MeasureStack.escapeHtml(item.event_id || item.event_timestamp || '')}</span></article>`).join('')
      : '<p>No dataLayer events have been observed yet.</p>';
  }

  async function render() {
    const config = await window.MeasureStack.ready;
    const auth = await window.MeasureStack.loadClerk();
    if (!config.clerkPublishableKey) {
      loading.innerHTML = '<strong>Clerk setup required</strong><p>Add the Clerk environment variables to activate the authenticated workspace.</p>';
      return;
    }
    if (!auth.clerk?.isSignedIn) {
      location.replace(`/sign-in.html?redirect_url=${encodeURIComponent('/app.html')}`);
      return;
    }

    try {
      await window.MeasureStack.syncIdentity();
      const result = await getIdentity();
      if (!result) return;
      const identity = result.identity || {};
      const tracking = window.MeasureStack.trackingContext();
      const touch = tracking.attribution?.last_touch || {};

      window.MeasureStack.applyResolvedIdentity(identity);
      document.getElementById('current-plan').textContent = identity.current_plan || 'starter';
      document.getElementById('identity-storage').textContent = identity.storage === 'd1' ? 'Cloudflare D1' : 'Ephemeral';
      document.getElementById('identity-list').innerHTML = [
        row('Person ID', identity.person_id),
        row('Analytics User ID', identity.analytics_user_id),
        row('Clerk User ID', identity.clerk_user_id),
        row('Email', identity.primary_email),
        row('Anonymous User ID', tracking.anonymous_user_id),
        row('GA Client ID', tracking.client_id),
        row('GA Cookie', tracking.ga_cookie_id),
        row('Stripe Customer', identity.stripe_customer_id)
      ].join('');
      document.getElementById('attribution-list').innerHTML = [
        row('Source', touch.utm_source),
        row('Medium', touch.utm_medium),
        row('Campaign', touch.utm_campaign),
        row('Content', touch.utm_content),
        row('LinkedIn click ID', touch.li_fat_id),
        row('Meta click ID', touch.fbclid),
        row('Landing page', touch.landing_page)
      ].join('');

      const integrations = [
        ['Clerk auth', Boolean(config.clerkPublishableKey)],
        ['Cloudflare D1', Boolean(config.integrations?.d1)],
        ['Loops CRM', Boolean(config.integrations?.loops)],
        ['Stripe test mode', Boolean(config.integrations?.stripe)],
        ['sGTM relay', Boolean(config.integrations?.sgtm)]
      ];
      document.getElementById('integration-list').innerHTML = integrations.map(([name, ready]) => `<div><span>${window.MeasureStack.escapeHtml(name)}</span><b class="${ready ? 'status-ready' : 'status-pending'}">${ready ? 'Ready' : 'Setup needed'}</b></div>`).join('');
      renderEvents();
      loading.hidden = true;
      content.hidden = false;
      window.MeasureStack.track('view_identity_workspace', {
        person_id: identity.person_id || '',
        analytics_user_id: identity.analytics_user_id || '',
        identity_storage: identity.storage || 'unbound'
      });
    } catch (error) {
      loading.innerHTML = `<strong>Workspace error</strong><p>${window.MeasureStack.escapeHtml(error.message)}</p>`;
    }
  }

  document.getElementById('refresh-identity')?.addEventListener('click', () => location.reload());
  render();
})();
