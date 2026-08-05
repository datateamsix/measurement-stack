import { json } from '../lib/http.js';

export function onRequestGet({ env }) {
  const stripeStatus = {
    secretKey: Boolean(env.STRIPE_SECRET_KEY),
    growthPrice: Boolean(env.STRIPE_GROWTH_PRICE_ID),
    scalePrice: Boolean(env.STRIPE_SCALE_PRICE_ID),
    webhookSecret: Boolean(env.STRIPE_WEBHOOK_SECRET),
  };

  return json({
    environment: env.MEASURESTACK_ENVIRONMENT || 'development',
    clerkPublishableKey: env.CLERK_PUBLISHABLE_KEY || '',
    integrations: {
      d1: Boolean(env.MEASURESTACK_DB || env.DB),
      loops: Boolean(env.LOOPS_API_KEY),
      stripe: stripeStatus.secretKey && stripeStatus.growthPrice && stripeStatus.scalePrice,
      stripeStatus,
      sgtm: Boolean(env.SGTM_EVENT_ENDPOINT),
      genericWebhook: Boolean(env.LEAD_WEBHOOK_URL),
    },
  });
}
