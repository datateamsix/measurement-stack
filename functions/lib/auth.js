import { HttpError } from './http.js';

const CLERK_API_URL = 'https://api.clerk.com/v1';
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 5;

let jwksCache = { keys: [], expiresAt: 0 };

function authorizedParties(request, env) {
  const configured = String(env.CLERK_AUTHORIZED_PARTIES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return value.replace(/\/$/, '');
      }
    });
  return configured.length ? configured : [new URL(request.url).origin];
}

function sessionToken(request) {
  const authorization = request.headers.get('authorization') || '';
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return bearer;

  const cookie = request.headers.get('cookie') || '';
  for (const item of cookie.split(';')) {
    const [name, ...valueParts] = item.trim().split('=');
    if (name === '__session') return decodeURIComponent(valueParts.join('='));
  }
  return '';
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJsonSegment(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function clerkApi(env, path) {
  const response = await fetch(`${CLERK_API_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${env.CLERK_SECRET_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) throw new Error(`Clerk API returned ${response.status}.`);
  return response.json();
}

async function loadJwks(env, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && jwksCache.keys.length && jwksCache.expiresAt > now) return jwksCache.keys;

  const jwks = await clerkApi(env, '/jwks');
  if (!Array.isArray(jwks.keys)) throw new Error('Clerk JWKS response did not contain keys.');
  jwksCache = { keys: jwks.keys, expiresAt: now + JWKS_CACHE_TTL_MS };
  return jwksCache.keys;
}

async function signingKey(env, kid) {
  let keys = await loadJwks(env);
  let key = keys.find((candidate) => candidate.kid === kid && candidate.kty === 'RSA');
  if (!key) {
    keys = await loadJwks(env, true);
    key = keys.find((candidate) => candidate.kid === kid && candidate.kty === 'RSA');
  }
  if (!key) throw new Error('No matching Clerk signing key was found.');
  return crypto.subtle.importKey(
    'jwk',
    key,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}

async function verifySessionToken(token, request, env) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('The Clerk token is not a JWT.');

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJsonSegment(encodedHeader);
  const payload = decodeJsonSegment(encodedPayload);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unexpected Clerk token algorithm.');

  const key = await signingKey(env, header.kid);
  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    decodeBase64Url(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!verified) throw new Error('The Clerk token signature is invalid.');

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp < now - CLOCK_SKEW_SECONDS) {
    throw new Error('The Clerk token has expired.');
  }
  if (Number.isFinite(payload.nbf) && payload.nbf > now + CLOCK_SKEW_SECONDS) {
    throw new Error('The Clerk token is not active yet.');
  }
  if (Number.isFinite(payload.iat) && payload.iat > now + CLOCK_SKEW_SECONDS) {
    throw new Error('The Clerk token was issued in the future.');
  }
  if (payload.azp && !authorizedParties(request, env).includes(payload.azp.replace(/\/$/, ''))) {
    throw new Error('The Clerk token has an unauthorized party.');
  }
  if (payload.sts === 'pending') throw new Error('The Clerk session is pending.');
  if (!payload.sub || !payload.sid) throw new Error('The Clerk token is missing required claims.');

  return payload;
}

function normalizeExternalAccount(account = {}) {
  return {
    id: account.id || '',
    provider: account.provider || '',
    providerUserId: account.provider_user_id || account.providerUserId || '',
    username: account.username || '',
    emailAddress: account.email_address || account.emailAddress || '',
    verification: account.verification || null,
    approvedScopes: account.approved_scopes || account.approvedScopes || '',
    createdAt: account.created_at || account.createdAt || '',
  };
}

function normalizeUser(user) {
  return {
    id: user.id,
    firstName: user.first_name || '',
    lastName: user.last_name || '',
    primaryEmailAddressId: user.primary_email_address_id || '',
    emailAddresses: Array.isArray(user.email_addresses)
      ? user.email_addresses.map((email) => ({
          id: email.id,
          emailAddress: email.email_address || '',
          verification: email.verification || null,
        }))
      : [],
    externalAccounts: Array.isArray(user.external_accounts)
      ? user.external_accounts.map(normalizeExternalAccount)
      : [],
  };
}

async function fetchUser(env, userId) {
  const user = await clerkApi(env, `/users/${encodeURIComponent(userId)}`);
  return normalizeUser(user);
}

export function clerkConfigured(env) {
  return Boolean(env.CLERK_PUBLISHABLE_KEY && env.CLERK_SECRET_KEY);
}

export async function authenticate(request, env, { required = true, includeUser = false } = {}) {
  if (!clerkConfigured(env)) {
    if (required) throw new HttpError(503, 'Clerk authentication is not configured.');
    return { configured: false, isAuthenticated: false, auth: null, user: null };
  }

  const token = sessionToken(request);
  if (!token) {
    if (required) throw new HttpError(401, 'Authentication is required.');
    return { configured: true, isAuthenticated: false, auth: null, user: null };
  }

  try {
    const claims = await verifySessionToken(token, request, env);
    const auth = {
      userId: claims.sub,
      sessionId: claims.sid,
      orgId: claims.org_id || '',
      claims,
    };
    const user = includeUser ? await fetchUser(env, auth.userId) : null;
    return { configured: true, isAuthenticated: true, auth, user };
  } catch (error) {
    console.warn('Clerk authentication failed', { message: error.message });
    if (required) throw new HttpError(401, 'The authentication token could not be verified.');
    return { configured: true, isAuthenticated: false, auth: null, user: null };
  }
}
