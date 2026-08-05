import { text } from './http.js';

export function isEmail(value) {
  return /^\S+@\S+\.\S+$/.test(value);
}

export function buildLead(body, request, identity = {}) {
  return {
    leadId: crypto.randomUUID(),
    eventId: text(body.eventId || body.event_id, 100) || crypto.randomUUID(),
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
    conversionHappenedAt: Number(body.conversionHappenedAt || body.conversion_happened_at) || Date.now(),
    identity: {
      person_id: text(identity.person_id || body.person_id || body.tracking?.person_id, 100),
      analytics_user_id: text(identity.analytics_user_id || body.analytics_user_id || body.tracking?.analytics_user_id, 100),
      clerk_user_id: text(identity.clerk_user_id, 100),
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
      person_id: text(identity.person_id || body.tracking?.person_id, 100),
      analytics_user_id: text(identity.analytics_user_id || body.tracking?.analytics_user_id, 100),
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
