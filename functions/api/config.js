import { json } from '../lib/http.js';

export function onRequestGet({ env }) {
  return json({
    environment: env.MEASURESTACK_ENVIRONMENT || 'development',
    clerkPublishableKey: env.CLERK_PUBLISHABLE_KEY || '',
    integrations: {
      d1: Boolean(env.MEASURESTACK_DB),
      loops: Boolean(env.LOOPS_API_KEY),
      stripe: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_GROWTH_PRICE_ID && env.STRIPE_SCALE_PRICE_ID),
      sgtm: Boolean(env.SGTM_EVENT_ENDPOINT),
      genericWebhook: Boolean(env.LEAD_WEBHOOK_URL),
    },
  });
}
