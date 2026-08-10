import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createApprovalManifest, scanContainer } from '../classifier/index.js';

const bin = new URL('../bin/meridian-consent.js', import.meta.url).pathname;
const fixturePath = new URL('./fixtures/container.json', import.meta.url).pathname;
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));

function run(args) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
}

test('CLI exposes branded contextual help', () => {
  const result = run(['help', 'migrate']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /MERIDIAN CONSENT/);
  assert.match(result.stdout, /GTM migration/);
  assert.match(result.stdout, /never overwritten/);
});

test('CLI exposes privacy-safe site scan help', () => {
  const result = run(['help', 'site-scan']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /site scan/i);
  assert.match(result.stdout, /capped at 10 pages/);
  assert.match(result.stdout, /never saved/);
  assert.match(result.stdout, /authorized to assess/);
});

test('CLI withholds transformed output until review is complete', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meridian-cli-pending-'));
  const result = run(['migrate', fixturePath, '--approve-recommended', '--output-dir', directory]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /REVIEW_REQUIRED/);
  const files = await readdir(directory);
  assert.ok(files.includes('review-manifest.json'));
  assert.ok(!files.some((name) => name.endsWith('_meridian.json')));
});

test('CLI emits a validated GTM export after explicit decisions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meridian-cli-ready-'));
  const plan = createApprovalManifest(scanContainer(fixture));
  for (const decision of plan.decisions) decision.decision = decision.required_consent.length ? 'approve' : 'skip';
  const planPath = join(directory, 'reviewed.json');
  const outputPath = join(directory, 'output');
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  const result = run(['migrate', fixturePath, '--plan', planPath, '--output-dir', outputPath]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /READY FOR GTM REVIEW/);
  const files = await readdir(outputPath);
  assert.ok(files.includes('container-diff.json'));
  assert.ok(files.includes('validation-report.json'));
  assert.ok(files.some((name) => name.endsWith('_meridian.json')));
});
