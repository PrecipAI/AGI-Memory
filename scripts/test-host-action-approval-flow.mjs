/**
 * 审批后硬编码生成完整链路测试
 *
 * 覆盖三种符合用户习惯的触发方式：
 * 1. Governance Console 视觉流程：查询 pending → approve → 查历史无重复 → execute → 验证 hook
 * 2. API 直接审批流程：直接 POST approve → execute → 验证 hook
 * 3. 自动 skill 触发：模拟 memory-host-action-execute skill 调用 execute
 *
 * 同时验证：
 * - 审批历史 approved/rejected 查询无重复
 * - hook 文件生成到仓库根 .trae/gates/
 * - registry.json 正确更新
 * - 重复 execute 不会重复生成
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const HOST = "http://127.0.0.1:3101";
const TENANT = "tenant-local";
const SCOPE = "memory.validation";
const HEADERS = {
  "Content-Type": "application/json",
  "x-tenant-id": TENANT,
  "x-scope": SCOPE,
  "x-trace-id": `trace-host-action-flow-${Date.now()}`
};

const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

let passCount = 0;
let failCount = 0;

function section(title) {
  console.log(`\n${YELLOW}═══ ${title} ═══${RESET}`);
}

function logPass(msg) {
  passCount++;
  console.log(`  ${GREEN}✓ PASS${RESET} ${msg}`);
}

function logFail(msg, detail = "") {
  failCount++;
  console.log(`  ${RED}✗ FAIL${RESET} ${msg}${detail ? ` — ${detail}` : ""}`);
}

async function api(method, path, body = undefined) {
  const res = await fetch(`${HOST}${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined
  });
  const raw = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  return { status: res.status, raw, body: parsed };
}

function repoRoot() {
  // 测试脚本在 scripts/ 下
  return path.resolve(process.cwd());
}

function assertFileExists(filePath, label) {
  if (existsSync(filePath)) {
    logPass(`${label} 存在: ${filePath}`);
    return true;
  }
  logFail(`${label} 不存在: ${filePath}`);
  return false;
}

function assertRegistryContains(ruleKey) {
  const registryPath = path.join(repoRoot(), ".trae", "gates", "registry.json");
  if (!existsSync(registryPath)) {
    logFail(`registry.json 不存在`);
    return false;
  }
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  const found = registry.gates?.some((g) => g.rule_key === ruleKey);
  if (found) {
    logPass(`registry.json 包含 rule_key=${ruleKey}`);
    return true;
  }
  logFail(`registry.json 未找到 rule_key=${ruleKey}`);
  return false;
}

function assertNoHistoryDuplicates(items, label) {
  const ids = items.map((i) => i.id);
  const unique = new Set(ids);
  if (unique.size === ids.length) {
    logPass(`${label} 无重复 (${ids.length} 条)`);
    return true;
  }
  logFail(`${label} 存在重复`, `唯一=${unique.size}, 总数=${ids.length}`);
  return false;
}

// ═══════════════════════════════════════════════════════════════
// 测试开始
// ═══════════════════════════════════════════════════════════════

section("前置：确认有 pending proposal 可审批");

const pendingRes = await api("GET", "/internal/governance/change-proposals?status=recorded&limit=50");
if (pendingRes.status !== 200 || !Array.isArray(pendingRes.body?.items)) {
  console.log(`${RED}无法获取 pending proposals: ${pendingRes.status} ${pendingRes.raw.slice(0, 200)}${RESET}`);
  process.exit(1);
}

const pendingProposals = pendingRes.body.items;
console.log(`  pending proposals: ${pendingProposals.length}`);

// 找一个 create_rule 类型的 proposal
const targetProposal = pendingProposals.find((p) => p.proposed_action === "create_rule");
if (!targetProposal) {
  console.log(`${YELLOW}没有 create_rule proposal，将用 host_model 模式创建一个${RESET}`);
} else {
  console.log(`  目标 proposal: ${targetProposal.id} / ${targetProposal.proposed_action}`);
}

// ═══════════════════════════════════════════════════════════════
// 方式 1：Governance Console 视觉流程
// ═══════════════════════════════════════════════════════════════
section("方式 1: Governance Console 视觉审批流程");

let proposalId = targetProposal?.id;
if (!proposalId) {
  // 创建一个 rule proposal（模拟从 extraction 进入 host_model）
  const visualToken = Date.now();
  const extractionPreview = {
    rule_candidates: [{
      candidate_type: "rule_candidate",
      title: `视觉测试规则：禁止提交未格式化代码（编号 ${visualToken}）`,
      statement: `代码提交前必须运行 formatter，禁止提交未格式化代码（测试编号 ${visualToken}）`,
      rule_key: `host-rule-visual-${visualToken}`,
      rule_domain: "execution",
      rule_scope: "project",
      enforcement_level: "must",
      violation_behavior: "block",
      applies_to_phase: ["coding"],
      risk_level: "medium",
      promotion_status: "needs_review",
      origin_scope: "project",
      availability_scope: "project_reusable",
      governance_level: "shared",
      source_kind: "host_capture",
      source_timestamp: new Date().toISOString(),
      source_excerpt: `代码提交前必须运行 formatter（测试编号 ${visualToken}）`,
      reason: "保持代码风格一致，降低 review 噪音",
      metadata: {
        source: "visual_test",
        human_readable_statement: "提交前必须运行 formatter，否则阻断提交",
        classification_rationale: "这是约束性规则：IF 代码提交 THEN 必须先运行 formatter，属于 IF/THEN 型门禁而非操作步骤。"
      },
      source_refs: [
        { source_kind: "user_message", source_timestamp: new Date().toISOString(), source_excerpt: "提交前记得格式化代码" },
        { source_kind: "assistant_message", source_timestamp: new Date().toISOString(), source_excerpt: "好的，我会确保每次提交前运行 formatter" }
      ]
    }],
    memory_candidates: [],
    skill_proposal_candidates: [],
    knowledge_candidates: [],
    governance_evidence_candidates: [],
    layer_links: []
  };
  const visualRuleKey = extractionPreview.rule_candidates[0].rule_key;
  const runRes = await api("POST", "/internal/governance/run-from-extraction", {
    extraction_preview: extractionPreview,
    governance_mode: "host_model",
    host: "trae"
  });
  if (runRes.status !== 200) {
    console.log(`${RED}run-from-extraction 失败: ${runRes.status} ${runRes.raw.slice(0, 300)}${RESET}`);
    process.exit(1);
  }
  console.log(`  run-from-extraction 响应: ${runRes.body?.acceptance_report?.governance_candidates?.rule_count ?? 0} rules, ${runRes.body?.acceptance_report?.promoted_outputs?.rule_count ?? 0} promoted rules`);
  console.log(`  run-from-extraction persisted: ${JSON.stringify(runRes.body?.persisted?.rule_items?.map((r) => ({ id: r.id, title: r.title, promotion_status: r.promotion_status })))}`);
  console.log(`  warnings: ${JSON.stringify(runRes.body?.acceptance_report?.warnings)}`);

  // 重新查询 pending（不依赖返回值中的计数，因为 host_model 可能直接写 proposal）
  await new Promise((r) => setTimeout(r, 300));
  const pending2 = await api("GET", "/internal/governance/change-proposals?status=recorded&limit=50");
  const newProposal = pending2.body?.items?.find((p) =>
    p.proposed_action === "create_rule" &&
    (p.proposed_payload?.rule_key === visualRuleKey || p.proposed_payload?.title?.includes("视觉测试规则"))
  );
  if (!newProposal) {
    console.log(`${RED}未找到新创建的 visual proposal (rule_key=${visualRuleKey})${RESET}`);
    process.exit(1);
  }
  proposalId = newProposal.id;
  console.log(`  新建 proposal: ${proposalId}`);
}

// 步骤 A：Governance Console 会查询 pending 列表（已做）
logPass(`Visual Step A: 列出 pending proposals`);

// 步骤 B：点击通过
const approveRes = await api("POST", `/internal/governance/change-proposals/${proposalId}/actions`, {
  action: "approve",
  payload: { feedback: "同意，生成硬编码规则" }
});
if (approveRes.status === 200 && (approveRes.body?.proposal?.human_decision === "approved" || approveRes.body?.item?.human_decision === "approved")) {
  logPass(`Visual Step B: approve proposal 成功`);
} else {
  logFail(`Visual Step B: approve 失败`, `status=${approveRes.status} body=${approveRes.raw.slice(0, 200)}`);
}

// 步骤 C：Governance Console 刷新审批历史（顺序查询避免并发 uv bug）
const approvedHistory = await api("GET", "/internal/governance/change-proposals?status=resolved&human_decision=approved&limit=50");
await new Promise((r) => setTimeout(r, 100));
const rejectedHistory = await api("GET", "/internal/governance/change-proposals?status=resolved&human_decision=rejected&limit=50");
if (approvedHistory.status === 200 && rejectedHistory.status === 200) {
  assertNoHistoryDuplicates([...approvedHistory.body.items, ...rejectedHistory.body.items], "Visual Step C: 审批历史");
  const overlap = approvedHistory.body.items.filter((a) =>
    rejectedHistory.body.items.some((r) => r.id === a.id)
  );
  if (overlap.length === 0) {
    logPass(`Visual Step C: approved/rejected 无交集`);
  } else {
    logFail(`Visual Step C: approved/rejected 存在交集`, `${overlap.length} 条`);
  }
} else {
  logFail(`Visual Step C: 查询审批历史失败`, `approved=${approvedHistory.status}, rejected=${rejectedHistory.status}`);
}

// 步骤 D：调用 host-actions/execute（对应 memory-host-action-execute skill 或手动点击"生成硬编码"）
const executeRes = await api("POST", "/internal/host-actions/execute", { limit: 100 });
if (executeRes.status === 200 && executeRes.body?.succeeded > 0) {
  logPass(`Visual Step D: host-actions/execute 成功，生成 ${executeRes.body.succeeded} 条`);
  for (const item of executeRes.body.items || []) {
    console.log(`    ${item.object_type} ${item.key} → ${item.output_path}`);
    if (item.object_type === "rule") {
      assertFileExists(item.output_path, "hook 文件");
      assertRegistryContains(item.key);
    }
  }
} else {
  logFail(`Visual Step D: host-actions/execute 失败`, `status=${executeRes.status} body=${executeRes.raw.slice(0, 300)}`);
}

// 方式间短暂停顿，降低并发 uv 压力
await new Promise((r) => setTimeout(r, 300));

// ═══════════════════════════════════════════════════════════════
// 方式 2：API 直接审批流程（从 extraction 到 hook 全自动语义链路）
// ═══════════════════════════════════════════════════════════════
section("方式 2: API 直接审批流程");

const directToken = Date.now();
const directRuleKey = `host-rule-direct-${directToken}`;
const directExtraction = {
  rule_candidates: [{
    candidate_type: "rule_candidate",
    title: `API 测试规则：禁止日志打印敏感信息（编号 ${directToken}）`,
    content: `IF 输出日志 THEN 必须对敏感字段脱敏，禁止打印用户密码或 token（测试编号 ${directToken}）`,
    statement: "禁止在日志中打印用户密码或 token，必须对敏感字段脱敏，违反将被阻断提交",
    rule_key: directRuleKey,
    rule_domain: "execution",
    rule_scope: "project",
    enforcement_level: "must",
    violation_behavior: "block",
    applies_to_phase: ["coding"],
    risk_level: "medium",
    promotion_status: "needs_review",
    origin_scope: "project",
    availability_scope: "project_reusable",
    governance_level: "shared",
    source_kind: "host_capture",
    source_timestamp: new Date().toISOString(),
    source_excerpt: "禁止在日志中打印用户密码或 token",
    reason: "防止敏感信息泄露，降低安全风险",
    metadata: {
      source: "direct_api_test",
      human_readable_statement: "日志中禁止打印用户密码或 token，必须脱敏",
      classification_rationale: "这是约束性规则：IF 输出日志 THEN 必须对敏感字段脱敏，属于 IF/THEN 型约束而非操作步骤。"
    },
    source_refs: [
      { source_kind: "user_message", source_timestamp: new Date().toISOString(), source_excerpt: "日志里别打印密码" },
      { source_kind: "assistant_message", source_timestamp: new Date().toISOString(), source_excerpt: "我会把敏感字段脱敏后再输出" }
    ]
  }],
  memory_candidates: [],
  skill_proposal_candidates: [],
  knowledge_candidates: [],
  governance_evidence_candidates: [],
  layer_links: []
};

const directRun = await api("POST", "/internal/governance/run-from-extraction", {
  extraction_preview: directExtraction,
  governance_mode: "host_model",
  host: "codex"
});
if (directRun.status === 200) {
  logPass(`API Step A: run-from-extraction 创建 proposal 成功`);
} else {
  logFail(`API Step A: run-from-extraction 失败`, `${directRun.status} ${directRun.raw.slice(0, 300)}`);
}

// 找到刚创建的 proposal
await new Promise((r) => setTimeout(r, 200));
const directPending = await api("GET", "/internal/governance/change-proposals?status=recorded&limit=50");
const directProposal = directPending.body?.items?.find((p) =>
  p.proposed_action === "create_rule" &&
  (p.proposed_payload?.rule_key === directRuleKey || p.proposed_payload?.title?.includes("API 测试规则"))
);
let actualDirectKey = directRuleKey;
if (directProposal) {
  actualDirectKey = directProposal.proposed_payload?.rule_key || directRuleKey;
  logPass(`API Step B: 找到 pending proposal ${directProposal.id} (生成 key=${actualDirectKey})`);
  const directApprove = await api("POST", `/internal/governance/change-proposals/${directProposal.id}/actions`, {
    action: "approve"
  });
  if (directApprove.status === 200) {
    logPass(`API Step C: 直接 approve 成功`);
  } else {
    logFail(`API Step C: 直接 approve 失败`, `${directApprove.status} ${directApprove.raw.slice(0, 200)}`);
  }

  const directExecute = await api("POST", "/internal/host-actions/execute", { limit: 100 });
  const generatedItem = (directExecute.body?.items || []).find((i) => i.key === actualDirectKey);
  if (directExecute.status === 200 && generatedItem) {
    logPass(`API Step D: execute 生成 ${actualDirectKey}.hook.ts`);
    assertFileExists(generatedItem.output_path, "hook 文件");
    assertRegistryContains(actualDirectKey);
  } else {
    logFail(`API Step D: execute 未生成目标 rule`, `body=${directExecute.raw.slice(0, 300)}`);
  }
} else {
  logFail(`API Step B: 未找到 pending proposal`, `rule_key=${directRuleKey}`);
}

await new Promise((r) => setTimeout(r, 300));

// ═══════════════════════════════════════════════════════════════
// 方式 3：模拟 skill 自动触发（memory-host-action-execute）
// ═══════════════════════════════════════════════════════════════
section("方式 3: memory-host-action-execute skill 自动触发");

// 创建一个 pending rule，然后调用 execute（与 skill 行为一致）
const skillToken = Date.now();
const skillRuleKey = `host-rule-skill-${skillToken}`;
const skillExtraction = {
  rule_candidates: [{
    candidate_type: "rule_candidate",
    title: `Skill 测试规则：禁止引入无许可证依赖（编号 ${skillToken}）`,
    content: `IF 引入新依赖 THEN 必须先检查许可证，禁止引入无许可证或高风险许可证（测试编号 ${skillToken}）`,
    statement: "引入新依赖前必须检查许可证，禁止引入无许可证或高风险许可证，违反将被阻断提交",
    rule_key: skillRuleKey,
    rule_domain: "execution",
    rule_scope: "project",
    enforcement_level: "must",
    violation_behavior: "warn",
    applies_to_phase: ["coding"],
    risk_level: "low",
    promotion_status: "needs_review",
    origin_scope: "project",
    availability_scope: "project_reusable",
    governance_level: "shared",
    source_kind: "host_capture",
    source_timestamp: new Date().toISOString(),
    source_excerpt: "引入新依赖前必须检查许可证",
    reason: "规避许可证合规风险，防止法律纠纷",
    metadata: {
      source: "skill_auto_test",
      human_readable_statement: "引入新依赖前必须检查许可证，禁止无许可证",
      classification_rationale: "这是约束性规则：IF 引入新依赖 THEN 必须先检查许可证，属于 IF/THEN 型约束而非操作步骤。"
    },
    source_refs: [
      { source_kind: "user_message", source_timestamp: new Date().toISOString(), source_excerpt: "加依赖前要看许可证" },
      { source_kind: "assistant_message", source_timestamp: new Date().toISOString(), source_excerpt: "我会先检查依赖许可证再引入" }
    ]
  }],
  memory_candidates: [],
  skill_proposal_candidates: [],
  knowledge_candidates: [],
  governance_evidence_candidates: [],
  layer_links: []
};

const skillRun = await api("POST", "/internal/governance/run-from-extraction", {
  extraction_preview: skillExtraction,
  governance_mode: "host_model",
  host: "generic-editor"
});
await new Promise((r) => setTimeout(r, 200));
const skillPending = await api("GET", "/internal/governance/change-proposals?status=recorded&limit=50");
const skillProposal = skillPending.body?.items?.find((p) =>
  p.proposed_action === "create_rule" &&
  (p.proposed_payload?.rule_key === skillRuleKey || p.proposed_payload?.title?.includes("Skill 测试规则"))
);

let actualSkillKey = skillRuleKey;
if (skillProposal) {
  actualSkillKey = skillProposal.proposed_payload?.rule_key || skillRuleKey;
  await api("POST", `/internal/governance/change-proposals/${skillProposal.id}/actions`, { action: "approve" });
  const skillExecute = await api("POST", "/internal/host-actions/execute", { limit: 100 });
  const generatedSkillItem = (skillExecute.body?.items || []).find((i) => i.key === actualSkillKey);
  if (skillExecute.status === 200 && generatedSkillItem) {
    logPass(`Skill 触发: execute 生成 ${actualSkillKey}.hook.ts`);
    assertFileExists(generatedSkillItem.output_path, "hook 文件");
    assertRegistryContains(actualSkillKey);
  } else {
    logFail(`Skill 触发: execute 未生成目标 rule`, skillExecute.raw.slice(0, 300));
  }
} else {
  logFail(`Skill 触发: 未找到 pending proposal`, `rule_key=${skillRuleKey}`);
}

// ═══════════════════════════════════════════════════════════════
// 负面测试：重复 execute 不会重复生成
// ═══════════════════════════════════════════════════════════════
section("负面测试: 重复 execute 不会重复生成");

const hookPath = path.join(repoRoot(), ".trae", "gates", `${actualDirectKey}.hook.ts`);
const beforeStat = existsSync(hookPath) ? readFileSync(hookPath, "utf8") : "";
const repeatExecute = await api("POST", "/internal/host-actions/execute", { limit: 100 });
if (repeatExecute.status === 200 && repeatExecute.body?.total === 0) {
  logPass(`重复 execute: 无 pending host-action，total=0`);
} else {
  logFail(`重复 execute: 预期 total=0`, `实际=${repeatExecute.body?.total}`);
}
const afterStat = existsSync(hookPath) ? readFileSync(hookPath, "utf8") : "";
if (beforeStat === afterStat) {
  logPass(`重复 execute: hook 文件未被覆盖`);
} else {
  logFail(`重复 execute: hook 文件内容变化`);
}

await new Promise((r) => setTimeout(r, 300));

// ═══════════════════════════════════════════════════════════════
// 负面测试：重复提交相同内容不会创建多个 proposal
// ═══════════════════════════════════════════════════════════════
section("负面测试: 重复提交相同内容幂等");

const duplicateToken = Date.now();
const duplicateRuleKey = `host-rule-duplicate-${duplicateToken}`;
const duplicateContent = `IF 提交代码 THEN 必须先跑单元测试，禁止提交未跑测试的代码（幂等测试编号 ${duplicateToken}）`;
const duplicateExtraction = {
  rule_candidates: [{
    candidate_type: "rule_candidate",
    title: `幂等测试规则：禁止提交未跑测试的代码（编号 ${duplicateToken}）`,
    content: duplicateContent,
    statement: "提交代码前必须先跑单元测试，禁止提交未跑测试的代码，违反将被阻断提交",
    rule_key: duplicateRuleKey,
    rule_domain: "execution",
    rule_scope: "project",
    enforcement_level: "must",
    violation_behavior: "block",
    applies_to_phase: ["coding"],
    risk_level: "medium",
    promotion_status: "needs_review",
    origin_scope: "project",
    availability_scope: "project_reusable",
    governance_level: "shared",
    source_kind: "host_capture",
    source_timestamp: new Date().toISOString(),
    source_excerpt: "提交代码前必须先跑单元测试",
    reason: "保证代码质量，降低回归风险",
    metadata: {
      source: "idempotent_test",
      human_readable_statement: "提交代码前必须先跑单元测试",
      classification_rationale: "这是约束性规则：IF 提交代码 THEN 必须先跑单元测试，属于 IF/THEN 型约束而非操作步骤。"
    },
    source_refs: [
      { source_kind: "user_message", source_timestamp: new Date().toISOString(), source_excerpt: "提交前要跑测试" },
      { source_kind: "assistant_message", source_timestamp: new Date().toISOString(), source_excerpt: "我会先跑单元测试再提交" }
    ]
  }],
  memory_candidates: [],
  skill_proposal_candidates: [],
  knowledge_candidates: [],
  governance_evidence_candidates: [],
  layer_links: []
};

const dupRun1 = await api("POST", "/internal/governance/run-from-extraction", {
  extraction_preview: duplicateExtraction,
  governance_mode: "host_model",
  host: "trae"
});
await new Promise((r) => setTimeout(r, 200));
const dupRun2 = await api("POST", "/internal/governance/run-from-extraction", {
  extraction_preview: duplicateExtraction,
  governance_mode: "host_model",
  host: "trae"
});

await new Promise((r) => setTimeout(r, 200));
const dupPending = await api("GET", "/internal/governance/change-proposals?status=recorded&limit=50");
const dupProposals = (dupPending.body?.items || []).filter((p) =>
  p.proposed_action === "create_rule" &&
  (p.proposed_payload?.rule_key === duplicateRuleKey || p.proposed_payload?.title?.includes("幂等测试规则"))
);
if (dupRun1.status === 200 && dupRun2.status === 200 && dupProposals.length === 1) {
  logPass(`幂等提交: 重复 run-from-extraction 只产生 1 个 pending proposal`);
} else {
  logFail(`幂等提交: 产生 ${dupProposals.length} 个 proposal`, `run1=${dupRun1.status}, run2=${dupRun2.status}`);
}

// 顺手把这条幂等 proposal 驳回，验证 rejected 历史
const dupReject = await api("POST", `/internal/governance/change-proposals/${dupProposals[0].id}/actions`, {
  action: "reject",
  payload: { feedback: "测试驳回，不生成硬编码" }
});
await new Promise((r) => setTimeout(r, 100));
const rejectedAfterDup = await api("GET", "/internal/governance/change-proposals?status=resolved&human_decision=rejected&limit=50");
const foundRejectedDup = rejectedAfterDup.body?.items?.some((p) => p.id === dupProposals[0].id);
if (dupReject.status === 200 && foundRejectedDup) {
  logPass(`驳回测试: rejected 历史中包含被驳回的幂等 proposal`);
} else {
  logFail(`驳回测试: 未在 rejected 历史中找到`, `status=${dupReject.status}, found=${foundRejectedDup}`);
}

await new Promise((r) => setTimeout(r, 300));

// ═══════════════════════════════════════════════════════════════
// 方式 4：批量审批 + 单次 execute（符合用户"审两条规则再生成"习惯）
// ═══════════════════════════════════════════════════════════════
section("方式 4: 批量审批后单次 execute 生成多条硬编码");

const batchConfigs = [
  {
    title: "批量测试规则 1：禁止直接提交到 main 分支",
    content: "IF 提交代码 THEN 禁止直接推送到 main 分支，必须通过 PR 合并",
    statement: "禁止直接推送到 main 分支，必须通过 PR 合并，违反将被阻断提交",
    excerpt: "禁止直接推送到 main 分支",
    reason: "保护主分支，强制代码审查"
  },
  {
    title: "批量测试规则 2：禁止提交未跑测试的代码",
    content: "IF 提交代码 THEN 必须先跑单元测试，禁止提交未跑测试的代码",
    statement: "提交代码前必须先跑单元测试，禁止提交未跑测试的代码，违反将被阻断提交",
    excerpt: "提交代码前必须先跑单元测试",
    reason: "保证代码质量，降低回归风险"
  }
];

const batchTitles = [];
const batchActualKeys = [];
const batchProposals = [];
for (let i = 0; i < batchConfigs.length; i++) {
  const cfg = batchConfigs[i];
  const batchToken = `${Date.now()}-${i}`;
  const batchRuleKey = `host-rule-batch-${batchToken}`;
  const batchTitle = `${cfg.title}（编号 ${batchToken}）`;
  batchTitles.push(batchTitle);
  const batchExtraction = {
    rule_candidates: [{
      candidate_type: "rule_candidate",
      title: batchTitle,
      content: `${cfg.content}（批量测试编号 ${batchToken}）`,
      statement: cfg.statement,
      rule_key: batchRuleKey,
      rule_domain: "execution",
      rule_scope: "project",
      enforcement_level: "must",
      violation_behavior: "block",
      applies_to_phase: ["coding"],
      risk_level: "high",
      promotion_status: "needs_review",
      origin_scope: "project",
      availability_scope: "project_reusable",
      governance_level: "shared",
      source_kind: "host_capture",
      source_timestamp: new Date().toISOString(),
      source_excerpt: cfg.excerpt,
      reason: cfg.reason,
      metadata: {
        source: "batch_test",
        human_readable_statement: cfg.statement,
        classification_rationale: `这是约束性规则：${cfg.content}，属于 IF/THEN 型约束而非操作步骤。`
      },
      source_refs: [
        { source_kind: "user_message", source_timestamp: new Date().toISOString(), source_excerpt: cfg.excerpt },
        { source_kind: "assistant_message", source_timestamp: new Date().toISOString(), source_excerpt: "好的，我会遵守这条规则" }
      ]
    }],
    memory_candidates: [],
    skill_proposal_candidates: [],
    knowledge_candidates: [],
    governance_evidence_candidates: [],
    layer_links: []
  };
  const batchRun = await api("POST", "/internal/governance/run-from-extraction", {
    extraction_preview: batchExtraction,
    governance_mode: "host_model",
    host: "codex"
  });
  if (batchRun.status !== 200) {
    logFail(`批量 Step A-${i + 1}: run-from-extraction 失败`, `${batchRun.status} ${batchRun.raw.slice(0, 200)}`);
  }
  // 等 proposal 落库，避免批量创建时查询不到
  await new Promise((r) => setTimeout(r, 500));
}

// 每个 title 单独查询，避免模糊匹配到多个 proposal
for (const title of batchTitles) {
  const batchPending = await api("GET", `/internal/governance/change-proposals?status=recorded&limit=50`);
  const p = batchPending.body?.items?.find((item) =>
    item.proposed_action === "create_rule" &&
    item.proposed_payload?.title === title
  );
  if (p) {
    const actualKey = p.proposed_payload?.rule_key || `unknown-${p.id}`;
    batchActualKeys.push(actualKey);
    batchProposals.push(p);
    const batchApprove = await api("POST", `/internal/governance/change-proposals/${p.id}/actions`, { action: "approve" });
    if (batchApprove.status === 200) {
      logPass(`批量 Step B: approve ${actualKey}`);
    } else {
      logFail(`批量 Step B: approve ${actualKey} 失败`, `${batchApprove.status}`);
    }
  } else {
    logFail(`批量 Step B: 未找到 pending proposal`, `title=${title}`);
  }
}

const batchExecute = await api("POST", "/internal/host-actions/execute", { limit: 100 });
if (batchExecute.status === 200 && batchExecute.body?.succeeded >= 2) {
  logPass(`批量 Step C: 单次 execute 生成 ${batchExecute.body.succeeded} 条硬编码`);
  for (const key of batchActualKeys) {
    const generated = (batchExecute.body.items || []).find((i) => i.key === key);
    if (generated) {
      assertFileExists(generated.output_path, `hook 文件 ${key}`);
      assertRegistryContains(key);
    } else {
      logFail(`批量 Step C: 未生成 ${key}`);
    }
  }
} else {
  logFail(`批量 Step C: execute 失败`, `status=${batchExecute.status} body=${batchExecute.raw.slice(0, 300)}`);
}

await new Promise((r) => setTimeout(r, 100));
const finalHistory = await api("GET", "/internal/governance/change-proposals?status=resolved&human_decision=approved&limit=50");
assertNoHistoryDuplicates(finalHistory.body?.items || [], "批量 Step D: 审批历史");

// ═══════════════════════════════════════════════════════════════
// 汇总
// ═══════════════════════════════════════════════════════════════
section("测试汇总");
console.log(`  ${GREEN}通过: ${passCount}${RESET}`);
console.log(`  ${failCount > 0 ? RED : GREEN}失败: ${failCount}${RESET}`);
if (failCount > 0) {
  process.exit(1);
}
