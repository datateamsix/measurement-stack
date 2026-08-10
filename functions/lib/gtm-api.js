import { HttpError } from './http.js';
import { GTM_EDIT_SCOPE, GTM_VERSION_SCOPE, refreshAccessToken } from './google-oauth.js';
import { connectedToken, updateConnectedToken } from './integration-store.js';

const GTM_API = 'https://tagmanager.googleapis.com/tagmanager/v2';
const ID_PATTERN = /^\d+$/u;

function id(value, label) {
  const normalized = String(value || '').trim();
  if (!ID_PATTERN.test(normalized)) throw new HttpError(400, `${label} must be a numeric GTM ID.`);
  return normalized;
}

async function responseBody(response) {
  if (response.status === 204) return {};
  return response.json().catch(() => ({}));
}

async function gtmFetch(path, token, options = {}, fetcher = fetch) {
  const response = await fetcher(`${GTM_API}/${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
      Authorization: `Bearer ${token.access_token}`,
    },
  });
  const body = await responseBody(response);
  if (!response.ok) {
    const detail = body.error?.message || `HTTP ${response.status}`;
    const status = response.status === 401 ? 401 : response.status === 403 ? 403 : 502;
    throw new HttpError(status, `Google Tag Manager API failed: ${String(detail).slice(0, 240)}`);
  }
  return body;
}

export async function authorizedGtmRequest(env, actorKey, path, options = {}, fetcher = fetch) {
  const { token: storedToken } = await connectedToken(env, actorKey);
  let token = storedToken;
  if (Number(token.expires_at || 0) <= Date.now() + 60_000) {
    if (!token.refresh_token) throw new HttpError(401, 'The Google connection expired and has no refresh token. Reconnect GTM.');
    token = await refreshAccessToken(env, token.refresh_token, token.scope, fetcher);
    await updateConnectedToken(env, actorKey, token);
  }
  return gtmFetch(path, token, options, fetcher);
}

export async function requireGrantedScope(env, actorKey, scope) {
  const { record } = await connectedToken(env, actorKey);
  const scopes = new Set(String(record.granted_scope || '').split(/\s+/u).filter(Boolean));
  if (!scopes.has(scope)) {
    throw new HttpError(403, 'Reconnect Google Tag Manager to grant unpublished container-version access.');
  }
}

async function paginated(env, actorKey, path, property, fetcher = fetch) {
  const values = [];
  let pageToken = '';
  do {
    const suffix = pageToken ? `${path.includes('?') ? '&' : '?'}pageToken=${encodeURIComponent(pageToken)}` : '';
    const body = await authorizedGtmRequest(env, actorKey, `${path}${suffix}`, {}, fetcher);
    if (Array.isArray(body[property])) values.push(...body[property]);
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return values;
}

export function gtmPaths({ accountId, containerId = '', workspaceId = '' }) {
  const account = `accounts/${id(accountId, 'accountId')}`;
  const container = containerId ? `${account}/containers/${id(containerId, 'containerId')}` : '';
  const workspace = workspaceId ? `${container}/workspaces/${id(workspaceId, 'workspaceId')}` : '';
  return { account, container, workspace };
}

export function listAccounts(env, actorKey, fetcher = fetch) {
  return paginated(env, actorKey, 'accounts', 'account', fetcher);
}

export function listContainers(env, actorKey, accountId, fetcher = fetch) {
  const { account } = gtmPaths({ accountId });
  return paginated(env, actorKey, `${account}/containers`, 'container', fetcher);
}

export function listWorkspaces(env, actorKey, accountId, containerId, fetcher = fetch) {
  const { container } = gtmPaths({ accountId, containerId });
  return paginated(env, actorKey, `${container}/workspaces`, 'workspace', fetcher);
}

export function createWorkspace(env, actorKey, ids, input, fetcher = fetch) {
  const { container } = gtmPaths(ids);
  const name = String(input?.name || '').trim().slice(0, 160);
  if (!name) throw new HttpError(400, 'Workspace name is required.');
  return authorizedGtmRequest(env, actorKey, `${container}/workspaces`, {
    method: 'POST',
    body: JSON.stringify({
      name,
      description: String(input?.description || 'Meridian-managed consent configuration workspace.').trim().slice(0, 500),
    }),
  }, fetcher);
}

export async function listWorkspaceResources(env, actorKey, ids, fetcher = fetch) {
  const { workspace } = gtmPaths(ids);
  const [tags, triggers, variables] = await Promise.all([
    paginated(env, actorKey, `${workspace}/tags`, 'tag', fetcher),
    paginated(env, actorKey, `${workspace}/triggers`, 'trigger', fetcher),
    paginated(env, actorKey, `${workspace}/variables`, 'variable', fetcher),
  ]);
  return { tags, triggers, variables };
}

export async function syncWorkspace(env, actorKey, ids, fetcher = fetch) {
  const { workspace } = gtmPaths(ids);
  const result = await authorizedGtmRequest(env, actorKey, `${workspace}:sync`, {
    method: 'POST',
    body: JSON.stringify({}),
  }, fetcher);
  if (result.compilerError) {
    throw new HttpError(409, 'GTM reports compiler errors in the selected workspace. Resolve them before continuing.');
  }
  const conflicts = Array.isArray(result.mergeConflict) ? result.mergeConflict : [];
  if (conflicts.length) {
    throw new HttpError(409, `GTM reports ${conflicts.length} workspace merge conflict(s). Resolve them in GTM and reassess before continuing.`);
  }
  return result;
}

export async function updateWorkspaceTag(env, actorKey, tag, fetcher = fetch) {
  if (!tag?.path || !tag?.fingerprint) throw new HttpError(409, 'The GTM tag is missing its path or fingerprint. Reload the assessment.');
  return authorizedGtmRequest(
    env,
    actorKey,
    `${tag.path}?fingerprint=${encodeURIComponent(tag.fingerprint)}`,
    { method: 'PUT', body: JSON.stringify(tag) },
    fetcher,
  );
}

export async function createUnpublishedVersion(env, actorKey, ids, input = {}, fetcher = fetch) {
  await requireGrantedScope(env, actorKey, GTM_VERSION_SCOPE);
  const { workspace } = gtmPaths(ids);
  const name = String(input.name || '').trim().slice(0, 160);
  if (!name) throw new HttpError(400, 'Version name is required.');
  const result = await authorizedGtmRequest(env, actorKey, `${workspace}:create_version`, {
    method: 'POST',
    body: JSON.stringify({
      name,
      notes: String(input.notes || 'Created by Meridian after GTM consent compliance validation. Not published.').trim().slice(0, 1000),
    }),
  }, fetcher);
  if (result.compilerError) throw new HttpError(409, 'GTM could not create the version because the workspace has compiler errors.');
  return result;
}

export async function runGtmMutationTest(env, actorKey, ids, fetcher = fetch) {
  const { container } = gtmPaths(ids);
  const stamp = new Date().toISOString().replace(/[.:]/gu, '-');
  let workspace = null;
  let tag = null;
  const evidence = [];
  try {
    workspace = await authorizedGtmRequest(env, actorKey, `${container}/workspaces`, {
      method: 'POST',
      body: JSON.stringify({
        name: `Meridian Integration Test ${stamp}`,
        description: 'Temporary workspace created by Meridian to verify create, edit, and delete access. Never published.',
      }),
    }, fetcher);
    evidence.push({ action: 'workspace.create', ok: true, path: workspace.path });

    tag = await authorizedGtmRequest(env, actorKey, `${workspace.path}/tags`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Meridian – API Connection Test',
        type: 'html',
        paused: true,
        parameter: [{
          key: 'html',
          type: 'template',
          value: '<!-- Meridian GTM API connection test. No scripts or network requests. -->',
        }],
      }),
    }, fetcher);
    evidence.push({ action: 'tag.create_paused', ok: true, path: tag.path, firingTriggers: 0 });

    tag = await authorizedGtmRequest(
      env,
      actorKey,
      `${tag.path}?fingerprint=${encodeURIComponent(tag.fingerprint || '')}`,
      {
        method: 'PUT',
        body: JSON.stringify({ ...tag, name: 'Meridian – API Connection Test – Updated', paused: true }),
      },
      fetcher,
    );
    evidence.push({ action: 'tag.update', ok: true, path: tag.path });

    await authorizedGtmRequest(env, actorKey, tag.path, { method: 'DELETE' }, fetcher);
    evidence.push({ action: 'tag.delete', ok: true, path: tag.path });
    tag = null;

    await authorizedGtmRequest(env, actorKey, workspace.path, { method: 'DELETE' }, fetcher);
    evidence.push({ action: 'workspace.delete', ok: true, path: workspace.path });
    workspace = null;

    return {
      ok: true,
      scope: GTM_EDIT_SCOPE,
      evidence,
      blockedByApplication: ['approval', 'publishing', 'container deletion', 'user management'],
      cleanupRequired: false,
    };
  } catch (error) {
    if (tag?.path) {
      try {
        await authorizedGtmRequest(env, actorKey, tag.path, { method: 'DELETE' }, fetcher);
        evidence.push({ action: 'tag.cleanup', ok: true, path: tag.path });
        tag = null;
      } catch (cleanupError) {
        evidence.push({ action: 'tag.cleanup', ok: false, path: tag.path, error: cleanupError.message });
      }
    }
    if (workspace?.path) {
      try {
        await authorizedGtmRequest(env, actorKey, workspace.path, { method: 'DELETE' }, fetcher);
        evidence.push({ action: 'workspace.cleanup', ok: true, path: workspace.path });
        workspace = null;
      } catch (cleanupError) {
        evidence.push({ action: 'workspace.cleanup', ok: false, path: workspace.path, error: cleanupError.message });
      }
    }
    error.testEvidence = evidence;
    error.cleanupRequired = Boolean(tag || workspace);
    throw error;
  }
}
