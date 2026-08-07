import { text } from './http.js';

function normalizeEmail(value) {
  const email = text(value, 254).trim().toLowerCase().replace(/\s+/g, '');
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  return `${['gmail.com', 'googlemail.com'].includes(domain) ? local.replace(/\./g, '') : local}@${domain}`;
}

function normalizePhone(value) {
  const digits = text(value, 40).replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

async function sha256Hex(value) {
  if (!value) return '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function pageParts(pageLocation = '') {
  try {
    const url = new URL(pageLocation);
    return { hostname: url.hostname, path: `${url.pathname}${url.search}` };
  } catch {
    return { hostname: '', path: '' };
  }
}

function clickIds(tracking = {}) {
  const last = tracking.attribution_envelope?.last_touch || {};
  const legacy = tracking.attribution?.last_touch || {};
  const clicks = last.click_ids || {};
  return {
    gclid: text(clicks.gclid || legacy.gclid, 500),
    dclid: text(clicks.dclid || legacy.dclid, 500),
    gbraid: text(clicks.gbraid || legacy.gbraid, 500),
    wbraid: text(clicks.wbraid || legacy.wbraid, 500),
    fbclid: text(clicks.fbclid || legacy.fbclid, 500),
    li_fat_id: text(clicks.li_fat_id || legacy.li_fat_id, 500),
    msclkid: text(clicks.msclkid || legacy.msclkid, 500),
  };
}

function consentAllowsAdvertising(lead, tracking = {}) {
  const consent = tracking.consent || {};
  return Boolean(
    lead.marketingMeasurementConsent
    && consent.ad_storage === 'granted'
    && consent.ad_user_data === 'granted'
  );
}

export async function buildGenerateLeadServerEvent({ lead, tracking = {}, request }) {
  const advertisingGranted = consentAllowsAdvertising(lead, tracking);
  const web = tracking.identity_graph?.web || {};
  const canonical = tracking.identity_graph?.canonical || {};
  const lifecycle = tracking.lifecycle || {};
  const attribution = tracking.attribution_envelope || {};
  const lastTouch = attribution.last_touch || tracking.attribution?.last_touch || {};
  const firstTouch = attribution.first_touch || tracking.attribution?.first_touch || {};
  const ids = clickIds(tracking);
  const page = pageParts(lead.tracking.page_location);
  const clientId = text(
    lead.identity.ga_client_id
      || tracking.js_client_id
      || web.javascript_client_id
      || web.browser_id,
    150,
  );

  const payload = {
    event_name: 'generate_lead',
    event_id: lead.eventId,
    event_time: Math.floor(lead.conversionHappenedAt / 1000),
    event_source: 'backend',
    transport: 'cloudflare_to_stape',
    action_source: 'website',
    lead_id: lead.leadId,
    lead_type: 'demo_request',
    client_id: clientId,
    user_id: lead.identity.analytics_user_id,
    person_id: lead.identity.person_id,
    analytics_user_id: lead.identity.analytics_user_id,
    anonymous_user_id: lead.identity.anonymous_user_id,
    browser_id: text(tracking.browser_id || web.browser_id, 120),
    web_graph_id: text(tracking.web_graph_id || tracking.identity_graph?.web_graph_id, 120),
    session_id: text(lead.tracking.session_id, 120),
    session_number: Number(tracking.session_count || web.session_count || 1),
    page_location: lead.tracking.page_location,
    page_hostname: page.hostname,
    page_path: page.path,
    page_referrer: lead.tracking.page_referrer,
    page_title: lead.tracking.page_title,
    language: text(tracking.system?.language, 50),
    screen_resolution: text(tracking.system?.screen_resolution, 50),
    viewport_size: text(tracking.system?.viewport_size, 50),
    currency: 'USD',
    value: 0,
    company_size: lead.companySize,
    use_case: lead.useCase,
    lifecycle_stage: text(lifecycle.stage, 50) || 'lead',
    authentication_status: lead.identity.clerk_user_id ? 'authenticated' : 'anonymous',
    consent_snapshot_id: text(tracking.consent?.consent_snapshot_id || tracking.identity_graph?.consent_snapshot_id, 120),
    analytics_storage: text(tracking.consent?.analytics_storage, 30) || 'denied',
    ad_storage: text(tracking.consent?.ad_storage, 30) || 'denied',
    ad_user_data: text(tracking.consent?.ad_user_data, 30) || 'denied',
    ad_personalization: text(tracking.consent?.ad_personalization, 30) || 'denied',
    advertising_measurement_consent: advertisingGranted,
    first_touch_id: text(attribution.first_touch_id || firstTouch.touch_id, 120),
    last_touch_id: text(attribution.last_touch_id || lastTouch.touch_id, 120),
    utm_source: text(lastTouch.source || lastTouch.utm_source, 500),
    utm_medium: text(lastTouch.medium || lastTouch.utm_medium, 500),
    utm_campaign: text(lastTouch.campaign_name || lastTouch.utm_campaign, 500),
    utm_content: text(lastTouch.campaign_content || lastTouch.utm_content, 500),
    utm_term: text(lastTouch.campaign_term || lastTouch.utm_term, 500),
    ...ids,
    fbp: text(web.fbp_cookie, 500),
    fbc: text(web.fbc_cookie, 500),
  };

  if (advertisingGranted) {
    const email = normalizeEmail(lead.workEmail);
    const phone = normalizePhone(lead.phone);
    const ip = text(request.headers.get('cf-connecting-ip'), 100);
    const userAgent = text(request.headers.get('user-agent'), 1000);
    payload.ip_override = ip;
    payload.user_agent = userAgent;
    payload.user_data = {
      sha256_email_address: await sha256Hex(email),
      ...(phone ? { sha256_phone_number: await sha256Hex(phone) } : {}),
      address: {
        first_name: lead.firstName.trim().toLowerCase(),
        last_name: lead.lastName.trim().toLowerCase(),
        country: text(request.cf?.country, 10).toLowerCase(),
      },
    };
    payload.sha256_external_id = await sha256Hex(canonical.person_id || lead.identity.person_id);
  }

  return payload;
}
