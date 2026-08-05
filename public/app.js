const form = document.querySelector('#lead-form');
const statusBox = document.querySelector('#form-status');
const submitButton = document.querySelector('#submit-button');

window.dataLayer = window.dataLayer || [];
const pushEvent = (event, data = {}) => window.dataLayer.push({ event, ...data });

function getOrCreate(storageKey, prefix) {
  let value = localStorage.getItem(storageKey);
  if (!value) {
    value = `${prefix}_${crypto.randomUUID()}`;
    localStorage.setItem(storageKey, value);
  }
  return value;
}

function cookieValue(name) {
  const row = document.cookie.split('; ').find((item) => item.startsWith(`${name}=`));
  return row ? decodeURIComponent(row.split('=').slice(1).join('=')) : '';
}

function captureAttribution() {
  const params = new URLSearchParams(location.search);
  const keys = ['utm_source', 'utm_medium', 'utm_content', 'utm_campaign'];
  const stored = JSON.parse(localStorage.getItem('measurestack_last_touch') || '{}');
  const current = {};
  keys.forEach((key) => {
    const value = params.get(key);
    if (value) current[key] = value.slice(0, 500);
  });
  const lastTouch = Object.keys(current).length ? current : stored;
  localStorage.setItem('measurestack_last_touch', JSON.stringify(lastTouch));
  return lastTouch;
}

function setHidden(name, value) {
  const field = form.elements.namedItem(name);
  if (field) field.value = value || '';
}

function syncHiddenFields(eventId = '', happenedAt = '') {
  const params = new URLSearchParams(location.search);
  const suppliedPerson = params.get('person_id');
  const suppliedAnalyticsUser = params.get('analytics_user_id');
  if (suppliedPerson) localStorage.setItem('measurestack_person_id', suppliedPerson.slice(0, 100));
  if (suppliedAnalyticsUser) localStorage.setItem('measurestack_analytics_user_id', suppliedAnalyticsUser.slice(0, 100));

  const attribution = captureAttribution();
  setHidden('person_id', getOrCreate('measurestack_person_id', 'person'));
  setHidden('analytics_user_id', getOrCreate('measurestack_analytics_user_id', 'analytics'));
  setHidden('ga_cookie_id', cookieValue('_ga'));
  setHidden('utm_source', attribution.utm_source);
  setHidden('utm_medium', attribution.utm_medium);
  setHidden('utm_content', attribution.utm_content);
  setHidden('utm_campaign', attribution.utm_campaign);
  setHidden('event_id', eventId);
  setHidden('conversion_happened_at', happenedAt);
}

syncHiddenFields();
pushEvent('measurement_initialized', { gtm_container_id: 'GTM-5MQ3QDNF' });

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  statusBox.textContent = '';

  const eventId = crypto.randomUUID();
  const happenedAt = Date.now();
  syncHiddenFields(eventId, happenedAt);

  const data = Object.fromEntries(new FormData(form).entries());
  data.privacyAccepted = form.privacyAccepted.checked;
  data.marketingMeasurementConsent = form.marketingMeasurementConsent.checked;
  data.eventId = eventId;
  data.conversionHappenedAt = happenedAt;
  data.tracking = {
    person_id: data.person_id,
    analytics_user_id: data.analytics_user_id,
    ga_cookie_id: data.ga_cookie_id,
    page_location: location.href,
    page_referrer: document.referrer,
    page_title: document.title,
    attribution: captureAttribution()
  };

  pushEvent('form_submit_attempt', {
    event_id: eventId,
    form_id: 'demo_request',
    person_id: data.person_id,
    analytics_user_id: data.analytics_user_id
  });

  submitButton.disabled = true;
  submitButton.textContent = 'Submitting…';

  try {
    const response = await fetch('/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Submission failed.');

    pushEvent('generate_lead', {
      event_id: result.eventId || eventId,
      lead_id: result.leadId,
      conversion_happened_at: happenedAt,
      form_id: 'demo_request',
      lead_type: 'demo_request',
      person_id: data.person_id,
      analytics_user_id: data.analytics_user_id,
      user_id: data.analytics_user_id,
      ga_cookie_id: data.ga_cookie_id,
      utm_source: data.utm_source,
      utm_medium: data.utm_medium,
      utm_content: data.utm_content,
      utm_campaign: data.utm_campaign,
      consent: {
        ad_user_data: data.marketingMeasurementConsent ? 'granted' : 'denied',
        ad_personalization: data.marketingMeasurementConsent ? 'granted' : 'denied'
      }
    });

    statusBox.textContent = `Test lead accepted. Lead ID: ${result.leadId}`;
    form.reset();
    syncHiddenFields();
  } catch (error) {
    statusBox.textContent = error.message;
    pushEvent('form_submit_error', { event_id: eventId, error_message: error.message });
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Request a demo';
  }
});
