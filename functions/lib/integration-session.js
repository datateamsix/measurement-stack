import { authenticate, clerkConfigured } from './auth.js';
import { HttpError } from './http.js';

const SESSION_COOKIE = 'meridian_integration_session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function cookieValue(request, name) {
  for (const item of (request.headers.get('cookie') || '').split(';')) {
    const [key, ...parts] = item.trim().split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return '';
}

async function hmac(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return { key, signature: await crypto.subtle.sign('HMAC', key, encoder.encode(value)) };
}

async function signSession(secret, id) {
  const { signature } = await hmac(secret, id);
  return `${id}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function verifySession(secret, signedValue) {
  const separator = signedValue.lastIndexOf('.');
  if (separator < 1) return '';
  const id = signedValue.slice(0, separator);
  const signature = signedValue.slice(separator + 1);
  const { key } = await hmac(secret, id);
  let bytes;
  try {
    const normalized = signature.replaceAll('-', '+').replaceAll('_', '/');
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return '';
  }
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    bytes,
    new TextEncoder().encode(id),
  );
  return valid ? id : '';
}

export async function hashActorId(actorId) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(actorId));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function sessionCookie(request, value, maxAge = SESSION_MAX_AGE) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearSessionCookie(request) {
  return sessionCookie(request, '', 0);
}

export async function integrationActor(request, env, { allowCreate = false } = {}) {
  if (clerkConfigured(env)) {
    const result = await authenticate(request, env, { required: true });
    return {
      actorKey: await hashActorId(`clerk:${result.auth.userId}`),
      setCookie: '',
      mode: 'clerk',
    };
  }

  if (String(env.MERIDIAN_GTM_TEST_MODE || '').toLowerCase() !== 'true') {
    throw new HttpError(503, 'GTM integration authentication is not configured.');
  }
  if (!env.OAUTH_SESSION_SECRET || String(env.OAUTH_SESSION_SECRET).length < 32) {
    throw new HttpError(503, 'OAUTH_SESSION_SECRET must contain at least 32 characters.');
  }

  let sessionId = await verifySession(env.OAUTH_SESSION_SECRET, cookieValue(request, SESSION_COOKIE));
  let setCookie = '';
  if (!sessionId && allowCreate) {
    sessionId = crypto.randomUUID();
    setCookie = sessionCookie(request, await signSession(env.OAUTH_SESSION_SECRET, sessionId));
  }
  if (!sessionId) throw new HttpError(401, 'The local integration session is missing or invalid.');

  return {
    actorKey: await hashActorId(`local:${sessionId}`),
    setCookie,
    mode: 'local_test',
  };
}

export function assertSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) {
    throw new HttpError(403, 'A same-origin request is required.');
  }
}

export function appendSetCookie(response, value) {
  if (value) response.headers.append('Set-Cookie', value);
  return response;
}
