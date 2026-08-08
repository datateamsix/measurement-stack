# Measurement Stack product event plan

## Lifecycle events

| Event | Trigger | Primary identifier | Deduplication key |
|---|---|---|---|
| `measurement_initialized` | Shared runtime initializes | `anonymous_user_id` | None |
| `identity_resolved` | Signed-in user is mapped to a person | `person_id` | Session marker |
| `view_pricing` | Pricing page loads | `person_id` or anonymous ID | Page view |
| `select_plan` | Plan CTA is selected | `person_id` | None |
| `begin_checkout` | Stripe Session request begins | `person_id` | `event_id` |
| `purchase` | Successful Stripe Session is confirmed | `person_id` | `event_id` |
| `form_view` | Lead form becomes visible | anonymous or person ID | Page view |
| `form_start` | First form interaction | anonymous or person ID | Form instance |
| `form_submit_attempt` | Valid lead request starts | `person_id` | `event_id` |
| `generate_lead` | Cloudflare accepts the lead | `person_id` | `event_id` |

## Browser/server pairs

### Lead

```text
Browser: generate_lead
Server:  generate_lead
Key:     event_id
```

### Subscription purchase

```text
Browser: purchase on checkout-success.html
Server:  purchase from Stripe webhook
Key:     event_id stored in Stripe Checkout metadata
```

## Canonical identity hierarchy

```text
person_id
├── analytics_user_id
├── clerk_user_id
├── email
├── anonymous_user_id
├── ga_client_id
├── ga_cookie_id
└── stripe_customer_id
```

The browser-generated `person_id` is provisional. Once a signed-in request reaches the server, D1 binds it to the verified Clerk user and returns the canonical IDs to the browser.
