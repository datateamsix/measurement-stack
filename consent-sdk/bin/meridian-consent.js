#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { resolve } from 'node:path';
import {
  DEFAULT_REGISTRY,
  applyApprovalManifest,
  createApprovalManifest,
  formatReportTable,
  scanContainer,
  validateConsentSet,
} from '../classifier/index.js';

function usage() {
  console.log(`Meridian Consent

Usage:
  meridian-consent scan <container.json> [--output report.json] [--registry providers.json]
  meridian-consent plan <report.json> [--output approvals.json]
  meridian-consent review <approvals.json> [--output approvals.reviewed.json]
  meridian-consent apply <container.json> --plan approvals.reviewed.json --output container.meridian.json

The apply command refuses pending decisions and verifies the source and every approved tag fingerprint.`);
}

function argsOf(argv) {
  const [command, file, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    options[key.slice(2)] = value;
    index += 1;
  }
  return { command, file, options };
}

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function save(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${path}`);
}

async function review(manifest) {
  const rl = createInterface({ input, output });
  try {
    for (const item of manifest.decisions) {
      console.log(`\n${item.tag_name} [${item.tag_id}]`);
      console.log(`  Provider: ${item.provider_id || 'Unknown'}`);
      console.log(`  Consent: ${item.required_consent.join(', ') || 'unresolved'}`);
      console.log(`  Confidence: ${Math.round(item.confidence * 100)}%`);
      const answer = (await rl.question('  [a]pprove, [s]kip, or [e]dit consent set? ')).trim().toLowerCase();
      if (answer === 'a') {
        if (!item.required_consent.length) throw new Error(`Cannot approve unresolved tag ${item.tag_id}; choose edit.`);
        item.decision = 'approve';
      } else if (answer === 's') {
        item.decision = 'skip';
      } else if (answer === 'e') {
        const values = (await rl.question('  Comma-separated Google consent types: ')).split(',').map((value) => value.trim()).filter(Boolean);
        item.required_consent = validateConsentSet(values);
        item.enforcement = 'additional';
        item.recommended_action = 'set_additional_consent';
        item.decision = 'approve';
        item.note = 'User override';
      } else {
        throw new Error(`Review stopped at tag ${item.tag_id}; no decision was recorded.`);
      }
    }
    return manifest;
  } finally {
    rl.close();
  }
}

async function main() {
  const { command, file, options } = argsOf(process.argv.slice(2));
  if (!command || command === 'help' || command === '--help') return usage();
  if (!file) throw new Error(`The ${command} command requires an input file.`);

  if (command === 'scan') {
    const providerRegistry = options.registry ? await json(options.registry) : DEFAULT_REGISTRY;
    const report = scanContainer(await json(file), { registry: providerRegistry });
    console.table(formatReportTable(report));
    console.log(report.summary);
    if (options.output) await save(options.output, report);
    return;
  }
  if (command === 'plan') {
    const plan = createApprovalManifest(await json(file));
    await save(options.output || 'meridian-consent-plan.json', plan);
    return;
  }
  if (command === 'review') {
    const reviewed = await review(await json(file));
    const reviewPath = options.output || file.replace(/\.json$/i, '.reviewed.json');
    await save(reviewPath === file ? `${file}.reviewed.json` : reviewPath, reviewed);
    return;
  }
  if (command === 'apply') {
    if (!options.plan || !options.output) throw new Error('apply requires --plan and --output.');
    if (resolve(file) === resolve(options.output)) throw new Error('Refusing to overwrite the source GTM export. Choose a different --output path.');
    const result = applyApprovalManifest(await json(file), await json(options.plan));
    await save(options.output, result.container);
    console.table(result.changes);
    console.log('No GTM triggers were changed. This export was not published.');
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`Meridian Consent: ${error.message}`);
  process.exitCode = 1;
});
