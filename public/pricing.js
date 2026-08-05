(() => {
  'use strict';

  const status = document.getElementById('pricing-status');
  const buttons = [...document.querySelectorAll('.plan-button')];
  const pendingKey = 'measurestack_pending_plan';

  async function initialize() {
    const config = await window.MeasureStack.ready;
    const { clerk } = await window.MeasureStack.loadClerk();
    window.MeasureStack.track('view_pricing', {
      currency: 'USD',
      plans_shown: 'starter,growth,scale',
      stripe_configured: Boolean(config.integrations?.stripe)
    });

    if (!config.clerkPublishableKey) {
      status.textContent = 'Connect Clerk to enable account creation and signed-in checkout tracking.';
    } else if (!config.integrations?.stripe) {
      status.textContent = 'Authentication is ready. Add Stripe test keys and price IDs to enable Growth and Scale checkout.';
    } else {
      status.textContent = clerk?.isSignedIn
        ? 'Signed in. Test checkout will preserve your canonical person and event IDs.'
        : 'Sign in during checkout to resolve the subscription to your existing browser identity.';
      status.classList.add('ready');
    }

    const resumePlan = new URLSearchParams(location.search).get('plan') || sessionStorage.getItem(pendingKey);
    if (resumePlan && clerk?.isSignedIn) {
      sessionStorage.removeItem(pendingKey);
      await startCheckout(resumePlan, config);
    }
  }

  async function startCheckout(plan, config) {
    const { clerk } = await window.MeasureStack.loadClerk();
    window.MeasureStack.track('select_plan', { plan_id: plan, plan_name: plan, currency: 'USD' });

    if (plan === 'starter') {
      if (clerk?.isSignedIn) {
        location.href = '/app.html?plan=starter';
      } else if (config.clerkPublishableKey) {
        sessionStorage.setItem(pendingKey, 'starter');
        location.href = '/sign-in.html?redirect_url=/app.html?plan=starter';
      } else {
        status.textContent = 'Create a Clerk application and add its publishable key to enable Starter accounts.';
      }
      return;
    }

    if (!config.clerkPublishableKey) {
      status.textContent = 'Clerk must be configured before an authenticated checkout can begin.';
      return;
    }
    if (!clerk?.isSignedIn) {
      sessionStorage.setItem(pendingKey, plan);
      location.href = `/sign-in.html?redirect_url=${encodeURIComponent(`/pricing.html?plan=${plan}`)}`;
      return;
    }
    if (!config.integrations?.stripe) {
      status.textContent = 'Stripe test mode is not configured yet. Add the secret key and plan price IDs in Cloudflare.';
      return;
    }

    const button = buttons.find((item) => item.dataset.plan === plan);
    const eventId = crypto.randomUUID();
    const price = plan === 'growth' ? 49 : 149;
    button.disabled = true;
    button.textContent = 'Creating test checkout…';
    status.textContent = 'Creating a Stripe test Checkout Session…';

    window.MeasureStack.track('begin_checkout', {
      event_id: eventId,
      currency: 'USD',
      value: price,
      plan_id: plan,
      person_id: window.MeasureStack.trackingContext().person_id,
      analytics_user_id: window.MeasureStack.trackingContext().analytics_user_id
    });

    try {
      const response = await window.MeasureStack.authFetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, eventId, tracking: window.MeasureStack.trackingContext() })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Checkout could not be created.');
      if (result.identity) window.MeasureStack.applyResolvedIdentity(result.identity);
      location.href = result.url;
    } catch (error) {
      status.textContent = error.message;
      status.classList.remove('ready');
      button.disabled = false;
      button.textContent = 'Start test checkout';
      window.MeasureStack.track('checkout_error', { event_id: eventId, plan_id: plan, error_message: error.message.slice(0, 200) });
    }
  }

  buttons.forEach((button) => button.addEventListener('click', async () => {
    const config = await window.MeasureStack.runtimeConfig();
    await startCheckout(button.dataset.plan, config);
  }));

  initialize();
})();
