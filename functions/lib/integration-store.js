import { HttpError } from './http.js';
import { decryptSecret, encryptSecret } from './google-oauth.js';

function database(env) {
  const db = env.MEASUREMENT_STACK_DB || env.DB;
  if (!db) throw new HttpError(503, 'D1 is required for GTM OAuth testing.');
  return db;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function saveOAuthState(env, { state, actorKey, codeVerifier, returnTo }) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
  await database(env).prepare(`
    DELETE FROM meridian_oauth_states WHERE expires_at <= ?
  `).bind(now.toISOString()).run();
  await database(env).prepare(`
    INSERT INTO meridian_oauth_states (
      state_hash, actor_key, provider, verifier_ciphertext, return_to, created_at, expires_at
    ) VALUES (?, ?, 'google_gtm', ?, ?, ?, ?)
  `).bind(
    await sha256(state),
    actorKey,
    await encryptSecret(env, { codeVerifier }),
    returnTo,
    now.toISOString(),
    expiresAt.toISOString(),
  ).run();
}

export async function consumeOAuthState(env, { state, actorKey }) {
  const result = await database(env).prepare(`
    DELETE FROM meridian_oauth_states
    WHERE state_hash = ? AND actor_key = ? AND provider = 'google_gtm' AND expires_at > ?
    RETURNING verifier_ciphertext, return_to
  `).bind(await sha256(state), actorKey, new Date().toISOString()).first();
  if (!result) throw new HttpError(400, 'The OAuth state is invalid, expired, or already used.');
  const verifier = await decryptSecret(env, result.verifier_ciphertext);
  return { codeVerifier: verifier.codeVerifier, returnTo: result.return_to };
}

export async function saveConnection(env, { actorKey, token }) {
  const now = new Date().toISOString();
  await database(env).prepare(`
    INSERT INTO meridian_integrations (
      id, actor_key, provider, status, granted_scope, token_ciphertext, created_at, updated_at
    ) VALUES (?, ?, 'google_gtm', 'connected', ?, ?, ?, ?)
    ON CONFLICT(actor_key, provider) DO UPDATE SET
      status = 'connected',
      granted_scope = excluded.granted_scope,
      token_ciphertext = excluded.token_ciphertext,
      updated_at = excluded.updated_at,
      last_error = NULL
  `).bind(
    crypto.randomUUID(),
    actorKey,
    token.scope || '',
    await encryptSecret(env, token),
    now,
    now,
  ).run();
}

export async function connectionRecord(env, actorKey) {
  return database(env).prepare(`
    SELECT id, provider, status, granted_scope, token_ciphertext, created_at, updated_at,
      last_tested_at, last_error
    FROM meridian_integrations
    WHERE actor_key = ? AND provider = 'google_gtm'
  `).bind(actorKey).first();
}

export async function connectedToken(env, actorKey) {
  const record = await connectionRecord(env, actorKey);
  if (!record || record.status !== 'connected' || !record.token_ciphertext) {
    throw new HttpError(401, 'Google Tag Manager is not connected.');
  }
  return { record, token: await decryptSecret(env, record.token_ciphertext) };
}

export async function updateConnectedToken(env, actorKey, token) {
  await database(env).prepare(`
    UPDATE meridian_integrations
    SET token_ciphertext = ?, granted_scope = ?, status = 'connected', updated_at = ?, last_error = NULL
    WHERE actor_key = ? AND provider = 'google_gtm'
  `).bind(
    await encryptSecret(env, token),
    token.scope || '',
    new Date().toISOString(),
    actorKey,
  ).run();
}

export async function markConnectionTest(env, actorKey, { ok, error = '' }) {
  await database(env).prepare(`
    UPDATE meridian_integrations
    SET last_tested_at = ?, last_error = ?, updated_at = ?
    WHERE actor_key = ? AND provider = 'google_gtm'
  `).bind(
    new Date().toISOString(),
    String(error || '').slice(0, 500) || null,
    new Date().toISOString(),
    actorKey,
  ).run();
}

export async function deleteConnection(env, actorKey) {
  await database(env).prepare(`
    DELETE FROM meridian_integrations WHERE actor_key = ? AND provider = 'google_gtm'
  `).bind(actorKey).run();
}
