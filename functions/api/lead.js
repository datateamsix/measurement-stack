const MAX_BODY_BYTES = 32_000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function text(value, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function isEmail(value) {
  return /^\S+@\S+\.\S+$/.test(value);
}

export function buildLead(body, request) {
  return {
    leadId: crypto.randomUUID(),
    eventId: text(body.eventId, 100) || crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    firstName: text(body.firstName, 100),
    lastName: text(body.lastName, 100),
    workEmail: text(body.workEmail, 254).toLowerCase(),
    phone: text(body.phone, 40),
    company: text(body.company, 200),
    jobTitle: text(body.jobTitle, 200),
    companySize: text(body.companySize, 50),
    useCase: text(body.useCase, 100),
    privacyAccepted: body.privacyAccepted === true,
    marketingMeasurementConsent: body.marketingMeasurementConsent === true,
    conversionHappenedAt: Number(body.conversionHappenedAt) || Date.now(),
    identity: {
      person_id: text(body.person_id || body.tracking?.person_id, 100),
      analytics_user_id: text(body.analytics_user_id || body.tracking?.analytics_user_id, 100),
      anonymous_user_id: text(body.tracking?.anonymous_user_id, 100),
      ga_cookie_id: text(body.ga_cookie_id || body.tracking?.ga_cookie_id, 200),
      ga_client_id: text(body.tracking?.client_id, 100),
    },
    attributionFields: {
      utm_source: text(body.utm_source, 500),
      utm_medium: text(body.utm_medium, 500),
      utm_content: text(body.utm_content, 500),
      utm_campaign: text(body.utm_campaign, 500),
    },
    tracking: {
      person_id: text(body.tracking?.person_id, 100),
      analytics_user_id: text(body.tracking?.analytics_user_id, 100),
      anonymous_user_id: text(body.tracking?.anonymous_user_id, 100),
      ga_cookie_id: text(body.tracking?.ga_cookie_id, 200),
      client_id: text(body.tracking?.client_id, 100),
      session_id: text(body.tracking?.session_id, 100),
      page_location: text(body.tracking?.page_location, 1000),
      page_referrer: text(body.tracking?.page_referrer, 1000),
      page_title: text(body.tracking?.page_title, 300),
      attribution: body.tracking?.attribution || {},
    },
    request: {
      country: request.cf?.country || '',
      colo: request.cf?.colo || '',
      userAgent: text(request.headers.get('user-agent'), 500),
    },
  };
}

async function sendWebhook(lead, env) {
  if (!env.LEAD_WEBHOOK_URL) return { configured: false, delivered: false };

  const headers = { 'Content-Type': 'application/json' };
  if (env.LEAD_WEBHOOK_BEARER_TOKEN) {
    headers.Authorization = `Bearer ${env.LEAD_WEBHOOK_BEARER_TOKEN}`;
  }

  const response = await fetch(env.LEAD_WEBHOOK_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ source: 'measurestack_leadgen', lead }),
  });

  if (!response.ok) {
    throw new Error(`Webhook returned ${response.status}`);
  }

  return { configured: true, delivered: true, status: response.status };
}

export async function onRequestPost({ request, env }) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) return json({ error: 'Request body is too large.' }, 413);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Request body must be valid JSON.' }, 400);
  }

  // A populated hidden field usually indicates automated form spam. Return a
  // success-shaped response so bots receive no useful feedback.
  if (text(body.website, 200)) {
    return json({ ok: true, leadId: crypto.randomUUID(), eventId: body.eventId || crypto.randomUUID() }, 202);
  }

  const required = ['firstName', 'lastName', 'workEmail', 'company', 'jobTitle', 'companySize', 'useCase'];
  const missing = required.filter((field) => !text(body[field]));
  if (missing.length) return json({ error: `Missing required fields: ${missing.join(', ')}` }, 400);
  if (!isEmail(text(body.workEmail))) return json({ error: 'A valid work email is required.' }, 400);
  if (body.privacyAccepted !== true) return json({ error: 'Privacy notice acceptance is required.' }, 400);

  const lead = buildLead(body, request);
  let webhook = { configured: false, delivered: false };

  try {
    webhook = await sendWebhook(lead, env);
  } catch (error) {
    console.error('MeasureStack webhook failure', { leadId: lead.leadId, message: error.message });
    return json({ error: 'The lead was validated but the configured webhook failed.', leadId: lead.leadId }, 502);
  }

  if (String(env.DEBUG_LEADS).toLowerCase() === 'true') {
    console.log('MeasureStack sandbox lead', lead);
  } else {
    console.log('MeasureStack lead accepted', {
      leadId: lead.leadId,
      eventId: lead.eventId,
      useCase: lead.useCase,
      companySize: lead.companySize,
      marketingMeasurementConsent: lead.marketingMeasurementConsent,
      webhookDelivered: webhook.delivered,
    });
  }

  return json({
    ok: true,
    leadId: lead.leadId,
    eventId: lead.eventId,
    webhook,
  }, 201);
}

export function onRequestGet() {
  return json({ error: 'Method not allowed.' }, 405);
}
