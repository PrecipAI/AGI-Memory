import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildClientTemplates,
  buildCodexAgentsSnippet,
  buildMcpStdioCommand,
  buildClaudeSnippet,
  buildTraeSnippet,
  ensureDir,
  pathExists,
  resolveConfigPath,
} from "./config.js";

export type HostInstallTarget = "codex" | "claude-code" | "trae";

export type HostInstallOptions = {
  cwd: string;
  host: HostInstallTarget;
  configPathInput?: string;
  hostConfigPathInput?: string;
  instructionsPathInput?: string;
  yes: boolean;
};

export type HostInstallResult = {
  status: "INSTALLED" | "NEEDS_APPROVAL";
  host: HostInstallTarget;
  files: Array<{
    path: string;
    status: "CREATE" | "UPDATE" | "SKIP";
    backup_path?: string;
  }>;
};

const CODEX_MARKER_START = "# >>> memory-v3 mcp >>>";
const CODEX_MARKER_END = "# <<< memory-v3 mcp <<<";
const INSTRUCTIONS_MARKER_START = "<!-- >>> memory-v3 policy >>>";
const INSTRUCTIONS_MARKER_END = "<<< memory-v3 policy <<< -->";
const CODEX_TABLE_PATTERN =
  /^\[mcp_servers\.memory-v3\]\r?\n(?:^(?!\[).*\r?\n?)*/m;

export async function installHost(
  options: HostInstallOptions,
): Promise<HostInstallResult> {
  if (!options.yes) {
    return {
      status: "NEEDS_APPROVAL",
      host: options.host,
      files: [],
    };
  }

  const memoryConfigPath = resolveConfigPath(
    options.cwd,
    options.configPathInput,
  );
  const files: HostInstallResult["files"] = [];
  if (options.host === "codex") {
    await installCodex({ ...options, memoryConfigPath, files });
  } else if (options.host === "trae") {
    await installTrae({ ...options, memoryConfigPath, files });
  } else {
    await installClaudeCode({ ...options, memoryConfigPath, files });
  }

  return {
    status: "INSTALLED",
    host: options.host,
    files,
  };
}

async function installCodex(
  options: HostInstallOptions & {
    memoryConfigPath: string;
    files: HostInstallResult["files"];
  },
) {
  const hostConfigPath = resolveTargetPath(
    options.cwd,
    options.hostConfigPathInput,
    path.join(os.homedir(), ".codex", "config.toml"),
  );
  const instructionsPath = resolveTargetPath(
    options.cwd,
    options.instructionsPathInput,
    path.join(options.cwd, "AGENTS.md"),
  );
  const shell = buildMcpStdioCommand(options.memoryConfigPath);
  const tomlBlock = [
    CODEX_MARKER_START,
    "[mcp_servers.memory-v3]",
    `command = ${JSON.stringify(shell.command)}`,
    `args = ${toTomlStringArray(shell.args)}`,
    "enabled = true",
    CODEX_MARKER_END,
    "",
  ].join("\n");

  await upsertMarkedTextFile({
    filePath: hostConfigPath,
    block: tomlBlock,
    markerStart: CODEX_MARKER_START,
    markerEnd: CODEX_MARKER_END,
    files: options.files,
  });
  await upsertMarkedTextFile({
    filePath: instructionsPath,
    block: wrapInstructionBlock(buildCodexAgentsSnippet()),
    markerStart: INSTRUCTIONS_MARKER_START,
    markerEnd: INSTRUCTIONS_MARKER_END,
    files: options.files,
  });
}

async function installClaudeCode(
  options: HostInstallOptions & {
    memoryConfigPath: string;
    files: HostInstallResult["files"];
  },
) {
  const hostConfigPath = resolveTargetPath(
    options.cwd,
    options.hostConfigPathInput,
    path.join(options.cwd, ".mcp.json"),
  );
  const instructionsPath = resolveTargetPath(
    options.cwd,
    options.instructionsPathInput,
    path.join(options.cwd, "CLAUDE.md"),
  );
  const templates = buildClientTemplates(options.memoryConfigPath);
  await mergeMcpJsonFile({
    filePath: hostConfigPath,
    serverConfig:
      templates["claude-code-project.mcp.json"].mcpServers["memory-v3"],
    files: options.files,
  });
  await upsertMarkedTextFile({
    filePath: instructionsPath,
    block: wrapInstructionBlock(buildClaudeSnippet()),
    markerStart: INSTRUCTIONS_MARKER_START,
    markerEnd: INSTRUCTIONS_MARKER_END,
    files: options.files,
  });
}

async function installTrae(
  options: HostInstallOptions & {
    memoryConfigPath: string;
    files: HostInstallResult["files"];
  },
) {
  const hostConfigPath = resolveTargetPath(
    options.cwd,
    options.hostConfigPathInput,
    path.join(options.cwd, ".trae", "mcp.json"),
  );
  const instructionsPath = resolveTargetPath(
    options.cwd,
    options.instructionsPathInput,
    path.join(options.cwd, ".trae", "instructions.md"),
  );
  const templates = buildClientTemplates(options.memoryConfigPath);
  await mergeMcpJsonFile({
    filePath: hostConfigPath,
    serverConfig: templates["trae-mcp.json"].mcpServers["memory-v3"],
    files: options.files,
  });
  await upsertMarkedTextFile({
    filePath: instructionsPath,
    block: wrapInstructionBlock(buildTraeSnippet()),
    markerStart: INSTRUCTIONS_MARKER_START,
    markerEnd: INSTRUCTIONS_MARKER_END,
    files: options.files,
  });
}

async function mergeMcpJsonFile(options: {
  filePath: string;
  serverConfig: Record<string, unknown>;
  files: HostInstallResult["files"];
}) {
  const exists = await pathExists(options.filePath);
  const previous = exists ? await readFile(options.filePath, "utf8") : "";
  const backupPath = exists ? await backupFile(options.filePath) : undefined;
  const parsed = previous.trim().length > 0 ? JSON.parse(previous) : {};
  const next = {
    ...parsed,
    mcpServers: {
      ...(parsed.mcpServers ?? {}),
      "memory-v3": options.serverConfig,
    },
  };
  await ensureDir(path.dirname(options.filePath));
  await writeFile(
    options.filePath,
    `${JSON.stringify(next, null, 2)}\n`,
    "utf8",
  );
  options.files.push({
    path: options.filePath,
    status: exists ? "UPDATE" : "CREATE",
    backup_path: backupPath,
  });
}

async function upsertMarkedTextFile(options: {
  filePath: string;
  block: string;
  markerStart: string;
  markerEnd: string;
  files: HostInstallResult["files"];
}) {
  const exists = await pathExists(options.filePath);
  const previous = exists ? await readFile(options.filePath, "utf8") : "";
  const backupPath = exists ? await backupFile(options.filePath) : undefined;
  const startIndex = previous.indexOf(options.markerStart);
  const endIndex = previous.indexOf(options.markerEnd);
  const normalizedBlock = options.block.endsWith("\n")
    ? options.block
    : `${options.block}\n`;
  let next: string;

  if (startIndex >= 0 && endIndex > startIndex) {
    const afterEnd = endIndex + options.markerEnd.length;
    next = `${previous.slice(0, startIndex)}${normalizedBlock}${previous.slice(afterEnd).replace(/^\r?\n/, "")}`;
  } else if (
    options.markerStart === CODEX_MARKER_START &&
    CODEX_TABLE_PATTERN.test(previous)
  ) {
    next = previous.replace(CODEX_TABLE_PATTERN, normalizedBlock);
  } else {
    next = `${previous.trimEnd()}${previous.trim().length > 0 ? "\n\n" : ""}${normalizedBlock}`;
  }

  if (options.markerStart === CODEX_MARKER_START) {
    next = stripUnmarkedCodexMemoryTables(next);
  }

  await ensureDir(path.dirname(options.filePath));
  await writeFile(options.filePath, next, "utf8");
  options.files.push({
    path: options.filePath,
    status: exists ? "UPDATE" : "CREATE",
    backup_path: backupPath,
  });
}

async function backupFile(filePath: string): Promise<string> {
  const backupDir = path.join(path.dirname(filePath), ".memory-mcp-backups");
  await mkdir(backupDir, { recursive: true });
  const backupPath = path.join(
    backupDir,
    `${path.basename(filePath)}.${Date.now()}.bak`,
  );
  await copyFile(filePath, backupPath);
  return backupPath;
}

function resolveTargetPath(
  cwd: string,
  inputPath: string | undefined,
  fallback: string,
): string {
  if (!inputPath) {
    return fallback;
  }
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath);
}

function wrapInstructionBlock(content: string): string {
  return `${INSTRUCTIONS_MARKER_START}\n${content.trim()}\n${INSTRUCTIONS_MARKER_END}\n`;
}

function toTomlStringArray(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function stripUnmarkedCodexMemoryTables(content: string): string {
  const startIndex = content.indexOf(CODEX_MARKER_START);
  const endIndex = content.indexOf(CODEX_MARKER_END);
  if (startIndex < 0 || endIndex <= startIndex) {
    return content;
  }

  const afterEnd = endIndex + CODEX_MARKER_END.length;
  const before = content.slice(0, startIndex).replace(CODEX_TABLE_PATTERN, "");
  const marked = content.slice(startIndex, afterEnd);
  const after = content.slice(afterEnd).replace(CODEX_TABLE_PATTERN, "");
  return `${before}${marked}${after}`.replace(/\n{4,}/g, "\n\n\n");
}
