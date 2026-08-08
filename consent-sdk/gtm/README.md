# Meridian Consent for GTM

This directory contains two optional GTM assets:

- `measurestack-starter-container.json` — importable variables, triggers, and paused example tags.
- `measurestack-consent-template.tpl` — a native GTM consent template that calls `setDefaultConsentState` and `updateConsentState`.

## Import the starter container

In GTM, open **Admin → Import Container**, select the JSON file, choose a workspace, and select **Merge**. Preview the merge before confirming it. Do not select Overwrite on an established container.

The import creates:

- nine Data Layer Variables;
- ready and updated Custom Event triggers;
- analytics-granted and advertising-granted conditional triggers;
- two paused, network-free example tags.

The example tags are inert demonstrations. Copy their triggers and consent requirements to real vendor tags; do not unpause them expecting a vendor integration.

## Optional native consent bridge

Use this only when you want GTM—not the browser SDK—to own Google Consent Mode calls.

1. In **Templates → Tag Templates**, click **New → ⋮ → Import** and select `measurestack-consent-template.tpl`.
2. Create a tag named `MeasureStack Consent - Default`.
3. Select **Default**, set the same policy version used by the SDK, set the wait to `500`, and fire on **Consent Initialization – All Pages**.
4. Create a second tag named `MeasureStack Consent - Update`.
5. Select **Update** and fire on `CE - MS Consent - Updated`.
6. Set `googleConsent: false` in the SDK configuration to prevent duplicate commands.
7. Preview, test all choices, then publish.

The template reads the `ms_consent` cookie during Consent Initialization and reads `measurestack_consent` from the data layer on updates. It uses GTM's native Consent APIs; it does not issue `gtag('consent', ...)` from Custom HTML.

## Conditional vendor tags

For an analytics vendor tag:

- firing trigger: `CE - MS Consent - Analytics Granted`;
- additional consent check: `analytics_storage`.

For an advertising vendor tag:

- firing trigger: `CE - MS Consent - Advertising Granted`;
- additional consent checks: `ad_storage`, `ad_user_data`, and `ad_personalization` as appropriate for the vendor and use case.

Google tags already have built-in consent checks. Review the Consent Overview before publishing rather than duplicating their built-in behavior with trigger exceptions.
