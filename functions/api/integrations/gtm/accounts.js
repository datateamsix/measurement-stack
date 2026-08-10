import { listAccounts } from '../../../lib/gtm-api.js';
import { integrationActor } from '../../../lib/integration-session.js';
import { errorResponse, json } from '../../../lib/http.js';

export async function onRequestGet(context) {
  try {
    const actor = await integrationActor(context.request, context.env);
    return json({ accounts: await listAccounts(context.env, actor.actorKey) });
  } catch (error) {
    return errorResponse(error);
  }
}
