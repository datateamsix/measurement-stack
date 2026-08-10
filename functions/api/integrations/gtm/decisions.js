import { validateConsentTypes } from '../../../lib/gtm-compliance.js';
import { saveTagDecision } from '../../../lib/gtm-property-store.js';
import { assertSameOrigin, integrationActor } from '../../../lib/integration-session.js';
import { errorResponse, json, readJson } from '../../../lib/http.js';

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const actor = await integrationActor(context.request, context.env);
    const body = await readJson(context.request);
    const enforcement = String(body.enforcement || 'additional');
    const consentTypes = validateConsentTypes(body.consentTypes, { allowEmpty: enforcement !== 'additional' });
    await saveTagDecision(context.env, actor.actorKey, { ...body, consentTypes, enforcement });
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
