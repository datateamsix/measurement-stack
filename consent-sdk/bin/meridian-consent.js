#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { basename, join, resolve } from 'node:path';
import {
  exposureCsv,
  exposureRows,
  exposureTable,
  fetchConsentImpactSummary,
  summaryCsv,
  summaryTable,
} from '../analytics/index.js';
import {
  DEFAULT_REGISTRY,
  applyApprovalManifest,
  createApprovalManifest,
  formatReportTable,
  scanContainer,
  validateConsentSet,
} from '../classifier/index.js';
import { createDisclosureInventory, migrationPackage } from '../migration/index.js';
import { POLICY_PROFILES, policyManifest } from '../policy/index.js';

const VERSION = '0.3.0';
const color = Boolean(output.isTTY && !process.env.NO_COLOR);
const tone = (code, value) => color ? `\u001b[${code}m${value}\u001b[0m` : value;

function brand(compact = false) {
  if (compact) return `${tone('36', '◉')} ${tone('1', 'MERIDIAN')} ${tone('2', 'CONSENT')}`;
  return `${tone('36', '      │')}\n${tone('36', '   ◜──●──◝')}  ${tone('1', 'MERIDIAN')}\n${tone('36', '      │')}     ${tone('2', 'CONSENT')}  ${tone('2', `v${VERSION}`)}`;
}

const HELP = Object.freeze({
  main: `${brand()}\n\nConsent implementation, site evidence, GTM migration, and impact analysis.\n\nUsage:\n  meridian-consent                         Open the start menu\n  meridian-consent site-scan <url>         Sample browser storage and network behavior\n  meridian-consent migrate <container>     Build a reviewable consent-ready package\n  meridian-consent scan <container>        Classify tags without changing anything\n  meridian-consent analytics [options]     Query consent-impact aggregates\n  meridian-consent policy [profile]        List or inspect policy profiles\n  meridian-consent help [command]          Show contextual help\n\nRun "meridian-consent help site-scan" for the browser-audit workflow.`,
  'site-scan': `${brand(true)} — site scan\n\nUsage:\n  meridian-consent site-scan https://example.com [--max-pages 10]\n    [--include /checkout] [--profiles baseline,reject,accept,gpc]\n    [--full] [--single-page] [--headed] [--dry-run]\n    [--accept-selector <css>] [--reject-selector <css>]\n    [--output-dir ./meridian-site-scan]\n\nPage selection prioritizes the homepage, explicit URLs, and main navigation, using\nthe sitemap only as a fallback. The sample is capped at 10 pages and honors robots.txt.\nCookie/storage values and observed request query/body values are never saved.\nOnly scan websites you own or are authorized to assess.\n\nInstall the browser once with: npx playwright install chromium`,
  migrate: `${brand(true)} — GTM migration\n\nUsage:\n  meridian-consent migrate GTM-XXXX.json [--output-dir ./meridian-output]\n    [--profile strict-global|eu-uk-consent|us-opt-out]\n    [--registry providers.json] [--plan reviewed-plan.json]\n    [--review] [--approve-recommended]\n\nOutputs scan, review, impact, disclosure, diff, validation, policy, and a transformed\ncontainer when every tag has an explicit decision and validation passes. The source\nfile is never overwritten and nothing is published to GTM.`,
  scan: `${brand(true)} — container scan\n\nUsage:\n  meridian-consent scan GTM-XXXX.json [--output scan.json] [--registry providers.json]`,
  review: `${brand(true)} — human review\n\nUsage:\n  meridian-consent review approvals.json [--output approvals.reviewed.json]\n\nApprove, skip, or explicitly edit every tag's consent requirement.`,
  analytics: `${brand(true)} — impact analytics\n\nUsage:\n  meridian-consent analytics --endpoint <url> --site <site-id> [--from <date>] [--to <date>]\n    [--group-by day|country|region|event|consent] [--format table|json|csv]\n    [--output consent-impact.csv] [--impact-manifest impact-manifest.json]\n    [--token-env MERIDIAN_CONSENT_READ_TOKEN]`,
  policy: `${brand(true)} — policy profiles\n\nUsage:\n  meridian-consent policy\n  meridian-consent policy strict-global [--output policy.json]\n\nProfiles are implementation defaults and review aids, not legal advice.`,
});

function usage(section = 'main') {
  console.log(HELP[section] || HELP.main);
}

export function argsOf(argv) {
  const [command, ...rest] = argv;
  const options = {};
  const positionals = [];
  const booleanOptions = new Set(['review', 'approve-recommended', 'help', 'full', 'single-page', 'headed', 'dry-run', 'exact-pages']);
  const listOptions = new Set(['include', 'url']);
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key.startsWith('--')) {
      positionals.push(key);
      continue;
    }
    const name = key.slice(2);
    if (booleanOptions.has(name)) {
      options[name] = true;
      continue;
    }
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    if (listOptions.has(name)) options[name] = [...(options[name] || []), value];
    else options[name] = value;
    index += 1;
  }
  return { command, positionals, file: positionals[0], options };
}

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function save(path, value, quiet = false) {
  await writeFile(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  if (!quiet) console.log(`${tone('32', '✓')} Wrote ${path}`);
}

async function review(manifest) {
  const rl = createInterface({ input, output });
  try {
    for (const item of manifest.decisions.filter((decision) => decision.decision === 'pending')) {
      console.log(`\n${tone('1', item.tag_name)} ${tone('2', `[${item.tag_id}]`)}`);
      console.log(`  Provider    ${item.provider_id || 'Unknown'}`);
      console.log(`  Consent     ${item.required_consent.join(', ') || tone('33', 'unresolved')}`);
      console.log(`  Confidence  ${Math.round(item.confidence * 100)}%`);
      const answer = (await rl.question('  [a]pprove, [s]kip, or [e]dit? ')).trim().toLowerCase();
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

function approveRecommended(manifest, report) {
  const byId = new Map(report.tags.map((tag) => [tag.tag_id, tag]));
  for (const decision of manifest.decisions) {
    const tag = byId.get(decision.tag_id);
    if (tag?.status === 'recommended' && tag.confidence >= 0.9) decision.decision = 'approve';
  }
  return manifest;
}

function csvCell(value) {
  const string = String(value ?? '');
  return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

function inventoryCsv(rows) {
  const columns = ['tag_id', 'tag_name', 'provider', 'product', 'purposes', 'consent_category', 'destination_domains', 'known_cookies', 'retention', 'disclosure_status'];
  return `${columns.join(',')}\n${rows.map((row) => columns.map((key) => csvCell(row[key])).join(',')).join('\n')}\n`;
}

function migrationMarkdown(result, sourceName) {
  const summary = result.report.summary;
  const pending = result.plan.decisions.filter((item) => item.decision === 'pending').length;
  const validation = result.validation?.summary;
  return `# Meridian Consent migration report\n\n- Source: \`${sourceName}\`\n- Status: **${result.status}**\n- Policy profile: \`${result.policy.id}\`\n- Tags scanned: ${summary.total}\n- Recommended: ${summary.recommended}\n- Unresolved/conflicting: ${summary.unresolved + summary.conflicts}\n- Decisions pending: ${pending}\n- Measurement opportunities mapped: ${result.impact.rules.length}\n${validation ? `- Validation: ${validation.errors} error(s), ${validation.warnings} warning(s)\n` : ''}\n## Safety guarantees\n\n- The source export was not overwritten.\n- Existing firing and blocking triggers are preserved.\n- Google tags retain built-in Consent Mode behavior.\n- No tag is deleted, unpaused, or published.\n- Unknown active tags require an explicit decision.\n\n## Next action\n\n${pending ? 'Review `review-manifest.json`, then rerun with `--plan review-manifest.json`, or use `--review` in an interactive terminal.' : result.status === 'ready' ? 'Import the generated container into a new GTM workspace using **Merge**, preview it, and complete the validation checklist before publishing.' : 'Resolve the errors in `validation-report.json` before importing the generated container.'}\n`;
}

async function writeMigrationOutputs(directory, sourceName, result) {
  await mkdir(directory, { recursive: true });
  const inventory = createDisclosureInventory(result.report, result.registry || DEFAULT_REGISTRY);
  const files = [
    ['scan.json', result.report],
    ['review-manifest.json', result.plan],
    ['impact-manifest.json', result.impact],
    ['policy-manifest.json', result.policy],
    ['tag-inventory.csv', inventoryCsv(inventory)],
    ['migration-report.md', migrationMarkdown(result, sourceName)],
  ];
  if (result.diff) files.push(['container-diff.json', result.diff]);
  if (result.validation) files.push(['validation-report.json', result.validation]);
  if (result.status === 'ready') files.push([`${sourceName.replace(/\.json$/i, '')}_meridian.json`, result.transformed]);
  for (const [name, value] of files) await save(join(directory, name), value, true);
  console.log(`${tone('32', '✓')} Migration package: ${directory}`);
  return files.map(([name]) => join(directory, name));
}

async function migrate(file, options) {
  if (!file) throw new Error('migrate requires a GTM container export.');
  const source = await json(file);
  const registry = options.registry ? await json(options.registry) : DEFAULT_REGISTRY;
  const initial = migrationPackage(source, options.plan ? await json(options.plan) : null, {
    registry,
    profile: options.profile || 'strict-global',
  });
  let plan = initial.plan;
  if (!options.plan && options['approve-recommended']) plan = approveRecommended(plan, initial.report);
  if (!options.plan && (options.review || (input.isTTY && !options['approve-recommended']))) plan = await review(plan);
  const result = migrationPackage(source, plan, { registry, profile: options.profile || 'strict-global' });
  const directory = resolve(options['output-dir'] || `meridian-output-${basename(file, '.json')}`);
  await writeMigrationOutputs(directory, basename(file), result);
  console.log(`\n${brand(true)}  ${result.status === 'ready' ? tone('32', 'READY FOR GTM REVIEW') : tone('33', result.status.toUpperCase())}`);
  console.log(`Tags: ${result.report.summary.total}  Impact rules: ${result.impact.rules.length}  Pending: ${result.plan.decisions.filter((item) => item.decision === 'pending').length}`);
  if (result.status === 'validation_failed') process.exitCode = 2;
}

async function siteScan(file, options) {
  const suppliedUrls = options.url || [];
  const startUrl = file || suppliedUrls[0];
  if (!startUrl) throw new Error('site-scan requires a starting URL.');
  const { runSiteScan, writeSiteScanOutputs } = await import('../scanner/index.js');
  const included = [...(options.include || []), ...suppliedUrls.filter((url) => url !== startUrl)];
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-');
  const host = new URL(startUrl).hostname.replace(/[^a-z0-9.-]/gi, '-');
  const outputDirectory = resolve(options['output-dir'] || `meridian-site-scan-${host}-${timestamp}`);
  const result = await runSiteScan(startUrl, {
    include: included,
    maxPages: options['max-pages'] || 10,
    profiles: options.profiles,
    full: options.full,
    singlePage: options['single-page'],
    exactPages: options['exact-pages'],
    headed: options.headed,
    dryRun: options['dry-run'],
    acceptSelector: options['accept-selector'],
    rejectSelector: options['reject-selector'],
    timeoutMs: options['timeout-ms'],
    waitMs: options['wait-ms'],
    onPlan(plan) {
      console.log(`\n${brand(true)}  ${tone('1', 'SCAN PLAN')}`);
      for (const page of plan.pages) console.log(`  ${page.position}. ${page.url} ${tone('2', `[${page.source}]`)}`);
      const profileCount = options.profiles ? String(options.profiles).split(',').filter(Boolean).length : options.full ? 6 : 4;
      console.log(`\nPages: ${plan.pages.length}/10  Planned browser visits: ${plan.pages.length * profileCount}`);
    },
  });
  const written = await writeSiteScanOutputs(outputDirectory, result);
  if (result.status === 'planned') {
    console.log(`${tone('32', '✓')} Scan plan: ${written.directory}`);
    return;
  }
  console.log(`\n${brand(true)}  ${tone('32', 'SITE SCAN COMPLETE')}`);
  console.log(`Technologies: ${result.evidence.summary.technologies}  Cookies: ${result.evidence.summary.cookies}  Storage items: ${result.evidence.summary.storage_items}`);
  console.log(`Potential issues: ${result.evidence.summary.potential_issues}  Manual review: ${result.evidence.summary.manual_review}  Unable to test: ${result.evidence.summary.unable_to_test}`);
  console.log(`${tone('32', '✓')} Evidence package: ${written.directory}`);
}

async function startMenu() {
  console.log(`${brand()}\n\n${tone('2', 'A lightweight measurement consent toolkit.')}\n`);
  console.log('  1  Scan a website');
  console.log('  2  Migrate a GTM container');
  console.log('  3  Scan and classify a container');
  console.log('  4  Query consent impact analytics');
  console.log('  5  View policy profiles');
  console.log('  6  Help');
  console.log('  q  Quit\n');
  const rl = createInterface({ input, output });
  let choice;
  let file;
  try {
    choice = (await rl.question('Choose an action: ')).trim().toLowerCase();
    if (!['1', '2', '3', '4', '5', '6', 'q'].includes(choice)) throw new Error('Choose 1–6 or q.');
    file = choice === '1'
      ? (await rl.question('Website homepage or page URL: ')).trim()
      : ['2', '3'].includes(choice) ? (await rl.question('Path to GTM container JSON: ')).trim() : null;
  } finally {
    rl.close();
  }
  if (choice === 'q') return;
  if (choice === '5') return console.table(Object.values(POLICY_PROFILES).map(({ id, label, interaction }) => ({ Profile: id, Name: label, Mode: interaction })));
  if (choice === '6') return usage();
  if (choice === '1') return siteScan(file, {});
  if (choice === '2') return migrate(file, { review: true });
  if (choice === '3') return runCommand({ command: 'scan', file, options: {}, positionals: [file] });
  return usage('analytics');
}

async function runCommand({ command, file, options, positionals }) {
  if (!command) return input.isTTY ? startMenu() : usage();
  if (command === 'help' || command === '--help' || options.help) return usage(positionals?.[0] || (command === 'help' ? 'main' : command));
  if (command === 'site-scan') return siteScan(file, options);
  if (command === 'migrate') return migrate(file, options);
  if (command === 'policy') {
    if (!file) return console.table(Object.values(POLICY_PROFILES).map(({ id, label, interaction, honor_gpc }) => ({ Profile: id, Name: label, Mode: interaction, GPC: honor_gpc ? 'honored' : 'off' })));
    const policy = policyManifest(file);
    if (options.output) await save(options.output, policy); else console.log(JSON.stringify(policy, null, 2));
    return;
  }
  if (command === 'analytics') {
    const tokenEnvironment = options['token-env'] || 'MERIDIAN_CONSENT_READ_TOKEN';
    const groupBy = options['impact-manifest'] ? 'event' : (options['group-by'] || 'day');
    const result = await fetchConsentImpactSummary({ endpoint: options.endpoint, siteId: options.site, from: options.from, to: options.to, groupBy, token: process.env[tokenEnvironment] });
    const exposures = options['impact-manifest'] ? exposureRows(result, await json(options['impact-manifest'])) : null;
    const format = options.format || 'table';
    if (!['table', 'json', 'csv'].includes(format)) throw new Error('--format must be table, json, or csv.');
    const serialized = format === 'json'
      ? `${JSON.stringify(exposures ? { ...result, exposures } : result, null, 2)}\n`
      : format === 'csv'
        ? exposures ? exposureCsv(exposures) : summaryCsv(result)
        : null;
    if (options.output) {
      if (!serialized) throw new Error('--output requires --format json or --format csv.');
      await save(options.output, serialized);
    } else if (serialized) process.stdout.write(serialized);
    else if (exposures) { console.table(exposureTable(exposures)); console.log(result.totals); }
    else { console.table(summaryTable(result.rows)); console.log(result.totals); }
    return;
  }
  if (!file) throw new Error(`The ${command} command requires an input file.`);
  if (command === 'scan') {
    const providerRegistry = options.registry ? await json(options.registry) : DEFAULT_REGISTRY;
    const report = scanContainer(await json(file), { registry: providerRegistry });
    console.table(formatReportTable(report));
    console.log(report.summary);
    if (options.output) await save(options.output, report);
    return;
  }
  if (command === 'plan') return save(options.output || 'meridian-consent-plan.json', createApprovalManifest(await json(file)));
  if (command === 'review') {
    const reviewed = await review(await json(file));
    const reviewPath = options.output || file.replace(/\.json$/i, '.reviewed.json');
    return save(reviewPath === file ? `${file}.reviewed.json` : reviewPath, reviewed);
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

runCommand(argsOf(process.argv.slice(2))).catch((error) => {
  console.error(`${brand(true)}: ${tone('31', error.message)}`);
  process.exitCode = 1;
});
