# MeasureStack lead-generation sandbox

A zero-dependency, fictitious analytics SaaS lead-generation site built for Cloudflare Pages. The project is designed as a practical sandbox for:

- Google Tag Manager web container `GTM-5MQ3QDNF`
- Google Consent Mode
- GA4 events routed through a server-side GTM container
- LinkedIn browser conversion tracking
- LinkedIn Conversions API through sGTM
- Browser/server conversion deduplication with a shared `event_id`
- First-touch and last-touch campaign attribution
- First-party identity fields and the `_ga` cookie value

## Project structure

```text
public/                     Static website deployed by Cloudflare Pages
functions/api/lead.js       Lead validation and optional webhook relay
functions/api/health.js     Health endpoint
docs/tracking-plan.md       dataLayer schema and GTM/sGTM setup
docs/identity-fields.md     Identity and hidden-field data dictionary
tests/                      Dependency-free validation tests
wrangler.toml               Cloudflare Pages configuration
```

## Conversion behavior

The form uses a deliberate two-stage event model:

1. `form_submit_attempt` fires immediately before the request to `/api/lead`.
2. `generate_lead` fires only after the Cloudflare Pages Function validates and accepts the lead.

The browser generates one UUID `event_id`, sends it with the lead request, and reuses the accepted ID in `generate_lead`. Map this same ID to both the LinkedIn browser conversion and the LinkedIn CAPI tag to support deduplication.

The successful event also includes the server-generated `lead_id`.

## Hidden form fields

The form automatically populates:

```text
person_id
analytics_user_id
ga_cookie_id
utm_source
utm_medium
utm_content
utm_campaign
event_id
conversion_happened_at
```

For this sandbox, `person_id` and `analytics_user_id` are stable first-party UUIDs stored in `localStorage`. They may also be supplied through query parameters for deterministic testing:

```text
?person_id=person_123&analytics_user_id=user_456
```

In a production implementation, replace these generated IDs with approved backend, CRM, CDP, or authenticated account identifiers. Hidden fields are client-controlled and must not be treated as authoritative without server-side validation.

## Configure tracking

The GTM web container is already installed in `public/index.html`:

```text
GTM-5MQ3QDNF
```

Update the public configuration when the LinkedIn conversion rule is available:

```js
window.MEASURESTACK_CONFIG = {
  gtmId: 'GTM-5MQ3QDNF',
  linkedInConversionRuleId: '12345678',
  environment: 'development'
};
```

The LinkedIn conversion rule ID is safe to expose in browser configuration. Never put a LinkedIn access token or GA4 Measurement Protocol API secret in browser code.

## Deploy through Cloudflare Pages

1. In Cloudflare, open **Workers & Pages → Create application → Pages**.
2. Connect the private GitHub repository.
3. Select the repository and production branch.
4. Set **Build command** to blank.
5. Set **Build output directory** to `public`.
6. Deploy.

Cloudflare detects the root `functions/` directory and exposes:

- `POST /api/lead`
- `GET /api/health`

### Optional Pages environment variables

Under **Settings → Variables and Secrets**, optionally add:

```text
LEAD_WEBHOOK_URL
LEAD_WEBHOOK_BEARER_TOKEN
DEBUG_LEADS=false
```

With no webhook configured, form submissions are validated and acknowledged but not durably retained.

## Local preview

With Wrangler installed:

```bash
cp .dev.vars.example .dev.vars
npx wrangler pages dev public
```

A plain static server can preview the design, but `/api/lead` requires Wrangler or a deployed Pages project.

## Run checks

No package installation is required:

```bash
npm test
```

## Recommended measurement path

```text
Browser dataLayer: generate_lead
  ├─ GTM web → LinkedIn browser conversion
  └─ Google Tag / GA4 event → first-party sGTM endpoint
       ├─ GA4 server tag → GA4
       └─ LinkedIn CAPI server tag → LinkedIn
```

See `docs/tracking-plan.md` for the event schema, variables, triggers, and validation sequence.

## Test attribution and identity capture

Open a URL similar to:

```text
https://your-project.pages.dev/
  ?utm_source=linkedin
  &utm_medium=paid_social
  &utm_campaign=measurestack_demo
  &utm_content=founder_ad
  &li_fat_id=test-click-id
  &person_id=person_test_001
  &analytics_user_id=user_test_001
```

After accepting measurement and submitting the form, inspect:

```js
window.dataLayer.filter((item) => item.event === 'generate_lead')
```

The result includes the event ID, lead ID, identity fields, GA cookie/client identifiers when available, UTMs, first/last-touch attribution, SHA-256 email, optional SHA-256 phone, and LinkedIn click ID.

## Before collecting real leads

Add a real privacy notice, market-appropriate consent controls, Cloudflare Turnstile, a CRM or durable lead store, webhook retries, retention controls, server-side identity validation, and restricted access to logs. MeasureStack and all dashboard figures are fictitious.
