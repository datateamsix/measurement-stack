import { authenticate } from '../lib/auth.js';
import { errorResponse, HttpError, json, readJson, text } from '../lib/http.js';
import { buildLead, isEmail } from '../lib/lead-model.js';
import { recordLead, syncPerson } from '../lib/identity.js';
import { persistIdentityGraph, persistLifecycleEvent } from '../lib/identity-graph.js';
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

    const serverEvent = {
      source: 'measurement_stack',
      event_name: 'generate_lead',
      event_id: lead.eventId,
      event_time: Math.floor(lead.conversionHappenedAt / 1000),
      action_source: 'website',
      event_source_url: lead.tracking.page_location,
      person_id: lead.identity.person_id,
      analytics_user_id: lead.identity.analytics_user_id,
      anonymous_user_id: lead.identity.anonymous_user_id,
      browser_id: tracking.browser_id || tracking.identity_graph?.web?.browser_id || '',
      web_graph_id: tracking.web_graph_id || tracking.identity_graph?.web_graph_id || '',
      network_observation_id: tracking.network_observation_id || tracking.identity_graph?.web?.last_network_observation_id || '',
      consent_snapshot_id: tracking.consent?.consent_snapshot_id || tracking.identity_graph?.consent_snapshot_id || '',
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
      attribution_envelope: tracking.attribution_envelope || {},
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
      settleDelivery('sgtm', sendServerEvent(env, serverEvent)),
      settleDelivery('webhook', sendGenericWebhook(env, { source: 'measurement_stack_leadgen', lead })),
    ]);

    const delivery = Object.fromEntries(deliveries);
    console.log('Measurement Stack lead accepted', {
      leadId: lead.leadId,
      eventId: lead.eventId,
      personId: lead.identity.person_id,
      authenticated: authResult.isAuthenticated,
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
