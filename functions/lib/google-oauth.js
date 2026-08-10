import { HttpError } from './http.js';

export const GTM_EDIT_SCOPE = 'https://www.googleapis.com/auth/tagmanager.edit.containers';
export const GTM_VERSION_SCOPE = 'https://www.googleapis.com/auth/tagmanager.edit.containerversions';
export const GTM_REQUIRED_SCOPES = Object.freeze([GTM_EDIT_SCOPE, GTM_VERSION_SCOPE]);
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

function encodeBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function decodeBase64Url(value) {
  const normalized = String(value || '').replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function requireOAuthConfig(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_OAUTH_REDIRECT_URI) {
    throw new HttpError(503, 'Google OAuth client configuration is incomplete.');
  }
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
  };
}

async function encryptionKey(env) {
  if (!env.OAUTH_TOKEN_ENCRYPTION_KEY) {
    throw new HttpError(503, 'OAUTH_TOKEN_ENCRYPTION_KEY is not configured.');
  }
  let raw;
  try {
    raw = decodeBase64Url(env.OAUTH_TOKEN_ENCRYPTION_KEY);
  } catch {
    throw new HttpError(503, 'OAUTH_TOKEN_ENCRYPTION_KEY must be base64url encoded.');
  }
  if (raw.byteLength !== 32) {
    throw new HttpError(503, 'OAUTH_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export function randomUrlToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

export async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return encodeBase64Url(new Uint8Array(digest));
}

export async function encryptSecret(env, value) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(env),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `v1.${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(env, envelope) {
  const [version, encodedIv, encodedCiphertext] = String(envelope || '').split('.');
  if (version !== 'v1' || !encodedIv || !encodedCiphertext) {
    throw new HttpError(500, 'Stored OAuth credentials use an unsupported format.');
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decodeBase64Url(encodedIv) },
      await encryptionKey(env),
      decodeBase64Url(encodedCiphertext),
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new HttpError(500, 'Stored OAuth credentials could not be decrypted.');
  }
}

export function googleAuthorizationUrl(env, { state, codeChallenge, loginHint = '' }) {
  const config = requireOAuthConfig(env);
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GTM_REQUIRED_SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (loginHint) url.searchParams.set('login_hint', loginHint);
  return url;
}

async function parseGoogleResponse(response, operation) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body.error_description || body.error?.message || body.error || `HTTP ${response.status}`;
    throw new HttpError(502, `Google ${operation} failed: ${String(detail).slice(0, 240)}`);
  }
  return body;
}

export async function exchangeAuthorizationCode(env, { code, codeVerifier }, fetcher = fetch) {
  const config = requireOAuthConfig(env);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
  });
  const response = await fetcher(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const token = await parseGoogleResponse(response, 'token exchange');
  if (!token.access_token) throw new HttpError(502, 'Google did not return an access token.');
  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token || '',
    expires_at: Date.now() + Number(token.expires_in || 3600) * 1000,
    scope: token.scope || GTM_REQUIRED_SCOPES.join(' '),
    token_type: token.token_type || 'Bearer',
  };
}

export async function refreshAccessToken(env, refreshToken, currentScope = '', fetcher = fetch) {
  const config = requireOAuthConfig(env);
  const response = await fetcher(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const token = await parseGoogleResponse(response, 'token refresh');
  if (!token.access_token) throw new HttpError(502, 'Google did not return a refreshed access token.');
  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token || refreshToken,
    expires_at: Date.now() + Number(token.expires_in || 3600) * 1000,
    scope: token.scope || currentScope || GTM_REQUIRED_SCOPES.join(' '),
    token_type: token.token_type || 'Bearer',
  };
}

export async function revokeGoogleToken(token, fetcher = fetch) {
  if (!token) return false;
  const response = await fetcher(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  });
  return response.ok;
}
