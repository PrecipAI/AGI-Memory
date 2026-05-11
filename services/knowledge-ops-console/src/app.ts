import Fastify from "fastify";

type ConsoleAppOptions = {
  apiBaseUrl?: string;
  tenantId?: string;
  scope?: string;
  tracePrefix?: string;
  fetchImpl?: typeof fetch;
};

const DEFAULT_API_BASE_URL = process.env.KNOWLEDGE_API_BASE || "http://127.0.0.1:3101";
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID || "tenant-local";
const DEFAULT_SCOPE = process.env.DEFAULT_SCOPE || "memory.validation";

function buildHeaders(options: Required<Pick<ConsoleAppOptions, "tenantId" | "scope" | "tracePrefix">>) {
  return {
    "X-Tenant-Id": options.tenantId,
    "X-Scope": options.scope,
    "X-Trace-Id": `${options.tracePrefix}-${Date.now()}`,
    "Idempotency-Key": `knowledge-console-${Date.now()}`
  };
}

async function proxyJson(input: {
  apiBaseUrl: string;
  tenantId: string;
  scope: string;
  tracePrefix: string;
  path: string;
  fetchImpl: typeof fetch;
  method?: string;
  payload?: unknown;
}) {
  const response = await input.fetchImpl(`${input.apiBaseUrl}${input.path}`, {
    method: input.method ?? "GET",
    headers: {
      ...buildHeaders({
        tenantId: input.tenantId,
        scope: input.scope,
        tracePrefix: input.tracePrefix
      }),
      ...(input.payload === undefined ? {} : { "content-type": "application/json" })
    },
    body: input.payload === undefined ? undefined : JSON.stringify(input.payload)
  });
  if (!response.ok) {
    return {
      ok: false,
      statusCode: response.status,
      body: await response.text()
    };
  }
  return {
    ok: true,
    statusCode: 200,
    body: await response.json()
  };
}

function renderHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Knowledge Ops Console</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div class="shell">
      <aside class="rail">
        <div class="brand">治理回显</div>
        <nav>
          <button data-view="hostgovernance" class="active">Host Governance 主机治理</button>
        </nav>
      </aside>
      <main class="main">
        <header class="hero">
          <div>
            <p class="eyebrow">Governance Review</p>
            <h1>Host Governance</h1>
            <p class="subtitle">直接读取真实会话记录与任务执行记录，只展示治理抽取层级和结果。</p>
          </div>
          <div id="config-pill" class="pill">loading...</div>
        </header>
        <section id="hostgovernance-view" class="view active"></section>
        <section id="hostgovernance-detail-view" class="view"></section>
      </main>
    </div>
    <script type="module" src="/app.js"></script>
  </body>
</html>`;
}

function renderCss() {
  return `
:root {
  --bg: #f3efe7;
  --panel: #fffaf2;
  --ink: #1b1a17;
  --muted: #6a655d;
  --line: #ddd3c4;
  --accent: #125b50;
  --accent-2: #d97706;
  --shadow: 0 12px 32px rgba(27, 26, 23, 0.08);
  --radius: 18px;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "Segoe UI", "Noto Sans SC", sans-serif;
  background:
    radial-gradient(circle at top left, rgba(217, 119, 6, 0.12), transparent 28%),
    linear-gradient(180deg, #f7f3ec 0%, var(--bg) 100%);
  color: var(--ink);
}
.shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 280px 1fr;
}
.rail {
  border-right: 1px solid var(--line);
  padding: 24px 18px;
  background: rgba(255,255,255,0.35);
  backdrop-filter: blur(10px);
}
.brand {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 28px;
  color: var(--accent);
}
.rail nav { display: grid; gap: 10px; }
.rail button {
  border: 1px solid var(--line);
  background: rgba(255,255,255,0.4);
  border-radius: 14px;
  padding: 12px 14px;
  text-align: left;
  font-size: 14px;
  cursor: pointer;
  color: var(--ink);
  line-height: 1.45;
  white-space: normal;
}
.rail button.active {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}
.main { padding: 28px; }
.hero {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 24px;
}
.eyebrow {
  margin: 0 0 8px;
  text-transform: uppercase;
  letter-spacing: .14em;
  font-size: 12px;
  color: var(--accent-2);
}
h1 { margin: 0 0 8px; font-size: 42px; }
.subtitle { margin: 0; color: var(--muted); max-width: 720px; }
.pill {
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 10px 14px;
  background: var(--panel);
  color: var(--muted);
}
.view { display: none; }
.view.active { display: block; }
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
}
.card, .panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
.card { padding: 16px; }
.card .label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }
.card .value { margin-top: 8px; font-size: 30px; font-weight: 700; color: var(--accent); }
.panel { margin-top: 18px; padding: 18px; }
.panel h2 { margin: 0 0 14px; font-size: 18px; }
.list { display: grid; gap: 12px; }
.item {
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 14px;
  background: rgba(255,255,255,0.52);
}
.item .title { font-weight: 600; }
.item .meta {
  margin-top: 6px;
  color: var(--muted);
  font-size: 13px;
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.columns {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.detail-grid {
  display: grid;
  grid-template-columns: 1.2fr .8fr;
  gap: 16px;
}
.item.clickable {
  cursor: pointer;
  transition: transform .14s ease, border-color .14s ease, box-shadow .14s ease;
}
.item.clickable:hover {
  transform: translateY(-1px);
  border-color: #c7b292;
  box-shadow: 0 10px 26px rgba(27, 26, 23, 0.09);
}
.actions {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.action-status { margin-top: 12px; }
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.toolbar .count {
  color: var(--muted);
  font-size: 13px;
}
.ghost-button {
  border: 1px solid var(--line);
  background: transparent;
  border-radius: 999px;
  padding: 8px 12px;
  cursor: pointer;
  color: var(--ink);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}
.ghost-button.approve {
  border-color: rgba(18, 91, 80, 0.35);
  color: var(--accent);
  background: rgba(18, 91, 80, 0.08);
}
.ghost-button.reject {
  border-color: rgba(185, 28, 28, 0.24);
  color: #9f1239;
  background: rgba(185, 28, 28, 0.06);
}
.proposal-payload {
  max-height: 220px;
  overflow: auto;
  margin-top: 10px;
}
.badge {
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 3px 8px;
  background: #fff6e7;
  color: var(--accent);
  font-size: 12px;
}
.badge.muted {
  color: var(--muted);
  background: rgba(255,255,255,0.46);
}
.snippet {
  margin-top: 8px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
}
.markdown-view {
  max-height: 520px;
  overflow: auto;
  margin: 12px 0 0;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: #1f2933;
  color: #f8f1e7;
  font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
}
.inspector {
  position: sticky;
  top: 20px;
}
.empty { color: var(--muted); font-style: italic; }
.notice {
  margin-top: 12px;
  border: 1px dashed var(--line);
  border-radius: 14px;
  padding: 12px;
  color: var(--muted);
  background: rgba(255,255,255,0.46);
}
@media (max-width: 900px) {
  .shell { grid-template-columns: 1fr; }
  .rail { border-right: none; border-bottom: 1px solid var(--line); }
  .columns { grid-template-columns: 1fr; }
  .detail-grid { grid-template-columns: 1fr; }
  .hero { flex-direction: column; }
}
`;
}

function renderAppJs() {
  return `
const views = {
  hostgovernance: document.getElementById("hostgovernance-view"),
  hostgovernanceDetail: document.getElementById("hostgovernance-detail-view")
};
const configPill = document.getElementById("config-pill");
let hostGovernanceState = { sessions: [], selected: null, preview: null, run: null };

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    switchView(button.dataset.view);
  });
});

function switchView(viewKey) {
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.remove("active"));
  Object.values(views).forEach((view) => view.classList.remove("active"));
  const navButton = document.querySelector(\`[data-view="\${viewKey}"]\`);
  if (navButton) {
    navButton.classList.add("active");
  } else {
    document.querySelector('[data-view="hostgovernance"]')?.classList.add("active");
  }
  if (viewKey === "hostgovernanceDetail") {
    views.hostgovernanceDetail.classList.add("active");
    return;
  }
  views[viewKey]?.classList.add("active");
}

function renderList(items, formatter) {
  if (!items || items.length === 0) {
    return '<div class="empty">No data.</div>';
  }
  return '<div class="list">' + items.map(formatter).join("") + '</div>';
}

function renderHostGovernance() {
  const sessions = hostGovernanceState.sessions || [];
  views.hostgovernance.innerHTML = \`
    <div class="panel">
      <div class="toolbar">
        <h2>Host Governance</h2>
        <button class="ghost-button" id="refresh-host-governance">Refresh Sessions</button>
      </div>
      <div class="notice">直接读取真实 Codex 会话记录和执行记录，不写展示副本。选择线程后进入详情页，再查看抽取结果和治理结果。</div>
      <div class="panel">
        <h2>Codex Sessions</h2>
        \${renderList(sessions, (item) => \`
          <div class="item clickable" data-host-thread-id="\${escapeHtml(item.thread_id)}">
            <div class="title">\${escapeHtml(item.thread_name || item.thread_id)}</div>
            <div class="meta">
              <span>thread: \${escapeHtml(item.thread_id)}</span>
              <span>updated: \${escapeHtml(item.updated_at || "n/a")}</span>
            </div>
            <div class="snippet">\${escapeHtml(item.session_file || "no session file")}</div>
          </div>
        \`)}
      </div>
    </div>
  \`;
  document.getElementById("refresh-host-governance")?.addEventListener("click", loadHostSessions);
  views.hostgovernance.querySelectorAll("[data-host-thread-id]").forEach((node) => {
    node.addEventListener("click", () => {
      const threadId = node.dataset.hostThreadId;
      hostGovernanceState.selected = sessions.find((item) => item.thread_id === threadId) || null;
      hostGovernanceState.preview = null;
      hostGovernanceState.run = null;
      renderHostGovernanceDetail();
      switchView("hostgovernanceDetail");
    });
  });
}

function renderHostGovernanceDetail() {
  const selected = hostGovernanceState.selected;
  const preview = hostGovernanceState.preview;
  const run = hostGovernanceState.run;
  views.hostgovernanceDetail.innerHTML = \`
    <div class="actions">
      <button class="ghost-button" id="host-detail-back">Back to Sessions</button>
      <button class="ghost-button" id="inspect-host-thread" \${selected ? "" : "disabled"}>Inspect Extraction</button>
      <button class="ghost-button" id="run-host-thread-governance" \${selected ? "" : "disabled"}>Run Governance</button>
    </div>
    <div class="panel">
      <h2>Selected Thread</h2>
      \${selected ? \`
        <div class="item">
          <div class="title">\${escapeHtml(selected.thread_name || selected.thread_id)}</div>
          <div class="meta">
            <span>\${escapeHtml(selected.thread_id)}</span>
            <span>\${escapeHtml(selected.updated_at || "n/a")}</span>
          </div>
          <div class="snippet">\${escapeHtml(selected.session_file || "")}</div>
        </div>
      \` : '<div class="empty">No thread selected.</div>'}
    </div>
    <div class="panel">
      <h2>Extraction Preview</h2>
      \${preview ? renderHostGovernancePreview(preview) : '<div class="empty">No preview loaded.</div>'}
    </div>
    <div class="panel">
      <h2>Governance Run Result</h2>
      \${run ? renderHostGovernanceRun(run) : '<div class="empty">No governance run executed from this view.</div>'}
    </div>
  \`;
  document.getElementById("host-detail-back")?.addEventListener("click", () => {
    switchView("hostgovernance");
  });
  document.getElementById("inspect-host-thread")?.addEventListener("click", inspectSelectedHostThread);
  document.getElementById("run-host-thread-governance")?.addEventListener("click", runSelectedHostGovernance);
}

function renderHostGovernancePreview(preview) {
  const extraction = preview.extraction_preview || {};
  return \`
    <div class="item">
      <div class="title">Input Summary</div>
      <div class="meta">
        <span>user: \${escapeHtml(preview.raw_inputs?.user_messages?.length ?? 0)}</span>
        <span>commands: \${escapeHtml(preview.raw_inputs?.commands?.length ?? 0)}</span>
        <span>tools: \${escapeHtml(preview.raw_inputs?.tool_calls?.length ?? 0)}</span>
        <span>mcp: \${escapeHtml(preview.raw_inputs?.mcp_calls?.length ?? 0)}</span>
      </div>
    </div>
    \${renderCandidateGroup("Rule", extraction.rule_candidates || [])}
    \${renderCandidateGroup("Memory", extraction.memory_candidates || [])}
    \${renderCandidateGroup("Skill Proposal", extraction.skill_proposal_candidates || [])}
    \${renderCandidateGroup("Knowledge", extraction.knowledge_candidates || [])}
    \${renderCandidateGroup("Governance Evidence", extraction.governance_evidence_candidates || [])}
  \`;
}

function renderCandidateGroup(label, items) {
  return \`
    <div class="item">
      <div class="title">\${escapeHtml(label)} (\${escapeHtml(items.length)})</div>
      \${items.length === 0 ? '<div class="empty">No items.</div>' : items.map((item) => renderCandidateItem(label, item)).join("")}
    </div>
  \`;
}

function renderCandidateItem(label, item) {
  if (label === "Skill Proposal" || item.target_skill || item.proposed_text) {
    return \`
      <div class="snippet"><strong>\${escapeHtml(item.title || "untitled")}</strong>
target: \${escapeHtml(item.target_skill || "unknown")}  change: \${escapeHtml(item.change_type || "update")}
quality: \${escapeHtml(item.proposal_quality || "n/a")}  sources: \${escapeHtml(item.merged_source_count || 1)}
level: \${escapeHtml(item.governance_level || "n/a")}
section: \${escapeHtml(item.current_section || "n/a")}
current gap: \${escapeHtml(item.current_gap || "")}
proposed: \${escapeHtml(item.proposed_text || item.content || "")}
patch:
\${escapeHtml(item.proposed_patch || "")}
rationale: \${escapeHtml(item.rationale || "")}</div>
      <div class="snippet">source: \${escapeHtml(item.source_excerpt || "")}</div>
      <div class="snippet">reason: \${escapeHtml(item.reason || "")}</div>
    \`;
  }
  if (label === "Rule" || item.rule_domain || item.rule_scope) {
    return \`
    <div class="snippet"><strong>\${escapeHtml(item.title || "untitled")}</strong>
domain: \${escapeHtml(item.rule_domain || "n/a")}  scope: \${escapeHtml(item.rule_scope || item.origin_scope || "n/a")}
level: \${escapeHtml(item.governance_level || "n/a")}
availability: \${escapeHtml(item.availability_scope || "n/a")}  promotion: \${escapeHtml(item.promotion_status || "n/a")}
\${escapeHtml(item.content || item.source_excerpt || "")}</div>
    <div class="snippet">source: \${escapeHtml(item.source_excerpt || "")}</div>
    <div class="snippet">reason: \${escapeHtml(item.reason || "")}</div>
  \`;
  }
  return \`
    <div class="snippet"><strong>\${escapeHtml(item.title || "untitled")}</strong>\n\${escapeHtml(item.content || item.source_excerpt || "")}</div>
    <div class="snippet">source: \${escapeHtml(item.source_excerpt || "")}</div>
    <div class="snippet">reason: \${escapeHtml(item.reason || "")}</div>
  \`;
}

function renderHostGovernanceRun(run) {
  const report = run.acceptance_report || {};
  return \`
    <div class="item">
      <div class="title">Promoted Outputs</div>
      <div class="meta">
        <span>rules: \${escapeHtml(report.promoted_outputs?.rule_count ?? 0)}</span>
        <span>memory: \${escapeHtml(report.promoted_outputs?.long_term_memory_count ?? 0)}</span>
        <span>skill proposals: \${escapeHtml(report.promoted_outputs?.skill_proposal_count ?? 0)}</span>
        <span>knowledge: \${escapeHtml(report.promoted_outputs?.synthesized_knowledge_count ?? 0)}</span>
      </div>
    </div>
    <div class="item">
      <div class="title">Retained Governance Evidence</div>
      \${(report.governance_evidence_retained || []).length === 0 ? '<div class="empty">No retained evidence.</div>' : (report.governance_evidence_retained || []).map((item) => \`
        <div class="snippet"><strong>\${escapeHtml(item.title || "untitled")}</strong> [\${escapeHtml(item.evidence_category || "n/a")}]\n\${escapeHtml(item.source_excerpt || "")}</div>
      \`).join("")}
    </div>
    \${renderPromotedGroup("Promoted Rules", run.persisted?.rule_items || [])}
    \${renderPromotedGroup("Promoted Memory", run.persisted?.memory_items || [])}
    \${renderPromotedGroup("Promoted Skill Proposals", run.persisted?.skill_proposal_items || [])}
    \${renderPromotedGroup("Promoted Knowledge", run.persisted?.knowledge_items || [])}
  \`;
}

function renderPromotedGroup(label, items) {
  return \`
    <div class="item">
      <div class="title">\${escapeHtml(label)} (\${escapeHtml(items.length)})</div>
      \${items.length === 0 ? '<div class="empty">No items.</div>' : items.map((item) => renderPromotedItem(label, item)).join("")}
    </div>
  \`;
}

function renderPromotedItem(label, item) {
  if (label.includes("Skill Proposals") || item.target_skill || item.proposed_text) {
    return \`
      <div class="snippet"><strong>\${escapeHtml(item.title || "untitled")}</strong>
target: \${escapeHtml(item.target_skill || "unknown")}  change: \${escapeHtml(item.change_type || "update")}
quality: \${escapeHtml(item.proposal_quality || "n/a")}  sources: \${escapeHtml(item.merged_source_count || 1)}
level: \${escapeHtml(item.governance_level || "n/a")}
path: \${escapeHtml(item.target_skill_path || "n/a")}
section: \${escapeHtml(item.current_section || "n/a")}
current: \${escapeHtml(item.current_text || "")}
gap: \${escapeHtml(item.current_gap || "")}
proposed: \${escapeHtml(item.proposed_text || "")}
patch:
\${escapeHtml(item.proposed_patch || "")}
rationale: \${escapeHtml(item.rationale || "")}</div>
    \`;
  }
  if (label.includes("Rules") || item.rule_domain || item.rule_scope) {
    return \`
    <div class="snippet"><strong>\${escapeHtml(item.title || "untitled")}</strong>
domain: \${escapeHtml(item.rule_domain || "n/a")}  scope: \${escapeHtml(item.rule_scope || "n/a")}
level: \${escapeHtml(item.governance_level || "n/a")}
availability: \${escapeHtml(item.availability_scope || "n/a")}  promotion: \${escapeHtml(item.promotion_status || "n/a")}
\${escapeHtml(item.statement || "")}</div>
  \`;
  }
  return \`
    <div class="snippet"><strong>\${escapeHtml(item.title || "untitled")}</strong>\n\${escapeHtml(item.content || item.statement || item.summary || "")}</div>
  \`;
}

async function loadHostSessions() {
  const response = await fetch("/api/host/codex/sessions?limit=20");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || payload.message || "Failed to load host sessions");
  }
  hostGovernanceState.sessions = payload.items || [];
  renderHostGovernance();
}

async function inspectSelectedHostThread() {
  if (!hostGovernanceState.selected?.thread_id) {
    return;
  }
  const response = await fetch("/api/host/codex/governance-preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ thread_id: hostGovernanceState.selected.thread_id, max_items: 12 })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || payload.message || "Failed to inspect host governance");
  }
  hostGovernanceState.preview = payload;
  renderHostGovernanceDetail();
  switchView("hostgovernanceDetail");
}

async function runSelectedHostGovernance() {
  if (!hostGovernanceState.selected?.thread_id) {
    return;
  }
  const response = await fetch("/api/host/codex/governance-run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ thread_id: hostGovernanceState.selected.thread_id, max_items: 12 })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || payload.message || "Failed to run host governance");
  }
  hostGovernanceState.run = payload;
  renderHostGovernanceDetail();
  switchView("hostgovernanceDetail");
}

async function load() {
  const [config, hostSessions] = await Promise.all([
      fetch("/api/config").then((r) => r.json()),
      fetch("/api/host/codex/sessions?limit=20").then((r) => r.json())
    ]);
  configPill.textContent = \`\${config.tenant_id} / \${config.scope}\`;
  hostGovernanceState.sessions = hostSessions.items || [];
  renderHostGovernance();
}

load().catch((error) => {
  views.hostgovernance.innerHTML = '<div class="panel"><h2>Load Error</h2><div class="empty">' + error.message + '</div></div>';
});
`;
}

export function buildKnowledgeOpsConsoleApp(options: ConsoleAppOptions = {}) {
  const app = Fastify({ logger: false });
  const apiBaseUrl = options.apiBaseUrl ?? DEFAULT_API_BASE_URL;
  const tenantId = options.tenantId ?? DEFAULT_TENANT_ID;
  const scope = options.scope ?? DEFAULT_SCOPE;
  const tracePrefix = options.tracePrefix ?? "knowledge-ops-console";
  const fetchImpl = options.fetchImpl ?? fetch;

  app.get("/healthz", async () => ({
    service: "knowledge-ops-console",
    ok: true,
    api_base_url: apiBaseUrl,
    tenant_id: tenantId,
    scope
  }));

  app.get("/", async (_request, reply) => {
    reply.type("text/html; charset=utf-8");
    return renderHtml();
  });

  app.get("/styles.css", async (_request, reply) => {
    reply.type("text/css; charset=utf-8");
    return renderCss();
  });

  app.get("/app.js", async (_request, reply) => {
    reply.type("application/javascript; charset=utf-8");
    return renderAppJs();
  });

  app.get("/api/config", async () => ({
    api_base_url: apiBaseUrl,
    tenant_id: tenantId,
    scope
  }));

  app.get("/api/overview", async (_request, reply) => {
    const result = await proxyJson({
      apiBaseUrl,
      tenantId,
      scope,
      tracePrefix,
      path: "/internal/knowledge/ops/overview",
      fetchImpl
    });
    reply.status(result.statusCode);
    return result.ok ? result.body : { error: result.body };
  });

  app.get("/api/documents", async (request, reply) => {
    const query = (request.query ?? {}) as { q?: string; limit?: string; offset?: string };
    const params = new URLSearchParams();
    if (query.q) {
      params.set("q", query.q);
    }
    if (query.limit) {
      params.set("limit", query.limit);
    }
    if (query.offset) {
      params.set("offset", query.offset);
    }
    const queryString = params.toString();
    const result = await proxyJson({
      apiBaseUrl,
      tenantId,
      scope,
      tracePrefix,
      path: `/internal/knowledge/documents${queryString ? `?${queryString}` : ""}`,
      fetchImpl
    });
    reply.status(result.statusCode);
    return result.ok ? result.body : { error: result.body };
  });

  app.get("/api/documents/:documentId", async (request, reply) => {
    const params = request.params as { documentId: string };
    const result = await proxyJson({
      apiBaseUrl,
      tenantId,
      scope,
      tracePrefix,
      path: `/internal/knowledge/documents/${params.documentId}`,
      fetchImpl
    });
    reply.status(result.statusCode);
    return result.ok ? result.body : { error: result.body };
  });

  app.get("/api/documents/:documentId/markdown", async (request, reply) => {
    const params = request.params as { documentId: string };
    const result = await proxyJson({
      apiBaseUrl,
      tenantId,
      scope,
      tracePrefix,
      path: `/internal/knowledge/documents/${params.documentId}`,
      fetchImpl
    });
    if (!result.ok) {
      reply.status(result.statusCode);
      return result.body;
    }
    const body = result.body as { document?: { title?: string; markdown_content?: string | null } };
    const markdown = body.document?.markdown_content;
    if (!markdown) {
      reply.status(404);
      reply.type("text/plain; charset=utf-8");
      return "No canonical Markdown is stored for this document.";
    }
    reply.header("content-disposition", `inline; filename="${String(body.document?.title ?? "document").replace(/[^a-zA-Z0-9._-]+/g, "-")}.md"`);
    reply.type("text/markdown; charset=utf-8");
    return markdown;
  });

  app.get("/api/review-queue", async (_request, reply) => {
    const result = await proxyJson({
      apiBaseUrl,
      tenantId,
      scope,
      tracePrefix,
      path: "/internal/knowledge/review-queue",
      fetchImpl
    });
    reply.status(result.statusCode);
    return result.ok ? result.body : { error: result.body };
  });

  app.get("/api/governance/change-proposals", async (request, reply) => {
    const query = (request.query ?? {}) as { status?: string; limit?: string };
    const params = new URLSearchParams();
    params.set("status", query.status ?? "recorded");
    if (query.limit) {
      params.set("limit", query.limit);
    }
    const result = await proxyJson({
      apiBaseUrl,
      tenantId,
      scope,
      tracePrefix,
      path: `/internal/governance/change-proposals?${params.toString()}`,
      fetchImpl
    });
    reply.status(result.statusCode);
    return result.ok ? result.body : { error: result.body };
  });

  app.post("/api/governance/change-proposals/:proposalId/actions", async (request, reply) => {
    const params = request.params as { proposalId: string };
    const result = await proxyJson({
      apiBaseUrl,
      tenantId,
      scope,
      tracePrefix,
      path: `/internal/governance/change-proposals/${params.proposalId}/actions`,
      fetchImpl,
      method: "POST",
      payload: request.body ?? {}
    });
    reply.status(result.statusCode);
    return result.ok ? result.body : { error: result.body };
  });

  app.get("/api/governance-runs", async (_request, reply) => {
    const result = await proxyJson({
      apiBaseUrl,
      tenantId,
      scope,
      tracePrefix,
      path: "/internal/knowledge/governance/runs",
      fetchImpl
    });
    reply.status(result.statusCode);
    return result.ok ? result.body : { error: result.body };
  });

  app.get("/api/host/codex/sessions", async (request, reply) => {
    const query = (request.query ?? {}) as { limit?: string | number | null };
    const result = await proxyJson({
      apiBaseUrl,
      tenantId,
      scope,
      tracePrefix,
      path: `/internal/host-capture/codex/sessions?limit=${encodeURIComponent(String(query.limit ?? 20))}`,
      fetchImpl
    });
    reply.status(result.statusCode);
    return result.ok ? result.body : { error: result.body };
  });

  app.post("/api/host/codex/governance-preview", async (request, reply) => {
    const body = (request.body ?? {}) as { thread_id?: string | null; max_items?: number | null };
    const result = await proxyJson({
      apiBaseUrl,
      tenantId,
      scope,
      tracePrefix,
      path: "/internal/host-capture/codex/governance-batch-preview",
      fetchImpl,
      method: "POST",
      payload: {
        thread_id: body.thread_id ?? null,
        max_items: body.max_items ?? 12
      }
    });
    reply.status(result.statusCode);
    return result.ok ? result.body : { error: result.body };
  });

  app.post("/api/host/codex/governance-run", async (request, reply) => {
    const body = (request.body ?? {}) as { thread_id?: string | null; max_items?: number | null };
    const result = await proxyJson({
      apiBaseUrl,
      tenantId,
      scope,
      tracePrefix,
      path: "/internal/host-capture/codex/governance-run",
      fetchImpl,
      method: "POST",
      payload: {
        thread_id: body.thread_id ?? null,
        max_items: body.max_items ?? 12
      }
    });
    reply.status(result.statusCode);
    return result.ok ? result.body : { error: result.body };
  });

  app.get("/api/governance-runs/:jobId", async (request, reply) => {
    const params = request.params as { jobId: string };
    const result = await proxyJson({
      apiBaseUrl,
      tenantId,
      scope,
      tracePrefix,
      path: `/internal/knowledge/governance/runs/${params.jobId}`,
      fetchImpl
    });
    reply.status(result.statusCode);
    return result.ok ? result.body : { error: result.body };
  });

  app.post("/api/governance/run", async (request, reply) => {
    const result = await proxyJson({
      apiBaseUrl,
      tenantId,
      scope,
      tracePrefix,
      path: "/internal/knowledge/governance/run",
      fetchImpl,
      method: "POST",
      payload: request.body ?? {}
    });
    reply.status(result.statusCode);
    return result.ok ? result.body : { error: result.body };
  });

  app.get("/api/synthesized-knowledge", async (_request, reply) => {
    const result = await proxyJson({
      apiBaseUrl,
      tenantId,
      scope,
      tracePrefix,
      path: "/internal/knowledge/synthesized-knowledge",
      fetchImpl
    });
    reply.status(result.statusCode);
    return result.ok ? result.body : { error: result.body };
  });

  app.get("/api/synthesized-knowledge/:synthesizedKnowledgeId", async (request, reply) => {
    const params = request.params as { synthesizedKnowledgeId: string };
    const result = await proxyJson({
      apiBaseUrl,
      tenantId,
      scope,
      tracePrefix,
      path: `/internal/knowledge/synthesized-knowledge/${params.synthesizedKnowledgeId}`,
      fetchImpl
    });
    reply.status(result.statusCode);
    return result.ok ? result.body : { error: result.body };
  });

  app.get("/api/graph/entities", async (_request, reply) => {
    const result = await proxyJson({
      apiBaseUrl,
      tenantId,
      scope,
      tracePrefix,
      path: "/internal/knowledge/graph/entities",
      fetchImpl
    });
    reply.status(result.statusCode);
    return result.ok ? result.body : { error: result.body };
  });

  app.get("/api/graph/facts", async (_request, reply) => {
    const result = await proxyJson({
      apiBaseUrl,
      tenantId,
      scope,
      tracePrefix,
      path: "/internal/knowledge/graph/facts",
      fetchImpl
    });
    reply.status(result.statusCode);
    return result.ok ? result.body : { error: result.body };
  });

  app.get("/api/graph/relations", async (_request, reply) => {
    const result = await proxyJson({
      apiBaseUrl,
      tenantId,
      scope,
      tracePrefix,
      path: "/internal/knowledge/graph/relations",
      fetchImpl
    });
    reply.status(result.statusCode);
    return result.ok ? result.body : { error: result.body };
  });

  return app;
}
