import { createHash } from 'node:crypto';
import starter from '../gtm/meridian-consent-starter-container.json' with { type: 'json' };
import {
  applyApprovalManifest,
  createApprovalManifest,
  fingerprint,
  parseContainerExport,
  scanContainer,
} from '../classifier/index.js';
import { policyManifest } from '../policy/index.js';

const COLLECTIONS = Object.freeze([
  ['variable', 'variableId'],
  ['trigger', 'triggerId'],
]);
const EVENT_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

function clone(value) {
  return structuredClone(value);
}

function maxNumericId(items, key) {
  return items.reduce((max, item) => {
    const value = Number(item[key]);
    return Number.isSafeInteger(value) ? Math.max(max, value) : max;
  }, 0);
}

function normalizedResource(resource, idKey, id, target) {
  const copy = clone(resource);
  copy[idKey] = String(id);
  if ('accountId' in copy) copy.accountId = target.accountId;
  if ('containerId' in copy) copy.containerId = target.containerId;
  return copy;
}

export function mergeStarterContainer(exported, options = {}) {
  const output = clone(exported);
  const target = parseContainerExport(output).container;
  const source = parseContainerExport(options.starter || starter).container;
  const additions = [];
  const reused = [];
  const conflicts = [];

  for (const [collection, idKey] of COLLECTIONS) {
    target[collection] ||= [];
    const byName = new Map(target[collection].map((item) => [item.name, item]));
    let nextId = maxNumericId(target[collection], idKey) + 1;
    for (const sourceItem of source[collection] || []) {
      const existing = byName.get(sourceItem.name);
      if (existing) {
        const comparableExisting = clone(existing);
        const comparableSource = normalizedResource(sourceItem, idKey, existing[idKey], target);
        if (fingerprint(comparableExisting) === fingerprint(comparableSource)) {
          reused.push({ collection, name: existing.name, id: String(existing[idKey]) });
        } else {
          conflicts.push({ collection, name: existing.name, id: String(existing[idKey]), reason: 'name_exists_with_different_definition' });
        }
        continue;
      }
      const added = normalizedResource(sourceItem, idKey, nextId, target);
      nextId += 1;
      target[collection].push(added);
      byName.set(added.name, added);
      additions.push({ collection, name: added.name, id: String(added[idKey]) });
    }
  }

  return { container: output, additions, reused, conflicts };
}

function triggerEvent(trigger) {
  if (!trigger) return { event_name: 'unverified_trigger', confidence: 'unverified' };
  if (['PAGEVIEW', 'DOM_READY', 'WINDOW_LOADED'].includes(trigger.type)) {
    return { event_name: trigger.type === 'PAGEVIEW' ? 'page_view' : trigger.type.toLowerCase(), confidence: 'exact' };
  }
  if (trigger.type === 'CUSTOM_EVENT') {
    const values = (trigger.customEventFilter || []).flatMap((filter) => filter.parameter || [])
      .filter((item) => item.key === 'arg1' && typeof item.value === 'string')
      .map((item) => item.value);
    const exact = values.find((value) => /^[a-z][a-z0-9_]{0,63}$/.test(value));
    if (exact) return { event_name: exact, confidence: 'exact' };
    const inferred = String(trigger.name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return EVENT_PATTERN.test(inferred)
      ? { event_name: inferred, confidence: 'estimated' }
      : { event_name: 'custom_event', confidence: 'estimated' };
  }
  return { event_name: String(trigger.type || 'unverified_trigger').toLowerCase(), confidence: 'estimated' };
}

function deniedOutcome(tag) {
  if (tag.enforcement === 'additional') return 'blocked';
  if (tag.enforcement === 'essential') return 'observed';
  if (tag.enforcement === 'built_in' && tag.required_consent.includes('analytics_storage')) return 'modeled_signal';
  if (tag.enforcement === 'built_in') return 'limited_signal';
  return 'unverified';
}

export function createImpactManifest(exported, report = scanContainer(exported)) {
  const { container } = parseContainerExport(exported);
  const triggerById = new Map((container.trigger || []).map((item) => [String(item.triggerId), item]));
  const rules = [];
  for (const tag of report.tags) {
    const triggerIds = tag.dependencies?.firing_triggers?.map((item) => item.trigger_id) || [];
    if (!triggerIds.length) {
      rules.push({
        event_name: 'unverified_trigger',
        trigger_id: null,
        trigger_name: null,
        trigger_confidence: 'unverified',
        tag_id: tag.tag_id,
        tag_name: tag.tag_name,
        provider_id: tag.provider_id,
        measurement_class: tag.purposes[0] || 'unknown',
        consent_required: tag.required_consent,
        outcome_when_denied: deniedOutcome(tag),
      });
      continue;
    }
    for (const triggerId of triggerIds) {
      const trigger = triggerById.get(String(triggerId));
      const event = triggerEvent(trigger);
      rules.push({
        event_name: event.event_name,
        trigger_confidence: event.confidence,
        trigger_id: String(triggerId),
        trigger_name: trigger?.name || null,
        tag_id: tag.tag_id,
        tag_name: tag.tag_name,
        provider_id: tag.provider_id,
        measurement_class: tag.purposes[0] || 'unknown',
        consent_required: tag.required_consent,
        outcome_when_denied: deniedOutcome(tag),
      });
    }
  }
  return {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    container_fingerprint: report.source.fingerprint,
    tracked_events: [...new Set(rules.filter((rule) => rule.trigger_confidence === 'exact').map((rule) => rule.event_name))].sort(),
    rules,
    counting_unit: 'measurement_opportunity',
    identity_warning: 'Do not interpret affected opportunities as unique users or deterministic sessions.',
  };
}

export function createDisclosureInventory(report, registry) {
  const providerById = new Map((registry.providers || []).map((item) => [item.id, item]));
  return report.tags.map((tag) => {
    const provider = providerById.get(tag.provider_id);
    return {
      tag_id: tag.tag_id,
      tag_name: tag.tag_name,
      provider: tag.provider,
      product: tag.product,
      purposes: tag.purposes.join('|'),
      consent_category: tag.required_consent.join('|'),
      destination_domains: (provider?.match?.hostnames || []).join('|'),
      known_cookies: (provider?.cookies || []).join('|'),
      retention: provider?.retention || '',
      disclosure_status: tag.status === 'recommended' ? 'review' : 'needs_review',
    };
  });
}

export function validateMigration({ source, transformed, report, manifest, merge }) {
  const original = parseContainerExport(source).container;
  const output = parseContainerExport(transformed).container;
  const outputById = new Map((output.tag || []).map((tag) => [String(tag.tagId), tag]));
  const findings = [];
  const approved = new Map((manifest.decisions || []).map((item) => [String(item.tag_id), item]));

  for (const originalTag of original.tag || []) {
    const id = String(originalTag.tagId);
    const next = outputById.get(id);
    if (!next) {
      findings.push({ severity: 'error', code: 'tag_deleted', tag_id: id, message: `${originalTag.name} was deleted.` });
      continue;
    }
    for (const key of ['firingTriggerId', 'blockingTriggerId', 'setupTag', 'teardownTag']) {
      if (JSON.stringify(originalTag[key] || []) !== JSON.stringify(next[key] || [])) {
        findings.push({ severity: 'error', code: 'dependency_changed', tag_id: id, message: `${originalTag.name} changed ${key}.` });
      }
    }
    const decision = approved.get(id);
    if (decision?.decision === 'approve' && decision.enforcement === 'additional' && next.consentSettings?.consentStatus !== 'NEEDED') {
      findings.push({ severity: 'error', code: 'consent_not_applied', tag_id: id, message: `${originalTag.name} is missing approved additional consent.` });
    }
    if (decision?.enforcement === 'built_in' && next.consentSettings?.consentStatus === 'NEEDED') {
      findings.push({ severity: 'error', code: 'google_tag_hard_blocked', tag_id: id, message: `${originalTag.name} has an added hard consent gate.` });
    }
  }
  for (const tag of report.tags.filter((item) => !item.paused && ['unresolved', 'conflict'].includes(item.status))) {
    const decision = approved.get(tag.tag_id);
    findings.push({
      severity: decision?.decision === 'skip' ? 'warning' : 'error',
      code: 'active_tag_unresolved',
      tag_id: tag.tag_id,
      message: `${tag.tag_name} remains unresolved${decision?.decision === 'skip' ? ' and was explicitly skipped' : ''}.`,
    });
  }
  for (const conflict of merge.conflicts || []) {
    findings.push({ severity: 'error', code: 'starter_merge_conflict', message: `${conflict.collection} ${conflict.name} already exists with a different definition.` });
  }
  return {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    valid: !findings.some((item) => item.severity === 'error'),
    summary: {
      errors: findings.filter((item) => item.severity === 'error').length,
      warnings: findings.filter((item) => item.severity === 'warning').length,
      tags_preserved: (original.tag || []).length,
      starter_components_added: merge.additions?.length || 0,
      starter_components_reused: merge.reused?.length || 0,
    },
    findings,
  };
}

export function containerDiff(source, transformed, changes, merge) {
  const before = parseContainerExport(source).container;
  const after = parseContainerExport(transformed).container;
  return {
    schema_version: '1.0',
    source_fingerprint: fingerprint(source),
    output_fingerprint: fingerprint(transformed),
    counts_before: Object.fromEntries(COLLECTIONS.concat([['tag', 'tagId']]).map(([key]) => [key, (before[key] || []).length])),
    counts_after: Object.fromEntries(COLLECTIONS.concat([['tag', 'tagId']]).map(([key]) => [key, (after[key] || []).length])),
    tag_consent_changes: changes,
    starter_additions: merge.additions,
    starter_reused: merge.reused,
    conflicts: merge.conflicts,
    guarantees: {
      source_overwritten: false,
      tags_deleted: false,
      firing_triggers_changed: false,
      published_to_gtm: false,
    },
  };
}

export function migrationPackage(exported, manifest, options = {}) {
  const registry = options.registry;
  const report = scanContainer(exported, options);
  const plan = manifest || createApprovalManifest(report);
  const pending = plan.decisions.filter((item) => item.decision === 'pending');
  const impact = createImpactManifest(exported, report);
  const policy = policyManifest(options.profile || 'strict-global');
  if (pending.length) return { status: 'review_required', report, plan, impact, policy, registry, pending };
  const applied = applyApprovalManifest(exported, plan);
  const merge = mergeStarterContainer(applied.container, options);
  const validation = validateMigration({ source: exported, transformed: merge.container, report, manifest: plan, merge });
  const diff = containerDiff(exported, merge.container, applied.changes, merge);
  return {
    status: validation.valid ? 'ready' : 'validation_failed',
    report,
    plan,
    impact,
    policy,
    registry,
    transformed: merge.container,
    merge,
    validation,
    diff,
  };
}

export function stableExportId(exported) {
  return createHash('sha256').update(fingerprint(exported)).digest('hex').slice(0, 12);
}
