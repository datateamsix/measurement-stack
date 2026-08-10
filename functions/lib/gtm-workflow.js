import {
  createUnpublishedVersion,
  listWorkspaceResources,
  syncWorkspace,
  updateWorkspaceTag,
} from './gtm-api.js';
import { assessWorkspace, consentSettings, workspaceContainer } from './gtm-compliance.js';
import {
  recordVersionExport,
  requirePropertyBinding,
  saveTagDecision,
  tagDecisions,
} from './gtm-property-store.js';
import { HttpError } from './http.js';

function ids(binding) {
  return {
    accountId: binding.account_id,
    containerId: binding.container_id,
    workspaceId: binding.workspace_id,
  };
}

export async function loadPropertyAssessment(env, actorKey, propertyKey, fetcher = fetch) {
  const binding = await requirePropertyBinding(env, actorKey, propertyKey);
  const [resources, decisions] = await Promise.all([
    listWorkspaceResources(env, actorKey, ids(binding), fetcher),
    tagDecisions(env, actorKey, propertyKey),
  ]);
  return { binding, resources, decisions, assessment: assessWorkspace(binding, resources, decisions) };
}

export async function applyPropertyCompliance(env, actorKey, propertyKey, fetcher = fetch) {
  const binding = await requirePropertyBinding(env, actorKey, propertyKey);
  await syncWorkspace(env, actorKey, ids(binding), fetcher);
  const current = await loadPropertyAssessment(env, actorKey, propertyKey, fetcher);
  if (current.assessment.summary.review_required) {
    throw new HttpError(409, `Review ${current.assessment.summary.review_required} tag decision(s) before applying configuration.`);
  }

  const sourceById = new Map(current.resources.tags.map((tag) => [String(tag.tagId), tag]));
  const changes = [];
  for (const finding of current.assessment.tags.filter((tag) => tag.compliance === 'configuration_required')) {
    const source = sourceById.get(String(finding.tag_id));
    if (!source) throw new HttpError(409, `Tag ${finding.tag_id} changed after assessment. Reload and try again.`);
    const updated = await updateWorkspaceTag(env, actorKey, {
      ...source,
      consentSettings: consentSettings(finding.required_consent, finding.enforcement),
    }, fetcher);
    if (finding.reviewed) {
      await saveTagDecision(env, actorKey, {
        propertyKey,
        tagId: finding.tag_id,
        tagFingerprint: updated.fingerprint,
        providerName: finding.provider,
        purposes: finding.purposes,
        consentTypes: finding.required_consent,
        enforcement: finding.enforcement,
        note: 'Fingerprint refreshed after Meridian applied the approved consent configuration.',
      });
    }
    changes.push({
      tagId: finding.tag_id,
      tagName: finding.tag_name,
      enforcement: finding.enforcement,
      consentTypes: finding.required_consent,
      fingerprint: updated.fingerprint,
    });
  }

  const refreshed = await loadPropertyAssessment(env, actorKey, propertyKey, fetcher);
  return { changes, assessment: refreshed.assessment };
}

export async function exportPropertyVersion(env, actorKey, propertyKey, input, fetcher = fetch) {
  const binding = await requirePropertyBinding(env, actorKey, propertyKey);
  await syncWorkspace(env, actorKey, ids(binding), fetcher);
  const current = await loadPropertyAssessment(env, actorKey, propertyKey, fetcher);
  if (!current.assessment.summary.export_ready) {
    throw new HttpError(409, `Version creation is blocked until all ${current.assessment.summary.blocking} tag finding(s) are compliant.`);
  }
  const packageData = workspaceContainer(binding, current.resources);
  const result = await createUnpublishedVersion(env, actorKey, ids(binding), input, fetcher);
  await recordVersionExport(env, actorKey, binding, result);
  return {
    ok: true,
    unpublished: true,
    publishAvailable: false,
    containerVersion: result.containerVersion || null,
    syncStatus: result.syncStatus || null,
    workspacePackage: packageData,
    assessment: current.assessment,
  };
}
