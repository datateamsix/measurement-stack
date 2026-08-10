import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_REGISTRY } from '../classifier/index.js';
import {
  buildScanEvidence,
  classifyObservation,
  normalizedUrl,
  parseRobots,
  robotsAllows,
  scanProfiles,
  selectPages,
  sitemapUrls,
  writeSiteScanOutputs,
} from '../scanner/index.js';

test('site discovery normalizes variants and removes common campaign parameters', () => {
  assert.equal(
    normalizedUrl('/pricing/?utm_source=test&plan=team#details', 'https://EXAMPLE.com/'),
    'https://example.com/pricing?plan=team',
  );
  assert.equal(normalizedUrl('javascript:alert(1)', 'https://example.com'), null);
  assert.equal(normalizedUrl('https://user:secret@example.com'), null);
});

test('robots parser uses the longest matching allow or disallow rule', () => {
  const robots = parseRobots(`
    User-agent: *
    Disallow: /private/
    Allow: /private/public/
    Sitemap: https://example.com/sitemap.xml
  `);
  assert.equal(robotsAllows('https://example.com/private/report', robots), false);
  assert.equal(robotsAllows('https://example.com/private/public/guide', robots), true);
  assert.deepEqual(robots.sitemaps, ['https://example.com/sitemap.xml']);
});

test('page planner prioritizes explicit and main-navigation pages and caps the sample', () => {
  const robots = parseRobots('User-agent: *\nDisallow: /admin');
  const plan = selectPages({
    startUrl: 'https://example.com',
    include: ['/campaign', '/admin'],
    navigation: [
      { url: '/products', label: 'Products' },
      { url: '/pricing', label: 'Pricing', cta: true },
      { url: '/privacy', label: 'Privacy' },
    ],
    sitemap: ['/about', '/blog/post-one'],
    robots,
    maxPages: 4,
  });
  assert.deepEqual(plan.pages.map((page) => new URL(page.url).pathname), ['/', '/campaign', '/pricing', '/products']);
  assert.ok(plan.excluded.some((page) => page.reason === 'robots_disallowed'));
  assert.ok(plan.excluded.some((page) => page.reason === 'outside_scan_scope'));
});

test('sitemap parser extracts unique normalized locations', () => {
  const xml = '<urlset><url><loc>https://example.com/a/</loc></url><url><loc>https://example.com/a/?utm_source=x</loc></url><url><loc>/b</loc></url></urlset>';
  assert.deepEqual(sitemapUrls(xml, 'https://example.com'), ['https://example.com/a', 'https://example.com/b']);
});

test('profile selection exposes quick and full audits explicitly', () => {
  assert.deepEqual(scanProfiles(), ['baseline', 'reject', 'accept', 'gpc']);
  assert.deepEqual(scanProfiles(null, true), ['baseline', 'reject', 'accept', 'gpc', 'analytics', 'withdraw']);
  assert.throws(() => scanProfiles('accept,unknown'), /Unknown scan profile/);
});

test('site observations reuse versioned provider domain, cookie, and storage signatures', () => {
  assert.equal(classifyObservation({ name: '_ga_GTM123', domain: '.example.com' }).provider_id, 'google.analytics.ga4');
  assert.equal(classifyObservation({ name: '_hjSessionUser_42', domain: '.example.com' }).provider_id, 'hotjar.analytics');
  assert.equal(classifyObservation({ name: 'AMP_unsent_project-key', hostname: 'example.com' }).provider_id, 'amplitude.analytics');
  assert.equal(classifyObservation({ hostname: 'www.google-analytics.com' }).provider_id, 'google.analytics.ga4');
});

function run(profile, overrides = {}) {
  return {
    profile,
    page: { url: 'https://example.com/', source: 'homepage', position: 1 },
    status: 200,
    error: null,
    consent_action: { applied: true, adapter: profile === 'baseline' || profile === 'gpc' ? 'none' : 'meridian' },
    requests: [],
    response_cookies: [],
    cookies: [],
    storage: [],
    frames: [],
    service_workers: [],
    consent: { meridian: null, google_consent_commands: [] },
    ...overrides,
  };
}

test('scan evidence inventories names without retaining browser values and produces behavioral findings', () => {
  const metaRequest = {
    page_url: 'https://example.com/',
    url_origin: 'https://www.facebook.com',
    hostname: 'www.facebook.com',
    path: '/tr',
    method: 'POST',
    resource_type: 'image',
    first_party: false,
    query_fields: ['event', 'page_location'],
    body_fields: [],
    values_recorded: false,
  };
  const metaCookie = {
    page_url: 'https://example.com/',
    name: '_fbp',
    domain: '.example.com',
    path: '/',
    expires: 1_800_000_000,
    session: false,
    secure: true,
    http_only: false,
    same_site: 'Lax',
    partition_key: null,
    first_party: true,
    value_recorded: false,
  };
  const runs = [
    run('baseline', { requests: [metaRequest], cookies: [metaCookie] }),
    run('reject', { requests: [metaRequest] }),
    run('accept', { requests: [metaRequest], cookies: [metaCookie], storage: [{ origin: 'https://example.com', local_storage_keys: ['vendor_id'], session_storage_keys: [], indexeddb_databases: [], cache_storage_names: [] }] }),
    run('gpc', { requests: [metaRequest] }),
    run('withdraw', { cookies: [metaCookie] }),
  ];
  const plan = { start_url: 'https://example.com/', pages: [runs[0].page] };
  const evidence = buildScanEvidence({ plan, runs, registry: DEFAULT_REGISTRY, profiles: runs.map((item) => item.profile) });
  assert.equal(evidence.inventories.cookies[0].value_recorded, false);
  assert.equal(evidence.inventories.network[0].values_recorded, false);
  assert.deepEqual(evidence.inventories.network[0].query_fields, ['event', 'page_location']);
  assert.ok(evidence.findings.some((item) => item.code === 'nonessential_before_choice'));
  assert.ok(evidence.findings.some((item) => item.code === 'nonessential_after_reject'));
  assert.ok(evidence.findings.some((item) => item.code === 'advertising_observed_with_gpc'));
  assert.ok(evidence.findings.some((item) => item.code === 'cookie_persists_after_withdrawal'));
  assert.ok(evidence.limitations.some((item) => item.includes('not an exhaustive crawl')));
});

test('site-scan writer emits the stable MVP evidence package', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meridian-site-scan-'));
  const plan = { schema_version: '1.0', start_url: 'https://example.com/', pages: [{ url: 'https://example.com/', source: 'homepage', position: 1 }], discovery: {} };
  const evidence = buildScanEvidence({ plan, runs: [run('baseline')], registry: DEFAULT_REGISTRY, profiles: ['baseline'] });
  await writeSiteScanOutputs(directory, { status: 'complete', plan, evidence });
  const files = await readdir(directory);
  for (const expected of ['scan-plan.json', 'scan-evidence.json', 'scan-findings.json', 'site-scan-report.md', 'technology-inventory.csv', 'cookie-inventory.csv', 'storage-inventory.csv', 'network-destinations.csv', 'consent-state-comparison.csv', 'disclosure-inventory.csv']) {
    assert.ok(files.includes(expected), `missing ${expected}`);
  }
  const stored = JSON.parse(await readFile(join(directory, 'scan-evidence.json'), 'utf8'));
  assert.equal(stored.scanner.values_recorded, false);
});
