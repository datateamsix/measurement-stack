import { applyPropertyCompliance } from '../../../lib/gtm-workflow.js';
import { assertSameOrigin, integrationActor } from '../../../lib/integration-session.js';
import { errorResponse, json, readJson } from '../../../lib/http.js';

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const actor = await integrationActor(context.request, context.env);
    const body = await readJson(context.request);
    return json(await applyPropertyCompliance(context.env, actor.actorKey, body.propertyKey));
  } catch (error) {
    return errorResponse(error);
  }
}
