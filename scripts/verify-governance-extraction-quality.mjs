import assert from "node:assert/strict";
import path from "node:path";
import { buildMemoryServiceApp } from "../services/memory-service/dist/services/memory-service/src/app.js";

const app = buildMemoryServiceApp();
const fixtureRoot = path.join(process.cwd(), "tests", "fixtures", "codex-capture");

const checks = [
  {
    name: "hard rule extraction",
    predicate: (body) =>
      body.extraction_preview.rule_candidates.some((item) =>
        String(item.content || "").includes("不能只做最小 smoke")
      )
  },
  {
    name: "reporting rule extraction",
    predicate: (body) =>
      body.extraction_preview.rule_candidates.some((item) =>
        String(item.content || "").includes("必须向用户展示具体抽取结果")
      )
  },
  {
    name: "command cwd is evidence, not long-term memory",
    predicate: (body) =>
      body.extraction_preview.memory_candidates.every(
        (item) => !String(item.content || "").toLowerCase().includes("d:\\workspace\\projects\\superagentsystem-main")
      ) &&
      body.extraction_preview.governance_evidence_candidates.some((item) =>
        String(item.source_excerpt || "").toLowerCase().includes("cwd=d:\\workspace\\projects\\superagentsystem-main")
      )
  },
  {
    name: "no internal-session knowledge pollution",
    predicate: (body) => body.extraction_preview.knowledge_candidates.length === 0
  },
  {
    name: "skill proposal actionable contract",
    predicate: (body) =>
      body.extraction_preview.skill_proposal_candidates.length > 0 &&
      body.extraction_preview.skill_proposal_candidates.every(
        (item) =>
          item.target_skill &&
          item.change_type &&
          item.current_gap &&
          item.proposed_text &&
          item.proposed_patch &&
          item.validation_method &&
          item.proposal_quality === "actionable" &&
          item.governance_level === "shared" &&
          item.availability_scope &&
          item.promotion_status
      )
  },
  {
    name: "rule domain and availability scope",
    predicate: (body) =>
      body.extraction_preview.rule_candidates.every(
        (item) =>
          item.rule_domain &&
          item.rule_scope &&
          Array.isArray(item.applies_to_phase) &&
          item.applies_to_phase.length > 0 &&
          item.violation_behavior &&
          item.governance_level &&
          item.availability_scope &&
          item.promotion_status
      )
  },
  {
    name: "memory candidates declare scoped memory type",
    predicate: (body) =>
      body.extraction_preview.memory_candidates.every(
        (item) => item.memory_type && item.stability && item.content
      )
  },
  {
    name: "session evidence is not shared",
    predicate: (body) =>
      body.extraction_preview.governance_evidence_candidates.every(
        (item) => item.governance_level === "session" && item.availability_scope === "session_only"
      )
  },
  {
    name: "governance evidence captures failed tools",
    predicate: (body) =>
      body.extraction_preview.governance_evidence_candidates.some(
        (item) => item.evidence_category === "failure_reason"
      )
  }
];

try {
  const response = await app.inject({
    method: "POST",
    url: "/internal/host-capture/codex/governance-batch-preview",
    payload: {
      codex_home: fixtureRoot,
      thread_id: "019df330-e9df-7ef3-90bc-7c403ef1741e",
      max_items: 8
    }
  });

  assert.equal(response.statusCode, 200, "governance quality preview should succeed");
  const body = response.json();
  const results = checks.map((check) => ({
    name: check.name,
    passed: Boolean(check.predicate(body))
  }));
  const passed = results.filter((item) => item.passed).length;
  const score = passed / checks.length;

  assert.equal(passed, checks.length, "all governance extraction quality checks should pass");

  process.stdout.write(
    `${JSON.stringify(
      {
        thread_id: body.thread_id,
        score,
        passed,
        total: checks.length,
        checks: results,
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
