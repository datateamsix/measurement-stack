import assert from 'node:assert/strict';
import test from 'node:test';
import { assessWorkspace, consentSettings } from '../functions/lib/gtm-compliance.js';

const binding = {
  property_key: 'measurement-stack',
  property_name: 'Measurement Stack',
  property_domain: 'measurementstack.com',
  account_id: '123',
  account_name: 'Measurement Stack',
  container_id: '456',
  container_name: 'Web',
  container_public_id: 'GTM-TEST',
  workspace_id: '7',
  workspace_name: 'Meridian Consent',
};

function resources(consent = null) {
  return {
    tags: [{
      accountId: '123', containerId: '456', workspaceId: '7', tagId: '10',
      path: 'accounts/123/containers/456/workspaces/7/tags/10',
      fingerprint: 'api-fingerprint-1', name: 'Meta Pixel – Page View', type: 'html',
      firingTriggerId: ['20'], parameter: [{ key: 'html', type: 'template', value: 'fbq("track", "PageView")' }],
      ...(consent ? { consentSettings: consent } : {}),
    }],
    triggers: [{ triggerId: '20', name: 'All Pages', type: 'PAGEVIEW' }],
    variables: [],
  };
}

const decision = {
  tag_id: '10',
  tag_fingerprint: 'api-fingerprint-1',
  provider_name: 'Meta',
  purposes: ['Advertising'],
  consent_types: ['ad_storage', 'ad_user_data', 'ad_personalization'],
  enforcement: 'additional',
};

test('workspace assessment includes current tag triggers and flags missing consent configuration', () => {
  const result = assessWorkspace(binding, resources());
  assert.equal(result.tags[0].dependencies.firing_triggers[0].trigger_name, 'All Pages');
  assert.equal(result.tags[0].compliance, 'configuration_required');
  assert.equal(result.summary.export_ready, false);
});

test('fingerprint-bound review becomes configuration required until consent matches', () => {
  const pending = assessWorkspace(binding, resources(), [decision]);
  assert.equal(pending.tags[0].reviewed, true);
  assert.equal(pending.tags[0].compliance, 'configuration_required');
  const configured = assessWorkspace(binding, resources(consentSettings(decision.consent_types, 'additional')), [decision]);
  assert.equal(configured.tags[0].compliance, 'compliant');
  assert.equal(configured.summary.export_ready, true);
});

test('stale decisions cannot pass the version gate', () => {
  const result = assessWorkspace(binding, resources(), [{ ...decision, tag_fingerprint: 'older-fingerprint' }]);
  assert.equal(result.tags[0].stale_review, true);
  assert.equal(result.tags[0].compliance, 'review_required');
  assert.equal(result.summary.blocking, 1);
});
