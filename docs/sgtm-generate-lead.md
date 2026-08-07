# Measurement Stack: server-side `generate_lead` tracking

This implementation sends the authoritative form conversion from the Cloudflare Pages Function to the Stape Data Client endpoint. The browser still emits the same `generate_lead` event with the same `event_id`, which can be used for browser/server deduplication in Meta and LinkedIn.

## Architecture

```text
Browser form
  -> dataLayer: generate_lead + event_id
  -> /api/lead
      -> D1 identity + lead records
      -> Loops
      -> Stape Data Client (/data)
           -> GA4 server tag (optional; avoid double-sending if GA4 is already routed from web GTM)
           -> Meta Conversions API: Lead
           -> LinkedIn Conversions API: Lead
```

The backend event is marked with `event_source = backend` and `transport = cloudflare_to_stape`, so server-container triggers can be scoped to this authoritative conversion stream.

If both analytics and advertising measurement consent are denied, `/api/lead` stores and processes the lead but skips the sGTM network request. Advertising identifiers and user matching data are only added when the visitor has both accepted measurement cookies and explicitly enabled advertising measurement on the lead form.

## Cloudflare / Wrangler configuration

The non-secret Stape endpoint is committed in `wrangler.toml`:

```toml
SGTM_EVENT_ENDPOINT = "https://edge.measurementstack.com/data"
SGTM_PROTOCOL_VERSION = "2"
```

Optional debugging secret/variable:

- `SGTM_PREVIEW_HEADER`: value from Stape's sGTM Preview Header power-up. The Function sends it as `X-Gtm-Server-Preview`.

No Meta or LinkedIn access token is stored in this website repository. Keep destination credentials inside the server GTM container or its secret variables.

## Stape Data Client

In the server GTM container:

1. Templates -> Search Gallery -> install **Data Client by Stape**.
2. Clients -> New -> **Data Client**.
3. Accepted path: `/data`.
4. Protocol: v2/default.
5. Publish the server container.

The backend sends `POST /data?v=2&event_name=generate_lead` with the same event name and protocol version in the JSON body.

## Incoming event fields

Important fields available in server GTM Event Data:

### Event

- `event_name = generate_lead`
- `event_id`
- `event_time`
- `event_source = backend`
- `transport = cloudflare_to_stape`
- `lead_id`
- `lead_type = demo_request`
- `value`
- `currency`

### Identity

- `client_id` (GA client ID when available, otherwise first-party JS/browser ID)
- `user_id` (opaque Measurement Stack analytics user ID)
- `person_id`
- `analytics_user_id`
- `anonymous_user_id`
- `browser_id`
- `web_graph_id`
- `session_id`
- `session_number`

### Consent

- `analytics_storage`
- `ad_storage`
- `ad_user_data`
- `ad_personalization`
- `advertising_measurement_consent`
- `consent_snapshot_id`

### Attribution

UTM values can be included for analytics measurement. Advertising identifiers below are included only when advertising measurement consent is granted:

- `gclid`
- `dclid`
- `gbraid`
- `wbraid`
- `fbclid`
- `fbc`
- `fbp`
- `li_fat_id`
- `msclkid`

Always available attribution references:

- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_content`
- `utm_term`
- `first_touch_id`
- `last_touch_id`

### User matching

Only when advertising measurement consent is granted:

- `ip_override`
- `user_agent`
- `user_data.sha256_email_address`
- `user_data.sha256_phone_number` when phone exists
- `user_data.address.first_name`
- `user_data.address.last_name`
- `user_data.address.country`
- `sha256_external_id`

The browser localStorage graph does not store raw email, phone, IP, or payment data.

## Server GTM variables

Create Event Data variables for at least:

- `event_name`
- `event_id`
- `event_source`
- `advertising_measurement_consent`
- `analytics_storage`
- `client_id`
- `user_id`
- `person_id`
- `lead_id`
- `page_location`
- `ip_override`
- `user_agent`
- `user_data.sha256_email_address`
- `user_data.sha256_phone_number`
- `fbp`
- `fbc`
- `li_fat_id`
- `gclid`

## Triggers

Create two server Custom triggers.

### `CE - generate_lead - backend - ads`

```text
event_name equals generate_lead
AND
event_source equals backend
AND
advertising_measurement_consent equals true
```

Use this trigger for Meta CAPI and LinkedIn CAPI.

### `CE - generate_lead - backend - analytics`

```text
event_name equals generate_lead
AND
event_source equals backend
AND
analytics_storage equals granted
```

Use this trigger only if you intentionally choose backend-only GA4 for the lead conversion.

## Meta CAPI

Install **Facebook Conversions API by Stape** in the server container.

Recommended settings:

- Event Name Setup Method: Override
- Event Type: `Lead`
- Pixel ID: your Meta Pixel ID
- API Access Token: server-side secret/variable
- Event ID: `{{ED - event_id}}`
- Action source: website
- Event source URL: `{{ED - page_location}}`

User data mapping:

- Email -> `{{ED - user_data.sha256_email_address}}` (already SHA-256)
- Phone -> `{{ED - user_data.sha256_phone_number}}` (already SHA-256)
- Client IP -> `{{ED - ip_override}}`
- Client User Agent -> `{{ED - user_agent}}`
- FBP -> `{{ED - fbp}}`
- FBC -> `{{ED - fbc}}`
- External ID -> `{{ED - sha256_external_id}}`

Trigger: `CE - generate_lead - backend - ads`.

If a browser Meta Lead event is also fired, pass the exact same `event_id` to the browser pixel. Meta uses matching event names and event IDs for browser/server deduplication.

## LinkedIn Conversions API

Install **LinkedIn Conversions API by Stape** in the server container.

Create a LinkedIn server Conversion rule for this lead action, then configure:

- Event type: Conversion
- Access Token: LinkedIn server token
- Conversion Rule ID: your server conversion rule ID
- Event ID: `{{ED - event_id}}`
- Email: `{{ED - user_data.sha256_email_address}}`
- LinkedIn click ID: `{{ED - li_fat_id}}`
- External ID: `{{ED - sha256_external_id}}`
- Lead ID: `{{ED - lead_id}}`
- First/last name, company, title may also be mapped when your consent policy permits it.

Trigger: `CE - generate_lead - backend - ads`.

If a browser LinkedIn conversion is also fired, pass the same `event_id` on both browser and server sources for deduplication.

## GA4

`generate_lead` is a GA4 recommended event. If the web Google Tag is already configured with the Stape server-container URL, let that browser event flow through the GA4 Client and a server GA4 tag. Do **not** additionally send this backend Data Client event to GA4 unless you intentionally disable the browser copy; otherwise GA4 will receive two lead events.

If you choose backend-only GA4 for `generate_lead`, create a server GA4 tag on `CE - generate_lead - backend - analytics` and map only analytics-safe event fields. Do not pass the `user_data` object, email, phone, IP, or other PII to GA4.

## QA sequence

1. Open server GTM Preview.
2. If testing a server-to-server request, set `SGTM_PREVIEW_HEADER` in the Cloudflare Preview environment or use Stape's Preview Header power-up.
3. Accept measurement in the consent banner and enable advertising measurement on the lead form.
4. Submit the Measurement Stack demo form.
5. Confirm an incoming Data Client request at `/data` with `event_name = generate_lead`.
6. Confirm the incoming `event_id` matches the browser `dataLayer` `generate_lead.event_id`.
7. Confirm Meta CAPI and LinkedIn CAPI tags fire once.
8. Check Stape Logs for the incoming request and associated outgoing requests.
9. Check Meta Test Events / Events Manager and LinkedIn Campaign Manager diagnostics.
10. Repeat once with Essential only selected and confirm the sGTM delivery reports `skipped: consent_denied`.
11. After validation, publish the server GTM container and remove any temporary test codes.
