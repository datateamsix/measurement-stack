import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  decryptSecret,
  encryptSecret,
  googleAuthorizationUrl,
  GTM_EDIT_SCOPE,
  pkceChallenge,
} from '../functions/lib/google-oauth.js';
import { gtmPaths, runGtmMutationTest } from '../functions/lib/gtm-api.js';
import { integrationActor } from '../functions/lib/integration-session.js';
import { saveConnection } from '../functions/lib/integration-store.js';
import { onRequestGet as authorize } from '../functions/api/integrations/google/authorize.js';
import { onRequestGet as callback } from '../functions/api/integrations/google/callback.js';
import { onRequestGet as accounts } from '../functions/api/integrations/gtm/accounts.js';
import { onRequestPost as testConnection } from '../functions/api/integrations/gtm/test/index.js';

const key = Buffer.alloc(32, 7).toString('base64url');
const envBase = {
  GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-secret',
  GOOGLE_OAUTH_REDIRECT_URI: 'http://127.0.0.1:3000/api/integrations/google/callback',
  OAUTH_SESSION_SECRET: 'test-session-secret-with-at-least-32-characters',
  OAUTH_TOKEN_ENCRYPTION_KEY: key,
  MERIDIAN_GTM_TEST_MODE: 'true',
};

class FakeD1 {
  constructor() {
    this.state = null;
    this.connection = null;
  }

  prepare(sql) {
    const database = this;
    return {
      bind(...values) {
        return {
          async run() {
            if (sql.includes('DELETE FROM meridian_oauth_states WHERE expires_at')) {
              return { success: true };
            }
            if (sql.includes('INSERT INTO meridian_oauth_states')) {
              database.state = {
                state_hash: values[0],
                actor_key: values[1],
                verifier_ciphertext: values[2],
                return_to: values[3],
              };
            } else if (sql.includes('INSERT INTO meridian_integrations')) {
              database.connection = {
                id: values[0],
                actor_key: values[1],
                provider: 'google_gtm',
                status: 'connected',
                granted_scope: values[2],
                token_ciphertext: values[3],
                created_at: values[4],
                updated_at: values[5],
                last_tested_at: null,
                last_error: null,
              };
            } else if (sql.includes('DELETE FROM meridian_integrations')) {
              database.connection = null;
            }
            return { success: true };
          },
          async first() {
            if (sql.includes('DELETE FROM meridian_oauth_states')) {
              const state = database.state;
              database.state = null;
              return state && state.actor_key === values[1]
                ? { verifier_ciphertext: state.verifier_ciphertext, return_to: state.return_to }
                : null;
            }
            if (sql.includes('FROM meridian_integrations')) {
              return database.connection?.actor_key === values[0] ? database.connection : null;
            }
            return null;
          },
        };
      },
    };
  }
}

function cookie(headers, name) {
  const source = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie().join(',')
    : headers.get('set-cookie') || '';
  return source.match(new RegExp(`${name}=([^;,]+)`, 'u'))?.[1] || '';
}

test('OAuth secrets use authenticated encryption and round-trip without plaintext storage', async () => {
  const encrypted = await encryptSecret(envBase, { refresh_token: 'refresh-secret' });
  assert.match(encrypted, /^v1\./u);
  assert.doesNotMatch(encrypted, /refresh-secret/u);
  assert.deepEqual(await decryptSecret(envBase, encrypted), { refresh_token: 'refresh-secret' });
});

test('Google authorization URL requests only the GTM edit scope with PKCE', async () => {
  const verifier = 'a'.repeat(64);
  const url = googleAuthorizationUrl(envBase, {
    state: 'state-value',
    codeChallenge: await pkceChallenge(verifier),
  });
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('scope'), GTM_EDIT_SCOPE);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('state'), 'state-value');
  assert.equal(url.searchParams.get('redirect_uri'), envBase.GOOGLE_OAUTH_REDIRECT_URI);
});

test('local integration sessions are signed and stable across requests', async () => {
  const first = await integrationActor(new Request('http://127.0.0.1:3000/api/test'), envBase, { allowCreate: true });
  assert.equal(first.mode, 'local_test');
  assert.match(first.setCookie, /HttpOnly; SameSite=Lax/u);
  const second = await integrationActor(new Request('http://127.0.0.1:3000/api/test', {
    headers: { Cookie: first.setCookie.split(';')[0] },
  }), envBase);
  assert.equal(second.actorKey, first.actorKey);
  assert.equal(second.setCookie, '');
});

test('GTM paths accept numeric IDs and reject path injection', () => {
  assert.deepEqual(gtmPaths({ accountId: '123', containerId: '456', workspaceId: '7' }), {
    account: 'accounts/123',
    container: 'accounts/123/containers/456',
    workspace: 'accounts/123/containers/456/workspaces/7',
  });
  assert.throws(() => gtmPaths({ accountId: '../accounts/1' }), /numeric GTM ID/u);
});

test('OAuth authorize, callback, encrypted persistence, and account listing work together', async () => {
  const database = new FakeD1();
  const env = { ...envBase, DB: database };
  const authorizeResponse = await authorize({
    request: new Request('http://127.0.0.1:3000/api/integrations/google/authorize'),
    env,
  });
  assert.equal(authorizeResponse.status, 302);
  const location = new URL(authorizeResponse.headers.get('location'));
  const session = cookie(authorizeResponse.headers, 'meridian_integration_session');
  const state = cookie(authorizeResponse.headers, 'meridian_google_oauth_state');
  assert.ok(session);
  assert.ok(state);
  assert.equal(location.searchParams.get('scope'), GTM_EDIT_SCOPE);
  assert.match(database.state.verifier_ciphertext, /^v1\./u);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
      return Response.json({
        access_token: 'access-secret',
        refresh_token: 'refresh-secret',
        expires_in: 3600,
        scope: GTM_EDIT_SCOPE,
        token_type: 'Bearer',
      });
    }
    if (String(url).startsWith('https://tagmanager.googleapis.com/tagmanager/v2/accounts')) {
      return Response.json({ account: [{ accountId: '123', name: 'Measurement Stack' }] });
    }
    throw new Error(`Unexpected test fetch: ${url}`);
  };
  try {
    const callbackResponse = await callback({
      request: new Request(`http://127.0.0.1:3000/api/integrations/google/callback?code=test-code&state=${encodeURIComponent(state)}`, {
        headers: { Cookie: `meridian_integration_session=${session}; meridian_google_oauth_state=${state}` },
      }),
      env,
    });
    assert.equal(callbackResponse.status, 302);
    assert.match(callbackResponse.headers.get('location'), /gtm_status=connected/u);
    assert.equal(database.connection.status, 'connected');
    assert.doesNotMatch(database.connection.token_ciphertext, /access-secret|refresh-secret/u);

    const accountResponse = await accounts({
      request: new Request('http://127.0.0.1:3000/api/integrations/gtm/accounts', {
        headers: { Cookie: `meridian_integration_session=${session}` },
      }),
      env,
    });
    assert.equal(accountResponse.status, 200);
    assert.deepEqual((await accountResponse.json()).accounts, [{ accountId: '123', name: 'Measurement Stack' }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GTM mutation endpoint is dry-run by default and exposes no publish capability', async () => {
  const database = new FakeD1();
  const env = { ...envBase, DB: database };
  const actor = await integrationActor(new Request('http://127.0.0.1:3000/api/test'), env, { allowCreate: true });
  const response = await testConnection({
    request: new Request('http://127.0.0.1:3000/api/integrations/gtm/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:3000',
        Cookie: actor.setCookie.split(';')[0],
      },
      body: JSON.stringify({ accountId: '123', containerId: '456' }),
    }),
    env,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.dryRun, true);
  assert.equal(body.publishAvailable, false);
  assert.equal(body.confirmationRequired, 'RUN MERIDIAN GTM TEST');
});

test('GTM mutation test creates, updates, and removes only temporary resources', async () => {
  const database = new FakeD1();
  const env = { ...envBase, DB: database };
  const actorKey = 'actor-test-key';
  await saveConnection(env, {
    actorKey,
    token: {
      access_token: 'access-secret',
      refresh_token: 'refresh-secret',
      expires_at: Date.now() + 3_600_000,
      scope: GTM_EDIT_SCOPE,
      token_type: 'Bearer',
    },
  });
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body || '' });
    if (String(url).endsWith('/accounts/123/containers/456/workspaces') && options.method === 'POST') {
      return Response.json({ path: 'accounts/123/containers/456/workspaces/9', workspaceId: '9' });
    }
    if (String(url).endsWith('/workspaces/9/tags') && options.method === 'POST') {
      return Response.json({
        path: 'accounts/123/containers/456/workspaces/9/tags/10',
        tagId: '10',
        fingerprint: 'tag-fingerprint',
        name: 'Meridian – API Connection Test',
        type: 'html',
        paused: true,
      });
    }
    if (String(url).includes('/workspaces/9/tags/10?fingerprint=') && options.method === 'PUT') {
      return Response.json({
        path: 'accounts/123/containers/456/workspaces/9/tags/10',
        tagId: '10',
        fingerprint: 'updated-fingerprint',
        name: 'Meridian – API Connection Test – Updated',
        type: 'html',
        paused: true,
      });
    }
    if (options.method === 'DELETE') return new Response(null, { status: 204 });
    throw new Error(`Unexpected mutation test fetch: ${url}`);
  };
  const result = await runGtmMutationTest(env, actorKey, { accountId: '123', containerId: '456' }, fetcher);
  assert.equal(result.ok, true);
  assert.equal(result.cleanupRequired, false);
  assert.deepEqual(calls.map((call) => call.method), ['POST', 'POST', 'PUT', 'DELETE', 'DELETE']);
  assert.match(calls[1].body, /"paused":true/u);
  assert.doesNotMatch(calls[1].body, /firingTriggerId/u);
  assert.deepEqual(result.blockedByApplication, [
    'container version creation',
    'approval',
    'publishing',
    'container deletion',
    'user management',
  ]);
});

test('D1 migration and backend source preserve least privilege', async () => {
  const migration = await readFile(new URL('../migrations/0004_gtm_oauth.sql', import.meta.url), 'utf8');
  const api = await readFile(new URL('../functions/lib/gtm-api.js', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS meridian_oauth_states/u);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS meridian_integrations/u);
  assert.doesNotMatch(api, /create_version|:publish|containerversions/u);
});
