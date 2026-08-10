# Meridian Consent CLI

The CLI keeps container migration offline, explicit, and reviewable. It never calls the GTM API, overwrites the uploaded export, creates a workspace, or publishes a version.

## Start menu

Run without arguments in an interactive terminal:

```bash
meridian-consent
```

The menu provides the focused Site Scan, migrate, container scan, consent-impact analytics, and policy-profile entry points. For automation, call commands directly.

## Site Scan

```bash
meridian-consent site-scan https://example.com \
  --max-pages 10 \
  --output-dir ./meridian-site-scan
```

Site Scan is an optional Playwright-powered browser audit. It does not affect the consent runtime or require Chromium for GTM-only workflows. Install Chromium once with `npx playwright install chromium`.

Use `--dry-run` to inspect the selected homepage/navigation/sitemap sample, `--single-page` for a specific URL, and `--full` to add analytics-only and withdrawal states to the default baseline/reject/accept/GPC comparison. See [`SITE-SCAN.md`](SITE-SCAN.md) for the complete evidence and output contract.

## Recommended migration

```bash
meridian-consent migrate GTM-XXXX.json \
  --profile strict-global \
  --output-dir ./meridian-output
```

In an interactive terminal, Meridian walks through each pending tag decision. In CI or another non-interactive environment, it writes a review package and stops before producing a transformed container.

Use deterministic high-confidence recommendations as a starting point:

```bash
meridian-consent migrate GTM-XXXX.json \
  --approve-recommended \
  --output-dir ./meridian-output
```

This does not approve weak, conflicting, or unknown classifications. Edit or interactively review `review-manifest.json`, then rerun:

```bash
meridian-consent migrate GTM-XXXX.json \
  --plan ./meridian-output/review-manifest.json \
  --output-dir ./meridian-output-reviewed
```

## Output contract

| File | Purpose |
|---|---|
| `scan.json` | Provider, purpose, evidence, confidence, consent, and dependency inventory |
| `review-manifest.json` | Fingerprinted approve/skip/edit decisions |
| `impact-manifest.json` | Tag-trigger measurement opportunities and denied-consent outcomes |
| `policy-manifest.json` | Selected implementation profile and legal-review flag |
| `tag-inventory.csv` | Warehouse- and spreadsheet-ready disclosure inventory |
| `migration-report.md` | Human-readable status, guarantees, and next action |
| `container-diff.json` | Machine-readable consent changes and starter additions |
| `validation-report.json` | Errors and warnings from the transformed-container rescan |
| `*_meridian.json` | New GTM import file, emitted only when review and validation pass |

The CSV uses stable columns and pipe-delimited multi-value cells so it can be loaded into BigQuery, Databricks, Sheets, or a notebook without parsing Markdown.

## What changes

- Approved third-party tags receive GTM additional-consent requirements.
- Google tags retain built-in Consent Mode behavior and are not hard-blocked.
- Existing firing, blocking, setup, and teardown relationships remain unchanged.
- Missing Meridian data-layer variables and lifecycle triggers are merged with remapped IDs.

The migrator does not add the paused demonstration tags. GTM-native users import the custom template separately so its permissions remain visible and reviewable in GTM.

## Validation gates

The final export is withheld or marked invalid when Meridian detects:

- a deleted source tag;
- a changed tag dependency;
- an approved third-party requirement that was not applied;
- a Google tag that was accidentally hard-blocked;
- an active unresolved/conflicting tag without an explicit decision;
- a Meridian starter name collision with a different definition.

An explicitly skipped unknown tag is retained and reported as a warning. It is never reclassified as essential.

## Contextual help

```bash
meridian-consent help migrate
meridian-consent help analytics
meridian-consent help policy
```

Set `NO_COLOR=1` for plain-text logs.

## Join live counts to tag exposures

The generated impact manifest can expand event-level aggregate counts into one row per affected tag:

```bash
meridian-consent analytics \
  --endpoint https://example.com/api/consent-impact \
  --site example \
  --impact-manifest ./meridian-output/impact-manifest.json \
  --format csv \
  --output consent-tag-exposures.csv
```

With `--impact-manifest`, the CLI requests event-grouped data and exports stable fields for event, tag, provider, required consent, denied outcome, total measurement opportunities, and affected opportunities. A single event can produce multiple rows because multiple tags may depend on the same trigger. These are tag-level measurement opportunities, not unique people or deterministic sessions.
