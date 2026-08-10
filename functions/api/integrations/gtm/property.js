import { propertyBinding, savePropertyBinding } from '../../../lib/gtm-property-store.js';
import { assertSameOrigin, integrationActor } from '../../../lib/integration-session.js';
import { errorResponse, json, readJson } from '../../../lib/http.js';

export async function onRequestGet(context) {
  try {
    const actor = await integrationActor(context.request, context.env);
    const key = new URL(context.request.url).searchParams.get('propertyKey');
    return json({ binding: await propertyBinding(context.env, actor.actorKey, key) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPut(context) {
  try {
    assertSameOrigin(context.request);
    const actor = await integrationActor(context.request, context.env);
    const binding = await savePropertyBinding(context.env, actor.actorKey, await readJson(context.request));
    return json({ binding });
  } catch (error) {
    return errorResponse(error);
  }
}
