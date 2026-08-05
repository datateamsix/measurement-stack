(() => {
  'use strict';

  const status = document.getElementById('pricing-status');
  const buttons = [...document.querySelectorAll('.plan-button')];
  const pendingKey = 'measurestack_pending_plan';

  function setStatus(message, ready = false) {
    status.textContent = message;
    status.classList.toggle('ready', ready);
  }

  function missingStripeVariables(config) {
    const checks = config.integrations?.stripeStatus || {};
    const missing = [];
    if (!checks.secretKey) missing.push('STRIPE_SECRET_KEY');
    if (!checks.growthPrice) missing.push('STRIPE_GROWTH_PRICE_ID');
    if (!checks.scalePrice) missing.push('STRIPE_SCALE_PRICE_ID');
    return missing;
  }

  async function initialize() {
    const config = await window.MeasureStack.ready;
    const { clerk } = await window.MeasureStack.loadClerk();

    window.MeasureStack.track('view_pricing', {
      currency: 'USD',
      plans_shown: 'starter,growth,scale',
      stripe_configured: Boolean(config.integrations?.stripe),
      authentication_status: clerk?.isSignedIn ? 'authenticated' : 'anonymous'
    });

    if (!config.integrations?.stripe) {
      const missing = missingStripeVariables(config);
      setStatus(missing.length
        ? `Stripe checkout is waiting for: ${missing.join(', ')}. Confirm these are set in the Production environment.`
        : 'Stripe checkout is not available in this deployment.');
    } else if (clerk?.isSignedIn) {
      setStatus('Stripe test checkout is ready and will preserve your signed-in canonical person and event IDs.', true);
    } else if (config.clerkPublishableKey) {
      setStatus('Stripe test checkout is ready. Continue as a guest, or sign in first to attach the Clerk user ID.', true);
    } else {
      setStatus('Stripe test checkout is ready in guest mode. Clerk can be added later for signed-in identity stitching.', true);
    }

    const resumePlan = new URLSearchParams(location.search).get('plan') || sessionStorage.getItem(pendingKey);
    if (resumePlan && ['growth', 'scale'].includes(resumePlan) && config.integrations?.stripe) {
      sessionStorage.removeItem(pendingKey);
      await startCheckout(resumePlan, config);
    }
  }

  async function startCheckout(plan, config) {
    const { clerk } = await window.MeasureStack.loadClerk();
    const tracking = window.MeasureStack.trackingContext();
    const identityMode = clerk?.isSignedIn ? 'authenticated' : 'anonymous';

    window.MeasureStack.track('select_plan', {
      plan_id: plan,
      plan_name: plan,
      currency: 'USD',
      authentication_status: identityMode
    });

    if (plan === 'starter') {
      if (clerk?.isSignedIn) {
        location.href = '/app.html?plan=starter';
      } else if (config.clerkPublishableKey) {
        sessionStorage.setItem(pendingKey, 'starter');
        location.href = `/sign-in.html?redirect_url=${encodeURIComponent('/app.html?plan=starter')}`;
      } else {
        location.href = '/#demo';
      }
      return;
    }

    if (!config.integrations?.stripe) {
      const missing = missingStripeVariables(config);
      setStatus(missing.length
        ? `Checkout cannot start because Cloudflare does not expose: ${missing.join(', ')}.`
        : 'Stripe test mode is not configured in this deployment.');
      return;
    }

    const button = buttons.find((item) => item.dataset.plan === plan);
    const eventId = crypto.randomUUID();
    const price = plan === 'growth' ? 49 : 149;
    const originalLabel = button.dataset.originalLabel || button.textContent;
    button.dataset.originalLabel = originalLabel;
    button.disabled = true;
    button.textContent = 'Creating test checkout…';
    setStatus(`Creating a Stripe test Checkout Session in ${identityMode} mode…`, true);

    window.MeasureStack.track('begin_checkout', {
      event_id: eventId,
      currency: 'USD',
      value: price,
      plan_id: plan,
      person_id: tracking.person_id,
      analytics_user_id: tracking.analytics_user_id,
      authentication_status: identityMode
    });

    try {
      const response = await window.MeasureStack.authFetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, eventId, tracking })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Checkout returned ${response.status}.`);
      if (!result.url) throw new Error('Stripe created no redirect URL. Check the configured Price IDs.');
      if (result.identity) window.MeasureStack.applyResolvedIdentity(result.identity);
      location.assign(result.url);
    } catch (error) {
      setStatus(error.message);
      button.disabled = false;
      button.textContent = originalLabel;
      window.MeasureStack.track('checkout_error', {
        event_id: eventId,
        plan_id: plan,
        authentication_status: identityMode,
        error_message: error.message.slice(0, 200)
      });
    }
  }

  buttons.forEach((button) => button.addEventListener('click', async () => {
    const config = await window.MeasureStack.runtimeConfig();
    await startCheckout(button.dataset.plan, config);
  }));

  initialize().catch((error) => {
    setStatus(`Pricing initialization failed: ${error.message}`);
    window.MeasureStack?.track?.('pricing_initialization_error', { error_message: error.message.slice(0, 200) });
  });
})();
