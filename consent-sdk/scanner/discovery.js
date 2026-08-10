const TRACKING_PARAMETERS = Object.freeze([
  /^utm_/i,
  /^ga_/i,
  /^(g|d|fb|ms|tw|li|tt)clid$/i,
  /^mc_(cid|eid)$/i,
  /^ref$/i,
]);

const SKIPPED_PATH_PATTERNS = Object.freeze([
  /\/(?:log-?in|log-?out|sign-?in|sign-?out|account|admin)(?:\/|$)/i,
  /\/(?:cart|basket)(?:\/|$)/i,
  /\/(?:search)(?:\/|$)/i,
  /\/(?:privacy|terms|legal|cookie-policy)(?:\/|$)/i,
  /\/(?:page|p)\/\d+(?:\/|$)/i,
]);

const SKIPPED_EXTENSIONS = /\.(?:avi|csv|docx?|gif|jpe?g|mov|mp3|mp4|pdf|png|pptx?|svg|webm|webp|xlsx?|xml|zip)$/i;

function htmlEntity(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

export function normalizedUrl(value, base) {
  let url;
  try {
    url = new URL(value, base);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMETERS.some((pattern) => pattern.test(key))) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '');
  return url.href;
}

export function sameOrigin(candidate, startUrl) {
  try {
    return new URL(candidate).origin === new URL(startUrl).origin;
  } catch {
    return false;
  }
}

export function scannableUrl(candidate, startUrl, options = {}) {
  const normalized = normalizedUrl(candidate, startUrl);
  if (!normalized || !sameOrigin(normalized, startUrl)) return false;
  const { pathname, search } = new URL(normalized);
  if (SKIPPED_EXTENSIONS.test(pathname)) return false;
  if (!options.includePolicyPages && SKIPPED_PATH_PATTERNS.some((pattern) => pattern.test(pathname))) return false;
  if (/\b(?:add|remove|delete|logout|signout)=/i.test(search)) return false;
  return true;
}

function robotsPattern(value) {
  const endAnchored = value.endsWith('$');
  const escaped = value.replace(/[$^+.()|[\]{}]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}${endAnchored ? '' : '.*'}`);
}

export function parseRobots(text = '', userAgent = 'meridian-site-scan') {
  const groups = [];
  let group = null;
  const sitemaps = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line) continue;
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const directive = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (directive === 'sitemap' && value) {
      sitemaps.push(value);
      continue;
    }
    if (directive === 'user-agent') {
      if (!group || group.rules.length) {
        group = { agents: [], rules: [] };
        groups.push(group);
      }
      group.agents.push(value.toLowerCase());
      continue;
    }
    if (group && ['allow', 'disallow'].includes(directive) && value) {
      group.rules.push({ directive, value, pattern: robotsPattern(value), specificity: value.replaceAll('*', '').replace(/\$$/, '').length });
    }
  }
  const agent = userAgent.toLowerCase();
  const exact = groups.filter((item) => item.agents.some((value) => value !== '*' && agent.includes(value)));
  const longest = exact.reduce((max, item) => Math.max(max, ...item.agents.filter((value) => value !== '*' && agent.includes(value)).map((value) => value.length)), 0);
  const selected = exact.length
    ? exact.filter((item) => item.agents.some((value) => value.length === longest && agent.includes(value)))
    : groups.filter((item) => item.agents.includes('*'));
  return { groups: selected, sitemaps: [...new Set(sitemaps)] };
}

export function robotsAllows(url, robots) {
  const target = new URL(url);
  const path = `${target.pathname}${target.search}`;
  const matches = (robots?.groups || []).flatMap((group) => group.rules)
    .filter((rule) => rule.pattern.test(path))
    .sort((a, b) => b.specificity - a.specificity || (a.directive === 'allow' ? -1 : 1));
  return !matches.length || matches[0].directive === 'allow';
}

export function sitemapUrls(xml = '', baseUrl) {
  const output = [];
  for (const match of String(xml).matchAll(/<loc(?:\s[^>]*)?>\s*([^<]+?)\s*<\/loc>/gi)) {
    const normalized = normalizedUrl(htmlEntity(match[1].trim()), baseUrl);
    if (normalized) output.push(normalized);
  }
  return [...new Set(output)];
}

function pathDepth(url) {
  return new URL(url).pathname.split('/').filter(Boolean).length;
}

function candidateRank(candidate) {
  const url = new URL(candidate.url);
  let score = candidate.source === 'explicit' ? 1000 : candidate.source === 'navigation' ? 700 : 300;
  if (candidate.cta) score += 80;
  score -= pathDepth(candidate.url) * 20;
  score -= url.search ? 30 : 0;
  return score;
}

export function selectPages({ startUrl, navigation = [], sitemap = [], include = [], robots, maxPages = 10, singlePage = false }) {
  const homepage = normalizedUrl(startUrl);
  if (!homepage) throw new TypeError('Site scan requires a valid HTTP or HTTPS URL without embedded credentials.');
  const limit = Math.max(1, Math.min(10, Number(maxPages) || 10));
  const candidates = [{ url: homepage, source: 'homepage', label: 'Homepage', cta: false }];
  if (!singlePage) {
    for (const value of include) candidates.push({ url: normalizedUrl(value, homepage), source: 'explicit', label: null, cta: false });
    for (const item of navigation) candidates.push({
      url: normalizedUrl(item.url || item.href, homepage),
      source: 'navigation',
      label: item.label || item.text || null,
      cta: Boolean(item.cta),
    });
    for (const value of sitemap) candidates.push({ url: normalizedUrl(value, homepage), source: 'sitemap', label: null, cta: false });
  }
  const seen = new Set();
  const accepted = [];
  const excluded = [];
  for (const candidate of candidates) {
    if (!candidate.url || !scannableUrl(candidate.url, homepage, { includePolicyPages: candidate.source === 'explicit' })) {
      if (candidate.url) excluded.push({ ...candidate, reason: 'outside_scan_scope' });
      continue;
    }
    if (seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    if (!robotsAllows(candidate.url, robots)) {
      excluded.push({ ...candidate, reason: 'robots_disallowed' });
      continue;
    }
    accepted.push(candidate);
  }
  const first = accepted.find((item) => item.url === homepage);
  const remainder = accepted.filter((item) => item.url !== homepage).sort((a, b) => candidateRank(b) - candidateRank(a) || a.url.localeCompare(b.url));
  const pages = [...(first ? [first] : []), ...remainder].slice(0, limit).map((item, index) => ({ ...item, position: index + 1 }));
  if (!pages.length) throw new Error('robots.txt disallows the starting URL for Meridian Site Scan.');
  return { start_url: homepage, max_pages: limit, pages, excluded };
}

async function fetchedText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 10_000);
  try {
    const response = await (options.fetch || fetch)(url, {
      headers: { 'user-agent': 'MeridianSiteScan/0.1 (+local consent audit)' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverRobots(startUrl, options = {}) {
  const origin = new URL(startUrl).origin;
  const text = await fetchedText(`${origin}/robots.txt`, options);
  const parsed = parseRobots(text || '', 'meridian-site-scan');
  return { ...parsed, found: text !== null, url: `${origin}/robots.txt` };
}

export async function discoverSitemap(startUrl, robots, options = {}) {
  const origin = new URL(startUrl).origin;
  const queue = [...(robots?.sitemaps?.length ? robots.sitemaps : [`${origin}/sitemap.xml`])];
  const urls = [];
  const visited = [];
  const seen = new Set();
  while (queue.length && visited.length < 6) {
    const source = queue.shift();
    const normalized = normalizedUrl(source, origin);
    if (!normalized || seen.has(normalized) || !sameOrigin(normalized, startUrl)) continue;
    seen.add(normalized);
    const xml = await fetchedText(normalized, options);
    visited.push({ url: normalized, found: xml !== null });
    if (!xml) continue;
    const locations = sitemapUrls(xml, startUrl);
    if (/<sitemapindex(?:\s|>)/i.test(xml)) queue.push(...locations.slice(0, 5));
    else urls.push(...locations);
  }
  return { urls: [...new Set(urls)].slice(0, 2_000), sources: visited };
}
