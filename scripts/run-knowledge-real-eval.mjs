import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { buildMemoryServiceApp } from "../services/memory-service/dist/services/memory-service/src/app.js";
import { buildKnowledgeOpsConsoleApp } from "../services/knowledge-ops-console/dist/app.js";

const { Pool } = pg;
const rootDir = process.cwd();
const ingestCasesPath =
  process.argv[2] ??
  path.join(rootDir, "tests", "knowledge-benchmark", "ai-real-ingest-cases.v1.json");
const retrievalCasesPath =
  process.argv[3] ??
  path.join(rootDir, "tests", "knowledge-benchmark", "ai-real-retrieval-benchmark.v1.json");
const reportPath =
  process.argv[4] ??
  path.join(rootDir, "tests", "knowledge-benchmark", "reports", "ai-real-eval-report.json");

const tenantId = process.env.KNOWLEDGE_EVAL_TENANT_ID || process.env.DEFAULT_TENANT_ID || "tenant-local";
const scope = process.env.KNOWLEDGE_EVAL_SCOPE || process.env.DEFAULT_SCOPE || "memory.validation";
const pool = new Pool({
  connectionString:
    process.env.DB_URL ||
    `postgresql://${encodeURIComponent(process.env.PGUSER || "postgres")}${
      process.env.PGPASSWORD ? `:${encodeURIComponent(process.env.PGPASSWORD)}` : ""
    }@${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "55432"}/${process.env.PGDATABASE || "super_agent_system"}`
});
const memoryApp = buildMemoryServiceApp();
const ingestCases = JSON.parse(await readFile(ingestCasesPath, "utf8"));
const retrievalCases = JSON.parse(await readFile(retrievalCasesPath, "utf8"));

const taskContext = await loadTaskContext();
await cleanupBenchmarkData();
const ingestResults = [];
const retrievalResults = [];
const boundaryChecks = [];

try {
  for (const ingestCase of ingestCases) {
    const source = await materializeSource(ingestCase);
    const startedAt = process.hrtime.bigint();
    const response = await memoryApp.inject({
      method: "POST",
      url: "/internal/knowledge/documents/ingest",
      headers: buildHeaders(`ingest-${ingestCase.id}`),
      payload: {
        task_request_id: taskContext.taskRequestId,
        task_step_id: taskContext.taskStepId,
        source_type: "markdown_text",
        source_uri: ingestCase.url,
        title: ingestCase.title,
        content: source.content,
        memory_domain: ingestCase.memory_domain ?? "knowledge",
        markdown_converter: source.converter,
        sectioning_mode: source.sectioning_mode ?? ingestCase.sectioning_mode ?? "markdown",
        trigger_governance: true,
        fingerprint_status: "matched_or_na"
      }
    });
    const endedAt = process.hrtime.bigint();
    const latencyMs = Number(endedAt - startedAt) / 1_000_000;
    const payload = response.json();

    ingestResults.push({
      id: ingestCase.id,
      title: ingestCase.title,
      theme: ingestCase.theme,
      url: ingestCase.url,
      status_code: response.statusCode,
      ingest_latency_ms: round(latencyMs),
      document_id: payload.document_id ?? null,
      section_count: payload.section_count ?? 0,
      candidate_count: Array.isArray(payload.candidate_ids) ? payload.candidate_ids.length : 0,
      governance_status: payload.governance?.status ?? null,
      created_fact_count: Array.isArray(payload.governance?.created_fact_ids) ? payload.governance.created_fact_ids.length : 0,
      warnings: payload.warnings ?? [],
      fetch_char_count: source.content.length,
      converter: source.converter,
      source_kind: source.source_kind
    });
  }

  for (const testCase of retrievalCases) {
    const startedAt = process.hrtime.bigint();
    const response = await memoryApp.inject({
      method: "POST",
      url: "/internal/knowledge/retrieve",
      headers: buildHeaders(`retrieve-${testCase.id}`),
      payload: {
        task_request_id: taskContext.taskRequestId,
        query: testCase.query,
        intent_type: testCase.intent_type,
        top_k: 10,
        require_evidence: true,
        include_factual: true,
        include_procedural: true,
        fingerprint: "local-dev-v1",
        fingerprint_status: "matched"
      }
    });
    const endedAt = process.hrtime.bigint();
    const latencyMs = Number(endedAt - startedAt) / 1_000_000;
    const payload = response.json();

    const sectionTitles = Array.isArray(payload.section_refs) ? payload.section_refs.map((item) => String(item.document_title ?? item.title ?? "")) : [];
    const vectorEngine = payload.assembly_trace?.retrieval?.vector_engine ?? null;
    const factBody = JSON.stringify(payload.facts ?? []).toLowerCase();
    const evidenceBody = JSON.stringify(payload.evidence_refs ?? []).toLowerCase();
    const sectionBody = JSON.stringify(payload.section_refs ?? []).toLowerCase();
    const combinedBody = `${factBody} ${evidenceBody} ${sectionBody}`;
    const docHitIndex = findFirstHitIndex(sectionTitles, testCase.expected_document_titles ?? []);

    retrievalResults.push({
      id: testCase.id,
      theme: testCase.theme,
      query: testCase.query,
      intent_type: testCase.intent_type,
      status_code: response.statusCode,
      latency_ms: round(latencyMs),
      returned_document_titles: sectionTitles,
      hit_index: docHitIndex,
      hit_at_1: docHitIndex === 0,
      hit_at_3: docHitIndex >= 0 && docHitIndex < 3,
      hit_at_5: docHitIndex >= 0 && docHitIndex < 5,
      evidence_count: Array.isArray(payload.evidence_refs) ? payload.evidence_refs.length : 0,
      section_count: Array.isArray(payload.section_refs) ? payload.section_refs.length : 0,
      vector_engine: vectorEngine,
      must_have_passed: (testCase.must_have_terms ?? []).every((term) => combinedBody.includes(String(term).toLowerCase())),
      warnings: payload.warnings ?? []
    });
  }

  boundaryChecks.push(await runDuplicateIngestCheck(ingestCases[0]));
  boundaryChecks.push(await runMarkItDownFileCheck());
  boundaryChecks.push(await runEmptyInlineCheck());

  const memoryAddress = await memoryApp.listen({ port: 0, host: "127.0.0.1" });
  const consoleApp = buildKnowledgeOpsConsoleApp({
    apiBaseUrl: memoryAddress,
    tenantId,
    scope
  });

  let consoleChecks;
  try {
    consoleChecks = await runConsoleChecks(consoleApp);
  } finally {
    await consoleApp.close();
    await memoryApp.close();
  }

  const ingestLatencies = ingestResults.map((item) => item.ingest_latency_ms).sort((a, b) => a - b);
  const retrievalLatencies = retrievalResults.map((item) => item.latency_ms).sort((a, b) => a - b);

  const report = {
    benchmark_name: "knowledge-ai-real-eval-v1",
    generated_at: new Date().toISOString(),
    corpus_size: ingestCases.length,
    retrieval_case_count: retrievalCases.length,
    tenant_id: tenantId,
    scope,
    summary: {
      ingest_success_rate: ratio(ingestResults.filter((item) => item.status_code === 200).length, ingestResults.length),
      retrieve_hit_at_1: ratio(retrievalResults.filter((item) => item.hit_at_1).length, retrievalResults.length),
      retrieve_hit_at_3: ratio(retrievalResults.filter((item) => item.hit_at_3).length, retrievalResults.length),
      retrieve_hit_at_5: ratio(retrievalResults.filter((item) => item.hit_at_5).length, retrievalResults.length),
      must_have_pass_rate: ratio(retrievalResults.filter((item) => item.must_have_passed).length, retrievalResults.length),
      ingest_p50_latency_ms: percentile(ingestLatencies, 0.5),
      ingest_p95_latency_ms: percentile(ingestLatencies, 0.95),
      retrieve_p50_latency_ms: percentile(retrievalLatencies, 0.5),
      retrieve_p95_latency_ms: percentile(retrievalLatencies, 0.95),
      vector_engines: [...new Set(retrievalResults.map((item) => item.vector_engine).filter(Boolean))]
    },
    ingest_results: ingestResults,
    retrieval_results: retrievalResults,
    boundary_checks: boundaryChecks,
    console_checks: consoleChecks
  };

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await pool.end();
}

async function loadTaskContext() {
  const result = await pool.query(`
    SELECT ts.id, tr.id AS task_request_id
    FROM task_step ts
    JOIN task_plan tp ON tp.id = ts.task_plan_id
    JOIN task_request tr ON tr.id = tp.task_request_id
    ORDER BY ts.created_at DESC
    LIMIT 1
  `);
  assert.ok(result.rows[0], "expected seeded task context");
  return {
    taskStepId: result.rows[0].id,
    taskRequestId: result.rows[0].task_request_id
  };
}

async function cleanupBenchmarkData() {
  const benchmarkTracePrefixes = ["trace-ingest-%", "trace-retrieve-%", "trace-boundary-%"];
  const traceWhere = benchmarkTracePrefixes.map((_, index) => `trace_id LIKE $${index + 3}`).join(" OR ");
  const params = [tenantId, scope, ...benchmarkTracePrefixes];

  await pool.query(`DELETE FROM kp_context_bundle WHERE tenant_id = $1 AND scope = $2 AND (${traceWhere})`, params);
  await pool.query(`DELETE FROM kp_governance_job WHERE tenant_id = $1 AND scope = $2 AND (${traceWhere})`, params);
  await pool.query(`DELETE FROM kp_review_queue WHERE tenant_id = $1 AND scope = $2 AND (${traceWhere})`, params);
  await pool.query(`DELETE FROM kp_candidate_link WHERE tenant_id = $1 AND scope = $2 AND (${traceWhere})`, params);
  await pool.query(`DELETE FROM kp_relation WHERE tenant_id = $1 AND scope = $2 AND (${traceWhere})`, params);
  await pool.query(`DELETE FROM kp_fact WHERE tenant_id = $1 AND scope = $2 AND (${traceWhere})`, params);
  await pool.query(`DELETE FROM kp_entity WHERE tenant_id = $1 AND scope = $2 AND (${traceWhere})`, params);
  await pool.query(`DELETE FROM kp_evidence WHERE tenant_id = $1 AND scope = $2 AND (${traceWhere})`, params);
  await pool.query(`DELETE FROM kp_document WHERE tenant_id = $1 AND scope = $2 AND (${traceWhere})`, params);
  await pool.query(`DELETE FROM memory_candidate WHERE tenant_id = $1 AND scope = $2 AND (${traceWhere})`, params);
}

async function materializeSource(ingestCase) {
  const cachePath = path.join(rootDir, "tests", "knowledge-benchmark", "source-cache", `${safeFileName(ingestCase.id)}.html`);
  let html = null;
  if (process.env.KNOWLEDGE_EVAL_REFRESH_SOURCES !== "1") {
    html = await readCachedSource(cachePath);
  }

  if (!html) {
    const response = await fetchWithRetry(ingestCase.url);
    if (!response.ok) {
      throw new Error(`failed to fetch source ${ingestCase.url}: ${response.status}`);
    }
    html = await response.text();
    await mkdir(path.dirname(cachePath), { recursive: true });
    await writeFile(cachePath, html, "utf8");
  }

  if (isArxivAbsUrl(ingestCase.url)) {
    return materializeArxivPaper({
      html,
      url: ingestCase.url,
      fallbackTitle: ingestCase.title
    });
  }

  const title = extractTitle(html) || ingestCase.title;
  const content = htmlToMarkdown(html);
  if (!content.trim()) {
    throw new Error(`empty extracted content for ${ingestCase.url}`);
  }
  return {
    title,
    content: `# ${title}\n\nSource URL: ${ingestCase.url}\n\n${content}`.trim(),
    converter: "html-to-markdown-lite-v1",
    source_kind: ingestCase.source_kind ?? "web_article",
    sectioning_mode: "markdown"
  };
}

async function readCachedSource(cachePath) {
  try {
    return await readFile(cachePath, "utf8");
  } catch {
    return null;
  }
}

function safeFileName(input) {
  return String(input).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "source";
}

async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "SuperAgentSystem knowledge benchmark/1.0"
        }
      });
      if (response.ok || attempt === attempts) {
        return response;
      }
      lastError = new Error(`fetch ${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500 * attempt);
  }
  throw lastError;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isArxivAbsUrl(url) {
  return /^https:\/\/arxiv\.org\/abs\/[^/?#]+/i.test(url);
}

function materializeArxivPaper(input) {
  const title =
    extractFirst(input.html, [
      /<h1[^>]*class=["'][^"']*title[^"']*["'][^>]*>\s*<span[^>]*>Title:\s*<\/span>\s*([\s\S]*?)<\/h1>/i,
      /<meta\s+name=["']citation_title["']\s+content=["']([^"']+)["']/i,
      /<title[^>]*>\s*\[[^\]]+\]\s*([\s\S]*?)<\/title>/i
    ]) || input.fallbackTitle;
  const authors = extractAll(input.html, /<meta\s+name=["']citation_author["']\s+content=["']([^"']+)["']/gi);
  const abstract = extractFirst(input.html, [
    /<blockquote[^>]*class=["'][^"']*abstract[^"']*["'][^>]*>\s*<span[^>]*>Abstract:\s*<\/span>\s*([\s\S]*?)<\/blockquote>/i,
    /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i
  ]);
  const arxivId = /arxiv\.org\/abs\/([^/?#]+)/i.exec(input.url)?.[1] ?? null;
  const doi = extractFirst(input.html, [/https:\/\/doi\.org\/([^\s<"]+)/i]);
  const published = extractFirst(input.html, [
    /<meta\s+name=["']citation_date["']\s+content=["']([^"']+)["']/i,
    /\[Submitted on ([^\]]+)\]/i
  ]);

  const content = [
    `# ${cleanInline(title)}`,
    "",
    "## Metadata",
    "",
    "- Source: arXiv",
    arxivId ? `- arXiv: ${arxivId}` : null,
    doi ? `- DOI: ${doi}` : null,
    published ? `- Published: ${cleanInline(published)}` : null,
    `- URL: ${input.url}`,
    authors.length > 0 ? `- Authors: ${authors.map(cleanInline).join(", ")}` : null,
    "",
    "## Abstract",
    "",
    cleanBlock(abstract || ""),
    "",
    "## Key Signals",
    "",
    "- Paper source normalized from arXiv metadata.",
    "- Abstract is treated as the first-pass evidence layer.",
    "- Full PDF Markdown conversion can be attached later through MarkItDown when needed."
  ]
    .filter((item) => item !== null)
    .join("\n")
    .trim();

  return {
    title: cleanInline(title),
    content,
    converter: "arxiv-paper-organizer-v1",
    source_kind: "paper",
    sectioning_mode: "markdown"
  };
}

function extractTitle(html) {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : null;
}

function extractFirst(html, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) {
      return cleanBlock(match[1]);
    }
  }
  return null;
}

function extractAll(html, pattern) {
  const values = [];
  for (const match of html.matchAll(pattern)) {
    if (match[1]) {
      values.push(cleanBlock(match[1]));
    }
  }
  return values;
}

function htmlToMarkdown(html) {
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  const body = bodyMatch ? bodyMatch[1] : html;
  const converted = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1")
    .replace(/<\/(p|div|section|article|tr)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return dedupeMarkdownLines(cleanBlock(converted));
}

function dedupeMarkdownLines(input) {
  const lines = input
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const result = [];
  const seen = new Set();
  for (const line of lines) {
    const normalized = line.toLowerCase();
    if (normalized.length < 20 && !line.startsWith("#") && !line.startsWith("- ")) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(line);
  }
  return result.join("\n\n");
}

function cleanInline(input) {
  return cleanBlock(input).replace(/\s+/g, " ").trim();
}

function cleanBlock(input) {
  return decodeHtmlEntities(String(input ?? ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function decodeHtmlEntities(input) {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

async function runDuplicateIngestCheck(ingestCase) {
  const source = await materializeSource(ingestCase);
  const first = await memoryApp.inject({
    method: "POST",
    url: "/internal/knowledge/documents/ingest",
    headers: buildHeaders(`boundary-dup-1-${ingestCase.id}`),
    payload: {
      task_request_id: taskContext.taskRequestId,
      task_step_id: taskContext.taskStepId,
      source_type: "markdown_text",
      source_uri: `${ingestCase.url}#duplicate-check`,
      title: `${ingestCase.title} Duplicate Check`,
      content: source.content,
      memory_domain: "knowledge",
      markdown_converter: source.converter,
      sectioning_mode: source.sectioning_mode ?? "markdown",
      trigger_governance: false,
      fingerprint_status: "matched_or_na"
    }
  });
  const second = await memoryApp.inject({
    method: "POST",
    url: "/internal/knowledge/documents/ingest",
    headers: buildHeaders(`boundary-dup-2-${ingestCase.id}`),
    payload: {
      task_request_id: taskContext.taskRequestId,
      task_step_id: taskContext.taskStepId,
      source_type: "markdown_text",
      source_uri: `${ingestCase.url}#duplicate-check`,
      title: `${ingestCase.title} Duplicate Check`,
      content: source.content,
      memory_domain: "knowledge",
      markdown_converter: source.converter,
      sectioning_mode: source.sectioning_mode ?? "markdown",
      trigger_governance: false,
      fingerprint_status: "matched_or_na"
    }
  });
  const firstBody = first.json();
  const secondBody = second.json();
  return {
    id: "duplicate_ingest_same_source_uri",
    ok: first.statusCode === 200 && second.statusCode === 200 && firstBody.document_id === secondBody.document_id,
    first_document_id: firstBody.document_id ?? null,
    second_document_id: secondBody.document_id ?? null
  };
}

async function runMarkItDownFileCheck() {
  const fixtureDir = path.join(rootDir, "tests", "knowledge-benchmark", "tmp");
  await mkdir(fixtureDir, { recursive: true });
  const fixturePath = path.join(fixtureDir, "markitdown-smoke.html");
  await writeFile(
    fixturePath,
    [
      "<!doctype html>",
      "<html>",
      "<head><title>MarkItDown Smoke</title></head>",
      "<body>",
      "<h1>MarkItDown Smoke</h1>",
      "<p>MarkItDown should convert this HTML fixture into markdown for knowledge ingest.</p>",
      "<ul><li>converter tracking</li><li>markdown source persistence</li></ul>",
      "</body>",
      "</html>"
    ].join("\n"),
    "utf8"
  );

  const response = await memoryApp.inject({
    method: "POST",
    url: "/internal/knowledge/documents/ingest",
    headers: buildHeaders("boundary-markitdown-file"),
    payload: {
      task_request_id: taskContext.taskRequestId,
      task_step_id: taskContext.taskStepId,
      source_type: "markitdown_file",
      file_path: fixturePath,
      title: "MarkItDown Adapter Smoke",
      memory_domain: "knowledge",
      sectioning_mode: "markdown",
      trigger_governance: false,
      fingerprint_status: "matched_or_na"
    }
  });
  const body = response.json();
  return {
    id: "markitdown_file_adapter",
    ok:
      response.statusCode === 200 &&
      typeof body.markdown_content_ref === "string" &&
      body.markdown_converter === "markitdown-v0.1.5",
    status_code: response.statusCode,
    document_id: body.document_id ?? null,
    markdown_content_ref: body.markdown_content_ref ?? null,
    markdown_converter: body.markdown_converter ?? null,
    body: response.statusCode === 200 ? undefined : body
  };
}

async function runEmptyInlineCheck() {
  const response = await memoryApp.inject({
    method: "POST",
    url: "/internal/knowledge/documents/ingest",
    headers: buildHeaders("boundary-empty-inline"),
    payload: {
      task_request_id: taskContext.taskRequestId,
      task_step_id: taskContext.taskStepId,
      source_type: "inline_text",
      title: "Empty inline",
      content: "   ",
      memory_domain: "knowledge",
      fingerprint_status: "matched_or_na"
    }
  });
  return {
    id: "empty_inline_content",
    ok: response.statusCode >= 400,
    status_code: response.statusCode,
    body: response.json()
  };
}

async function runConsoleChecks(consoleApp) {
  const overview = await consoleApp.inject({ method: "GET", url: "/api/overview" });
  const documents = await consoleApp.inject({ method: "GET", url: "/api/documents" });
  const graphFacts = await consoleApp.inject({ method: "GET", url: "/api/graph/facts" });
  return {
    overview_status_code: overview.statusCode,
    documents_status_code: documents.statusCode,
    graph_facts_status_code: graphFacts.statusCode,
    document_count: overview.statusCode === 200 ? Number(overview.json().document_count ?? 0) : null,
    listed_documents: documents.statusCode === 200 && Array.isArray(documents.json().items) ? documents.json().items.length : null,
    note: "document_count is the whole single-tenant scope, not only this benchmark run."
  };
}

function buildHeaders(label) {
  return {
    "content-type": "application/json",
    "x-tenant-id": tenantId,
    "x-scope": scope,
    "x-trace-id": `trace-${label}-${Date.now()}`,
    "idempotency-key": `real-eval:${label}:${Date.now()}`
  };
}

function findFirstHitIndex(returnedTitles, expectedTitles) {
  for (let index = 0; index < returnedTitles.length; index += 1) {
    if (expectedTitles.includes(returnedTitles[index])) {
      return index;
    }
  }
  return -1;
}

function ratio(numerator, denominator) {
  if (denominator === 0) {
    return 0;
  }
  return round(numerator / denominator, 4);
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) {
    return 0;
  }
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * p) - 1));
  return round(sortedValues[index]);
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
