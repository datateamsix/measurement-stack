import { authenticate } from '../lib/auth.js';
import { errorResponse, HttpError, json, readJson, text } from '../lib/http.js';
import { recordCheckout, syncPerson } from '../lib/identity.js';
import { sendLoopsEvent, settleDelivery } from '../lib/integrations.js';

const PLANS = {
  growth: { amount: 4900, envPrice: 'STRIPE_GROWTH_PRICE_ID' },
  scale: { amount: 14900, envPrice: 'STRIPE_SCALE_PRICE_ID' },
};

function d1SetupError(error) {
  return /no such table|d1_error/i.test(error?.message || '');
}

function throwD1SetupError() {
  throw new HttpError(503, 'D1 is connected, but the identity schema is not installed. Apply migrations/0001_identity_resolution.sql to measurestack-identity, then retry checkout.');
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const authResult = await authenticate(request, env, { required: false, includeUser: true });
    const body = await readJson(request);
    const plan = text(body.plan, 40).toLowerCase();
    if (!PLANS[plan]) throw new HttpError(400, 'Select a valid paid plan.');
    if (!env.STRIPE_SECRET_KEY) throw new HttpError(503, 'Stripe test mode is not configured.');
    const priceId = env[PLANS[plan].envPrice];
    if (!priceId) throw new HttpError(503, `The Stripe price for ${plan} is not configured.`);

    const tracking = body.tracking && typeof body.tracking === 'object' ? body.tracking : {};
    const eventId = text(body.eventId, 100) || crypto.randomUUID();
    let identity;
    try {
      identity = await syncPerson(env, {
        user: authResult.user,
        clerkUserId: authResult.auth?.userId || '',
        tracking,
      });
    } catch (error) {
      if (d1SetupError(error)) throwD1SetupError();
      throw error;
    }

    const identityMode = authResult.isAuthenticated ? 'authenticated' : 'anonymous';
    const origin = new URL(request.url).origin;
    const params = new URLSearchParams();
    params.set('mode', 'subscription');
    params.set('line_items[0][price]', priceId);
    params.set('line_items[0][quantity]', '1');
    params.set('success_url', `${env.STRIPE_SUCCESS_URL || `${origin}/checkout-success.html`}?session_id={CHECKOUT_SESSION_ID}`);
    params.set('cancel_url', env.STRIPE_CANCEL_URL || `${origin}/pricing.html?checkout=cancelled`);
    params.set('client_reference_id', identity.person_id);
    if (identity.primary_email) params.set('customer_email', identity.primary_email);
    params.set('allow_promotion_codes', 'true');
    params.set('metadata[event_id]', eventId);
    params.set('metadata[person_id]', identity.person_id);
    params.set('metadata[analytics_user_id]', identity.analytics_user_id);
    params.set('metadata[authentication_status]', identityMode);
    params.set('subscription_data[metadata][event_id]', eventId);
    params.set('subscription_data[metadata][person_id]', identity.person_id);
    params.set('subscription_data[metadata][plan]', plan);
    params.set('subscription_data[metadata][authentication_status]', identityMode);

    const clerkUserId = identity.clerk_user_id || authResult.auth?.userId || '';
    if (clerkUserId) params.set('metadata[clerk_user_id]', clerkUserId);
    if (tracking.anonymous_user_id) params.set('metadata[anonymous_user_id]', text(tracking.anonymous_user_id, 100));

    const touch = tracking.attribution?.last_touch || {};
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'li_fat_id', 'fbclid']) {
      const value = text(touch[key], 500);
      if (value) params.set(`metadata[${key}]`, value);
    }

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    const session = await response.json();
    if (!response.ok) throw new HttpError(502, session.error?.message || 'Stripe could not create a Checkout Session.');
    if (!session.url) throw new HttpError(502, 'Stripe did not return a Checkout URL.');

    try {
      await recordCheckout(env, {
        sessionId: session.id,
        eventId,
        personId: identity.person_id,
        plan,
        amountTotal: PLANS[plan].amount,
        currency: 'usd',
        paymentStatus: session.payment_status || 'unpaid',
        customerId: typeof session.customer === 'string' ? session.customer : '',
        webhookReceived: false,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      if (d1SetupError(error)) throwD1SetupError();
      throw error;
    }

    const [, loops] = await settleDelivery('loops', sendLoopsEvent(env, {
      email: identity.primary_email,
      userId: identity.person_id,
      eventName: 'checkoutStarted',
      idempotencyKey: eventId,
      contactProperties: {
        personId: identity.person_id,
        analyticsUserId: identity.analytics_user_id,
        clerkUserId,
        pendingPlan: plan,
      },
      eventProperties: {
        eventId,
        stripeSessionId: session.id,
        plan,
        value: PLANS[plan].amount / 100,
        currency: 'USD',
        authenticationStatus: identityMode,
      },
    }));

    return json({
      ok: true,
      url: session.url,
      sessionId: session.id,
      eventId,
      identity,
      identityMode,
      delivery: { loops },
    }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
