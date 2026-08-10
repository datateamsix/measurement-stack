import { revokeGoogleToken } from '../../../lib/google-oauth.js';
import { connectedToken, deleteConnection } from '../../../lib/integration-store.js';
import { assertSameOrigin, clearSessionCookie, integrationActor } from '../../../lib/integration-session.js';
import { errorResponse, json } from '../../../lib/http.js';

export async function onRequestPost(context) {
  try {
    assertSameOrigin(context.request);
    const actor = await integrationActor(context.request, context.env);
    let revoked = false;
    try {
      const { token } = await connectedToken(context.env, actor.actorKey);
      revoked = await revokeGoogleToken(token.refresh_token || token.access_token).catch(() => false);
    } finally {
      await deleteConnection(context.env, actor.actorKey);
    }
    const response = json({ ok: true, disconnected: true, revoked });
    if (actor.mode === 'local_test') response.headers.append('Set-Cookie', clearSessionCookie(context.request));
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
