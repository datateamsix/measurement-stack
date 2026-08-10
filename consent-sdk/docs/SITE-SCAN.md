# Meridian Site Scan

Meridian Site Scan is a small, evidence-based browser audit for consent implementations. It samples the public pages that best represent a site, observes browser behavior under isolated consent states, and emits reviewable JSON, CSV, and Markdown files.

It is not an exhaustive crawler and does not issue a universal compliant/non-compliant verdict.

## Install the optional browser

The consent runtime and GTM migrator do not require a browser. Site Scan loads Playwright only when the command is used:

```bash
npm install
npx playwright install chromium
```

## Quick scan

```bash
meridian-consent site-scan https://example.com \
  --max-pages 10 \
  --output-dir ./meridian-site-scan
```

The quick scan uses four states:

| Profile | Purpose |
|---|---|
| `baseline` | Observe behavior before the visitor makes a choice |
| `reject` | Observe behavior after optional consent is rejected |
| `accept` | Build the complete observable technology inventory |
| `gpc` | Observe behavior with Global Privacy Control enabled before page scripts run |

Use `--full` to add `analytics` and `withdraw`. The latter accepts optional consent and then rejects it before rescanning so persistent cookies and storage keys can be reviewed.

Each profile receives a new non-persistent Chromium context. State is shared between the selected pages inside that profile, like a normal browsing session, and is discarded when the profile finishes.

## Page selection

The homepage is always the first candidate. Meridian then:

1. reads and honors `robots.txt`;
2. extracts links from primary/header navigation;
3. prioritizes explicitly included URLs and prominent header calls to action;
4. uses `sitemap.xml` only to fill gaps;
5. normalizes tracking parameters and duplicate trailing-slash variants;
6. stops at 10 unique same-origin pages.

Login, logout, account, admin, cart, search, pagination, downloads, and policy pages are excluded by default. An explicitly included policy page is allowed, but a `robots.txt` exclusion is never bypassed.

Review the plan without executing the consent profiles:

```bash
meridian-consent site-scan https://example.com --dry-run
```

Scan a single page:

```bash
meridian-consent site-scan https://example.com/checkout --single-page
```

Add important pages to the representative sample:

```bash
meridian-consent site-scan https://example.com \
  --include /checkout \
  --include /campaign/summer
```

Scan only an exact user-supplied set:

```bash
meridian-consent site-scan \
  --url https://example.com \
  --url https://example.com/pricing \
  --url https://example.com/signup \
  --exact-pages
```

Only scan websites you own or are authorized to assess.

## Consent controls

Meridian-native sites are controlled through `window.MeridianConsent`, which is more reliable than guessing at banner text or markup.

For another CMP, provide stable reject and accept selectors:

```bash
meridian-consent site-scan https://example.com \
  --reject-selector '[data-consent="reject"]' \
  --accept-selector '[data-consent="accept"]'
```

If a requested state cannot be established, the scan continues and records `unable_to_test`. It does not pretend the state succeeded. Non-Meridian analytics-only scans require a compatible adapter and will be marked unable to test when one is unavailable.

## Evidence collected

| Surface | Stored evidence |
|---|---|
| Cookies | Name, domain, path, lifetime, flags, partition key, first/third party |
| Local and session storage | Origin and key name |
| IndexedDB | Origin, database name, and object-store names |
| Cache Storage | Origin and cache name |
| Network | Destination, path, method, resource type, query/body field names |
| Frames and workers | Third-party frame origins and service-worker script URLs |
| Consent | Meridian state and recent Google consent commands when observable |

Meridian does **not** save cookie values, local/session-storage values, or observed request query/body values. Field names can still reveal implementation details, so scan packages should be handled as internal technical evidence. Selected page URLs are part of the scan scope and are retained; do not submit signed, tokenized, or otherwise sensitive URLs.

Browser storage shows what was stored; it does not prove every value a vendor collected. Network field names supplement the storage inventory without retaining transmitted values.

CNAME-cloaked collectors and server-proxied measurement can appear first-party in browser evidence. DNS and server-side review remain necessary when those patterns are used.

## Output package

| File | Purpose |
|---|---|
| `scan-plan.json` | Selected and excluded page scope plus discovery sources |
| `scan-evidence.json` | Complete normalized machine-readable evidence contract |
| `scan-findings.json` | Potential issues, manual-review items, and unable-to-test results |
| `site-scan-report.md` | Human-readable scope, summary, findings, and limitations |
| `technology-inventory.csv` | Provider-level technology rollup |
| `cookie-inventory.csv` | Cookie attributes and observed consent states |
| `storage-inventory.csv` | Local/session storage, IndexedDB, and Cache Storage names |
| `network-destinations.csv` | Destination hosts, paths, field names, and consent states |
| `consent-state-comparison.csv` | Technology behavior across scan profiles |
| `disclosure-inventory.csv` | Review starting point for cookie/privacy disclosures |

The evidence contract is designed to feed the GTM reconciliation layer next. `not_observed` means only that a technology was not seen in the sampled pages and states; it never means proven absent.

## Findings vocabulary

Meridian reports bounded evidence:

- `potential_issue`: observed behavior conflicts with the selected technical expectation;
- `manual_review`: the observation may be legitimate but needs technical or policy review;
- `unable_to_test`: a page or consent action could not be exercised;
- `not_observed`: absent from this sample only.

Examples include a known non-essential provider before choice, a known non-essential provider after rejection, advertising behavior with GPC enabled, and storage that remains after withdrawal.

## Useful controls

```text
--max-pages 1..10
--profiles baseline,reject,accept,gpc
--full
--single-page
--include <url-or-path>
--url <absolute-url>
--exact-pages
--accept-selector <css>
--reject-selector <css>
--wait-ms <milliseconds>
--timeout-ms <milliseconds>
--headed
--dry-run
--output-dir <directory>
```
