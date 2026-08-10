import { classifyObservation, isAdvertising } from './classification.js';

function keyOf(row, keys) {
  return keys.map((key) => JSON.stringify(row[key] ?? null)).join('|');
}

function mergedRows(rows, keys, profileKey = 'observed_profiles') {
  const byKey = new Map();
  for (const row of rows) {
    const key = keyOf(row, keys);
    const current = byKey.get(key) || { ...row, [profileKey]: [], observed_pages: [], first_observed_page: row.page_url || null };
    current[profileKey] = [...new Set([...current[profileKey], row.profile])].sort();
    current.observed_pages = [...new Set([...current.observed_pages, row.page_url].filter(Boolean))].sort();
    delete current.profile;
    delete current.page_url;
    byKey.set(key, current);
  }
  return [...byKey.values()];
}

function classificationFields(observation, registry) {
  const classification = classifyObservation(observation, registry);
  return {
    provider_id: classification.provider_id,
    provider: classification.provider,
    product: classification.product,
    purposes: classification.purposes,
    required_consent: classification.required_consent,
    enforcement: classification.enforcement,
    classification_confidence: classification.confidence,
    classification_evidence: classification.evidence,
  };
}

function cookieInventory(runs, registry) {
  const rows = runs.flatMap((run) => run.cookies.map((cookie) => ({ profile: run.profile, ...cookie, ...classificationFields(cookie, registry) })));
  return mergedRows(rows, ['name', 'domain', 'path', 'first_party', 'partition_key']);
}

function storageInventory(runs, registry) {
  const rows = [];
  for (const run of runs) {
    for (const storage of run.storage) {
      const hostname = (() => { try { return new URL(storage.origin).hostname; } catch { return null; } })();
      for (const [type, keys] of [
        ['local_storage', storage.local_storage_keys],
        ['session_storage', storage.session_storage_keys],
        ['cache_storage', storage.cache_storage_names],
      ]) {
        for (const name of keys) rows.push({
          profile: run.profile,
          page_url: run.page.url,
          origin: storage.origin,
          hostname,
          storage_type: type,
          name,
          value_recorded: false,
          ...classificationFields({ hostname, name }, registry),
        });
      }
      for (const database of storage.indexeddb_databases) {
        rows.push({
          profile: run.profile,
          page_url: run.page.url,
          origin: storage.origin,
          hostname,
          storage_type: 'indexeddb',
          name: database.name,
          value_recorded: false,
          ...classificationFields({ hostname, name: database.name }, registry),
        });
        for (const objectStore of database.object_stores || []) rows.push({
          profile: run.profile,
          page_url: run.page.url,
          origin: storage.origin,
          hostname,
          storage_type: 'indexeddb_object_store',
          name: `${database.name}/${objectStore}`,
          value_recorded: false,
          ...classificationFields({ hostname, name: objectStore }, registry),
        });
      }
    }
  }
  return mergedRows(rows, ['origin', 'storage_type', 'name']);
}

function networkInventory(runs, registry) {
  const rows = runs.flatMap((run) => run.requests.map((request) => ({ profile: run.profile, ...request, ...classificationFields(request, registry) })));
  const merged = mergedRows(rows, ['hostname', 'path', 'method', 'resource_type', 'first_party']);
  for (const row of merged) {
    row.query_fields = [...new Set(rows.filter((item) => item.hostname === row.hostname && item.path === row.path).flatMap((item) => item.query_fields))].sort();
    row.body_fields = [...new Set(rows.filter((item) => item.hostname === row.hostname && item.path === row.path).flatMap((item) => item.body_fields))].sort();
  }
  return merged;
}

function technologyInventory(cookies, storage, network) {
  const rows = [...cookies.map((row) => ({ type: 'cookie', name: row.name, ...row })),
    ...storage.map((row) => ({ type: row.storage_type, ...row })),
    ...network.map((row) => ({ type: row.resource_type === 'script' ? 'script' : row.resource_type === 'image' ? 'pixel' : 'network', name: row.hostname, ...row }))];
  const byProvider = new Map();
  for (const row of rows) {
    const id = row.provider_id || `unknown:${row.type}:${row.name}:${row.hostname || row.domain || row.origin || ''}`;
    const current = byProvider.get(id) || {
      provider_id: row.provider_id,
      provider: row.provider,
      product: row.product,
      purposes: row.purposes || [],
      required_consent: row.required_consent || [],
      enforcement: row.enforcement,
      confidence: row.classification_confidence,
      observed_profiles: [],
      observed_pages: [],
      evidence_types: [],
      cookies: [],
      storage_keys: [],
      destinations: [],
      disclosure_status: row.provider_id ? 'registry_match_review' : 'manual_review',
    };
    current.observed_profiles = [...new Set([...current.observed_profiles, ...(row.observed_profiles || [])])].sort();
    current.observed_pages = [...new Set([...current.observed_pages, ...(row.observed_pages || [])])].sort();
    current.evidence_types = [...new Set([...current.evidence_types, row.type])].sort();
    if (row.type === 'cookie') current.cookies = [...new Set([...current.cookies, row.name])].sort();
    else if (row.type === 'network') current.destinations = [...new Set([...current.destinations, row.hostname])].sort();
    else current.storage_keys = [...new Set([...current.storage_keys, `${row.storage_type}:${row.name}`])].sort();
    byProvider.set(id, current);
  }
  return [...byProvider.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.product.localeCompare(b.product));
}

function observedIn(row, profile) {
  return row.observed_profiles.includes(profile);
}

function finding(severity, code, technology, profile, message, evidence) {
  return { severity, code, technology, profile, message, evidence };
}

function findingsFor(technologies, cookies, storage, network, runs) {
  const findings = [];
  for (const technology of technologies) {
    const classification = { purposes: technology.purposes };
    const nonEssential = technology.enforcement && !['essential', 'unresolved'].includes(technology.enforcement);
    if (nonEssential && observedIn(technology, 'baseline')) {
      findings.push(finding('potential_issue', 'nonessential_before_choice', technology.product, 'baseline', `${technology.product} was observed before a consent choice.`, technology.evidence_types));
    }
    if (nonEssential && observedIn(technology, 'reject')) {
      findings.push(finding('potential_issue', 'nonessential_after_reject', technology.product, 'reject', `${technology.product} was observed after optional consent was rejected.`, technology.evidence_types));
    }
    if (isAdvertising(classification) && observedIn(technology, 'gpc')) {
      findings.push(finding('potential_issue', 'advertising_observed_with_gpc', technology.product, 'gpc', `${technology.product} advertising behavior was observed while GPC was enabled.`, technology.evidence_types));
    }
  }
  for (const accepted of cookies.filter((row) => observedIn(row, 'accept'))) {
    if (observedIn(accepted, 'withdraw') && accepted.enforcement !== 'essential') {
      findings.push(finding('manual_review', 'cookie_persists_after_withdrawal', accepted.name, 'withdraw', `${accepted.name} remained present after consent withdrawal.`, { domain: accepted.domain, path: accepted.path }));
    }
  }
  for (const accepted of storage.filter((row) => observedIn(row, 'accept'))) {
    if (observedIn(accepted, 'withdraw') && accepted.enforcement !== 'essential') {
      findings.push(finding('manual_review', 'storage_persists_after_withdrawal', accepted.name, 'withdraw', `${accepted.storage_type} key ${accepted.name} remained after consent withdrawal.`, { origin: accepted.origin }));
    }
  }
  for (const run of runs.filter((item) => ['reject', 'accept', 'analytics', 'withdraw'].includes(item.profile) && !item.consent_action.applied)) {
    findings.push(finding('unable_to_test', 'consent_action_unavailable', run.page.url, run.profile, `The ${run.profile} consent state could not be established.`, null));
  }
  for (const run of runs.filter((item) => item.error)) {
    findings.push(finding('unable_to_test', 'page_scan_failed', run.page.url, run.profile, run.error, null));
  }
  const unique = new Map(findings.map((item) => [keyOf(item, ['code', 'technology', 'profile']), item]));
  return [...unique.values()];
}

function comparison(technologies, profiles) {
  return technologies.map((technology) => ({
    provider: technology.provider,
    product: technology.product,
    evidence_types: technology.evidence_types,
    ...Object.fromEntries(profiles.map((profile) => [profile, technology.observed_profiles.includes(profile) ? 'observed' : 'not_observed'])),
  }));
}

export function buildScanEvidence({ plan, runs, registry, profiles, metadata = {} }) {
  const cookies = cookieInventory(runs, registry);
  const storage = storageInventory(runs, registry);
  const network = networkInventory(runs, registry);
  const technologies = technologyInventory(cookies, storage, network);
  const findings = findingsFor(technologies, cookies, storage, network, runs);
  const successful = runs.filter((run) => !run.error).length;
  return {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    scanner: { name: 'Meridian Site Scan', version: metadata.version || '0.1.0', values_recorded: false },
    scope: {
      start_url: plan.start_url,
      pages: plan.pages,
      profiles,
      planned_visits: plan.pages.length * profiles.length,
      completed_visits: successful,
      robots: metadata.robots || null,
      sitemaps: metadata.sitemaps || [],
    },
    summary: {
      pages: plan.pages.length,
      profiles: profiles.length,
      technologies: technologies.length,
      cookies: cookies.length,
      storage_items: storage.length,
      network_destinations: new Set(network.map((row) => row.hostname)).size,
      potential_issues: findings.filter((item) => item.severity === 'potential_issue').length,
      manual_review: findings.filter((item) => item.severity === 'manual_review').length,
      unable_to_test: findings.filter((item) => item.severity === 'unable_to_test').length,
    },
    inventories: { technologies, cookies, storage, network },
    consent_state_comparison: comparison(technologies, profiles),
    findings,
    page_runs: runs.map((run) => ({
      profile: run.profile,
      url: run.page.url,
      status: run.status,
      error: run.error,
      consent_action: run.consent_action,
      gpc_detected: run.consent?.gpc_detected === true,
      meridian_state: run.consent?.meridian || null,
      google_consent_commands: run.consent?.google_consent_commands || [],
      third_party_iframes: run.frames,
      service_workers: run.service_workers,
      set_cookie_activity: run.response_cookies,
    })),
    limitations: [
      'This is a representative sample, not an exhaustive crawl.',
      'Observed storage and request field names do not prove every value a vendor collects or its legal purpose.',
      'CNAME-cloaked or server-proxied vendor traffic can appear first-party and may require DNS or server review.',
      'Not observed means not observed in the selected pages and states; it does not prove absence.',
      'Findings require technical and legal review and are not a compliance certification.',
    ],
  };
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join('|') : typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function rowsCsv(rows, columns) {
  return `${columns.join(',')}\n${rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')).join('\n')}\n`;
}

export function scanReportMarkdown(evidence) {
  const summary = evidence.summary;
  const findings = evidence.findings.length
    ? evidence.findings.map((item) => `- **${item.severity.replaceAll('_', ' ')} — ${item.code}:** ${item.message}`).join('\n')
    : '- No evidence-based findings were produced for the scanned sample.';
  const pages = evidence.scope.pages.map((page) => `${page.position}. [${page.label || new URL(page.url).pathname}](${page.url}) — ${page.source}`).join('\n');
  return `# Meridian Site Scan report\n\n- Starting URL: ${evidence.scope.start_url}\n- Pages sampled: ${summary.pages}\n- Consent states: ${evidence.scope.profiles.join(', ')}\n- Browser visits completed: ${evidence.scope.completed_visits}/${evidence.scope.planned_visits}\n- Technologies observed: ${summary.technologies}\n- Cookies observed: ${summary.cookies}\n- Browser-storage items observed: ${summary.storage_items}\n- Network destinations observed: ${summary.network_destinations}\n\n## Selected pages\n\n${pages}\n\n## Findings\n\n${findings}\n\n## Interpretation\n\nMeridian records cookie names, storage key names, request field names, and destinations; it does not retain cookie values, storage values, query values, or request-body values. This report describes observed browser behavior and does not issue a universal compliant/non-compliant verdict.\n\n## Limitations\n\n${evidence.limitations.map((item) => `- ${item}`).join('\n')}\n`;
}

export const CSV_COLUMNS = Object.freeze({
  technologies: ['provider_id', 'provider', 'product', 'purposes', 'required_consent', 'enforcement', 'confidence', 'observed_profiles', 'observed_pages', 'evidence_types', 'cookies', 'storage_keys', 'destinations', 'disclosure_status'],
  cookies: ['name', 'domain', 'path', 'session', 'expires', 'secure', 'http_only', 'same_site', 'partition_key', 'first_party', 'provider_id', 'provider', 'product', 'purposes', 'required_consent', 'classification_confidence', 'observed_profiles', 'observed_pages', 'first_observed_page', 'value_recorded'],
  storage: ['origin', 'hostname', 'storage_type', 'name', 'provider_id', 'provider', 'product', 'purposes', 'required_consent', 'classification_confidence', 'observed_profiles', 'observed_pages', 'first_observed_page', 'value_recorded'],
  network: ['hostname', 'path', 'method', 'resource_type', 'first_party', 'provider_id', 'provider', 'product', 'purposes', 'required_consent', 'classification_confidence', 'observed_profiles', 'observed_pages', 'first_observed_page', 'query_fields', 'body_fields', 'values_recorded'],
});
