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
        <div class="brand">Knowledge Ops</div>
        <nav>
          <button data-view="overview" class="active">Overview</button>
          <button data-view="documents">Documents</button>
          <button data-view="review">Review Queue</button>
          <button data-view="proposals">Change Proposals</button>
          <button data-view="runs">Governance Runs</button>
          <button data-view="synthesis">Synthesized Knowledge</button>
          <button data-view="graph">Graph</button>
        </nav>
      </aside>
      <main class="main">
        <header class="hero">
          <div>
            <p class="eyebrow">Unified Long-term Knowledge System</p>
            <h1>Ops Console</h1>
            <p class="subtitle">Review what the system ingested, extracted, linked, and used.</p>
          </div>
          <div id="config-pill" class="pill">loading...</div>
        </header>
        <section id="overview-view" class="view active"></section>
        <section id="documents-view" class="view"></section>
        <section id="review-view" class="view"></section>
        <section id="proposals-view" class="view"></section>
        <section id="runs-view" class="view"></section>
        <section id="synthesis-view" class="view"></section>
        <section id="graph-view" class="view"></section>
        <section id="document-detail-view" class="view"></section>
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
  grid-template-columns: 240px 1fr;
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
  background: transparent;
  border-radius: 14px;
  padding: 12px 14px;
  text-align: left;
  font-size: 14px;
  cursor: pointer;
  color: var(--ink);
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
  overview: document.getElementById("overview-view"),
  documents: document.getElementById("documents-view"),
  review: document.getElementById("review-view"),
  proposals: document.getElementById("proposals-view"),
  runs: document.getElementById("runs-view"),
  synthesis: document.getElementById("synthesis-view"),
  graph: document.getElementById("graph-view")
};
const documentDetailView = document.getElementById("document-detail-view");
let runDetailView = null;
const configPill = document.getElementById("config-pill");
let documentItems = [];
let currentDocumentDetail = null;
let synthesisDetailView = null;
const documentPageSize = 50;
let documentTotal = 0;
let documentOffset = 0;

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
    document.querySelectorAll("[data-view]").forEach((b) => b.classList.remove("active"));
    Object.values(views).forEach((view) => view.classList.remove("active"));
    button.classList.add("active");
    views[button.dataset.view].classList.add("active");
  });
});

function renderList(items, formatter) {
  if (!items || items.length === 0) {
    return '<div class="empty">No data.</div>';
  }
  return '<div class="list">' + items.map(formatter).join("") + '</div>';
}

function renderOverview(data) {
  const corpus = data.corpus_governance || {};
  views.overview.innerHTML = \`
    <div class="cards">
      <div class="card"><div class="label">Documents</div><div class="value">\${data.document_count}</div></div>
      <div class="card"><div class="label">Sections</div><div class="value">\${data.section_count}</div></div>
      <div class="card"><div class="label">Evidence</div><div class="value">\${data.evidence_count}</div></div>
      <div class="card"><div class="label">Entities</div><div class="value">\${data.entity_count}</div></div>
      <div class="card"><div class="label">Facts</div><div class="value">\${data.fact_count}</div></div>
      <div class="card"><div class="label">Relations</div><div class="value">\${data.relation_count}</div></div>
      <div class="card"><div class="label">Active Reviews</div><div class="value">\${data.active_review_count}</div></div>
      <div class="card"><div class="label">Governance Runs</div><div class="value">\${data.governance_job_count}</div></div>
    </div>
    <div class="panel">
      <h2>Corpus Governance</h2>
      <div class="cards">
        <div class="card"><div class="label">Active / Total Docs</div><div class="value">\${corpus.active_document_count ?? 0} / \${corpus.total_document_count ?? 0}</div></div>
        <div class="card"><div class="label">Retired Docs</div><div class="value">\${corpus.retired_document_count ?? 0}</div></div>
        <div class="card"><div class="label">Full Markdown Docs</div><div class="value">\${corpus.active_full_markdown_document_count ?? 0}</div></div>
        <div class="card"><div class="label">Generated Docs</div><div class="value">\${corpus.active_generated_document_count ?? 0}</div></div>
        <div class="card"><div class="label">Duplicate URL</div><div class="value">\${corpus.active_duplicate_canonical_source_uri_count ?? 0}</div></div>
        <div class="card"><div class="label">Duplicate Markdown</div><div class="value">\${corpus.active_duplicate_markdown_hash_count ?? 0}</div></div>
        <div class="card"><div class="label">Temp/Test Docs</div><div class="value">\${corpus.active_temp_test_document_count ?? 0}</div></div>
        <div class="card"><div class="label">Active Derived Knowledge</div><div class="value">\${corpus.active_derived_knowledge_count ?? 0}</div></div>
      </div>
      <div class="notice">
        Documents list is paginated. The first page shows 50 items by default; use Load More to inspect the rest.
        Retired objects are excluded from normal review and recall surfaces but remain auditable in database history.
      </div>
    </div>
    <div class="panel">
      <h2>Manual Governance</h2>
      <div class="actions">
        <button class="ghost-button" data-governance-mode="batch_governance">Run Batch Governance</button>
        <button class="ghost-button" data-governance-mode="library_alignment_governance">Run Library Alignment</button>
        <button class="ghost-button" data-governance-mode="cross_source_synthesis_governance">Run Cross-source Synthesis</button>
        <button class="ghost-button" data-governance-mode="global_governance">Run Global Governance</button>
      </div>
      <div class="notice">
        Governance is intentionally manual. These actions write governance jobs, decisions, recall surface state, and possible derived knowledge; they do not run on a timer.
      </div>
      <div id="governance-action-status" class="action-status"></div>
    </div>
  \`;
  views.overview.querySelectorAll("[data-governance-mode]").forEach((node) => {
    node.addEventListener("click", () => runGovernance(node.dataset.governanceMode));
  });
}

async function runGovernance(mode) {
  const statusNode = document.getElementById("governance-action-status");
  statusNode.innerHTML = '<div class="notice">Running ' + escapeHtml(mode) + '...</div>';
  const response = await fetch("/api/governance/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      task_request_id: crypto.randomUUID(),
      task_step_id: crypto.randomUUID(),
      run_modes: [mode],
      max_items: mode === "global_governance" ? 100 : 30,
      include_graph_governance: true
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    statusNode.innerHTML = '<div class="notice">Governance failed: ' + escapeHtml(payload.error || payload.message || JSON.stringify(payload)) + '</div>';
    return;
  }
  await load();
  const refreshedStatusNode = document.getElementById("governance-action-status");
  refreshedStatusNode.innerHTML = \`
    <div class="item">
      <div class="title">Governance completed: \${escapeHtml(mode)}</div>
      <div class="meta">
        <span>job: \${escapeHtml(payload.job_id)}</span>
        <span>processed candidates: \${escapeHtml(payload.processed_candidate_count ?? 0)}</span>
        <span>decisions: \${escapeHtml((payload.governance_decision_ids || []).length)}</span>
        <span>derived knowledge: \${escapeHtml((payload.synthesized_knowledge_ids || []).length)}</span>
      </div>
      <div class="snippet">warnings: \${escapeHtml((payload.warnings || []).join(", ") || "none")}</div>
    </div>
  \`;
}

function renderReview(items) {
  views.review.innerHTML = '<div class="panel"><h2>Review Queue</h2>' + renderList(items, (item) => \`
    <div class="item">
      <div class="title">\${item.review_reason}</div>
      <div class="meta">
        <span>target: \${item.target_object_type}</span>
        <span>priority: \${item.priority}</span>
        <span>status: \${item.status}</span>
      </div>
    </div>
  \`) + '</div>';
}

function summarizeProposalPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const title = payload.title || payload.rule_key || payload.skill_key || payload.source_ref || "";
  const body = payload.statement || payload.content || payload.description || payload.reason || "";
  return [title, body].filter(Boolean).join("\\n");
}

function renderProposals(items) {
  views.proposals.innerHTML = \`
    <div class="panel">
      <div class="toolbar">
        <h2>Change Proposals</h2>
        <button class="ghost-button" id="refresh-proposals">Refresh</button>
      </div>
      <div class="notice">
        这里是 memory / rule / skill 治理提案。Approve 后才会修改 active 对象，并自动重建 resident snapshot 与同步 retrieval index；Reject 只关闭提案，不改当前生效对象。
      </div>
      \${renderList(items, (item) => {
        const payload = item.proposed_payload || {};
        return \`
          <div class="item" data-proposal-id="\${escapeHtml(item.id)}">
            <div class="title">\${escapeHtml(item.proposed_action)}</div>
            <div class="meta">
              <span>target: \${escapeHtml(item.target_object_type || "n/a")}</span>
              <span>risk: \${escapeHtml(item.risk_level || "n/a")}</span>
              <span>status: \${escapeHtml(item.status || "n/a")}</span>
              <span>reason: \${escapeHtml(item.reason || "n/a")}</span>
            </div>
            <div class="snippet">\${escapeHtml(summarizeProposalPayload(payload))}</div>
            <pre class="markdown-view proposal-payload">\${escapeHtml(JSON.stringify(payload, null, 2))}</pre>
            <div class="actions">
              <button class="ghost-button approve" data-proposal-action="approve" data-proposal-id="\${escapeHtml(item.id)}">Approve</button>
              <button class="ghost-button reject" data-proposal-action="reject" data-proposal-id="\${escapeHtml(item.id)}">Reject</button>
            </div>
          </div>
        \`;
      })}
    </div>
  \`;
  document.getElementById("refresh-proposals")?.addEventListener("click", loadProposals);
  views.proposals.querySelectorAll("[data-proposal-action]").forEach((node) => {
    node.addEventListener("click", () => applyProposalAction(node.dataset.proposalId, node.dataset.proposalAction));
  });
}

async function loadProposals() {
  const response = await fetch("/api/governance/change-proposals?status=recorded");
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || payload.message || "Failed to load governance change proposals");
  }
  renderProposals(payload.items || []);
}

async function applyProposalAction(proposalId, action) {
  if (!proposalId || (action !== "approve" && action !== "reject")) {
    return;
  }
  const card = views.proposals.querySelector(\`[data-proposal-id="\${proposalId}"]\`);
  if (card) {
    card.querySelector(".actions").innerHTML = '<div class="notice">Applying ' + escapeHtml(action) + '...</div>';
  }
  const response = await fetch(\`/api/governance/change-proposals/\${proposalId}/actions\`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action,
      fingerprint: "local-dev-v1",
      payload: {
        approved_by: "knowledge-ops-console",
        rejected_by: action === "reject" ? "knowledge-ops-console" : undefined
      }
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    if (card) {
      card.querySelector(".actions").innerHTML = '<div class="notice">Action failed: ' + escapeHtml(payload.error || payload.message || JSON.stringify(payload)) + '</div>';
    }
    return;
  }
  await loadProposals();
  await load();
}

function renderDocuments(payload) {
  const items = payload.items || [];
  documentItems = items;
  documentTotal = payload.total ?? items.length;
  documentOffset = payload.offset ?? 0;
  const shown = documentOffset + items.length;
  views.documents.innerHTML = \`
    <div class="panel">
      <div class="toolbar">
        <h2>Documents</h2>
        <div class="count">Showing \${shown} / \${documentTotal} documents</div>
      </div>
      \${renderList(items, (item) => \`
    <div class="item clickable" data-document-id="\${item.id}">
      <div class="title">\${escapeHtml(item.title)}</div>
      <div class="meta">
        <span>sections: \${escapeHtml(item.section_count)}</span>
        <span>domain: \${escapeHtml(item.memory_domain)}</span>
        <span>source: \${escapeHtml(item.source_type)}</span>
        <span class="badge \${item.markdown_content_hash ? "" : "muted"}">\${item.markdown_content_hash ? "full markdown" : "generated fact"}</span>
      </div>
      <div class="meta"><span>\${escapeHtml(item.source_uri)}</span></div>
    </div>
  \`)}
      \${shown < documentTotal ? '<button class="ghost-button" id="load-more-documents">Load More</button>' : ""}
    </div>
  \`;
  views.documents.querySelectorAll("[data-document-id]").forEach((node) => {
    node.addEventListener("click", () => {
      openDocumentDetail(node.dataset.documentId);
    });
  });
  document.getElementById("load-more-documents")?.addEventListener("click", async () => {
    await loadDocuments(documentOffset + documentPageSize);
  });
}

async function loadDocuments(offset = 0) {
  const response = await fetch(\`/api/documents?limit=\${documentPageSize}&offset=\${offset}\`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || payload.message || "Failed to load documents");
  }
  renderDocuments(payload);
}

function renderDocumentDetail(data) {
  currentDocumentDetail = data;
  const doc = data.document || {};
  const hasMarkdown = Boolean(doc.markdown_content);
  const markdownUrl = \`/api/documents/\${doc.id}/markdown\`;
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.remove("active"));
  Object.values(views).forEach((view) => view.classList.remove("active"));
  documentDetailView.classList.add("active");
  documentDetailView.innerHTML = \`
    <div class="actions">
      <button class="ghost-button" id="detail-back">Back to Documents</button>
      <button class="ghost-button" id="detail-open-source">Open Source Link</button>
      \${hasMarkdown ? \`<a class="ghost-button" href="\${markdownUrl}" target="_blank" rel="noopener noreferrer">Open Full Markdown</a>\` : ""}
    </div>
    <div class="panel">
      <h2>\${doc.title || "Document Detail"}</h2>
      <div class="meta">
        <span>domain: \${doc.memory_domain || "n/a"}</span>
        <span>source: \${doc.source_type || "n/a"}</span>
        <span>sections: \${doc.section_count || 0}</span>
      </div>
      <div class="snippet">\${doc.source_uri || ""}</div>
    </div>
    <div class="detail-grid">
      <div>
        <div class="panel">
          <h2>Sections</h2>
          \${renderList(data.sections || [], (item, index) => \`
            <div class="item clickable inspectable" data-group="sections" data-index="\${index}">
              <div class="title">\${item.title || item.section_key}</div>
              <div class="meta"><span>ordinal: \${item.ordinal}</span><span>tokens: \${item.token_count ?? "n/a"}</span></div>
              <div class="snippet">\${item.summary || item.content || ""}</div>
            </div>
          \`)}
        </div>
        <div class="panel">
          <h2>Canonical Markdown</h2>
          <div class="meta">
            <span>converter: \${doc.markdown_converter || "n/a"}</span>
            <span>hash: \${doc.markdown_content_hash || "n/a"}</span>
          </div>
          <div class="snippet">\${doc.markdown_content_ref || ""}</div>
          \${hasMarkdown
            ? \`<pre class="markdown-view">\${escapeHtml(doc.markdown_content)}</pre>\`
            : \`<div class="notice">No canonical Markdown is stored for this document. This item was generated by memory/knowledge governance from a candidate fact, so it only has the governed fact text and graph edges. To inspect full source text, open a document marked <strong>full markdown</strong> in the Documents list.</div>\`
          }
        </div>
      </div>
      <div>
        <div class="panel">
          <h2>Facts</h2>
          \${renderList(data.facts || [], (item, index) => \`
            <div class="item clickable inspectable" data-group="facts" data-index="\${index}">
              <div class="title">\${item.title}</div>
              <div class="meta"><span>\${item.fact_kind}</span><span>importance: \${item.importance}</span></div>
              <div class="snippet">\${item.statement || ""}</div>
            </div>
          \`)}
        </div>
        <div class="panel">
          <h2>Relations</h2>
          \${renderList(data.relations || [], (item, index) => \`
            <div class="item clickable inspectable" data-group="relations" data-index="\${index}">
              <div class="title">\${item.relation_type}</div>
              <div class="meta"><span>\${item.from_object_type} -> \${item.to_object_type}</span><span>confidence: \${item.confidence_score}</span></div>
              <div class="snippet">\${item.statement || ""}</div>
            </div>
          \`)}
        </div>
        <div class="panel">
          <h2>Evidence</h2>
          \${renderList(data.evidence || [], (item, index) => \`
            <div class="item clickable inspectable" data-group="evidence" data-index="\${index}">
              <div class="title">\${item.evidence_type}</div>
              <div class="meta"><span>\${item.source_type}</span></div>
              <div class="snippet">\${item.content_excerpt || item.source_uri || ""}</div>
            </div>
          \`)}
        </div>
        <div class="panel inspector" id="detail-inspector">
          <h2>Detail</h2>
          <div class="empty">Click a section, fact, relation, or evidence card to inspect it.</div>
        </div>
      </div>
    </div>
  \`;
  document.getElementById("detail-back").addEventListener("click", () => {
    document.querySelector('[data-view="documents"]').classList.add("active");
    documentDetailView.classList.remove("active");
    views.documents.classList.add("active");
  });
  document.getElementById("detail-open-source").addEventListener("click", () => {
    if (doc.source_uri) {
      window.open(doc.source_uri, "_blank", "noopener,noreferrer");
    }
  });
  documentDetailView.querySelectorAll(".inspectable").forEach((node) => {
    node.addEventListener("click", () => {
      openInspector(node.dataset.group, Number(node.dataset.index));
    });
  });
}

function openInspector(group, index) {
  if (!currentDocumentDetail) {
    return;
  }
  const item = currentDocumentDetail[group]?.[index];
  if (!item) {
    return;
  }
  const title = item.title || item.relation_type || item.evidence_type || item.section_key || (group + " item");
  const content =
    item.content ||
    item.statement ||
    item.content_excerpt ||
    item.source_uri ||
    JSON.stringify(item, null, 2);
  const inspector = document.getElementById("detail-inspector");
  inspector.innerHTML = \`
    <h2>Detail</h2>
    <div class="item">
      <div class="title">\${escapeHtml(title)}</div>
      <div class="meta"><span>group: \${group}</span></div>
      <div class="snippet">\${escapeHtml(content)}</div>
    </div>
  \`;
}

async function openDocumentDetail(documentId) {
  const response = await fetch(\`/api/documents/\${documentId}\`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || payload.message || "Failed to load document detail");
  }
  renderDocumentDetail(payload);
}

function renderRuns(items) {
  views.runs.innerHTML = '<div class="panel"><h2>Governance Runs</h2>' + renderList(items, (item) => \`
    <div class="item clickable" data-run-id="\${item.id}">
      <div class="title">\${item.job_type}</div>
      <div class="meta">
        <span>trigger: \${item.trigger_type}</span>
        <span>status: \${item.run_status}</span>
        <span>created: \${new Date(item.created_at).toLocaleString()}</span>
      </div>
    </div>
  \`) + '</div>';
  views.runs.querySelectorAll("[data-run-id]").forEach((node) => {
    node.addEventListener("click", () => {
      openRunDetail(node.dataset.runId);
    });
  });
}

function renderSynthesis(items) {
  views.synthesis.innerHTML = '<div class="panel"><h2>Synthesized Knowledge</h2>' + renderList(items, (item) => \`
    <div class="item clickable" data-synthesis-id="\${escapeHtml(item.id)}">
      <div class="title">\${escapeHtml(item.title)}</div>
      <div class="meta">
        <span>\${escapeHtml(item.knowledge_type)}</span>
        <span>confidence: \${escapeHtml(item.confidence_score)}</span>
        <span>risk: \${escapeHtml(item.risk_level)}</span>
        <span>recall: \${escapeHtml(item.recall_state)}</span>
      </div>
      <div class="snippet">\${escapeHtml(item.content || "")}</div>
      <div class="snippet">治理依据：\${escapeHtml(item.reasoning_summary || "")}</div>
    </div>
  \`) + '</div>';
  views.synthesis.querySelectorAll("[data-synthesis-id]").forEach((node) => {
    node.addEventListener("click", () => {
      openSynthesisDetail(node.dataset.synthesisId);
    });
  });
}

async function openSynthesisDetail(synthesisId) {
  const response = await fetch(\`/api/synthesized-knowledge/\${synthesisId}\`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || payload.message || "Failed to load synthesized knowledge detail");
  }
  renderSynthesisDetail(payload);
}

function renderSynthesisDetail(data) {
  if (!synthesisDetailView) {
    synthesisDetailView = document.createElement("section");
    synthesisDetailView.id = "synthesis-detail-view";
    synthesisDetailView.className = "view";
    document.querySelector(".main").appendChild(synthesisDetailView);
  }
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.remove("active"));
  Object.values(views).forEach((view) => view.classList.remove("active"));
  documentDetailView.classList.remove("active");
  if (runDetailView) runDetailView.classList.remove("active");
  synthesisDetailView.classList.add("active");

  const item = data.item || {};
  const evidence = data.evidence_trace || [];
  synthesisDetailView.innerHTML = \`
    <div class="actions">
      <button class="ghost-button" id="synthesis-detail-back">Back to Synthesized Knowledge</button>
    </div>
    <div class="detail-grid">
      <div>
        <div class="panel">
          <h2>\${escapeHtml(item.title || "Synthesized Knowledge")}</h2>
          <div class="meta">
            <span>\${escapeHtml(item.knowledge_type || "n/a")}</span>
            <span>confidence: \${escapeHtml(item.confidence_score || "n/a")}</span>
            <span>risk: \${escapeHtml(item.risk_level || "n/a")}</span>
            <span>recall: \${escapeHtml(item.recall_state || "n/a")}</span>
          </div>
          <pre class="markdown-view">\${escapeHtml(item.content || "")}</pre>
        </div>
        <div class="panel">
          <h2>Governance Reasoning</h2>
          <div class="snippet">\${escapeHtml(item.reasoning_summary || "")}</div>
        </div>
        <div class="panel">
          <h2>Metadata</h2>
          <pre class="markdown-view">\${escapeHtml(JSON.stringify(item.metadata || {}, null, 2))}</pre>
        </div>
      </div>
      <div>
        <div class="panel">
          <h2>Evidence Trace</h2>
          \${renderList(evidence, (ev) => \`
            <div class="item">
              <div class="title">\${escapeHtml(ev.fact_title || ev.evidence_id || "Evidence")}</div>
              <div class="meta">
                <span>support: \${escapeHtml(ev.support_role || "supports")}</span>
                <span>fact: \${escapeHtml(ev.fact_id || "n/a")}</span>
              </div>
              <div class="snippet">\${escapeHtml(ev.fact_statement || ev.content_excerpt || "")}</div>
              <div class="snippet">\${escapeHtml(ev.source_uri || "")}</div>
            </div>
          \`)}
        </div>
      </div>
    </div>
  \`;
  document.getElementById("synthesis-detail-back").addEventListener("click", () => {
    synthesisDetailView.classList.remove("active");
    document.querySelector('[data-view="synthesis"]').classList.add("active");
    views.synthesis.classList.add("active");
  });
}

async function openRunDetail(runId) {
  const response = await fetch(\`/api/governance-runs/\${runId}\`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || payload.message || "Failed to load governance run detail");
  }
  renderRunDetail(payload);
}

function renderRunDetail(data) {
  if (!runDetailView) {
    runDetailView = document.createElement("section");
    runDetailView.id = "run-detail-view";
    runDetailView.className = "view";
    document.querySelector(".main").appendChild(runDetailView);
  }
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.remove("active"));
  Object.values(views).forEach((view) => view.classList.remove("active"));
  documentDetailView.classList.remove("active");
  runDetailView.classList.add("active");
  const job = data.job || {};
  const resultPayload = job.result_payload || {};
  runDetailView.innerHTML = \`
    <div class="actions">
      <button class="ghost-button" id="run-detail-back">Back to Governance Runs</button>
    </div>
    <div class="panel">
      <h2>Governance Run Detail</h2>
      <div class="meta">
        <span>job: \${escapeHtml(job.id)}</span>
        <span>status: \${escapeHtml(job.run_status)}</span>
        <span>type: \${escapeHtml(job.job_type)}</span>
        <span>trigger: \${escapeHtml(job.trigger_type)}</span>
      </div>
      <div class="snippet">updated_objects: \${escapeHtml(JSON.stringify(resultPayload.updated_objects || {}, null, 2))}</div>
    </div>
    <div class="columns">
      <div class="panel">
        <h2>Decisions</h2>
        \${renderList(data.decisions || [], (item) => \`
          <div class="item">
            <div class="title">\${escapeHtml(item.governance_type)} / \${escapeHtml(item.decision)}</div>
            <div class="meta"><span>\${escapeHtml(item.target_object_type)}</span><span>confidence: \${escapeHtml(item.confidence_score)}</span><span>risk: \${escapeHtml(item.risk_level)}</span></div>
            <div class="snippet">\${escapeHtml(item.reason)}</div>
          </div>
        \`)}
      </div>
      <div class="panel">
        <h2>Cleaning Logs</h2>
        \${renderList(data.cleaning_logs || [], (item) => \`
          <div class="item">
            <div class="title">\${escapeHtml(item.document_title || item.document_id)}</div>
            <div class="meta"><span>\${escapeHtml(item.cleaning_type)}</span><span>removed lines: \${escapeHtml(item.removed_line_count)}</span><span>kept lines: \${escapeHtml(item.kept_line_count)}</span></div>
            <div class="snippet">\${escapeHtml(JSON.stringify(item.removed_sections_summary || [], null, 2))}</div>
          </div>
        \`)}
      </div>
      <div class="panel">
        <h2>Recall Surface</h2>
        \${renderList(data.recall_surface_states || [], (item) => \`
          <div class="item">
            <div class="title">\${escapeHtml(item.object_type)} / \${escapeHtml(item.recall_state)}</div>
            <div class="meta"><span>assembly: \${escapeHtml(item.context_assembly_state)}</span></div>
            <div class="snippet">\${escapeHtml(item.reason)}</div>
          </div>
        \`)}
      </div>
    </div>
    <div class="panel">
      <h2>Synthesized Knowledge In This Run</h2>
      \${renderList(data.synthesized_knowledge || [], (item) => \`
        <div class="item">
          <div class="title">\${escapeHtml(item.title)}</div>
          <div class="meta"><span>\${escapeHtml(item.knowledge_type)}</span><span>confidence: \${escapeHtml(item.confidence_score)}</span><span>risk: \${escapeHtml(item.risk_level)}</span></div>
          <div class="snippet">\${escapeHtml(item.content)}</div>
        </div>
      \`)}
    </div>
  \`;
  document.getElementById("run-detail-back").addEventListener("click", () => {
    runDetailView.classList.remove("active");
    document.querySelector('[data-view="runs"]').classList.add("active");
    views.runs.classList.add("active");
  });
}

function renderGraph(entities, facts, relations) {
  views.graph.innerHTML = \`
    <div class="columns">
      <div class="panel">
        <h2>Entities</h2>
        \${renderList(entities, (item) => \`
          <div class="item">
            <div class="title">\${item.canonical_name}</div>
            <div class="meta"><span>\${item.entity_type}</span><span>\${item.memory_domain}</span></div>
          </div>
        \`)}
      </div>
      <div class="panel">
        <h2>Facts</h2>
        \${renderList(facts, (item) => \`
          <div class="item">
            <div class="title">\${item.title}</div>
            <div class="meta"><span>\${item.fact_kind}</span><span>importance: \${item.importance}</span></div>
          </div>
        \`)}
      </div>
      <div class="panel">
        <h2>Relations</h2>
        \${renderList(relations, (item) => \`
          <div class="item">
            <div class="title">\${item.relation_type}</div>
            <div class="meta"><span>\${item.from_object_type} -> \${item.to_object_type}</span><span>confidence: \${item.confidence_score}</span></div>
          </div>
        \`)}
      </div>
    </div>
  \`;
}

async function load() {
  const [config, overview, review, proposals, runs, synthesis, entities, facts, relations] = await Promise.all([
    fetch("/api/config").then((r) => r.json()),
    fetch("/api/overview").then((r) => r.json()),
    fetch("/api/review-queue").then((r) => r.json()),
    fetch("/api/governance/change-proposals?status=recorded").then((r) => r.json()),
    fetch("/api/governance-runs").then((r) => r.json()),
    fetch("/api/synthesized-knowledge").then((r) => r.json()),
    fetch("/api/graph/entities").then((r) => r.json()),
    fetch("/api/graph/facts").then((r) => r.json()),
    fetch("/api/graph/relations").then((r) => r.json())
  ]);
  configPill.textContent = \`\${config.tenant_id} / \${config.scope}\`;
  renderOverview(overview);
  await loadDocuments(0);
  renderReview(review.items || []);
  renderProposals(proposals.items || []);
  renderRuns(runs.items || []);
  renderSynthesis(synthesis.items || []);
  renderGraph(entities.items || [], facts.items || [], relations.items || []);
}

load().catch((error) => {
  views.overview.innerHTML = '<div class="panel"><h2>Load Error</h2><div class="empty">' + error.message + '</div></div>';
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
