import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const rootDir = process.cwd();
const casesPath =
  process.argv[2] ??
  path.join(rootDir, "tests", "knowledge-benchmark", "knowledge-capability-cases.v1.json");
const reportJsonPath =
  process.argv[3] ??
  path.join(rootDir, "tests", "knowledge-benchmark", "reports", "knowledge-capability-report.json");
const reportMdPath =
  process.argv[4] ??
  path.join(rootDir, "tests", "knowledge-benchmark", "reports", "knowledge-capability-report.md");

const tenantId = process.env.KNOWLEDGE_EVAL_TENANT_ID || process.env.DEFAULT_TENANT_ID || "tenant-local";
const scope = process.env.KNOWLEDGE_EVAL_SCOPE || process.env.DEFAULT_SCOPE || "memory.validation";
const serviceUrl = process.env.MEMORY_SERVICE_URL || "http://127.0.0.1:3101";
const casesFile = JSON.parse(await readFile(casesPath, "utf8"));
const cases = casesFile.cases ?? [];

const pool = new pg.Pool({
  connectionString:
    process.env.DB_URL ||
    `postgresql://${encodeURIComponent(process.env.PGUSER || "postgres")}:${
      encodeURIComponent(process.env.PGPASSWORD || "postgres")
    }@${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "55432"}/${process.env.PGDATABASE || "super_agent_system"}`
});

const health = await fetchJson(`${serviceUrl}/healthz`, { method: "GET" });
if (!health.ok) {
  throw new Error(`memory-service health failed: ${JSON.stringify(health)}`);
}

const corpus = await readCorpusState();
const results = [];

for (let index = 0; index < cases.length; index += 1) {
  const testCase = cases[index];
  const started = process.hrtime.bigint();
  const response = await fetchJson(`${serviceUrl}/internal/knowledge/retrieve`, {
    method: "POST",
    headers: buildHeaders(`capability-${testCase.id}`),
    body: JSON.stringify({
      task_request_id: `00000000-0000-4000-8000-${String(300 + index).padStart(12, "0")}`,
      query: testCase.query,
      intent_type: "fact_lookup",
      top_k: 5,
      require_evidence: true,
      include_trace: false,
      include_factual: true,
      include_procedural: true,
      fingerprint: "local-dev-v1",
      fingerprint_status: "matched"
    })
  });
  const latencyMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  const body = response.body ?? {};
  const derived = Array.isArray(body.derived_knowledge) ? body.derived_knowledge : [];
  const evidence = Array.isArray(body.evidence_trace) ? body.evidence_trace : [];
  const facts = Array.isArray(body.facts) ? body.facts : [];
  const topTitle = String(derived[0]?.title ?? "");
  const derivedText = JSON.stringify(derived).toLowerCase();
  const evidenceText = JSON.stringify(evidence).toLowerCase();
  const expectedTitleTerms = testCase.expected_title_terms ?? [];
  const expectedEvidenceTerms = testCase.expected_evidence_terms ?? [];
  const expectedWarningTerms = testCase.expected_warning_terms ?? [];
  const forbiddenTitleTerms = testCase.forbidden_title_terms ?? [];
  const titleTermHits = expectedTitleTerms.filter((term) => derivedText.includes(String(term).toLowerCase()));
  const evidenceTermHits = expectedEvidenceTerms.filter((term) => evidenceText.includes(String(term).toLowerCase()));
  const warnings = Array.isArray(body.warnings) ? body.warnings.map(String) : [];
  const warningsText = JSON.stringify(warnings).toLowerCase();
  const warningTermHits = expectedWarningTerms.filter((term) => warningsText.includes(String(term).toLowerCase()));
  const forbiddenTitleHits = forbiddenTitleTerms.filter((term) => derivedText.includes(String(term).toLowerCase()));
  const uniqueEvidenceSources = [...new Set(evidence.map((item) => item.source_uri).filter(Boolean))];
  const expectedNoDerived = typeof testCase.max_derived_hits === "number";
  const derivedCountOk =
    derived.length >= Number(testCase.min_derived_hits ?? 0) &&
    (typeof testCase.max_derived_hits !== "number" || derived.length <= testCase.max_derived_hits);
  const evidenceCountOk =
    evidence.length >= Number(testCase.min_evidence_hits ?? 0) &&
    (typeof testCase.max_evidence_hits !== "number" || evidence.length <= testCase.max_evidence_hits);
  const titleTermsOk = expectedTitleTerms.length === 0 || titleTermHits.length > 0;
  const evidenceTermsOk = expectedEvidenceTerms.length === 0 || evidenceTermHits.length > 0;
  const warningTermsOk = expectedWarningTerms.length === 0 || warningTermHits.length > 0;
  const forbiddenTitleOk = forbiddenTitleHits.length === 0;
  const sourceDiversityOk = uniqueEvidenceSources.length >= Number(testCase.min_unique_evidence_sources ?? 0);
  const latencyOk = typeof testCase.max_latency_ms !== "number" || latencyMs <= Number(testCase.max_latency_ms);
  const primaryFactsOk = facts.length <= Number(testCase.max_primary_facts ?? Number.POSITIVE_INFINITY);
  const passed =
    response.status === 200 &&
    derivedCountOk &&
    evidenceCountOk &&
    titleTermsOk &&
    evidenceTermsOk &&
    warningTermsOk &&
    forbiddenTitleOk &&
    sourceDiversityOk &&
    latencyOk &&
    primaryFactsOk;

  results.push({
    id: testCase.id,
    category: testCase.category,
    language: testCase.language,
    query: testCase.query,
    status: response.status,
    latency_ms: round(latencyMs),
    passed,
    expected_no_derived: expectedNoDerived,
    derived_count: derived.length,
    evidence_trace_count: evidence.length,
    primary_facts_count: facts.length,
    warnings,
    top_title: topTitle || null,
    top_titles: derived.slice(0, 3).map((item) => item.title),
    title_term_hits: titleTermHits,
    evidence_term_hits: evidenceTermHits,
    warning_term_hits: warningTermHits,
    forbidden_title_hits: forbiddenTitleHits,
    unique_evidence_source_count: uniqueEvidenceSources.length,
    top_evidence_sources: uniqueEvidenceSources.slice(0, 8),
    checks: {
      derived_count_ok: derivedCountOk,
      evidence_count_ok: evidenceCountOk,
      title_terms_ok: titleTermsOk,
      evidence_terms_ok: evidenceTermsOk,
      warning_terms_ok: warningTermsOk,
      forbidden_title_ok: forbiddenTitleOk,
      source_diversity_ok: sourceDiversityOk,
      latency_ok: latencyOk,
      primary_facts_ok: primaryFactsOk
    },
    summary: body.summary ?? null
  });
}

const positiveCases = results.filter((item) => !item.expected_no_derived);
const boundaryCases = results.filter((item) => item.expected_no_derived);
const categories = summarizeBy(results, "category");
const report = {
  benchmark_name: "knowledge-capability-eval-v1",
  generated_at: new Date().toISOString(),
  service_url: serviceUrl,
  tenant_id: tenantId,
  scope,
  corpus,
  summary: {
    total_cases: results.length,
    passed_cases: results.filter((item) => item.passed).length,
    pass_rate: ratio(results.filter((item) => item.passed).length, results.length),
    positive_pass_rate: ratio(positiveCases.filter((item) => item.passed).length, positiveCases.length),
    boundary_pass_rate: ratio(boundaryCases.filter((item) => item.passed).length, boundaryCases.length),
    avg_latency_ms: round(results.reduce((sum, item) => sum + item.latency_ms, 0) / Math.max(results.length, 1)),
    avg_derived_count: round(results.reduce((sum, item) => sum + item.derived_count, 0) / Math.max(results.length, 1)),
    avg_evidence_trace_count: round(results.reduce((sum, item) => sum + item.evidence_trace_count, 0) / Math.max(results.length, 1)),
    p50_latency_ms: percentile(results.map((item) => item.latency_ms), 0.5),
    p95_latency_ms: percentile(results.map((item) => item.latency_ms), 0.95),
    max_latency_ms: round(Math.max(...results.map((item) => item.latency_ms), 0)),
    avg_unique_evidence_sources: round(
      results.reduce((sum, item) => sum + item.unique_evidence_source_count, 0) / Math.max(results.length, 1)
    )
  },
  categories,
  results
};

await mkdir(path.dirname(reportJsonPath), { recursive: true });
await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(reportMdPath, renderMarkdown(report), "utf8");
process.stdout.write(`${JSON.stringify({ report_json: reportJsonPath, report_md: reportMdPath, summary: report.summary }, null, 2)}\n`);

await pool.end();

async function readCorpusState() {
  const result = await pool.query(
    `
    SELECT
      (SELECT COUNT(*)::int FROM kp_document WHERE tenant_id = $1 AND scope = $2 AND status = 'active') AS active_documents,
      (SELECT COUNT(*)::int FROM kp_section WHERE tenant_id = $1 AND scope = $2 AND status = 'active') AS active_sections,
      (SELECT COUNT(*)::int FROM kp_evidence WHERE tenant_id = $1 AND scope = $2 AND status = 'active') AS active_evidence,
      (SELECT COUNT(*)::int FROM kp_synthesized_knowledge WHERE tenant_id = $1 AND scope = $2 AND status = 'active') AS active_synthesized_knowledge,
      (SELECT COUNT(*)::int FROM kp_fact WHERE tenant_id = $1 AND scope = $2) AS fact_count,
      (SELECT COUNT(*)::int FROM kp_entity WHERE tenant_id = $1 AND scope = $2) AS entity_count,
      (SELECT COUNT(*)::int FROM kp_relation WHERE tenant_id = $1 AND scope = $2) AS relation_count,
      (SELECT COUNT(*)::int FROM kp_recall_surface_state WHERE tenant_id = $1 AND scope = $2 AND object_type IN ('fact', 'entity', 'relation')) AS intermediate_recall_count
    `,
    [tenantId, scope]
  );
  return result.rows[0];
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return {
    ok: response.ok,
    status: response.status,
    body
  };
}

function buildHeaders(label) {
  return {
    "content-type": "application/json; charset=utf-8",
    "x-tenant-id": tenantId,
    "x-scope": scope,
    "x-trace-id": `trace-${label}-${Date.now()}`,
    "idempotency-key": `knowledge-capability:${label}:${Date.now()}`
  };
}

function renderMarkdown(report) {
  const failed = report.results.filter((item) => !item.passed);
  const lines = [
    "# 长期知识/记忆系统能力边界评测报告",
    "",
    `生成时间：${report.generated_at}`,
    "",
    "## 1. 当前语料状态",
    "",
    `- Active documents：${report.corpus.active_documents}`,
    `- Active sections：${report.corpus.active_sections}`,
    `- Active evidence：${report.corpus.active_evidence}`,
    `- Active synthesized knowledge：${report.corpus.active_synthesized_knowledge}`,
    `- Intermediate facts/entities/relations：${report.corpus.fact_count}/${report.corpus.entity_count}/${report.corpus.relation_count}`,
    `- Intermediate recall surface：${report.corpus.intermediate_recall_count}`,
    "",
    "## 2. 总体指标",
    "",
    "| 指标 | 结果 |",
    "| --- | ---: |",
    `| 总 case | ${report.summary.total_cases} |`,
    `| 通过 case | ${report.summary.passed_cases} |`,
    `| 总通过率 | ${formatPercent(report.summary.pass_rate)} |`,
    `| 正向能力通过率 | ${formatPercent(report.summary.positive_pass_rate)} |`,
    `| 边界拒召回通过率 | ${formatPercent(report.summary.boundary_pass_rate)} |`,
    `| 平均延迟 | ${report.summary.avg_latency_ms} ms |`,
    `| P50 延迟 | ${report.summary.p50_latency_ms} ms |`,
    `| P95 延迟 | ${report.summary.p95_latency_ms} ms |`,
    `| 最大延迟 | ${report.summary.max_latency_ms} ms |`,
    `| 平均 derived 命中 | ${report.summary.avg_derived_count} |`,
    `| 平均 evidence trace | ${report.summary.avg_evidence_trace_count} |`,
    `| 平均唯一 evidence source | ${report.summary.avg_unique_evidence_sources} |`,
    "",
    "## 3. 分类指标",
    "",
    "| 类别 | Case | 通过 | 通过率 | 平均延迟 | 平均 Derived | 平均 Evidence Source |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...report.categories.map((item) =>
      toRow([
        item.category,
        item.total,
        item.passed,
        formatPercent(item.pass_rate),
        `${item.avg_latency_ms} ms`,
        item.avg_derived_count,
        item.avg_unique_evidence_sources
      ])
    ),
    "",
    "## 4. Case 结果",
    "",
    "| ID | 类别 | 语言 | 结果 | 延迟 | Derived | Evidence | Sources | Facts | Warning | 首条知识 |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    ...report.results.map((item) =>
      toRow([
        item.id,
        item.category,
        item.language,
        item.passed ? "通过" : "未通过",
        `${item.latency_ms} ms`,
        item.derived_count,
        item.evidence_trace_count,
        item.unique_evidence_source_count,
        item.primary_facts_count,
        item.warnings.join(", "),
        item.top_title ?? "N/A"
      ])
    ),
    "",
    "## 5. 失败与边界",
    "",
    failed.length === 0
      ? "- 本轮没有失败 case。"
      : failed
          .map((item) =>
            `- ${item.id}：${item.query}。检查=${JSON.stringify(item.checks)}；Top=${item.top_title ?? "N/A"}。`
          )
          .join("\n"),
    "",
    "## 6. 当前能力判断",
    "",
    "- 已具备：治理产物优先召回、证据链返回、中文查询、英文 evidence 回跳、facts/entities/relations 不作为长期召回对象。",
    "- 边界：排序仍是确定性规则，不是模型 rerank；泛化知识可能抢占具体 query；无关 query 需要持续监控误召回。",
    "- 下一步：扩大 case 到 50-100 条，加入期望 top1、跨宿主 MCP/HTTP 一致性、性能分布和人工审查列。"
  ];
  return `${lines.join("\n")}\n`;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : round(numerator / denominator, 4);
}

function percentile(values, p) {
  const sorted = values.map(Number).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return round(sorted[index]);
}

function summarizeBy(items, key) {
  const groups = new Map();
  for (const item of items) {
    const groupKey = String(item[key] ?? "unknown");
    const existing = groups.get(groupKey) ?? [];
    existing.push(item);
    groups.set(groupKey, existing);
  }
  return [...groups.entries()]
    .map(([category, group]) => ({
      category,
      total: group.length,
      passed: group.filter((item) => item.passed).length,
      pass_rate: ratio(group.filter((item) => item.passed).length, group.length),
      avg_latency_ms: round(group.reduce((sum, item) => sum + item.latency_ms, 0) / group.length),
      avg_derived_count: round(group.reduce((sum, item) => sum + item.derived_count, 0) / group.length),
      avg_unique_evidence_sources: round(group.reduce((sum, item) => sum + item.unique_evidence_source_count, 0) / group.length)
    }))
    .sort((left, right) => left.category.localeCompare(right.category));
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function formatPercent(value) {
  return `${Math.round(Number(value ?? 0) * 1000) / 10}%`;
}

function toRow(values) {
  return `| ${values.map((value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")).join(" | ")} |`;
}
