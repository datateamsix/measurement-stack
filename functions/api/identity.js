import { authenticate } from '../lib/auth.js';
import { errorResponse, json, readJson } from '../lib/http.js';
import { getPerson, syncPerson } from '../lib/identity.js';
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
    return json({ ok: true, identity });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPost(context) {
  try {
    const authResult = await authenticate(context.request, context.env, { required: true, includeUser: true });
    const body = await readJson(context.request);
    const identity = await syncPerson(context.env, {
      user: authResult.user,
      clerkUserId: authResult.auth.userId,
      tracking: body.tracking || {},
      plan: body.plan || '',
    });
    const email = identity.primary_email || '';
    const [, loops] = await settleDelivery('loops', sendLoopsEvent(context.env, {
      email,
      userId: identity.person_id,
      eventName: 'identityResolved',
      idempotencyKey: `identity-${authResult.auth.sessionId || crypto.randomUUID()}`.slice(0, 100),
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
      },
    }));
    return json({ ok: true, identity, delivery: { loops } });
  } catch (error) {
    return errorResponse(error);
  }
}
