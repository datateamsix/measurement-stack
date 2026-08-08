import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_REGISTRY,
  applyApprovalManifest,
  createApprovalManifest,
  scanContainer,
  validateRegistry,
} from '../classifier/index.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/container.json', import.meta.url), 'utf8'));

test('provider registry is versioned, unique, and limited to Google consent types', () => {
  assert.equal(validateRegistry(DEFAULT_REGISTRY), DEFAULT_REGISTRY);
  assert.ok(DEFAULT_REGISTRY.providers.length >= 25);
  assert.equal(new Set(DEFAULT_REGISTRY.providers.map(({ id }) => id)).size, DEFAULT_REGISTRY.providers.length);
});

test('scanner explains high-confidence classifications and leaves unknown tags unresolved', () => {
  const report = scanContainer(fixture);
  const byId = new Map(report.tags.map((tag) => [tag.tag_id, tag]));

  assert.equal(report.summary.total, 5);
  assert.equal(byId.get('1').provider_id, 'google.analytics.ga4');
  assert.equal(byId.get('1').enforcement, 'built_in');
  assert.deepEqual(byId.get('1').required_consent, ['analytics_storage']);
  assert.equal(byId.get('2').provider_id, 'meta.pixel');
  assert.equal(byId.get('2').confidence, 1);
  assert.ok(byId.get('2').evidence.some((item) => item.includes('hostname')));
  assert.deepEqual(byId.get('3').required_consent, ['analytics_storage']);
  assert.equal(byId.get('4').status, 'unresolved');
  assert.equal(byId.get('5').recommended_action, 'leave_unblocked');
});

test('name-only evidence is visible but cannot be auto-recommended', () => {
  const one = structuredClone(fixture);
  one.containerVersion.tag = [{ tagId: '7', name: 'Maybe Hotjar', type: 'html', parameter: [] }];
  const result = scanContainer(one).tags[0];
  assert.equal(result.provider_id, 'hotjar.analytics');
  assert.equal(result.confidence, 0.35);
  assert.equal(result.status, 'uncertain');
});

test('approval manifest blocks apply until every tag has an explicit decision', () => {
  const manifest = createApprovalManifest(scanContainer(fixture));
  assert.ok(manifest.decisions.every(({ decision }) => decision === 'pending'));
  assert.throws(() => applyApprovalManifest(fixture, manifest), /still pending/);
});

test('apply changes only approved additional checks and preserves triggers byte-for-byte', () => {
  const report = scanContainer(fixture);
  const manifest = createApprovalManifest(report);
  for (const decision of manifest.decisions) decision.decision = decision.tag_id === '2' ? 'approve' : 'skip';

  const originalTriggers = JSON.stringify(fixture.containerVersion.trigger);
  const originalGa4 = JSON.stringify(fixture.containerVersion.tag[0]);
  const { container, changes } = applyApprovalManifest(fixture, manifest);
  const meta = container.containerVersion.tag.find(({ tagId }) => tagId === '2');

  assert.equal(changes.length, 1);
  assert.equal(changes[0].changed, true);
  assert.equal(meta.consentSettings.consentStatus, 'NEEDED');
  assert.deepEqual(
    meta.consentSettings.consentType.list.map(({ value }) => value),
    ['ad_storage', 'ad_user_data', 'ad_personalization'],
  );
  assert.equal(JSON.stringify(container.containerVersion.trigger), originalTriggers);
  assert.equal(JSON.stringify(container.containerVersion.tag[0]), originalGa4);
  assert.equal(fixture.containerVersion.tag[1].consentSettings, undefined, 'input must not be mutated');
});

test('apply records built-in checks without adding additional consent to Google tags', () => {
  const manifest = createApprovalManifest(scanContainer(fixture));
  for (const decision of manifest.decisions) decision.decision = decision.tag_id === '1' ? 'approve' : 'skip';
  const { container, changes } = applyApprovalManifest(fixture, manifest);
  assert.equal(changes[0].action, 'verify_built_in_consent');
  assert.equal(changes[0].changed, false);
  assert.equal(container.containerVersion.tag[0].consentSettings, undefined);
});

test('source and tag fingerprints prevent stale plans from changing a container', () => {
  const manifest = createApprovalManifest(scanContainer(fixture));
  for (const decision of manifest.decisions) decision.decision = 'skip';
  const changed = structuredClone(fixture);
  changed.containerVersion.tag[1].name = 'Meta - Changed After Review';
  assert.throws(() => applyApprovalManifest(changed, manifest), /does not match/);

  const stale = structuredClone(manifest);
  stale.source.fingerprint = scanContainer(changed).source.fingerprint;
  stale.decisions.find(({ tag_id }) => tag_id === '2').decision = 'approve';
  assert.throws(() => applyApprovalManifest(changed, stale), /changed after review/);
});
