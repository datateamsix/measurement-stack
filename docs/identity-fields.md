# Identity and attribution field dictionary

## Hidden form fields

| Field | Sandbox source | Purpose | Production guidance |
|---|---|---|---|
| `person_id` | Query parameter, existing `localStorage` value, or generated `person_<uuid>` | Stable first-party identity key for sandbox stitching | Replace with an approved CRM/CDP person key after identity resolution |
| `analytics_user_id` | Query parameter, existing `localStorage` value, or generated `analytics_<uuid>` | Stable analytics identity used in the event payload as `user_id` | Use an authenticated or backend-issued non-PII account/user ID where appropriate |
| `ga_cookie_id` | Raw value of the first-party `_ga` cookie | Preserves the browser GA cookie for troubleshooting and matching | Respect consent and retention requirements; never assume it is always present |
| `utm_source` | Last campaign touch | Campaign source | Standardize allowed values in a campaign taxonomy |
| `utm_medium` | Last campaign touch | Campaign medium | Standardize values such as `paid_social`, `cpc`, and `email` |
| `utm_content` | Last campaign touch | Creative or content variant | Use a durable creative naming convention |
| `utm_campaign` | Last campaign touch | Campaign identifier/name | Prefer a governed campaign ID or naming convention |
| `event_id` | Generated UUID for each submission attempt | Correlates the browser request, accepted lead, and ad-platform events | Use the same value in browser and CAPI conversion paths for deduplication |
| `conversion_happened_at` | Browser timestamp in milliseconds | Records when the conversion action occurred | Preserve as an integer and map to the server/ad-platform timestamp format |

## Additional event identifiers

| Field | Source | Notes |
|---|---|---|
| `lead_id` | Cloudflare Pages Function | Created only after the form is accepted; included in `generate_lead` |
| `anonymous_user_id` | `localStorage` | Separate pseudonymous browser identifier used for sandbox analysis |
| `client_id` | Parsed from `_ga` | The trailing two numeric components of the GA cookie when present |
| `session_id` | `sessionStorage` | Simple sandbox session timestamp; replace with GA4/session logic as needed |
| `li_fat_id` | URL query parameter and attribution storage | LinkedIn first-party click identifier used for CAPI matching when available |

## Trust boundary

All hidden fields can be edited by a visitor. The Cloudflare Function sanitizes lengths, but a production system should validate identity values against trusted backend or CDP records before treating them as authoritative.
