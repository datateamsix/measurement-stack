# MeasureStack

**The attribution and identity resolution OS for your business.**

MeasureStack is a fictitious SaaS product and practical measurement-engineering sandbox. It demonstrates how anonymous behavior, authenticated users, lead submissions, CRM records, Stripe test checkout, and advertising conversion events can resolve to one canonical customer identity.

## What is included

- Cloudflare Pages static site and Pages Functions
- GTM web container `GTM-5MQ3QDNF` on every page
- Consent defaults before GTM initializes
- First-touch and last-touch attribution persistence
- Hidden lead fields for person, analytics user, GA cookie, and UTMs
- Clerk sign-up and sign-in scaffold
- Authenticated identity-resolution workspace
- Cloudflare D1 schema for people, identifiers, leads, touches, checkouts, and conversions
- Loops CRM contact and event delivery
- Stripe-hosted Checkout in test mode
- Verified Stripe webhook and purchase event
- Canonical sGTM relay for lead and purchase events
- Browser/server deduplication using a shared `event_id`

See `docs/account-setup.md` for setup instructions.
