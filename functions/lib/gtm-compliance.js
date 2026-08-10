import { CONSENT_TYPES, scanContainer } from '../../consent-sdk/classifier/index.js';
import { HttpError } from './http.js';

function normalizedConsent(value) {
  return String(value || 'NOT_SET').replace(/([a-z])([A-Z])/gu, '$1_$2').toUpperCase();
}

function sameSet(left, right) {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return JSON.stringify(a) === JSON.stringify(b);
}

export function validateConsentTypes(values, { allowEmpty = false } = {}) {
  if (!Array.isArray(values)) throw new HttpError(400, 'consentTypes must be an array.');
  const types = [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
  if (!allowEmpty && !types.length) throw new HttpError(400, 'Select at least one consent type.');
  for (const type of types) {
    if (!CONSENT_TYPES.includes(type)) throw new HttpError(400, `Unsupported consent type: ${type}`);
  }
  return types;
}

export function consentSettings(types, enforcement) {
  if (enforcement !== 'additional') return { consentStatus: 'NOT_NEEDED' };
  return {
    consentStatus: 'NEEDED',
    consentType: {
      type: 'LIST',
      list: types.map((value) => ({ type: 'TEMPLATE', value })),
    },
  };
}

export function workspaceContainer(binding, resources) {
  return {
    exportFormatVersion: 2,
    exportTime: new Date().toISOString(),
    containerVersion: {
      accountId: String(binding.account_id),
      containerId: String(binding.container_id),
      container: {
        accountId: String(binding.account_id),
        containerId: String(binding.container_id),
        name: binding.container_name || binding.container_public_id || String(binding.container_id),
        publicId: binding.container_public_id || undefined,
      },
      tag: resources.tags || [],
      trigger: resources.triggers || [],
      variable: resources.variables || [],
    },
  };
}

function tagCompliance(tag, decision) {
  const reviewed = decision && decision.tag_fingerprint === tag.api_fingerprint;
  const effective = reviewed ? {
    provider: decision.provider_name,
    product: decision.provider_name,
    purposes: decision.purposes,
    required_consent: decision.consent_types,
    enforcement: decision.enforcement,
    confidence: 1,
    classification_status: 'user_reviewed',
  } : {
    provider: tag.provider,
    product: tag.product,
    purposes: tag.purposes,
    required_consent: tag.required_consent,
    enforcement: tag.enforcement,
    confidence: tag.confidence,
    classification_status: tag.status,
  };
  const currentStatus = normalizedConsent(tag.existing_consent.status);
  const currentTypes = tag.existing_consent.required || [];
  const needsReview = Boolean(decision && !reviewed) || (!reviewed && !['recommended'].includes(tag.status));
  let compliance = 'compliant';
  let message = 'Current consent configuration matches the assessed requirement.';

  if (needsReview || effective.enforcement === 'unresolved') {
    compliance = 'review_required';
    message = reviewed
      ? 'The saved review is stale because this tag changed in GTM.'
      : 'Confirm the provider, purpose, and required consent before configuration.';
  } else if (effective.enforcement === 'additional') {
    if (currentStatus !== 'NEEDED' || !sameSet(currentTypes, effective.required_consent)) {
      compliance = 'configuration_required';
      message = currentStatus !== 'NEEDED'
        ? 'Additional consent checks are not enabled.'
        : 'The current consent checks do not match the assessed requirement.';
    }
  } else if (['built_in', 'essential'].includes(effective.enforcement) && currentStatus === 'NEEDED') {
    compliance = 'configuration_required';
    message = effective.enforcement === 'built_in'
      ? 'This Google tag has an additional hard gate on top of its built-in consent checks.'
      : 'This essential tag is configured with an additional consent gate.';
  }

  return {
    ...tag,
    ...effective,
    reviewed: Boolean(reviewed),
    stale_review: Boolean(decision && !reviewed),
    current_consent: { status: currentStatus, types: currentTypes },
    compliance,
    compliance_message: message,
  };
}

export function assessWorkspace(binding, resources, decisions = []) {
  const exported = workspaceContainer(binding, resources);
  const report = scanContainer(exported);
  const sourceById = new Map((resources.tags || []).map((tag) => [String(tag.tagId), tag]));
  const decisionsById = new Map(decisions.map((decision) => [String(decision.tag_id), decision]));
  const tags = report.tags.map((tag) => {
    const source = sourceById.get(tag.tag_id) || {};
    return tagCompliance({
      ...tag,
      api_fingerprint: String(source.fingerprint || ''),
      path: source.path || null,
    }, decisionsById.get(tag.tag_id));
  });
  const count = (status) => tags.filter((tag) => tag.compliance === status).length;
  const blocking = tags.filter((tag) => tag.compliance !== 'compliant').length;
  return {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    registry_version: report.registry_version,
    source_fingerprint: report.source.fingerprint,
    property: {
      key: binding.property_key,
      name: binding.property_name,
      domain: binding.property_domain,
    },
    selection: {
      accountId: binding.account_id,
      accountName: binding.account_name,
      containerId: binding.container_id,
      containerName: binding.container_name,
      containerPublicId: binding.container_public_id,
      workspaceId: binding.workspace_id,
      workspaceName: binding.workspace_name,
    },
    summary: {
      total: tags.length,
      compliant: count('compliant'),
      configuration_required: count('configuration_required'),
      review_required: count('review_required'),
      paused_findings: tags.filter((tag) => tag.paused && tag.compliance !== 'compliant').length,
      blocking,
      export_ready: blocking === 0,
    },
    tags,
  };
}
