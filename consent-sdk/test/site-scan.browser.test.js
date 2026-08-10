import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { runSiteScan } from '../scanner/index.js';

const enabled = process.env.MERIDIAN_BROWSER_TEST === '1';

function fixtureHtml(pathname) {
  return `<!doctype html>
  <html><body>
    <header><nav aria-label="Main"><a href="/pricing">Pricing</a><a href="/about">About</a></nav></header>
    <main><h1>${pathname}</h1></main>
    <script>
      localStorage.setItem('essential_key', 'not-recorded');
      const selected = document.cookie.match(/fixture_consent=([^;]+)/)?.[1] || 'none';
      const apply = (choice) => {
        document.cookie = 'fixture_consent=' + choice + '; path=/; SameSite=Lax';
        if (choice === 'accept') {
          localStorage.setItem('analytics_key', 'secret-value');
          sessionStorage.setItem('session_vendor_id', 'secret-value');
          fetch('/collect?event=page_view&client_id=secret-value', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event_name: 'page_view', user_id: 'secret-value' }) });
        } else {
          localStorage.removeItem('analytics_key');
          sessionStorage.removeItem('session_vendor_id');
        }
      };
      if (selected === 'accept' && navigator.globalPrivacyControl !== true) apply('accept');
      window.MeridianConsent = {
        acceptAll: () => apply('accept'),
        rejectOptional: () => apply('reject'),
        save: () => apply('accept'),
        getState: () => ({ has_choice: selected !== 'none', gpc_detected: navigator.globalPrivacyControl === true })
      };
    </script>
  </body></html>`;
}

test('browser scanner exercises a controlled site without retaining values', { skip: !enabled }, async () => {
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/robots.txt') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('User-agent: *\nDisallow: /private\nSitemap: /sitemap.xml');
      return;
    }
    if (url.pathname === '/sitemap.xml') {
      response.writeHead(200, { 'content-type': 'application/xml' });
      response.end('<urlset><url><loc>/pricing</loc></url><url><loc>/about</loc></url></urlset>');
      return;
    }
    if (url.pathname === '/collect') {
      request.resume();
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(fixtureHtml(url.pathname));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const startUrl = `http://127.0.0.1:${address.port}/`;
  try {
    const result = await runSiteScan(startUrl, {
      maxPages: 2,
      profiles: 'baseline,reject,accept,gpc',
      waitMs: 50,
      timeoutMs: 10_000,
    });
    assert.equal(result.status, 'complete');
    assert.deepEqual(result.plan.pages.map((page) => new URL(page.url).pathname), ['/', '/pricing']);
    const analyticsKey = result.evidence.inventories.storage.find((item) => item.name === 'analytics_key');
    assert.deepEqual(analyticsKey.observed_profiles, ['accept']);
    const collection = result.evidence.inventories.network.find((item) => item.path === '/collect');
    assert.deepEqual(collection.query_fields, ['client_id', 'event']);
    assert.deepEqual(collection.body_fields, ['event_name', 'user_id']);
    assert.equal(collection.values_recorded, false);
    assert.ok(result.evidence.page_runs.filter((run) => run.profile === 'gpc').every((run) => run.gpc_detected));
    assert.doesNotMatch(JSON.stringify(result.evidence), /secret-value/);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
