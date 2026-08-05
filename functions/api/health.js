export function onRequestGet({ env }) {
  return new Response(JSON.stringify({
    ok: true,
    service: 'measurestack-leadgen',
    webhookConfigured: Boolean(env.LEAD_WEBHOOK_URL),
    timestamp: new Date().toISOString(),
  }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
