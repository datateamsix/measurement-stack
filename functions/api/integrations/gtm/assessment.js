import { loadPropertyAssessment } from '../../../lib/gtm-workflow.js';
import { integrationActor } from '../../../lib/integration-session.js';
import { errorResponse, json } from '../../../lib/http.js';

export async function onRequestGet(context) {
  try {
    const actor = await integrationActor(context.request, context.env);
    const propertyKey = new URL(context.request.url).searchParams.get('propertyKey');
    const result = await loadPropertyAssessment(context.env, actor.actorKey, propertyKey);
    return json(result.assessment);
  } catch (error) {
    return errorResponse(error);
  }
}
