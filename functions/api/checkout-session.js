import { authenticate } from '../lib/auth.js';
import { errorResponse, HttpError, json, text } from '../lib/http.js';
import { getCheckout, getPerson, getPersonById, recordCheckout, syncPerson } from '../lib/identity.js';
import { persistBillingGraph } from '../lib/identity-graph.js';

export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    const authResult = await authenticate(request, env, { required: false, includeUser: true });
    if (!env.STRIPE_SECRET_KEY) throw new HttpError(503, 'Stripe test mode is not configured.');

    const url = new URL(request.url);
    const sessionId = text(url.searchParams.get('session_id'), 200);
    const browserPersonId = text(url.searchParams.get('person_id'), 100);
    if (!sessionId.startsWith('cs_')) throw new HttpError(400, 'A valid Checkout Session ID is required.');

    const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    const session = await response.json();
    if (!response.ok) throw new HttpError(502, session.error?.message || 'Stripe could not retrieve the Checkout Session.');

    const sessionPersonId = text(session.client_reference_id || session.metadata?.person_id, 100);
    if (!sessionPersonId) throw new HttpError(422, 'The Checkout Session has no Measurement Stack person ID.');

    let identity;
    if (authResult.isAuthenticated) {
      identity = await getPerson(env, authResult.auth.userId);
      if (!identity) {
        identity = await syncPerson(env, {
          user: authResult.user,
          clerkUserId: authResult.auth.userId,
          tracking: {
            person_id: browserPersonId || sessionPersonId,
            analytics_user_id: session.metadata?.analytics_user_id || '',
          },
        });
      }
      if (identity.person_id !== sessionPersonId) {
        throw new HttpError(403, 'This Checkout Session belongs to a different resolved identity.');
      }
    } else {
      if (!browserPersonId || browserPersonId !== sessionPersonId) {
        throw new HttpError(403, 'This Checkout Session does not match the current browser identity.');
      }
      identity = await getPersonById(env, sessionPersonId) || {
        person_id: sessionPersonId,
        analytics_user_id: session.metadata?.analytics_user_id || '',
        clerk_user_id: '',
        primary_email: session.customer_details?.email || session.customer_email || '',
        current_plan: session.metadata?.plan || 'starter',
        stripe_customer_id: typeof session.customer === 'string' ? session.customer : session.customer?.id || '',
        storage: 'stripe',
      };
    }

    const stored = await getCheckout(env, session.id);
    const customerId = typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id || stored?.stripe_customer_id || '';
    const subscriptionId = typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id || '';
    const plan = session.metadata?.plan || stored?.plan_id || 'unknown';
    const eventId = session.metadata?.event_id || stored?.event_id || session.id;
    const paymentStatus = session.payment_status || stored?.payment_status || 'unpaid';

    await recordCheckout(env, {
      sessionId: session.id,
      eventId,
      personId: sessionPersonId,
      plan,
      amountTotal: session.amount_total || stored?.amount_total || 0,
      currency: session.currency || stored?.currency || 'usd',
      paymentStatus,
      customerId,
      webhookReceived: Boolean(stored?.webhook_received),
      createdAt: stored?.created_at || new Date().toISOString(),
    });
    await persistBillingGraph(env, {
      personId: sessionPersonId,
      browserId: session.metadata?.browser_id || '',
      eventId,
      stripeCustomerId: customerId,
      checkoutSessionId: session.id,
      subscriptionId,
      planId: plan,
      paymentStatus,
    });

    return json({
      ok: true,
      identity,
      identityMode: authResult.isAuthenticated ? 'authenticated' : 'anonymous',
      session: {
        id: session.id,
        event_id: eventId,
        plan,
        amount_total: session.amount_total || stored?.amount_total || 0,
        currency: session.currency || stored?.currency || 'usd',
        payment_status: paymentStatus,
        status: session.status || '',
        customer_id: customerId,
        subscription_id: subscriptionId,
        webhook_received: Boolean(stored?.webhook_received),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
