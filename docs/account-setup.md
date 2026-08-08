# Measurement Stack account and token setup

The repository contains no real account credentials. Configure the following values in Cloudflare under the project’s **Settings → Variables and Secrets**. Add secrets to both Production and Preview only when you intentionally want both environments connected.

## 1. Clerk authentication

Create a free Clerk application and enable email/password or the social providers you want to test.

| Cloudflare variable | Clerk value | Secret? |
|---|---|---|
| `CLERK_PUBLISHABLE_KEY` | Publishable key beginning with `pk_test_` | No |
| `CLERK_SECRET_KEY` | Secret key beginning with `sk_test_` | Yes |
| `CLERK_AUTHORIZED_PARTIES` | Comma-separated allowed origins | No |

Example authorized parties:

```text
https://measurement-stack-leadgen.pages.dev,https://your-custom-domain.example
```

After deployment, add the Pages domain to the Clerk application’s allowed origins and redirect URLs.

## 2. Cloudflare D1 identity database

Create a D1 database named `measurement-stack-identity`. Bind it to the Pages project with this exact variable name:

```text
MEASUREMENT_STACK_DB
```

Apply the schema:

```bash
npx wrangler d1 migrations apply measurement-stack-identity --remote
```

The migration is stored at `migrations/0001_identity_resolution.sql`.

The application remains usable without D1, but canonical identity data is then ephemeral and the workspace will report `Unbound` storage.

## 3. Loops CRM

Create a free Loops account and API key.

| Cloudflare variable | Loops value | Secret? |
|---|---|---|
| `LOOPS_API_KEY` | API key from Loops settings | Yes |

Create these optional custom contact properties in Loops to make the payload easy to inspect:

```text
personId
analyticsUserId
clerkUserId
gaClientId
gaCookieId
company
jobTitle
companySize
useCase
utmSource
utmMedium
utmCampaign
utmContent
latestLeadId
latestEventId
latestConversionAt
pendingPlan
currentPlan
stripeCustomerId
```

The integration sends these events:

```text
identityResolved
leadSubmitted
checkoutStarted
subscriptionCreated
```

## 4. Stripe test checkout

Keep Stripe in test mode.

| Cloudflare variable | Stripe value | Secret? |
|---|---|---|
| `STRIPE_SECRET_KEY` | Test secret key beginning with `sk_test_` | Yes |
| `STRIPE_GROWTH_PRICE_ID` | Recurring Growth price ID | No |
| `STRIPE_SCALE_PRICE_ID` | Recurring Scale price ID | No |
| `STRIPE_WEBHOOK_SECRET` | Signing secret beginning with `whsec_` | Yes |

Create two recurring monthly test prices:

```text
Growth: $49 USD
Scale: $149 USD
```

Add a Stripe webhook endpoint:

```text
https://YOUR_DOMAIN/api/stripe-webhook
```

Subscribe to:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
```

The success page is generated automatically from the deployed origin. Optional overrides:

```text
STRIPE_SUCCESS_URL
STRIPE_CANCEL_URL
```

## 5. Server-side GTM or generic event endpoint

To relay canonical server events, configure:

| Cloudflare variable | Value | Secret? |
|---|---|---|
| `SGTM_EVENT_ENDPOINT` | HTTPS endpoint that accepts JSON events | No |
| `SGTM_BEARER_TOKEN` | Optional endpoint bearer token | Yes |

The relay sends canonical `generate_lead` and `purchase` payloads. Use the `event_id` field for browser/server deduplication in downstream Meta or LinkedIn tags.

The endpoint may be an sGTM custom client route, a Stape endpoint, a Cloudflare Worker acting as an event gateway, or another test receiver.

## 6. Optional generic lead webhook

The original generic webhook remains available:

```text
LEAD_WEBHOOK_URL
LEAD_WEBHOOK_BEARER_TOKEN
```

## Minimum setup order

1. Deploy the repository without credentials.
2. Add Clerk keys and test sign-in.
3. Create and bind D1, then apply the migration.
4. Add Loops and submit the lead form.
5. Add Stripe test prices and webhook.
6. Add an sGTM endpoint when you are ready to test server-side media events.
