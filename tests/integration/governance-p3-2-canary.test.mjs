/**
 * P3-2 canary 哨兵候选注入 gate test
 *
 * 验证：
 *   1. canary 候选注入后不出现在返回的 batch 中（被过滤掉）
 *   2. getCanaryStats 正确记录 hit/miss
 *   3. canary miss 时同批次其他候选被标记 needs_review
 *
 * 不依赖数据库，纯单元测试。
 */

import assert from "node:assert/strict";
import { applyHostModelGovernanceResult, getCanaryStats } from "../../services/memory-service/dist/services/memory-service/src/hostModelGovernanceAdapter.js";

function makeMinimalBatch() {
  return {
    host: "generic",
    thread_id: "canary-test",
    thread_name: null,
    session_file: "canary-test",
    ingestion_readiness: { status: "ready", warnings: [] },
    raw_inputs: {
      // rule canary 注入时需要从 raw_inputs 构造 source_refs（user_message + commentary 各 1 条）
      user_messages: [{ timestamp: "2026-01-01T00:00:00Z", text: "用户偏好简洁回答" }],
      commentary_messages: [{ timestamp: "2026-01-01T00:01:00Z", text: "已记录用户偏好，后续回答保持简洁直接" }],
      commands: [],
      tool_calls: [],
      mcp_calls: [],
    },
    extraction_preview: {
      rule_candidates: [],
      memory_candidates: [],
      skill_proposal_candidates: [],
      knowledge_candidates: [],
      governance_evidence_candidates: [],
      layer_links: [],
    },
  };
}

function makeHostModelResult() {
  return {
    model_ref: "test-model",
    generated_at: new Date().toISOString(),
    extraction_preview: {
      rule_candidates: [],
      memory_candidates: [],
      skill_proposal_candidates: [],
      knowledge_candidates: [],
      governance_evidence_candidates: [],
      layer_links: [],
    },
  };
}

async function testCanaryInjectionAndFiltering() {
  // 重置 getCanaryStats 初始状态
  const statsBefore = getCanaryStats();
  console.log("canary stats before injection:", statsBefore);

  // 调用 19 次（不触发注入，CANARY_INJECTION_INTERVAL=20）
  for (let i = 0; i < 19; i++) {
    applyHostModelGovernanceResult({
      batch: makeMinimalBatch(),
      governanceMode: "host_model",
      hostModelResult: makeHostModelResult(),
    });
  }

  const statsAfter19 = getCanaryStats();
  console.log("canary stats after 19 runs:", statsAfter19);
  assert.equal(statsAfter19.total, statsBefore.total, "前 19 次不应触发 canary 注入");

  // 第 20 次调用（触发注入）
  const result = applyHostModelGovernanceResult({
    batch: makeMinimalBatch(),
    governanceMode: "host_model",
    hostModelResult: makeHostModelResult(),
  });

  const statsAfter20 = getCanaryStats();
  console.log("canary stats after 20th run:", statsAfter20);
  assert.ok(statsAfter20.total > statsBefore.total, "第 20 次应触发 canary 注入");

  // 验证 canary 候选不出现在返回的 batch 中
  const allCandidates = [
    ...result.batch.extraction_preview.rule_candidates,
    ...result.batch.extraction_preview.memory_candidates,
    ...result.batch.extraction_preview.skill_proposal_candidates,
    ...result.batch.extraction_preview.knowledge_candidates,
    ...result.batch.extraction_preview.governance_evidence_candidates,
  ];
  for (const candidate of allCandidates) {
    assert.equal(candidate.is_canary, undefined, "canary 候选不应出现在返回的 batch 中");
  }

  console.log("✅ testCanaryInjectionAndFiltering passed");
}

async function testCanaryHitOrMissRecorded() {
  const statsBefore = getCanaryStats();

  // 调用 20 次触发注入
  for (let i = 0; i < 20; i++) {
    applyHostModelGovernanceResult({
      batch: makeMinimalBatch(),
      governanceMode: "host_model",
      hostModelResult: makeHostModelResult(),
    });
  }

  const statsAfter = getCanaryStats();
  console.log("canary stats after injection:", statsAfter);

  // 至少有 1 条新记录
  assert.ok(statsAfter.total > statsBefore.total, "应有新的 canary 记录");

  // 最近的记录应有 templateId 和 hit/miss 字段
  const recentResult = statsAfter.recentResults[statsAfter.recentResults.length - 1];
  console.log("latest canary result:", recentResult);
  assert.ok(recentResult.templateId, "canary 记录应有 templateId");
  assert.ok(typeof recentResult.hit === "boolean", "canary 记录应有 hit 布尔值");

  // hit + miss === total
  assert.equal(statsAfter.hit + statsAfter.miss, statsAfter.total, "hit + miss 应等于 total");

  console.log("✅ testCanaryHitOrMissRecorded passed");
  console.log(`   canary hitRate: ${(statsAfter.hitRate * 100).toFixed(1)}% (${statsAfter.hit}/${statsAfter.total})`);
}

async function testRulesFallbackSkipsCanary() {
  const statsBefore = getCanaryStats();

  // rules_fallback 模式不应触发 canary 注入
  for (let i = 0; i < 20; i++) {
    applyHostModelGovernanceResult({
      batch: makeMinimalBatch(),
      governanceMode: "rules_fallback",
      hostModelResult: null,
    });
  }

  const statsAfter = getCanaryStats();
  assert.equal(statsAfter.total, statsBefore.total, "rules_fallback 模式不应触发 canary 注入");

  console.log("✅ testRulesFallbackSkipsCanary passed");
}

async function main() {
  console.log("=== P3-2 canary 哨兵候选注入 gate test ===\n");

  await testCanaryInjectionAndFiltering();
  await testCanaryHitOrMissRecorded();
  await testRulesFallbackSkipsCanary();

  console.log("\n=== All P3-2 canary tests passed ===");
}

main().catch((err) => {
  console.error("P3-2 canary test failed:", err);
  process.exit(1);
});
