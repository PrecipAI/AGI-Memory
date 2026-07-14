/**
 * 41. 静态记忆编译器 - Marker 管理
 *
 * 复用 hostInstall.ts 的 upsertMarkedTextFile 模式，但用独立的 marker。
 * marker 注入，不全量覆盖：只替换 marker 之间的内容，保护用户手写内容。
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

// 宿主原生文件的三组 marker（CLAUDE.md / AGENTS.md / .trae/instructions.md）
export const MARKER_PAIRS = {
  rules: {
    start: "<!-- >>> memory-v3 static-rules >>> -->",
    end: "<!-- <<< memory-v3 static-rules <<< -->",
  },
  skills: {
    start: "<!-- >>> memory-v3 static-skills >>> -->",
    end: "<!-- <<< memory-v3 static-skills <<< -->",
  },
  memory: {
    start: "<!-- >>> memory-v3 static-memory >>> -->",
    end: "<!-- <<< memory-v3 static-memory <<< -->",
  },
  // TRAE memory 系统专用 marker（user_profile.md / project_memory.md）
  // 与宿主原生 marker 区分，避免 validateMarkerIntegrity 误报
  trae_user_preferences: {
    start: "<!-- >>> agi-memory trae-user-preferences >>> -->",
    end: "<!-- <<< agi-memory trae-user-preferences <<< -->",
  },
  trae_project_constraints: {
    start: "<!-- >>> agi-memory trae-project-constraints >>> -->",
    end: "<!-- <<< agi-memory trae-project-constraints <<< -->",
  },
  trae_project_conventions: {
    start: "<!-- >>> agi-memory trae-project-conventions >>> -->",
    end: "<!-- <<< agi-memory trae-project-conventions <<< -->",
  },
} as const;

export type MarkerKey = keyof typeof MARKER_PAIRS;

export interface UpsertResult {
  filePath: string;
  status: "created" | "updated" | "unchanged";
  backupPath?: string;
}

/**
 * 读取文件内容，不存在则返回空字符串。
 */
async function readFileSafe(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

/**
 * 备份文件到 .memory-mcp-backups/ 目录。
 */
async function backupFile(filePath: string): Promise<string | undefined> {
  try {
    const backupDir = path.join(path.dirname(filePath), ".memory-mcp-backups");
    await fs.mkdir(backupDir, { recursive: true });
    const backupPath = path.join(
      backupDir,
      `${path.basename(filePath)}.${Date.now()}.bak`
    );
    await fs.copyFile(filePath, backupPath);
    // 清理旧备份，保留最近 5 个
    const backups = await fs.readdir(backupDir);
    const relevantBackups = backups
      .filter((b) => b.startsWith(path.basename(filePath) + "."))
      .sort()
      .reverse();
    for (const old of relevantBackups.slice(5)) {
      await fs.unlink(path.join(backupDir, old)).catch(() => {});
    }
    return backupPath;
  } catch {
    return undefined;
  }
}

/**
 * 把 block 内容注入到文件的 marker 区域。
 * - 找到 marker 对 → 只替换 marker 之间的内容
 * - 找不到 marker 对 → 追加到文件末尾
 * - 文件不存在 → 创建新文件
 * - 新内容与旧内容相同 → 不写文件（unchanged）
 */
export async function upsertMarkedBlock(options: {
  filePath: string;
  markerKey: MarkerKey;
  block: string;
}): Promise<UpsertResult> {
  const { filePath, markerKey, block } = options;
  const markers = MARKER_PAIRS[markerKey];
  const exists = await fs.access(filePath).then(() => true).catch(() => false);
  const previous = exists ? await readFileSafe(filePath) : "";
  const backupPath = exists ? await backupFile(filePath) : undefined;

  const wrappedBlock = `${markers.start}\n${block.trim()}\n${markers.end}\n`;

  let next: string;
  const startIndex = previous.indexOf(markers.start);
  const endIndex = previous.indexOf(markers.end);

  if (startIndex >= 0 && endIndex > startIndex) {
    // 找到 marker 对，替换之间的内容
    const afterEnd = endIndex + markers.end.length;
    next = `${previous.slice(0, startIndex)}${wrappedBlock}${previous.slice(afterEnd).replace(/^\r?\n/, "")}`;
  } else {
    // 找不到 marker 对，追加到末尾
    const prefix = previous.trim().length > 0 ? `${previous.trimEnd()}\n\n` : "";
    next = `${prefix}${wrappedBlock}`;
  }

  // 内容相同则不写
  if (next === previous) {
    return { filePath, status: "unchanged", backupPath };
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, next, "utf8");

  return {
    filePath,
    status: exists ? "updated" : "created",
    backupPath,
  };
}

/**
 * 验证文件中所有 marker 对的完整性。
 * 返回缺失或不匹配的 marker 列表。
 */
export async function validateMarkerIntegrity(
  filePath: string
): Promise<Array<{ markerKey: MarkerKey; issue: string }>> {
  const content = await readFileSafe(filePath);
  const issues: Array<{ markerKey: MarkerKey; issue: string }> = [];

  for (const key of Object.keys(MARKER_PAIRS) as MarkerKey[]) {
    const markers = MARKER_PAIRS[key];
    const startIndex = content.indexOf(markers.start);
    const endIndex = content.indexOf(markers.end);

    if (startIndex >= 0 && endIndex < 0) {
      issues.push({ markerKey: key, issue: "start marker found but end marker missing" });
    } else if (startIndex < 0 && endIndex >= 0) {
      issues.push({ markerKey: key, issue: "end marker found but start marker missing" });
    } else if (startIndex >= 0 && endIndex >= 0 && endIndex <= startIndex) {
      issues.push({ markerKey: key, issue: "end marker appears before start marker" });
    }
  }

  return issues;
}
