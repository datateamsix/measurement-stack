"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const STUDIO_PATH = "/meridian/consent-studio/";
const STUDIO_ASSET_PATH = `${STUDIO_PATH}`;

declare global {
  interface Window {
    MeasurementStack?: {
      ready: Promise<{ clerkPublishableKey?: string }>;
      runtimeConfig?: () => Promise<{ clerkPublishableKey?: string }>;
      loadClerk: () => Promise<{ configured: boolean; clerk: { isSignedIn?: boolean } | null; error?: string }>;
      authFetch?: (url: string, options?: RequestInit) => Promise<Response>;
    };
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type View = "workspace" | "scans" | "tagging" | "analytics" | "integrations" | "compliance" | "projects" | "profiles" | "settings";
type IntegrationDetail = "gtm" | null;

type GtmAccount = { accountId?: string; name?: string };
type GtmContainer = { containerId?: string; name?: string; publicId?: string };
type GtmWorkspace = { workspaceId?: string; name?: string };
type GtmTestResult = {
  ok?: boolean;
  dryRun?: boolean;
  confirmationRequired?: string;
  plan?: string[];
  error?: string;
  evidence?: unknown;
  cleanupRequired?: boolean;
  steps?: unknown;
};

async function studioAuthFetch(url: string, options?: RequestInit) {
  const runtime = window.MeasurementStack;
  if (!runtime?.authFetch) throw new Error("Measurement Stack auth runtime is unavailable.");
  return runtime.authFetch(url, options);
}

const nav: { id: View; label: string; glyph: string }[] = [
  { id: "workspace", label: "Workspace", glyph: "⌂" },
  { id: "scans", label: "Site Scans", glyph: "◎" },
  { id: "tagging", label: "Tagging", glyph: "◇" },
  { id: "analytics", label: "Analytics", glyph: "◫" },
  { id: "integrations", label: "Integrations", glyph: "⇄" },
  { id: "compliance", label: "Compliance", glyph: "✓" },
  { id: "projects", label: "Projects", glyph: "▦" },
];

type ControlStatus = "Evidenced" | "Partial" | "Gap" | "Legal review";

const complianceControls: { area: string; control: string; status: ControlStatus; evidence: string; next: string }[] = [
  { area: "Consent collection", control: "Granular, informed choice", status: "Evidenced", evidence: "Seven purpose controls, policy links, accessible settings dialog", next: "Approve property-specific copy with privacy counsel" },
  { area: "Consent collection", control: "Reject and withdraw as easily as accept", status: "Evidenced", evidence: "First-layer reject action, persistent settings control, revocation event", next: "Add automated visual-parity regression check" },
  { area: "Consent storage", control: "Versioned consent receipt", status: "Partial", evidence: "Receipt ID, consent ID, timestamp, profile and policy version emitted", next: "Snapshot exact notice text and configuration hash" },
  { area: "Consent storage", control: "Durable, tamper-evident record", status: "Gap", evidence: "BYOB receipt hook exists; core SDK intentionally stores no audit log", next: "Add authenticated receipt collector and append-only integrity chain" },
  { area: "Script enforcement", control: "Denied defaults before optional tags", status: "Evidenced", evidence: "Optional Google consent states default to denied before UI mount", next: "Continuously verify ordering with Site Scan" },
  { area: "Script enforcement", control: "Observed behavior matches policy", status: "Evidenced", evidence: "Baseline, reject, accept, GPC and withdrawal browser profiles", next: "Alert when scheduled scans introduce a regression" },
  { area: "Consent propagation", control: "Frontend and GTM propagation", status: "Evidenced", evidence: "Consent Mode updates, dataLayer envelope, subscriptions and receipts", next: "Publish a stable downstream event contract" },
  { area: "Consent propagation", control: "Server-side enforcement", status: "Gap", evidence: "No trusted server policy decision endpoint is currently implemented", next: "Add signed consent token verification and destination policy gates" },
  { area: "Audit trail", control: "Reconstruct the choice shown", status: "Partial", evidence: "Policy version is retained; exact text and presentation are not", next: "Version copy, category definitions, links, locale and UI hash" },
  { area: "Audit trail", control: "Portable evidence export", status: "Evidenced", evidence: "JSON, CSV and Markdown scan, policy, disclosure and validation outputs", next: "Add receipt-store export schema and retention metadata" },
  { area: "Regional policy", control: "Jurisdiction-specific behavior", status: "Partial", evidence: "Strict global, EU/UK and US opt-out profiles are available", next: "Add explicit region resolver, fallback rule and routing evidence" },
  { area: "Regional policy", control: "Applicable law and certification", status: "Legal review", evidence: "Meridian does not determine legal applicability or provide TCF certification", next: "Document counsel decision; use a certified CMP when TCF is required" },
  { area: "Security", control: "Consent data protection", status: "Partial", evidence: "Minimal receipt envelope and privacy-preserving analytics schema", next: "Specify authentication, authorization, encryption, rate limits and deletion" },
  { area: "Operations", control: "Ongoing inventory governance", status: "Evidenced", evidence: "Timestamped scans, tag reconciliation and review manifests", next: "Connect scheduled scans to durable alerts" },
  { area: "Performance", control: "CMP performance budget", status: "Partial", evidence: "Core SDK is 6.4 KB gzip; no field-performance gate yet", next: "Add bundle, LCP and interaction regression thresholds" },
];

const consentSignals = ["ad_storage", "analytics_storage", "ad_user_data", "ad_personalization", "functionality_storage", "personalization_storage", "security_storage"];

const technologies = [
  { name: "_ga", kind: "Cookie", provider: "Google Analytics", category: "Analytics", state: "After analytics consent", page: "/", status: "Declared" },
  { name: "_fbp", kind: "Cookie", provider: "Meta", category: "Advertising", state: "Accept all", page: "/pricing", status: "Declared" },
  { name: "_hjSessionUser_*", kind: "Local storage", provider: "Hotjar", category: "Analytics", state: "After analytics consent", page: "/product", status: "Declared" },
  { name: "hubspotutk", kind: "Cookie", provider: "HubSpot", category: "Functionality", state: "Accept all", page: "/contact", status: "Review" },
  { name: "visitor_context", kind: "Session storage", provider: "Unknown", category: "Unassigned", state: "Before interaction", page: "/", status: "Review" },
];

const tags = [
  { name: "GA4 – Configuration", provider: "Google Analytics", purpose: "Analytics", signals: ["analytics_storage"], confidence: "99%", status: "Verified" },
  { name: "Meta – Page View", provider: "Meta", purpose: "Advertising", signals: ["ad_storage", "ad_user_data", "ad_personalization"], confidence: "98%", status: "Review" },
  { name: "Hotjar – UX Analytics", provider: "Hotjar", purpose: "Analytics", signals: ["analytics_storage"], confidence: "96%", status: "Verified" },
  { name: "HubSpot – Forms", provider: "HubSpot", purpose: "Functionality", signals: ["functionality_storage"], confidence: "91%", status: "Review" },
  { name: "Security controls", provider: "First party", purpose: "Security", signals: ["security_storage"], confidence: "100%", status: "Verified" },
];

const histories = [
  { date: "Aug 10, 2026 · 9:42 AM", pages: 10, tech: 23, changes: "+2 new", status: "Current" },
  { date: "Aug 3, 2026 · 8:00 AM", pages: 10, tech: 21, changes: "No issues", status: "Complete" },
  { date: "Jul 27, 2026 · 8:00 AM", pages: 9, tech: 21, changes: "−1 removed", status: "Complete" },
];

function Header({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`ui-badge ${tone}`}>{children}</span>;
}

export default function Home() {
  const [authState, setAuthState] = useState<"checking" | "ready" | "error">("checking");
  const [view, setView] = useState<View>("workspace");
  const [property, setProperty] = useState("Measurement Stack");
  const [scanTime, setScanTime] = useState("Aug 10, 2026 · 9:42 AM");
  const [scanning, setScanning] = useState(false);
  const [schedule, setSchedule] = useState("Weekly");
  const [inventoryFilter, setInventoryFilter] = useState("All");
  const [scanHistory, setScanHistory] = useState(histories);
  const [logo, setLogo] = useState<string | null>(null);
  const [accent, setAccent] = useState("#60a5fa");
  const [profileName, setProfileName] = useState("");
  const [customProfiles, setCustomProfiles] = useState<string[]>([]);
  const [controlFilter, setControlFilter] = useState("All");
  const [selectedControl, setSelectedControl] = useState(0);
  const [connectedServices, setConnectedServices] = useState<string[]>([]);
  const [integrationDetail, setIntegrationDetail] = useState<IntegrationDetail>(null);
  const [storageDestination, setStorageDestination] = useState("Cloudflare D1");
  const [integrationNotice, setIntegrationNotice] = useState("No Google account has been authorized yet");
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    async function verifyAccess() {
      try {
        const runtime = window.MeasurementStack;
        if (!runtime) {
          // core.js is deferred; give it a brief chance to register before rendering.
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const stack = window.MeasurementStack;
        if (!stack) {
          if (active) setAuthState("ready");
          return;
        }
        // Avoid awaiting stack.ready — it also runs identity sync and can hang the Studio shell.
        const config = await withTimeout(
          stack.runtimeConfig ? stack.runtimeConfig() : stack.ready,
          8000,
          "Studio runtime config",
        );
        const auth = await withTimeout(stack.loadClerk(), 12000, "Clerk initialization");
        if (config.clerkPublishableKey && !auth.clerk?.isSignedIn) {
          const returnTo = `${location.pathname}${location.search}${location.hash}`;
          location.replace(`/sign-in.html?redirect_url=${encodeURIComponent(returnTo)}`);
          return;
        }
        if (active) setAuthState(auth.configured && !auth.clerk ? "error" : "ready");
      } catch (error) {
        console.error("Meridian Studio authentication bootstrap failed", error);
        if (active) setAuthState("error");
      }
    }
    void verifyAccess();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (authState !== "ready") return;
    const params = new URLSearchParams(location.search);
    const integration = params.get("integration");
    const gtmStatus = params.get("gtm_status");
    const gtmError = params.get("gtm_error");
    if (integration === "gtm") {
      setView("integrations");
      setIntegrationDetail("gtm");
    }
    if (gtmStatus === "connected") {
      setConnectedServices((items) => (items.includes("Google Tag Manager") ? items : [...items, "Google Tag Manager"]));
      setIntegrationNotice("Google Tag Manager connected · just now");
    } else if (gtmStatus === "error") {
      setIntegrationNotice(`Google authorization failed${gtmError ? `: ${gtmError}` : ""}`);
    }
    if (integration || gtmStatus || gtmError) {
      const clean = new URL(location.href);
      clean.searchParams.delete("gtm_status");
      clean.searchParams.delete("gtm_error");
      history.replaceState({}, "", `${clean.pathname}${clean.search}${clean.hash}`);
    }
  }, [authState]);

  useEffect(() => {
    if (authState !== "ready" || view !== "integrations") return;
    let active = true;
    async function refreshGtmStatus() {
      try {
        const response = await studioAuthFetch("/api/integrations/google/status");
        const body = await response.json().catch(() => ({}));
        if (!active || !response.ok) return;
        if (body.connected) {
          setConnectedServices((items) => (items.includes("Google Tag Manager") ? items : [...items, "Google Tag Manager"]));
          setIntegrationNotice((notice) => (notice.includes("failed") ? notice : "Google Tag Manager connected"));
        }
      } catch {
        // Status refresh is best-effort; the GTM detail view surfaces failures.
      }
    }
    void refreshGtmStatus();
    return () => { active = false; };
  }, [authState, view]);

  const pageTitle = useMemo(() => nav.find((item) => item.id === view)?.label || "Studio", [view]);

  function runScan() {
    setScanning(true);
    window.setTimeout(() => {
      setScanning(false);
      setScanTime("Just now");
      setScanHistory((items) => [
        { date: "Just now", pages: 10, tech: 23, changes: "Active snapshot", status: "Current" },
        ...items.map((item) => ({ ...item, status: "Complete" })),
      ]);
    }, 1000);
  }

  function uploadLogo(file?: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setLogo(String(reader.result));
    reader.readAsDataURL(file);
  }

  function createProfile() {
    const name = profileName.trim();
    if (!name) return;
    setCustomProfiles((items) => [...items, name]);
    setProfileName("");
  }

  function toggleService(service: string) {
    setConnectedServices((items) => {
      const connected = items.includes(service);
      setIntegrationNotice(`${service} ${connected ? "disconnected" : "connected"} · just now`);
      return connected ? items.filter((item) => item !== service) : [...items, service];
    });
  }

  function handleGtmConnectionChange(connected: boolean, notice?: string) {
    setConnectedServices((items) => {
      const has = items.includes("Google Tag Manager");
      if (connected) return has ? items : [...items, "Google Tag Manager"];
      return has ? items.filter((item) => item !== "Google Tag Manager") : items;
    });
    if (notice) setIntegrationNotice(notice);
  }

  const visibleTechnologies = technologies.filter((item) => {
    if (inventoryFilter === "All") return true;
    if (inventoryFilter === "Cookies") return item.kind === "Cookie";
    if (inventoryFilter === "Storage") return item.kind.includes("storage");
    return false;
  });
  const visibleControls = complianceControls.filter((item) => controlFilter === "All" || item.status === controlFilter);

  if (authState !== "ready") return <main className="studio-access-state"><img src={`${STUDIO_ASSET_PATH}meridian-logo-light.svg`} alt="Meridian" /><p>{authState === "checking" ? "Verifying protected workspace…" : "Authentication could not be verified. Refresh the page or return to sign in."}</p>{authState === "error" && <a href={`/sign-in.html?redirect_url=${encodeURIComponent(STUDIO_PATH)}`}>Return to sign in</a>}</main>;

  return <main className="studio-shell">
    <aside className="sidebar">
      <div className="brand-lockup"><img className="brand-logo" src={`${STUDIO_ASSET_PATH}meridian-logo-light.svg`} alt="Meridian" /><img className="brand-symbol" src={`${STUDIO_ASSET_PATH}meridian-mark-light.svg`} alt="" /><span className="product-name">Studio</span></div>
      <nav className="primary-nav" aria-label="Primary navigation">
        {nav.map((item) => <button key={item.id} className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => setView(item.id)}><span className="nav-glyph">{item.glyph}</span>{item.label}</button>)}
      </nav>
      <div className="sidebar-section">
        <p className="sidebar-label">Current property</p>
        <button className="project-switcher" onClick={() => setView("projects")}><span className="project-icon">M</span><span><strong>{property}</strong><small>measurementstack.com</small></span><span className="chevron">⌄</span></button>
      </div>
      <div className="sidebar-footer">
        <button className={`nav-item ${view === "profiles" ? "active" : ""}`} onClick={() => setView("profiles")}><span className="nav-glyph">◉</span>Consent profiles</button>
        <button className="nav-item"><span className="nav-glyph">?</span>Documentation</button>
        <button className={`nav-item ${view === "settings" ? "active" : ""}`} onClick={() => setView("settings")}><span className="nav-glyph">⚙</span>Settings</button>
        <div className="account-row"><span className="avatar">MD</span><span><strong>Michael deVry</strong><small>Owner</small></span></div>
      </div>
    </aside>

    <section className="workspace">
      <header className="topbar"><div className="breadcrumb"><span>Meridian Studio</span><b>/</b><strong>{pageTitle}</strong></div><div className="top-actions"><span className="privacy-badge"><i /> Protected workspace</span><button className="icon-button">⌘ K</button></div></header>
      <div className="workspace-body dashboard-body">
        {view === "workspace" && <Workspace setView={setView} />}
        {view === "scans" && <>
          <Header eyebrow="Observed behavior" title="Site Scans" description="Maintain a timestamped source of truth for cookies, browser storage, scripts, and network destinations." action={<button className="primary-button page-action" onClick={runScan}>{scanning ? "Scanning…" : "Run rescan"}</button>} />
          <div className="metric-grid"><Metric value="23" label="Active technologies" note="2 changed since last scan" /><Metric value="12" label="Cookies" note="4 first-party · 8 vendor" /><Metric value="7" label="Storage keys" note="Local, session and IndexedDB" /><Metric value="4" label="Review items" note="Action recommended" tone="warn" /></div>
          <section className="dashboard-card">
            <div className="card-heading"><div><h2>Active technology inventory</h2><p>Current observed state from {scanTime}</p></div><div className="segmented">{["All", "Cookies", "Storage", "Network"].map((filter) => <button key={filter} className={inventoryFilter === filter ? "selected" : ""} onClick={() => setInventoryFilter(filter)}>{filter}</button>)}</div></div>
            <div className="data-table technology-table"><div className="table-head"><span>Technology</span><span>Provider</span><span>Category</span><span>First observed</span><span>Page</span><span>Status</span></div>{visibleTechnologies.length ? visibleTechnologies.map((item) => <div className="table-row" key={item.name}><span><strong>{item.name}</strong><small>{item.kind}</small></span><span>{item.provider}</span><span>{item.category}</span><span>{item.state}</span><span><code>{item.page}</code></span><span><Badge tone={item.status === "Declared" ? "good" : "warn"}>{item.status}</Badge></span></div>) : <div className="inventory-empty">No {inventoryFilter.toLowerCase()} observations in the active scan.</div>}</div>
          </section>
          <div className="two-column">
            <section className="dashboard-card"><div className="card-heading"><div><h2>Scan history</h2><p>Immutable snapshots retained for comparison</p></div></div><div className="history-list">{scanHistory.map((scan, i) => <button key={`${scan.date}-${i}`}><span className="history-icon">{scan.status === "Current" ? "●" : "○"}</span><span><strong>{scan.date}</strong><small>{scan.pages} pages · {scan.tech} technologies</small></span><Badge tone={scan.status === "Current" ? "good" : "neutral"}>{scan.changes}</Badge><span>›</span></button>)}</div></section>
            <section className="dashboard-card"><div className="card-heading"><div><h2>Rescan schedule</h2><p>Refresh the active inventory automatically</p></div></div><div className="schedule-box"><label>Frequency<select value={schedule} onChange={(e) => setSchedule(e.target.value)}><option>Manual only</option><option>Daily</option><option>Weekly</option><option>Monthly</option></select></label><label>Scan profile<select><option>Core consent states</option><option>Full audit</option></select></label><div className="next-run"><span>Next scheduled scan</span><strong>{schedule === "Weekly" ? "Aug 17, 2026 · 8:00 AM" : schedule}</strong></div></div></section>
          </div>
        </>}
        {view === "tagging" && <>
          <Header eyebrow="Configuration governance" title="Tagging" description="Classify GTM tags, reconcile browser evidence, and review inferred Google consent requirements." action={<button className="secondary-button page-action">Upload GTM export</button>} />
          <div className="notice-strip"><span>◇</span><div><strong>Consent inference is advisory.</strong><small>Every recommendation shows its evidence and remains subject to explicit approval before export.</small></div><Badge tone="good">18 tags inspected</Badge></div>
          <section className="dashboard-card"><div className="card-heading"><div><h2>Tag classification</h2><p>Provider, purpose, and inferred Consent Mode categories</p></div><Badge>Registry v0.3.0</Badge></div><div className="data-table tagging-table"><div className="table-head"><span>Tag</span><span>Provider / purpose</span><span>Inferred consent categories</span><span>Confidence</span><span>Status</span></div>{tags.map((tag) => <div className="table-row" key={tag.name}><span><strong>{tag.name}</strong></span><span><strong>{tag.provider}</strong><small>{tag.purpose}</small></span><span className="signal-list">{tag.signals.map((signal) => <code key={signal}>{signal}</code>)}</span><span>{tag.confidence}</span><span><Badge tone={tag.status === "Verified" ? "good" : "warn"}>{tag.status}</Badge></span></div>)}</div></section>
          <section className="dashboard-card consent-reference"><div className="card-heading"><div><h2>Google consent category reference</h2><p>The seven signals available to Meridian classification rules</p></div></div><div className="signal-grid">{consentSignals.map((signal) => <div key={signal}><code>{signal}</code><span>{signal.replaceAll("_", " ")}</span></div>)}</div></section>
        </>}
        {view === "analytics" && <>
          <Header eyebrow="Monitoring" title="Analytics" description="Basic consent monitoring and Consent Impact Analytics for the selected property." action={<Badge tone="coming">Coming next</Badge>} />
          <div className="metric-grid"><Metric value="—" label="Consent rate" note="Awaiting collector data" /><Metric value="—" label="Analytics retained" note="Consent impact estimate" /><Metric value="—" label="Ad eligibility" note="Consent impact estimate" /><Metric value="0" label="Implementation alerts" note="No active data source" /></div>
          <section className="dashboard-card empty-analytics"><div className="chart-placeholder"><div className="fake-chart"><i/><i/><i/><i/><i/><i/><i/><i/></div><span>CONSENT TREND</span></div><div><Badge tone="coming">Analytics placeholder</Badge><h2>Connect Consent Impact collection</h2><p>This area will monitor consent choices, measurement availability, regional behavior, and implementation health without collecting raw identifiers.</p><button className="secondary-button" onClick={() => setView("integrations")}>Configure data sources</button></div></section>
        </>}
        {view === "integrations" && integrationDetail === "gtm" && (
          <GtmIntegration
            onBack={() => setIntegrationDetail(null)}
            onConnectionChange={handleGtmConnectionChange}
          />
        )}
        {view === "integrations" && integrationDetail === null && <>
          <Header eyebrow="Connected systems" title="Integrations" description="Connect measurement platforms and choose where Meridian stores consent receipts, scan evidence, and audit records." action={<button className="primary-button page-action">Add integration</button>} />
          <div className="integration-summary"><div><span className="health-dot"/><p><strong>{integrationNotice}</strong><small>Connection credentials are handled server-side and never exposed in the consent SDK.</small></p></div><Badge tone="good">Systems healthy</Badge></div>
          <section className="integration-section">
            <div className="section-title"><div><span className="eyebrow">Measurement</span><h2>Google platform</h2><p>Use property-scoped access. Meridian requests only the permissions required for each workflow.</p></div></div>
            <div className="integration-grid google-grid">{[
              { name: "Google Analytics", mark: "GA", description: "Read consent-aware reporting and populate Consent Impact Analytics.", detail: "GA4 property · Reporting access", tone: "orange" },
              { name: "Google Tag Manager", mark: "GTM", description: "Select containers and manage tag drafts without versioning or publishing access.", detail: "Account User · Container Edit", tone: "blue" },
            ].map((service) => { const connected = connectedServices.includes(service.name); const isGtm = service.name === "Google Tag Manager"; return <article className="integration-card" key={service.name}><div className={`integration-mark ${service.tone}`}>{service.mark}</div><div className="integration-card-head"><div><h3>{service.name}</h3><Badge tone={connected ? "good" : "neutral"}>{connected ? "Connected" : "Not connected"}</Badge></div><button className="icon-button">•••</button></div><p>{service.description}</p><div className="integration-meta"><span>{service.detail}</span><strong>{connected ? "Last checked just now" : "OAuth connection required"}</strong></div><button className={connected ? "secondary-button" : "primary-button"} onClick={() => isGtm ? setIntegrationDetail("gtm") : toggleService(service.name)}>{isGtm ? "Configure GTM" : connected ? "Disconnect" : "Connect GA4"}</button></article>; })}</div>
          </section>
          <section className="integration-section storage-section">
            <div className="section-title"><div><span className="eyebrow">Evidence storage</span><h2>Data destination</h2><p>Select the primary destination for durable consent and audit data. Scan exports remain portable regardless of provider.</p></div><Badge tone="coming">Bring your own storage</Badge></div>
            <div className="storage-layout"><div className="storage-grid">{[
              ["Cloudflare D1", "D1", "Serverless SQL", "Recommended for a lightweight Meridian deployment"], ["Google BigQuery", "BQ", "Data warehouse", "Consent analytics and long-term audit retention"], ["Databricks", "DB", "Lakehouse", "Enterprise governance and downstream modeling"], ["Amazon S3", "S3", "Object storage", "Append-only evidence packages and archival"], ["Custom HTTPS", "↗", "Webhook", "Send signed records to an existing data service"],
            ].map(([name, mark, kind, description]) => <button key={name} className={`storage-option ${storageDestination === name ? "selected" : ""}`} onClick={() => { setStorageDestination(name); setIntegrationNotice(`${name} selected as evidence destination · unsaved`); }}><span>{mark}</span><div><strong>{name}</strong><small>{kind}</small><p>{description}</p></div><i>{storageDestination === name ? "✓" : ""}</i></button>)}</div>
              <aside key={storageDestination} className="dashboard-card destination-config"><div className="card-heading"><div><h2>{storageDestination}</h2><p>Primary evidence destination</p></div><Badge tone="good">Selected</Badge></div><div className="destination-body"><label>Connection name<input defaultValue={`${storageDestination} · Production`} /></label><label>Environment<select><option>Production</option><option>Staging</option><option>Development</option></select></label><div className="secure-field"><span>Credentials</span><strong>Configured securely after connection</strong><small>Secrets are encrypted and are never included in browser code or exports.</small></div><button className="primary-button" onClick={() => { if (!connectedServices.includes(storageDestination)) setConnectedServices((items) => [...items, storageDestination]); setIntegrationNotice(`${storageDestination} destination saved · just now`); }}>Save destination</button></div></aside>
            </div>
          </section>
          <section className="dashboard-card routing-card"><div className="card-heading"><div><h2>Data routing</h2><p>Choose which Meridian records are written to {storageDestination}</p></div><Badge>{connectedServices.includes(storageDestination) ? "Active" : "Draft"}</Badge></div><div className="routing-grid">{[
            ["Consent receipts", "Choice, timestamp, profile, policy and notice version", true], ["Site Scan snapshots", "Cookie, storage, script and network evidence", true], ["Audit & validation logs", "Control results, changes, errors and export history", true], ["Consent Impact aggregates", "Privacy-preserving daily measurement availability", false],
          ].map(([name, detail, checked]) => <label key={String(name)}><input type="checkbox" defaultChecked={Boolean(checked)} /><span><strong>{name}</strong><small>{detail}</small></span></label>)}</div></section>
        </>}
        {view === "compliance" && <>
          <Header eyebrow="Technical assurance" title="Compliance" description="Map consent requirements to verifiable controls, retained evidence, accountable owners, and explicit legal-review boundaries." action={<button className="secondary-button page-action">Export evidence map</button>} />
          <div className="compliance-boundary"><span>i</span><div><strong>Implementation evidence—not legal certification</strong><small>Meridian verifies configured and observed behavior. Applicability, lawful basis, statutory interpretation, and certification remain organizational and legal decisions.</small></div><Badge tone="coming">Framework v1</Badge></div>
          <div className="metric-grid"><Metric value="7" label="Evidenced controls" note="Technical evidence available" /><Metric value="5" label="Partial controls" note="Additional implementation needed" /><Metric value="2" label="Material gaps" note="Receipt store and server gates" tone="warn" /><Metric value="1" label="Legal review" note="Applicability / certification" /></div>
          <div className="compliance-layout">
            <section className="dashboard-card control-register">
              <div className="card-heading"><div><h2>Control register</h2><p>Secrails guide areas normalized against primary regulatory and platform guidance</p></div><div className="segmented">{["All", "Evidenced", "Partial", "Gap"].map((filter) => <button key={filter} className={controlFilter === filter ? "selected" : ""} onClick={() => setControlFilter(filter)}>{filter}</button>)}</div></div>
              <div className="control-head"><span>Area / control</span><span>Status</span><span>Evidence</span><span></span></div>
              <div className="control-list">{visibleControls.map((item) => {
                const index = complianceControls.indexOf(item);
                return <button key={`${item.area}-${item.control}`} className={selectedControl === index ? "selected" : ""} onClick={() => setSelectedControl(index)}><span><small>{item.area}</small><strong>{item.control}</strong></span><Badge tone={item.status === "Evidenced" ? "good" : item.status === "Gap" ? "warn" : item.status === "Legal review" ? "coming" : "neutral"}>{item.status}</Badge><span className="control-evidence">{item.evidence}</span><b>›</b></button>;
              })}</div>
            </section>
            <aside className="compliance-side">
              <section className="dashboard-card evidence-card"><div className="card-heading"><div><h2>Control detail</h2><p>{complianceControls[selectedControl].area}</p></div><Badge tone={complianceControls[selectedControl].status === "Evidenced" ? "good" : complianceControls[selectedControl].status === "Gap" ? "warn" : "neutral"}>{complianceControls[selectedControl].status}</Badge></div><div className="evidence-body"><h3>{complianceControls[selectedControl].control}</h3><span>Current evidence</span><p>{complianceControls[selectedControl].evidence}</p><span>Required next control</span><p>{complianceControls[selectedControl].next}</p><button className="secondary-button">Create implementation task</button></div></section>
              <section className="dashboard-card priority-card"><div className="card-heading"><div><h2>Priority build order</h2><p>Highest-risk gaps first</p></div></div><ol><li><span>01</span><div><strong>Consent evidence store</strong><small>Authenticated, append-only receipts with notice snapshots</small></div></li><li><span>02</span><div><strong>Server enforcement contract</strong><small>Trusted consent verification before downstream activation</small></div></li><li><span>03</span><div><strong>Regional routing</strong><small>Explicit resolver, safe fallback and decision evidence</small></div></li><li><span>04</span><div><strong>Continuous assurance</strong><small>Scan regressions, receipt audits and performance budgets</small></div></li></ol></section>
            </aside>
          </div>
          <section className="dashboard-card source-basis"><div className="card-heading"><div><h2>Requirements basis</h2><p>Source claims are separated from Meridian’s technical interpretation</p></div></div><div className="source-grid"><a href="https://secrails.com/blog/consent-management-platform-guide-2026" target="_blank" rel="noreferrer"><strong>Secrails CMP Guide 2026</strong><small>Product and operational framework</small></a><a href="https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX%3A02016R0679-20160504" target="_blank" rel="noreferrer"><strong>GDPR Article 7</strong><small>Proof and withdrawal conditions</small></a><a href="https://www.edpb.europa.eu/our-work-tools/our-documents/report/report-work-undertaken-cookie-banner-taskforce_en" target="_blank" rel="noreferrer"><strong>EDPB Cookie Banner Taskforce</strong><small>Common banner findings</small></a><a href="https://developers.google.com/tag-platform/security/guides/consent" target="_blank" rel="noreferrer"><strong>Google Consent Mode</strong><small>Default and update implementation</small></a></div></section>
        </>}
        {view === "projects" && <>
          <Header eyebrow="Workspace structure" title="Consent groups & properties" description="Organize related regional web properties under shared consent governance." action={<button className="primary-button page-action">Create consent group</button>} />
          <section className="dashboard-card group-card"><div className="group-header"><span className="group-mark">MS</span><div><div className="group-title"><h2>Measurement Stack Global</h2><Badge tone="good">Active group</Badge></div><p>Shared profiles, branding, and disclosure governance across 3 regional properties.</p></div><button className="icon-button">•••</button></div><div className="property-grid">{[
            ["Measurement Stack US", "measurementstack.com", "US opt-out", "Current"], ["Measurement Stack EU", "eu.measurementstack.com", "EU / UK consent", "Scan due"], ["Measurement Stack UK", "uk.measurementstack.com", "EU / UK consent", "Current"]
          ].map((p) => <button className={property === p[0] ? "selected" : ""} key={p[1]} onClick={() => setProperty(p[0])}><span className="property-status"/><strong>{p[0]}</strong><small>{p[1]}</small><div><Badge>{p[2]}</Badge><span>{p[3]} ›</span></div></button>)}<button className="add-property"><span>＋</span><strong>Add web property</strong><small>Attach a regional site</small></button></div></section>
        </>}
        {view === "profiles" && <>
          <Header eyebrow="Policy controls" title="Consent profiles" description="Use Meridian defaults or create reusable privacy profiles for a group or individual property." action={<button className="primary-button page-action" onClick={createProfile}>Create profile</button>} />
          <div className="profile-cards">{[["Strict global", "Prior consent for analytics and advertising when location is unavailable.", "Built in"], ["EU / UK consent", "Granular opt-in with equal reject and accept choices and withdrawal.", "Built in"], ["U.S. opt-out", "Analytics by default with sale/share and targeted-ad controls.", "Built in"], ...customProfiles.map((name) => [name, "Custom consent behavior for your organization.", "Custom"])].map((p) => <article key={p[0]}><div><Badge tone={p[2] === "Custom" ? "coming" : "neutral"}>{p[2]}</Badge><button>•••</button></div><h2>{p[0]}</h2><p>{p[1]}</p><span>GPC enforced · Receipts enabled</span></article>)}</div>
          <section className="dashboard-card profile-builder"><div><span className="eyebrow">Custom profile</span><h2>Create a policy profile</h2><p>Start with a safe baseline, then configure default states, regional rules, GPC behavior, and receipt settings.</p></div><div><label>Profile name<input value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="e.g. California properties" /></label><label>Start from<select><option>Strict global</option><option>EU / UK consent</option><option>U.S. opt-out</option></select></label><button className="secondary-button" onClick={createProfile}>Save custom profile</button></div></section>
        </>}
        {view === "settings" && <>
          <Header eyebrow="Appearance" title="Banner & UI branding" description="Apply basic white-label styling to the Meridian Consent banner and settings toggle." />
          <div className="branding-layout"><section className="dashboard-card branding-form"><div className="card-heading"><div><h2>Brand assets</h2><p>Applied to the consent banner and preferences interface</p></div></div><div className="settings-stack"><label>Organization name<input defaultValue="Measurement Stack" /></label><div><span className="form-label">Custom logo</span><button className="logo-upload" onClick={() => logoInput.current?.click()}>{logo ? <img src={logo} alt="Uploaded logo preview" /> : <span>＋</span>}<div><strong>{logo ? "Logo uploaded" : "Upload logo"}</strong><small>SVG, PNG, or WebP · transparent preferred</small></div></button><input ref={logoInput} hidden type="file" accept="image/svg+xml,image/png,image/webp" onChange={(e) => uploadLogo(e.target.files?.[0])} /></div><label>Primary color<div className="color-field"><input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} /><input value={accent} onChange={(e) => setAccent(e.target.value)} /></div></label><label>Interface style<select><option>Dark</option><option>Light</option><option>Match visitor preference</option></select></label><button className="primary-button">Save branding</button></div></section>
          <section className="dashboard-card brand-preview"><div className="card-heading"><div><h2>Live preview</h2><p>Desktop banner and persistent settings toggle</p></div></div><div className="preview-stage"><div className="sample-page"><div className="sample-header"/><div className="sample-lines"><i/><i/><i/></div></div><div className="consent-banner"><div className="preview-logo">{logo ? <img src={logo} alt="" /> : <img src={`${STUDIO_ASSET_PATH}meridian-mark-light.svg`} alt="" />}</div><div><strong>Your privacy choices</strong><p>We use cookies and similar technologies to operate this site and, with your permission, understand usage.</p><button style={{ background: accent }}>Accept all</button><button>Reject non-essential</button></div></div><button className="settings-toggle" style={{ borderColor: accent }}>⚙</button></div></section></div>
        </>}
      </div>
    </section>
  </main>;
}

function GtmIntegration({
  onBack,
  onConnectionChange,
}: {
  onBack: () => void;
  onConnectionChange?: (connected: boolean, notice?: string) => void;
}) {
  const requiredScope = "https://www.googleapis.com/auth/tagmanager.edit.containers";
  const confirmationPhrase = "RUN MERIDIAN GTM TEST";
  const permissionRows = [
    ["GTM account", "User", "Required", "Lists accessible accounts and basic account metadata."],
    ["GTM account", "Administrator", "Not requested", "Would allow container creation and user-permission management."],
    ["Selected container", "Edit", "Required", "Creates, updates, and deletes draft tags in a workspace."],
    ["Selected container", "Approve", "Not requested", "Can create versions; outside Meridian's draft-only boundary."],
    ["Selected container", "Publish", "Not requested", "Can publish versions to environments; explicitly excluded."],
  ];
  const excludedScopes = [
    "tagmanager.publish",
    "tagmanager.edit.containerversions",
    "tagmanager.delete.containers",
    "tagmanager.manage.users",
    "tagmanager.manage.accounts",
  ];
  const testSteps = [
    ["01", "Authorize Google account", "OAuth web-server flow; credentials and refresh tokens remain server-side."],
    ["02", "Select account and container", "List only resources already visible to the authorized Google user."],
    ["03", "Choose an isolated workspace", "Use Meridian Integration Test so no draft work touches the Default Workspace."],
    ["04", "Probe tag permissions", "List tags, create a clearly labeled test tag, edit it, then delete it."],
    ["05", "Verify the publish boundary", "Confirm no publish or container-version scope was granted and retain the test audit record."],
  ];

  const onConnectionChangeRef = useRef(onConnectionChange);
  onConnectionChangeRef.current = onConnectionChange;

  const [status, setStatus] = useState<"loading" | "connected" | "disconnected" | "error">("loading");
  const [error, setError] = useState("");
  const [accounts, setAccounts] = useState<GtmAccount[]>([]);
  const [containers, setContainers] = useState<GtmContainer[]>([]);
  const [workspaces, setWorkspaces] = useState<GtmWorkspace[]>([]);
  const [accountId, setAccountId] = useState("");
  const [containerId, setContainerId] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [loadingContainers, setLoadingContainers] = useState(false);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
  const [testPhase, setTestPhase] = useState<"idle" | "planned" | "running" | "passed" | "failed">("idle");
  const [testPlan, setTestPlan] = useState<string[]>([]);
  const [testMessage, setTestMessage] = useState("");
  const connected = status === "connected";
  const canRunTest = connected && Boolean(accountId && containerId) && testPhase !== "running";

  useEffect(() => {
    let active = true;
    async function loadStatus() {
      try {
        const response = await studioAuthFetch("/api/integrations/google/status");
        const body = await response.json().catch(() => ({}));
        if (!active) return;
        if (!response.ok) throw new Error(body.error || "Could not verify Google connection status.");
        if (body.connected) {
          setStatus("connected");
          onConnectionChangeRef.current?.(true, "Google Tag Manager connected · just now");
          setLoadingAccounts(true);
          const accountsResponse = await studioAuthFetch("/api/integrations/gtm/accounts");
          const accountsBody = await accountsResponse.json().catch(() => ({}));
          if (!active) return;
          if (!accountsResponse.ok) throw new Error(accountsBody.error || "Could not list GTM accounts.");
          const list = Array.isArray(accountsBody.accounts) ? accountsBody.accounts as GtmAccount[] : [];
          setAccounts(list);
          setAccountId(list[0]?.accountId || "");
          setError("");
        } else {
          setStatus("disconnected");
          onConnectionChangeRef.current?.(false);
        }
      } catch (loadError) {
        if (!active) return;
        setStatus("error");
        setError(loadError instanceof Error ? loadError.message : "Connection status unavailable.");
      } finally {
        if (active) setLoadingAccounts(false);
      }
    }
    void loadStatus();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!connected || !accountId) {
      setContainers([]);
      setContainerId("");
      return;
    }
    let active = true;
    setLoadingContainers(true);
    async function loadContainers() {
      try {
        const response = await studioAuthFetch(`/api/integrations/gtm/containers?accountId=${encodeURIComponent(accountId)}`);
        const body = await response.json().catch(() => ({}));
        if (!active) return;
        if (!response.ok) throw new Error(body.error || "Could not list GTM containers.");
        const list = Array.isArray(body.containers) ? body.containers as GtmContainer[] : [];
        setContainers(list);
        setContainerId(list[0]?.containerId || "");
        setError("");
      } catch (loadError) {
        if (!active) return;
        setContainers([]);
        setContainerId("");
        setError(loadError instanceof Error ? loadError.message : "Could not list GTM containers.");
      } finally {
        if (active) setLoadingContainers(false);
      }
    }
    void loadContainers();
    return () => { active = false; };
  }, [accountId, connected]);

  useEffect(() => {
    if (!connected || !accountId || !containerId) {
      setWorkspaces([]);
      setWorkspaceId("");
      return;
    }
    let active = true;
    setLoadingWorkspaces(true);
    async function loadWorkspaces() {
      try {
        const params = new URLSearchParams({ accountId, containerId });
        const response = await studioAuthFetch(`/api/integrations/gtm/workspaces?${params.toString()}`);
        const body = await response.json().catch(() => ({}));
        if (!active) return;
        if (!response.ok) throw new Error(body.error || "Could not list GTM workspaces.");
        const list = Array.isArray(body.workspaces) ? body.workspaces as GtmWorkspace[] : [];
        setWorkspaces(list);
        const preferred = list.find((workspace) => /meridian integration test/i.test(String(workspace.name || ""))) || list[0];
        setWorkspaceId(preferred?.workspaceId || "");
        setError("");
      } catch (loadError) {
        if (!active) return;
        setWorkspaces([]);
        setWorkspaceId("");
        setError(loadError instanceof Error ? loadError.message : "Could not list GTM workspaces.");
      } finally {
        if (active) setLoadingWorkspaces(false);
      }
    }
    void loadWorkspaces();
    return () => { active = false; };
  }, [accountId, containerId, connected]);

  async function runPermissionTest(confirm = false) {
    if (!canRunTest && !confirm) return;
    setTestPhase("running");
    setTestMessage(confirm ? "Running reversible permission test…" : "Requesting dry-run plan…");
    try {
      const response = await studioAuthFetch("/api/integrations/gtm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          containerId,
          ...(confirm ? { confirmation: confirmationPhrase } : {}),
        }),
      });
      const body = await response.json().catch(() => ({})) as GtmTestResult;
      if (!response.ok) {
        setTestPhase("failed");
        setTestMessage(body.error || "Permission test failed.");
        setError(body.error || "Permission test failed.");
        return;
      }
      if (body.dryRun) {
        setTestPhase("planned");
        setTestPlan(Array.isArray(body.plan) ? body.plan : []);
        setTestMessage("Dry-run ready. Confirm to create, edit, and delete temporary GTM resources.");
        return;
      }
      setTestPhase("passed");
      setTestMessage("Permission test completed. Temporary workspace resources were cleaned up.");
      setError("");
    } catch (testError) {
      setTestPhase("failed");
      const message = testError instanceof Error ? testError.message : "Permission test failed.";
      setTestMessage(message);
      setError(message);
    }
  }

  const authorizeHref = `/api/integrations/google/authorize?return_to=${encodeURIComponent(`${STUDIO_PATH}?integration=gtm`)}`;
  const selectedAccount = accounts.find((account) => account.accountId === accountId);
  const selectedContainer = containers.find((container) => container.containerId === containerId);
  const selectedWorkspace = workspaces.find((workspace) => workspace.workspaceId === workspaceId);
  const loadingResources = loadingAccounts || loadingContainers || loadingWorkspaces;

  return <>
    <div className="integration-detail-nav"><button className="text-button" onClick={onBack}>← All integrations</button><Badge tone={connected ? "good" : "neutral"}>{connected ? "Connected" : "Draft configuration"}</Badge></div>
    <Header
      eyebrow="Google platform"
      title="Google Tag Manager"
      description="Select authorized containers and manage workspace tag drafts while keeping approval and publishing outside Meridian."
      action={<button className="primary-button page-action" onClick={() => { location.href = authorizeHref; }}>{connected ? "Reauthorize Google" : "Authorize with Google"}</button>}
    />
    <div className="gtm-boundary">
      <span className="integration-mark blue">GTM</span>
      <div>
        <strong>Least-privilege draft access</strong>
        <small>
          {status === "loading" && "Checking Google connection status…"}
          {status === "disconnected" && "Authorize Google to list accounts and containers available to your user."}
          {status === "error" && (error || "Google connection status could not be verified.")}
          {connected && !loadingAccounts && accounts.length === 0 && "Connected, but no GTM accounts were returned for this Google user."}
          {connected && accounts.length > 0 && `Connected · ${accounts.length} account${accounts.length === 1 ? "" : "s"} available.`}
        </small>
      </div>
      <Badge tone={connected ? "good" : "warn"}>{connected ? "Connected" : status === "loading" ? "Checking" : "Not connected"}</Badge>
    </div>

    <section className="dashboard-card gtm-resources">
      <div className="card-heading">
        <div>
          <h2>Authorized resources</h2>
          <p>Accounts, containers, and workspaces returned by the Google Tag Manager API for the connected user.</p>
        </div>
        <Badge tone={connected ? "good" : "neutral"}>{loadingResources ? "Loading" : connected ? "Live" : "Waiting"}</Badge>
      </div>
      <div className="gtm-resource-grid">
        <label>
          GTM account
          <select value={accountId} disabled={!connected || loadingAccounts || accounts.length === 0} onChange={(event) => { setAccountId(event.target.value); setTestPhase("idle"); setTestPlan([]); setTestMessage(""); }}>
            {!connected && <option value="">Authorize Google to load accounts</option>}
            {connected && loadingAccounts && <option value="">Loading accounts…</option>}
            {connected && !loadingAccounts && accounts.length === 0 && <option value="">No accounts available</option>}
            {accounts.map((account) => (
              <option key={account.accountId || account.name} value={account.accountId || ""}>
                {account.name || account.accountId}
              </option>
            ))}
          </select>
        </label>
        <label>
          Container
          <select value={containerId} disabled={!connected || !accountId || loadingContainers || containers.length === 0} onChange={(event) => { setContainerId(event.target.value); setTestPhase("idle"); setTestPlan([]); setTestMessage(""); }}>
            {!accountId && <option value="">Select an account first</option>}
            {accountId && loadingContainers && <option value="">Loading containers…</option>}
            {accountId && !loadingContainers && containers.length === 0 && <option value="">No containers available</option>}
            {containers.map((container) => (
              <option key={container.containerId || container.publicId || container.name} value={container.containerId || ""}>
                {container.name || container.publicId || container.containerId}
              </option>
            ))}
          </select>
        </label>
        <label>
          Workspace
          <select value={workspaceId} disabled={!connected || !containerId || loadingWorkspaces || workspaces.length === 0} onChange={(event) => setWorkspaceId(event.target.value)}>
            {!containerId && <option value="">Select a container first</option>}
            {containerId && loadingWorkspaces && <option value="">Loading workspaces…</option>}
            {containerId && !loadingWorkspaces && workspaces.length === 0 && <option value="">No workspaces available</option>}
            {workspaces.map((workspace) => (
              <option key={workspace.workspaceId || workspace.name} value={workspace.workspaceId || ""}>
                {workspace.name || workspace.workspaceId}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="gtm-resource-error">{error}</p>}
      {connected && selectedAccount && selectedContainer && (
        <p className="gtm-resource-summary">
          Selected <strong>{selectedAccount.name || selectedAccount.accountId}</strong>
          {" · "}
          <strong>{selectedContainer.name || selectedContainer.publicId || selectedContainer.containerId}</strong>
          {selectedContainer.publicId ? ` (${selectedContainer.publicId})` : ""}
          {selectedWorkspace ? <>{" · "}<strong>{selectedWorkspace.name || selectedWorkspace.workspaceId}</strong></> : null}
        </p>
      )}
    </section>

    <div className="gtm-layout">
      <section className="dashboard-card">
        <div className="card-heading"><div><h2>GTM permissions</h2><p>Native access assigned to the Google user authorizing Meridian</p></div><Badge>Recommended</Badge></div>
        <div className="permission-table">
          <div className="permission-head"><span>Level</span><span>Permission</span><span>Meridian</span><span>Reason</span></div>
          {permissionRows.map(([level, permission, statusLabel, reason]) => <div className="permission-row" key={`${level}-${permission}`}><span>{level}</span><strong>{permission}</strong><Badge tone={statusLabel === "Required" ? "good" : "neutral"}>{statusLabel}</Badge><small>{reason}</small></div>)}
        </div>
      </section>
      <aside className="dashboard-card scope-card">
        <div className="card-heading"><div><h2>OAuth scope</h2><p>One Google Tag Manager scope</p></div></div>
        <div className="scope-body"><span>REQUESTED</span><code>{requiredScope}</code><p>This scope covers container components, including tag create, update, and delete operations. Meridian's backend restricts use to the selected account, container, workspace, and supported tag endpoints.</p><span>EXPLICITLY EXCLUDED</span><ul>{excludedScopes.map((scope) => <li key={scope}><code>{scope}</code></li>)}</ul></div>
      </aside>
    </div>

    <section className="dashboard-card gtm-capabilities">
      <div className="card-heading"><div><h2>Effective capability boundary</h2><p>Google permissions are broad; Meridian applies a narrower product authorization policy.</p></div></div>
      <div className="capability-grid">
        <div><Badge tone="good">Allowed</Badge><strong>Discovery</strong><p>List accessible accounts, containers, workspaces, and tags.</p></div>
        <div><Badge tone="good">Allowed</Badge><strong>Draft tag changes</strong><p>Create, retrieve, update, revert, and delete tags in the selected workspace.</p></div>
        <div><Badge tone="warn">Blocked</Badge><strong>Governance changes</strong><p>No user management, account administration, container deletion, or environment changes.</p></div>
        <div><Badge tone="warn">Blocked</Badge><strong>Release actions</strong><p>No container-version creation, approval, submission, or publishing.</p></div>
      </div>
    </section>

    <section className="dashboard-card connection-test">
      <div className="card-heading">
        <div>
          <h2>Measurement Stack permission test</h2>
          <p>Safe validation plan for measurementstack.com; no test change is published to the live site.</p>
        </div>
        <Badge tone={testPhase === "passed" ? "good" : testPhase === "failed" ? "warn" : canRunTest ? "good" : "coming"}>
          {testPhase === "passed" ? "Passed" : testPhase === "failed" ? "Failed" : testPhase === "planned" ? "Confirm" : canRunTest ? "Ready" : "Authorization required"}
        </Badge>
      </div>
      <div className="test-layout">
        <ol>
          {(testPlan.length ? testPlan.map((step, index) => [String(index + 1).padStart(2, "0"), step, "Dry-run step"] as const) : testSteps).map(([number, title, detail]) => (
            <li key={`${number}-${title}`}><span>{number}</span><div><strong>{title}</strong><small>{detail}</small></div></li>
          ))}
        </ol>
        <aside>
          <label>Target property<input value="measurementstack.com" readOnly /></label>
          <label>Selected container<input value={selectedContainer?.name || selectedContainer?.publicId || selectedContainer?.containerId || "Not selected"} readOnly /></label>
          <label>Test workspace<input value="Meridian Integration Test" readOnly /></label>
          <div className="secure-field">
            <span>Test artifact</span>
            <strong>Meridian — Permission Test</strong>
            <small>The tag is created, updated, and deleted inside an isolated workspace. No version is created and nothing is published.</small>
          </div>
          <button
            className="primary-button"
            disabled={testPhase === "running" || (testPhase !== "planned" && !canRunTest)}
            onClick={() => { void runPermissionTest(testPhase === "planned"); }}
          >
            {testPhase === "running" ? "Running…" : testPhase === "planned" ? `Confirm ${confirmationPhrase}` : "Run permission test"}
          </button>
          <small className="disabled-help">
            {testMessage
              || (canRunTest
                ? "First request returns a dry-run plan. Confirm to execute the reversible mutation test."
                : "Authorize Google and select account + container to enable this test.")}
          </small>
        </aside>
      </div>
    </section>
  </>;
}

function Metric({ value, label, note, tone }: { value: string; label: string; note: string; tone?: string }) { return <div className={`metric-card ${tone || ""}`}><span>{value}</span><strong>{label}</strong><small>{note}</small></div>; }

function Workspace({ setView }: { setView: (view: View) => void }) {
  return <><Header eyebrow="Implementation workspace" title="Measurement Stack" description="Complete the setup, monitor observed technologies, and keep consent governance current." action={<Badge tone="good">4 of 7 complete</Badge>} /><div className="workspace-grid"><section className="dashboard-card setup-overview"><div className="card-heading"><div><h2>Consent implementation</h2><p>One guided workflow from observed behavior to validated export</p></div><span className="progress-number">57%</span></div><div className="large-progress"><i style={{ width: "57%" }}/></div>{[
    ["01", "Site scan", "23 technologies observed", "Complete", "scans"], ["02", "GTM container", "18 tags inspected", "Complete", "tagging"], ["03", "Reconcile evidence", "4 items need review", "Review", "tagging"], ["04", "Policy profile", "Strict global", "Complete", "profiles"], ["05", "Connect integrations", "Choose evidence destination", "Next", "integrations"], ["06", "Validate", "Waiting for integrations", "Locked", "tagging"], ["07", "Export", "Implementation package", "Locked", "tagging"]
  ].map((s) => <button className="setup-row" key={s[0]} onClick={() => setView(s[4] as View)}><span>{s[0]}</span><div><strong>{s[1]}</strong><small>{s[2]}</small></div><Badge tone={s[3] === "Complete" ? "good" : s[3] === "Review" ? "warn" : "neutral"}>{s[3]}</Badge><b>›</b></button>)}</section><aside className="workspace-side"><section className="dashboard-card quick-card"><h2>Property health</h2><div><span>Site inventory</span><Badge tone="good">Current</Badge></div><div><span>Tag classification</span><Badge tone="warn">4 review</Badge></div><div><span>Compliance controls</span><Badge tone="warn">2 gaps</Badge></div><div><span>Evidence destination</span><Badge>Not connected</Badge></div><button className="secondary-button" onClick={() => setView("integrations")}>Configure integrations</button></section><section className="dashboard-card quick-card"><h2>Consent group</h2><strong>Measurement Stack Global</strong><p>3 regional properties · 2 profiles</p><button className="secondary-button" onClick={() => setView("projects")}>Manage properties</button></section></aside></div></>;
}
