import { listWorkspaceResources } from '../../../lib/gtm-api.js';
import { integrationActor } from '../../../lib/integration-session.js';
import { errorResponse, json } from '../../../lib/http.js';

export async function onRequestGet(context) {
  try {
    const actor = await integrationActor(context.request, context.env);
    const params = new URL(context.request.url).searchParams;
    const resources = await listWorkspaceResources(context.env, actor.actorKey, {
      accountId: params.get('accountId'),
      containerId: params.get('containerId'),
      workspaceId: params.get('workspaceId'),
    });
    return json(resources);
  } catch (error) {
    return errorResponse(error);
  }
}
