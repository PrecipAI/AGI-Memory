import assert from "node:assert/strict";
import path from "node:path";
import { getPool } from "../../libs/db/dist/pool.js";
import { buildMemoryServiceApp } from "../../services/memory-service/dist/services/memory-service/src/app.js";

const app = buildMemoryServiceApp();
const fixtureRoot = path.join(process.cwd(), "tests", "fixtures", "codex-capture");
const threadId = "019df330-e9df-7ef3-90bc-7c403ef1741e";
const tenantId = "tenant-local";
const scope = "memory.validation";
const traceId = "p0-host-model-fallback-chain-trace";

async function cleanup() {
  const pool = getPool();
  await pool.query(
    "DELETE FROM host_governance_event WHERE tenant_id = $1 AND scope = $2 AND thread_id = $3",
    [tenantId, scope, threadId]
  );
  await pool.query(
    `DELETE FROM kp_synthesized_knowledge
     WHERE tenant_id = $1 AND scope = $2
       AND metadata->>'source_session_file' LIKE $3`,
    [tenantId, scope, `%${threadId}%`]
  );
  await pool.query(
    `DELETE FROM rule
     WHERE tenant_id = $1 AND scope = $2
       AND trigger_conditions->>'thread_id' = $3`,
    [tenantId, scope, threadId]
  );
  await pool.query(
    `DELETE FROM memory
     WHERE tenant_id = $1 AND scope = $2
       AND metadata->>'thread_id' = $3`,
    [tenantId, scope, threadId]
  );
  await pool.query(
    `DELETE FROM governance_change_proposal
     WHERE tenant_id = $1 AND scope = $2
       AND proposed_payload->>'thread_id' = $3`,
    [tenantId, scope, threadId]
  );
}

try {
  await cleanup();

  const previewResponse = await app.inject({
    method: "POST",
    url: "/internal/host-capture/codex/preview",
    headers: {
      "x-tenant-id": tenantId,
      "x-scope": scope,
      "x-trace-id": traceId
    },
    payload: {
      codex_home: fixtureRoot,
      thread_id: threadId,
      max_items: 8
    }
  });
  assert.equal(previewResponse.statusCode, 200, previewResponse.body);

  // P0-c combination chain: omit both governance_mode and host_model_result.
  // Default mode is host_model, but since the host did not provide a model result,
  // the pipeline must loudly fall back to rules_fallback and quarantine every candidate.
  const runResponse = await app.inject({
    method: "POST",
    url: "/internal/host-capture/codex/governance-run",
    headers: {
      "x-tenant-id": tenantId,
      "x-scope": scope,
      "x-trace-id": traceId
    },
    payload: {
      codex_home: fixtureRoot,
      thread_id: threadId,
      max_items: 8
      // governance_mode intentionally omitted.
      // host_model_result intentionally omitted.
    }
  });

  assert.equal(runResponse.statusCode, 200, runResponse.body);
  const body = runResponse.json();

  assert.equal(body.acceptance_report.governance_model.mode, "rules_fallback", "must fall back to rules_fallback");
  assert.equal(body.acceptance_report.governance_model.accepted, false, "must report accepted=false");
  assert.ok(
    body.warnings.some((w) => w.includes("host_model_result.extraction_preview is missing")),
    "must emit loud fallback warning"
  );

  // Nothing from this fallback path may reach active recall.
  for (const item of body.persisted.rule_items) {
    assert.equal(item.promotion_status, "needs_review", "fallback rule must be needs_review");
  }
  for (const item of body.persisted.memory_items) {
    assert.equal(item.promotion_status, "needs_review", "fallback memory must be needs_review");
  }
  for (const item of body.persisted.skill_proposal_items) {
    assert.equal(item.promotion_status, "needs_review", "fallback skill proposal must be needs_review");
  }
  for (const item of body.persisted.knowledge_items) {
    assert.fail("fallback knowledge must not be promoted");
  }

  const pool = getPool();
  const ruleIds = body.persisted.rule_ids;
  const memoryIds = body.persisted.memory_ids;
  const knowledgeIds = body.persisted.synthesized_knowledge_ids;
  const proposalIds = body.persisted.skill_proposal_ids;

  if (ruleIds.length > 0) {
    const ruleRows = await pool.query(
      `SELECT id, status FROM rule WHERE tenant_id = $1 AND scope = $2 AND id = ANY($3::uuid[])`,
      [tenantId, scope, ruleIds]
    );
    for (const row of ruleRows.rows) {
      assert.equal(row.status, "parked", `fallback rule ${row.id} must be parked`);
    }
  }
  if (memoryIds.length > 0) {
    const memoryRows = await pool.query(
      `SELECT id, status FROM memory WHERE tenant_id = $1 AND scope = $2 AND id = ANY($3::uuid[])`,
      [tenantId, scope, memoryIds]
    );
    for (const row of memoryRows.rows) {
      assert.equal(row.status, "parked", `fallback memory ${row.id} must be parked`);
    }
  }
  if (proposalIds.length > 0) {
    const proposalRows = await pool.query(
      `SELECT id, status FROM governance_change_proposal WHERE tenant_id = $1 AND scope = $2 AND id = ANY($3::uuid[])`,
      [tenantId, scope, proposalIds]
    );
    for (const row of proposalRows.rows) {
      assert.equal(row.status, "parked", `fallback skill proposal ${row.id} must be parked`);
    }
  }
  if (knowledgeIds.length > 0) {
    const knowledgeRows = await pool.query(
      `SELECT id, recall_state FROM kp_synthesized_knowledge WHERE tenant_id = $1 AND scope = $2 AND id = ANY($3::uuid[])`,
      [tenantId, scope, knowledgeIds]
    );
    for (const row of knowledgeRows.rows) {
      assert.equal(row.recall_state, "audit_only", `fallback knowledge ${row.id} must be audit_only`);
    }
  }

  console.log("\n✅ P0-c host_model fallback chain verification passed.");
} finally {
  await cleanup();
  await app.close();
  await getPool().end();
}
