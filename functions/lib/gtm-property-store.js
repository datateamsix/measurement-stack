import { HttpError } from './http.js';

const PROPERTY_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{1,79}$/u;

function database(env) {
  const db = env.MEASUREMENT_STACK_DB || env.DB;
  if (!db) throw new HttpError(503, 'D1 is required for GTM property bindings.');
  return db;
}

export function propertyKey(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!PROPERTY_KEY_PATTERN.test(normalized)) throw new HttpError(400, 'propertyKey is invalid.');
  return normalized;
}

function numericId(value, label) {
  const normalized = String(value || '').trim();
  if (!/^\d+$/u.test(normalized)) throw new HttpError(400, `${label} must be a numeric GTM ID.`);
  return normalized;
}

function display(value, max = 160) {
  return String(value || '').trim().slice(0, max);
}

export async function propertyBinding(env, actorKey, key) {
  return database(env).prepare(`
    SELECT property_key, property_name, property_domain, account_id, account_name,
      container_id, container_name, container_public_id, workspace_id, workspace_name,
      created_at, updated_at
    FROM meridian_gtm_property_bindings
    WHERE actor_key = ? AND property_key = ?
  `).bind(actorKey, propertyKey(key)).first();
}

export async function requirePropertyBinding(env, actorKey, key) {
  const binding = await propertyBinding(env, actorKey, key);
  if (!binding) throw new HttpError(409, 'Select and save a GTM container and workspace for this property first.');
  return binding;
}

export async function savePropertyBinding(env, actorKey, input) {
  const key = propertyKey(input.propertyKey);
  const previous = await propertyBinding(env, actorKey, key);
  const now = new Date().toISOString();
  const values = {
    propertyKey: key,
    propertyName: display(input.propertyName) || key,
    propertyDomain: display(input.propertyDomain) || key,
    accountId: numericId(input.accountId, 'accountId'),
    accountName: display(input.accountName),
    containerId: numericId(input.containerId, 'containerId'),
    containerName: display(input.containerName),
    containerPublicId: display(input.containerPublicId, 80),
    workspaceId: numericId(input.workspaceId, 'workspaceId'),
    workspaceName: display(input.workspaceName),
  };
  await database(env).prepare(`
    INSERT INTO meridian_gtm_property_bindings (
      actor_key, property_key, property_name, property_domain, account_id, account_name,
      container_id, container_name, container_public_id, workspace_id, workspace_name,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(actor_key, property_key) DO UPDATE SET
      property_name = excluded.property_name,
      property_domain = excluded.property_domain,
      account_id = excluded.account_id,
      account_name = excluded.account_name,
      container_id = excluded.container_id,
      container_name = excluded.container_name,
      container_public_id = excluded.container_public_id,
      workspace_id = excluded.workspace_id,
      workspace_name = excluded.workspace_name,
      updated_at = excluded.updated_at
  `).bind(
    actorKey,
    values.propertyKey,
    values.propertyName,
    values.propertyDomain,
    values.accountId,
    values.accountName || null,
    values.containerId,
    values.containerName || null,
    values.containerPublicId || null,
    values.workspaceId,
    values.workspaceName || null,
    now,
    now,
  ).run();
  if (previous && (
    String(previous.account_id) !== values.accountId
    || String(previous.container_id) !== values.containerId
    || String(previous.workspace_id) !== values.workspaceId
  )) {
    await database(env).prepare(`
      DELETE FROM meridian_gtm_tag_decisions WHERE actor_key = ? AND property_key = ?
    `).bind(actorKey, key).run();
  }
  return propertyBinding(env, actorKey, key);
}

export async function tagDecisions(env, actorKey, key) {
  const result = await database(env).prepare(`
    SELECT tag_id, tag_fingerprint, provider_name, purposes_json, consent_types_json,
      enforcement, note, created_at, updated_at
    FROM meridian_gtm_tag_decisions
    WHERE actor_key = ? AND property_key = ?
  `).bind(actorKey, propertyKey(key)).all();
  return (result.results || []).map((row) => ({
    ...row,
    purposes: JSON.parse(row.purposes_json || '[]'),
    consent_types: JSON.parse(row.consent_types_json || '[]'),
  }));
}

export async function saveTagDecision(env, actorKey, input) {
  const key = propertyKey(input.propertyKey);
  const now = new Date().toISOString();
  const tagId = numericId(input.tagId, 'tagId');
  const fingerprint = display(input.tagFingerprint, 240);
  const providerName = display(input.providerName) || 'User-defined provider';
  const purposes = Array.isArray(input.purposes) ? input.purposes.map((value) => display(value, 80)).filter(Boolean) : [];
  const consentTypes = Array.isArray(input.consentTypes) ? input.consentTypes : [];
  const enforcement = String(input.enforcement || 'additional');
  if (!fingerprint) throw new HttpError(400, 'tagFingerprint is required.');
  if (!['additional', 'built_in', 'essential'].includes(enforcement)) throw new HttpError(400, 'enforcement is invalid.');
  await database(env).prepare(`
    INSERT INTO meridian_gtm_tag_decisions (
      actor_key, property_key, tag_id, tag_fingerprint, provider_name, purposes_json,
      consent_types_json, enforcement, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(actor_key, property_key, tag_id) DO UPDATE SET
      tag_fingerprint = excluded.tag_fingerprint,
      provider_name = excluded.provider_name,
      purposes_json = excluded.purposes_json,
      consent_types_json = excluded.consent_types_json,
      enforcement = excluded.enforcement,
      note = excluded.note,
      updated_at = excluded.updated_at
  `).bind(
    actorKey,
    key,
    tagId,
    fingerprint,
    providerName,
    JSON.stringify(purposes),
    JSON.stringify(consentTypes),
    enforcement,
    display(input.note, 500) || null,
    now,
    now,
  ).run();
}

export async function recordVersionExport(env, actorKey, binding, result) {
  const version = result?.containerVersion || {};
  const now = new Date().toISOString();
  await database(env).prepare(`
    INSERT INTO meridian_gtm_version_exports (
      id, actor_key, property_key, account_id, container_id, source_workspace_id,
      container_version_id, version_name, unpublished, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).bind(
    crypto.randomUUID(),
    actorKey,
    binding.property_key,
    binding.account_id,
    binding.container_id,
    binding.workspace_id,
    String(version.containerVersionId || ''),
    String(version.name || '').slice(0, 160) || null,
    now,
  ).run();
}
