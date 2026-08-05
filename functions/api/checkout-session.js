import { authenticate } from '../lib/auth.js';
import { errorResponse, HttpError, json, text } from '../lib/http.js';
import { getCheckout, getPerson, syncPerson } from '../lib/identity.js';

export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    const authResult = await authenticate(request, env, { required: true, includeUser: true });
    if (!env.STRIPE_SECRET_KEY) throw new HttpError(503, 'Stripe test mode is not configured.');
    const sessionId = text(new URL(request.url).searchParams.get('session_id'), 200);
    if (!sessionId.startsWith('cs_')) throw new HttpError(400, 'A valid Checkout Session ID is required.');

    let identity = await getPerson(env, authResult.auth.userId);
    if (!identity) {
      identity = await syncPerson(env, { user: authResult.user, clerkUserId: authResult.auth.userId, tracking: {} });
    }

    const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    const session = await response.json();
    if (!response.ok) throw new HttpError(502, session.error?.message || 'Stripe could not retrieve the Checkout Session.');
    if (session.client_reference_id !== identity.person_id) throw new HttpError(403, 'This Checkout Session belongs to a different user.');

    const stored = await getCheckout(env, session.id);
    return json({
      ok: true,
      identity,
      session: {
        id: session.id,
        event_id: session.metadata?.event_id || '',
        plan: session.metadata?.plan || stored?.plan_id || 'unknown',
        amount_total: session.amount_total || stored?.amount_total || 0,
        currency: session.currency || stored?.currency || 'usd',
        payment_status: session.payment_status || stored?.payment_status || 'unpaid',
        status: session.status || '',
        customer_id: typeof session.customer === 'string' ? session.customer : session.customer?.id || stored?.stripe_customer_id || '',
        subscription_id: typeof session.subscription === 'string' ? session.subscription : session.subscription?.id || '',
        webhook_received: Boolean(stored?.webhook_received),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
