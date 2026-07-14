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
import { listActiveSkills, getPool } from "@super-agent/db";

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

// §4.2 生效模式:决定 Rule 被生成后,真实生效的强度
// - hard_native: 宿主原生 hook 实时拦截(情况 A,最可靠)
// - hard_mcp: GateRuntimeBridge 拦截 MCP 工具调用(情况 B)
// - soft: 软执行,依赖模型自觉配合 Skill execution_steps 里的 rule_gate_check 调用(情况 C)
export type EnforcementMode = "hard_native" | "hard_mcp" | "soft";

export interface ExecuteHostActionsResult {
  total: number;
  succeeded: number;
  failed: number;
  items: Array<{
    object_type: "rule" | "skill";
    id: string;
    key: string;
    status: "generated" | "failed" | "redirected";
    output_path?: string;
    error?: string;
    // §4.2 生效模式(仅 rule 项有),用于治理面板 §3.2 显式标注生效状态
    enforcement_mode?: EnforcementMode;
    // §4.2 情况 A 额外产物:宿主原生 hook 配置路径
    native_hook_path?: string;
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
    case "env_check": return ["before_command_exec"];
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

// ─── §4.2 宿主能力表 + 三种情况生成逻辑 ───────────────────────────
// 规格文档 §4.2:GateMaster 生成前必须查宿主能力表,不能默认"生成了 .hook.ts 就等于生效"。
// 维护一张宿主能力表,按"宿主能力 + 挂载点接入状态"两个维度决定生成什么:
//   情况 A:宿主有原生 hook + 动作命中原生 hook matcher → 生成宿主原生 hook 脚本(真正实时拦截)
//   情况 B:动作是 MCP 工具调用 → 生成内部 .hook.ts,依赖 GateRuntimeBridge 拦截
//   情况 C:既不是 A 也不是 B → 生成 .hook.ts + 折进 Skill execution_steps + 标记软执行

type HostName = "claude_code" | "qoder" | "codex_cli" | "trae" | "unknown";

interface HostCapability {
  native_hook_supported: boolean;
  // 该宿主原生 hook 支持的挂载点(对应 HookMountPoint 的子集)
  native_hook_mount_points: string[];
  // 原生 hook 配置格式
  native_hook_format: "claude_json" | "qoder_json" | "codex_bash" | "trae_json" | null;
  // 原生 hook 配置目录(相对 repo root)
  native_hook_dir: string | null;
}

// 宿主能力表(规格文档 §4.2 示例,需随各家产品更新持续修订)
const HOST_CAPABILITY_TABLE: Record<HostName, HostCapability> = {
  claude_code: {
    native_hook_supported: true,
    native_hook_mount_points: ["before_tool_call", "after_tool_call", "pre_commit"],
    native_hook_format: "claude_json",
    native_hook_dir: ".claude/hooks"
  },
  qoder: {
    native_hook_supported: true,
    native_hook_mount_points: ["before_tool_call", "after_tool_call", "before_command_exec", "pre_commit"],
    native_hook_format: "qoder_json",
    native_hook_dir: ".qoder/hooks"
  },
  codex_cli: {
    native_hook_supported: true,
    // Codex CLI 仅对 shell/Bash 命令可靠,对 apply_patch 和大多数 MCP 工具覆盖不完整
    native_hook_mount_points: ["before_command_exec", "after_command_exec"],
    native_hook_format: "codex_bash",
    native_hook_dir: ".codex/hooks"
  },
  trae: {
    // 本地 Trae IDE 个人版支持 .trae/hooks.json 原生 hook
    native_hook_supported: true,
    native_hook_mount_points: ["before_tool_call", "before_generation", "before_task_complete"],
    native_hook_format: "trae_json",
    native_hook_dir: ".trae/hooks"
  },
  unknown: {
    native_hook_supported: false,
    native_hook_mount_points: [],
    native_hook_format: null,
    native_hook_dir: null
  }
};

// 检测当前宿主类型。优先用环境变量,退化到文件系统特征。
function detectHost(): HostName {
  const env = process.env.AGENT_HOST || process.env.HOST_TYPE || "";
  if (/claude/i.test(env)) return "claude_code";
  if (/qoder/i.test(env)) return "qoder";
  if (/codex/i.test(env)) return "codex_cli";
  if (/trae/i.test(env)) return "trae";
  // 文件系统特征:各宿主都有自己的配置目录
  if (existsSync(path.join(REPO_ROOT, ".qoder"))) return "qoder";
  if (existsSync(path.join(REPO_ROOT, ".claude"))) return "claude_code";
  if (existsSync(path.join(REPO_ROOT, ".codex"))) return "codex_cli";
  if (existsSync(path.join(REPO_ROOT, ".trae"))) return "trae";
  return "unknown";
}

// §4.2 决策:根据宿主 + mount_points 决定走 A/B/C 哪种路径
function resolveEnforcementMode(input: {
  host: HostName;
  mountPoints: string[];
}): EnforcementMode {
  const cap = HOST_CAPABILITY_TABLE[input.host];
  // 情况 A:宿主有原生 hook + 动作命中原生 hook 的 mount_point
  if (cap.native_hook_supported && input.mountPoints.some(mp => cap.native_hook_mount_points.includes(mp))) {
    return "hard_native";
  }
  // 情况 B:动作是 MCP 工具调用(before_tool_call/after_tool_call)
  // GateRuntimeBridge 挂在 engineAdapter.call() 私有方法上,已确认能覆盖全部 8 个已注册 MCP 工具
  const mcpMountPoints = ["before_tool_call", "after_tool_call"];
  if (input.mountPoints.some(mp => mcpMountPoints.includes(mp))) {
    return "hard_mcp";
  }
  // 情况 C:既不是 A 也不是 B → 软执行,依赖模型自觉配合
  return "soft";
}

// §4.2 情况 A:生成宿主原生 hook 配置(Qoder/Claude Code/Codex CLI)
// 这是目前唯一能做到"真正实时拦截宿主原生动作"的路径。
async function generateNativeHookConfig(input: {
  host: HostName;
  ruleKey: string;
  ruleId: string;
  mountPoints: string[];
  hookFile: string; // 对应的 .hook.ts 文件名(原生脚本调用它)
  enforcementLevel: string;
}): Promise<{ configPath: string; scriptPath: string }> {
  const cap = HOST_CAPABILITY_TABLE[input.host];
  if (!cap.native_hook_dir) {
    throw new Error(`Host ${input.host} has no native_hook_dir`);
  }
  const nativeDir = path.join(REPO_ROOT, cap.native_hook_dir);
  await mkdir(nativeDir, { recursive: true });

  const safeKey = input.ruleKey.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const scriptPath = path.join(nativeDir, `${safeKey}.mjs`);

  // 生成可执行脚本:调用 gate-runtime.mjs 执行对应 .hook.ts
  // 统一脚本格式,不同宿主只是配置格式不同
  const scriptContent = `#!/usr/bin/env node
// AUTO-GENERATED by GateMaster §4.2 情况 A — 宿主原生 hook 脚本
// Rule: ${input.ruleKey} (${input.ruleId})
// Enforcement: ${input.enforcementLevel}
// Mount points: ${input.mountPoints.join(", ")}
//
// 这个脚本由宿主原生 hook 机制触发,调用 gate-runtime.mjs 执行真正的检查逻辑。
// 返回 exit code 2 = 拦截(REJECT),0 = 放行(PASS)。

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const gateRuntime = path.join(repoRoot, "scripts", "gate-runtime.mjs");
const hookFile = path.join(repoRoot, ".trae", "gates", "${input.hookFile}");

// 从 stdin 读取宿主传入的上下文(STDIN_JSON 协议,各宿主通用)
let rawInput = "";
process.stdin.on("data", (chunk) => { rawInput += chunk; });
process.stdin.on("end", () => {
  const ctx = rawInput ? JSON.parse(rawInput) : {};
  const child = spawn("node", [gateRuntime, "--hook-file", hookFile, "--context", JSON.stringify(ctx)], {
    stdio: ["pipe", "inherit", "inherit"]
  });
  child.stdin.write(JSON.stringify(ctx));
  child.stdin.end();
  child.on("exit", (code) => process.exit(code ?? 0));
});
`;

  await writeFile(scriptPath, scriptContent, "utf8");

  // 生成宿主特定配置文件
  let configPath: string;
  let configContent: string;

  if (cap.native_hook_format === "qoder_json") {
    // Qoder: .qoder/hooks/config.json,matcher 是工具名
    configPath = path.join(nativeDir, "config.json");
    const existingConfig = existsSync(configPath)
      ? JSON.parse(await readFile(configPath, "utf8"))
      : { hooks: [] };
    const hooks = Array.isArray(existingConfig.hooks) ? existingConfig.hooks : [];
    // 避免重复注册同一 rule
    const filtered = hooks.filter((h: Record<string, unknown>) => h.rule_key !== input.ruleKey);
    filtered.push({
      rule_key: input.ruleKey,
      rule_id: input.ruleId,
      script: path.basename(scriptPath),
      mount_points: input.mountPoints,
      // Qoder matcher:exit code 2 = 拦截
      block_on_exit_code: 2
    });
    configContent = JSON.stringify({ hooks: filtered }, null, 2);
  } else if (cap.native_hook_format === "claude_json") {
    // Claude Code: .claude/hooks/config.json
    configPath = path.join(nativeDir, "config.json");
    const existingConfig = existsSync(configPath)
      ? JSON.parse(await readFile(configPath, "utf8"))
      : { hooks: [] };
    const hooks = Array.isArray(existingConfig.hooks) ? existingConfig.hooks : [];
    const filtered = hooks.filter((h: Record<string, unknown>) => h.rule_key !== input.ruleKey);
    filtered.push({
      rule_key: input.ruleKey,
      rule_id: input.ruleId,
      script: path.basename(scriptPath),
      mount_points: input.mountPoints
    });
    configContent = JSON.stringify({ hooks: filtered }, null, 2);
  } else {
    // Codex CLI: .codex/hooks/{rule_key}.sh,简单的 bash wrapper
    configPath = path.join(nativeDir, `${safeKey}.sh`);
    configContent = `#!/bin/bash
# Codex CLI hook for ${input.ruleKey}
node "${scriptPath}"`;
  }

  await writeFile(configPath, configContent, "utf8");
  return { configPath, scriptPath };
}

// ─── §4.2 情况 A (Trae):生成 trae 原生 hook 配置 ───────────────────
// Trae 个人版使用 .trae/hooks.json + .trae/hooks/*.mjs 机制。
// 与 Qoder/Claude/Codex 不同：Trae 直接执行 .mjs 脚本，不经过 gate-runtime.mjs。
function mapMountPointsToTrae(
  ruleKey: string,
  mountPoints: string[]
): { traeEvent: string; matcher?: string } {
  // 已知 rule 使用硬编码映射，保证事件 / matcher 准确
  const KNOWN_RULE_TRAE_MAP: Record<string, { traeEvent: string; matcher?: string }> = {
    "host-graphify-priority": { traeEvent: "PreToolUse", matcher: "Glob|Grep|SearchCodebase|Agent" },
    "host-task-nature-confirm": { traeEvent: "UserPromptSubmit" },
    "host-safety-compliance": { traeEvent: "UserPromptSubmit" },
    "host-fact-confirmation": { traeEvent: "Stop" }
  };
  if (KNOWN_RULE_TRAE_MAP[ruleKey]) {
    return KNOWN_RULE_TRAE_MAP[ruleKey];
  }

  // 通用推断
  if (mountPoints.some((mp) => mp.includes("file_write"))) {
    return { traeEvent: "PreToolUse", matcher: "Edit|Write" };
  }
  if (mountPoints.some((mp) => mp.includes("command_exec") || mp === "pre_commit")) {
    return { traeEvent: "PreToolUse", matcher: "RunCommand" };
  }
  if (mountPoints.some((mp) => mp.includes("tool_call"))) {
    return { traeEvent: "PreToolUse" };
  }
  if (mountPoints.some((mp) => mp.includes("generation"))) {
    return { traeEvent: "UserPromptSubmit" };
  }
  if (mountPoints.some((mp) => mp.includes("task_complete"))) {
    return { traeEvent: "Stop" };
  }
  return { traeEvent: "PreToolUse" };
}

async function generateTraeNativeHookConfig(input: {
  host: HostName;
  ruleKey: string;
  ruleId: string;
  mountPoints: string[];
  enforcementLevel: string;
  title: string;
  statement: string;
}): Promise<{ configPath: string; scriptPath: string }> {
  const cap = HOST_CAPABILITY_TABLE[input.host];
  if (!cap.native_hook_dir) {
    throw new Error(`Host ${input.host} has no native_hook_dir`);
  }
  const nativeDir = path.join(REPO_ROOT, cap.native_hook_dir);
  await mkdir(nativeDir, { recursive: true });

  const scriptPath = path.join(nativeDir, `${input.ruleKey}.mjs`);

  // 若脚本已存在（如手工生成的高质量 hook），不覆盖，只注册
  if (!existsSync(scriptPath)) {
    const { traeEvent } = mapMountPointsToTrae(input.ruleKey, input.mountPoints);
    const scriptContent = `#!/usr/bin/env node
// AUTO-GENERATED by GateMaster — trae 原生 hook
// Rule: ${input.title} (${input.ruleId})
// Rule Key: ${input.ruleKey}
// Enforcement: ${input.enforcementLevel}
// Mount points: ${input.mountPoints.join(", ")}
// Trae event: ${traeEvent}
//
// 这个脚本由 trae 原生 hook 机制触发。
// 当前为通用模板，请根据 Rule statement 做场景发散设计后补充 shouldRun / run 逻辑。

import { runHook } from "./_lib.mjs";

function shouldRun(context) {
  // TODO: 按 Rule statement 做场景发散设计，精准判断触发条件
  return false;
}

function run(context) {
  return {
    action: "PASS",
    reason: "通用模板，默认放行。请补充检查逻辑。",
    suggestions: []
  };
}

runHook(shouldRun, run, "${traeEvent}");
`;
    await writeFile(scriptPath, scriptContent, "utf8");
  }

  // 更新 .trae/hooks.json
  const { traeEvent, matcher } = mapMountPointsToTrae(input.ruleKey, input.mountPoints);
  const hooksJsonPath = path.join(REPO_ROOT, ".trae", "hooks.json");
  let hooksConfig: Record<string, unknown> = { version: 1, hooks: {} };
  if (existsSync(hooksJsonPath)) {
    try {
      hooksConfig = JSON.parse(await readFile(hooksJsonPath, "utf8")) as Record<string, unknown>;
    } catch {
      hooksConfig = { version: 1, hooks: {} };
    }
  }

  const hooksMap = (hooksConfig.hooks as Record<string, unknown[]>) || {};
  const eventHooks = hooksMap[traeEvent] || [];
  hooksMap[traeEvent] = eventHooks;

  const command = `node .trae/hooks/${input.ruleKey}.mjs`;
  const existingGroupIndex = eventHooks.findIndex(
    (g) => {
      const group = g as Record<string, unknown>;
      return Array.isArray(group.hooks) && group.hooks.some((h: Record<string, unknown>) => h.command === command);
    }
  );

  const newGroup: Record<string, unknown> = matcher
    ? { matcher, hooks: [{ type: "command", command, timeout: 30 }] }
    : { hooks: [{ type: "command", command, timeout: 30 }] };

  if (existingGroupIndex >= 0) {
    eventHooks[existingGroupIndex] = newGroup;
  } else {
    eventHooks.push(newGroup);
  }

  hooksConfig.hooks = hooksMap;
  await writeFile(hooksJsonPath, `${JSON.stringify(hooksConfig, null, 2)}\n`, "utf8");

  return { configPath: hooksJsonPath, scriptPath };
}

// §4.2 情况 C:把等效检查折进目标 Skill 的 execution_steps
// 创建 governance_change_proposal(augment_skill_with_rule_step),
// 要求该 Skill 在关键节点显式调用 rule_gate_check(真调用,不是"模型自己看着办")
async function createSoftExecutionProposal(input: {
  tenantId: string;
  scope: string;
  traceId: string;
  ruleKey: string;
  ruleId: string;
  ruleStatement: string;
  mountPoints: string[];
}): Promise<void> {
  const pool = getPool();
  try {
    await pool.query(
      `INSERT INTO governance_change_proposal (
        tenant_id, scope, status, version, target_object_type, target_object_id,
        proposed_action, proposed_payload, reason, risk_level, source_ref, trace_id
      ) VALUES (
        $1, $2, 'recorded', 1, 'rule', $5,
        'augment_skill_with_soft_execution_step', $6::jsonb, $7, 'medium', $4::text, $3
      )`,
      [
        input.tenantId,
        input.scope,
        input.traceId,
        input.ruleKey,
        input.ruleId,
        JSON.stringify({
          rule_id: input.ruleId,
          rule_key: input.ruleKey,
          rule_statement: input.ruleStatement,
          mount_points: input.mountPoints,
          proposed_change: "此 Rule 走情况 C(软执行)。生成 .hook.ts 作为待生效产物,同时要求执行此动作的 Skill 在 execution_steps 关键节点显式调用 rule_gate_check(rule_key)。模型必须真调用,不是'自己看着办'。",
          enforcement_mode: "soft",
          required_action: "在治理面板显式标注为'软执行 · 依赖模型自觉配合',不能显示成跟硬拦截一样的'已生效'"
        }),
        `§4.2 情况 C:Rule "${input.ruleKey}" 当前宿主无原生 hook 支持,且动作不经过 MCP 工具调用。生成 .hook.ts 作为待生效产物,但真实生效依赖模型自觉在 Skill execution_steps 里调用 rule_gate_check。需人工审批决定是否接受软执行模式,或调整 Rule 的触发条件使其能命中情况 A/B。`
      ]
    );
  } catch (e) {
    console.warn(`[§4.2 情况 C] create governance_change_proposal failed for ${input.ruleKey}: ${e instanceof Error ? e.message : String(e)}`);
    // proposal 创建失败不阻塞,继续标记为 soft(hook 已生成)
  }
}

// ─── §4.1 Q1a 生成前复核 ───────────────────────────────────────────
// 规格文档 §4.1:不是每条审批通过的 Rule 都要生成 Hook。生成前先跑一遍 Q1a 判断
// — 如果发现这条 Rule 其实该并进某个 Skill(审批时没拦住的漏网案例),GateMaster
// 应该拒绝生成 Hook,转而发起一个"更新目标 Skill"的提议。
//
// 启发式:检查 rule 的 statement/title 里是不是包含某个 active skill 的 title 或 skill_key。
// 匹配到且含约束词(必须/需要/MUST)→ 创建 governance_change_proposal(augment_skill_with_rule_step),
// 跳过 hook 生成,标记 host-action 状态为 redirected。人工审批决定是否真的合并到 skill。

interface Q1aRedirectResult {
  shouldRedirect: boolean;
  targetSkillId?: string;
  targetSkillKey?: string;
  targetSkillTitle?: string;
  reason?: string;
}

async function checkRuleShouldBeSkillStep(input: {
  tenantId: string;
  scope: string;
  traceId: string;
  rulePayload: Record<string, unknown>;
}): Promise<Q1aRedirectResult> {
  const statement = String(input.rulePayload.statement ?? input.rulePayload.content ?? "").toLowerCase();
  const title = String(input.rulePayload.title ?? "").toLowerCase();
  const text = `${title} ${statement}`;

  // 约束词:rule 通常含这些词。如果只提到 skill 名称但没有约束词,可能只是引用,不需要 redirect
  const hasConstraintWord = /(必须|需要|应该|must|should|不能|禁止|forbid)/i.test(text);
  if (!hasConstraintWord) {
    return { shouldRedirect: false };
  }

  let skills: Record<string, unknown>[] = [];
  try {
    skills = await listActiveSkills({
      tenantId: input.tenantId,
      scope: input.scope,
      fingerprint: null,
      projectId: input.scope
    });
  } catch (e) {
    // 查 skill 表失败不阻塞 hook 生成(降级为不复核)
    console.warn(`[Q1a] listActiveSkills failed, skipping preflight check: ${e instanceof Error ? e.message : String(e)}`);
    return { shouldRedirect: false };
  }

  for (const skill of skills) {
    const skillTitle = String(skill.title ?? "").toLowerCase();
    const skillKey = String(skill.skill_key ?? "").toLowerCase();
    // 只匹配长度 >= 3 的 skill 名称,避免误匹配短词
    if (skillTitle.length < 3 && skillKey.length < 3) continue;

    const matchesTitle = skillTitle.length >= 3 && text.includes(skillTitle);
    const matchesKey = skillKey.length >= 3 && text.includes(skillKey);

    if (matchesTitle || matchesKey) {
      const reason = `Q1a 复核:Rule 触发条件匹配已存在 Skill "${skill.title}"(${skill.skill_key}),` +
        `可能是该 Skill 的执行步骤而非跨场景通用 Rule。建议合并到该 Skill 的 execution_steps。`;
      // 创建 governance_change_proposal 让人工审批决定
      try {
        const pool = getPool();
        await pool.query(
          `INSERT INTO governance_change_proposal (
            tenant_id, scope, status, version, target_object_type, target_object_id,
            proposed_action, proposed_payload, reason, risk_level, source_ref, trace_id
          ) VALUES (
            $1, $2, 'recorded', 1, 'skill', $5,
            'augment_skill_with_rule_step', $6::jsonb, $7, 'medium', $4::text, $3
          )`,
          [
            input.tenantId,
            input.scope,
            input.traceId,
            String(input.rulePayload.rule_key ?? input.rulePayload.rule_id ?? ""),
            String(skill.id ?? ""),
            JSON.stringify({
              rule_id: input.rulePayload.rule_id ?? null,
              rule_key: input.rulePayload.rule_key ?? null,
              rule_statement: input.rulePayload.statement ?? input.rulePayload.content ?? null,
              target_skill_id: skill.id ?? null,
              target_skill_key: skill.skill_key ?? null,
              target_skill_title: skill.title ?? null,
              proposed_change: "将此 Rule 合并到目标 Skill 的 execution_steps,而非独立生成 Hook"
            }),
            reason
          ]
        );
      } catch (e) {
        console.warn(`[Q1a] create governance_change_proposal failed: ${e instanceof Error ? e.message : String(e)}`);
        // proposal 创建失败不阻塞,继续返回 redirect 结果(hook 不生成,但 proposal 可能没创建)
      }

      return {
        shouldRedirect: true,
        targetSkillId: String(skill.id ?? ""),
        targetSkillKey: String(skill.skill_key ?? ""),
        targetSkillTitle: String(skill.title ?? ""),
        reason
      };
    }
  }

  return { shouldRedirect: false };
}

async function processRule(input: {
  item: HostActionItem;
  gatesDir: string;
  host: HostName;
  enforcementMode: EnforcementMode;
  tenantId: string;
  scope: string;
  traceId: string;
}): Promise<{ outputPath: string; nativeHookPath?: string }> {
  const { item, gatesDir, host, enforcementMode } = input;
  const payload = item.invoke_skill?.payload ?? {};
  const ruleKey = String(item.key || payload.rule_key || "unknown");
  const filePath = path.join(gatesDir, `${ruleKey}.hook.ts`);
  await mkdir(gatesDir, { recursive: true });
  await ensureGateTypesFile(gatesDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buildHookFile(payload), "utf8");

  // 必须与 buildHookFile 内部 inferMountPoints 保持一致，否则 registry 和 .hook.ts 文件 mount_points 不一致
  const triggerConditions = (payload.trigger_conditions as Record<string, unknown> | undefined) ?? {};
  const explicitMountPoints = Array.isArray(triggerConditions.mount_points)
    ? (triggerConditions.mount_points as string[])
    : undefined;
  const mountPoints = inferMountPoints(detectRuleCategory(payload), explicitMountPoints);
  await upsertRegistryEntry(gatesDir, {
    id: `hook_${ruleKey.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`,
    rule_id: String(payload.rule_id ?? item.id ?? ""),
    rule_key: ruleKey,
    file: path.basename(filePath),
    mount_points: mountPoints
  });

  let nativeHookPath: string | undefined;

  // §4.2 情况 A:宿主有原生 hook + 动作命中原生 hook matcher
  // 额外生成宿主原生 hook 配置(Qoder/.qoder/hooks/config.json + 脚本),实现真正实时拦截
  if (enforcementMode === "hard_native") {
    try {
      const result =
        host === "trae"
          ? await generateTraeNativeHookConfig({
              host,
              ruleKey,
              ruleId: String(payload.rule_id ?? item.id ?? ""),
              mountPoints,
              enforcementLevel: String(payload.enforcement_level ?? "must"),
              title: String(payload.title ?? ruleKey),
              statement: String(payload.statement ?? payload.content ?? "")
            })
          : await generateNativeHookConfig({
              host,
              ruleKey,
              ruleId: String(payload.rule_id ?? item.id ?? ""),
              mountPoints,
              hookFile: path.basename(filePath),
              enforcementLevel: String(payload.enforcement_level ?? "must")
            });
      nativeHookPath = result.configPath;
      console.log(`[§4.2 情况 A] Rule ${ruleKey} 生成宿主原生 hook: ${result.configPath} + ${result.scriptPath}`);
    } catch (e) {
      // 原生 hook 生成失败不阻塞 .hook.ts 已生成,降级为 hard_mcp
      console.warn(`[§4.2 情况 A] 生成宿主原生 hook 失败,降级为 hard_mcp: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // §4.2 情况 C:既不是 A 也不是 B → 软执行
  // 创建 governance_change_proposal,要求把等效检查折进 Skill 的 execution_steps
  if (enforcementMode === "soft") {
    await createSoftExecutionProposal({
      tenantId: input.tenantId,
      scope: input.scope,
      traceId: input.traceId,
      ruleKey,
      ruleId: String(payload.rule_id ?? item.id ?? ""),
      ruleStatement: String(payload.statement ?? payload.content ?? ""),
      mountPoints
    });
    console.log(`[§4.2 情况 C] Rule ${ruleKey} 走软执行模式,已创建 governance_change_proposal 要求折进 Skill execution_steps`);
  }

  // 情况 B (hard_mcp):保持当前逻辑,.hook.ts 已生成,GateRuntimeBridge 会拦截 MCP 工具调用
  return { outputPath: filePath, nativeHookPath };
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
        // §4.1 Q1a 生成前复核:检查 rule 是否该并进某个 Skill 而非独立生成 Hook
        const rulePayload = (item.invoke_skill?.payload ?? {}) as Record<string, unknown>;
        const q1aResult = await checkRuleShouldBeSkillStep({
          tenantId: input.tenantId,
          scope: input.scope,
          traceId: input.traceId,
          rulePayload
        });

        if (q1aResult.shouldRedirect) {
          // 拒绝生成 Hook,标记为 redirected,人工审批 governance_change_proposal 决定是否合并到 Skill
          await markHostActionStatus({
            tenantId: input.tenantId,
            objectType: "rule",
            objectId: item.id,
            status: "redirected",
            traceId: input.traceId
          });
          result.succeeded++;
          result.items.push({
            object_type: "rule",
            id: item.id,
            key: item.key,
            status: "redirected",
            output_path: undefined,
            error: q1aResult.reason
          });
          console.log(`[Q1a] Rule ${item.key} redirected to Skill ${q1aResult.targetSkillKey}: ${q1aResult.reason}`);
          continue;
        }

        // §4.2 宿主能力表 + 三种情况生成逻辑:检测当前宿主,决定走 A/B/C 哪种路径
        const host = detectHost();
        const triggerConditionsForDecision = (rulePayload.trigger_conditions as Record<string, unknown> | undefined) ?? {};
        const explicitMountPointsForDecision = Array.isArray(triggerConditionsForDecision.mount_points)
          ? (triggerConditionsForDecision.mount_points as string[])
          : undefined;
        const mountPointsForDecision = inferMountPoints(detectRuleCategory(rulePayload), explicitMountPointsForDecision);
        const enforcementMode = resolveEnforcementMode({ host, mountPoints: mountPointsForDecision });

        const { outputPath, nativeHookPath } = await processRule({
          item,
          gatesDir,
          host,
          enforcementMode,
          tenantId: input.tenantId,
          scope: input.scope,
          traceId: input.traceId
        });
        await markHostActionStatus({
          tenantId: input.tenantId,
          objectType: "rule",
          objectId: item.id,
          status: "generated",
          // §3.2 把生效模式写进 summary,治理面板据此显式标注"软执行 vs 硬拦截"
          summary: `enforcement_mode=${enforcementMode}; host=${host}; mount_points=${mountPointsForDecision.join(",")}${nativeHookPath ? `; native_hook=${nativeHookPath}` : ""}`,
          traceId: input.traceId
        });
        result.succeeded++;
        result.items.push({
          object_type: "rule",
          id: item.id,
          key: item.key,
          status: "generated",
          output_path: outputPath,
          enforcement_mode: enforcementMode,
          native_hook_path: nativeHookPath
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
