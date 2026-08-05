# Identity and attribution fields

| Field | Sandbox source | Purpose |
|---|---|---|
| `person_id` | URL parameter or persistent first-party UUID | Sandbox person-resolution key |
| `analytics_user_id` | URL parameter or persistent first-party UUID | Analytics user identifier |
| `ga_cookie_id` | First-party `_ga` cookie | GA browser identity troubleshooting |
| `utm_source` | Last campaign touch | Campaign source |
| `utm_medium` | Last campaign touch | Campaign medium |
| `utm_content` | Last campaign touch | Creative/content variant |
| `utm_campaign` | Last campaign touch | Campaign name or ID |
| `event_id` | UUID per form submission | Browser/server conversion deduplication |
| `conversion_happened_at` | Browser timestamp | Conversion occurrence time |
| `lead_id` | Cloudflare Pages Function | Accepted lead identifier |

Hidden inputs can be modified by visitors. In production, validate identity values against trusted backend, CRM, or CDP records before treating them as authoritative.
