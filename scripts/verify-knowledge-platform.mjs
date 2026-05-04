import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { buildMemoryServiceApp } from "../services/memory-service/dist/services/memory-service/src/app.js";

const { Pool } = pg;
const tenantId = process.env.KNOWLEDGE_VERIFY_TENANT_ID || "tenant-local-verify";
const scope = process.env.KNOWLEDGE_VERIFY_SCOPE || "memory.validation.verify";
process.env.DEFAULT_TENANT_ID = tenantId;
process.env.DEFAULT_SCOPE = scope;
const pool = new Pool({
  connectionString:
    process.env.DB_URL ||
    `postgresql://${encodeURIComponent(process.env.PGUSER || "postgres")}${
      process.env.PGPASSWORD ? `:${encodeURIComponent(process.env.PGPASSWORD)}` : ""
    }@${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "55432"}/${process.env.PGDATABASE || "super_agent_system"}`
});
const app = buildMemoryServiceApp();
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "knowledge-ingest-"));
const tempMarkdownPath = path.join(tempRoot, "knowledge-ingest-smoke.md");

function buildHeaders(label) {
  return {
    "X-Tenant-Id": tenantId,
    "X-Scope": scope,
    "X-Trace-Id": `trace-${label}-${Date.now()}`,
    "Idempotency-Key": `idem-${label}-${Date.now()}`
  };
}

try {
  const tableCheck = await pool.query(
    `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'kp_document',
        'kp_section',
        'kp_evidence',
        'kp_entity',
        'kp_fact',
        'kp_relation',
        'kp_candidate_link',
        'kp_review_queue',
        'kp_context_bundle',
        'kp_governance_job',
        'kp_governance_decision',
        'kp_governance_cleaning_log',
        'kp_synthesized_knowledge',
        'kp_synthesized_knowledge_evidence',
        'kp_object_revision',
        'kp_recall_surface_state'
      )
    ORDER BY table_name
    `
  );
  assert.equal(tableCheck.rows.length, 16, "knowledge platform tables are missing");

  const taskRequestId = randomUUID();
  const taskPlanId = randomUUID();
  const taskStepId = randomUUID();
  await pool.query("BEGIN");
  await pool.query("DELETE FROM kp_synthesized_knowledge_evidence WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM kp_recall_surface_state WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM kp_context_bundle WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM kp_review_queue WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM kp_governance_cleaning_log WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM kp_governance_decision WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM kp_synthesized_knowledge WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM kp_candidate_link WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM kp_relation WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM kp_fact WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM kp_entity WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM kp_evidence WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM kp_section WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM kp_document WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM kp_object_revision WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM kp_governance_job WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM memory_access_log WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM resident_snapshot WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM skill WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM memory WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM conversation_summary WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query("DELETE FROM memory_candidate WHERE tenant_id = $1 AND scope = $2", [tenantId, scope]);
  await pool.query(
    `
    INSERT INTO environment_fingerprint (
      tenant_id, scope, status, version, fingerprint_key, capability_version, config_hash,
      schema_version, dependency_signature, deployment_baseline_id, trace_id
    )
    VALUES ($1, $2, 'active', 1, 'local-dev-v1', 'verify-v1', 'verify-config',
      'memory-v3', 'verify', 'verify-baseline', 'verify-knowledge-platform')
    ON CONFLICT (tenant_id, scope, fingerprint_key) DO UPDATE
    SET status = EXCLUDED.status,
        updated_at = now()
    `,
    [tenantId, scope]
  );
  await pool.query(
    `
    INSERT INTO task_request (
      id, tenant_id, scope, request_channel, requester_id, task_type, goal,
      input_payload, normalized_envelope, priority, idempotency_key, trace_id
    )
    VALUES ($1, $2, $3, 'verify', 'verify-knowledge-platform', 'knowledge_verify',
      'Verify knowledge platform without polluting the default tenant', '{}'::jsonb, '{}'::jsonb, 50, $4, 'verify-knowledge-platform')
    `,
    [taskRequestId, tenantId, scope, `verify-request-${taskRequestId}`]
  );
  await pool.query(
    `
    INSERT INTO task_plan (
      id, tenant_id, scope, task_request_id, planning_model, plan_hash, goal,
      acceptance_criteria, risk_level, plan_payload, trace_id
    )
    VALUES ($1, $2, $3, $4, 'verify', $5,
      'Verify knowledge platform without polluting the default tenant', '[]'::jsonb, 'low', '{}'::jsonb, 'verify-knowledge-platform')
    `,
    [taskPlanId, tenantId, scope, taskRequestId, `verify-plan-${taskPlanId}`]
  );
  await pool.query(
    `
    INSERT INTO task_step (
      id, tenant_id, scope, task_plan_id, step_key, step_order, title, step_type,
      dependency_keys, input_payload, expected_output, acceptance_criteria,
      risk_level, side_effect_class, idempotency_key, trace_id
    )
    VALUES ($1, $2, $3, $4, 'knowledge-verify', 1, 'Knowledge verification', 'verify',
      ARRAY[]::text[], '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 'low', 'read_only', $5, 'verify-knowledge-platform')
    `,
    [taskStepId, tenantId, scope, taskPlanId, `verify-step-${taskStepId}`]
  );
  await pool.query("COMMIT");

  await writeFile(
    tempMarkdownPath,
    [
      "# Knowledge ingest smoke",
      "",
      "## Constraint",
      "",
      "Imported documents should become sections, evidence, candidates, and governed facts.",
      "",
      "## Retrieval",
      "",
      "The knowledge retrieval path should return imported sections and evidence."
    ].join("\n"),
    "utf8"
  );

  const documentIngest = await app.inject({
    method: "POST",
    url: "/internal/knowledge/documents/ingest",
    headers: buildHeaders("knowledge-document-ingest"),
    payload: {
      task_request_id: taskRequestId,
      task_step_id: taskStepId,
      source_type: "local_file",
      file_path: tempMarkdownPath,
      title: "Knowledge ingest smoke doc",
      memory_domain: "knowledge",
      sectioning_mode: "markdown",
      trigger_governance: true,
      fingerprint_status: "matched_or_na"
    }
  });
  assert.equal(documentIngest.statusCode, 200, `knowledge document ingest failed: ${documentIngest.body}`);
  const documentIngestBody = documentIngest.json();
  assert.ok(documentIngestBody.document_id, "knowledge document ingest document id missing");
  assert.ok(documentIngestBody.section_count >= 2, "knowledge document ingest should create sections");
  assert.ok(Array.isArray(documentIngestBody.candidate_ids) && documentIngestBody.candidate_ids.length >= 2, "knowledge document ingest should create candidates");
  assert.ok(documentIngestBody.governance?.job_id, "knowledge document ingest should trigger governance");
  assert.ok(documentIngestBody.markdown_content_ref, "knowledge document ingest should return markdown source ref");

  const markdownSourceStat = await pool.query(
    `
    SELECT markdown_content, markdown_content_hash, markdown_content_ref, markdown_converter
    FROM kp_document
    WHERE id = $1
    `,
    [documentIngestBody.document_id]
  );
  const markdownSource = markdownSourceStat.rows[0];
  assert.ok(markdownSource?.markdown_content?.includes("Knowledge ingest smoke"), "knowledge document should persist full markdown content");
  assert.ok(markdownSource?.markdown_content_hash, "knowledge document markdown hash missing");
  assert.equal(markdownSource?.markdown_content_ref, documentIngestBody.markdown_content_ref, "knowledge document markdown ref mismatch");
  assert.equal(markdownSource?.markdown_converter, "markdown-first-v1", "knowledge document markdown converter mismatch");

  const markdownFileContent = await readFile(documentIngestBody.markdown_content_ref, "utf8");
  assert.ok(markdownFileContent.includes("Knowledge ingest smoke"), "knowledge document should persist markdown file copy");

  const candidate = await app.inject({
    method: "POST",
    url: "/internal/memory/candidates",
    headers: buildHeaders("knowledge-candidate"),
    payload: {
      task_request_id: taskRequestId,
      task_step_id: taskStepId,
      source_type: "local_file",
      source_ref: `verify://knowledge/${randomUUID()}`,
      artifact_tag: "constraint_fact",
      verification_status: "verified",
      side_effect_class: "read_only",
      fingerprint_status: "matched_or_na",
      candidate_payload: {
        fact_type: "design_constraint",
        title: "Knowledge platform smoke constraint",
        statement: "The knowledge governance smoke path should persist a rule fact, evidence, relation, and review queue item."
      }
    }
  });
  assert.equal(candidate.statusCode, 200, "memory candidate ingestion failed");

  const jobCreate = await app.inject({
    method: "POST",
    url: "/internal/knowledge/governance/jobs",
    headers: buildHeaders("knowledge-job"),
    payload: {
      job_type: "knowledge_governance_run",
      trigger_type: "manual_smoke",
      trigger_ref: taskRequestId,
      target_object_type: "memory_candidate",
      payload: {
        smoke: true
      }
    }
  });
  assert.equal(jobCreate.statusCode, 200, "knowledge governance job creation failed");
  const jobCreateBody = jobCreate.json();
  assert.ok(jobCreateBody.job_id, "knowledge governance job id missing");

  const governanceRun = await app.inject({
    method: "POST",
    url: "/internal/knowledge/governance/run",
    headers: buildHeaders("knowledge-run"),
    payload: {
      task_request_id: taskRequestId,
      task_step_id: taskStepId,
      max_items: 10,
      include_graph_governance: true
    }
  });
  assert.equal(governanceRun.statusCode, 200, "knowledge governance run failed");
  const governanceRunBody = governanceRun.json();
  assert.ok(governanceRunBody.job_id, "knowledge governance run job id missing");
  assert.ok(governanceRunBody.created_fact_ids.length >= 1, "knowledge governance should create at least one fact");
  assert.ok(governanceRunBody.created_document_ids.length >= 1, "knowledge governance should create document");
  assert.ok(governanceRunBody.created_section_ids.length >= 1, "knowledge governance should create section");
  assert.ok(governanceRunBody.created_evidence_ids.length >= 1, "knowledge governance should create evidence");
  assert.ok(governanceRunBody.created_relation_ids.length >= 1, "knowledge governance should create relation");
  assert.ok(governanceRunBody.governance_decision_ids.length >= 1, "knowledge governance should create governance decisions");
  assert.ok(Array.isArray(governanceRunBody.cleaning_log_ids), "knowledge governance should return cleaning log ids");
  assert.ok(Array.isArray(governanceRunBody.synthesized_knowledge_ids), "knowledge governance should return synthesized knowledge ids");
  assert.ok(governanceRunBody.recall_surface_state_ids.length >= 1, "knowledge governance should create recall surface states");
  assert.ok(governanceRunBody.context_bundle_id, "knowledge governance should create context bundle");

  const documents = await app.inject({
    method: "GET",
    url: "/internal/knowledge/documents",
    headers: buildHeaders("knowledge-documents")
  });
  assert.equal(documents.statusCode, 200, "knowledge documents list failed");
  assert.ok(
    Array.isArray(documents.json().items) &&
      documents.json().items.some((item) => item.id === documentIngestBody.document_id),
    "knowledge documents list should include ingested document"
  );

  const jobGet = await app.inject({
    method: "GET",
    url: `/internal/knowledge/governance/jobs/${governanceRunBody.job_id}`,
    headers: buildHeaders("knowledge-job-get")
  });
  assert.equal(jobGet.statusCode, 200, "knowledge governance job fetch failed");
  const jobGetBody = jobGet.json();
  assert.equal(jobGetBody.status, "completed", "knowledge governance job should complete");

  const reviewQueue = await app.inject({
    method: "GET",
    url: "/internal/knowledge/review-queue",
    headers: buildHeaders("knowledge-review")
  });
  assert.equal(reviewQueue.statusCode, 200, "knowledge review queue fetch failed");
  const reviewQueueBody = reviewQueue.json();
  assert.ok(Array.isArray(reviewQueueBody.items), "review queue items missing");

  const reviewItem = reviewQueueBody.items.find((item) => governanceRunBody.review_queue_item_ids.includes(item.id));
  assert.ok(reviewItem, "expected smoke fact review item");

  const reviewAction = await app.inject({
    method: "POST",
    url: `/internal/knowledge/review-queue/${reviewItem.id}/actions`,
    headers: buildHeaders("knowledge-review-action"),
    payload: {
      action: "approve",
      payload: {
        approved_by: "verify-knowledge-platform"
      }
    }
  });
  assert.equal(reviewAction.statusCode, 200, "knowledge review action failed");

  const bundle = await app.inject({
    method: "GET",
    url: `/internal/knowledge/context-bundles/${governanceRunBody.context_bundle_id}`,
    headers: buildHeaders("knowledge-bundle")
  });
  assert.equal(bundle.statusCode, 200, "knowledge context bundle fetch failed");
  const bundleBody = bundle.json();
  assert.ok(Array.isArray(bundleBody.facts), "context bundle facts missing");
  assert.ok(Array.isArray(bundleBody.section_refs) && bundleBody.section_refs.length >= 1, "context bundle sections missing");

  const retrieve = await app.inject({
    method: "POST",
    url: "/internal/knowledge/retrieve",
    headers: buildHeaders("knowledge-retrieve"),
    payload: {
      task_request_id: taskRequestId,
      query: "knowledge platform smoke constraint",
      intent_type: "fact_lookup",
      top_k: 10,
      require_evidence: true,
      include_factual: true,
      include_procedural: true,
      fingerprint: "local-dev-v1",
      fingerprint_status: "matched"
    }
  });
  assert.equal(retrieve.statusCode, 200, "knowledge retrieve failed");
  const retrieveBody = retrieve.json();
  assert.ok(Array.isArray(retrieveBody.facts), "knowledge retrieve facts field should be an array");
  assert.ok(Array.isArray(retrieveBody.derived_knowledge), "knowledge retrieve should include derived_knowledge list");
  assert.ok(Array.isArray(retrieveBody.evidence_trace), "knowledge retrieve should include evidence_trace list");
  assert.deepEqual(retrieveBody.entities, [], "knowledge retrieve should not expose intermediate entities by default");
  assert.deepEqual(retrieveBody.relations, [], "knowledge retrieve should not expose intermediate relations by default");
  assert.ok(Array.isArray(retrieveBody.evidence_refs), "knowledge retrieve evidence_refs field should be an array");
  assert.ok(Array.isArray(retrieveBody.section_refs) && retrieveBody.section_refs.length >= 1, "knowledge retrieve should return sections");

  let derivedKnowledgeId = randomUUID();
  const derivedEvidenceLinkId = randomUUID();
  const derivedTitle = "Derived knowledge default recall object";
  const derivedContent = [
    "# Derived knowledge default recall object",
    "",
    "## Rule",
    "",
    "Evidence-backed atomic facts should remain provenance objects, while active derived knowledge should be the default recall object.",
    "",
    "## Boundary",
    "",
    "Atomic facts and source sections are expanded only when trace detail is requested or when a governance review needs evidence."
  ].join("\n");
  const derivedInsert = await pool.query(
    `
    INSERT INTO kp_synthesized_knowledge (
      id, tenant_id, scope, status, version, memory_domain, lifecycle_state, review_state,
      recall_state, knowledge_type, title, content, normalized_content, source_object_ids,
      evidence_ids, reasoning_summary, confidence_score, risk_level, governance_job_id,
      metadata, trace_id
    )
    VALUES (
      $1, $2, $3, 'active', 1, 'knowledge', 'curated', 'model_accepted',
      'active', 'derived_rule', $4, $5, $6, $7::jsonb,
      $8::jsonb, 'verify inserted active derived knowledge for retrieval contract', 0.9100, 'low', $9,
      '{"verify":true}'::jsonb, 'verify-knowledge-platform'
    )
    ON CONFLICT (tenant_id, scope, knowledge_type, normalized_content)
    DO UPDATE SET
      status = 'active',
      lifecycle_state = 'curated',
      review_state = 'model_accepted',
      recall_state = 'active',
      evidence_ids = EXCLUDED.evidence_ids,
      source_object_ids = EXCLUDED.source_object_ids,
      governance_job_id = EXCLUDED.governance_job_id,
      updated_at = now()
    RETURNING id
    `,
    [
      derivedKnowledgeId,
      tenantId,
      scope,
      derivedTitle,
      derivedContent,
      derivedContent.toLowerCase().replace(/\s+/g, " "),
      JSON.stringify([governanceRunBody.created_fact_ids[0]]),
      JSON.stringify([governanceRunBody.created_evidence_ids[0]]),
      governanceRunBody.job_id
    ]
  );
  derivedKnowledgeId = derivedInsert.rows[0].id;
  await pool.query(
    `
    DELETE FROM kp_synthesized_knowledge_evidence
    WHERE tenant_id = $1
      AND scope = $2
      AND synthesized_knowledge_id = $3
      AND evidence_id = $4
    `,
    [tenantId, scope, derivedKnowledgeId, governanceRunBody.created_evidence_ids[0]]
  );
  await pool.query(
    `
    INSERT INTO kp_synthesized_knowledge_evidence (
      id, tenant_id, scope, status, synthesized_knowledge_id, evidence_id,
      source_object_type, source_object_id, support_role, trace_id
    )
    VALUES ($1, $2, $3, 'active', $4, $5, 'evidence', $5, 'supports', 'verify-knowledge-platform')
    `,
    [derivedEvidenceLinkId, tenantId, scope, derivedKnowledgeId, governanceRunBody.created_evidence_ids[0]]
  );

  const derivedRetrieve = await app.inject({
    method: "POST",
    url: "/internal/knowledge/retrieve",
    headers: buildHeaders("knowledge-derived-retrieve"),
    payload: {
      task_request_id: taskRequestId,
      query: "derived knowledge default recall object",
      intent_type: "fact_lookup",
      top_k: 5,
      require_evidence: true,
      include_trace: false,
      fingerprint: "local-dev-v1",
      fingerprint_status: "matched"
    }
  });
  assert.equal(derivedRetrieve.statusCode, 200, "derived knowledge retrieve failed");
  const derivedRetrieveBody = derivedRetrieve.json();
  assert.ok(
    Array.isArray(derivedRetrieveBody.derived_knowledge) &&
      derivedRetrieveBody.derived_knowledge.some((item) => item.id === derivedKnowledgeId),
    "knowledge retrieve should prioritize active derived knowledge"
  );
  assert.ok(
    Array.isArray(derivedRetrieveBody.evidence_trace) &&
      derivedRetrieveBody.evidence_trace.some((item) => item.derived_knowledge_id === derivedKnowledgeId),
    "derived knowledge retrieve should return evidence trace"
  );
  assert.ok(
    derivedRetrieveBody.facts.every((item) => item.source !== "knowledge"),
    "atomic knowledge facts should not be exposed as primary facts when derived knowledge is available and include_trace=false"
  );

  const graphEntities = await app.inject({
    method: "GET",
    url: "/internal/knowledge/graph/entities",
    headers: buildHeaders("knowledge-graph-entities")
  });
  assert.equal(graphEntities.statusCode, 200, "knowledge graph entities failed");
  assert.ok(Array.isArray(graphEntities.json().items) && graphEntities.json().items.length >= 1, "knowledge graph entities should return data");

  const graphFacts = await app.inject({
    method: "GET",
    url: "/internal/knowledge/graph/facts",
    headers: buildHeaders("knowledge-graph-facts")
  });
  assert.equal(graphFacts.statusCode, 200, "knowledge graph facts failed");
  assert.ok(Array.isArray(graphFacts.json().items) && graphFacts.json().items.length >= 1, "knowledge graph facts should return data");

  const graphRelations = await app.inject({
    method: "GET",
    url: "/internal/knowledge/graph/relations",
    headers: buildHeaders("knowledge-graph-relations")
  });
  assert.equal(graphRelations.statusCode, 200, "knowledge graph relations failed");
  assert.ok(Array.isArray(graphRelations.json().items) && graphRelations.json().items.length >= 1, "knowledge graph relations should return data");

  const governanceRuns = await app.inject({
    method: "GET",
    url: "/internal/knowledge/governance/runs",
    headers: buildHeaders("knowledge-governance-runs")
  });
  assert.equal(governanceRuns.statusCode, 200, "knowledge governance runs failed");
  assert.ok(Array.isArray(governanceRuns.json().items) && governanceRuns.json().items.length >= 1, "knowledge governance runs should return data");

  const governanceRunDetail = await app.inject({
    method: "GET",
    url: `/internal/knowledge/governance/runs/${governanceRunBody.job_id}`,
    headers: buildHeaders("knowledge-governance-run-detail")
  });
  assert.equal(governanceRunDetail.statusCode, 200, "knowledge governance run detail failed");
  const governanceRunDetailBody = governanceRunDetail.json();
  assert.ok(Array.isArray(governanceRunDetailBody.decisions) && governanceRunDetailBody.decisions.length >= 1, "governance run detail should include decisions");
  assert.ok(Array.isArray(governanceRunDetailBody.cleaning_logs), "governance run detail should include cleaning log list");
  assert.ok(Array.isArray(governanceRunDetailBody.synthesized_knowledge), "governance run detail should include synthesized knowledge list");
  assert.ok(
    Array.isArray(governanceRunDetailBody.recall_surface_states) && governanceRunDetailBody.recall_surface_states.length >= 1,
    "governance run detail should include recall surface states"
  );

  const synthesizedKnowledge = await app.inject({
    method: "GET",
    url: "/internal/knowledge/synthesized-knowledge",
    headers: buildHeaders("knowledge-synthesized-knowledge")
  });
  assert.equal(synthesizedKnowledge.statusCode, 200, "synthesized knowledge list failed");
  assert.ok(Array.isArray(synthesizedKnowledge.json().items), "synthesized knowledge list should return a list");

  const recallSurface = await app.inject({
    method: "GET",
    url: "/internal/knowledge/recall-surface",
    headers: buildHeaders("knowledge-recall-surface")
  });
  assert.equal(recallSurface.statusCode, 200, "recall surface state list failed");
  assert.ok(Array.isArray(recallSurface.json().items) && recallSurface.json().items.length >= 1, "recall surface state list should return data");

  const opsOverview = await app.inject({
    method: "GET",
    url: "/internal/knowledge/ops/overview",
    headers: buildHeaders("knowledge-ops-overview")
  });
  assert.equal(opsOverview.statusCode, 200, "knowledge ops overview failed");
  const opsBody = opsOverview.json();
  assert.ok(opsBody.document_count >= 1, "ops overview document_count should be >= 1");
  assert.ok(opsBody.section_count >= 1, "ops overview section_count should be >= 1");
  assert.ok(opsBody.corpus_governance, "ops overview should include corpus governance stats");
  assert.ok(
    opsBody.corpus_governance.total_document_count >= opsBody.corpus_governance.active_document_count,
    "corpus governance total documents should be >= active documents"
  );
  assert.ok(
    opsBody.corpus_governance.active_full_markdown_document_count >= 1,
    "corpus governance should count active full markdown documents"
  );
  assert.equal(
    opsBody.corpus_governance.active_duplicate_markdown_hash_count,
    0,
    "verify tenant should not contain active duplicate markdown documents"
  );
  assert.equal(
    opsBody.corpus_governance.active_duplicate_canonical_source_uri_count,
    0,
    "verify tenant should not contain active duplicate source URLs"
  );

  const rowCheck = await pool.query(
    `
    SELECT
      (SELECT COUNT(*)::int FROM kp_document WHERE tenant_id = $1 AND scope = $2) AS document_count,
      (SELECT COUNT(*)::int FROM kp_section WHERE tenant_id = $1 AND scope = $2) AS section_count,
      (SELECT COUNT(*)::int FROM kp_fact WHERE tenant_id = $1 AND scope = $2) AS fact_count,
      (SELECT COUNT(*)::int FROM kp_entity WHERE tenant_id = $1 AND scope = $2) AS entity_count,
      (SELECT COUNT(*)::int FROM kp_evidence WHERE tenant_id = $1 AND scope = $2) AS evidence_count,
      (SELECT COUNT(*)::int FROM kp_relation WHERE tenant_id = $1 AND scope = $2) AS relation_count,
      (SELECT COUNT(*)::int FROM kp_governance_job WHERE tenant_id = $1 AND scope = $2) AS job_count,
      (SELECT COUNT(*)::int FROM kp_governance_decision WHERE tenant_id = $1 AND scope = $2) AS decision_count,
      (SELECT COUNT(*)::int FROM kp_governance_cleaning_log WHERE tenant_id = $1 AND scope = $2) AS cleaning_log_count,
      (SELECT COUNT(*)::int FROM kp_synthesized_knowledge WHERE tenant_id = $1 AND scope = $2) AS synthesized_count,
      (SELECT COUNT(*)::int FROM kp_recall_surface_state WHERE tenant_id = $1 AND scope = $2) AS recall_state_count
    `,
    [tenantId, scope]
  );
  assert.ok(rowCheck.rows[0].document_count >= 1, "kp_document should contain rows");
  assert.ok(rowCheck.rows[0].section_count >= 1, "kp_section should contain rows");
  assert.ok(rowCheck.rows[0].fact_count >= 1, "kp_fact should contain rows");
  assert.ok(rowCheck.rows[0].entity_count >= 1, "kp_entity should contain rows");
  assert.ok(rowCheck.rows[0].evidence_count >= 1, "kp_evidence should contain rows");
  assert.ok(rowCheck.rows[0].relation_count >= 1, "kp_relation should contain rows");
  assert.ok(rowCheck.rows[0].job_count >= 1, "kp_governance_job should contain rows");
  assert.ok(rowCheck.rows[0].decision_count >= 1, "kp_governance_decision should contain rows");
  assert.ok(rowCheck.rows[0].cleaning_log_count >= 1, "kp_governance_cleaning_log should contain rows");
  assert.ok(rowCheck.rows[0].synthesized_count >= 0, "kp_synthesized_knowledge count should be queryable");
  assert.ok(rowCheck.rows[0].recall_state_count >= 1, "kp_recall_surface_state should contain rows");

  const purgeGovernance = await app.inject({
    method: "POST",
    url: "/internal/knowledge/governance/run",
    headers: buildHeaders("knowledge-purge-intermediate-artifacts"),
    payload: {
      task_request_id: taskRequestId,
      task_step_id: taskStepId,
      run_modes: ["purge_intermediate_artifacts"],
      max_items: 1,
      include_graph_governance: false
    }
  });
  assert.equal(purgeGovernance.statusCode, 200, `knowledge intermediate artifact purge governance failed: ${purgeGovernance.body}`);
  const purgeGovernanceBody = purgeGovernance.json();
  assert.ok(purgeGovernanceBody.intermediate_artifact_purge, "purge governance should return purge stats");

  const purgedRowCheck = await pool.query(
    `
    SELECT
      (SELECT COUNT(*)::int FROM kp_fact WHERE tenant_id = $1 AND scope = $2) AS fact_count,
      (SELECT COUNT(*)::int FROM kp_entity WHERE tenant_id = $1 AND scope = $2) AS entity_count,
      (SELECT COUNT(*)::int FROM kp_relation WHERE tenant_id = $1 AND scope = $2) AS relation_count,
      (SELECT COUNT(*)::int FROM kp_recall_surface_state WHERE tenant_id = $1 AND scope = $2 AND object_type IN ('fact', 'entity', 'relation')) AS intermediate_recall_count,
      (SELECT COUNT(*)::int FROM kp_evidence WHERE tenant_id = $1 AND scope = $2) AS evidence_count,
      (SELECT COUNT(*)::int FROM kp_synthesized_knowledge WHERE tenant_id = $1 AND scope = $2) AS synthesized_count,
      (SELECT COUNT(*)::int FROM kp_synthesized_knowledge_evidence WHERE tenant_id = $1 AND scope = $2 AND source_object_type <> 'evidence') AS non_evidence_source_count
    `,
    [tenantId, scope]
  );
  assert.equal(purgedRowCheck.rows[0].fact_count, 0, "facts should be purged after derived knowledge is materialized");
  assert.equal(purgedRowCheck.rows[0].entity_count, 0, "entities should be purged after derived knowledge is materialized");
  assert.equal(purgedRowCheck.rows[0].relation_count, 0, "relations should be purged after derived knowledge is materialized");
  assert.equal(purgedRowCheck.rows[0].intermediate_recall_count, 0, "intermediate artifacts should not remain on recall surface");
  assert.ok(purgedRowCheck.rows[0].evidence_count >= 1, "evidence should remain after intermediate purge");
  assert.ok(purgedRowCheck.rows[0].synthesized_count >= 1, "synthesized knowledge should remain after intermediate purge");
  assert.equal(
    purgedRowCheck.rows[0].non_evidence_source_count,
    0,
    "synthesized knowledge evidence links should point to evidence after intermediate purge"
  );

  console.log("knowledge platform verification passed");
} finally {
  await app.close();
  await pool.end();
  await rm(tempRoot, { recursive: true, force: true });
}
