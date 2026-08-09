import { createHash } from 'node:crypto';
import registry from './providers.v1.json' with { type: 'json' };

export const CONSENT_TYPES = Object.freeze([...registry.consent_types]);
export const DEFAULT_REGISTRY = registry;

const SIGNAL_WEIGHTS = Object.freeze({
  tag_type: 100,
  hostname: 90,
  code: 85,
  name: 35,
});

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function textValues(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => textValues(item, output));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => textValues(item, output));
  return output;
}

function includesAny(haystack, needles = []) {
  return needles.find((needle) => haystack.includes(needle.toLowerCase()));
}

function consentList(settings) {
  const list = settings?.consentType?.list;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    if (typeof item?.value === 'string') return [item.value];
    const field = item?.map?.find((entry) => entry?.key === 'consentType');
    return typeof field?.value === 'string' ? [field.value] : [];
  }).filter((type) => CONSENT_TYPES.includes(type));
}

function evidenceFor(tag, provider) {
  const evidence = [];
  const tagType = String(tag.type || '').toLowerCase();
  const name = String(tag.name || '').toLowerCase();
  const allText = textValues(tag).join('\n').toLowerCase();
  const codeText = textValues(tag.parameter || []).join('\n').toLowerCase();
  const match = provider.match || {};

  if ((match.tag_types || []).map((item) => item.toLowerCase()).includes(tagType)) {
    evidence.push({ signal: 'tag_type', weight: SIGNAL_WEIGHTS.tag_type, value: tag.type });
  }
  const hostname = includesAny(allText, match.hostnames);
  if (hostname) evidence.push({ signal: 'hostname', weight: SIGNAL_WEIGHTS.hostname, value: hostname });
  const code = includesAny(codeText, match.code_contains);
  if (code) evidence.push({ signal: 'code', weight: SIGNAL_WEIGHTS.code, value: code });
  const nameMatch = includesAny(name, match.name_contains);
  if (nameMatch) evidence.push({ signal: 'name', weight: SIGNAL_WEIGHTS.name, value: nameMatch });
  return evidence;
}

function scoreEvidence(evidence) {
  if (!evidence.length) return 0;
  const ordered = evidence.map(({ weight }) => weight).sort((a, b) => b - a);
  return Math.min(100, ordered[0] + ordered.slice(1).reduce((sum, weight) => sum + Math.round(weight * 0.15), 0));
}

export function validateRegistry(candidate = registry) {
  if (candidate?.schema_version !== '1.0' || !Array.isArray(candidate.providers)) {
    throw new TypeError('Provider registry must use schema_version 1.0 and contain providers.');
  }
  const ids = new Set();
  for (const provider of candidate.providers) {
    if (!provider.id || ids.has(provider.id)) throw new TypeError(`Provider id is missing or duplicated: ${provider.id || '(missing)'}`);
    ids.add(provider.id);
    validateConsentSet(provider.required_consent);
    if (!['additional', 'built_in', 'essential'].includes(provider.enforcement)) {
      throw new TypeError(`Unsupported enforcement for ${provider.id}: ${provider.enforcement}`);
    }
  }
  return candidate;
}

export function validateConsentSet(types) {
  if (!Array.isArray(types) || !types.length) throw new TypeError('A consent requirement set must contain at least one type.');
  const unique = [...new Set(types)];
  for (const type of unique) {
    if (!CONSENT_TYPES.includes(type)) throw new TypeError(`Unknown Google consent type: ${type}`);
  }
  return unique;
}

export function parseContainerExport(exported) {
  if (!exported || typeof exported !== 'object') throw new TypeError('GTM input must be a JSON object.');
  const container = exported.containerVersion || exported;
  if (!Array.isArray(container.tag)) throw new TypeError('GTM input does not contain a containerVersion.tag array.');
  return {
    container,
    tags: container.tag,
    metadata: {
      export_format_version: exported.exportFormatVersion ?? null,
      account_id: container.accountId ?? null,
      container_id: container.containerId ?? null,
      container_version_id: container.containerVersionId ?? null,
      container_name: container.container?.name ?? container.name ?? null,
    },
  };
}

export function classifyTag(tag, candidateRegistry = registry) {
  validateRegistry(candidateRegistry);
  const matches = candidateRegistry.providers.map((provider) => {
    const evidence = evidenceFor(tag, provider);
    return { provider, evidence, score: scoreEvidence(evidence) };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.provider.id.localeCompare(b.provider.id));

  const best = matches[0];
  if (!best) {
    return {
      provider_id: null,
      provider: 'Unknown',
      product: 'Unknown tag',
      purposes: [],
      required_consent: [],
      enforcement: 'unresolved',
      confidence: 0,
      status: 'unresolved',
      evidence: [],
      alternatives: [],
    };
  }

  const conflicts = matches.slice(1).filter(({ score, provider }) => score >= 70 && provider.id !== best.provider.id);
  const conflict = conflicts.some(({ provider }) => (
    JSON.stringify([...provider.required_consent].sort()) !== JSON.stringify([...best.provider.required_consent].sort())
  ));
  const confidence = best.score / 100;
  const status = conflict ? 'conflict' : confidence >= 0.9 ? 'recommended' : confidence >= 0.7 ? 'review' : 'uncertain';

  return {
    provider_id: best.provider.id,
    provider: best.provider.provider,
    product: best.provider.product,
    purposes: best.provider.purposes,
    required_consent: best.provider.required_consent,
    enforcement: best.provider.enforcement,
    confidence,
    status,
    evidence: best.evidence.map(({ signal, value, weight }) => `${signal} matched "${value}" (+${weight})`),
    alternatives: conflicts.map(({ provider, score }) => ({ provider_id: provider.id, confidence: score / 100 })),
  };
}

function recommendedAction(classification) {
  if (classification.enforcement === 'additional') return 'set_additional_consent';
  if (classification.enforcement === 'built_in') return 'verify_built_in_consent';
  if (classification.enforcement === 'essential') return 'leave_unblocked';
  return 'manual_review';
}

export function scanContainer(exported, options = {}) {
  const candidateRegistry = validateRegistry(options.registry || registry);
  const { tags, metadata } = parseContainerExport(exported);
  const triggerById = new Map((parseContainerExport(exported).container.trigger || [])
    .map((trigger) => [String(trigger.triggerId ?? trigger.trigger_id ?? ''), trigger]));
  const results = tags.map((tag) => {
    const classification = classifyTag(tag, candidateRegistry);
    return {
      tag_id: String(tag.tagId ?? tag.tag_id ?? ''),
      tag_name: tag.name || '(unnamed tag)',
      tag_type: tag.type || null,
      paused: tag.paused === true,
      tag_fingerprint: fingerprint(tag),
      existing_consent: {
        status: tag.consentSettings?.consentStatus ?? null,
        required: consentList(tag.consentSettings),
      },
      dependencies: {
        firing_triggers: (tag.firingTriggerId || []).map((id) => ({
          trigger_id: String(id),
          trigger_name: triggerById.get(String(id))?.name || null,
          trigger_type: triggerById.get(String(id))?.type || null,
        })),
        blocking_trigger_ids: (tag.blockingTriggerId || []).map(String),
        setup_tag_ids: (tag.setupTag || []).map((item) => String(item.tagName || item.tagId || item)),
        teardown_tag_ids: (tag.teardownTag || []).map((item) => String(item.tagName || item.tagId || item)),
      },
      ...classification,
      recommended_action: recommendedAction(classification),
    };
  });
  const counts = (status) => results.filter((item) => item.status === status).length;
  return {
    schema_version: '1.0',
    registry_version: candidateRegistry.registry_version,
    source: { ...metadata, fingerprint: fingerprint(exported) },
    summary: {
      total: results.length,
      recommended: counts('recommended'),
      review: counts('review'),
      uncertain: counts('uncertain'),
      conflicts: counts('conflict'),
      unresolved: counts('unresolved'),
    },
    tags: results,
  };
}

export function createApprovalManifest(report) {
  if (report?.schema_version !== '1.0' || !Array.isArray(report.tags)) throw new TypeError('Invalid Meridian scan report.');
  return {
    schema_version: '1.0',
    registry_version: report.registry_version,
    source: report.source,
    policy: {
      require_all_decisions: true,
      preserve_triggers: true,
      publish: false,
    },
    decisions: report.tags.map((tag) => ({
      tag_id: tag.tag_id,
      tag_name: tag.tag_name,
      tag_fingerprint: tag.tag_fingerprint,
      provider_id: tag.provider_id,
      required_consent: tag.required_consent,
      enforcement: tag.enforcement,
      recommended_action: tag.recommended_action,
      confidence: tag.confidence,
      decision: 'pending',
      note: '',
    })),
  };
}

function consentSettings(types) {
  return {
    consentStatus: 'NEEDED',
    consentType: {
      type: 'LIST',
      // GTM container imports deserialize list values as Parameter objects.
      // TEMPLATE is the text-valued Parameter enum; STRING is not accepted by
      // the container import format even though the Tag API describes this
      // field conceptually as LIST<STRING>.
      list: types.map((type) => ({ type: 'TEMPLATE', value: type })),
    },
  };
}

export function applyApprovalManifest(exported, manifest) {
  const copy = structuredClone(exported);
  const { tags } = parseContainerExport(copy);
  if (fingerprint(exported) !== manifest?.source?.fingerprint) {
    throw new Error('The GTM export does not match the export that was reviewed. Run scan again.');
  }
  const pending = manifest.decisions?.filter(({ decision }) => decision === 'pending') || [];
  if (manifest.policy?.require_all_decisions !== false && pending.length) {
    throw new Error(`${pending.length} tag decision(s) are still pending. Review every tag before apply.`);
  }

  const byId = new Map(tags.map((tag) => [String(tag.tagId ?? tag.tag_id ?? ''), tag]));
  const changes = [];
  for (const item of manifest.decisions || []) {
    if (item.decision !== 'approve') continue;
    const tag = byId.get(String(item.tag_id));
    if (!tag) throw new Error(`Approved tag ${item.tag_id} no longer exists.`);
    if (fingerprint(tag) !== item.tag_fingerprint) throw new Error(`Approved tag ${item.tag_id} changed after review.`);
    const types = validateConsentSet(item.required_consent);
    if (item.enforcement !== 'additional') {
      changes.push({ tag_id: item.tag_id, tag_name: tag.name, action: item.recommended_action, changed: false });
      continue;
    }
    const before = structuredClone(tag.consentSettings ?? null);
    tag.consentSettings = consentSettings(types);
    changes.push({
      tag_id: item.tag_id,
      tag_name: tag.name,
      action: 'set_additional_consent',
      required_consent: types,
      changed: JSON.stringify(before) !== JSON.stringify(tag.consentSettings),
    });
  }
  return { container: copy, changes };
}

export function formatReportTable(report) {
  const rows = report.tags.map((tag) => ({
    Tag: `${tag.tag_name} [${tag.tag_id}]`,
    Provider: tag.product,
    Consent: tag.required_consent.join(' + ') || 'REVIEW REQUIRED',
    Confidence: `${Math.round(tag.confidence * 100)}%`,
    Status: tag.status,
  }));
  return rows;
}
