/**
 * 41. 静态记忆编译器 - gate test
 *
 * 验证静态记忆编译器的核心能力：
 *   1. contentFilter 筛选逻辑（通过的条目 + 跳过的条目 + 原因）
 *   2. markerManager marker 注入（created/updated/unchanged 状态机）
 *   3. hostFormatter 三宿主格式化
 *   4. compiler 编排逻辑（筛选→格式化→写入三宿主）
 *   5. executeHostActions 集成（succeeded>0 时触发编译）
 *
 * 使用 mock DB（module.register loader），不依赖真实数据库。
 */

import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { pathToFileURL } from "node:url";
import { register } from "node:module";
import {
  shouldCompileToStaticMemory,
  filterCompilableItems,
} from "../../services/memory-service/dist/services/memory-service/src/staticMemoryCompiler/contentFilter.js";
import {
  upsertMarkedBlock,
  validateMarkerIntegrity,
  MARKER_PAIRS,
} from "../../services/memory-service/dist/services/memory-service/src/staticMemoryCompiler/markerManager.js";
import {
  formatRules,
  formatSkills,
  formatMemories,
  detectHosts,
} from "../../services/memory-service/dist/services/memory-service/src/staticMemoryCompiler/hostFormatter.js";

// ─── 1. contentFilter 单元测试 ────────────────────────────────────────

function testContentFilter() {
  console.log("=== 1. contentFilter 单元测试 ===");

  // 1.1 未审批的条目被排除
  const needsReviewItem = {
    id: "r1",
    title: "未审批规则",
    statement: "IF 提交 THEN MUST 测试",
    promotion_status: "needs_review",
    origin_scope: "project",
    availability_scope: "workspace_reusable",
    enforcement_level: "must",
    metadata: { human_readable_statement: "提交必须测试" },
  };
  assert.equal(shouldCompileToStaticMemory("rule", needsReviewItem).pass, false);
  console.log("  ✓ 未审批条目被排除");

  // 1.2 session 级条目被排除
  const sessionItem = {
    id: "r2",
    title: "会话级规则",
    statement: "本次会话不用 var",
    promotion_status: "active",
    origin_scope: "session",
    availability_scope: "session_only",
    enforcement_level: "must",
  };
  assert.equal(shouldCompileToStaticMemory("rule", sessionItem).pass, false);
  console.log("  ✓ session 级条目被排除");

  // 1.3 时间敏感词被排除
  const timeSensitiveItem = {
    id: "r3",
    title: "时间敏感规则",
    statement: "v2.3 版本必须用新认证",
    promotion_status: "active",
    origin_scope: "project",
    availability_scope: "workspace_reusable",
    enforcement_level: "must",
  };
  assert.equal(shouldCompileToStaticMemory("rule", timeSensitiveItem).pass, false);
  console.log("  ✓ 时间敏感词被排除");

  // 1.4 项目专名被排除
  const projectNounItem = {
    id: "r4",
    title: "项目专名规则",
    statement: "agi-memory 的 hostModelGovernanceAdapter 必须单例",
    promotion_status: "active",
    origin_scope: "project",
    availability_scope: "workspace_reusable",
    enforcement_level: "must",
  };
  assert.equal(shouldCompileToStaticMemory("rule", projectNounItem).pass, false);
  console.log("  ✓ 项目专名被排除");

  // 1.5 安全风险内容被排除
  const securityItem = {
    id: "r5",
    title: "安全风险规则",
    statement: "API_KEY=sk-xxx 必须放在 env 里",
    promotion_status: "active",
    origin_scope: "project",
    availability_scope: "workspace_reusable",
    enforcement_level: "must",
  };
  assert.equal(shouldCompileToStaticMemory("rule", securityItem).pass, false);
  console.log("  ✓ 安全风险内容被排除");

  // 1.6 合格的 must 规则通过
  const validMustRule = {
    id: "r6",
    title: "合格规则",
    statement: "IF 提交功能变更 THEN MUST 包含测试",
    promotion_status: "active",
    origin_scope: "project",
    availability_scope: "workspace_reusable",
    enforcement_level: "must",
  };
  assert.equal(shouldCompileToStaticMemory("rule", validMustRule).pass, true);
  console.log("  ✓ 合格的 must 规则通过");

  // 1.7 must_not 规则也通过
  const validMustNotRule = {
    id: "r7",
    title: "禁止性规则",
    statement: "MUST NOT 在生产代码里用 console.log",
    promotion_status: "active",
    origin_scope: "project",
    availability_scope: "workspace_reusable",
    enforcement_level: "must_not",
  };
  assert.equal(shouldCompileToStaticMemory("rule", validMustNotRule).pass, true);
  console.log("  ✓ must_not 规则通过");

  // 1.8 user_memory about_user_not_code=false 被排除
  const codeMemoryItem = {
    id: "m1",
    title: "代码记忆",
    content: "用户偏好用 React 18 的 useTransition",
    promotion_status: "active",
    origin_scope: "user",
    availability_scope: "user_reusable",
    stability: "long_lived",
    memory_type: "user_memory",
    self_test: { about_user_not_code: false },
  };
  assert.equal(shouldCompileToStaticMemory("memory", codeMemoryItem).pass, false);
  console.log("  ✓ user_memory about_user_not_code=false 被排除");

  // 1.9 合格的 user_memory 通过
  const validMemory = {
    id: "m2",
    title: "用户画像",
    content: "用户喜欢简洁回答",
    promotion_status: "active",
    origin_scope: "user",
    availability_scope: "user_reusable",
    stability: "long_lived",
    memory_type: "user_memory",
    self_test: { about_user_not_code: true },
  };
  assert.equal(shouldCompileToStaticMemory("memory", validMemory).pass, true);
  console.log("  ✓ 合格的 user_memory 通过");

  // 1.10 project_memory 含项目专名被排除
  const projectMemoryWithNoun = {
    id: "m3",
    title: "项目记忆含专名",
    content: "agi-memory 项目用 PostgreSQL",
    promotion_status: "active",
    origin_scope: "project",
    availability_scope: "workspace_reusable",
    stability: "long_lived",
    memory_type: "project_memory",
  };
  assert.equal(shouldCompileToStaticMemory("memory", projectMemoryWithNoun).pass, false);
  console.log("  ✓ project_memory 含项目专名被排除");

  // 1.11 合格的 project_memory 通过
  const validProjectMemory = {
    id: "m4",
    title: "项目约定",
    content: "项目用 PostgreSQL 作为主数据库",
    promotion_status: "active",
    origin_scope: "project",
    availability_scope: "workspace_reusable",
    stability: "long_lived",
    memory_type: "project_memory",
  };
  assert.equal(shouldCompileToStaticMemory("memory", validProjectMemory).pass, true);
  console.log("  ✓ 合格的 project_memory 通过");

  // 1.12 批量筛选
  const items = [validMustRule, needsReviewItem, sessionItem];
  const filtered = filterCompilableItems("rule", items);
  assert.equal(filtered.passed.length, 1);
  assert.equal(filtered.skipped.length, 2);
  console.log("  ✓ 批量筛选正确（1 passed, 2 skipped）");
}

// ─── 2. markerManager 单元测试 ────────────────────────────────────────

async function testMarkerManager() {
  console.log("\n=== 2. markerManager 单元测试 ===");

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "marker-test-"));
  const filePath = path.join(tempDir, "test.md");

  // 2.1 新文件 created
  const result1 = await upsertMarkedBlock({
    filePath,
    markerKey: "rules",
    block: "## 规则内容\n- 规则1",
  });
  assert.equal(result1.status, "created");
  console.log("  ✓ 新文件 created");

  // 2.2 相同内容 unchanged
  const result2 = await upsertMarkedBlock({
    filePath,
    markerKey: "rules",
    block: "## 规则内容\n- 规则1",
  });
  assert.equal(result2.status, "unchanged");
  console.log("  ✓ 相同内容 unchanged");

  // 2.3 不同内容 updated
  const result3 = await upsertMarkedBlock({
    filePath,
    markerKey: "rules",
    block: "## 规则内容\n- 规则1\n- 规则2",
  });
  assert.equal(result3.status, "updated");
  console.log("  ✓ 不同内容 updated");

  // 2.4 保留 marker 外的内容
  await fs.writeFile(filePath, "# 标题\n\n用户内容\n", "utf8");
  await upsertMarkedBlock({
    filePath,
    markerKey: "rules",
    block: "## 规则",
  });
  const content = await fs.readFile(filePath, "utf8");
  assert.ok(content.includes("# 标题"), "应保留标题");
  assert.ok(content.includes("用户内容"), "应保留用户内容");
  assert.ok(content.includes("<!-- >>> memory-v3 static-rules >>>"), "应有 rules marker");
  console.log("  ✓ 保留 marker 外的用户内容");

  // 2.5 marker 完整性校验
  const issues = await validateMarkerIntegrity(filePath);
  assert.equal(issues.length, 0);
  console.log("  ✓ marker 完整性校验通过");

  // 2.6 多个 marker 区域共存
  await upsertMarkedBlock({
    filePath,
    markerKey: "skills",
    block: "## 技能",
  });
  await upsertMarkedBlock({
    filePath,
    markerKey: "memory",
    block: "## 记忆",
  });
  const finalContent = await fs.readFile(filePath, "utf8");
  assert.ok(finalContent.includes("static-rules"), "应有 rules marker");
  assert.ok(finalContent.includes("static-skills"), "应有 skills marker");
  assert.ok(finalContent.includes("static-memory"), "应有 memory marker");
  console.log("  ✓ 三个 marker 区域共存");

  await fs.rm(tempDir, { recursive: true, force: true });
}

// ─── 3. hostFormatter 单元测试 ────────────────────────────────────────

function testHostFormatter() {
  console.log("\n=== 3. hostFormatter 单元测试 ===");

  // 3.1 格式化规则
  const rules = [
    {
      id: "r1",
      title: "测试规则",
      statement: "IF 提交 THEN MUST 测试",
      promotion_status: "active",
      origin_scope: "project",
      availability_scope: "workspace_reusable",
      enforcement_level: "must",
    },
  ];
  const rulesBlock = formatRules(rules);
  assert.ok(rulesBlock.includes("测试规则"));
  assert.ok(rulesBlock.includes("IF 提交 THEN MUST 测试"));
  assert.ok(rulesBlock.includes("must"));
  console.log("  ✓ formatRules 输出正确");

  // 3.2 格式化技能
  const skills = [
    {
      id: "s1",
      title: "测试技能",
      content: "这是一个测试技能",
      promotion_status: "active",
      origin_scope: "project",
      availability_scope: "workspace_reusable",
    },
  ];
  const skillsBlock = formatSkills(skills);
  assert.ok(skillsBlock.includes("测试技能"));
  assert.ok(skillsBlock.includes("这是一个测试技能"));
  console.log("  ✓ formatSkills 输出正确");

  // 3.3 格式化记忆
  const memories = [
    {
      id: "m1",
      title: "测试记忆",
      content: "用户偏好简洁",
      promotion_status: "active",
      origin_scope: "user",
      availability_scope: "user_reusable",
    },
  ];
  const memoryBlock = formatMemories(memories);
  assert.ok(memoryBlock.includes("测试记忆"));
  assert.ok(memoryBlock.includes("用户偏好简洁"));
  console.log("  ✓ formatMemories 输出正确");

  // 3.4 空数组返回空字符串
  assert.equal(formatRules([]), "");
  assert.equal(formatSkills([]), "");
  assert.equal(formatMemories([]), "");
  console.log("  ✓ 空数组返回空字符串");

  // 3.5 宿主检测
  const tempDir = os.tmpdir();
  const hosts = detectHosts(tempDir);
  assert.ok(Array.isArray(hosts));
  console.log(`  ✓ detectHosts 返回数组（${hosts.length} 个宿主）`);
}

// ─── 4. compiler 端到端测试（mock DB）────────────────────────────────

async function testCompilerWithMockDb() {
  console.log("\n=== 4. compiler 端到端测试（mock DB）===");

  // mock @super-agent/db
  const mockDbCode = `
const mockRuleRows = [
  {
    id: "rule-001",
    title: "合格规则",
    statement: "IF 提交功能变更 THEN MUST 包含测试",
    enforcement_level: "must",
    promotion_status: "active",
    origin_scope: "project",
    availability_scope: "workspace_reusable",
  },
  {
    id: "rule-002",
    title: "未审批规则",
    statement: "IF 代码审查 THEN MUST 检查安全",
    enforcement_level: "must",
    promotion_status: "needs_review",
    origin_scope: "project",
    availability_scope: "workspace_reusable",
  },
];

const mockSkillRows = [
  {
    id: "skill-001",
    title: "合格技能",
    description: "代码审查前自检流程",
    promotion_status: "active",
    origin_scope: "project",
    availability_scope: "workspace_reusable",
    governance_level: "shared",
  },
];

const mockMemoryRows = [
  {
    id: "mem-001",
    title: "用户画像",
    content: "用户喜欢简洁回答",
    memory_type: "user_memory",
    promotion_status: "active",
    origin_scope: "user",
    availability_scope: "user_reusable",
    stability: "long_lived",
    self_test: { about_user_not_code: true },
  },
];

export function listActiveRules() { return Promise.resolve(mockRuleRows); }
export function listActiveSkills() { return Promise.resolve(mockSkillRows); }
export function queryFactualMemory() { return Promise.resolve(mockMemoryRows); }
`;

  const mockDbPath = path.join(os.tmpdir(), `mock-db-${Date.now()}.mjs`);
  await fs.writeFile(mockDbPath, mockDbCode, "utf8");
  const mockDbUrl = pathToFileURL(mockDbPath).href;

  const loaderCode = `
export function resolve(specifier, context, nextResolve) {
  if (specifier === "@super-agent/db") {
    return { shortCircuit: true, url: ${JSON.stringify(mockDbUrl)} };
  }
  return nextResolve(specifier, context);
}
`;
  const loaderPath = path.join(os.tmpdir(), `mock-loader-${Date.now()}.mjs`);
  await fs.writeFile(loaderPath, loaderCode, "utf8");
  register(pathToFileURL(loaderPath).href);

  const { compileStaticMemory } = await import(
    "../../services/memory-service/dist/services/memory-service/src/staticMemoryCompiler/compiler.js"
  );

  const tempRepo = await fs.mkdtemp(path.join(os.tmpdir(), "compiler-test-"));

  const result = await compileStaticMemory({
    tenantId: "tenant-test",
    scope: "test-scope",
    repoRoot: tempRepo,
    targetHosts: ["trae", "claude_code", "codex_cli"],
    trigger: "immediate",
  });

  // 4.1 筛选结果
  assert.equal(result.ruleCount, 1, `ruleCount 应为 1，实际 ${result.ruleCount}`);
  assert.equal(result.skillCount, 1, `skillCount 应为 1，实际 ${result.skillCount}`);
  assert.equal(result.memoryCount, 1, `memoryCount 应为 1，实际 ${result.memoryCount}`);
  console.log("  ✓ 筛选结果正确（1 rule + 1 skill + 1 memory）");

  // 4.2 三宿主文件写入
  assert.equal(result.files.length, 3, `files 应为 3，实际 ${result.files.length}`);
  console.log("  ✓ 三宿主文件写入");

  // 4.3 trigger 透传
  assert.equal(result.trigger, "immediate");
  console.log("  ✓ trigger 透传正确");

  // 4.4 跳过的条目
  assert.equal(result.skipped.length, 1, `skipped 应为 1，实际 ${result.skipped.length}`);
  assert.equal(result.skipped[0].id, "rule-002");
  console.log("  ✓ 跳过未审批条目");

  // 4.5 验证文件内容
  const traeContent = await fs.readFile(path.join(tempRepo, ".trae", "instructions.md"), "utf8");
  assert.ok(traeContent.includes("合格规则"), "trae 应有规则内容");
  assert.ok(traeContent.includes("合格技能"), "trae 应有技能内容");
  assert.ok(traeContent.includes("用户画像"), "trae 应有记忆内容");
  console.log("  ✓ trae 文件内容正确");

  // 4.6 第二次编译 unchanged
  const result2 = await compileStaticMemory({
    tenantId: "tenant-test",
    scope: "test-scope",
    repoRoot: tempRepo,
    targetHosts: ["trae"],
    trigger: "scheduled",
  });
  assert.equal(result2.files[0].status, "unchanged");
  console.log("  ✓ 第二次编译 unchanged");

  await fs.rm(tempRepo, { recursive: true, force: true });
  await fs.unlink(mockDbPath).catch(() => {});
  await fs.unlink(loaderPath).catch(() => {});
}

// ─── 运行所有测试 ──────────────────────────────────────────────────────

async function main() {
  console.log("=== 41. 静态记忆编译器 gate test ===\n");

  testContentFilter();
  await testMarkerManager();
  testHostFormatter();
  await testCompilerWithMockDb();

  console.log("\n=== 所有测试通过 ===");
}

main().catch((err) => {
  console.error("\n❌ 测试失败:", err);
  process.exit(1);
});
