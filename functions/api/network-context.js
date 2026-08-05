import { json } from '../lib/http.js';

const DEFAULT_IP_MODE = 'anonymize_strict';
const DEFAULT_CLIENT_MODE = 'first_party_uuid';

function database(env) {
  return env.MEASURESTACK_DB || env.DB || null;
}

function safe(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeMode(value, allowed, fallback) {
  const normalized = safe(value, 50).toLowerCase().replace(/\s+/g, '_');
  return allowed.includes(normalized) ? normalized : fallback;
}

function anonymizeIpv4(ip, strict = false) {
  const parts = ip.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return '';
  return strict ? `${parts[0]}.${parts[1]}.0.0` : `${parts[0]}.${parts[1]}.${parts[2]}.0`;
}

function anonymizeIpv6(ip, strict = false) {
  if (!ip.includes(':')) return '';
  const expanded = ip.split(':');
  const keep = strict ? 2 : 3;
  return `${expanded.slice(0, keep).join(':')}::`;
}

function anonymizeIp(ip, mode, country) {
  if (!ip || mode === 'remove') return '';
  if (mode === 'leave_as_is') return ip;
  if (mode === 'anonymize_smart') return country ? `country:${country}` : 'country:unknown';
  const strict = mode === 'anonymize_strict';
  return ip.includes(':') ? anonymizeIpv6(ip, strict) : anonymizeIpv4(ip, strict);
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return base64Url(new Uint8Array(signature));
}

async function jsClientId({ ip, userAgent, browserId, mode, secret, observedAt }) {
  if (mode === 'remove') return '';
  if (mode === 'leave_as_is' || mode === 'first_party_uuid') return browserId;
  const month = observedAt.slice(0, 7);
  const material = mode === 'anonymize_strict'
    ? `${ip}|${userAgent}|${observedAt}`
    : `${ip}|${userAgent}|${month}`;
  const digest = secret
    ? await hmac(material, secret)
    : await sha256(`${browserId}|${mode === 'anonymize_strict' ? observedAt : month}`);
  return `jscid_${digest.slice(0, 43)}`;
}

async function storeObservation(env, observation) {
  const db = database(env);
  if (!db) return { configured: false };
  try {
    await db.prepare(`
      INSERT INTO network_observations (
        network_observation_id, browser_id, person_id, ip_mode, anonymized_ip,
        js_client_id, country_code, region_code, geoid, observed_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      observation.network_observation_id,
      observation.browser_id || null,
      null,
      observation.ip_mode,
      observation.anonymized_ip || null,
      observation.js_client_id || null,
      observation.country || null,
      observation.region || null,
      observation.geoid || null,
      observation.observed_at,
      observation.expires_at,
    ).run();
    return { configured: true, stored: true };
  } catch (error) {
    if (/no such table/i.test(error?.message || '')) return { configured: true, stored: false, migration_required: true };
    throw error;
  }
}

export async function onRequestGet({ request, env }) {
  const observedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
  const ip = safe(request.headers.get('cf-connecting-ip'), 100);
  const userAgent = safe(request.headers.get('user-agent'), 1000);
  const browserId = safe(request.headers.get('x-measurement-browser-id'), 100);
  const country = safe(request.cf?.country || request.headers.get('cf-ipcountry'), 10);
  const region = safe(request.cf?.region || request.cf?.regionCode, 100);
  const geoid = safe(request.cf?.metroCode || request.cf?.colo, 100);
  const ipMode = normalizeMode(
    env.IP_ANONYMIZATION_MODE,
    ['leave_as_is', 'anonymize', 'anonymize_strict', 'anonymize_smart', 'remove'],
    DEFAULT_IP_MODE,
  );
  const clientMode = normalizeMode(
    env.JS_CLIENT_ID_MODE,
    ['leave_as_is', 'first_party_uuid', 'anonymize', 'anonymize_strict', 'remove'],
    DEFAULT_CLIENT_MODE,
  );
  const observation = {
    network_observation_id: `network_${crypto.randomUUID()}`,
    browser_id: browserId,
    ip_mode: ipMode,
    anonymized_ip: anonymizeIp(ip, ipMode, country),
    js_client_id: await jsClientId({
      ip,
      userAgent,
      browserId: browserId || `browser_${crypto.randomUUID()}`,
      mode: clientMode,
      secret: safe(env.IDENTITY_HASH_SECRET, 500),
      observedAt,
    }),
    js_client_id_mode: clientMode,
    country,
    region,
    geoid,
    observed_at: observedAt,
    expires_at: expiresAt,
  };
  const storage = await storeObservation(env, observation);
  return json({
    ...observation,
    storage,
    raw_ip_returned: ipMode === 'leave_as_is',
    raw_user_agent_returned: false,
  });
}
