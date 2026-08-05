import { authenticate } from '../lib/auth.js';
import { errorResponse, HttpError, json, readJson, text } from '../lib/http.js';
import { buildLead, isEmail } from '../lib/lead-model.js';
import { recordLead, syncPerson } from '../lib/identity.js';
import { sendGenericWebhook, sendLoopsEvent, sendServerEvent, settleDelivery } from '../lib/integrations.js';

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await readJson(request, 32_000);

    if (text(body.website, 200)) {
      return json({ ok: true, leadId: crypto.randomUUID(), eventId: body.eventId || crypto.randomUUID() }, 202);
    }

    const required = ['firstName', 'lastName', 'workEmail', 'company', 'jobTitle', 'companySize', 'useCase'];
    const missing = required.filter((field) => !text(body[field]));
    if (missing.length) throw new HttpError(400, `Missing required fields: ${missing.join(', ')}`);
    if (!isEmail(text(body.workEmail))) throw new HttpError(400, 'A valid work email is required.');
    if (body.privacyAccepted !== true) throw new HttpError(400, 'Privacy notice acceptance is required.');

    const authResult = await authenticate(request, env, { required: false, includeUser: true });
    const resolvedIdentity = authResult.isAuthenticated
      ? await syncPerson(env, {
          user: authResult.user,
          clerkUserId: authResult.auth.userId,
          tracking: body.tracking || {},
        })
      : {
          person_id: text(body.person_id || body.tracking?.person_id, 100),
          analytics_user_id: text(body.analytics_user_id || body.tracking?.analytics_user_id, 100),
          clerk_user_id: '',
          storage: env.MEASURESTACK_DB ? 'd1' : 'unbound',
        };

    const lead = buildLead(body, request, resolvedIdentity);
    const storage = await recordLead(env, lead);
    const serverEvent = {
      source: 'measurestack',
      event_name: 'generate_lead',
      event_id: lead.eventId,
      event_time: Math.floor(lead.conversionHappenedAt / 1000),
      action_source: 'website',
      event_source_url: lead.tracking.page_location,
      person_id: lead.identity.person_id,
      analytics_user_id: lead.identity.analytics_user_id,
      anonymous_user_id: lead.identity.anonymous_user_id,
      ga_client_id: lead.identity.ga_client_id,
      ga_cookie_id: lead.identity.ga_cookie_id,
      email: lead.workEmail,
      phone: lead.phone,
      first_name: lead.firstName,
      last_name: lead.lastName,
      company: lead.company,
      job_title: lead.jobTitle,
      country: lead.request.country,
      attribution: lead.tracking.attribution,
      consent: {
        advertising_measurement: lead.marketingMeasurementConsent,
      },
      custom_data: {
        lead_id: lead.leadId,
        company_size: lead.companySize,
        use_case: lead.useCase,
      },
    };

    const deliveries = await Promise.all([
      settleDelivery('loops', sendLoopsEvent(env, {
        email: lead.workEmail,
        userId: lead.identity.person_id,
        eventName: 'leadSubmitted',
        idempotencyKey: lead.eventId,
        contactProperties: {
          firstName: lead.firstName,
          lastName: lead.lastName,
          company: lead.company,
          jobTitle: lead.jobTitle,
          companySize: lead.companySize,
          useCase: lead.useCase,
          personId: lead.identity.person_id,
          analyticsUserId: lead.identity.analytics_user_id,
          clerkUserId: lead.identity.clerk_user_id,
          gaClientId: lead.identity.ga_client_id,
          gaCookieId: lead.identity.ga_cookie_id,
          utmSource: lead.attributionFields.utm_source,
          utmMedium: lead.attributionFields.utm_medium,
          utmCampaign: lead.attributionFields.utm_campaign,
          utmContent: lead.attributionFields.utm_content,
          latestLeadId: lead.leadId,
          latestEventId: lead.eventId,
          latestConversionAt: lead.receivedAt,
        },
        eventProperties: {
          leadId: lead.leadId,
          eventId: lead.eventId,
          companySize: lead.companySize,
          useCase: lead.useCase,
          utmSource: lead.attributionFields.utm_source,
          utmMedium: lead.attributionFields.utm_medium,
          utmCampaign: lead.attributionFields.utm_campaign,
          utmContent: lead.attributionFields.utm_content,
        },
      })),
      settleDelivery('sgtm', sendServerEvent(env, serverEvent)),
      settleDelivery('webhook', sendGenericWebhook(env, { source: 'measurestack_leadgen', lead })),
    ]);

    const delivery = Object.fromEntries(deliveries);
    console.log('MeasureStack lead accepted', {
      leadId: lead.leadId,
      eventId: lead.eventId,
      personId: lead.identity.person_id,
      authenticated: authResult.isAuthenticated,
      stored: storage.configured,
      delivery,
    });

    return json({
      ok: true,
      leadId: lead.leadId,
      eventId: lead.eventId,
      identity: resolvedIdentity,
      storage,
      delivery,
    }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export function onRequestGet() {
  return json({ error: 'Method not allowed.' }, 405);
}
