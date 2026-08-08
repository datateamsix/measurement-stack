# Measurement Stack canonical identity graph and dataLayer contract

## Purpose

Measurement Stack keeps authentication, identity resolution, attribution, consent, lifecycle state, and prediction as separate concerns. The canonical `person_id` is the center of the graph. Source-system IDs remain aliases and never replace the canonical person.

The GA4 `user_id` projection is the opaque `analytics_user_id`, not an email, Clerk ID, Google subject, GitHub ID, Stripe customer, CRM contact, or cookie value.

## Browser storage

The browser stores only pseudonymous identifiers, approved attribution context, consent state, and lifecycle references. It never stores names, raw email, raw phone, OAuth credentials, session tokens, or payment details.

| localStorage key | Purpose |
| --- | --- |
| `measurementstack.identity_graph.v1` | Canonical browser graph, person projection, auth aliases, billing references |
| `measurementstack.attribution.v1` | First touch, last touch, last non-direct touch, click IDs, recent touch references |
| `measurementstack.lifecycle.v1` | Visitor, lead, checkout, customer, and subscription transitions |
| `measurementstack.network.v1` | Latest privacy-reduced network observation only |
| `measurementstack.collection_policy.v1` | Active minimization and collection rules |
| `meridian_consent_v1` | Consent choice and immutable consent snapshot reference |

The `measurementstack.*` envelopes are the canonical identity and lifecycle namespaces. Meridian Consent owns the separate consent namespace.

## Google consent settings

The footer **Consent settings** link opens a persistent preference dialog. Its controls map one-to-one to Google Consent Mode rather than combining independent advertising signals into a single marketing category.

| Preference | Google consent type | Initial state |
| --- | --- | --- |
| Security storage | `security_storage` | Granted and always active |
| Functionality storage | `functionality_storage` | Denied |
| Personalization storage | `personalization_storage` | Denied |
| Analytics storage | `analytics_storage` | Denied |
| Advertising storage | `ad_storage` | Denied |
| Advertising user data | `ad_user_data` | Denied |
| Advertising personalization | `ad_personalization` | Denied |

The stored object retains the legacy `analytics` and `marketing` booleans for compatibility, but the seven Google consent types are authoritative. Every saved change sends `gtag('consent', 'update', ...)` and pushes a `consent_update` event with the same states into `dataLayer`.

## Collection policy

The parameter inventory is represented as a policy rather than indiscriminately copied into every event.

### IP and client identity

| Signal | Default | Browser exposure |
| --- | --- | --- |
| Raw IP | `anonymize_strict` | Never exposed by default |
| Anonymized IP | Remove last two IPv4 octets or reduce IPv6 prefix | Latest observation only |
| Smart anonymization | Country-scoped token, not a fabricated routable IP | Optional |
| Browser ID | First-party UUID | Allowed |
| JavaScript Client ID | Browser ID by default | Allowed |
| Network-derived JS Client ID | Monthly HMAC only when `IDENTITY_HASH_SECRET` is configured | Allowed as pseudonymous ID |
| GA client ID | Parsed from `_ga` | Allowed |
| `_ga` and `_ga_*` | Captured as analytics aliases | Allowed |
| `FPLC` and `FPID` | Captured when present | Allowed |
| Raw user-agent | Server request only | Never placed in the dataLayer |
| Parsed client hints | Platform, architecture, bitness, mobile, model | Allowed under minimization rules |

Supported server variables:

```toml
IP_ANONYMIZATION_MODE = "leave_as_is" | "anonymize" | "anonymize_strict" | "anonymize_smart" | "remove"
JS_CLIENT_ID_MODE = "leave_as_is" | "first_party_uuid" | "anonymize" | "anonymize_strict" | "remove"
```

For HMAC-derived client IDs, configure `IDENTITY_HASH_SECRET` as a Cloudflare secret. Without it, Measurement Stack falls back to the first-party browser UUID rather than hashing raw IP and user-agent without a secret.

### General information

| Signal | Treatment |
| --- | --- |
| User ID | Opaque `analytics_user_id` only |
| Firebase ID | Not collected on web |
| Session ID | First-party session UUID |
| Session count | Incremented per browser session |
| First visit | Stored in the identity envelope |
| Query parameters | Campaign allowlist only |
| Referrer | Origin and path, not arbitrary full query strings |
| Session engagement | Derived through lifecycle events rather than copied from Google request parameters |
| DoubleClick join IDs and tracking-code versions | Not retained in the canonical graph |

### System information

Screen resolution, viewport, color depth, and language are included only when analytics consent is granted. Java and Flash values remain empty because modern browsers do not expose meaningful versions. Raw user-agent is excluded from the dataLayer; parsed User-Agent Client Hints are used when available.

### Campaign attribution

The attribution envelope supports:

- `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `utm_id`
- `gclid`, `dclid`, `gbraid`, `wbraid`
- `fbclid`, `_fbc`, `_fbp`
- `li_fat_id`
- `msclkid`
- first touch, last touch, and last non-direct touch
- canonical `touch_id` values used in checkout and conversion metadata

## Structured dataLayer event

Every Measurement Stack business event uses this shape while retaining familiar top-level GA4 fields for GTM compatibility:

```js
{
  event: "purchase",
  event_id: "event_...",
  event_timestamp: "2026-08-05T17:00:00.000Z",
  schema: {
    name: "measurement_stack.event",
    version: "1.0.0"
  },
  measurement_stack: {
    event: {
      name: "purchase",
      id: "event_...",
      sequence: 7,
      occurred_at: "...",
      source: "web",
      surface: "marketing_web"
    },
    identity: {
      person_id: "person_...",
      analytics_user_id: "analytics_...",
      web_graph_id: "webgraph_...",
      browser_id: "browser_...",
      anonymous_id: "anon_...",
      javascript_client_id: "browser_...",
      network_derived_client_id: "jscid_...",
      ga_client_id: "123.456",
      auth_state: "anonymous",
      clerk_user_id: "",
      auth_providers: []
    },
    session: {
      session_id: "session_...",
      session_count: 2,
      first_visit_at: "...",
      page_location: "...",
      page_path: "...",
      page_referrer: "...",
      page_title: "..."
    },
    attribution: {},
    consent: {},
    network: {},
    system: {},
    lifecycle: {},
    billing: {},
    collection_policy: {}
  },
  user_id: "analytics_...",
  person_id: "person_...",
  client_id: "123.456",
  session_id: "session_..."
}
```

## Server identity graph

Migration `0002_canonical_identity_graph.sql` adds:

- `web_browser_identities`
- `external_auth_identities`
- `identity_edges`
- `network_observations`
- `lifecycle_events`
- `billing_aliases`

Authoritative edges are created for Clerk and validated OAuth provider subjects. Browser and network observations are supporting evidence and never independently merge two people.

Google, Apple, and GitHub provider identities use provider-specific durable subjects when Clerk supplies them. Provider email, display name, and username are attributes, not durable matching keys.

## Stripe test lifecycle

Stripe-hosted Checkout does not allow the website to inject a test card number. The pricing page displays copyable test-mode values instead:

- Card: `4242 4242 4242 4242`
- Expiry: any future date
- CVC: any three digits
- Postal code: any valid value

After a completed subscription, the graph links the checkout session, Stripe customer, subscription, person, browser graph, attribution touch IDs, consent snapshot, and shared event ID. When a resolved person already has a Stripe customer ID, the next Checkout Session passes that customer to Stripe so eligible saved test payment details can be prefilled.
