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
