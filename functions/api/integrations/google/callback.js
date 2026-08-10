import {
  exchangeAuthorizationCode,
  GTM_REQUIRED_SCOPES,
  revokeGoogleToken,
} from '../../../lib/google-oauth.js';
import { consumeOAuthState, saveConnection } from '../../../lib/integration-store.js';
import { integrationActor } from '../../../lib/integration-session.js';
import { HttpError, errorResponse } from '../../../lib/http.js';

const STATE_COOKIE = 'meridian_google_oauth_state';

function cookieValue(request, name) {
  for (const item of (request.headers.get('cookie') || '').split(';')) {
    const [key, ...parts] = item.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return '';
}

function clearStateCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${STATE_COOKIE}=; Path=/api/integrations/google/callback; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function resultRedirect(request, returnTo, values) {
  const target = new URL(returnTo || '/app.html?integration=gtm', request.url);
  for (const [key, value] of Object.entries(values)) target.searchParams.set(key, value);
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      'Set-Cookie': clearStateCookie(request),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export async function onRequestGet(context) {
  try {
    const actor = await integrationActor(context.request, context.env);
    const url = new URL(context.request.url);
    const state = url.searchParams.get('state') || '';
    if (!state || state !== cookieValue(context.request, STATE_COOKIE)) {
      throw new HttpError(400, 'The OAuth state cookie did not match.');
    }
    const pending = await consumeOAuthState(context.env, { state, actorKey: actor.actorKey });
    if (url.searchParams.get('error')) {
      return resultRedirect(context.request, pending.returnTo, {
        gtm_status: 'error',
        gtm_error: String(url.searchParams.get('error')).slice(0, 80),
      });
    }
    const code = url.searchParams.get('code') || '';
    if (!code) throw new HttpError(400, 'Google did not return an authorization code.');

    const token = await exchangeAuthorizationCode(context.env, {
      code,
      codeVerifier: pending.codeVerifier,
    });
    const scopes = new Set(String(token.scope || '').split(/\s+/u).filter(Boolean));
    const missing = GTM_REQUIRED_SCOPES.filter((scope) => !scopes.has(scope));
    if (missing.length) {
      await revokeGoogleToken(token.refresh_token || token.access_token).catch(() => false);
      throw new HttpError(403, 'Google did not grant the required GTM container and version-edit scopes.');
    }
    const prohibited = [
      'https://www.googleapis.com/auth/tagmanager.delete.containers',
      'https://www.googleapis.com/auth/tagmanager.publish',
      'https://www.googleapis.com/auth/tagmanager.manage.users',
      'https://www.googleapis.com/auth/tagmanager.manage.accounts',
    ].filter((scope) => scopes.has(scope));
    if (prohibited.length) {
      await revokeGoogleToken(token.refresh_token || token.access_token).catch(() => false);
      throw new HttpError(403, 'Google returned broader GTM permissions than Meridian permits.');
    }
    await saveConnection(context.env, { actorKey: actor.actorKey, token });
    return resultRedirect(context.request, pending.returnTo, { gtm_status: 'connected' });
  } catch (error) {
    return errorResponse(error);
  }
}
