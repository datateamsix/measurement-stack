import { text } from './http.js';

export async function sendLoopsEvent(env, input) {
  if (!env.LOOPS_API_KEY) return { configured: false, delivered: false };
  const payload = {
    email: text(input.email, 254) || undefined,
    userId: text(input.userId, 100) || undefined,
    eventName: text(input.eventName, 100),
    eventProperties: input.eventProperties || {},
    ...(input.contactProperties || {}),
  };
  const response = await fetch('https://app.loops.so/api/v1/events/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.LOOPS_API_KEY}`,
      'Content-Type': 'application/json',
      ...(input.idempotencyKey ? { 'Idempotency-Key': text(input.idempotencyKey, 100) } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok && response.status !== 409) {
    const message = await response.text();
    throw new Error(`Loops returned ${response.status}: ${message.slice(0, 200)}`);
  }
  return { configured: true, delivered: true, status: response.status };
}

export async function sendServerEvent(env, event) {
  if (!env.SGTM_EVENT_ENDPOINT) return { configured: false, delivered: false };
  const eventName = text(event?.event_name, 100);
  if (!eventName) throw new Error('sGTM event_name is required.');

  const endpoint = new URL(env.SGTM_EVENT_ENDPOINT);
  const protocolVersion = text(env.SGTM_PROTOCOL_VERSION, 10) || '2';
  endpoint.searchParams.set('v', protocolVersion);
  endpoint.searchParams.set('event_name', eventName);

  const headers = { 'Content-Type': 'application/json' };
  if (env.SGTM_BEARER_TOKEN) headers.Authorization = `Bearer ${env.SGTM_BEARER_TOKEN}`;
  if (env.SGTM_PREVIEW_HEADER) headers['X-Gtm-Server-Preview'] = text(env.SGTM_PREVIEW_HEADER, 1000);

  const response = await fetch(endpoint.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...event, event_name: eventName, v: Number(protocolVersion) || 2 }),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`sGTM endpoint returned ${response.status}${message ? `: ${message.slice(0, 200)}` : ''}`);
  }
  return {
    configured: true,
    delivered: true,
    status: response.status,
    client: 'stape_data_client',
    protocolVersion,
  };
}

export async function sendGenericWebhook(env, payload) {
  if (!env.LEAD_WEBHOOK_URL) return { configured: false, delivered: false };
  const headers = { 'Content-Type': 'application/json' };
  if (env.LEAD_WEBHOOK_BEARER_TOKEN) headers.Authorization = `Bearer ${env.LEAD_WEBHOOK_BEARER_TOKEN}`;
  const response = await fetch(env.LEAD_WEBHOOK_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Webhook returned ${response.status}`);
  return { configured: true, delivered: true, status: response.status };
}

export async function settleDelivery(name, promise) {
  try {
    return [name, await promise];
  } catch (error) {
    console.error('Measurement Stack delivery failed', { destination: name, message: error.message });
    return [name, { configured: true, delivered: false, error: error.message }];
  }
}
