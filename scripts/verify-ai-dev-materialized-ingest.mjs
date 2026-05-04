import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { buildMemoryServiceApp } from "../services/memory-service/dist/services/memory-service/src/app.js";

const { Pool } = pg;
const rootDir = process.cwd();
const tenantId = process.env.DEFAULT_TENANT_ID || "tenant-local";
const scope = process.env.DEFAULT_SCOPE || "memory.validation";
const ingestCasesPath = path.join(rootDir, "tests", "knowledge-benchmark", "ai-dev-ingest-cases.v1.json");
const pool = new Pool({
  connectionString:
    process.env.DB_URL ||
    `postgresql://${encodeURIComponent(process.env.PGUSER || "postgres")}:${
      encodeURIComponent(process.env.PGPASSWORD || "postgres")
    }@${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "55432"}/${process.env.PGDATABASE || "super_agent_system"}`
});
const app = buildMemoryServiceApp();

function buildHeaders(label, id) {
  return {
    "X-Tenant-Id": tenantId,
    "X-Scope": scope,
    "X-Trace-Id": `trace-ai-dev-ingest-${label}-${Date.now()}`,
    "Idempotency-Key": `ai-dev-materialized-ingest:${label}:${id}:${Date.now()}`
  };
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

try {
  process.env.KNOWLEDGE_VECTOR_INDEX_ENABLED = "0";
  process.env.KNOWLEDGE_VECTOR_RETRIEVAL_ENABLED = "0";

  const taskContext = await loadTaskContext();
  const ingestCases = JSON.parse(await readFile(ingestCasesPath, "utf8"));
  assert.ok(Array.isArray(ingestCases) && ingestCases.length > 0, "expected materialized ingest cases");

  const ingested = [];
  for (const item of ingestCases) {
    const response = await app.inject({
      method: "POST",
      url: "/internal/knowledge/documents/ingest",
      headers: buildHeaders("ingest", item.id),
      payload: {
        task_request_id: taskContext.taskRequestId,
        task_step_id: taskContext.taskStepId,
        source_type: "markdown_file",
        file_path: item.file_path,
        source_uri: item.url,
        title: item.title,
        memory_domain: item.memory_domain ?? "knowledge",
        language: item.language,
        theme: item.theme,
        source_candidate_id: item.source_candidate_id,
        source_kind: item.source_kind,
        expected_signals: item.expected_signals,
        markdown_converter: item.markdown_converter,
        sectioning_mode: item.sectioning_mode ?? "markdown",
        trigger_governance: true,
        fingerprint_status: "matched_or_na"
      }
    });
    assert.equal(response.statusCode, 200, `ingest failed for ${item.id}: ${response.body}`);
    const body = response.json();
    assert.ok(body.document_id, `document_id missing for ${item.id}`);
    assert.ok(body.markdown_content_ref, `markdown_content_ref missing for ${item.id}`);
    assert.ok(body.section_count >= 1, `section_count missing for ${item.id}`);
    assert.ok(body.governance?.job_id, `governance job missing for ${item.id}`);
    assert.ok(body.warnings?.includes("vector_index_disabled"), `vector route must stay disabled for ${item.id}`);
    ingested.push({ source_case_id: item.id, ...body });
  }

  const detailRows = [];
  for (const item of ingested) {
    const detail = await app.inject({
      method: "GET",
      url: `/internal/knowledge/documents/${item.document_id}`,
      headers: buildHeaders("detail", item.source_case_id)
    });
    assert.equal(detail.statusCode, 200, `detail failed for ${item.source_case_id}: ${detail.body}`);
    const body = detail.json();
    assert.ok(body.document?.markdown_content?.length >= 120, `markdown content missing for ${item.source_case_id}`);
    assert.ok(body.document?.markdown_content_ref, `markdown content ref missing for ${item.source_case_id}`);
    assert.ok(Array.isArray(body.sections) && body.sections.length >= 1, `sections missing for ${item.source_case_id}`);
    assert.ok(Array.isArray(body.evidence) && body.evidence.length >= 1, `evidence missing for ${item.source_case_id}`);
    assert.ok(Array.isArray(body.facts) && body.facts.length >= 1, `facts missing for ${item.source_case_id}`);
    assert.ok(Array.isArray(body.relations) && body.relations.length >= 1, `relations missing for ${item.source_case_id}`);
    detailRows.push({
      source_case_id: item.source_case_id,
      document_id: item.document_id,
      title: body.document.title,
      markdown_chars: body.document.markdown_content.length,
      sections: body.sections.length,
      facts: body.facts.length,
      relations: body.relations.length,
      evidence: body.evidence.length
    });
  }

  const relationResult = await pool.query(
    `
    SELECT relation_type, from_object_type, to_object_type, COUNT(*)::int AS count
    FROM kp_relation
    WHERE tenant_id = $1
      AND scope = $2
      AND metadata->>'relation_scope' = 'explicit_evidence_internal'
    GROUP BY relation_type, from_object_type, to_object_type
    ORDER BY relation_type, from_object_type, to_object_type
    `,
    [tenantId, scope]
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        ingested_count: ingested.length,
        vector_index_enabled: process.env.KNOWLEDGE_VECTOR_INDEX_ENABLED,
        detail_rows: detailRows,
        explicit_relation_contracts: relationResult.rows
      },
      null,
      2
    )
  );
} finally {
  await app.close();
  await pool.end();
}
