import assert from "node:assert/strict";
import path from "node:path";
import { buildMemoryServiceApp } from "../services/memory-service/dist/services/memory-service/src/app.js";

const app = buildMemoryServiceApp();
const fixtureRoot = path.join(process.cwd(), "tests", "fixtures", "codex-capture");

try {
  const response = await app.inject({
    method: "POST",
    url: "/internal/host-capture/codex/governance-batch-preview",
    payload: {
      codex_home: fixtureRoot,
      thread_id: "019df330-e9df-7ef3-90bc-7c403ef1741e",
      max_items: 5
    }
  });

  assert.equal(response.statusCode, 200, "codex governance batch preview should succeed");
  const body = response.json();

  assert.equal(body.ingestion_readiness.status, "ready");
  assert.ok(body.raw_inputs.user_messages.length >= 2, "batch preview should keep raw user messages");
  assert.ok(body.raw_inputs.commands.length >= 1, "batch preview should keep raw command events");
  assert.ok(body.raw_inputs.mcp_calls.length >= 2, "batch preview should keep MCP calls");

  assert.ok(
    body.extraction_preview.rule_candidates.some((item) => String(item.reason).includes("hard constraint")),
    "batch preview should infer at least one rule candidate"
  );
  assert.ok(
    body.extraction_preview.rule_candidates.some(
      (item) =>
        String(item.title).includes("Governance reporting") &&
        String(item.content || "").includes("不能只汇报数量") &&
        item.rule_domain === "governance" &&
        item.governance_level === "shared" &&
        item.availability_scope === "user_reusable"
    ),
    "batch preview should distill governance reporting requirements into a concrete rule statement"
  );
  assert.ok(
    body.extraction_preview.memory_candidates.some(
      (item) =>
        (String(item.title).includes("Machine-specific") || String(item.title).includes("Workspace") || String(item.title).includes("Project path")) &&
        ["workspace_reusable", "project_reusable"].includes(item.availability_scope)
    ),
    "batch preview should infer memory candidates from stable environment/workspace context"
  );
  assert.ok(
    body.extraction_preview.skill_proposal_candidates.some(
      (item) =>
        String(item.title).includes("Governance input scope") &&
        item.target_skill === "memory-governance-guidelines" &&
        item.change_type === "update" &&
        item.proposal_quality === "actionable" &&
        item.governance_level === "shared" &&
        item.availability_scope === "user_reusable" &&
        item.promotion_status === "needs_review" &&
        String(item.proposed_patch || "").includes("*** Update File: SKILL.md") &&
        String(item.proposed_text || "").includes("完整会话记录")
    ),
    "batch preview should infer actionable skill proposal candidates with target skill, change type, and proposed text"
  );
  assert.ok(
    body.extraction_preview.skill_proposal_candidates.some(
      (item) =>
        String(item.title).includes("Governance result reporting") &&
        item.target_skill === "memory-governance-guidelines" &&
        item.merged_source_count >= 1 &&
        String(item.current_gap || "").includes("无法审查") &&
        String(item.proposed_patch || "").includes("治理结果汇报") &&
        String(item.proposed_text || "").includes("不能只汇报数量")
    ),
    "batch preview should distill reporting-related feedback into a concrete skill file change proposal"
  );
  assert.equal(
    body.extraction_preview.knowledge_candidates.length,
    0,
    "host-capture governance batch should not infer long-term knowledge from internal session-only guidance"
  );
  assert.ok(
    body.extraction_preview.governance_evidence_candidates.some(
      (item) =>
        String(item.title).includes("Execution step evidence") ||
        String(item.title).includes("Verification step evidence") ||
        String(item.title).includes("MCP execution evidence")
    ),
    "batch preview should collect governance-only evidence candidates from non-conversation task traces"
  );
  assert.ok(
    body.extraction_preview.governance_evidence_candidates.some(
      (item) => item.evidence_category === "verification_evidence" || item.evidence_category === "mcp_execution"
    ),
    "batch preview should classify governance evidence candidates into structured evidence categories"
  );
  assert.ok(
    body.extraction_preview.governance_evidence_candidates.some(
      (item) =>
        item.evidence_category === "failure_reason" &&
        String(item.title).includes("Command/tool")
    ),
    "batch preview should retain command/tool failures such as rg-unavailable as governance failure evidence"
  );

  process.stdout.write(
      `${JSON.stringify(
      {
        thread_id: body.thread_id,
        ingestion_readiness: body.ingestion_readiness,
        candidate_counts: {
          rule: body.extraction_preview.rule_candidates.length,
          memory: body.extraction_preview.memory_candidates.length,
          skill_proposal: body.extraction_preview.skill_proposal_candidates.length,
          knowledge: body.extraction_preview.knowledge_candidates.length,
          governance_evidence: body.extraction_preview.governance_evidence_candidates.length
        }
      },
      null,
      2
    )}\n`
  );
} finally {
  await app.close();
}
