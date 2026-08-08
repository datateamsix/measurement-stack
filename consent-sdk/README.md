# Meridian Consent

A small, dependency-free consent runtime and an auditable Google Tag Manager governance toolkit. Meridian is the measurement operating system; Meridian Consent is its focused consent product.

The design goal is deliberately narrow: establish consent before measurement, collect an understandable choice, persist it without identity data, and make the state easy to consume everywhere else.

## What it does

- Maps the interface one-to-one to all seven Google consent types.
- Denies optional consent by default; `security_storage` is always granted.
- Persists a versioned first-party `meridian_consent` cookie for 180 days by default.
- updates Google Consent Mode directly or through the included native GTM template.
- emits stable `dataLayer` events for conditional GTM triggers.
- provides an accessible banner and settings dialog with keyboard focus management.
- includes an importable GTM starter container with variables, triggers, and paused examples.
- ships without runtime dependencies, network calls, trackers, or personal identifiers.
- scans GTM container exports and classifies tags using a versioned provider registry;
- creates an explicit approval manifest before applying any consent configuration;
- preserves existing GTM triggers and never publishes a container.

This is a consent mechanism, not legal advice or an IAB TCF-certified publisher CMP.

## Container scanner and CLI

The browser runtime stays tiny. Provider detection and GTM modification run offline in Node.js and are never shipped to website visitors.

```bash
meridian-consent scan GTM-XXXX_workspace.json --output scan.json
meridian-consent plan scan.json --output approvals.json
meridian-consent review approvals.json --output approvals.reviewed.json
meridian-consent apply GTM-XXXX_workspace.json \
  --plan approvals.reviewed.json \
  --output GTM-XXXX_meridian.json
```

The workflow is deliberately gated:

1. `scan` identifies a provider, purpose set, Google consent requirement set, confidence, and exact evidence for each tag.
2. `plan` creates an immutable review manifest in which every tag is `pending`.
3. `review` requires an approve, skip, or explicit consent-set override for every tag.
4. `apply` verifies the original container and each approved tag fingerprint, changes only approved additional consent checks, and writes a new export.

An unknown tag is never interpreted as consent-free. Custom HTML that cannot be identified remains unresolved until a person classifies or skips it.

### Built-in versus additional checks

The report separates the consent signals a tag uses from the way GTM should enforce them:

| Enforcement | Example | Apply behavior |
|---|---|---|
| `built_in` | GA4, Google Ads, Floodlight | Record and verify; do not add a redundant check that suppresses consent-mode pings |
| `additional` | Meta, LinkedIn, Hotjar | Set GTM `consentSettings` to require the approved consent set |
| `essential` | Consent-management bootstrap | Leave unblocked |
| `unresolved` | Unknown Custom HTML | Require manual review |

The patch uses [GTM's documented `consentSettings` resource shape](https://developers.google.com/tag-platform/tag-manager/api/reference/rest/v2/accounts.containers.workspaces.tags): `consentStatus: NEEDED` and a `LIST` of `STRING` consent types. Existing firing, blocking, setup, and teardown triggers are not modified.

### Provider registry

[`classifier/providers.v1.json`](classifier/providers.v1.json) is data rather than code and has a companion [JSON Schema](classifier/provider-registry.schema.json). The initial registry covers common analytics, advertising, session-replay, marketing-automation, chat, experimentation, and CMP products. Each product entry contains:

- a stable provider/product ID;
- purpose labels;
- a Google consent requirement set;
- `built_in`, `additional`, or `essential` enforcement;
- deterministic matching signals for GTM tag types, hostnames, code signatures, and names.

Strong technical evidence is weighted above naming conventions. A known native tag type scores 100, hostname 90, code signature 85, and name 35. Corroborating signals add limited confidence; conflicts and weak name-only matches remain reviewable. A custom registry can be supplied with `scan --registry providers.json`, which is the future extension point for organization-specific and UI-created providers.

## Fastest installation

Build the package and host the two files from `dist/` on your own domain. Place these lines **before the GTM container snippet**:

```html
<link rel="stylesheet" href="/consent/meridian-consent.min.css">
<script>
  window.MeridianConsentConfig = {
    policyVersion: '1.0',
    privacyUrl: '/privacy',
    cookieUrl: '/cookies'
  };
</script>
<script src="/consent/meridian-consent.min.js"></script>

<!-- Google Tag Manager immediately follows -->
```

Do not add `async` or `defer` to the SDK script when using direct Google consent. Its small blocking load is intentional: default consent must be established before GTM begins processing measurement.

Add a persistent footer control anywhere in the page:

```html
<button type="button" data-meridian-consent-settings>
  Consent settings
</button>
```

The SDK discovers every matching control present when the UI mounts. You can also open it programmatically:

```js
MeridianConsent.open();
```

## Consent map

| Interface choice | Google consent type | Default |
|---|---|---|
| Security storage | `security_storage` | Granted; required |
| Functionality storage | `functionality_storage` | Denied |
| Personalization storage | `personalization_storage` | Denied |
| Analytics storage | `analytics_storage` | Denied |
| Advertising storage | `ad_storage` | Denied |
| Advertising user data | `ad_user_data` | Denied |
| Advertising personalization | `ad_personalization` | Denied |

## GTM events

The SDK emits exactly two lifecycle events:

| Event | When it fires |
|---|---|
| `meridian_consent_ready` | Once per page, after the stored choice or denied defaults are resolved |
| `meridian_consent_updated` | After a visitor or API action saves, rejects, accepts, withdraws, or resets consent |

Both use the same versioned envelope:

```js
{
  event: 'meridian_consent_updated',
  meridian_consent: {
    schema_version: '1.0',
    sdk_version: '0.1.1',
    policy_version: '1.0',
    consent_id: 'c59e7b09-...',
    revision_id: 'ad722e36-...',
    occurred_at: '2026-08-07T16:30:00.000Z',
    source: 'save_settings',
    has_choice: true,
    security_storage: 'granted',
    functionality_storage: 'denied',
    personalization_storage: 'denied',
    analytics_storage: 'granted',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied'
  }
}
```

The object contains no email, IP address, GA client ID, user ID, or advertising identifier.

### Conditional trigger pattern

To fire a non-Google analytics vendor immediately after consent is granted:

1. Create a Data Layer Variable named `DLV - Meridian Consent - Analytics Storage` with `meridian_consent.analytics_storage` and Version 2.
2. Create a Custom Event trigger matching `^meridian_consent_(ready|updated)$` with regex matching enabled.
3. Add the condition `DLV - Meridian Consent - Analytics Storage equals granted`.
4. Add `analytics_storage` as the tag's additional consent requirement.

The included GTM starter container creates this pattern for analytics and advertising tags automatically. See [`gtm/README.md`](gtm/README.md).

## GTM-native installation

For the most native GTM integration, import the included custom template and let it call `setDefaultConsentState` and `updateConsentState`:

```html
<script>
  window.MeridianConsentConfig = {
    policyVersion: '1.0',
    googleConsent: false
  };
</script>
```

Then follow [`gtm/README.md`](gtm/README.md). Choose **either** direct Google consent or the GTM-native bridge; do not run both.

## Configuration

Set `window.MeridianConsentConfig` before loading the SDK or pass the same shape to `init()` if auto-initialization has been disabled in a future build.

| Option | Default | Purpose |
|---|---:|---|
| `policyVersion` | `1.0` | Invalidates an older saved choice and requests consent again |
| `cookieName` | `meridian_consent` | First-party preference cookie name |
| `legacyStorageKey` | `meridian_consent_v1` | One-time migration source for the previous site consent choice; set empty to disable |
| `cookieDays` | `180` | Preference lifetime |
| `waitForUpdate` | `500` | Google Consent Mode wait in milliseconds |
| `googleConsent` | `true` | Directly issue Google consent commands |
| `autoShow` | `true` | Show the banner when no valid choice exists |
| `showGoogleKeys` | `true` | Show exact consent keys in the settings UI |
| `privacyUrl` | empty | Privacy-policy link |
| `cookieUrl` | empty | Cookie-policy link |
| `copy` | built in | Override interface strings |
| `categories` | built in | Override category title/description pairs |
| `theme` | built in | Override `accent`, `accent2`, `ink`, `muted`, `line`, `paper`, `soft`, or `night` CSS variables |

Example brand configuration:

```html
<script>
  window.MeridianConsentConfig = {
    policyVersion: '2026-08-07',
    privacyUrl: '/privacy',
    cookieDays: 180,
    showGoogleKeys: false,
    theme: {
      accent: '#6d28d9',
      accent2: '#2563eb'
    },
    copy: {
      title: 'Privacy choices',
      bannerText: 'We use optional cookies to understand performance and improve advertising.'
    }
  };
</script>
```

## Public API

```js
MeridianConsent.getState();
MeridianConsent.has('analytics_storage');
MeridianConsent.acceptAll();
MeridianConsent.rejectOptional();
MeridianConsent.save({
  analytics_storage: 'granted',
  functionality_storage: 'granted',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied'
});
MeridianConsent.open();
MeridianConsent.close();
MeridianConsent.reset();

const unsubscribe = MeridianConsent.subscribe((consent) => {
  console.log(consent.analytics_storage);
});
```

Missing or unrecognized values normalize to `denied`. Attempts to deny `security_storage` normalize to `granted`.

## Build and test

```bash
cd consent-sdk
npm install
npm run build
npm test
npm run check:size
```

The compressed JavaScript and CSS have a combined 12 KB gzip budget. The budget is enforced by the build checks rather than treated as an aspiration.

## Release discipline

- Treat `schema_version` as a public data contract; only change it for breaking payload changes.
- Increment `policyVersion` when the disclosure or purposes materially change and renewed consent is required.
- Keep SDK versions immutable on the CDN (`/consent/0.1.1/...`) and use a separately controlled alias only if rollback is immediate.
- Test accept, reject, granular save, stored restore, withdrawal, keyboard navigation, and every vendor request in GTM Preview before publishing.
- Review GTM Consent Overview so each non-Google tag declares its additional consent checks.

## Deliberate non-goals for 0.1

- live GTM API access, workspace creation, versioning, or publishing;
- runtime cookie crawling outside the imported container definition;
- jurisdiction-specific legal decisions;
- cross-domain preference synchronization;
- server-side consent receipt delivery;
- IAB TCF strings or Google publisher CMP certification;
- silently blocking arbitrary scripts after the browser has already executed them.

Those capabilities can be added behind clean interfaces without enlarging or weakening the core consent path.
