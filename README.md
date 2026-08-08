# MeasureStack

**The attribution and identity resolution OS for your business.**

MeasureStack is a fictitious SaaS product and practical measurement-engineering sandbox. It demonstrates how anonymous behavior, authenticated users, lead submissions, CRM records, Stripe test checkout, and advertising conversion events can resolve to one canonical customer identity.

## What is included

- Cloudflare Pages static site and Pages Functions
- GTM web container `GTM-5MQ3QDNF` on every page
- Consent defaults before GTM initializes
- First-touch and last-touch attribution persistence
- Hidden lead fields for person, analytics user, GA cookie, and UTMs
- Clerk sign-up and sign-in scaffold
- Authenticated identity-resolution workspace
- Cloudflare D1 schema for people, identifiers, leads, touches, checkouts, and conversions
- Loops CRM contact and event delivery
- Stripe-hosted Checkout in test mode
- Verified Stripe webhook and purchase event
- Canonical sGTM relay for lead and purchase events
- Browser/server deduplication using a shared `event_id`
- Standalone **Meridian Consent** SDK, GTM starter kit, and container-classification CLI in [`consent-sdk/`](consent-sdk/README.md)

## Product pages

```text
/                       Lead generation and product landing page
/pricing.html           Starter, Growth, and Scale plans
/sign-in.html           Clerk authentication
/app.html               Authenticated identity workspace
/checkout-success.html  Stripe test conversion inspection
```

## API routes

```text
GET  /api/config
POST /api/lead
GET  /api/identity
POST /api/identity
POST /api/checkout
GET  /api/checkout-session
POST /api/stripe-webhook
GET  /api/health
```

## Identity model

```text
anonymous_user_id
        │
        ├── ga_client_id / ga_cookie_id
        ├── campaign and click IDs
        └── provisional person_id
                    │
                    ▼
              Clerk sign-in
                    │
                    ▼
          canonical D1 person_id
        ├── analytics_user_id
        ├── clerk_user_id
        ├── email
        ├── lead_id
        ├── Loops contact
        └── Stripe customer_id
```

## Local validation

```bash
npm install
npm test
```

Local Cloudflare preview:

```bash
cp .dev.vars.example .dev.vars
npm run dev
```

## Cloudflare deployment

The current project is configured for:

```text
Output directory: public
Deploy command: npx wrangler pages deploy public --project-name=measurestack-leadgen
```

The root-level `functions/` directory is bundled as Pages Functions. `public/_routes.json` limits Functions invocation to `/api/*`, keeping normal static page requests outside the Functions quota.

## Account setup

No secrets are committed. Follow [`docs/account-setup.md`](docs/account-setup.md) for the exact Clerk, D1, Loops, Stripe, and sGTM values to add in Cloudflare.

The shortest useful setup is:

1. Clerk publishable and secret keys
2. D1 database binding named `MEASURESTACK_DB`
3. Loops API key
4. Stripe test secret, two recurring price IDs, and webhook secret
5. Optional sGTM JSON endpoint

## D1 migration

Create a database named `measurestack-identity`, bind it as `MEASURESTACK_DB`, and run:

```bash
npx wrangler d1 migrations apply measurestack-identity --remote
```

## Conversion paths

### Lead

```text
Browser generate_lead
        +
Cloudflare server generate_lead
        └── shared event_id
```

### Checkout

```text
Browser begin_checkout
Stripe Checkout Session metadata
Stripe webhook purchase
Browser checkout-success purchase
        └── shared event_id
```

See [`docs/product-event-plan.md`](docs/product-event-plan.md) for the lifecycle event schema.

## Important sandbox limits

- Stripe must remain in test mode unless you intentionally want real charges.
- `marketingMeasurementConsent` is advertising measurement consent, not email marketing consent.
- Hidden browser fields are useful for testing but must not be treated as trusted server identity without authentication.
- D1 is the identity system of record; Loops is a visible CRM destination, not a full identity graph.
- Add a real privacy policy, retention controls, Turnstile, and production consent management before collecting real customer data.
