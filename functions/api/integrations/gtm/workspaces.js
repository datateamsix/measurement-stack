import { createWorkspace, listWorkspaces } from '../../../lib/gtm-api.js';
import { assertSameOrigin, integrationActor } from '../../../lib/integration-session.js';
import { errorResponse, json, readJson } from '../../../lib/http.js';

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

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const actor = await integrationActor(context.request, context.env);
    const body = await readJson(context.request);
    const workspace = await createWorkspace(context.env, actor.actorKey, {
      accountId: body.accountId,
      containerId: body.containerId,
    }, {
      name: body.name,
      description: body.description,
    });
    return json({ workspace }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
