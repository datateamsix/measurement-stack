import { errorResponse, HttpError, json } from '../lib/http.js';
import { recordCheckout, recordConversion } from '../lib/identity.js';
import { sendLoopsEvent, sendServerEvent, settleDelivery } from '../lib/integrations.js';
import { verifyStripeSignature } from '../lib/stripe-signature.js';

const MAX_WEBHOOK_BYTES = 512_000;

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    if (!env.STRIPE_WEBHOOK_SECRET) throw new HttpError(503, 'Stripe webhook verification is not configured.');
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_WEBHOOK_BYTES) throw new HttpError(413, 'Webhook body is too large.');
    const rawBody = await request.text();
    const signature = request.headers.get('stripe-signature') || '';
    const valid = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
    if (!valid) throw new HttpError(400, 'Stripe webhook signature verification failed.');

    const event = JSON.parse(rawBody);
    if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
      return json({ received: true, ignored: true });
    }

    const session = event.data.object;
    const metadata = session.metadata || {};
    const eventId = metadata.event_id || session.id;
    const personId = metadata.person_id || session.client_reference_id || '';
    const plan = metadata.plan || 'unknown';
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id || '';
    const email = session.customer_details?.email || session.customer_email || '';
    const amount = Number(session.amount_total || 0);
    const currency = String(session.currency || 'usd').toUpperCase();

    await recordCheckout(env, {
      sessionId: session.id,
      eventId,
      personId,
      plan,
      amountTotal: amount,
      currency: String(session.currency || 'usd'),
      paymentStatus: session.payment_status || 'paid',
      customerId,
      webhookReceived: true,
      createdAt: new Date((event.created || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    });
    await recordConversion(env, {
      eventId,
      eventName: 'purchase',
      personId,
      source: 'stripe_webhook',
      value: amount / 100,
      currency,
      payload: { stripe_session_id: session.id, stripe_customer_id: customerId, plan, event_type: event.type },
    });

    const serverEvent = {
      source: 'stripe',
      event_name: 'purchase',
      event_id: eventId,
      event_time: event.created || Math.floor(Date.now() / 1000),
      action_source: 'website',
      person_id: personId,
      analytics_user_id: metadata.analytics_user_id || '',
      email,
      custom_data: {
        transaction_id: session.id,
        stripe_customer_id: customerId,
        plan,
        value: amount / 100,
        currency,
      },
    };

    const deliveries = await Promise.all([
      settleDelivery('loops', sendLoopsEvent(env, {
        email,
        userId: personId,
        eventName: 'subscriptionCreated',
        idempotencyKey: eventId,
        contactProperties: {
          personId,
          analyticsUserId: metadata.analytics_user_id || '',
          clerkUserId: metadata.clerk_user_id || '',
          stripeCustomerId: customerId,
          currentPlan: plan,
        },
        eventProperties: {
          eventId,
          stripeSessionId: session.id,
          stripeCustomerId: customerId,
          plan,
          value: amount / 100,
          currency,
        },
      })),
      settleDelivery('sgtm', sendServerEvent(env, serverEvent)),
    ]);

    return json({ received: true, eventId, delivery: Object.fromEntries(deliveries) });
  } catch (error) {
    return errorResponse(error);
  }
}
