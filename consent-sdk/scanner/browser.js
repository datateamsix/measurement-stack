export const QUICK_PROFILES = Object.freeze(['baseline', 'reject', 'accept', 'gpc']);
export const FULL_PROFILES = Object.freeze([...QUICK_PROFILES, 'analytics', 'withdraw']);

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function fieldsFromBody(request) {
  const postData = request.postData();
  if (!postData) return [];
  const contentType = request.headers()['content-type'] || '';
  try {
    if (contentType.includes('json')) {
      const parsed = JSON.parse(postData);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed).sort() : [];
    }
    if (contentType.includes('x-www-form-urlencoded')) return unique([...new URLSearchParams(postData).keys()]);
  } catch {
    return [];
  }
  return [];
}

function relatedHostname(hostname, siteHostname) {
  return hostname === siteHostname || hostname.endsWith(`.${siteHostname}`) || siteHostname.endsWith(`.${hostname}`);
}

function safePath(pathname) {
  return pathname.split('/').map((segment) => {
    if (/^[0-9]{7,}$/.test(segment) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment) || /^[A-Za-z0-9_-]{32,}$/.test(segment)) return ':redacted';
    return segment;
  }).join('/');
}

function resourceLocation(value) {
  try {
    const url = new URL(value);
    return { origin: url.origin, path: safePath(url.pathname), query_fields: unique([...url.searchParams.keys()]) };
  } catch {
    return null;
  }
}

function requestEvidence(request, pageUrl, siteHostname) {
  const url = new URL(request.url());
  return {
    page_url: pageUrl,
    url_origin: url.origin,
    hostname: url.hostname,
    path: safePath(url.pathname),
    method: request.method(),
    resource_type: request.resourceType(),
    first_party: relatedHostname(url.hostname, siteHostname),
    query_fields: unique([...url.searchParams.keys()]),
    body_fields: fieldsFromBody(request),
    values_recorded: false,
  };
}

function setCookieNames(header) {
  if (!header) return [];
  return unique(String(header).split(/,(?=\s*[^;,]+=)/).map((value) => value.trim().match(/^([^=;\s]+)/)?.[1]));
}

async function frameStorage(frame) {
  try {
    return await frame.evaluate(async () => {
      const databases = typeof indexedDB?.databases === 'function'
        ? await indexedDB.databases()
        : [];
      const indexeddbDatabases = await Promise.all(databases.map(({ name }) => new Promise((resolve) => {
        if (!name) return resolve(null);
        const request = indexedDB.open(name);
        const timer = setTimeout(() => resolve({ name, object_stores: [], inspection: 'timed_out' }), 1_000);
        request.onerror = () => { clearTimeout(timer); resolve({ name, object_stores: [], inspection: 'unavailable' }); };
        request.onsuccess = () => {
          clearTimeout(timer);
          const database = request.result;
          const result = { name, object_stores: [...database.objectStoreNames].sort(), inspection: 'complete' };
          database.close();
          resolve(result);
        };
      })));
      const cacheNames = typeof caches?.keys === 'function' ? await caches.keys() : [];
      return {
        origin: location.origin,
        local_storage_keys: Object.keys(localStorage).sort(),
        session_storage_keys: Object.keys(sessionStorage).sort(),
        indexeddb_databases: indexeddbDatabases.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)),
        cache_storage_names: cacheNames.sort(),
      };
    });
  } catch {
    return null;
  }
}

async function pageStorage(page) {
  const entries = [];
  for (const frame of page.frames()) {
    const storage = await frameStorage(frame);
    if (storage) entries.push(storage);
  }
  const byOrigin = new Map();
  for (const entry of entries) {
    const current = byOrigin.get(entry.origin) || {
      origin: entry.origin,
      local_storage_keys: [],
      session_storage_keys: [],
      indexeddb_databases: [],
      cache_storage_names: [],
    };
    for (const key of ['local_storage_keys', 'session_storage_keys', 'indexeddb_databases', 'cache_storage_names']) {
      if (key === 'indexeddb_databases') {
        const databases = new Map([...current[key], ...entry[key]].map((database) => [database.name, database]));
        current[key] = [...databases.values()].sort((a, b) => a.name.localeCompare(b.name));
      } else current[key] = unique([...current[key], ...entry[key]]);
    }
    byOrigin.set(entry.origin, current);
  }
  return [...byOrigin.values()].sort((a, b) => a.origin.localeCompare(b.origin));
}

async function consentState(page) {
  try {
    return await page.evaluate(() => {
      const meridian = window.MeridianConsent?.getState?.() || null;
      const consentCommands = (window.dataLayer || []).map((entry) => {
        try {
          const values = Array.from(entry || []);
          return values[0] === 'consent' ? { command: values[1], states: values[2] } : null;
        } catch {
          return null;
        }
      }).filter(Boolean);
      return { gpc_detected: navigator.globalPrivacyControl === true, meridian, google_consent_commands: consentCommands.slice(-5) };
    });
  } catch {
    return { gpc_detected: false, meridian: null, google_consent_commands: [] };
  }
}

async function waitForSettled(page, waitMs) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: Math.min(5_000, waitMs + 2_000) }).catch(() => {});
  if (waitMs) await page.waitForTimeout(waitMs);
}

async function goto(page, url, options) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs });
  await waitForSettled(page, options.waitMs);
  return response;
}

async function meridianAction(page, profile) {
  return page.evaluate((selected) => {
    const api = window.MeridianConsent;
    if (!api) return false;
    if (selected === 'accept') api.acceptAll();
    else if (selected === 'reject') api.rejectOptional();
    else if (selected === 'analytics') api.save({
      security_storage: 'granted',
      functionality_storage: 'denied',
      personalization_storage: 'denied',
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });
    else return false;
    return true;
  });
}

async function clickAction(page, selector) {
  if (!selector) return false;
  const locator = page.locator(selector).first();
  if (!await locator.count()) return false;
  await locator.click({ timeout: 5_000 });
  return true;
}

async function action(page, profile, options) {
  if (await meridianAction(page, profile)) return { applied: true, adapter: 'meridian' };
  const selector = profile === 'accept' ? options.acceptSelector : profile === 'reject' ? options.rejectSelector : null;
  if (await clickAction(page, selector)) return { applied: true, adapter: 'selector' };
  return { applied: false, adapter: null };
}

async function prepareProfile(page, startUrl, profile, options) {
  if (profile === 'baseline' || profile === 'gpc') return { applied: true, adapter: 'none' };
  await goto(page, startUrl, options);
  if (profile === 'withdraw') {
    const accepted = await action(page, 'accept', options);
    await page.waitForTimeout(options.waitMs);
    const rejected = await action(page, 'reject', options);
    await page.waitForTimeout(options.waitMs);
    return { applied: accepted.applied && rejected.applied, adapter: accepted.adapter || rejected.adapter };
  }
  const result = await action(page, profile, options);
  await page.waitForTimeout(options.waitMs);
  return result;
}

export async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (error) {
    const wrapped = new Error('Meridian Site Scan requires Playwright. Run "npm install" and then "npx playwright install chromium".');
    wrapped.cause = error;
    throw wrapped;
  }
}

export async function navigationLinks(browser, startUrl, options = {}) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await goto(page, startUrl, { timeoutMs: options.timeoutMs || 30_000, waitMs: options.waitMs || 500 });
    return await page.evaluate(() => {
      const regions = [
        ...document.querySelectorAll('nav[aria-label*="main" i], nav[aria-label*="primary" i], header nav, [role="navigation"][aria-label*="main" i], [role="navigation"][aria-label*="primary" i]'),
      ];
      const roots = regions.length ? regions : [...document.querySelectorAll('header, nav')];
      const seen = new Set();
      return roots.flatMap((root) => [...root.querySelectorAll('a[href]')]).map((link) => {
        const href = link.href;
        if (seen.has(href)) return null;
        seen.add(href);
        const style = getComputedStyle(link);
        const classText = String(link.className || '').toLowerCase();
        return {
          url: href,
          label: (link.textContent || link.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 120),
          cta: /button|btn|cta/.test(classText) || style.borderRadius !== '0px' || Number.parseInt(style.fontWeight, 10) >= 600,
        };
      }).filter(Boolean);
    });
  } finally {
    await context.close();
  }
}

export async function scanWithBrowser(browser, plan, options = {}) {
  const profiles = options.profiles || QUICK_PROFILES;
  const requestedTimeout = Number(options.timeoutMs);
  const requestedWait = Number(options.waitMs);
  const settings = {
    timeoutMs: Math.max(1_000, Math.min(120_000, Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : 30_000)),
    waitMs: Math.max(0, Math.min(10_000, Number.isFinite(requestedWait) ? requestedWait : 1_000)),
    acceptSelector: options.acceptSelector,
    rejectSelector: options.rejectSelector,
  };
  const siteHostname = new URL(plan.start_url).hostname;
  const runs = [];
  for (const profile of profiles) {
    const context = await browser.newContext();
    if (profile === 'gpc') {
      await context.addInitScript(() => Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, get: () => true }));
    }
    const page = await context.newPage();
    const preparation = await prepareProfile(page, plan.start_url, profile, settings);
    for (const plannedPage of plan.pages) {
      const requests = [];
      const responseCookies = [];
      const onRequest = (request) => {
        try { requests.push(requestEvidence(request, plannedPage.url, siteHostname)); } catch {}
      };
      const onResponse = (response) => {
        try {
          for (const name of setCookieNames(response.headers()['set-cookie'])) {
            responseCookies.push({ page_url: plannedPage.url, hostname: new URL(response.url()).hostname, name });
          }
        } catch {}
      };
      page.on('request', onRequest);
      page.on('response', onResponse);
      let error = null;
      let status = null;
      try {
        const response = await goto(page, plannedPage.url, settings);
        status = response?.status() ?? null;
      } catch (cause) {
        error = `Navigation failed (${cause.name || 'Error'})`;
      }
      const cookies = (await context.cookies()).map((cookie) => ({
        page_url: plannedPage.url,
        name: cookie.name,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires,
        session: cookie.expires === -1,
        secure: cookie.secure,
        http_only: cookie.httpOnly,
        same_site: cookie.sameSite,
        partition_key: cookie.partitionKey || null,
        first_party: relatedHostname(cookie.domain.replace(/^\./, ''), siteHostname),
        value_recorded: false,
      }));
      const storage = error ? [] : await pageStorage(page);
      const frames = error ? [] : page.frames().slice(1).map((frame) => {
        const location = resourceLocation(frame.url());
        return location ? { page_url: plannedPage.url, ...location } : null;
      }).filter(Boolean);
      const services = context.serviceWorkers().map((worker) => resourceLocation(worker.url())).filter(Boolean);
      const consent = error ? { gpc_detected: false, meridian: null, google_consent_commands: [] } : await consentState(page);
      page.off('request', onRequest);
      page.off('response', onResponse);
      runs.push({
        profile,
        page: plannedPage,
        status,
        error,
        consent_action: preparation,
        requests,
        response_cookies: responseCookies,
        cookies,
        storage,
        frames,
        service_workers: services,
      });
    }
    await context.close();
  }
  return runs;
}
