import { text } from './http.js';

function database(env) {
  return env.MEASUREMENT_STACK_DB || env.DB || null;
}

function safe(value, max = 500) {
  return text(value, max);
}

function noTable(error) {
  return /no such table/i.test(error?.message || '');
}

async function optionalRun(statement) {
  try {
    await statement.run();
    return { stored: true };
  } catch (error) {
    if (noTable(error)) return { stored: false, migration_required: true };
    throw error;
  }
}

async function optionalAll(statement) {
  try {
    const result = await statement.all();
    return result.results || [];
  } catch (error) {
    if (noTable(error)) return [];
    throw error;
  }
}

async function optionalFirst(statement) {
  try {
    return await statement.first();
  } catch (error) {
    if (noTable(error)) return null;
    throw error;
  }
}

function providerName(value) {
  return safe(value, 80)
    .toLowerCase()
    .replace(/^oauth_/, '')
    .replace(/^saml_/, '')
    .replace(/^enterprise_/, '');
}

function providerSubject(account) {
  return safe(
    account?.providerUserId
      || account?.provider_user_id
      || account?.providerSubject
      || account?.provider_subject
      || account?.externalId
      || account?.external_id
      || account?.id,
    300,
  );
}

function providerAccountId(account) {
  return safe(account?.id || account?.providerAccountId || account?.provider_account_id, 120);
}

function providerEmail(account) {
  return safe(account?.emailAddress || account?.email_address, 320).toLowerCase();
}

function providerLogin(account) {
  return safe(account?.username || account?.providerLogin || account?.provider_login, 200);
}

function providerVerification(account) {
  return safe(
    account?.verification?.status
      || account?.verificationStatus
      || account?.verification_status
      || (account?.approvedScopes ? 'provider_asserted' : ''),
    50,
  );
}

function trackingGraph(tracking = {}) {
  const graph = tracking.identity_graph && typeof tracking.identity_graph === 'object'
    ? tracking.identity_graph
    : {};
  const web = graph.web && typeof graph.web === 'object' ? graph.web : {};
  const canonical = graph.canonical && typeof graph.canonical === 'object' ? graph.canonical : {};
  const consent = tracking.consent && typeof tracking.consent === 'object' ? tracking.consent : {};
  return {
    webGraphId: safe(graph.web_graph_id || tracking.web_graph_id, 120),
    browserId: safe(web.browser_id || tracking.browser_id, 120),
    anonymousId: safe(web.anonymous_id || tracking.anonymous_user_id, 120),
    cdpAnonymousId: safe(web.cdp_anonymous_id || tracking.cdp_anonymous_id, 120),
    javascriptClientId: safe(web.javascript_client_id || tracking.js_client_id, 150),
    networkDerivedClientId: safe(web.network_derived_client_id || tracking.network_derived_client_id, 150),
    gaClientId: safe(web.ga_client_id || tracking.client_id, 120),
    gaCookieId: safe(web.ga_cookie_id || tracking.ga_cookie_id, 240),
    fplcCookie: safe(web.fplc_cookie || tracking.fplc_cookie, 240),
    fpidCookie: safe(web.fpid_cookie || tracking.fpid_cookie, 240),
    networkObservationId: safe(web.last_network_observation_id || tracking.network_observation_id, 120),
    consentSnapshotId: safe(graph.consent_snapshot_id || consent.consent_snapshot_id, 120),
    firstSeenAt: safe(graph.first_seen_at, 100),
    lastSeenAt: safe(graph.last_seen_at, 100),
    expiresAt: safe(graph.expires_at, 100),
    schemaVersion: safe(graph.schema_version, 30) || '1.0.0',
    personId: safe(canonical.person_id || tracking.person_id, 120),
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

async function upsertEdge(db, edge) {
  const now = edge.observedAt || new Date().toISOString();
  return optionalRun(db.prepare(`
    INSERT INTO identity_edges (
      edge_id, person_id, left_node_type, left_node_id, right_node_type, right_node_id,
      relationship_type, resolution_method, evidence_score, confidence_tier,
      authoritative_flag, shared_identifier_flag, source_system, source_event_id,
      first_observed_at, last_observed_at, consent_snapshot_id, resolution_version, edge_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'identity-rules-v1', 'active')
    ON CONFLICT(left_node_type, left_node_id, right_node_type, right_node_id, relationship_type)
    DO UPDATE SET
      person_id = excluded.person_id,
      evidence_score = MAX(identity_edges.evidence_score, excluded.evidence_score),
      confidence_tier = excluded.confidence_tier,
      authoritative_flag = MAX(identity_edges.authoritative_flag, excluded.authoritative_flag),
      source_event_id = COALESCE(excluded.source_event_id, identity_edges.source_event_id),
      last_observed_at = excluded.last_observed_at,
      consent_snapshot_id = COALESCE(excluded.consent_snapshot_id, identity_edges.consent_snapshot_id),
      edge_status = 'active'
  `).bind(
    edge.edgeId || `edge_${crypto.randomUUID()}`,
    edge.personId || null,
    edge.leftNodeType,
    edge.leftNodeId,
    edge.rightNodeType,
    edge.rightNodeId,
    edge.relationshipType,
    edge.resolutionMethod,
    Number(edge.evidenceScore || 0),
    edge.confidenceTier,
    edge.authoritative ? 1 : 0,
    edge.sharedIdentifier ? 1 : 0,
    edge.sourceSystem || 'measurement_stack',
    edge.sourceEventId || null,
    now,
    now,
    edge.consentSnapshotId || null,
  ));
}

export async function persistIdentityGraph(env, {
  identity,
  user = null,
  tracking = {},
  sourceEventId = '',
} = {}) {
  const db = database(env);
  if (!db || !identity?.person_id) return { configured: Boolean(db), stored: false };

  const now = new Date().toISOString();
  const graph = trackingGraph(tracking);
  const personId = safe(identity.person_id, 120);
  const identifiers = [
    ['web_graph_id', graph.webGraphId],
    ['browser_id', graph.browserId],
    ['anonymous_user_id', graph.anonymousId],
    ['cdp_anonymous_id', graph.cdpAnonymousId],
    ['javascript_client_id', graph.javascriptClientId],
    ['network_derived_client_id', graph.networkDerivedClientId],
    ['ga_client_id', graph.gaClientId],
    ['ga_cookie_id', graph.gaCookieId],
    ['fplc_cookie', graph.fplcCookie],
    ['fpid_cookie', graph.fpidCookie],
    ['network_observation_id', graph.networkObservationId],
  ];
  for (const [namespace, value] of identifiers) {
    if (value) await upsertIdentifier(db, personId, namespace, value, now);
  }

  let browser = { stored: false };
  if (graph.webGraphId && graph.browserId && graph.anonymousId) {
    browser = await optionalRun(db.prepare(`
      INSERT INTO web_browser_identities (
        web_graph_id, person_id, browser_id, anonymous_id, cdp_anonymous_id,
        javascript_client_id, network_derived_client_id, ga_client_id, ga_cookie_id,
        fplc_cookie, fpid_cookie, first_seen_at, last_seen_at,
        last_network_observation_id, consent_snapshot_id, storage_schema_version,
        server_version, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(web_graph_id) DO UPDATE SET
        person_id = excluded.person_id,
        browser_id = excluded.browser_id,
        anonymous_id = excluded.anonymous_id,
        cdp_anonymous_id = COALESCE(excluded.cdp_anonymous_id, web_browser_identities.cdp_anonymous_id),
        javascript_client_id = COALESCE(excluded.javascript_client_id, web_browser_identities.javascript_client_id),
        network_derived_client_id = COALESCE(excluded.network_derived_client_id, web_browser_identities.network_derived_client_id),
        ga_client_id = COALESCE(excluded.ga_client_id, web_browser_identities.ga_client_id),
        ga_cookie_id = COALESCE(excluded.ga_cookie_id, web_browser_identities.ga_cookie_id),
        fplc_cookie = COALESCE(excluded.fplc_cookie, web_browser_identities.fplc_cookie),
        fpid_cookie = COALESCE(excluded.fpid_cookie, web_browser_identities.fpid_cookie),
        last_seen_at = excluded.last_seen_at,
        last_network_observation_id = COALESCE(excluded.last_network_observation_id, web_browser_identities.last_network_observation_id),
        consent_snapshot_id = COALESCE(excluded.consent_snapshot_id, web_browser_identities.consent_snapshot_id),
        storage_schema_version = excluded.storage_schema_version,
        server_version = web_browser_identities.server_version + 1,
        expires_at = excluded.expires_at
    `).bind(
      graph.webGraphId,
      personId,
      graph.browserId,
      graph.anonymousId,
      graph.cdpAnonymousId || null,
      graph.javascriptClientId || null,
      graph.networkDerivedClientId || null,
      graph.gaClientId || null,
      graph.gaCookieId || null,
      graph.fplcCookie || null,
      graph.fpidCookie || null,
      graph.firstSeenAt || now,
      graph.lastSeenAt || now,
      graph.networkObservationId || null,
      graph.consentSnapshotId || null,
      graph.schemaVersion,
      graph.expiresAt || null,
    ));

    await upsertEdge(db, {
      personId,
      leftNodeType: 'person',
      leftNodeId: personId,
      rightNodeType: 'web_browser',
      rightNodeId: graph.webGraphId,
      relationshipType: identity.clerk_user_id ? 'observed_on' : 'candidate_observed_on',
      resolutionMethod: identity.clerk_user_id ? 'deterministic' : 'probabilistic',
      evidenceScore: identity.clerk_user_id ? 0.95 : 0.55,
      confidenceTier: identity.clerk_user_id ? 'strong' : 'candidate',
      authoritative: false,
      sourceEventId,
      consentSnapshotId: graph.consentSnapshotId,
      observedAt: now,
    });
  }

  const externalAccounts = Array.isArray(user?.externalAccounts)
    ? user.externalAccounts
    : Array.isArray(user?.external_accounts)
      ? user.external_accounts
      : [];
  const providers = [];

  if (identity.clerk_user_id) {
    await upsertEdge(db, {
      personId,
      leftNodeType: 'person',
      leftNodeId: personId,
      rightNodeType: 'clerk_user',
      rightNodeId: identity.clerk_user_id,
      relationshipType: 'authenticated_as',
      resolutionMethod: 'deterministic',
      evidenceScore: 1,
      confidenceTier: 'authoritative',
      authoritative: true,
      sourceSystem: 'clerk',
      sourceEventId,
      consentSnapshotId: graph.consentSnapshotId,
      observedAt: now,
    });
  }

  for (const account of externalAccounts) {
    const provider = providerName(account.provider);
    const subject = providerSubject(account);
    if (!provider || !subject) continue;
    const authIdentityId = providerAccountId(account) || `auth_${crypto.randomUUID()}`;
    const verification = providerVerification(account) || 'provider_asserted';
    const record = {
      provider,
      provider_subject: subject,
      provider_account_id: authIdentityId,
      provider_login: providerLogin(account),
      provider_email: providerEmail(account),
      verification_status: verification,
      linked_at: safe(account.createdAt || account.created_at, 100) || now,
    };
    providers.push(record);

    await optionalRun(db.prepare(`
      INSERT INTO external_auth_identities (
        auth_identity_id, person_id, clerk_user_id, provider, provider_account_id,
        provider_subject, provider_login, provider_email, verification_status,
        link_method, record_status, linked_at, last_authenticated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'signup', 'active', ?, ?)
      ON CONFLICT(provider, provider_subject) DO UPDATE SET
        person_id = excluded.person_id,
        clerk_user_id = excluded.clerk_user_id,
        provider_account_id = excluded.provider_account_id,
        provider_login = COALESCE(excluded.provider_login, external_auth_identities.provider_login),
        provider_email = COALESCE(excluded.provider_email, external_auth_identities.provider_email),
        verification_status = excluded.verification_status,
        record_status = 'active',
        last_authenticated_at = excluded.last_authenticated_at
    `).bind(
      authIdentityId,
      personId,
      identity.clerk_user_id,
      provider,
      authIdentityId,
      subject,
      record.provider_login || null,
      record.provider_email || null,
      verification,
      record.linked_at,
      now,
    ));

    await upsertEdge(db, {
      personId,
      leftNodeType: 'person',
      leftNodeId: personId,
      rightNodeType: `${provider}_identity`,
      rightNodeId: subject,
      relationshipType: 'authenticated_as',
      resolutionMethod: 'deterministic',
      evidenceScore: 1,
      confidenceTier: 'authoritative',
      authoritative: true,
      sourceSystem: provider,
      sourceEventId,
      consentSnapshotId: graph.consentSnapshotId,
      observedAt: now,
    });
  }

  if (graph.networkObservationId) {
    await optionalRun(db.prepare(`
      UPDATE network_observations
      SET person_id = ?, browser_id = COALESCE(?, browser_id)
      WHERE network_observation_id = ?
    `).bind(personId, graph.browserId || null, graph.networkObservationId));
  }

  return {
    configured: true,
    stored: Boolean(browser.stored || providers.length || identity.clerk_user_id),
    browser,
    providers,
  };
}

export async function persistLifecycleEvent(env, {
  personId = '',
  browserId = '',
  eventName,
  fromStage = '',
  toStage,
  sourceEventId = '',
  leadId = '',
  checkoutSessionId = '',
  subscriptionId = '',
  planId = '',
  payload = {},
  occurredAt = new Date().toISOString(),
} = {}) {
  const db = database(env);
  if (!db || !eventName || !toStage) return { configured: Boolean(db), stored: false };
  return optionalRun(db.prepare(`
    INSERT INTO lifecycle_events (
      lifecycle_event_id, person_id, browser_id, event_name, from_stage, to_stage,
      source_event_id, lead_id, checkout_session_id, subscription_id, plan_id,
      occurred_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    `lifecycle_${crypto.randomUUID()}`,
    personId || null,
    browserId || null,
    eventName,
    fromStage || null,
    toStage,
    sourceEventId || null,
    leadId || null,
    checkoutSessionId || null,
    subscriptionId || null,
    planId || null,
    occurredAt,
    JSON.stringify(payload || {}),
  ));
}

export async function persistBillingGraph(env, {
  personId,
  browserId = '',
  eventId = '',
  stripeCustomerId = '',
  checkoutSessionId = '',
  subscriptionId = '',
  planId = '',
  paymentStatus = '',
  occurredAt = new Date().toISOString(),
} = {}) {
  const db = database(env);
  if (!db || !personId) return { configured: Boolean(db), stored: false };
  const aliases = [
    ['stripe_customer_id', stripeCustomerId],
    ['stripe_checkout_session_id', checkoutSessionId],
    ['stripe_subscription_id', subscriptionId],
  ].filter(([, value]) => Boolean(value));

  for (const [aliasType, aliasValue] of aliases) {
    await optionalRun(db.prepare(`
      INSERT INTO billing_aliases (
        billing_alias_id, person_id, alias_type, alias_value,
        relationship_type, first_linked_at, last_confirmed_at, active_flag
      ) VALUES (?, ?, ?, ?, 'primary', ?, ?, 1)
      ON CONFLICT(alias_type, alias_value) DO UPDATE SET
        person_id = excluded.person_id,
        last_confirmed_at = excluded.last_confirmed_at,
        active_flag = 1
    `).bind(
      `billing_${crypto.randomUUID()}`,
      personId,
      aliasType,
      aliasValue,
      occurredAt,
      occurredAt,
    ));

    await upsertEdge(db, {
      personId,
      leftNodeType: 'person',
      leftNodeId: personId,
      rightNodeType: aliasType,
      rightNodeId: aliasValue,
      relationshipType: aliasType === 'stripe_customer_id' ? 'paid_by' : 'owns',
      resolutionMethod: 'deterministic',
      evidenceScore: 1,
      confidenceTier: 'authoritative',
      authoritative: true,
      sourceSystem: 'stripe',
      sourceEventId: eventId,
      observedAt: occurredAt,
    });
  }

  await persistLifecycleEvent(env, {
    personId,
    browserId,
    eventName: paymentStatus === 'paid' || paymentStatus === 'no_payment_required' ? 'purchase' : 'checkout_started',
    toStage: paymentStatus === 'paid' || paymentStatus === 'no_payment_required' ? 'customer' : 'checkout_started',
    sourceEventId: eventId,
    checkoutSessionId,
    subscriptionId,
    planId,
    payload: { stripe_customer_id: stripeCustomerId, payment_status: paymentStatus },
    occurredAt,
  });

  return { configured: true, stored: true, aliases: aliases.length };
}

export async function getIdentityGraph(env, personId) {
  const db = database(env);
  if (!db || !personId) return {
    configured: Boolean(db),
    person_id: personId || '',
    browser_identities: [],
    external_auth_identities: [],
    edges: [],
    billing_aliases: [],
    lifecycle_events: [],
  };

  const [browserIdentities, externalAuth, edges, billingAliases, lifecycleEvents] = await Promise.all([
    optionalAll(db.prepare('SELECT * FROM web_browser_identities WHERE person_id = ? ORDER BY last_seen_at DESC').bind(personId)),
    optionalAll(db.prepare('SELECT * FROM external_auth_identities WHERE person_id = ? ORDER BY linked_at ASC').bind(personId)),
    optionalAll(db.prepare('SELECT * FROM identity_edges WHERE person_id = ? ORDER BY last_observed_at DESC LIMIT 100').bind(personId)),
    optionalAll(db.prepare('SELECT * FROM billing_aliases WHERE person_id = ? ORDER BY last_confirmed_at DESC').bind(personId)),
    optionalAll(db.prepare('SELECT * FROM lifecycle_events WHERE person_id = ? ORDER BY occurred_at DESC LIMIT 50').bind(personId)),
  ]);

  const cluster = await optionalFirst(db.prepare(`
    SELECT
      COUNT(*) AS identifier_count,
      SUM(CASE WHEN authoritative_flag = 1 THEN 1 ELSE 0 END) AS authoritative_edge_count,
      SUM(CASE WHEN confidence_tier = 'candidate' THEN 1 ELSE 0 END) AS candidate_edge_count
    FROM identity_edges
    WHERE person_id = ? AND edge_status = 'active'
  `).bind(personId));

  return {
    configured: true,
    person_id: personId,
    cluster: {
      resolution_version: 'identity-rules-v1',
      identifier_count: Number(cluster?.identifier_count || 0),
      authoritative_edge_count: Number(cluster?.authoritative_edge_count || 0),
      candidate_edge_count: Number(cluster?.candidate_edge_count || 0),
    },
    browser_identities: browserIdentities,
    external_auth_identities: externalAuth,
    edges,
    billing_aliases: billingAliases,
    lifecycle_events: lifecycleEvents,
  };
}
