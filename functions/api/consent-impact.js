import { errorResponse, HttpError, json, readJson, text } from '../lib/http.js';
import {
  geographicBucket,
  impactSummary,
  incrementImpact,
  normalizeImpactEnvelope,
} from '../lib/consent-impact.js';

const MAX_IMPACT_BYTES = 4_096;
const MAX_RANGE_DAYS = 93;

function originHeaders(request, env) {
  const origin = text(request.headers.get('origin'), 500);
  if (!origin) return {};
  const requestOrigin = new URL(request.url).origin;
  const configured = text(env.CONSENT_ANALYTICS_ALLOWED_ORIGINS, 4000)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (origin !== requestOrigin && !configured.includes(origin)) {
    throw new HttpError(403, 'Origin is not allowed.');
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

async function secureEqual(left, right) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function requireReadToken(request, env) {
  const expected = text(env.CONSENT_ANALYTICS_READ_TOKEN, 1000);
  if (!expected) throw new HttpError(503, 'Consent analytics read access is not configured.');
  const authorization = text(request.headers.get('authorization'), 1200);
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!supplied || !(await secureEqual(supplied, expected))) throw new HttpError(401, 'Unauthorized.');
}

function dateBoundary(value, fallback) {
  const candidate = value || fallback;
  const date = new Date(candidate);
  if (!Number.isFinite(date.getTime())) throw new HttpError(400, 'from and to must be valid dates.');
  return date.toISOString();
}

export async function onRequestOptions({ request, env }) {
  try {
    return new Response(null, { status: 204, headers: originHeaders(request, env) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const headers = originHeaders(request, env);
    const input = await readJson(request, MAX_IMPACT_BYTES);
    const impact = normalizeImpactEnvelope(input, env);
    await incrementImpact(env, impact, geographicBucket(request));
    return json({ accepted: true }, 202, headers);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function onRequestGet({ request, env }) {
  try {
    const headers = originHeaders(request, env);
    await requireReadToken(request, env);
    const url = new URL(request.url);
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 86400000).toISOString();
    const from = dateBoundary(url.searchParams.get('from'), defaultFrom);
    const to = dateBoundary(url.searchParams.get('to'), now.toISOString());
    if (new Date(to) <= new Date(from)) throw new HttpError(400, 'to must be after from.');
    if (new Date(to) - new Date(from) > MAX_RANGE_DAYS * 86400000) {
      throw new HttpError(400, `Date range cannot exceed ${MAX_RANGE_DAYS} days.`);
    }
    const siteId = text(url.searchParams.get('site_id'), 64).toLowerCase();
    const groupBy = text(url.searchParams.get('group_by'), 20) || 'day';
    const rows = await impactSummary(env, { siteId, from, to, groupBy });
    const totals = rows.reduce((result, row) => {
      for (const key of [
        'total_events', 'observed_events', 'consent_denied_events',
        'advertising_eligible_events', 'advertising_blocked_events',
      ]) result[key] += Number(row[key] || 0);
      return result;
    }, {
      total_events: 0,
      observed_events: 0,
      consent_denied_events: 0,
      advertising_eligible_events: 0,
      advertising_blocked_events: 0,
    });
    totals.analytics_denied_rate = totals.total_events
      ? totals.consent_denied_events / totals.total_events
      : 0;
    totals.advertising_blocked_rate = totals.total_events
      ? totals.advertising_blocked_events / totals.total_events
      : 0;
    return json({ schema_version: '1.0', site_id: siteId, from, to, group_by: groupBy, totals, rows }, 200, headers);
  } catch (error) {
    return errorResponse(error);
  }
}
