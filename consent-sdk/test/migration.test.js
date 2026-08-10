import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { DEFAULT_REGISTRY, createApprovalManifest, scanContainer } from '../classifier/index.js';
import {
  createDisclosureInventory,
  createImpactManifest,
  mergeStarterContainer,
  migrationPackage,
} from '../migration/index.js';
import { POLICY_PROFILES, policyManifest } from '../policy/index.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/container.json', import.meta.url), 'utf8'));

function reviewedPlan() {
  const report = scanContainer(fixture);
  const plan = createApprovalManifest(report);
  for (const decision of plan.decisions) decision.decision = decision.required_consent.length ? 'approve' : 'skip';
  return plan;
}

test('starter merge remaps useful variables and triggers without adding example tags', () => {
  const merged = mergeStarterContainer(fixture);
  assert.equal(merged.conflicts.length, 0);
  assert.equal(merged.additions.filter(({ collection }) => collection === 'variable').length, 9);
  assert.equal(merged.additions.filter(({ collection }) => collection === 'trigger').length, 4);
  assert.equal(merged.container.containerVersion.tag.length, fixture.containerVersion.tag.length);
  assert.equal(new Set(merged.container.containerVersion.trigger.map(({ triggerId }) => triggerId)).size, merged.container.containerVersion.trigger.length);
  assert.equal(fixture.containerVersion.variable, undefined, 'source is not mutated');
});

test('merge is idempotent and reuses matching Meridian resources', () => {
  const once = mergeStarterContainer(fixture);
  const twice = mergeStarterContainer(once.container);
  assert.equal(twice.additions.length, 0);
  assert.equal(twice.reused.length, 13);
  assert.equal(twice.conflicts.length, 0);
});

test('impact manifest maps tag trigger opportunities and labels denied outcomes', () => {
  const report = scanContainer(fixture);
  const impact = createImpactManifest(fixture, report);
  const ga4 = impact.rules.find(({ tag_id }) => tag_id === '1');
  const meta = impact.rules.find(({ tag_id }) => tag_id === '2');
  assert.equal(ga4.event_name, 'generate_lead');
  assert.equal(ga4.trigger_confidence, 'estimated');
  assert.equal(ga4.outcome_when_denied, 'modeled_signal');
  assert.equal(meta.event_name, 'page_view');
  assert.equal(meta.trigger_confidence, 'exact');
  assert.equal(meta.outcome_when_denied, 'blocked');
  assert.equal(impact.counting_unit, 'measurement_opportunity');
});

test('migration package blocks pending decisions and validates a reviewed transform', () => {
  const pending = migrationPackage(fixture);
  assert.equal(pending.status, 'review_required');
  assert.equal('transformed' in pending, false);

  const ready = migrationPackage(fixture, reviewedPlan());
  assert.equal(ready.status, 'ready');
  assert.equal(ready.validation.valid, true);
  assert.equal(ready.diff.guarantees.firing_triggers_changed, false);
  assert.equal(ready.transformed.containerVersion.tag.length, fixture.containerVersion.tag.length);
  const meta = ready.transformed.containerVersion.tag.find(({ tagId }) => tagId === '2');
  assert.equal(meta.consentSettings.consentStatus, 'NEEDED');
});

test('disclosure inventory uses documented cookies and leaves unknown retention blank', () => {
  const inventory = createDisclosureInventory(scanContainer(fixture), DEFAULT_REGISTRY);
  const meta = inventory.find(({ tag_id }) => tag_id === '2');
  assert.match(meta.destination_domains, /facebook/);
  assert.equal(meta.known_cookies, '_fbp|_fbc');
  assert.equal(meta.retention, '');
  assert.equal(meta.disclosure_status, 'review');
});

test('policy profiles keep opt-out state distinct and require legal review', () => {
  assert.deepEqual(Object.keys(POLICY_PROFILES), ['strict-global', 'eu-uk-consent', 'us-opt-out']);
  const profile = policyManifest('us-opt-out');
  assert.equal(profile.interaction, 'opt_out');
  assert.equal(profile.honor_gpc, true);
  assert.equal(profile.legal_review_required, true);
});
