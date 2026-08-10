import { listContainers } from '../../../lib/gtm-api.js';
import { integrationActor } from '../../../lib/integration-session.js';
import { errorResponse, json } from '../../../lib/http.js';

export async function onRequestGet(context) {
  try {
    const actor = await integrationActor(context.request, context.env);
    const accountId = new URL(context.request.url).searchParams.get('accountId');
    return json({ containers: await listContainers(context.env, actor.actorKey, accountId) });
  } catch (error) {
    return errorResponse(error);
  }
}
