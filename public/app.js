(() => {
  'use strict';

  const form = document.getElementById('lead-form');
  if (!form) return;

  const { track, trackingContext, parseJson, STORAGE, escapeHtml, authFetch } = window.MeasureStack;
  const success = document.getElementById('form-success');
  const submitButton = document.getElementById('submit-button');
  const submitError = document.getElementById('submit-error');
  let formStarted = false;
  let formViewed = false;

  document.querySelectorAll('.js-demo-cta').forEach((button) => {
    button.addEventListener('click', () => {
      track('cta_click', { cta_text: button.textContent.trim(), cta_location: button.dataset.ctaLocation });
      document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' });
    });
  });

  function setHiddenField(name, value) {
    const field = form.elements[name];
    if (field) field.value = value || '';
  }

  function syncHiddenFields(eventId = '', happenedAt = '') {
    const tracking = trackingContext();
    const lastTouch = tracking.attribution?.last_touch || {};
    setHiddenField('person_id', tracking.person_id);
    setHiddenField('analytics_user_id', tracking.analytics_user_id);
    setHiddenField('ga_cookie_id', tracking.ga_cookie_id);
    setHiddenField('utm_source', lastTouch.utm_source);
    setHiddenField('utm_medium', lastTouch.utm_medium);
    setHiddenField('utm_content', lastTouch.utm_content);
    setHiddenField('utm_campaign', lastTouch.utm_campaign);
    setHiddenField('event_id', eventId);
    setHiddenField('conversion_happened_at', happenedAt ? String(happenedAt) : '');
    return tracking;
  }

  syncHiddenFields();

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries, observer) => {
      if (entries[0]?.isIntersecting && !formViewed) {
        formViewed = true;
        track('form_view', { form_id: 'demo_request', form_name: 'MeasureStack demo request' });
        observer.disconnect();
      }
    }, { threshold: 0.35 }).observe(form);
  }

  form.addEventListener('input', (event) => {
    if (event.target.name) clearError(event.target.name);
    if (!formStarted && event.target.type !== 'hidden') {
      formStarted = true;
      track('form_start', { form_id: 'demo_request', form_name: 'MeasureStack demo request' });
    }
  });

  function clearError(name) {
    document.querySelector(`[data-error-for="${name}"]`)?.replaceChildren();
    form.elements[name]?.removeAttribute('aria-invalid');
  }

  function setError(name, message) {
    const output = document.querySelector(`[data-error-for="${name}"]`);
    if (output) output.textContent = message;
    form.elements[name]?.setAttribute('aria-invalid', 'true');
  }

  function values() {
    const data = new FormData(form);
    return {
      firstName: String(data.get('firstName') || '').trim(),
      lastName: String(data.get('lastName') || '').trim(),
      workEmail: String(data.get('workEmail') || '').trim(),
      phone: String(data.get('phone') || '').trim(),
      company: String(data.get('company') || '').trim(),
      jobTitle: String(data.get('jobTitle') || '').trim(),
      companySize: String(data.get('companySize') || ''),
      useCase: String(data.get('useCase') || ''),
      privacyAccepted: data.get('privacyAccepted') === 'on',
      marketingMeasurementConsent: data.get('marketingMeasurementConsent') === 'on',
      person_id: String(data.get('person_id') || ''),
      analytics_user_id: String(data.get('analytics_user_id') || ''),
      ga_cookie_id: String(data.get('ga_cookie_id') || ''),
      utm_source: String(data.get('utm_source') || ''),
      utm_medium: String(data.get('utm_medium') || ''),
      utm_content: String(data.get('utm_content') || ''),
      utm_campaign: String(data.get('utm_campaign') || ''),
      event_id: String(data.get('event_id') || ''),
      conversion_happened_at: Number(data.get('conversion_happened_at') || 0),
      website: String(data.get('website') || '')
    };
  }

  function validate(input) {
    const errors = {};
    if (!input.firstName) errors.firstName = 'Enter your first name.';
    if (!input.lastName) errors.lastName = 'Enter your last name.';
    if (!/^\S+@\S+\.\S+$/.test(input.workEmail)) errors.workEmail = 'Enter a valid work email.';
    if (!input.company) errors.company = 'Enter your company.';
    if (!input.jobTitle) errors.jobTitle = 'Enter your job title.';
    if (!input.companySize) errors.companySize = 'Select a company size.';
    if (!input.useCase) errors.useCase = 'Select a primary use case.';
    if (!input.privacyAccepted) errors.privacyAccepted = 'You must accept the privacy notice.';
    return errors;
  }

  const normalizeEmail = (value) => {
    const email = value.trim().toLowerCase().replace(/\s+/g, '');
    const [local, domain] = email.split('@');
    if (!local || !domain) return email;
    return `${['gmail.com', 'googlemail.com'].includes(domain) ? local.replace(/\./g, '') : local}@${domain}`;
  };

  const normalizePhone = (value) => {
    const digits = value.replace(/\D/g, '');
    if (!digits) return '';
    return digits.length === 10 ? `+1${digits}` : `+${digits}`;
  };

  async function sha256(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submitError.hidden = true;
    form.querySelectorAll('[data-error-for]').forEach((node) => { node.textContent = ''; });
    form.querySelectorAll('[aria-invalid]').forEach((node) => node.removeAttribute('aria-invalid'));

    const eventId = crypto.randomUUID();
    const happenedAt = Date.now();
    const tracking = syncHiddenFields(eventId, happenedAt);
    const input = values();
    const errors = validate(input);

    if (Object.keys(errors).length) {
      Object.entries(errors).forEach(([name, message]) => setError(name, message));
      track('form_validation_error', { form_id: 'demo_request', event_id: eventId, error_fields: Object.keys(errors).join(',') });
      return;
    }

    track('form_submit_attempt', {
      event_id: eventId,
      form_id: 'demo_request',
      person_id: tracking.person_id,
      analytics_user_id: tracking.analytics_user_id,
      authentication_status: (await window.MeasureStack.loadClerk()).clerk?.isSignedIn ? 'authenticated' : 'anonymous'
    });

    submitButton.disabled = true;
    submitButton.textContent = 'Submitting test lead…';

    try {
      const response = await authFetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, eventId, conversionHappenedAt: happenedAt, tracking })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'The request could not be submitted.');

      if (result.identity) window.MeasureStack.applyResolvedIdentity(result.identity);
      const acceptedEventId = result.eventId || eventId;
      const consentChoice = parseJson(localStorage.getItem(STORAGE.consent), { analytics: false, marketing: false });
      const adsGranted = Boolean(consentChoice.marketing && input.marketingMeasurementConsent);
      const emailHash = adsGranted ? await sha256(normalizeEmail(input.workEmail)) : '';
      const phone = adsGranted ? normalizePhone(input.phone) : '';
      const phoneHash = phone ? await sha256(phone) : '';
      const liFatId = adsGranted
        ? (tracking.attribution?.last_touch?.li_fat_id || tracking.attribution?.first_touch?.li_fat_id || '')
        : '';
      const lastTouch = tracking.attribution?.last_touch || {};

      track('generate_lead', {
        event_id: acceptedEventId,
        lead_id: result.leadId || '',
        conversion_happened_at: happenedAt,
        form_id: 'demo_request',
        form_name: 'MeasureStack demo request',
        lead_type: 'demo_request',
        company_size: input.companySize,
        use_case: input.useCase,
        person_id: result.identity?.person_id || tracking.person_id,
        analytics_user_id: result.identity?.analytics_user_id || tracking.analytics_user_id,
        user_id: result.identity?.analytics_user_id || tracking.analytics_user_id,
        anonymous_user_id: tracking.anonymous_user_id,
        ga_cookie_id: tracking.ga_cookie_id,
        client_id: tracking.client_id,
        session_id: tracking.session_id,
        utm_source: lastTouch.utm_source || '',
        utm_medium: lastTouch.utm_medium || '',
        utm_content: lastTouch.utm_content || '',
        utm_campaign: lastTouch.utm_campaign || '',
        ...(adsGranted ? {
          user_data: {
            sha256_email_address: emailHash,
            ...(phoneHash ? { sha256_phone_number: phoneHash } : {}),
            ...(liFatId ? { linkedinFirstPartyId: liFatId } : {}),
            companyName: input.company,
            title: input.jobTitle,
            address: { first_name: input.firstName.toLowerCase(), last_name: input.lastName.toLowerCase(), country: 'US' }
          }
        } : {}),
        consent: { ad_user_data: adsGranted ? 'granted' : 'denied', ad_personalization: adsGranted ? 'granted' : 'denied' },
        attribution: tracking.attribution,
        delivery: result.delivery || {}
      });

      form.hidden = true;
      success.hidden = false;
      success.innerHTML = `
        <div class="success-icon"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-9"></path></svg></div>
        <p class="eyebrow">Request received</p>
        <h3>Your identity-aware lead is in the pipeline.</h3>
        <p>Inspect Loops, D1, sGTM Preview, and the dataLayer to compare the same event across destinations.</p>
        <dl>
          <div><dt>Lead ID</dt><dd>${escapeHtml(result.leadId || '')}</dd></div>
          <div><dt>Event ID</dt><dd>${escapeHtml(acceptedEventId)}</dd></div>
          <div><dt>Person ID</dt><dd>${escapeHtml(result.identity?.person_id || tracking.person_id)}</dd></div>
        </dl>
        <a class="secondary-link" href="/app.html">Open identity workspace</a>
        <button type="button" class="text-button" id="submit-another">Submit another test lead</button>`;
      document.getElementById('submit-another').addEventListener('click', () => {
        form.reset();
        syncHiddenFields();
        form.hidden = false;
        success.hidden = true;
        success.innerHTML = '';
        submitButton.disabled = false;
        submitButton.textContent = 'Request my demo';
      });
    } catch (error) {
      submitError.textContent = error.message;
      submitError.hidden = false;
      submitButton.disabled = false;
      submitButton.textContent = 'Request my demo';
      track('form_submit_error', { event_id: eventId, form_id: 'demo_request', error_message: error.message.slice(0, 200) });
    }
  });
})();
