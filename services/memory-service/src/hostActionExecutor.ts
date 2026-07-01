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

function buildHookFile(payload: Record<string, unknown>): string {
  const ruleKey = String(payload.rule_key ?? "unknown");
  const safeKey = ruleKey.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const statement = String(payload.statement ?? "").replace(/`/g, "\\`");
  const triggerConditions = (payload.trigger_conditions as Record<string, unknown> | undefined) ?? {};
  const mountPoints = Array.isArray(triggerConditions.mount_points)
    ? (triggerConditions.mount_points as string[])
    : ["before_task_complete"];

  return `// AUTO-GENERATED by GateMaster — DO NOT EDIT MANUALLY
// Rule: ${payload.title ?? ruleKey}
// Rule Key: ${ruleKey}
// Enforcement: ${payload.enforcement_level ?? "must"}
// Scope: ${payload.origin_scope ?? "session"} / ${payload.availability_scope ?? "session_only"}
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
    // 触发条件判定（基于 trigger_conditions）
    // TODO: 根据实际 trigger_conditions 细化匹配逻辑
    const triggerConditions = ${JSON.stringify(triggerConditions ?? {}, null, 2)};
    const appliesTo = ${JSON.stringify((payload.applies_to as unknown[]) ?? [], null, 2)};
    if (Array.isArray(appliesTo) && appliesTo.length > 0) {
      return appliesTo.includes(context.taskType) || appliesTo.includes(context.operation);
    }
    return true;
  },

  async run(context: GateContext): Promise<HookResult> {
    // Rule statement: ${statement}
    // TODO: 根据 statement 翻译为具体的检查逻辑
    // 当前为模板，实际落地时需要宿主侧 agent 根据语义补充检查代码
    return { action: "PASS" };
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
