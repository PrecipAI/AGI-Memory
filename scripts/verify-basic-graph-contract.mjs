import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { buildMemoryServiceApp } from "../services/memory-service/dist/services/memory-service/src/app.js";

const { Pool } = pg;
const tenantId = process.env.DEFAULT_TENANT_ID || "tenant-local";
const scope = process.env.DEFAULT_SCOPE || "memory.validation";
const pool = new Pool({
  connectionString:
    process.env.DB_URL ||
    `postgresql://${encodeURIComponent(process.env.PGUSER || "postgres")}:${
      encodeURIComponent(process.env.PGPASSWORD || "postgres")
    }@${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "55432"}/${process.env.PGDATABASE || "super_agent_system"}`
});
const app = buildMemoryServiceApp();
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "basic-graph-contract-"));
const tempMarkdownPath = path.join(tempRoot, "basic-graph-contract.md");

function buildHeaders(label) {
  return {
    "X-Tenant-Id": tenantId,
    "X-Scope": scope,
    "X-Trace-Id": `trace-basic-graph-contract-${label}-${Date.now()}`,
    "Idempotency-Key": `basic-graph-contract:${label}:${Date.now()}`
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
  await writeFile(
    tempMarkdownPath,
    [
      "# Basic graph contract",
      "",
      "## Agent memory",
      "",
      "Agent memory systems persist reusable facts and bind them to evidence sections.",
      "",
      "## Evidence grounding",
      "",
      "Evidence grounding requires every generated fact to point back to a markdown section."
    ].join("\n"),
    "utf8"
  );

  const ingest = await app.inject({
    method: "POST",
    url: "/internal/knowledge/documents/ingest",
    headers: buildHeaders("ingest"),
    payload: {
      task_request_id: taskContext.taskRequestId,
      task_step_id: taskContext.taskStepId,
      source_type: "local_file",
      file_path: tempMarkdownPath,
      title: "Basic graph contract",
      memory_domain: "knowledge",
      sectioning_mode: "markdown",
      trigger_governance: true,
      fingerprint_status: "matched_or_na"
    }
  });
  assert.equal(ingest.statusCode, 200, "basic graph ingest failed");
  const body = ingest.json();
  assert.ok(body.document_id, "document_id missing");
  assert.ok(Array.isArray(body.section_ids) && body.section_ids.length >= 2, "section ids missing");
  assert.ok(Array.isArray(body.candidate_ids) && body.candidate_ids.length >= 2, "candidate ids missing");
  assert.ok(body.governance?.job_id, "governance job id missing");
  assert.ok(body.warnings?.includes("vector_index_disabled"), "vector indexing should be disabled in this contract");

  const relationResult = await pool.query(
    `
    SELECT relation_type, from_object_type, to_object_type, COUNT(*)::int AS count
    FROM kp_relation
    WHERE tenant_id = $1
      AND scope = $2
      AND metadata->>'source_candidate_id' = ANY($3::text[])
    GROUP BY relation_type, from_object_type, to_object_type
    ORDER BY relation_type, from_object_type, to_object_type
    `,
    [tenantId, scope, body.candidate_ids]
  );
  const relationKeys = new Set(
    relationResult.rows.map((row) => `${row.relation_type}:${row.from_object_type}->${row.to_object_type}`)
  );

  for (const expected of [
    "has_section:document->section",
    "mentions:section->entity",
    "states:section->fact",
    "about:fact->entity",
    "derived_from:fact->section",
    "evidenced_by:fact->evidence"
  ]) {
    assert.ok(relationKeys.has(expected), `missing basic graph relation ${expected}`);
  }

  const retrieve = await app.inject({
    method: "POST",
    url: "/internal/knowledge/retrieve",
    headers: buildHeaders("retrieve"),
    payload: {
      task_request_id: taskContext.taskRequestId,
      query: "Agent memory evidence grounding",
      intent_type: "graph_contract_lookup",
      top_k: 10,
      require_evidence: true,
      include_factual: true,
      include_procedural: false,
      fingerprint_status: "matched_or_na"
    }
  });
  assert.equal(retrieve.statusCode, 200, "basic graph retrieve failed");
  const retrieveBody = retrieve.json();
  assert.equal(retrieveBody.assembly_trace?.retrieval?.method, "graph_first", "knowledge retrieval should prefer graph grounding");
  assert.equal(retrieveBody.assembly_trace?.retrieval?.mode, "graph_grounded", "knowledge retrieval should return graph-grounded sections");
  assert.equal(retrieveBody.assembly_trace?.retrieval?.fallback_method, "bm25_lexical_rrf", "vector retrieval should stay disabled");
  assert.ok(Array.isArray(retrieveBody.relations) && retrieveBody.relations.length >= 1, "graph retrieve should return relations");
  assert.ok(Array.isArray(retrieveBody.evidence_refs) && retrieveBody.evidence_refs.length >= 1, "graph retrieve should return evidence refs");

  console.log(
    JSON.stringify(
      {
        ok: true,
        document_id: body.document_id,
        section_count: body.section_count,
        candidate_count: body.candidate_ids.length,
        relation_contracts: [...relationKeys],
        retrieval_method: retrieveBody.assembly_trace?.retrieval?.method,
        retrieval_mode: retrieveBody.assembly_trace?.retrieval?.mode,
        fallback_method: retrieveBody.assembly_trace?.retrieval?.fallback_method
      },
      null,
      2
    )
  );
} finally {
  await app.close();
  await pool.end();
  await rm(tempRoot, { recursive: true, force: true });
}
