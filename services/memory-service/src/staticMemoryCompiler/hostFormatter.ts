/**
 * 41. 静态记忆编译器 - 宿主格式化器
 *
 * 把筛选后的 Rule/Skill/Memory 格式化成 markdown 内容。
 * 三个宿主（trae/claude code/codex）共用同一段 markdown 内容，只是文件路径不同。
 */

import * as fs from "node:fs";
import type { FilterableItem } from "./contentFilter.js";

export type HostType = "trae" | "claude_code" | "codex_cli";

export interface HostConfig {
  host: HostType;
  /** 目标文件路径（相对仓库根） */
  getFilePath: (repoRoot: string) => string;
}

export const HOST_CONFIGS: Record<HostType, HostConfig> = {
  trae: {
    host: "trae",
    getFilePath: (repoRoot) => `${repoRoot}/.trae/instructions.md`,
  },
  claude_code: {
    host: "claude_code",
    getFilePath: (repoRoot) => `${repoRoot}/CLAUDE.md`,
  },
  codex_cli: {
    host: "codex_cli",
    getFilePath: (repoRoot) => `${repoRoot}/AGENTS.md`,
  },
};

/**
 * 格式化 Rule 列表为 markdown 段落。
 */
export function formatRules(rules: FilterableItem[]): string {
  if (rules.length === 0) return "";

  const lines: string[] = ["## 治理规则（AGI-Memory 编译）", ""];
  lines.push("以下规则已经过审批，执行时必须遵守：");
  lines.push("");

  for (const rule of rules) {
    const metadata = rule.metadata as Record<string, unknown> | null;
    const humanReadable = String(metadata?.human_readable_statement ?? rule.statement ?? rule.content ?? "");
    const statement = rule.statement ?? rule.content ?? "";

    lines.push(`### ${rule.title}`);
    lines.push(`- **规则声明**: ${statement}`);
    if (humanReadable !== statement) {
      lines.push(`- **人工可读声明**: ${humanReadable}`);
    }
    lines.push(`- **执行级别**: ${rule.enforcement_level ?? "must"}`);
    lines.push(`- **来源**: AGI-Memory rule_id=${rule.id}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * 格式化 Skill 列表为 markdown 段落。
 */
export function formatSkills(skills: FilterableItem[]): string {
  if (skills.length === 0) return "";

  const lines: string[] = ["## 治理技能（AGI-Memory 编译）", ""];
  lines.push("以下技能已经过审批，可在合适场景下执行：");
  lines.push("");

  for (const skill of skills) {
    const description = String(skill.content ?? skill.statement ?? "");
    lines.push(`### ${skill.title}`);
    lines.push(`- **描述**: ${description}`);
    lines.push(`- **来源**: AGI-Memory skill_id=${skill.id}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * 格式化 Memory 列表为 markdown 段落。
 */
export function formatMemories(memories: FilterableItem[]): string {
  if (memories.length === 0) return "";

  const lines: string[] = ["## 长期记忆（AGI-Memory 编译）", ""];
  lines.push("以下用户画像记忆长期有效，影响交互风格：");
  lines.push("");

  for (const memory of memories) {
    const content = memory.content ?? memory.statement ?? "";
    lines.push(`### ${memory.title}`);
    lines.push(`- **内容**: ${content}`);
    lines.push(`- **来源**: AGI-Memory memory_id=${memory.id}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * 检测当前环境是哪个宿主。
 * 复用 hostActionExecutor 的检测逻辑：环境变量 + 文件系统特征。
 */
export function detectHosts(repoRoot: string): HostType[] {
  const hosts: HostType[] = [];

  // 环境变量优先
  const envHost = process.env.AGENT_HOST ?? process.env.HOST_TYPE ?? "";
  if (envHost === "trae" || envHost === "claude-code" || envHost === "claude_code") {
    hosts.push(envHost === "claude-code" ? "claude_code" : "trae");
  }
  if (envHost === "codex" || envHost === "codex_cli") {
    hosts.push("codex_cli");
  }

  // 文件系统特征兜底（检测宿主目录是否存在）
  try {
    if (fs.existsSync(`${repoRoot}/.trae`)) hosts.push("trae");
    if (fs.existsSync(`${repoRoot}/CLAUDE.md`)) hosts.push("claude_code");
    if (fs.existsSync(`${repoRoot}/AGENTS.md`)) hosts.push("codex_cli");
  } catch {
    // ignore
  }

  // 去重
  return [...new Set(hosts)];
}
