(() => {
  'use strict';

  async function initialize() {
    const target = document.getElementById('checkout-result');
    const sessionId = new URLSearchParams(location.search).get('session_id');
    await window.MeasureStack.ready;
    await window.MeasureStack.identityReady;
    const auth = await window.MeasureStack.loadClerk();
    const tracking = window.MeasureStack.trackingContext();

    if (!sessionId) {
      target.innerHTML = '<p class="eyebrow">Missing session</p><h1>No Stripe Checkout Session was provided.</h1><a class="primary-button" href="/pricing.html">Return to pricing</a>';
      return;
    }

    try {
      const params = new URLSearchParams({
        session_id: sessionId,
        person_id: tracking.person_id,
      });
      const response = await window.MeasureStack.authFetch(`/api/checkout-session?${params.toString()}`);
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Checkout session could not be loaded.');

      const session = result.session;
      const identity = result.identity || {};
      const identityMode = result.identityMode || (auth.clerk?.isSignedIn ? 'authenticated' : 'anonymous');
      const eventId = session.event_id || session.id;
      const purchaseKey = `measurestack_purchase_${session.id}`;

      if (identity.person_id || identity.analytics_user_id) {
        window.MeasureStack.applyResolvedIdentity(identity);
      }

      window.MeasureStack.recordBilling?.({
        event_id: eventId,
        checkout_session_id: session.id,
        stripe_customer_id: session.customer_id || '',
        subscription_id: session.subscription_id || '',
        payment_status: session.payment_status,
        plan: session.plan,
      });

      if (!localStorage.getItem(purchaseKey) && ['paid', 'no_payment_required'].includes(session.payment_status)) {
        window.MeasureStack.track('purchase', {
          event_id: eventId,
          transaction_id: session.id,
          value: session.amount_total / 100,
          currency: String(session.currency || 'usd').toUpperCase(),
          plan_id: session.plan,
          person_id: identity.person_id || tracking.person_id,
          analytics_user_id: identity.analytics_user_id || tracking.analytics_user_id,
          stripe_customer_id: session.customer_id || '',
          subscription_id: session.subscription_id || '',
          authentication_status: identityMode,
          webhook_received: Boolean(session.webhook_received),
          items: [{
            item_id: session.plan,
            item_name: `${session.plan} subscription`,
            price: session.amount_total / 100,
            quantity: 1,
          }],
        });
        localStorage.setItem(purchaseKey, eventId);
      }

      target.innerHTML = `
        <div class="success-icon"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-9"></path></svg></div>
        <p class="eyebrow">Stripe test checkout complete</p>
        <h1>${window.MeasureStack.escapeHtml(session.plan)} is attached to one ${window.MeasureStack.escapeHtml(identityMode)} identity.</h1>
        <p>Compare the structured browser purchase event with the Stripe webhook, D1 graph, Loops event, and sGTM server event using the same event ID.</p>
        <dl class="checkout-details">
          <div><dt>Session ID</dt><dd>${window.MeasureStack.escapeHtml(session.id)}</dd></div>
          <div><dt>Event ID</dt><dd>${window.MeasureStack.escapeHtml(eventId)}</dd></div>
          <div><dt>Person ID</dt><dd>${window.MeasureStack.escapeHtml(identity.person_id || tracking.person_id)}</dd></div>
          <div><dt>Identity mode</dt><dd>${window.MeasureStack.escapeHtml(identityMode)}</dd></div>
          <div><dt>Stripe customer</dt><dd>${window.MeasureStack.escapeHtml(session.customer_id || 'pending')}</dd></div>
          <div><dt>Subscription</dt><dd>${window.MeasureStack.escapeHtml(session.subscription_id || 'pending')}</dd></div>
          <div><dt>Payment status</dt><dd>${window.MeasureStack.escapeHtml(session.payment_status)}</dd></div>
          <div><dt>Webhook recorded</dt><dd>${session.webhook_received ? 'Yes' : 'Not yet'}</dd></div>
        </dl>
        <div class="hero-actions"><a class="primary-button" href="/app.html">Open identity graph</a><a class="secondary-link" href="/pricing.html">Run another test</a></div>`;
    } catch (error) {
      target.innerHTML = `<p class="eyebrow">Checkout verification failed</p><h1>${window.MeasureStack.escapeHtml(error.message)}</h1><p>Confirm that the Stripe session was opened from this browser and that the latest Cloudflare deployment is active.</p><a class="primary-button" href="/pricing.html">Return to pricing</a>`;
      window.MeasureStack.track('checkout_error', {
        session_id: sessionId,
        error_message: error.message.slice(0, 200),
      });
    }
  }

  initialize().catch((error) => {
    const target = document.getElementById('checkout-result');
    target.innerHTML = `<p class="eyebrow">Checkout initialization failed</p><h1>${window.MeasureStack.escapeHtml(error.message)}</h1><a class="primary-button" href="/pricing.html">Return to pricing</a>`;
  });
})();
