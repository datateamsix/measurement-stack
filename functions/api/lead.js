import { authenticate } from '../lib/auth.js';
import { errorResponse, HttpError, json, readJson, text } from '../lib/http.js';
import { buildLead, isEmail } from '../lib/lead-model.js';
import { recordLead, syncPerson } from '../lib/identity.js';
import { persistIdentityGraph, persistLifecycleEvent } from '../lib/identity-graph.js';
import { buildGenerateLeadServerEvent } from '../lib/conversion-event.js';
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
    const tracking = body.tracking || {};
    const resolvedIdentity = await syncPerson(env, {
      user: authResult.user,
      clerkUserId: authResult.auth?.userId || '',
      tracking,
    });

    const lead = buildLead(body, request, resolvedIdentity);
    const graphStorage = await persistIdentityGraph(env, {
      identity: resolvedIdentity,
      user: authResult.user,
      tracking,
      sourceEventId: lead.eventId,
    });
    const storage = await recordLead(env, lead);
    await persistLifecycleEvent(env, {
      personId: lead.identity.person_id,
      browserId: text(tracking.browser_id || tracking.identity_graph?.web?.browser_id, 120),
      eventName: 'lead_submitted',
      fromStage: 'visitor',
      toStage: 'lead',
      sourceEventId: lead.eventId,
      leadId: lead.leadId,
      payload: {
        company_size: lead.companySize,
        use_case: lead.useCase,
        authentication_status: authResult.isAuthenticated ? 'authenticated' : 'anonymous',
      },
      occurredAt: lead.receivedAt,
    });

    const serverEvent = await buildGenerateLeadServerEvent({ lead, tracking, request });
    const analyticsMeasurementAllowed = serverEvent.analytics_storage === 'granted';
    const serverMeasurementAllowed = analyticsMeasurementAllowed || serverEvent.advertising_measurement_consent;
    const sgtmDelivery = serverMeasurementAllowed
      ? sendServerEvent(env, serverEvent)
      : Promise.resolve({
          configured: Boolean(env.SGTM_EVENT_ENDPOINT),
          delivered: false,
          skipped: 'consent_denied',
        });

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
          browserId: tracking.browser_id || tracking.identity_graph?.web?.browser_id || '',
          webGraphId: tracking.web_graph_id || tracking.identity_graph?.web_graph_id || '',
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
      settleDelivery('sgtm', sgtmDelivery),
      settleDelivery('webhook', sendGenericWebhook(env, { source: 'measurement_stack_leadgen', lead })),
    ]);

    const delivery = Object.fromEntries(deliveries);
    console.log('Measurement Stack lead accepted', {
      leadId: lead.leadId,
      eventId: lead.eventId,
      personId: lead.identity.person_id,
      authenticated: authResult.isAuthenticated,
      analyticsMeasurementAllowed,
      advertisingMeasurementConsent: serverEvent.advertising_measurement_consent,
      stored: storage.configured,
      graphStored: graphStorage.stored,
      delivery,
    });

    return json({
      ok: true,
      leadId: lead.leadId,
      eventId: lead.eventId,
      identity: resolvedIdentity,
      storage: { lead: storage, graph: graphStorage },
      delivery,
    }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export function onRequestGet() {
  return json({ error: 'Method not allowed.' }, 405);
}
