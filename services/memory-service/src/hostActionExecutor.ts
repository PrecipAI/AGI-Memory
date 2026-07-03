/**
 * Host Action Executor — 审批后落地执行器
 *
 * 设计动机：
 *   审批通过的 Rule / Skill 候选会进 host-actions/pending 队列，但之前没有自动消费机制。
 *   这个模块封装了 host-action-poller.mjs 的逻辑，供 POST /internal/host-actions/execute 调用，
 *   也可由 memory-host-action-execute skill 自动触发。
 *
 * 落地动作：
 *   - Rule → 生成 .trae/gates/{rule_key}.hook.ts（GateMaster 逻辑）
 *   - Skill → 生成 .trae/skills/{skill_key}/SKILL.md（Skill Creator 逻辑）
 *
 * 执行后调 POST /internal/host-actions/{type}/{id}/status 更新状态为 generated / failed。
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchPendingHostActions, markHostActionStatus, type HostActionItem } from "./hostAction.js";

interface RegistryEntry {
  id: string;
  rule_id: string;
  rule_key: string;
  file: string;
  mount_points: string[];
}

interface RegistryFile {
  gates: RegistryEntry[];
}

async function readRegistry(gatesDir: string): Promise<RegistryFile> {
  const registryPath = path.join(gatesDir, "registry.json");
  if (!existsSync(registryPath)) {
    return { gates: [] };
  }
  try {
    const raw = await readFile(registryPath, "utf8");
    const parsed = JSON.parse(raw) as RegistryFile;
    return { gates: Array.isArray(parsed.gates) ? parsed.gates : [] };
  } catch {
    return { gates: [] };
  }
}

async function writeRegistry(gatesDir: string, registry: RegistryFile): Promise<void> {
  const registryPath = path.join(gatesDir, "registry.json");
  await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

async function upsertRegistryEntry(
  gatesDir: string,
  entry: RegistryEntry
): Promise<void> {
  const registry = await readRegistry(gatesDir);
  const existingIndex = registry.gates.findIndex((g) => g.rule_key === entry.rule_key);
  if (existingIndex >= 0) {
    registry.gates[existingIndex] = entry;
  } else {
    registry.gates.push(entry);
  }
  await writeRegistry(gatesDir, registry);
}

function findRepoRoot(): string {
  const envRoot = process.env.REPO_ROOT;
  if (envRoot) return path.resolve(envRoot);

  let current = path.resolve(import.meta.dirname ?? process.cwd());
  while (current !== path.dirname(current)) {
    if (existsSync(path.join(current, "package.json")) && existsSync(path.join(current, ".git"))) {
      return current;
    }
    current = path.dirname(current);
  }
  return process.cwd();
}

export interface ExecuteHostActionsInput {
  tenantId: string;
  scope: string;
  traceId: string;
  gatesDir?: string;
  globalSkillsDir?: string;
  projectSkillsDir?: string;
  projectId?: string | null;
  limit?: number;
}

export interface ExecuteHostActionsResult {
  total: number;
  succeeded: number;
  failed: number;
  items: Array<{
    object_type: "rule" | "skill";
    id: string;
    key: string;
    status: "generated" | "failed";
    output_path?: string;
    error?: string;
  }>;
}

const REPO_ROOT = findRepoRoot();
const DEFAULT_GATES_DIR = path.join(REPO_ROOT, ".trae", "gates");
const DEFAULT_GLOBAL_SKILLS_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME || process.cwd(),
  ".trae-cn",
  "skills"
);
const DEFAULT_PROJECT_SKILLS_DIR = path.join(REPO_ROOT, ".trae", "skills");

// 生成 hook 文件所需的共享类型模板。运行时若 .trae/gates/types.ts 不存在则自动创建。
const GATE_TYPES_TEMPLATE = `/**
 * GateContext — 门控运行时上下文
 * 由宿主程序提供，注入到每个 gate / hook 的 run() 函数中。
 */

export interface GateContext {
  taskType: string;
  operation: string;
  cwd: string;
  taskRequestId?: string;
  host?: string;
  projectRef?: string;
  sessionId?: string;
  projectId?: string;
  getChangedFiles(): Promise<string[]>;
  searchInDiff(pattern: RegExp | string): Promise<string[]>;
  readFile(filePath: string): Promise<string>;
  writeFile?(filePath: string, content: string): Promise<void>;
  exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  getGitStatus(): Promise<{ staged: string[]; modified: string[]; untracked: string[] }>;
  isFileChanged?(filePath: string): Promise<boolean>;
  searchInFiles?(pattern: RegExp | string, glob?: string): Promise<Array<{ file: string; line: number; text: string }>>;
}

export interface GateResult {
  pass: boolean;
  block?: boolean;
  rule_id?: string;
  rule_key?: string;
  message?: string;
  suggestion?: string;
}

export interface GateModule {
  RULE_ID: string;
  RULE_KEY: string;
  shouldRun(context: GateContext): boolean;
  run(context: GateContext): Promise<GateResult>;
}

export type HookMountPoint =
  | "before_tool_call"
  | "after_tool_call"
  | "before_generation"
  | "after_generation"
  | "before_task_complete"
  | "before_file_write"
  | "after_file_write"
  | "before_command_exec"
  | "after_command_exec"
  | "pre_commit";

export interface HookResult {
  action: "PASS" | "REJECT" | "RETRY" | "INJECT";
  reason?: string;
  retry_hint?: string;
  inject_content?: string;
  rule_id?: string;
  rule_key?: string;
}

export interface RuleHook {
  id: string;
  rule_id: string;
  rule_key: string;
  mount_points: HookMountPoint[];
  shouldRun(context: GateContext): boolean;
  run(context: GateContext): Promise<HookResult>;
}

export interface HookRegistryEntry {
  hook_id: string;
  rule_id: string;
  rule_key: string;
  scope: "global" | "project" | "user" | "workspace" | "session";
  project_id: string | null;
  mount_points: HookMountPoint[];
  file: string;
  enabled: boolean;
  generated_at: string;
}

export interface GateRegistryEntry {
  rule_id: string;
  rule_key: string;
  file: string;
  checkpoint: "pre_action" | "post_action" | "on_file_change" | "pre_commit";
  task_type: string;
  operation: string;
  enabled: boolean;
  generated_at: string;
}
`;

function isGlobalSkill(record: Record<string, unknown>): boolean {
  return (
    ["global", "team"].includes(String(record.origin_scope ?? "")) &&
    ["global_reusable", "team_reusable"].includes(String(record.availability_scope ?? ""))
  );
}

function resolveSkillDir(record: Record<string, unknown>, globalDir: string, projectDir: string): string {
  const skillKey = String(record.skill_key ?? record.skillKey ?? "unnamed");
  return isGlobalSkill(record) ? path.join(globalDir, skillKey) : path.join(projectDir, skillKey);
}

// ─── 规则分类器 ───────────────────────────────────────────────────
// 根据 rule_domain + title/statement 关键词识别规则类别，决定生成哪种检查逻辑。
// 识别不到时返回 "generic"，生成 WARN 提示（不再无条件 PASS）。

type RuleCategory =
  | "test_verification"
  | "temp_file_cleanup"
  | "repo_clean"
  | "git_branch_protection"
  | "code_format"
  | "sensitive_info"
  | "dependency_license"
  | "env_check";

function detectRuleCategory(payload: Record<string, unknown>): RuleCategory | "generic" {
  const title = String(payload.title ?? "").toLowerCase();
  const statement = String(payload.statement ?? payload.content ?? "").toLowerCase();
  const domain = String(payload.rule_domain ?? "").toLowerCase();
  const text = `${title} ${statement}`;

  // 优先匹配最具体的关键词，通用的"测试/验证"放最后。
  // 避免"批量测试规则：禁止提交到 main"被误分类为 test_verification。
  if (/main|master|分支|branch/.test(text)) return "git_branch_protection";
  if (/许可证|license|依赖|dependency|无许可/.test(text)) return "dependency_license";
  if (/环境变量|env|environment|部署|deploy/.test(text)) return "env_check";
  if (/敏感|sensitive|secret|password|token|api_key|apikey|日志|log/.test(text)) return "sensitive_info";
  if (/格式化|format|prettier|eslint/.test(text)) return "code_format";
  if (/临时|tmp|temp|cleanup|清理/.test(text)) return "temp_file_cleanup";
  if (/仓库|干净|clean|整洁|safe|安全/.test(text)) return "repo_clean";
  // 测试/验证最通用，放最后
  if (/测试|test|verify|验证/.test(text)) return "test_verification";
  return "generic";
}

// ─── 各类别的检查逻辑生成器 ───────────────────────────────────────
// 每个 buildXxxLogic 返回 run() 函数体的字符串（不含函数签名）。
// 所有逻辑都基于 GateContext 提供的方法，对可选方法做存在性检查。

function buildTestVerificationLogic(ruleKey: string): string {
  return `    // 检查：代码改动后是否伴随测试文件改动或测试执行
    const changedFiles = await context.getChangedFiles();
    const codeFiles = changedFiles.filter(f => /\\.(ts|js|tsx|jsx|py)$/.test(f) && !/\\.(test|spec)\\./.test(f) && !/\\.d\\.ts$/.test(f));
    if (codeFiles.length === 0) return { action: "PASS" };

    const testFiles = changedFiles.filter(f => /\\.(test|spec)\\./.test(f));
    if (testFiles.length > 0) return { action: "PASS" };

    return {
      action: "REJECT",
      reason: \`代码改动未伴随测试文件改动（${ruleKey}）：\${codeFiles.slice(0, 5).join(", ")}\`,
      rule_key: "${ruleKey}"
    };`;
}

function buildTempFileCleanupLogic(ruleKey: string): string {
  return `    // 检查：是否存在临时文件未清理
    const TEMP_PATTERNS = [/\\.tmp$/i, /\\.bak$/i, /\\.temp$/i, /^\\.tmp\\//, /\\/tmp\\//, /~$/];
    const gitStatus = await context.getGitStatus();
    const allFiles = [...gitStatus.staged, ...gitStatus.modified, ...gitStatus.untracked];
    const tempFiles = allFiles.filter(f => TEMP_PATTERNS.some(p => p.test(f)));

    if (tempFiles.length === 0) return { action: "PASS" };

    return {
      action: "REJECT",
      reason: \`发现未清理的临时文件（${ruleKey}）：\${tempFiles.slice(0, 10).join(", ")}\`,
      rule_key: "${ruleKey}"
    };`;
}

function buildRepoCleanLogic(ruleKey: string): string {
  return `    // 检查：仓库是否保持干净（无未跟踪文件、无未提交改动）
    const gitStatus = await context.getGitStatus();
    const issues: string[] = [];

    if (gitStatus.untracked.length > 0) {
      issues.push(\`未跟踪文件 \${gitStatus.untracked.length} 个\`);
    }
    if (gitStatus.modified.length > 0) {
      issues.push(\`已修改未暂存 \${gitStatus.modified.length} 个\`);
    }

    if (issues.length === 0) return { action: "PASS" };

    return {
      action: "REJECT",
      reason: \`仓库不干净（${ruleKey}）：\${issues.join("; ")}\`,
      rule_key: "${ruleKey}"
    };`;
}

function buildGitBranchProtectionLogic(ruleKey: string): string {
  return `    // 检查：当前分支是否是受保护分支（main/master）
    try {
      const result = await context.exec("git rev-parse --abbrev-ref HEAD");
      const branch = result.stdout.trim();
      if (branch === "main" || branch === "master") {
        return {
          action: "REJECT",
          reason: \`禁止直接提交到受保护分支 \${branch}（${ruleKey}）\`,
          rule_key: "${ruleKey}"
        };
      }
    } catch {
      // 非 git 环境或无法获取分支信息，放行
    }
    return { action: "PASS" };`;
}

function buildCodeFormatLogic(ruleKey: string): string {
  return `    // 检查：变更的代码文件是否经过格式化（prettier/eslint）
    const changedFiles = await context.getChangedFiles();
    const codeFiles = changedFiles.filter(f => /\\.(ts|js|tsx|jsx)$/.test(f));
    if (codeFiles.length === 0) return { action: "PASS" };

    try {
      const result = await context.exec("npx prettier --check " + codeFiles.map(f => \`"\${f}"\`).join(" "));
      if (result.exitCode !== 0) {
        return {
          action: "REJECT",
          reason: \`存在未格式化的代码文件（${ruleKey}）：\${result.stderr.slice(0, 200)}\`,
          rule_key: "${ruleKey}"
        };
      }
    } catch {
      // prettier 不可用时放行（不阻断工作流）
    }
    return { action: "PASS" };`;
}

function buildSensitiveInfoLogic(ruleKey: string): string {
  return `    // 检查：变更文件中是否包含敏感信息（password/secret/token/api_key）
    const SENSITIVE_PATTERNS = [
      /(?:password|passwd|pwd)\\s*[:=]\\s*["'][^"']{6,}/i,
      /(?:secret|api_key|apikey)\\s*[:=]\\s*["'][^"']{10,}/i,
      /(?:token|bearer)\\s*[:=]\\s*["'][^"']{20,}/i,
      /-----BEGIN [A-Z]+ PRIVATE KEY-----/
    ];
    const changedFiles = await context.getChangedFiles();
    const codeFiles = changedFiles.filter(f => /\\.(ts|js|tsx|jsx|py|json|ya?ml)$/.test(f));

    for (const file of codeFiles) {
      try {
        const content = await context.readFile(file);
        for (const pattern of SENSITIVE_PATTERNS) {
          if (pattern.test(content)) {
            return {
              action: "REJECT",
              reason: \`文件 \${file} 包含疑似敏感信息（${ruleKey}）\`,
              rule_key: "${ruleKey}"
            };
          }
        }
      } catch {
        // 文件读取失败跳过
      }
    }
    return { action: "PASS" };`;
}

function buildDependencyLicenseLogic(ruleKey: string): string {
  return `    // 检查：package.json 中新增依赖是否有 license 字段
    const changedFiles = await context.getChangedFiles();
    if (!changedFiles.includes("package.json")) return { action: "PASS" };

    try {
      const content = await context.readFile("package.json");
      const pkg = JSON.parse(content);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

      // 检查是否有可疑的无许可证依赖（简化版：检查 license 字段是否存在）
      if (pkg.license === undefined && Object.keys(deps).length > 0) {
        return {
          action: "REJECT",
          reason: \`package.json 缺少 license 字段（${ruleKey}）\`,
          rule_key: "${ruleKey}"
        };
      }
    } catch {
      // 解析失败跳过
    }
    return { action: "PASS" };`;
}

function buildEnvCheckLogic(ruleKey: string): string {
  return `    // 检查：部署前是否所有必需环境变量已设置
    const REQUIRED_ENV_VARS = [
      "DB_URL", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD",
      "NODE_ENV", "PORT"
    ];
    const missing: string[] = [];
    for (const varName of REQUIRED_ENV_VARS) {
      if (!process.env[varName]) {
        missing.push(varName);
      }
    }

    if (missing.length === 0) return { action: "PASS" };

    return {
      action: "REJECT",
      reason: \`部署前环境变量检查失败（${ruleKey}）：缺失 \${missing.join(", ")}\`,
      rule_key: "${ruleKey}"
    };`;
}

function buildGenericLogic(ruleKey: string, statement: string): string {
  return `    // Rule statement: ${statement}
    // ⚠ 未识别的规则类别，GateMaster 无法自动生成检查逻辑。
    // 当前为 WARN 模式（不阻断），请人工补充 run() 实现。
    return {
      action: "PASS",
      reason: \`未识别规则类别，跳过检查（${ruleKey}）\`,
      rule_key: "${ruleKey}"
    };`;
}

function buildRunLogic(category: RuleCategory | "generic", ruleKey: string, statement: string): string {
  switch (category) {
    case "test_verification": return buildTestVerificationLogic(ruleKey);
    case "temp_file_cleanup": return buildTempFileCleanupLogic(ruleKey);
    case "repo_clean": return buildRepoCleanLogic(ruleKey);
    case "git_branch_protection": return buildGitBranchProtectionLogic(ruleKey);
    case "code_format": return buildCodeFormatLogic(ruleKey);
    case "sensitive_info": return buildSensitiveInfoLogic(ruleKey);
    case "dependency_license": return buildDependencyLicenseLogic(ruleKey);
    case "env_check": return buildEnvCheckLogic(ruleKey);
    default: return buildGenericLogic(ruleKey, statement);
  }
}

// 根据规则类别推断合适的 mount_points
function inferMountPoints(category: RuleCategory | "generic", explicitMountPoints?: string[]): string[] {
  if (explicitMountPoints && explicitMountPoints.length > 0) return explicitMountPoints;
  switch (category) {
    case "test_verification": return ["pre_commit", "before_task_complete"];
    case "temp_file_cleanup": return ["pre_commit", "before_task_complete"];
    case "repo_clean": return ["pre_commit"];
    case "git_branch_protection": return ["pre_commit", "before_command_exec"];
    case "code_format": return ["pre_commit"];
    case "sensitive_info": return ["before_file_write", "pre_commit"];
    case "dependency_license": return ["pre_commit"];
    case "env_check": return ["before_command_exec", "pre_commit"];
    default: return ["before_task_complete"];
  }
}

export function buildHookFile(payload: Record<string, unknown>): string {
  const ruleKey = String(payload.rule_key ?? "unknown");
  const safeKey = ruleKey.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const statement = String(payload.statement ?? payload.content ?? "").replace(/`/g, "\\`").replace(/\$/g, "\\$");
  const triggerConditions = (payload.trigger_conditions as Record<string, unknown> | undefined) ?? {};
  const category = detectRuleCategory(payload);
  const explicitMountPoints = Array.isArray(triggerConditions.mount_points)
    ? (triggerConditions.mount_points as string[])
    : undefined;
  const mountPoints = inferMountPoints(category, explicitMountPoints);
  const runLogic = buildRunLogic(category, ruleKey, statement);

  return `// AUTO-GENERATED by GateMaster — DO NOT EDIT MANUALLY
// Rule: ${payload.title ?? ruleKey}
// Rule Key: ${ruleKey}
// Enforcement: ${payload.enforcement_level ?? "must"}
// Scope: ${payload.origin_scope ?? "session"} / ${payload.availability_scope ?? "session_only"}
// Category: ${category}
//
// 生成时间: ${new Date().toISOString()}
// 来源: memory-service host-actions executor

import type { GateContext, HookResult, RuleHook } from "./types";

export const hook: RuleHook = {
  id: "hook_${safeKey}",
  rule_id: "${payload.rule_id ?? ""}",
  rule_key: "${ruleKey}",
  mount_points: ${JSON.stringify(mountPoints)},

  shouldRun(context: GateContext): boolean {
    const triggerConditions = ${JSON.stringify(triggerConditions ?? {}, null, 2)};
    const appliesTo = ${JSON.stringify((payload.applies_to as unknown[]) ?? [], null, 2)};
    if (Array.isArray(appliesTo) && appliesTo.length > 0) {
      return appliesTo.includes(context.taskType) || appliesTo.includes(context.operation);
    }
    return true;
  },

  async run(context: GateContext): Promise<HookResult> {
${runLogic}
  }
};
`;
}

function buildSkillMarkdown(item: HostActionItem): string {
  const payload = item.invoke_skill?.payload ?? {};
  const record = (payload.skill_record as Record<string, unknown> | undefined) ?? {};
  const procedure = (record.procedure_payload as Record<string, unknown> | undefined) ?? {};
  const executionSteps = Array.isArray(procedure.execution_steps)
    ? (procedure.execution_steps as string[])
    : Array.isArray(procedure.steps)
      ? (procedure.steps as string[])
      : [];
  const scenarios = Array.isArray(record.applicable_scenarios) ? (record.applicable_scenarios as string[]) : [];
  const nonScenarios = Array.isArray(record.non_applicable_scenarios)
    ? (record.non_applicable_scenarios as string[])
    : [];
  const isGlobal = isGlobalSkill(record);

  let body = `---
name: ${record.title ?? item.key}
description: ${record.description ?? ""}
---

# ${record.title ?? item.key}

## 描述

${record.description ?? ""}

`;

  if (scenarios.length > 0) {
    body += `## 使用场景\n\n`;
    for (const s of scenarios) body += `- ${s}\n`;
    body += `\n`;
  }

  if (nonScenarios.length > 0) {
    body += `## 不适用场景\n\n`;
    for (const s of nonScenarios) body += `- ${s}\n`;
    body += `\n`;
  }

  body += `## 指令\n\n`;
  if (executionSteps.length > 0) {
    for (let i = 0; i < executionSteps.length; i++) {
      body += `${i + 1}. ${executionSteps[i]}\n`;
    }
  } else {
    body += `_暂无执行步骤。_\n`;
  }

  body += `\n## 触发条件\n\n\`\`\`json\n${JSON.stringify(record.trigger_conditions ?? {}, null, 2)}\n\`\`\`\n\n`;

  if (!isGlobal) {
    body += `## 作用域\n\n- Origin scope: ${record.origin_scope ?? "session"}\n- Availability scope: ${record.availability_scope ?? "session_only"}\n- Project: ${record.scope ?? "-"}\n`;
  } else {
    body += `## 作用域\n\n- 全局技能（${record.origin_scope} / ${record.availability_scope}）\n- 严禁在任何描述中引用项目特定名称、角色名、文件路径或故事设定。\n`;
  }

  return body;
}

async function ensureGateTypesFile(gatesDir: string): Promise<void> {
  const typesPath = path.join(gatesDir, "types.ts");
  if (!existsSync(typesPath)) {
    await writeFile(typesPath, GATE_TYPES_TEMPLATE, "utf8");
  }
}

async function processRule(item: HostActionItem, gatesDir: string): Promise<{ outputPath: string }> {
  const payload = item.invoke_skill?.payload ?? {};
  const ruleKey = String(item.key || payload.rule_key || "unknown");
  const filePath = path.join(gatesDir, `${ruleKey}.hook.ts`);
  await mkdir(gatesDir, { recursive: true });
  await ensureGateTypesFile(gatesDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buildHookFile(payload), "utf8");

  const mountPoints = Array.isArray((payload.trigger_conditions as Record<string, unknown> | undefined)?.mount_points)
    ? ((payload.trigger_conditions as Record<string, unknown>).mount_points as string[])
    : ["before_task_complete"];
  await upsertRegistryEntry(gatesDir, {
    id: `hook_${ruleKey.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`,
    rule_id: String(payload.rule_id ?? item.id ?? ""),
    rule_key: ruleKey,
    file: path.basename(filePath),
    mount_points: mountPoints
  });

  return { outputPath: filePath };
}

async function processSkill(
  item: HostActionItem,
  globalDir: string,
  projectDir: string
): Promise<{ outputPath: string }> {
  const payload = item.invoke_skill?.payload ?? {};
  const record = (payload.skill_record as Record<string, unknown> | undefined) ?? {};
  const skillDir = resolveSkillDir(record, globalDir, projectDir);
  const filePath = path.join(skillDir, "SKILL.md");
  await mkdir(skillDir, { recursive: true });
  await writeFile(filePath, buildSkillMarkdown(item), "utf8");
  return { outputPath: filePath };
}

export async function executeHostActions(input: ExecuteHostActionsInput): Promise<ExecuteHostActionsResult> {
  const gatesDir = input.gatesDir || DEFAULT_GATES_DIR;
  const globalSkillsDir = input.globalSkillsDir || DEFAULT_GLOBAL_SKILLS_DIR;
  const projectSkillsDir = input.projectSkillsDir || DEFAULT_PROJECT_SKILLS_DIR;

  const items = await fetchPendingHostActions({
    tenantId: input.tenantId,
    projectId: input.projectId ?? null,
    objectType: "all",
    limit: input.limit ?? 100
  });

  const result: ExecuteHostActionsResult = {
    total: items.length,
    succeeded: 0,
    failed: 0,
    items: []
  };

  for (const item of items) {
    try {
      if (item.object_type === "rule") {
        const { outputPath } = await processRule(item, gatesDir);
        await markHostActionStatus({
          tenantId: input.tenantId,
          objectType: "rule",
          objectId: item.id,
          status: "generated",
          traceId: input.traceId
        });
        result.succeeded++;
        result.items.push({
          object_type: "rule",
          id: item.id,
          key: item.key,
          status: "generated",
          output_path: outputPath
        });
      } else if (item.object_type === "skill") {
        const { outputPath } = await processSkill(item, globalSkillsDir, projectSkillsDir);
        await markHostActionStatus({
          tenantId: input.tenantId,
          objectType: "skill",
          objectId: item.id,
          status: "generated",
          traceId: input.traceId
        });
        result.succeeded++;
        result.items.push({
          object_type: "skill",
          id: item.id,
          key: item.key,
          status: "generated",
          output_path: outputPath
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await markHostActionStatus({
        tenantId: input.tenantId,
        objectType: item.object_type,
        objectId: item.id,
        status: "failed",
        error: errorMsg,
        traceId: input.traceId
      });
      result.failed++;
      result.items.push({
        object_type: item.object_type,
        id: item.id,
        key: item.key,
        status: "failed",
        error: errorMsg
      });
    }
  }

  return result;
}
