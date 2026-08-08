# Measurement Stack tracking plan

## Primary conversion

| Event | Trigger | Purpose |
|---|---|---|
| `generate_lead` | Cloudflare Function accepts the demo form | GA4 key event, LinkedIn browser conversion, and LinkedIn CAPI conversion |

Do not configure `form_submit_attempt` as the primary conversion. It represents an attempted request and can include validation, network, or webhook failures.

## Supporting events

| Event | Trigger | Useful parameters |
|---|---|---|
| `measurement_initialized` | Application boot | `measurement_environment`, `gtm_container_id`, `gtm_configured` |
| `consent_update` | Visitor makes a consent choice | `analytics_consent`, `marketing_consent` |
| `cta_click` | Visitor selects a demo CTA | `cta_text`, `cta_location` |
| `form_view` | At least 35% of the form enters the viewport | `form_id`, `form_name` |
| `form_start` | First visible-field interaction | `form_id`, `form_name` |
| `form_validation_error` | Client validation fails | `event_id`, `error_fields` |
| `form_submit_attempt` | Valid form is sent to `/api/lead` | `event_id`, `person_id`, `analytics_user_id` |
| `form_submit_error` | API or webhook submission fails | `event_id`, `error_message` |

## `generate_lead` example

```js
{
  event: 'generate_lead',
  event_id: 'f5ea2b57-...',
  lead_id: 'f763e698-...',
  conversion_happened_at: 1785904180000,
  conversion_rule_id: '12345678',
  form_id: 'demo_request',
  form_name: 'Measurement Stack demo request',
  lead_type: 'demo_request',
  company_size: '251-1000',
  use_case: 'attribution',
  person_id: 'person_...',
  analytics_user_id: 'analytics_...',
  user_id: 'analytics_...',
  anonymous_user_id: 'anon_...',
  ga_cookie_id: 'GA1.1.123456789.1785904000',
  client_id: '123456789.1785904000',
  session_id: '1785904000',
  utm_source: 'linkedin',
  utm_medium: 'paid_social',
  utm_content: 'founder_ad',
  utm_campaign: 'measurementstack_demo',
  user_data: {
    sha256_email_address: '<sha256 hex>',
    sha256_phone_number: '<sha256 hex>',
    linkedinFirstPartyId: '<li_fat_id>',
    companyName: 'Example Company',
    title: 'Director of Analytics',
    address: {
      first_name: 'michael',
      last_name: 'example',
      country: 'US'
    }
  },
  consent: {
    ad_user_data: 'granted',
    ad_personalization: 'granted'
  },
  attribution: {
    first_touch: { utm_source: 'linkedin', ... },
    last_touch: { utm_source: 'linkedin', ... }
  }
}
```

The email and optional phone are normalized and SHA-256 hashed before being pushed into `dataLayer`. Raw email and phone are sent only to the same-origin `/api/lead` function.

## GTM web variables

Create Version 2 Data Layer Variables for:

```text
event_id
lead_id
conversion_happened_at
conversion_rule_id
form_id
company_size
use_case
person_id
analytics_user_id
user_id
anonymous_user_id
ga_cookie_id
client_id
session_id
utm_source
utm_medium
utm_content
utm_campaign
user_data.sha256_email_address
user_data.sha256_phone_number
user_data.linkedinFirstPartyId
user_data.companyName
user_data.title
user_data.address.first_name
user_data.address.last_name
user_data.address.country
consent.ad_user_data
consent.ad_personalization
```

## Suggested GTM web tags

### 1. Google Tag

- Use the GA4 tag ID.
- Set `server_container_url` to the first-party sGTM URL.
- Map `analytics_user_id` to GA4 `user_id` only when your implementation has a valid policy-compliant user identifier.
- Require `analytics_storage` where appropriate.

### 2. GA4 Event — `generate_lead`

- Trigger: Custom Event `generate_lead`.
- Event name: `generate_lead`.
- Pass `event_id`, `lead_id`, identity keys, campaign fields, and other reporting parameters.
- Include user-provided advertising data only when `ad_user_data` is granted.

### 3. LinkedIn Insight Tag base

- Configure the LinkedIn partner ID.
- Require `ad_storage`.

### 4. LinkedIn browser conversion

- Trigger: Custom Event `generate_lead`.
- Use the same LinkedIn conversion rule as the CAPI tag.
- Pass `event_id` when the selected tag/template supports deduplication.
- Do not fire on `form_submit_attempt`.

## Suggested sGTM tags

1. Confirm the GA4 Client claims the incoming GA4 request.
2. Add a server-side GA4 tag so accepted events continue to GA4.
3. Install the official LinkedIn CAPI server template available to your container.
4. Trigger the LinkedIn CAPI tag only when Event Name equals `generate_lead` and advertising-user-data consent is granted.
5. Store the LinkedIn access token as a server-container secret or protected variable, never in web GTM or page code.
6. Configure the LinkedIn conversion rule ID.
7. Map the event timestamp, `event_id`, hashed email, optional hashed phone, `li_fat_id`, and available company/name fields.
8. Use web and server Preview modes to verify the same `event_id` reaches the browser conversion and CAPI requests.

## Attribution behavior

First-touch and last-touch objects are stored locally for:

```text
utm_source
utm_medium
utm_campaign
utm_term
utm_content
utm_id
gclid
gbraid
wbraid
fbclid
msclkid
li_fat_id
```

The hidden UTM fields use the stored last campaign touch. A visit without new campaign parameters does not overwrite the previous campaign touch.

## Recommended submission QA

1. Open the test URL with UTMs, `li_fat_id`, `person_id`, and `analytics_user_id`.
2. Accept measurement in the consent banner.
3. In GTM Preview, confirm `form_submit_attempt` fires before the network request.
4. Confirm `POST /api/lead` returns HTTP `201`.
5. Confirm one `generate_lead` event fires after the response.
6. Verify `lead_id` is populated and the accepted `event_id` matches the request.
7. Confirm the GA4 request is routed to the sGTM domain.
8. Confirm the LinkedIn browser and CAPI requests use the same conversion rule and `event_id`.
9. Repeat with advertising consent denied and verify user-data/ad tags do not fire.
