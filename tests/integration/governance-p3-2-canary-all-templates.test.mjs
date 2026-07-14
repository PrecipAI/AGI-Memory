/**
 * P3-2 canary 模板全覆盖验证
 *
 * 对 CANARY_TEMPLATES 中每条模板，直接构造候选并走 validateCandidate 路径，
 * 验证期望行为（expect_reject / expect_error_pattern）与实际校验结果一致。
 *
 * 不依赖 canaryState（不走 maybeInjectCanary 的随机注入），
 * 而是把模板转换为正常候选（不带 is_canary），让 validateCandidate 正常校验。
 * 校验失败 → applyHostModelGovernanceResult throw → 捕获并检查错误信息。
 *
 * 运行后可删除此文件（开发验证用）。
 */

import assert from "node:assert/strict";
import { applyHostModelGovernanceResult } from "../../services/memory-service/dist/services/memory-service/src/hostModelGovernanceAdapter.js";
import { CANARY_TEMPLATES } from "../../services/memory-service/dist/services/memory-service/src/governance/canaryTemplates.js";

function makeBatchWithOneCandidate(template) {
  const arrayKeyMap = {
    rule_candidate: "rule_candidates",
    memory_candidate: "memory_candidates",
    skill_proposal_candidate: "skill_proposal_candidates",
    knowledge_candidate: "knowledge_candidates",
  };
  const arrayKey = arrayKeyMap[template.candidate_type];

  // 构造候选对象（复制 maybeInjectCanary 的构造逻辑，不带 is_canary 标记）
  const candidate = {
    candidate_type: template.candidate_type,
    title: template.title,
    content: template.content,
    source_excerpt: template.source_excerpt,
    source_kind: template.source_kind,
    source_timestamp: template.source_timestamp,
    reason: template.reason,
    confidence: template.confidence,
    origin_scope: template.origin_scope,
    availability_scope: template.availability_scope,
    governance_level: template.governance_level,
    classification_trace: template.classification_trace,
    review_trace: template.review_trace,
    self_test: template.self_test,
  };

  // rule 候选额外字段
  if (template.candidate_type === "rule_candidate") {
    if (template.enforcement_level) candidate.enforcement_level = template.enforcement_level;
    if (template.metadata) candidate.metadata = template.metadata;
    // 从 raw_inputs 构造 source_refs（rule 候选强制要求 user_message + assistant_message/commentary）
    candidate.source_refs = [
      {
        source_kind: "user_message",
        source_timestamp: "2026-01-01T00:00:00Z",
        source_excerpt: "用户偏好简洁回答",
      },
      {
        source_kind: "commentary",
        source_timestamp: "2026-01-01T00:01:00Z",
        source_excerpt: "已记录用户偏好，后续回答保持简洁直接",
      },
    ];
  }

  // memory 候选额外字段
  if (template.candidate_type === "memory_candidate" && template.memory_type) {
    candidate.memory_type = template.memory_type;
  }

  // skill 候选额外字段
  if (template.candidate_type === "skill_proposal_candidate") {
    if (template.promotion_status) candidate.promotion_status = template.promotion_status;
    candidate.target_skill = template.target_skill;
    candidate.proposed_text = template.proposed_text;
    candidate.current_gap = template.current_gap;
    candidate.change_type = template.change_type;
    candidate.validation_method = template.validation_method;
    candidate.description = template.description;
    candidate.applicable_scenarios = template.applicable_scenarios;
    candidate.non_applicable_scenarios = template.non_applicable_scenarios;
    candidate.execution_steps = template.execution_steps;
  }

  const extraction = {
    rule_candidates: [],
    memory_candidates: [],
    skill_proposal_candidates: [],
    knowledge_candidates: [],
    governance_evidence_candidates: [],
    layer_links: [],
  };
  extraction[arrayKey] = [candidate];

  return {
    host: "generic",
    thread_id: "canary-template-verify",
    thread_name: null,
    session_file: "canary-template-verify",
    ingestion_readiness: { status: "ready", warnings: [] },
    raw_inputs: {
      user_messages: [{ timestamp: "2026-01-01T00:00:00Z", text: "用户偏好简洁回答" }],
      commentary_messages: [{ timestamp: "2026-01-01T00:01:00Z", text: "已记录用户偏好，后续回答保持简洁直接" }],
      commands: [],
      tool_calls: [],
      mcp_calls: [],
    },
    extraction_preview: extraction,
  };
}

const results = [];

for (const template of CANARY_TEMPLATES) {
  const batch = makeBatchWithOneCandidate(template);
  let rejected = false;
  let errorMessage = null;

  try {
    applyHostModelGovernanceResult({
      batch,
      governanceMode: "host_model",
      hostModelResult: {
        model_ref: "test",
        generated_at: new Date().toISOString(),
        extraction_preview: batch.extraction_preview,
      },
    });
  } catch (err) {
    rejected = true;
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  const rejectMatched = template.expect_reject === rejected;
  const patternMatched = !template.expect_error_pattern ||
    (errorMessage?.includes(template.expect_error_pattern) ?? false);
  const hit = rejectMatched && patternMatched;

  results.push({
    id: template.id,
    type: template.candidate_type,
    expectReject: template.expect_reject,
    actualRejected: rejected,
    expectPattern: template.expect_error_pattern,
    errorMessage: errorMessage ? errorMessage.slice(0, 200) : null,
    hit,
  });
}

console.log("=== P3-2 canary 模板全覆盖验证 ===\n");
console.log("ID | Type | expectReject | actualRejected | hit | errorPattern");
console.log("-".repeat(100));
for (const r of results) {
  const status = r.hit ? "✅" : "❌";
  console.log(`${status} ${r.id} | ${r.type} | expect=${r.expectReject} | actual=${r.actualRejected} | hit=${r.hit} | pattern=${r.expectPattern}`);
  if (!r.hit && r.errorMessage) {
    console.log(`   error: ${r.errorMessage}`);
  }
}

const hitCount = results.filter((r) => r.hit).length;
const missCount = results.length - hitCount;
console.log(`\n总计: ${results.length} 条模板, ${hitCount} hit, ${missCount} miss, hitRate=${((hitCount / results.length) * 100).toFixed(1)}%`);

if (missCount > 0) {
  console.log("\n❌ 有 canary 模板期望行为不一致，需要修复:");
  for (const r of results.filter((r) => !r.hit)) {
    console.log(`  - ${r.id}: expectReject=${r.expectReject}, actualRejected=${r.actualRejected}, expectPattern=${r.expectPattern}`);
    if (r.errorMessage) console.log(`    error: ${r.errorMessage}`);
  }
  process.exit(1);
} else {
  console.log("\n✅ 所有 canary 模板期望行为一致");
}
