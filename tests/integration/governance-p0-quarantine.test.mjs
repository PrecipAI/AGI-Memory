import assert from "node:assert/strict";
import { buildMemoryServiceApp } from "../../services/memory-service/dist/services/memory-service/src/app.js";
import { getPool } from "../../libs/db/dist/pool.js";

const app = buildMemoryServiceApp();
const tenantId = "tenant-local";
const scope = "memory.validation";
const traceId = "p0-verify-trace";

async function cleanup() {
  const pool = getPool();
  await pool.query(
    `DELETE FROM kp_synthesized_knowledge WHERE tenant_id = $1 AND scope = $2`,
    [tenantId, scope]
  );
  await pool.query(
    `DELETE FROM kp_governance_job WHERE tenant_id = $1 AND scope = $2`,
    [tenantId, scope]
  );
  await pool.query(
    `DELETE FROM kp_synthesized_knowledge_evidence WHERE tenant_id = $1 AND scope = $2`,
    [tenantId, scope]
  );
  await pool.query(
    `DELETE FROM kp_evidence WHERE tenant_id = $1 AND scope = $2`,
    [tenantId, scope]
  );
  await pool.query(
    `DELETE FROM kp_context_bundle WHERE tenant_id = $1 AND scope = $2`,
    [tenantId, scope]
  );
}

async function runRulesFallback() {
  const payload = {
    extraction_preview: {
      rule_candidates: [],
      memory_candidates: [],
      skill_proposal_candidates: [],
      knowledge_candidates: [
        {
          candidate_type: "knowledge_candidate",
          title: "P0-a fallback quarantine test knowledge",
          origin_scope: "project",
          availability_scope: "project_reusable",
          governance_level: "shared",
          promotion_status: "active",
          knowledge_type: "execution_derived_knowledge",
          source_kind: "assistant_message",
          source_timestamp: "2026-06-22T10:00:00.000Z",
          content: "This knowledge should be quarantined because it comes from rules_fallback path.",
          source_excerpt: "This knowledge should be quarantined because it comes from rules_fallback path.",
          reason: "Testing P0-a fallback quarantine.",
          confidence: "high"
        }
      ],
      governance_evidence_candidates: []
    },
    host: "generic",
    governance_mode: "rules_fallback",
    fingerprint: null
  };

  const response = await app.inject({
    method: "POST",
    url: "/internal/governance/run-from-extraction",
    headers: {
      "x-tenant-id": tenantId,
      "x-scope": scope,
      "x-trace-id": traceId
    },
    payload
  });

  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.equal(body.acceptance_report.governance_model.mode, "rules_fallback");
  assert.ok(body.warnings.some((w) => w.includes("rules_fallback")), "should emit loud fallback warning");
  assert.equal(body.persisted.synthesized_knowledge_ids.length, 1);

  const knowledgeId = body.persisted.synthesized_knowledge_ids[0];
  const pool = getPool();
  const res = await pool.query(
    `SELECT lifecycle_state, review_state, recall_state, knowledge_type, confidence_score, metadata
     FROM kp_synthesized_knowledge
     WHERE id = $1`,
    [knowledgeId]
  );
  assert.equal(res.rows.length, 1);
  const row = res.rows[0];
  console.log("rules_fallback knowledge row:", JSON.stringify(row, null, 2));
  assert.equal(row.lifecycle_state, "pending_review", "fallback knowledge must be pending_review");
  assert.equal(row.review_state, "pending_review", "fallback knowledge review_state must be pending_review");
  assert.equal(row.recall_state, "audit_only", "fallback knowledge recall_state must be audit_only");
  assert.notEqual(row.knowledge_type, "execution_derived_knowledge", "invalid type must be normalized");
  assert.equal(row.metadata.governance_mode, "rules_fallback", "metadata must record governance_mode");
}

async function runHostModel() {
  const payload = {
    extraction_preview: {
      rule_candidates: [],
      memory_candidates: [],
      skill_proposal_candidates: [],
      knowledge_candidates: [
        {
          candidate_type: "knowledge_candidate",
          title: "P0-b host_model valid type test knowledge",
          origin_scope: "project",
          availability_scope: "project_reusable",
          governance_level: "shared",
          promotion_status: "active",
          knowledge_type: "pattern",
          source_kind: "assistant_message",
          source_timestamp: "2026-06-22T10:00:00.000Z",
          content: "Zod catchall schemas silently strip undeclared nested fields during JSON-RPC serialization.",
          source_excerpt: "Zod catchall schemas silently strip undeclared nested fields during JSON-RPC serialization.",
          reason: "Testing P0-b valid knowledge_type.",
          confidence: "high"
        }
      ],
      governance_evidence_candidates: []
    },
    host: "generic",
    governance_mode: "host_model",
    fingerprint: null
  };

  const response = await app.inject({
    method: "POST",
    url: "/internal/governance/run-from-extraction",
    headers: {
      "x-tenant-id": tenantId,
      "x-scope": scope,
      "x-trace-id": traceId
    },
    payload
  });

  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.equal(body.acceptance_report.governance_model.mode, "host_model");
  assert.equal(body.persisted.synthesized_knowledge_ids.length, 1);

  const knowledgeId = body.persisted.synthesized_knowledge_ids[0];
  const pool = getPool();
  const res = await pool.query(
    `SELECT lifecycle_state, review_state, recall_state, knowledge_type, metadata
     FROM kp_synthesized_knowledge
     WHERE id = $1`,
    [knowledgeId]
  );
  assert.equal(res.rows.length, 1);
  const row = res.rows[0];
  console.log("host_model knowledge row:", JSON.stringify(row, null, 2));
  assert.equal(row.lifecycle_state, "curated", "host_model valid knowledge can be curated");
  assert.equal(row.review_state, "model_accepted", "host_model valid knowledge can be model_accepted");
  assert.equal(row.recall_state, "active", "host_model valid knowledge can be active");
  assert.equal(row.knowledge_type, "pattern", "valid type preserved");
  assert.equal(row.metadata.governance_mode, "host_model", "metadata must record governance_mode");
}

async function runHostModelInvalidType() {
  const payload = {
    extraction_preview: {
      rule_candidates: [],
      memory_candidates: [],
      skill_proposal_candidates: [],
      knowledge_candidates: [
        {
          candidate_type: "knowledge_candidate",
          title: "P0-b invalid type test knowledge",
          origin_scope: "project",
          availability_scope: "project_reusable",
          governance_level: "shared",
          promotion_status: "active",
          knowledge_type: "execution_derived_knowledge",
          source_kind: "assistant_message",
          source_timestamp: "2026-06-22T10:00:00.000Z",
          content: "This should be quarantined due to invalid knowledge_type even in host_model.",
          source_excerpt: "This should be quarantined due to invalid knowledge_type even in host_model.",
          reason: "Testing P0-b invalid type quarantine.",
          confidence: "high"
        }
      ],
      governance_evidence_candidates: []
    },
    host: "generic",
    governance_mode: "host_model",
    fingerprint: null
  };

  const response = await app.inject({
    method: "POST",
    url: "/internal/governance/run-from-extraction",
    headers: {
      "x-tenant-id": tenantId,
      "x-scope": scope,
      "x-trace-id": traceId
    },
    payload
  });

  // P0-b: host_model is the strict path; schema-invalid knowledge_type is rejected outright.
  assert.equal(response.statusCode, 400, response.body);
  assert.ok(response.body.includes("execution_derived_knowledge"), "error must name the invalid type");
  assert.ok(
    response.body.includes("external_fact") || response.body.includes("pattern") || response.body.includes("synthesis"),
    "error must list valid types"
  );
}

try {
  await cleanup();
  await runRulesFallback();
  await runHostModel();
  await runHostModelInvalidType();
  console.log("\n✅ All P0-a/P0-b/P0-c verification passed.");
} finally {
  await cleanup();
  await getPool().end();
}
