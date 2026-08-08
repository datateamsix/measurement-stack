import { json } from '../lib/http.js';

export function onRequestGet({ env }) {
  const stripeStatus = {
    secretKey: Boolean(env.STRIPE_SECRET_KEY),
    growthPrice: Boolean(env.STRIPE_GROWTH_PRICE_ID),
    scalePrice: Boolean(env.STRIPE_SCALE_PRICE_ID),
    webhookSecret: Boolean(env.STRIPE_WEBHOOK_SECRET),
  };
  const d1 = Boolean(env.MEASUREMENT_STACK_DB || env.DB);

  return json({
    environment: env.MEASUREMENT_STACK_ENVIRONMENT || 'development',
    clerkPublishableKey: env.CLERK_PUBLISHABLE_KEY || '',
    integrations: {
      d1,
      identityGraph: d1,
      identityHashSecret: Boolean(env.IDENTITY_HASH_SECRET),
      loops: Boolean(env.LOOPS_API_KEY),
      stripe: stripeStatus.secretKey && stripeStatus.growthPrice && stripeStatus.scalePrice,
      stripeStatus,
      sgtm: Boolean(env.SGTM_EVENT_ENDPOINT),
      genericWebhook: Boolean(env.LEAD_WEBHOOK_URL),
      networkContext: true,
    },
    collectionPolicy: {
      ip: env.IP_ANONYMIZATION_MODE || 'anonymize_strict',
      javascriptClientId: env.JS_CLIENT_ID_MODE || 'first_party_uuid',
      rawIpInBrowser: false,
      rawUserAgentInDataLayer: false,
      queryParameters: 'campaign_allowlist_only',
      geography: 'country_region_only',
      personalDataInLocalStorage: false,
      paymentDataInLocalStorage: false,
    },
  });
}
