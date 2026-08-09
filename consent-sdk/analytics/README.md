# Meridian Consent Impact Analytics

Consent Impact Analytics measures **measurement opportunities**, not hidden people. It records aggregate counters for consent-ready states, page loads, consent updates, and an explicit allowlist of business events. It never attempts to reconstruct consent-denied users or sessions.

## Minimal architecture

```text
Optional browser module -> HTTPS collector -> hourly aggregate storage -> CLI
```

- The core consent runtime remains network-free.
- The analytics payload contains no user, browser, client, session, IP, URL, referrer, or click identifiers.
- The collector derives country at the edge, discards the IP, and immediately increments an aggregate row.
- D1 is the default storage adapter. Set a `CONSENT_ANALYTICS_DB` binding to isolate these counters in a dedicated database, or allow the existing `DB` binding as an MVP fallback.
- A customer can designate storage by setting `endpoint` to a compatible collector they operate. Do not expose database credentials to the browser.

## Browser setup

Load the optional module after the core runtime:

```html
<script src="/consent/meridian-consent.min.js"></script>
<script>
  window.MeridianConsentAnalyticsConfig = {
    siteId: 'measurementstack',
    endpoint: '/api/consent-impact',
    trackedEvents: ['generate_lead', 'begin_checkout']
  };
</script>
<script src="/consent/meridian-consent-analytics.min.js"></script>
```

The module automatically records `consent_ready` and `page_view`, subscribes to consent changes as `consent_updated`, and observes only the configured `dataLayer` event names. Events can also be recorded explicitly:

```js
MeridianConsentAnalytics.track('generate_lead');
```

Do not include dynamic values in event names. The payload has a strict, fixed field set and the server re-derives all classifications from the four consent states.

## Collection contract

```json
{
  "schema_version": "1.0",
  "sdk_version": "0.1.0",
  "site_id": "measurementstack",
  "event_name": "page_view",
  "occurred_at": "2026-08-08T23:00:00.000Z",
  "analytics_storage": "denied",
  "ad_storage": "denied",
  "ad_user_data": "denied",
  "ad_personalization": "denied"
}
```

The D1 collector ignores client-provided location and time-bucketing fields. It uses receipt time for the hourly bucket and Cloudflare request metadata for a two-letter country code. Countries in the EU/EEA plus the United Kingdom are grouped as `EEA_UK`; this is an analytical segment, not a legal determination.

## Classification criteria

| Condition | Analytics outcome | Advertising outcome |
|---|---|---|
| `analytics_storage=granted` | `observed` | Evaluated separately |
| `analytics_storage=denied` | `modeled_signal` | Evaluated separately |
| All three advertising signals granted | Evaluated separately | `eligible` |
| Any advertising signal denied | Evaluated separately | `blocked` |

`modeled_signal` means the measurement opportunity occurred under denied Analytics storage. It does not prove that a particular vendor received, retained, reported, or modeled the event. Likewise, `blocked` is the policy classification for advertising eligibility; vendor execution verification is a separate QA capability.

## What can and cannot be claimed

Direct counters:

- page loads and allowlisted events by consent profile;
- consent-denied event opportunities;
- advertising-eligible and advertising-blocked opportunities;
- country/region distribution based on edge request metadata.

Estimates requiring a future model:

- affected sessions or users;
- conversions unavailable for deterministic attribution;
- audience loss and revenue impact;
- traffic forecasts by geography or channel.

Never calculate users by counting transient GA client IDs, and never introduce a Meridian identifier to make denied traffic joinable. Forecasts should begin with an explainable segmented model:

```text
forecast denied opportunities = forecast traffic * historical denial rate
forecast affected events = forecast denied opportunities * historical events per opportunity
```

Report forecasts with a confidence interval and preserve the observed-versus-estimated distinction.

### Forecasting model criteria

Keep the first model explainable and segment-based:

1. Use at least 28 complete days when available and preserve weekday seasonality.
2. Start with country, regulatory region, device class, channel group, and landing-page category. Do not use age, gender, ethnicity, inferred income, or fingerprinting attributes.
3. Require a minimum sample per segment; otherwise back off from country to region and then to the site-wide rate.
4. Produce a low, expected, and high estimate. A beta-binomial interval is appropriate for consent rates; traffic forecasts can use rolling historical error bands.
5. Backtest on rolling holdout windows and publish both forecast error and interval coverage.
6. Retrain after a material CMP design, policy, traffic-mix, or implementation change rather than blending incompatible periods silently.

The model output should retain these labels:

```text
observed opportunity count
forecast traffic
estimated denied opportunities
estimated affected events
confidence interval
model version and training window
```

For GA4 behavioral-modeling readiness, Google currently describes two volume conditions: at least 1,000 daily events with `analytics_storage=denied` for seven days, and at least 1,000 daily users with `analytics_storage=granted` for at least seven of the previous 28 days. Meridian's aggregate counters can evaluate the first condition; the second requires a consented GA4 reporting integration because Meridian deliberately does not identify users. Treat these as readiness indicators rather than a guarantee of eligibility. See [Google's behavioral modeling documentation](https://support.google.com/analytics/answer/11161109).

## D1 setup

Apply `migrations/0003_consent_impact.sql`, then configure:

```text
CONSENT_ANALYTICS_SITE_IDS=measurementstack
CONSENT_ANALYTICS_ALLOWED_ORIGINS=https://measurementstack.com
```

Store the read token as a Worker/Pages secret named:

```text
CONSENT_ANALYTICS_READ_TOKEN
```

For production isolation, bind a dedicated D1 database as `CONSENT_ANALYTICS_DB`. During the MVP, the collector falls back to the existing `DB` binding.

## CLI access

```bash
export MERIDIAN_CONSENT_READ_TOKEN='...'

meridian-consent analytics \
  --endpoint https://measurementstack.com/api/consent-impact \
  --site measurementstack \
  --from 2026-08-01 \
  --to 2026-08-09 \
  --group-by day
```

Supported groupings are `day`, `country`, `region`, `event`, and `consent`. The API limits a query to 93 days.

For a time-series export that can be joined to GA4, advertising, or warehouse tables, use the daily CSV format:

```bash
meridian-consent analytics \
  --endpoint https://measurementstack.com/api/consent-impact \
  --site measurementstack \
  --from 2026-08-01 \
  --to 2026-08-09 \
  --group-by day \
  --format csv \
  --output consent-impact-daily.csv
```

The CSV uses a stable schema with `site_id`, ISO period boundaries, grouping metadata, the bucket dimension, counts, and decimal rates. For `group_by=day`, `dimension` is an ISO `YYYY-MM-DD` date suitable for direct joins to daily analytics extracts. JSON remains available with `--format json`.

## BYO storage

The browser configuration may point to any HTTPS service that accepts the collection contract. A compatible implementation should:

1. allow only registered origins and site IDs;
2. validate the fixed schema and event-name format;
3. derive coarse geography server-side and avoid persisting IP addresses;
4. aggregate on ingestion rather than storing event-level records;
5. protect reads with server-side authentication;
6. apply retention and deletion policies appropriate to the deployment.

This endpoint contract is the initial storage portability boundary. Database-specific adapters can be added behind it later without changing the browser SDK.

### sGTM and warehouse routing

The configured `endpoint` can be a server-side Google Tag Manager URL. Use a dedicated path and compatible custom sGTM Client to claim the Meridian JSON request, validate its fixed schema, and pass the sanitized fields to server-side tags. Those tags can forward aggregates to BigQuery, a Databricks ingestion service, or another approved destination.

Do not point the SDK at an arbitrary existing sGTM collection path and assume it will parse Meridian events. The sGTM Client is the protocol adapter. Preserve the same privacy contract: derive geography server-side, do not add identifiers, and aggregate before long-term storage. For the lightest managed setup, keep the provided D1 collector and export daily CSV/JSON into the warehouse; use direct sGTM routing when a customer already operates that infrastructure.
