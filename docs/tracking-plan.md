# MeasureStack tracking plan

## Primary conversion

Use `generate_lead` as the primary conversion. It fires only after `POST /api/lead` returns an accepted lead.

Do not count `form_submit_attempt` as a conversion; it represents a valid browser attempt that may still fail at the API or webhook stage.

## Browser events

| Event | Trigger |
|---|---|
| `measurement_initialized` | Application initialization |
| `form_submit_attempt` | Valid form request sent to Cloudflare |
| `form_submit_error` | API or webhook request failed |
| `generate_lead` | Cloudflare Function accepted the lead |

## Recommended GTM variables

Create Data Layer Variables for:

```text
event_id
lead_id
conversion_happened_at
form_id
lead_type
person_id
analytics_user_id
user_id
ga_cookie_id
utm_source
utm_medium
utm_content
utm_campaign
consent.ad_user_data
consent.ad_personalization
```

## Suggested flow

```text
Browser dataLayer: generate_lead
  ├─ GTM web → LinkedIn browser conversion
  └─ GA4/Google tag → first-party sGTM endpoint
       ├─ GA4 server tag → GA4
       └─ LinkedIn CAPI tag → LinkedIn
```

Use the same `event_id` for the LinkedIn browser event and LinkedIn CAPI event to support deduplication. Store LinkedIn access tokens and GA4 Measurement Protocol secrets only in the server container, never in page code or web GTM.

## QA sequence

1. Open the landing page with UTMs and optional `person_id` and `analytics_user_id` parameters.
2. Submit a valid lead.
3. Confirm `POST /api/lead` returns HTTP `201`.
4. Confirm one `generate_lead` dataLayer event fires.
5. Verify the browser request and accepted event share the same `event_id`.
6. Confirm the accepted event contains a server-generated `lead_id`.
7. Verify the web and server LinkedIn events use the same conversion rule and event ID.
