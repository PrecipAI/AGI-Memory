import assert from "node:assert/strict";
import path from "node:path";
import { getPool } from "../libs/db/dist/pool.js";
import { buildMemoryServiceApp } from "../services/memory-service/dist/services/memory-service/src/app.js";

const app = buildMemoryServiceApp();
const fixtureRoot = path.join(process.cwd(), "tests", "fixtures", "codex-capture");

try {
  await getPool().query(
    "DELETE FROM host_governance_event WHERE tenant_id = $1 AND scope = $2 AND host = $3 AND thread_id = $4",
    ["tenant-local", "memory.validation", "codex", "019df330-e9df-7ef3-90bc-7c403ef1741e"]
  );

  const response = await app.inject({
    method: "POST",
    url: "/internal/host-capture/codex/governance-run",
    payload: {
      codex_home: fixtureRoot,
      thread_id: "019df330-e9df-7ef3-90bc-7c403ef1741e",
      max_items: 8,
      task_request_id: "11111111-1111-4111-8111-111111111111"
    }
  });

  assert.equal(response.statusCode, 200, "codex governance run should succeed");
  const body = response.json();

  assert.equal(body.host, "codex");
  assert.equal(body.thread_id, "019df330-e9df-7ef3-90bc-7c403ef1741e");
  assert.ok(body.persisted.rule_ids.length >= 1, "governance run should persist at least one rule");
  assert.ok(body.persisted.memory_ids.length >= 1, "governance run should persist at least one memory");
  assert.ok(body.persisted.skill_proposal_ids.length >= 1, "governance run should record at least one skill proposal");
  assert.ok(
    body.persisted.rule_items.some(
      (item) =>
        String(item.title).includes("Governance reporting") &&
        String(item.statement).includes("不能只汇报数量") &&
        item.rule_domain === "governance" &&
        item.governance_level === "shared" &&
        item.availability_scope === "user_reusable"
    ),
    "governance run should persist distilled reporting constraints with rule domain and reusable scope"
  );
  assert.ok(
    body.persisted.memory_items.every(
      (item) => !String(item.content).toLowerCase().includes("d:\\workspace\\projects\\superagentsystem-main")
    ),
    "governance run should not promote command cwd paths to long-term memory"
  );
  assert.ok(
    body.persisted.skill_proposal_items.some(
      (item) =>
        String(item.title).includes("Governance result reporting") &&
        item.target_skill === "memory-governance-guidelines" &&
        item.change_type === "update" &&
        item.proposal_quality === "actionable" &&
        item.governance_level === "shared" &&
        item.availability_scope === "user_reusable" &&
        item.promotion_status === "needs_review" &&
        item.merged_source_count >= 1 &&
        String(item.current_gap || "").includes("无法审查") &&
        String(item.proposed_patch || "").includes("*** Update File: SKILL.md") &&
        String(item.proposed_text || "").includes("不能只汇报数量")
    ),
    "governance run should persist an actionable reporting-oriented skill update proposal"
  );
  assert.equal(
    body.persisted.synthesized_knowledge_ids.length,
    0,
    "host-capture governance run should not synthesize long-term knowledge from internal session-only guidance"
  );
  assert.equal(body.persisted.evidence_ids.length, 0, "governance run should not create knowledge evidence when no external knowledge is promoted");
  assert.ok(body.persisted.governance_evidence_bundle_id, "governance run should create a governance evidence bundle");
  assert.ok(body.persisted.context_bundle_id, "governance run should create a context bundle");
  assert.ok(body.acceptance_report, "governance run should return an acceptance report");
  assert.ok(body.acceptance_report.inputs_read.command_count >= 1, "acceptance report should expose read command inputs");
  assert.ok(
    body.acceptance_report.governance_candidates.governance_evidence_count >= 1,
    "acceptance report should expose governance evidence candidate counts"
  );
  assert.ok(
    body.acceptance_report.governance_evidence_retained.some(
      (item) =>
        item.evidence_category === "failure_reason" &&
        String(item.title).includes("Command/tool")
    ),
    "governance run should retain command/tool failures such as rg-unavailable as governance evidence"
  );
  assert.ok(
    body.acceptance_report.promoted_outputs.synthesized_knowledge_count === 0,
    "acceptance report should show zero promoted synthesized knowledge when only internal host/session guidance is present"
  );
  assert.ok(
    body.acceptance_report.incremental.new_candidate_count >= 1,
    "governance run should expose incremental new candidate count"
  );

  const duplicateResponse = await app.inject({
    method: "POST",
    url: "/internal/host-capture/codex/governance-run",
    payload: {
      codex_home: fixtureRoot,
      thread_id: "019df330-e9df-7ef3-90bc-7c403ef1741e",
      max_items: 8,
      task_request_id: "11111111-1111-4111-8111-111111111111"
    }
  });
  assert.equal(duplicateResponse.statusCode, 200, "duplicate codex governance run should still succeed");
  const duplicateBody = duplicateResponse.json();
  assert.equal(
    duplicateBody.acceptance_report.incremental.new_candidate_count,
    0,
    "duplicate governance run should not reprocess previously governed candidate events"
  );
  assert.ok(
    duplicateBody.acceptance_report.incremental.skipped_previously_governed_count >= body.acceptance_report.incremental.new_candidate_count,
    "duplicate governance run should report skipped previously governed events"
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        thread_id: body.thread_id,
        governance_job_id: body.governance_job_id,
        persisted: body.persisted,
        acceptance_report: body.acceptance_report,
        warnings: body.warnings
      },
      null,
      2
    )}\n`
  );
} finally {
  await app.close();
}
