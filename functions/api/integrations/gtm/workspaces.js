import { listWorkspaces } from '../../../lib/gtm-api.js';
import { integrationActor } from '../../../lib/integration-session.js';
import { errorResponse, json } from '../../../lib/http.js';

export async function onRequestGet(context) {
  try {
    const actor = await integrationActor(context.request, context.env);
    const params = new URL(context.request.url).searchParams;
    return json({
      workspaces: await listWorkspaces(
        context.env,
        actor.actorKey,
        params.get('accountId'),
        params.get('containerId'),
      ),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
