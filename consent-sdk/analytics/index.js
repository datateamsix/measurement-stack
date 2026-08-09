export async function fetchConsentImpactSummary({ endpoint, siteId, from, to, groupBy = 'day', token }) {
  if (!endpoint) throw new Error('analytics requires --endpoint.');
  if (!siteId) throw new Error('analytics requires --site.');
  if (!token) throw new Error('Set MERIDIAN_CONSENT_READ_TOKEN or pass --token-env with a configured environment variable.');
  const url = new URL(endpoint);
  url.searchParams.set('site_id', siteId);
  url.searchParams.set('group_by', groupBy);
  if (from) url.searchParams.set('from', from);
  if (to) url.searchParams.set('to', to);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Consent analytics returned HTTP ${response.status}.`);
  return result;
}

export function summaryTable(rows) {
  return rows.map((row) => {
    const total = Number(row.total_events || 0);
    const denied = Number(row.consent_denied_events || 0);
    const adsBlocked = Number(row.advertising_blocked_events || 0);
    return {
      Dimension: row.dimension,
      Events: total,
      Observed: Number(row.observed_events || 0),
      'Consent denied': denied,
      'Denied %': total ? `${(denied / total * 100).toFixed(1)}%` : '0.0%',
      'Ads eligible': Number(row.advertising_eligible_events || 0),
      'Ads blocked': adsBlocked,
      'Ads blocked %': total ? `${(adsBlocked / total * 100).toFixed(1)}%` : '0.0%',
    };
  });
}

function csvCell(value) {
  const string = String(value ?? '');
  return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

export function summaryCsv(result) {
  const columns = [
    'schema_version',
    'site_id',
    'period_start',
    'period_end',
    'group_by',
    'dimension',
    'total_events',
    'observed_events',
    'consent_denied_events',
    'analytics_denied_rate',
    'advertising_eligible_events',
    'advertising_blocked_events',
    'advertising_blocked_rate',
  ];
  const rows = result.rows.map((row) => {
    const total = Number(row.total_events || 0);
    const denied = Number(row.consent_denied_events || 0);
    const blocked = Number(row.advertising_blocked_events || 0);
    return {
      schema_version: result.schema_version,
      site_id: result.site_id,
      period_start: result.from,
      period_end: result.to,
      group_by: result.group_by,
      dimension: row.dimension,
      total_events: total,
      observed_events: Number(row.observed_events || 0),
      consent_denied_events: denied,
      analytics_denied_rate: total ? denied / total : 0,
      advertising_eligible_events: Number(row.advertising_eligible_events || 0),
      advertising_blocked_events: blocked,
      advertising_blocked_rate: total ? blocked / total : 0,
    };
  });
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n') + '\n';
}

function affectedCount(row, rule) {
  if (rule.outcome_when_denied === 'modeled_signal') return Number(row.consent_denied_events || 0);
  if (rule.outcome_when_denied === 'blocked') {
    const advertising = rule.consent_required?.some((type) => type.startsWith('ad_'));
    return Number(advertising ? row.advertising_blocked_events : row.consent_denied_events || 0);
  }
  return 0;
}

export function exposureRows(result, manifest) {
  if (result?.group_by !== 'event') throw new TypeError('Exposure analysis requires analytics grouped by event.');
  if (manifest?.schema_version !== '1.0' || !Array.isArray(manifest.rules)) throw new TypeError('Invalid Meridian impact manifest.');
  const rulesByEvent = new Map();
  for (const rule of manifest.rules) {
    if (!rulesByEvent.has(rule.event_name)) rulesByEvent.set(rule.event_name, []);
    rulesByEvent.get(rule.event_name).push(rule);
  }
  return result.rows.flatMap((row) => (rulesByEvent.get(row.dimension) || []).map((rule) => ({
    schema_version: '1.0',
    site_id: result.site_id,
    period_start: result.from,
    period_end: result.to,
    event_name: row.dimension,
    tag_id: rule.tag_id,
    tag_name: rule.tag_name,
    provider_id: rule.provider_id,
    trigger_confidence: rule.trigger_confidence,
    measurement_class: rule.measurement_class,
    consent_required: (rule.consent_required || []).join('|'),
    outcome_when_denied: rule.outcome_when_denied,
    measurement_opportunities: Number(row.total_events || 0),
    affected_opportunities: affectedCount(row, rule),
  })));
}

export function exposureCsv(rows) {
  const columns = [
    'schema_version', 'site_id', 'period_start', 'period_end', 'event_name',
    'tag_id', 'tag_name', 'provider_id', 'trigger_confidence', 'measurement_class',
    'consent_required', 'outcome_when_denied', 'measurement_opportunities', 'affected_opportunities',
  ];
  return `${columns.join(',')}\n${rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')).join('\n')}\n`;
}

export function exposureTable(rows) {
  return rows.map((row) => ({
    Event: row.event_name,
    Tag: row.tag_name,
    Provider: row.provider_id || 'Unknown',
    Outcome: row.outcome_when_denied,
    Opportunities: row.measurement_opportunities,
    Affected: row.affected_opportunities,
    Confidence: row.trigger_confidence,
  }));
}
