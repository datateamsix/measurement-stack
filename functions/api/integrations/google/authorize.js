import { googleAuthorizationUrl, pkceChallenge, randomUrlToken } from '../../../lib/google-oauth.js';
import { saveOAuthState } from '../../../lib/integration-store.js';
import { appendSetCookie, integrationActor } from '../../../lib/integration-session.js';
import { errorResponse } from '../../../lib/http.js';

const STATE_COOKIE = 'meridian_google_oauth_state';

function safeReturnTo(request) {
  const requested = new URL(request.url).searchParams.get('return_to') || '/app.html?integration=gtm';
  try {
    const resolved = new URL(requested, request.url);
    return resolved.origin === new URL(request.url).origin
      ? `${resolved.pathname}${resolved.search}${resolved.hash}`
      : '/app.html?integration=gtm';
  } catch {
    return '/app.html?integration=gtm';
  }
}

function stateCookie(request, state) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${STATE_COOKIE}=${encodeURIComponent(state)}; Path=/api/integrations/google/callback; HttpOnly; SameSite=Lax; Max-Age=600${secure}`;
}

export async function onRequestGet(context) {
  try {
    const actor = await integrationActor(context.request, context.env, { allowCreate: true });
    const state = randomUrlToken();
    const codeVerifier = randomUrlToken(48);
    await saveOAuthState(context.env, {
      state,
      actorKey: actor.actorKey,
      codeVerifier,
      returnTo: safeReturnTo(context.request),
    });
    const location = googleAuthorizationUrl(context.env, {
      state,
      codeChallenge: await pkceChallenge(codeVerifier),
    });
    const response = new Response(null, {
      status: 302,
      headers: {
        Location: location.toString(),
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    });
    appendSetCookie(response, actor.setCookie);
    response.headers.append('Set-Cookie', stateCookie(context.request, state));
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
