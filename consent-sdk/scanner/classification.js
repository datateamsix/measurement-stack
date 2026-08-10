import { DEFAULT_REGISTRY } from '../classifier/index.js';

function lower(value) {
  return String(value || '').toLowerCase();
}

function domainMatch(hostname, pattern) {
  const host = lower(hostname).replace(/^\./, '');
  const candidate = lower(pattern).replace(/^https?:\/\//, '').split('/')[0].replace(/^\./, '');
  return host === candidate || host.endsWith(`.${candidate}`) || candidate.endsWith(`.${host}`);
}

function nameMatch(name, pattern) {
  const escaped = lower(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`, 'i').test(name);
}

export function classifyObservation(observation, registry = DEFAULT_REGISTRY) {
  const hostname = observation.hostname || observation.domain || null;
  const name = lower(observation.name || observation.key || observation.script_url);
  const matches = [];
  for (const provider of registry.providers || []) {
    const domain = (provider.match?.hostnames || []).find((value) => hostname && domainMatch(hostname, value));
    const cookie = (provider.cookies || []).find((value) => nameMatch(name, value));
    const storage = (provider.storage_keys || []).find((value) => nameMatch(name, value));
    const signature = (provider.match?.code_contains || []).find((value) => name.includes(lower(value)));
    const score = domain ? 0.95 : cookie ? 0.9 : storage ? 0.9 : signature ? 0.85 : 0;
    if (score) matches.push({ provider, score, evidence: domain ? `hostname:${domain}` : cookie ? `cookie:${cookie}` : storage ? `storage:${storage}` : `signature:${signature}` });
  }
  matches.sort((a, b) => b.score - a.score || a.provider.id.localeCompare(b.provider.id));
  const best = matches[0];
  return best ? {
    provider_id: best.provider.id,
    provider: best.provider.provider,
    product: best.provider.product,
    purposes: best.provider.purposes,
    required_consent: best.provider.required_consent,
    enforcement: best.provider.enforcement,
    confidence: best.score,
    evidence: best.evidence,
  } : {
    provider_id: null,
    provider: 'Unknown',
    product: 'Unknown technology',
    purposes: [],
    required_consent: [],
    enforcement: 'unresolved',
    confidence: 0,
    evidence: null,
  };
}

export function isAdvertising(classification) {
  return classification.purposes.some((purpose) => ['advertising', 'remarketing', 'personalization'].includes(purpose));
}
