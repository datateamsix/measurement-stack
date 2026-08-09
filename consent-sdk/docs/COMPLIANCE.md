# Compliance boundaries and controls

Meridian Consent provides implementation controls and evidence. It does not determine whether a law applies, write legal policy, or replace review by qualified privacy counsel.

## Separate state layers

| Layer | Examples | Purpose |
|---|---|---|
| Google consent | `analytics_storage`, `ad_storage`, `ad_user_data` | Controls Google and GTM measurement behavior |
| Legal-policy preference | `sale_share_opt_out`, `targeted_advertising_opt_out` | Records an opt-out concept without relabeling it as Google consent |
| Browser signal | `gpc_detected` | Records whether Global Privacy Control was observed |
| Evidence | policy version, profile, source, time, receipt/revision IDs | Documents which mechanism produced the current choice |

The default configuration honors GPC and restricts advertising consent while the signal is active. The policy receipt still preserves the separate opt-out fields so downstream systems do not infer that `ad_personalization=denied` is itself proof of a sale/share request.

## Policy profiles

- `strict-global`: optional purposes denied until choice; safest fallback when region is unknown.
- `eu-uk-consent`: prior, granular opt-in model with an equally accessible reject action.
- `us-opt-out`: implementation profile for separate sale/share and targeted-advertising choices.

Profiles are versioned configuration starting points. They are not automatic geolocation or legal conclusions. A deployment should document which profile is selected, why it applies, and what happens when region is unavailable.

## Consent receipt

`MeridianConsent.getReceipt()` returns the current fixed envelope. A new receipt is also provided to `onReceipt` and dispatched through `meridian:consent-receipt` whenever a visitor saves, accepts, rejects, withdraws, or resets.

The core SDK does not transmit or store receipts. A customer may use `onReceipt` to send the allowlisted envelope to its own authenticated collector after reviewing legal basis, access controls, retention, and deletion. Do not add page URLs, IP addresses, GA identifiers, advertising click IDs, email addresses, or fingerprinting attributes.

## Withdrawal

When a previously granted state changes to denied, Meridian:

1. updates Google Consent Mode;
2. prevents future eligibility through the new state;
3. clears only cookies explicitly allowlisted in `revocationCookies`;
4. runs registered vendor revocation callbacks;
5. emits `meridian:consent-revoked` with withdrawn types and a receipt.

Cookie removal is best effort. JavaScript cannot remove HTTP-only cookies, third-party cookies, or cookies scoped to an unavailable domain/path. The deployment inventory must identify vendor APIs or server actions needed for complete withdrawal.

## Disclosure inventory

The GTM migrator exports provider, product, purposes, consent categories, known destinations, cookies, retention, and disclosure status. Unknown values remain blank and flagged for review. Meridian never invents cookie names or retention periods.

## Required deployment review

- Confirm applicable jurisdictions and controller/business obligations.
- Verify banner language, equal choice presentation, and policy links.
- Test default and update ordering in Tag Assistant.
- Test GPC with a supported browser and confirm the visible opt-out state.
- Verify every active tag and network destination under granted and denied profiles.
- Confirm withdrawal actions, cookie scope, receipt retention, and deletion.
- Increment `policyVersion` when purposes or disclosures materially change.
- Use a certified CMP instead when IAB TCF or publisher certification is required.
