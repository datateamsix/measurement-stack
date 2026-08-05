import { text } from './http.js';

const PERSON_PATTERN = /^person_[A-Za-z0-9-]{8,100}$/;
const ANALYTICS_PATTERN = /^analytics_[A-Za-z0-9-]{8,100}$/;

function primaryEmail(user) {
  const emailId = user?.primaryEmailAddressId;
  return user?.emailAddresses?.find((item) => item.id === emailId)?.emailAddress
    || user?.emailAddresses?.[0]?.emailAddress
    || '';
}

function normalizedTracking(input = {}) {
  return {
    person_id: text(input.person_id, 100),
    analytics_user_id: text(input.analytics_user_id, 100),
    anonymous_user_id: text(input.anonymous_user_id, 100),
    ga_cookie_id: text(input.ga_cookie_id, 200),
    ga_client_id: text(input.client_id, 100),
    session_id: text(input.session_id, 100),
    page_location: text(input.page_location, 1000),
    page_referrer: text(input.page_referrer, 1000),
    attribution: input.attribution && typeof input.attribution === 'object' ? input.attribution : {},
  };
}

async function upsertIdentifier(db, personId, namespace, value, now) {
  if (!value) return;
  await db.prepare(`
    INSERT INTO identifiers (person_id, namespace, identifier_value, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(namespace, identifier_value)
    DO UPDATE SET person_id = excluded.person_id, last_seen_at = excluded.last_seen_at
  `).bind(personId, namespace, value, now, now).run();
}

export function d1Configured(env) {
  return Boolean(env.MEASURESTACK_DB);
}

export async function syncPerson(env, { user, clerkUserId = '', tracking: trackingInput = {}, plan = '' }) {
  const tracking = normalizedTracking(trackingInput);
  const now = new Date().toISOString();
  const email = primaryEmail(user).trim().toLowerCase();
  const firstName = text(user?.firstName, 100);
  const lastName = text(user?.lastName, 100);

  if (!d1Configured(env)) {
    return {
      person_id: PERSON_PATTERN.test(tracking.person_id) ? tracking.person_id : `person_${crypto.randomUUID()}`,
      analytics_user_id: ANALYTICS_PATTERN.test(tracking.analytics_user_id) ? tracking.analytics_user_id : `analytics_${crypto.randomUUID()}`,
      clerk_user_id: clerkUserId,
      primary_email: email,
      first_name: firstName,
      last_name: lastName,
      current_plan: plan || 'starter',
      stripe_customer_id: '',
      storage: 'unbound',
    };
  }

  const db = env.MEASURESTACK_DB;
  let person = clerkUserId
    ? await db.prepare('SELECT * FROM persons WHERE clerk_user_id = ?').bind(clerkUserId).first()
    : null;

  if (!person && email) {
    const match = await db.prepare(`
      SELECT p.* FROM persons p
      JOIN identifiers i ON i.person_id = p.person_id
      WHERE i.namespace = 'email' AND i.identifier_value = ?
      LIMIT 1
    `).bind(email).first();
    if (match) person = match;
  }

  if (!person) {
    const proposedPersonId = PERSON_PATTERN.test(tracking.person_id) ? tracking.person_id : `person_${crypto.randomUUID()}`;
    const collision = await db.prepare('SELECT person_id FROM persons WHERE person_id = ?').bind(proposedPersonId).first();
    const personId = collision ? `person_${crypto.randomUUID()}` : proposedPersonId;
    const analyticsUserId = ANALYTICS_PATTERN.test(tracking.analytics_user_id)
      ? tracking.analytics_user_id
      : `analytics_${crypto.randomUUID()}`;

    await db.prepare(`
      INSERT INTO persons (
        person_id, analytics_user_id, clerk_user_id, primary_email,
        first_name, last_name, current_plan, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      personId,
      analyticsUserId,
      clerkUserId || null,
      email || null,
      firstName || null,
      lastName || null,
      plan || 'starter',
      now,
      now,
    ).run();
    person = await db.prepare('SELECT * FROM persons WHERE person_id = ?').bind(personId).first();
  } else {
    await db.prepare(`
      UPDATE persons SET
        clerk_user_id = COALESCE(?, clerk_user_id),
        primary_email = COALESCE(?, primary_email),
        first_name = COALESCE(?, first_name),
        last_name = COALESCE(?, last_name),
        current_plan = CASE WHEN ? != '' THEN ? ELSE current_plan END,
        updated_at = ?
      WHERE person_id = ?
    `).bind(
      clerkUserId || null,
      email || null,
      firstName || null,
      lastName || null,
      plan,
      plan,
      now,
      person.person_id,
    ).run();
    person = await db.prepare('SELECT * FROM persons WHERE person_id = ?').bind(person.person_id).first();
  }

  const identifiers = [
    ['clerk_user_id', clerkUserId],
    ['email', email],
    ['anonymous_user_id', tracking.anonymous_user_id],
    ['ga_client_id', tracking.ga_client_id],
    ['ga_cookie_id', tracking.ga_cookie_id],
  ];
  for (const [namespace, value] of identifiers) await upsertIdentifier(db, person.person_id, namespace, value, now);

  const lastTouch = tracking.attribution?.last_touch || {};
  if (Object.keys(lastTouch).length) {
    await db.prepare(`
      INSERT INTO attribution_touches (
        touch_id, person_id, touch_type, source, medium, campaign, content,
        landing_page, referrer, click_ids_json, captured_at
      ) VALUES (?, ?, 'last_touch', ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      `touch_${crypto.randomUUID()}`,
      person.person_id,
      text(lastTouch.utm_source, 500) || null,
      text(lastTouch.utm_medium, 500) || null,
      text(lastTouch.utm_campaign, 500) || null,
      text(lastTouch.utm_content, 500) || null,
      text(lastTouch.landing_page, 1000) || null,
      text(lastTouch.referrer, 1000) || null,
      JSON.stringify({
        gclid: text(lastTouch.gclid, 500),
        fbclid: text(lastTouch.fbclid, 500),
        li_fat_id: text(lastTouch.li_fat_id, 500),
        msclkid: text(lastTouch.msclkid, 500),
      }),
      text(lastTouch.captured_at, 100) || now,
    ).run();
  }

  return { ...person, storage: 'd1' };
}

export async function getPerson(env, clerkUserId) {
  if (!d1Configured(env)) return null;
  const person = await env.MEASURESTACK_DB.prepare('SELECT * FROM persons WHERE clerk_user_id = ?').bind(clerkUserId).first();
  return person ? { ...person, storage: 'd1' } : null;
}

export async function recordLead(env, lead) {
  if (!d1Configured(env)) return { configured: false };
  await env.MEASURESTACK_DB.prepare(`
    INSERT INTO leads (
      lead_id, event_id, person_id, email, company, job_title,
      company_size, use_case, attribution_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    lead.leadId,
    lead.eventId,
    lead.identity.person_id || null,
    lead.workEmail,
    lead.company,
    lead.jobTitle,
    lead.companySize,
    lead.useCase,
    JSON.stringify(lead.tracking.attribution || {}),
    lead.receivedAt,
  ).run();
  return { configured: true, stored: true };
}

export async function recordCheckout(env, checkout) {
  if (!d1Configured(env)) return { configured: false };
  await env.MEASURESTACK_DB.prepare(`
    INSERT INTO checkout_sessions (
      stripe_session_id, event_id, person_id, plan_id, amount_total,
      currency, payment_status, stripe_customer_id, webhook_received, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(stripe_session_id) DO UPDATE SET
      payment_status = excluded.payment_status,
      stripe_customer_id = COALESCE(excluded.stripe_customer_id, checkout_sessions.stripe_customer_id),
      webhook_received = MAX(checkout_sessions.webhook_received, excluded.webhook_received),
      updated_at = excluded.updated_at
  `).bind(
    checkout.sessionId,
    checkout.eventId,
    checkout.personId,
    checkout.plan,
    checkout.amountTotal || 0,
    checkout.currency || 'usd',
    checkout.paymentStatus || 'unpaid',
    checkout.customerId || null,
    checkout.webhookReceived ? 1 : 0,
    checkout.createdAt || new Date().toISOString(),
    new Date().toISOString(),
  ).run();

  if (checkout.customerId) {
    await env.MEASURESTACK_DB.prepare(`
      UPDATE persons SET stripe_customer_id = ?, current_plan = ?, updated_at = ? WHERE person_id = ?
    `).bind(checkout.customerId, checkout.plan || 'starter', new Date().toISOString(), checkout.personId).run();
    await upsertIdentifier(env.MEASURESTACK_DB, checkout.personId, 'stripe_customer_id', checkout.customerId, new Date().toISOString());
  }
  return { configured: true, stored: true };
}

export async function getCheckout(env, sessionId) {
  if (!d1Configured(env)) return null;
  return env.MEASURESTACK_DB.prepare('SELECT * FROM checkout_sessions WHERE stripe_session_id = ?').bind(sessionId).first();
}

export async function recordConversion(env, conversion) {
  if (!d1Configured(env)) return { configured: false };
  await env.MEASURESTACK_DB.prepare(`
    INSERT INTO conversion_events (
      event_id, event_name, person_id, source, value, currency, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id, event_name, source) DO NOTHING
  `).bind(
    conversion.eventId,
    conversion.eventName,
    conversion.personId || null,
    conversion.source,
    conversion.value || 0,
    conversion.currency || 'USD',
    JSON.stringify(conversion.payload || {}),
    conversion.createdAt || new Date().toISOString(),
  ).run();
  return { configured: true, stored: true };
}
