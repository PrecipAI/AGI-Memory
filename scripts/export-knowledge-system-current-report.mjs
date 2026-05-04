import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const rootDir = process.cwd();
const outputJsonPath =
  process.argv[2] ??
  path.join(rootDir, "tests", "knowledge-benchmark", "reports", "knowledge-current-system-report.json");
const outputMdPath =
  process.argv[3] ??
  path.join(rootDir, "tests", "knowledge-benchmark", "reports", "knowledge-current-system-report.md");
const capabilityReportPath =
  process.argv[4] ??
  path.join(rootDir, "tests", "knowledge-benchmark", "reports", "knowledge-capability-report.json");

const tenantId = process.env.DEFAULT_TENANT_ID || "tenant-local";
const scope = process.env.DEFAULT_SCOPE || "memory.validation";
const pool = new pg.Pool({
  connectionString:
    process.env.DB_URL ||
    `postgresql://${encodeURIComponent(process.env.PGUSER || "postgres")}:${
      encodeURIComponent(process.env.PGPASSWORD || "postgres")
    }@${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "55432"}/${process.env.PGDATABASE || "super_agent_system"}`
});

const [
  corpus,
  documents,
  synthesizedKnowledge,
  synthesizedEvidence,
  evidenceSources,
  governanceJobs,
  governanceDecisions,
  reviewQueue,
  proposals,
  memoryStatus,
  ruleStatus,
  skillStatus,
  capabilityReport
] = await Promise.all([
  queryOne(`
    SELECT
      (SELECT COUNT(*)::int FROM kp_document WHERE tenant_id = $1 AND scope = $2) AS total_documents,
      (SELECT COUNT(*)::int FROM kp_document WHERE tenant_id = $1 AND scope = $2 AND status = 'active') AS active_documents,
      (SELECT COUNT(*)::int FROM kp_document WHERE tenant_id = $1 AND scope = $2 AND status = 'retired') AS retired_documents,
      (SELECT COUNT(*)::int FROM kp_document WHERE tenant_id = $1 AND scope = $2 AND status = 'active' AND markdown_content IS NOT NULL AND length(markdown_content) > 0) AS active_markdown_documents,
      (SELECT COUNT(*)::int FROM kp_section WHERE tenant_id = $1 AND scope = $2 AND status = 'active') AS active_sections,
      (SELECT COUNT(*)::int FROM kp_evidence WHERE tenant_id = $1 AND scope = $2 AND status = 'active') AS active_evidence,
      (SELECT COUNT(*)::int FROM kp_synthesized_knowledge WHERE tenant_id = $1 AND scope = $2 AND status = 'active') AS active_synthesized_knowledge,
      (SELECT COUNT(*)::int FROM kp_fact WHERE tenant_id = $1 AND scope = $2) AS fact_count,
      (SELECT COUNT(*)::int FROM kp_entity WHERE tenant_id = $1 AND scope = $2) AS entity_count,
      (SELECT COUNT(*)::int FROM kp_relation WHERE tenant_id = $1 AND scope = $2) AS relation_count,
      (SELECT COUNT(*)::int FROM kp_recall_surface_state WHERE tenant_id = $1 AND scope = $2 AND object_type IN ('fact', 'entity', 'relation')) AS intermediate_recall_count,
      (SELECT COUNT(*)::int FROM kp_review_queue WHERE tenant_id = $1 AND scope = $2 AND status = 'active') AS active_review_queue,
      (SELECT COUNT(*)::int FROM governance_change_proposal WHERE tenant_id = $1 AND scope = $2 AND status = 'recorded') AS pending_change_proposals
  `),
  queryRows(`
    SELECT id, title, source_type, source_uri, memory_domain, lifecycle_state, review_state,
           markdown_converter, markdown_content_hash,
           (
             SELECT COUNT(*)::int
             FROM kp_section s
             WHERE s.document_id = kp_document.id
               AND s.tenant_id = kp_document.tenant_id
               AND s.scope = kp_document.scope
               AND s.status = 'active'
           ) AS section_count,
           length(COALESCE(markdown_content, '')) AS markdown_chars,
           created_at, updated_at
    FROM kp_document
    WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT 200
  `),
  queryRows(`
    SELECT
      sk.id,
      sk.knowledge_type,
      sk.title,
      sk.content,
      sk.reasoning_summary,
      sk.confidence_score,
      sk.risk_level,
      sk.lifecycle_state,
      sk.review_state,
      sk.recall_state,
      sk.evidence_ids,
      sk.source_object_ids,
      sk.metadata,
      sk.created_at,
      sk.updated_at,
      COUNT(DISTINCT ske.evidence_id)::int AS linked_evidence_count,
      COUNT(DISTINCT e.source_uri)::int AS source_uri_count
    FROM kp_synthesized_knowledge sk
    LEFT JOIN kp_synthesized_knowledge_evidence ske
      ON ske.synthesized_knowledge_id = sk.id
     AND ske.tenant_id = sk.tenant_id
     AND ske.scope = sk.scope
     AND ske.status = 'active'
    LEFT JOIN kp_evidence e
      ON e.id = ske.evidence_id
     AND e.tenant_id = sk.tenant_id
     AND e.scope = sk.scope
     AND e.status = 'active'
    WHERE sk.tenant_id = $1
      AND sk.scope = $2
      AND sk.status = 'active'
    GROUP BY sk.id
    ORDER BY sk.confidence_score DESC, sk.updated_at DESC
  `),
  queryRows(`
    SELECT
      ske.synthesized_knowledge_id,
      sk.title AS synthesized_title,
      e.id AS evidence_id,
      e.source_uri,
      e.source_type,
      left(e.content_excerpt, 320) AS content_excerpt
    FROM kp_synthesized_knowledge_evidence ske
    JOIN kp_synthesized_knowledge sk ON sk.id = ske.synthesized_knowledge_id
    JOIN kp_evidence e ON e.id = ske.evidence_id
    WHERE ske.tenant_id = $1
      AND ske.scope = $2
      AND ske.status = 'active'
      AND sk.status = 'active'
      AND e.status = 'active'
    ORDER BY sk.confidence_score DESC, ske.created_at ASC
    LIMIT 300
  `),
  queryRows(`
    SELECT source_type, split_part(source_uri, '/', 3) AS source_host, COUNT(*)::int AS evidence_count
    FROM kp_evidence
    WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
    GROUP BY source_type, split_part(source_uri, '/', 3)
    ORDER BY evidence_count DESC
    LIMIT 30
  `),
  queryRows(`
    SELECT id, job_type, trigger_type, run_status, created_at, started_at, finished_at,
           result_payload -> 'warnings' AS warnings,
           result_payload -> 'synthesized_knowledge_ids' AS synthesized_knowledge_ids,
           result_payload -> 'intermediate_artifact_purge' AS intermediate_artifact_purge
    FROM kp_governance_job
    WHERE tenant_id = $1 AND scope = $2
    ORDER BY created_at DESC
    LIMIT 10
  `),
  queryRows(`
    SELECT governance_type, decision, target_object_type, risk_level, COUNT(*)::int AS count
    FROM kp_governance_decision
    WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
    GROUP BY governance_type, decision, target_object_type, risk_level
    ORDER BY count DESC
    LIMIT 50
  `),
  queryRows(`
    SELECT id, target_object_type, review_reason, priority, status, created_at
    FROM kp_review_queue
    WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
    ORDER BY priority DESC, created_at DESC
    LIMIT 50
  `),
  queryRows(`
    SELECT id, target_object_type, proposed_action, reason, risk_level, status, created_at
    FROM governance_change_proposal
    WHERE tenant_id = $1 AND scope = $2 AND status = 'recorded'
    ORDER BY created_at DESC
    LIMIT 50
  `),
  statusRows("memory"),
  statusRows("rule"),
  statusRows("skill"),
  readOptionalJson(capabilityReportPath)
]);

const report = {
  generated_at: new Date().toISOString(),
  tenant_id: tenantId,
  scope,
  corpus,
  documents,
  synthesized_knowledge: synthesizedKnowledge,
  synthesized_evidence_sample: synthesizedEvidence,
  evidence_sources: evidenceSources,
  governance_jobs: governanceJobs,
  governance_decisions: governanceDecisions,
  review_queue: reviewQueue,
  pending_change_proposals: proposals,
  memory_status: memoryStatus,
  rule_status: ruleStatus,
  skill_status: skillStatus,
  capability_eval: capabilityReport?.summary ?? null,
  capability_failures: capabilityReport?.results?.filter((item) => !item.passed) ?? []
};

await mkdir(path.dirname(outputJsonPath), { recursive: true });
await writeFile(outputJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(outputMdPath, renderMarkdown(report), "utf8");
console.log(JSON.stringify({ report_json: outputJsonPath, report_md: outputMdPath, corpus, capability_eval: report.capability_eval }, null, 2));

await pool.end();

async function queryOne(sql) {
  const result = await pool.query(sql, [tenantId, scope]);
  return result.rows[0] ?? {};
}

async function queryRows(sql) {
  const result = await pool.query(sql, [tenantId, scope]);
  return result.rows;
}

async function statusRows(table) {
  const result = await pool.query(
    `
    SELECT status::text, COUNT(*)::int AS count
    FROM ${table}
    WHERE tenant_id = $1 AND scope = $2
    GROUP BY status
    ORDER BY status
    `,
    [tenantId, scope]
  );
  return result.rows;
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function renderMarkdown(input) {
  const lines = [
    "# 当前长期知识/记忆系统完整数据报告",
    "",
    `生成时间：${input.generated_at}`,
    `Tenant / Scope：${input.tenant_id} / ${input.scope}`,
    "",
    "## 1. 总体数据",
    "",
    "| 指标 | 数量 |",
    "| --- | ---: |",
    `| Active documents | ${input.corpus.active_documents} |`,
    `| Active markdown documents | ${input.corpus.active_markdown_documents} |`,
    `| Active sections | ${input.corpus.active_sections} |`,
    `| Active evidence | ${input.corpus.active_evidence} |`,
    `| Active synthesized knowledge | ${input.corpus.active_synthesized_knowledge} |`,
    `| Facts / Entities / Relations | ${input.corpus.fact_count} / ${input.corpus.entity_count} / ${input.corpus.relation_count} |`,
    `| Intermediate recall surface | ${input.corpus.intermediate_recall_count} |`,
    `| Active review queue | ${input.corpus.active_review_queue} |`,
    `| Pending change proposals | ${input.corpus.pending_change_proposals} |`,
    "",
    "## 2. 能力评测",
    "",
    input.capability_eval
      ? [
          `- 总 case：${input.capability_eval.total_cases}`,
          `- 通过 case：${input.capability_eval.passed_cases}`,
          `- 总通过率：${formatPercent(input.capability_eval.pass_rate)}`,
          `- 正向能力通过率：${formatPercent(input.capability_eval.positive_pass_rate)}`,
          `- 边界拒召回通过率：${formatPercent(input.capability_eval.boundary_pass_rate)}`,
          `- 平均延迟：${input.capability_eval.avg_latency_ms} ms`,
          `- 平均 derived 命中：${input.capability_eval.avg_derived_count}`,
          `- 平均 evidence trace：${input.capability_eval.avg_evidence_trace_count}`
        ].join("\n")
      : "- 尚未找到能力评测结果。",
    "",
    "## 3. Synthesized Knowledge 明细",
    "",
    "| # | 类型 | 标题 | 置信度 | 风险 | Evidence | Sources |",
    "| ---: | --- | --- | ---: | --- | ---: | ---: |",
    ...input.synthesized_knowledge.map((item, index) =>
      toRow([
        index + 1,
        item.knowledge_type,
        item.title,
        item.confidence_score,
        item.risk_level,
        item.linked_evidence_count,
        item.source_uri_count
      ])
    ),
    "",
    "## 4. Synthesized Knowledge 内容摘要",
    "",
    ...input.synthesized_knowledge.flatMap((item, index) => [
      `### ${index + 1}. ${item.title}`,
      "",
      `- 类型：${item.knowledge_type}`,
      `- 置信度：${item.confidence_score}`,
      `- 风险：${item.risk_level}`,
      `- Evidence：${item.linked_evidence_count}`,
      `- Sources：${item.source_uri_count}`,
      "",
      truncate(item.content, 900),
      ""
    ]),
    "## 5. Evidence 来源分布",
    "",
    "| Source type | Host | Evidence |",
    "| --- | --- | ---: |",
    ...input.evidence_sources.map((item) => toRow([item.source_type, item.source_host || "n/a", item.evidence_count])),
    "",
    "## 6. 最近治理任务",
    "",
    "| Job | Type | Status | Synthesized | Purge | Warnings |",
    "| --- | --- | --- | ---: | --- | --- |",
    ...input.governance_jobs.map((item) =>
      toRow([
        item.id,
        item.job_type,
        item.run_status,
        Array.isArray(item.synthesized_knowledge_ids) ? item.synthesized_knowledge_ids.length : 0,
        item.intermediate_artifact_purge ? "yes" : "no",
        JSON.stringify(item.warnings ?? [])
      ])
    ),
    "",
    "## 7. Memory / Rule / Skill 状态",
    "",
    `- Memory：${statusSummary(input.memory_status)}`,
    `- Rule：${statusSummary(input.rule_status)}`,
    `- Skill：${statusSummary(input.skill_status)}`,
    "",
    "## 8. 当前能力边界结论",
    "",
    "- 当前系统已经能用治理后的 synthesized knowledge 作为主召回对象，并返回 evidence trace。",
    "- 当前长期层不再暴露 facts/entities/relations，符合“中间产物只服务治理”的设计。",
    "- 现有能力评测是首版 10 条 case，能说明链路和典型边界，但不能代表大规模泛化能力。",
    "- 多跳能力当前主要依赖治理前置合成，而不是在线 graph search；图搜索应作为后续对比路线。"
  ];
  return `${lines.join("\n")}\n`;
}

function toRow(values) {
  return `| ${values.map((value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")).join(" | ")} |`;
}

function truncate(value, max) {
  const text = String(value ?? "").trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function formatPercent(value) {
  return `${Math.round(Number(value ?? 0) * 1000) / 10}%`;
}

function statusSummary(rows) {
  return rows.map((item) => `${item.status}=${item.count}`).join(", ") || "none";
}
