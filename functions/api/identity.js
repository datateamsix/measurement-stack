import { authenticate } from '../lib/auth.js';
import { errorResponse, json, readJson } from '../lib/http.js';
import { getPerson, syncPerson } from '../lib/identity.js';
import { getIdentityGraph, persistIdentityGraph } from '../lib/identity-graph.js';
import { sendLoopsEvent, settleDelivery } from '../lib/integrations.js';

export async function onRequestGet(context) {
  try {
    const authResult = await authenticate(context.request, context.env, { required: true, includeUser: true });
    let identity = await getPerson(context.env, authResult.auth.userId);
    if (!identity) {
      identity = await syncPerson(context.env, {
        user: authResult.user,
        clerkUserId: authResult.auth.userId,
        tracking: {},
      });
    }
    await persistIdentityGraph(context.env, {
      identity,
      user: authResult.user,
      tracking: {},
      sourceEventId: `identity-get-${authResult.auth.sessionId || crypto.randomUUID()}`,
    });
    const graph = await getIdentityGraph(context.env, identity.person_id);
    return json({ ok: true, identity, graph });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPost(context) {
  try {
    const authResult = await authenticate(context.request, context.env, { required: true, includeUser: true });
    const body = await readJson(context.request);
    const sourceEventId = body.eventId || `identity-${authResult.auth.sessionId || crypto.randomUUID()}`;
    const identity = await syncPerson(context.env, {
      user: authResult.user,
      clerkUserId: authResult.auth.userId,
      tracking: body.tracking || {},
      plan: body.plan || '',
    });
    const graphStorage = await persistIdentityGraph(context.env, {
      identity,
      user: authResult.user,
      tracking: body.tracking || {},
      sourceEventId,
    });
    const graph = await getIdentityGraph(context.env, identity.person_id);
    const email = identity.primary_email || '';
    const [, loops] = await settleDelivery('loops', sendLoopsEvent(context.env, {
      email,
      userId: identity.person_id,
      eventName: 'identityResolved',
      idempotencyKey: sourceEventId.slice(0, 100),
      contactProperties: {
        firstName: identity.first_name || '',
        lastName: identity.last_name || '',
        personId: identity.person_id,
        analyticsUserId: identity.analytics_user_id,
        clerkUserId: identity.clerk_user_id,
        currentPlan: identity.current_plan || 'starter',
      },
      eventProperties: {
        personId: identity.person_id,
        analyticsUserId: identity.analytics_user_id,
        identityStorage: identity.storage,
        browserIdentityCount: graph.browser_identities?.length || 0,
        authProviderCount: graph.external_auth_identities?.length || 0,
        authoritativeEdgeCount: graph.cluster?.authoritative_edge_count || 0,
      },
    }));
    return json({
      ok: true,
      identity: {
        ...identity,
        auth_providers: graph.external_auth_identities || [],
        cluster_version: 1,
      },
      graph,
      storage: { graph: graphStorage },
      delivery: { loops },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
