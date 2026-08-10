import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DEFAULT_REGISTRY } from '../classifier/index.js';
import { discoverRobots, discoverSitemap, normalizedUrl, selectPages } from './discovery.js';
import { FULL_PROFILES, loadPlaywright, navigationLinks, QUICK_PROFILES, scanWithBrowser } from './browser.js';
import { buildScanEvidence, CSV_COLUMNS, rowsCsv, scanReportMarkdown } from './reporting.js';

export { FULL_PROFILES, QUICK_PROFILES } from './browser.js';
export * from './classification.js';
export * from './discovery.js';
export * from './reporting.js';

const SUPPORTED_PROFILES = new Set(FULL_PROFILES);

export function scanProfiles(value, full = false) {
  const profiles = value ? String(value).split(',').map((item) => item.trim()).filter(Boolean) : full ? FULL_PROFILES : QUICK_PROFILES;
  if (!profiles.length) throw new TypeError('At least one scan profile is required.');
  for (const profile of profiles) {
    if (!SUPPORTED_PROFILES.has(profile)) throw new TypeError(`Unknown scan profile: ${profile}. Use ${FULL_PROFILES.join(', ')}.`);
  }
  return [...new Set(profiles)];
}

function destinationRows(network) {
  const byHostname = new Map();
  for (const row of network) {
    const current = byHostname.get(row.hostname) || {
      hostname: row.hostname,
      first_party: row.first_party,
      provider_id: row.provider_id,
      provider: row.provider,
      product: row.product,
      purposes: row.purposes,
      required_consent: row.required_consent,
      observed_profiles: [],
      observed_pages: [],
      resource_types: [],
      request_paths: [],
      query_fields: [],
      body_fields: [],
      values_recorded: false,
    };
    current.observed_profiles = [...new Set([...current.observed_profiles, ...row.observed_profiles])].sort();
    current.observed_pages = [...new Set([...current.observed_pages, ...row.observed_pages])].sort();
    current.resource_types = [...new Set([...current.resource_types, row.resource_type])].sort();
    current.request_paths = [...new Set([...current.request_paths, row.path])].sort();
    current.query_fields = [...new Set([...current.query_fields, ...row.query_fields])].sort();
    current.body_fields = [...new Set([...current.body_fields, ...row.body_fields])].sort();
    byHostname.set(row.hostname, current);
  }
  return [...byHostname.values()].sort((a, b) => a.hostname.localeCompare(b.hostname));
}

export async function createScanPlan(startUrl, browser, options = {}) {
  const normalized = normalizedUrl(startUrl);
  if (!normalized) throw new TypeError('Site scan requires a valid HTTP or HTTPS starting URL.');
  const [robots, discoveredNavigation] = await Promise.all([
    discoverRobots(normalized, options),
    navigationLinks(browser, normalized, options),
  ]);
  const navigation = options.exactPages ? [] : discoveredNavigation;
  const sitemap = options.singlePage || options.exactPages ? { urls: [], sources: [] } : await discoverSitemap(normalized, robots, options);
  const plan = selectPages({
    startUrl: normalized,
    navigation,
    sitemap: sitemap.urls,
    include: options.include || [],
    robots,
    maxPages: options.maxPages || 10,
    singlePage: options.singlePage,
  });
  return {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    ...plan,
    discovery: {
      navigation_links_found: discoveredNavigation.length,
      sitemap_urls_found: sitemap.urls.length,
      robots: { url: robots.url, found: robots.found, sitemap_urls: robots.sitemaps },
      sitemaps: sitemap.sources,
    },
  };
}

export async function runSiteScan(startUrl, options = {}) {
  const playwright = options.playwright || await loadPlaywright();
  let browser;
  try {
    browser = options.browser || await playwright.chromium.launch({ headless: !options.headed });
  } catch (error) {
    const wrapped = new Error('Chromium could not start. Run "npx playwright install chromium" and retry.');
    wrapped.cause = error;
    throw wrapped;
  }
  try {
    const plan = await createScanPlan(startUrl, browser, options);
    if (typeof options.onPlan === 'function') await options.onPlan(plan);
    if (options.dryRun) return { status: 'planned', plan, evidence: null };
    const profiles = scanProfiles(options.profiles, options.full);
    const runs = await scanWithBrowser(browser, plan, { ...options, profiles });
    const evidence = buildScanEvidence({
      plan,
      runs,
      profiles,
      registry: options.registry || DEFAULT_REGISTRY,
      metadata: {
        version: '0.1.0',
        robots: plan.discovery.robots,
        sitemaps: plan.discovery.sitemaps,
      },
    });
    return { status: 'complete', plan, evidence };
  } finally {
    if (!options.browser && browser) await browser.close();
  }
}

async function save(path, value) {
  const serialized = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path, serialized, 'utf8');
}

export async function writeSiteScanOutputs(directory, result) {
  const output = resolve(directory);
  await mkdir(output, { recursive: true });
  const files = [['scan-plan.json', result.plan]];
  if (result.evidence) {
    const evidence = result.evidence;
    const destinations = destinationRows(evidence.inventories.network);
    const comparisonColumns = ['provider', 'product', 'evidence_types', ...evidence.scope.profiles];
    const findingEnvelope = { schema_version: evidence.schema_version, generated_at: evidence.generated_at, findings: evidence.findings };
    files.push(
      ['scan-evidence.json', evidence],
      ['scan-findings.json', findingEnvelope],
      ['site-scan-report.md', scanReportMarkdown(evidence)],
      ['technology-inventory.csv', rowsCsv(evidence.inventories.technologies, CSV_COLUMNS.technologies)],
      ['cookie-inventory.csv', rowsCsv(evidence.inventories.cookies, CSV_COLUMNS.cookies)],
      ['storage-inventory.csv', rowsCsv(evidence.inventories.storage, CSV_COLUMNS.storage)],
      ['network-destinations.csv', rowsCsv(destinations, ['hostname', 'first_party', 'provider_id', 'provider', 'product', 'purposes', 'required_consent', 'observed_profiles', 'observed_pages', 'resource_types', 'request_paths', 'query_fields', 'body_fields', 'values_recorded'])],
      ['consent-state-comparison.csv', rowsCsv(evidence.consent_state_comparison, comparisonColumns)],
      ['disclosure-inventory.csv', rowsCsv(evidence.inventories.technologies, CSV_COLUMNS.technologies)],
    );
  }
  for (const [name, value] of files) await save(join(output, name), value);
  return { directory: output, files: files.map(([name]) => join(output, name)) };
}
