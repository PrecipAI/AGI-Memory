/**
 * 41. 静态记忆编译器 - TRAE memory 系统适配器
 *
 * TRAE 有自己的 memory 系统，位于 c:\Users\{user}\.trae-cn\memory\：
 *   - user_profile.md       用户级，跨项目共享
 *   - projects/{enc}/project_memory.md   项目级
 *
 * 本适配器把 AGI-Memory DB 中审批通过的产出编译进 TRAE memory 文件：
 *   - user_memory      → user_profile.md（trae_user_preferences marker）
 *   - rule (must/not)  → project_memory.md（trae_project_constraints marker）
 *   - project_memory   → project_memory.md（trae_project_conventions marker）
 *
 * 与宿主原生文件（CLAUDE.md/AGENTS.md/.trae/instructions.md）互补：
 *   - 宿主原生文件：编译 rules + skills + memory 三层（全量）
 *   - TRAE memory 文件：按 memory_type 分流，只写用户级和项目级（精准投放）
 *
 * Marker 设计：用 agi-memory 前缀与宿主原生 marker（memory-v3 前缀）区分，
 * 避免_validateMarkerIntegrity 误报，也避免与 TRAE 自动维护的内容冲突。
 */

import * as path from "node:path";
import {
  upsertMarkedBlock,
  type UpsertResult,
} from "./markerManager.js";
import type { FilterableItem } from "./contentFilter.js";

export interface TraeMemoryConfig {
  /** TRAE memory 根目录，通常 c:\Users\{user}\.trae-cn\memory */
  memoryRoot: string;
  /** 项目实际路径（用于编码 TRAE memory 项目目录名） */
  projectPath: string;
}

export interface TraeMemoryWriteResult {
  userProfile?: UpsertResult;
  projectMemory?: UpsertResult;
}

/**
 * 编码项目路径为 TRAE memory 目录名。
 *
 * 规则（通过逆向实际目录名推导）：
 *   1. Windows 盘符 c:\ → c-（:\ 合并为一个 -，不产生 --）
 *   2. 其他分隔符 \ . → -
 *   3. 开头加 -
 *
 * 例如：c:\Users\yangy\.qoderworkcn\workspace → -c-Users-yangy--qoderworkcn-workspace
 * 验证：实际目录名 -c-Users-yangy--qoderworkcn-workspace-mq988j0j137zwdp8-agi-memory-src 完全匹配
 */
export function encodeProjectPath(projectPath: string): string {
  const encoded = projectPath
    .replace(/:\\/g, "-") // Windows 盘符 c:\ → c-
    .replace(/[\\.]/g, "-"); // \ . → -
  return `-${encoded}`;
}

/**
 * 获取 user_profile.md 的完整路径。
 */
export function getUserProfilePath(memoryRoot: string): string {
  return path.join(memoryRoot, "user_profile.md");
}

/**
 * 获取 project_memory.md 的完整路径。
 */
export function getProjectMemoryPath(
  memoryRoot: string,
  projectPath: string,
): string {
  const encoded = encodeProjectPath(projectPath);
  return path.join(memoryRoot, "projects", encoded, "project_memory.md");
}

/**
 * 获取默认 TRAE memory 根目录。
 * 优先用环境变量 TRAE_MEMORY_ROOT，否则用 USERPROFILE/HOME 推导。
 */
export function getDefaultTraeMemoryRoot(): string {
  const envRoot = process.env.TRAE_MEMORY_ROOT;
  if (envRoot) return path.resolve(envRoot);

  const home = process.env.USERPROFILE || process.env.HOME || process.cwd();
  return path.join(home, ".trae-cn", "memory");
}

/**
 * 把 user_memory 类型的记忆格式化为 TRAE user_profile.md 的 Preferences 区域。
 */
export function formatTraeUserPreferences(
  memories: FilterableItem[],
): string {
  if (memories.length === 0) return "";

  const lines: string[] = ["## 用户偏好（AGI-Memory 编译）", ""];
  lines.push("以下用户偏好长期有效，跨项目共享：");
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
 * 把 rule 格式化为 TRAE project_memory.md 的 Hard Constraints 区域。
 */
export function formatTraeProjectConstraints(
  rules: FilterableItem[],
): string {
  if (rules.length === 0) return "";

  const lines: string[] = ["## 硬约束（AGI-Memory 编译）", ""];
  lines.push("以下规则已经过审批，执行时必须遵守：");
  lines.push("");

  for (const rule of rules) {
    const statement = rule.statement ?? rule.content ?? "";
    lines.push(
      `- **${rule.title}**: ${statement} (执行级别: ${rule.enforcement_level ?? "must"})`,
    );
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * 把 project_memory 类型的记忆格式化为 TRAE project_memory.md 的 Engineering Conventions 区域。
 */
export function formatTraeProjectConventions(
  memories: FilterableItem[],
): string {
  if (memories.length === 0) return "";

  const lines: string[] = ["## 工程约定（AGI-Memory 编译）", ""];
  lines.push("以下项目级约定长期有效：");
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
 * 按 memory_type 把 memory 列表分流为 user_memory 和 project_memory 两组。
 * 其他类型（factual 等）不分流到 TRAE memory（由宿主原生文件处理）。
 */
export function splitMemoriesByType(
  memories: FilterableItem[],
): {
  userMemories: FilterableItem[];
  projectMemories: FilterableItem[];
} {
  const userMemories: FilterableItem[] = [];
  const projectMemories: FilterableItem[] = [];

  for (const m of memories) {
    if (m.memory_type === "user_memory") {
      userMemories.push(m);
    } else if (m.memory_type === "project_memory") {
      projectMemories.push(m);
    }
    // 其他类型不分流到 TRAE memory
  }

  return { userMemories, projectMemories };
}

/**
 * 写入 TRAE memory 系统文件。
 *
 * 写入逻辑：
 *   - user_memory → user_profile.md（trae_user_preferences marker）
 *   - rule → project_memory.md（trae_project_constraints marker）
 *   - project_memory → project_memory.md（trae_project_conventions marker）
 *
 * 两个 TRAE memory 文件相互独立，但同一文件内多个 marker 区域串行写（避免并发写冲突）。
 */
export async function writeTraeMemoryFiles(
  config: TraeMemoryConfig,
  blocks: {
    userPreferences: string;
    projectConstraints: string;
    projectConventions: string;
  },
): Promise<TraeMemoryWriteResult> {
  const result: TraeMemoryWriteResult = {};

  // 1. 写 user_profile.md（user_memory 编译产物）
  if (blocks.userPreferences) {
    const userProfilePath = getUserProfilePath(config.memoryRoot);
    result.userProfile = await upsertMarkedBlock({
      filePath: userProfilePath,
      markerKey: "trae_user_preferences",
      block: blocks.userPreferences,
    });
  }

  // 2. 写 project_memory.md（rule + project_memory 编译产物，串行写两个 marker 区域）
  if (blocks.projectConstraints || blocks.projectConventions) {
    const projectMemoryPath = getProjectMemoryPath(
      config.memoryRoot,
      config.projectPath,
    );

    if (blocks.projectConstraints) {
      result.projectMemory = await upsertMarkedBlock({
        filePath: projectMemoryPath,
        markerKey: "trae_project_constraints",
        block: blocks.projectConstraints,
      });
    }

    if (blocks.projectConventions) {
      result.projectMemory = await upsertMarkedBlock({
        filePath: projectMemoryPath,
        markerKey: "trae_project_conventions",
        block: blocks.projectConventions,
      });
    }
  }

  return result;
}
