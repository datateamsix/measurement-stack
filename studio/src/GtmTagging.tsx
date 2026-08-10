import { useEffect, useMemo, useState } from "react";

const CONSENT_TYPES = ["ad_storage", "analytics_storage", "ad_user_data", "ad_personalization", "functionality_storage", "personalization_storage", "security_storage"];
const VERSION_CONFIRMATION = "CREATE UNPUBLISHED GTM VERSION";

type Account = { accountId?: string; name?: string };
type Container = { containerId?: string; name?: string; publicId?: string };
type Workspace = { workspaceId?: string; name?: string };
type Binding = {
  property_key: string; property_name: string; property_domain: string;
  account_id: string; account_name?: string; container_id: string;
  container_name?: string; container_public_id?: string; workspace_id: string; workspace_name?: string;
};
type Finding = {
  tag_id: string; tag_name: string; tag_type?: string; paused?: boolean; api_fingerprint: string;
  provider: string; purposes: string[]; required_consent: string[]; enforcement: string;
  confidence: number; reviewed: boolean; stale_review: boolean; compliance: string;
  compliance_message: string; current_consent: { status: string; types: string[] };
  dependencies: { firing_triggers: { trigger_id: string; trigger_name?: string; trigger_type?: string }[] };
};
type Assessment = {
  registry_version: string;
  generated_at: string;
  summary: { total: number; compliant: number; configuration_required: number; review_required: number; blocking: number; export_ready: boolean };
  tags: Finding[];
};

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`ui-badge ${tone}`}>{children}</span>;
}

async function api(url: string, options?: RequestInit) {
  const authFetch = window.MeasurementStack?.authFetch;
  if (!authFetch) throw new Error("Measurement Stack authentication is unavailable.");
  const response = await authFetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

function propertyIdentity(name: string) {
  const known: Record<string, { key: string; domain: string }> = {
    "Measurement Stack": { key: "measurement-stack", domain: "measurementstack.com" },
    "Measurement Stack US": { key: "measurement-stack-us", domain: "measurementstack.com" },
    "Measurement Stack EU": { key: "measurement-stack-eu", domain: "eu.measurementstack.com" },
    "Measurement Stack UK": { key: "measurement-stack-uk", domain: "uk.measurementstack.com" },
  };
  return known[name] || {
    key: name.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 80),
    domain: "",
  };
}

function downloadJson(filename: string, value: unknown) {
  const href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(href);
}

export default function GtmTagging({ propertyName }: { propertyName: string }) {
  const property = useMemo(() => propertyIdentity(propertyName), [propertyName]);
  const [connected, setConnected] = useState(false);
  const [reauthorizationRequired, setReauthorizationRequired] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [containers, setContainers] = useState<Container[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [accountId, setAccountId] = useState("");
  const [containerId, setContainerId] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [binding, setBinding] = useState<Binding | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [selected, setSelected] = useState<Finding | null>(null);
  const [providerName, setProviderName] = useState("");
  const [enforcement, setEnforcement] = useState("additional");
  const [consentTypes, setConsentTypes] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [versionName, setVersionName] = useState(`Meridian consent configuration · ${new Date().toISOString().slice(0, 10)}`);
  const [versionReady, setVersionReady] = useState(false);
  const [versionPackage, setVersionPackage] = useState<unknown>(null);
  const [createdVersionId, setCreatedVersionId] = useState("");

  async function loadAssessment() {
    const result = await api(`/api/integrations/gtm/assessment?propertyKey=${encodeURIComponent(property.key)}`) as Assessment;
    setAssessment(result);
    setSelected(null);
    setVersionReady(false);
    return result;
  }

  useEffect(() => {
    let active = true;
    setBinding(null); setAssessment(null); setError(""); setNotice(""); setVersionReady(false);
    void (async () => {
      try {
        setBusy("Loading GTM connection…");
        const [status, accountResult, propertyResult] = await Promise.all([
          api("/api/integrations/google/status"),
          api("/api/integrations/gtm/accounts"),
          api(`/api/integrations/gtm/property?propertyKey=${encodeURIComponent(property.key)}`),
        ]);
        if (!active) return;
        setConnected(Boolean(status.connected));
        setReauthorizationRequired(Boolean(status.reauthorizationRequired));
        const accountList = Array.isArray(accountResult.accounts) ? accountResult.accounts as Account[] : [];
        const saved = propertyResult.binding as Binding | null;
        setAccounts(accountList);
        setBinding(saved);
        setAccountId(saved?.account_id || accountList[0]?.accountId || "");
        if (saved) await loadAssessment();
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load the GTM tagging workspace.");
      } finally {
        if (active) setBusy("");
      }
    })();
    return () => { active = false; };
  }, [property.key]);

  useEffect(() => {
    if (!accountId) { setContainers([]); setContainerId(""); return; }
    let active = true;
    void (async () => {
      try {
        const result = await api(`/api/integrations/gtm/containers?accountId=${encodeURIComponent(accountId)}`);
        if (!active) return;
        const list = Array.isArray(result.containers) ? result.containers as Container[] : [];
        setContainers(list);
        setContainerId(binding?.account_id === accountId ? binding.container_id : list[0]?.containerId || "");
      } catch (loadError) { if (active) setError(loadError instanceof Error ? loadError.message : "Could not load containers."); }
    })();
    return () => { active = false; };
  }, [accountId, binding]);

  useEffect(() => {
    if (!accountId || !containerId) { setWorkspaces([]); setWorkspaceId(""); return; }
    let active = true;
    void (async () => {
      try {
        const result = await api(`/api/integrations/gtm/workspaces?accountId=${encodeURIComponent(accountId)}&containerId=${encodeURIComponent(containerId)}`);
        if (!active) return;
        const list = Array.isArray(result.workspaces) ? result.workspaces as Workspace[] : [];
        setWorkspaces(list);
        setWorkspaceId(binding?.container_id === containerId ? binding.workspace_id : list[0]?.workspaceId || "");
      } catch (loadError) { if (active) setError(loadError instanceof Error ? loadError.message : "Could not load workspaces."); }
    })();
    return () => { active = false; };
  }, [accountId, containerId, binding]);

  async function createMeridianWorkspace() {
    try {
      setBusy("Creating Meridian workspace…"); setError("");
      const result = await api("/api/integrations/gtm/workspaces", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, containerId, name: `Meridian – ${propertyName} – Consent`, description: `Consent configuration workspace for ${property.domain || propertyName}. Created by Meridian; versions are never published automatically.` }),
      });
      const created = result.workspace as Workspace;
      setWorkspaces((items) => [...items, created]);
      setWorkspaceId(created.workspaceId || "");
      setNotice("Meridian workspace created. Save it to bind this property.");
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Could not create workspace."); }
    finally { setBusy(""); }
  }

  async function saveBinding() {
    const account = accounts.find((item) => item.accountId === accountId);
    const container = containers.find((item) => item.containerId === containerId);
    const workspace = workspaces.find((item) => item.workspaceId === workspaceId);
    try {
      setBusy("Saving property binding…"); setError("");
      const result = await api("/api/integrations/gtm/property", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyKey: property.key, propertyName, propertyDomain: property.domain, accountId, accountName: account?.name, containerId, containerName: container?.name, containerPublicId: container?.publicId, workspaceId, workspaceName: workspace?.name }),
      });
      setBinding(result.binding as Binding);
      await loadAssessment();
      setNotice("Property binding saved and workspace assessed.");
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Could not save the property binding."); }
    finally { setBusy(""); }
  }

  function review(tag: Finding) {
    setSelected(tag); setProviderName(tag.provider === "Unknown" ? "" : tag.provider);
    setEnforcement(tag.enforcement === "unresolved" ? "additional" : tag.enforcement);
    setConsentTypes(tag.required_consent || []);
  }

  async function saveReview() {
    if (!selected) return;
    try {
      setBusy("Saving tag decision…"); setError("");
      await api("/api/integrations/gtm/decisions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyKey: property.key, tagId: selected.tag_id, tagFingerprint: selected.api_fingerprint, providerName, purposes: selected.purposes, consentTypes, enforcement }),
      });
      await loadAssessment(); setNotice(`Review saved for ${selected.tag_name}.`);
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Could not save the tag decision."); }
    finally { setBusy(""); }
  }

  async function applyConfiguration() {
    try {
      setBusy("Synchronizing and applying consent settings…"); setError("");
      const result = await api("/api/integrations/gtm/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ propertyKey: property.key }) });
      setAssessment(result.assessment as Assessment);
      setNotice(`${result.changes?.length || 0} tag configuration change(s) applied. Triggers were preserved.`);
      setVersionReady(false);
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Could not apply GTM configuration."); }
    finally { setBusy(""); }
  }

  async function createVersion() {
    try {
      setBusy(versionReady ? "Creating unpublished GTM version…" : "Validating version plan…"); setError("");
      const result = await api("/api/integrations/gtm/export", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyKey: property.key, versionName, notes: `Validated by Meridian for ${property.domain || propertyName}. Created unpublished.`, ...(versionReady ? { confirmation: VERSION_CONFIRMATION } : {}) }),
      });
      if (result.dryRun) { setVersionReady(true); setNotice("Version plan validated. Confirm to create the unpublished GTM version."); return; }
      setVersionReady(false); setVersionPackage(result.workspacePackage);
      setCreatedVersionId(String(result.containerVersion?.containerVersionId || ""));
      setNotice(`Unpublished GTM version${result.containerVersion?.containerVersionId ? ` ${result.containerVersion.containerVersionId}` : ""} created successfully.`);
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Could not create the GTM version."); }
    finally { setBusy(""); }
  }

  const selectedAccount = accounts.find((item) => item.accountId === accountId);
  const selectedContainer = containers.find((item) => item.containerId === containerId);
  const selectedWorkspace = workspaces.find((item) => item.workspaceId === workspaceId);

  return <>
    <div className="page-heading"><div><span className="eyebrow">Configuration governance</span><h1>Tagging</h1><p>Bind {propertyName} to a GTM workspace, inspect each tag with its current trigger, and create a validated unpublished container version.</p></div><button className="secondary-button page-action" onClick={() => void loadAssessment()} disabled={!binding || Boolean(busy)}>Refresh assessment</button></div>
    {reauthorizationRequired && <div className="notice-strip warning"><span>!</span><div><strong>Version access requires Google reauthorization.</strong><small>The existing connection can read and edit tags, but it predates the unpublished-version scope.</small></div><button className="secondary-button" onClick={() => { location.href = `/api/integrations/google/authorize?return_to=${encodeURIComponent("/meridian/consent-studio/?integration=gtm")}`; }}>Reauthorize</button></div>}
    <section className="dashboard-card tagging-binding">
      <div className="card-heading"><div><h2>Property workspace binding</h2><p>One explicit account, container, and workspace selection for this property</p></div><Badge tone={binding ? "good" : "warn"}>{binding ? "Bound" : "Required"}</Badge></div>
      <div className="gtm-resource-grid">
        <label>GTM account<select value={accountId} disabled={!connected || Boolean(busy)} onChange={(event) => { setBinding(null); setAssessment(null); setAccountId(event.target.value); }}><option value="">Select account</option>{accounts.map((item) => <option key={item.accountId} value={item.accountId}>{item.name || item.accountId}</option>)}</select></label>
        <label>Container<select value={containerId} disabled={!accountId || Boolean(busy)} onChange={(event) => { setBinding(null); setAssessment(null); setContainerId(event.target.value); }}><option value="">Select container</option>{containers.map((item) => <option key={item.containerId} value={item.containerId}>{item.name || item.publicId || item.containerId}</option>)}</select></label>
        <label>Workspace<select value={workspaceId} disabled={!containerId || Boolean(busy)} onChange={(event) => { setBinding(null); setAssessment(null); setWorkspaceId(event.target.value); }}><option value="">Select workspace</option>{workspaces.map((item) => <option key={item.workspaceId} value={item.workspaceId}>{item.name || item.workspaceId}</option>)}</select></label>
      </div>
      <div className="binding-actions"><span>{selectedAccount?.name || "No account"} · {selectedContainer?.name || selectedContainer?.publicId || "No container"} · {selectedWorkspace?.name || "No workspace"}</span><button className="secondary-button" disabled={!containerId || Boolean(busy)} onClick={() => void createMeridianWorkspace()}>Create Meridian workspace</button><button className="primary-button" disabled={!workspaceId || Boolean(busy)} onClick={() => void saveBinding()}>Save binding & assess</button></div>
    </section>
    {(error || notice || busy) && <div className={`tagging-message ${error ? "error" : ""}`}><strong>{error || busy || notice}</strong></div>}
    {assessment && <>
      <div className="metric-grid"><div className="metric-card"><span>{assessment.summary.total}</span><strong>Tags inspected</strong><small>Live GTM workspace</small></div><div className="metric-card"><span>{assessment.summary.compliant}</span><strong>Compliant</strong><small>Configuration matches assessment</small></div><div className="metric-card warn"><span>{assessment.summary.review_required}</span><strong>Need review</strong><small>Classification decision required</small></div><div className="metric-card warn"><span>{assessment.summary.configuration_required}</span><strong>Need configuration</strong><small>Ready for Meridian to apply</small></div></div>
      <section className="dashboard-card"><div className="card-heading"><div><h2>Live tag compliance</h2><p>Current GTM tag, firing trigger, consent setting, and assessed requirement</p></div><Badge tone={assessment.summary.export_ready ? "good" : "warn"}>{assessment.summary.export_ready ? "Version ready" : `${assessment.summary.blocking} blocking`}</Badge></div><div className="data-table live-tagging-table"><div className="table-head"><span>Current tag</span><span>Current trigger</span><span>Current consent</span><span>Assessed requirement</span><span>Status</span><span></span></div>{assessment.tags.map((tag) => <div className="table-row" key={tag.tag_id}><span><strong>{tag.tag_name}</strong><small>{tag.tag_type || "Unknown type"}{tag.paused ? " · Paused" : ""}</small></span><span>{tag.dependencies.firing_triggers.length ? tag.dependencies.firing_triggers.map((trigger) => <small key={trigger.trigger_id}>{trigger.trigger_name || `Trigger ${trigger.trigger_id}`}</small>) : <small>No firing trigger</small>}</span><span><strong>{tag.current_consent.status}</strong><small>{tag.current_consent.types.join(" + ") || "No additional checks"}</small></span><span><strong>{tag.provider}</strong><small>{tag.enforcement === "additional" ? tag.required_consent.join(" + ") || "Review required" : tag.enforcement.replaceAll("_", " ")}</small></span><span><Badge tone={tag.compliance === "compliant" ? "good" : "warn"}>{tag.compliance.replaceAll("_", " ")}</Badge><small>{tag.compliance_message}</small></span><span><button className="text-button" onClick={() => review(tag)}>{tag.compliance === "review_required" ? "Review" : "Inspect"}</button></span></div>)}</div></section>
      {selected && <section className="dashboard-card tag-review"><div className="card-heading"><div><h2>Review: {selected.tag_name}</h2><p>The decision is bound to the current GTM fingerprint and becomes stale if the tag changes.</p></div><button className="icon-button" onClick={() => setSelected(null)}>×</button></div><div className="review-editor"><label>Provider<input value={providerName} onChange={(event) => setProviderName(event.target.value)} /></label><label>Enforcement<select value={enforcement} onChange={(event) => setEnforcement(event.target.value)}><option value="additional">Additional consent checks</option><option value="built_in">Built-in Google consent</option><option value="essential">Essential / no additional gate</option></select></label><fieldset disabled={enforcement !== "additional"}><legend>Required consent types</legend><div className="consent-choice-grid">{CONSENT_TYPES.map((type) => <label key={type}><input type="checkbox" checked={consentTypes.includes(type)} onChange={(event) => setConsentTypes((items) => event.target.checked ? [...new Set([...items, type])] : items.filter((item) => item !== type))} /><code>{type}</code></label>)}</div></fieldset><button className="primary-button" disabled={!providerName.trim() || (enforcement === "additional" && !consentTypes.length) || Boolean(busy)} onClick={() => void saveReview()}>Save reviewed decision</button></div></section>}
      <section className="dashboard-card release-workflow"><div className="card-heading"><div><h2>Apply and create version</h2><p>Meridian never publishes. Version publication remains a separate action inside GTM.</p></div><Badge tone={assessment.summary.export_ready ? "good" : "warn"}>{assessment.summary.export_ready ? "Validated" : "Blocked"}</Badge></div><div className="release-actions"><div><strong>1. Apply consent configuration</strong><small>Synchronizes the workspace, preserves triggers, and updates only consent settings.</small><button className="secondary-button" disabled={assessment.summary.review_required > 0 || assessment.summary.configuration_required === 0 || Boolean(busy)} onClick={() => void applyConfiguration()}>Apply {assessment.summary.configuration_required} change(s)</button></div><div><strong>2. Create unpublished GTM version</strong><small>Runs a fresh assessment and blocks on conflicts, errors, or any noncompliant tag.</small><input value={versionName} onChange={(event) => { setVersionName(event.target.value); setVersionReady(false); }} /><button className="primary-button" disabled={!assessment.summary.export_ready || reauthorizationRequired || !versionName.trim() || Boolean(busy)} onClick={() => void createVersion()}>{versionReady ? "Confirm unpublished version" : "Validate version creation"}</button></div>{versionPackage && <div><strong>Version created{createdVersionId ? ` · ID ${createdVersionId}` : ""}</strong><small>The version is not published. Download the validated workspace package for audit or portability.</small><button className="secondary-button" onClick={() => downloadJson(`${property.key}-gtm-workspace.json`, versionPackage)}>Download workspace package</button></div>}</div></section>
    </>}
  </>;
}
