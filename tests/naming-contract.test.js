import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = new URL('../', import.meta.url);
const SKIP = new Set(['.git', 'node_modules']);
const TEXT_EXTENSIONS = new Set([
  '.css', '.html', '.js', '.json', '.md', '.mjs', '.svg', '.toml', '.tpl',
]);

async function walk(directory = ROOT) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const target = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) files.push(...await walk(target));
    else files.push(target);
  }
  return files;
}

test('repository uses the Measurement Stack and Meridian Consent naming contract', async () => {
  const compactLegacyName = ['measure', 'stack'].join('');
  const files = await walk();
  const violations = [];

  for (const file of files) {
    const relative = path.relative(new URL('.', ROOT).pathname, file.pathname);
    if (relative.toLowerCase().includes(compactLegacyName)) violations.push(relative);
    if (!TEXT_EXTENSIONS.has(path.extname(relative))) continue;
    const contents = await readFile(file, 'utf8');
    if (contents.toLowerCase().includes(compactLegacyName)) violations.push(relative);
  }

  assert.deepEqual(violations, []);

  const site = await readFile(new URL('../public/core.js', import.meta.url), 'utf8');
  const sdk = await readFile(new URL('../consent-sdk/src/meridian-consent.js', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../consent-sdk/README.md', import.meta.url), 'utf8');

  assert.match(site, /window\.MeasurementStack\s*=/);
  assert.match(sdk, /window\.MeridianConsent\s*=/);
  assert.match(sdk, /window\.MeridianConsentConfig/);
  assert.match(readme, /\/consent\/meridian-consent\.min\.css/);
  assert.match(readme, /\/consent\/meridian-consent\.min\.js/);
});
