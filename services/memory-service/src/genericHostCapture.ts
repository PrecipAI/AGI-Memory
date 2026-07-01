import { readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  CodexCapturePreviewRequest,
  CodexCapturePreviewResponse,
  CodexHostSessionListRequest,
  CodexHostSessionListResponse
} from "./codexHostCapture.js";

type GenericSessionEntry = {
  thread_id: string;
  thread_name: string | null;
  updated_at: string | null;
  session_file: string;
};

type GenericMessage = {
  timestamp: string;
  role: "user" | "assistant" | "commentary";
  text: string;
};

export async function previewGenericHostCapture(input: CodexCapturePreviewRequest & {
  host: string;
}): Promise<CodexCapturePreviewResponse> {
  const hostHome = resolveGenericHostHome(input.host, input.host_home ?? input.codex_home ?? null);
  const sessions = await listGenericSessionEntries(input.host, hostHome, normalizeMaxItems(1000));
  const target = resolveTargetSession(sessions, input.thread_id ?? null);
  const records = await readGenericRecords(target.session_file);
  const maxItems = normalizeMaxItems(input.max_items);

  const messages: GenericMessage[] = [];
  const commands: CodexCapturePreviewResponse["governance_preview"]["commands"] = [];
  const toolCalls: CodexCapturePreviewResponse["governance_preview"]["tool_calls"] = [];
  const mcpCalls: CodexCapturePreviewResponse["governance_preview"]["mcp_calls"] = [];
  const workspacePaths = new Set<string>();

  for (const record of records) {
    const timestamp = extractTimestamp(record);
    const role = extractRole(record);
    const text = extractMessageText(record);
    if (role && text) {
      messages.push({ timestamp, role, text });
    }

    const cwd = readString(record, ["cwd", "working_directory", "workingDirectory"]);
    if (cwd) {
      workspacePaths.add(cwd);
    }
    const command = extractCommand(record);
    if (command.length > 0 || cwd) {
      commands.push({
        timestamp,
        command,
        cwd,
        exit_code: readNumber(record, ["exit_code", "exitCode", "code"]),
        stdout_excerpt: summarizeOptional(readString(record, ["stdout", "output"])),
        stderr_excerpt: summarizeOptional(readString(record, ["stderr", "error"])),
        status: inferGenericStatus(record)
      });
    }

    const toolName = readString(record, ["tool_name", "toolName", "name", "tool"]);
    const server = readString(record, ["server", "mcp_server", "mcpServer"]);
    if (server && toolName) {
      mcpCalls.push({
        timestamp,
        server,
        tool: toolName,
        arguments_summary: summarizeUnknown(readUnknown(record, ["arguments", "args", "input"])),
        result_summary: summarizeOptional(readString(record, ["result", "response", "output"])),
        error_summary: summarizeOptional(readString(record, ["error", "stderr"])),
        status: inferGenericStatus(record)
      });
    } else if (toolName && !role) {
      toolCalls.push({
        timestamp,
        tool_name: toolName,
        arguments_summary: summarizeUnknown(readUnknown(record, ["arguments", "args", "input"])),
        result_summary: summarizeOptional(readString(record, ["result", "response", "output"])),
        error_summary: summarizeOptional(readString(record, ["error", "stderr"])),
        status: inferGenericStatus(record)
      });
    }
  }

  const userMessages = messages.filter((item) => item.role === "user");
  const corrections = extractSignals(userMessages, ["不是", "不对", "我的意思", "应该", "重新"], "correction", maxItems);
  const preferences = extractSignals(userMessages, ["不要", "不需要", "必须", "默认", "只能", "优先", "不允许", "must"], "preference", maxItems);
  const decisions = extractSignals(userMessages, ["可以", "好的", "是的", "确认", "按这个", "继续", "ok"], "decision", maxItems);
  const warnings: string[] = [];
  if (userMessages.length === 0) {
    warnings.push(`No user messages found in the selected ${input.host} session file.`);
  }
  if (commands.length === 0) {
    warnings.push(`No command execution events found in the selected ${input.host} session file.`);
  }
  if (toolCalls.length === 0 && mcpCalls.length === 0) {
    warnings.push(`No tool or MCP events found in the selected ${input.host} session file.`);
  }
  const quality =
    userMessages.length > 0 && commands.length > 0 && (toolCalls.length > 0 || mcpCalls.length > 0)
      ? "high"
      : userMessages.length > 0 && (commands.length > 0 || toolCalls.length > 0 || mcpCalls.length > 0)
        ? "medium"
        : "low";

  return {
    host: input.host,
    codex_home: hostHome,
    host_home: hostHome,
    thread_id: target.thread_id,
    thread_name: target.thread_name,
    session_file: target.session_file,
    updated_at: target.updated_at,
    totals: {
      raw_event_count: records.length,
      message_count: messages.length,
      user_message_count: userMessages.length,
      assistant_message_count: messages.filter((item) => item.role === "assistant").length,
      commentary_count: messages.filter((item) => item.role === "commentary").length,
      command_event_count: commands.length,
      tool_call_count: toolCalls.length,
      mcp_call_count: mcpCalls.length
    },
    governance_preview: {
      user_messages: userMessages.slice(-maxItems),
      corrections,
      preferences,
      decisions,
      commands: commands.slice(-maxItems),
      tool_calls: toolCalls.slice(-maxItems),
      mcp_calls: mcpCalls.slice(-maxItems),
      workspace_paths: Array.from(workspacePaths).sort(),
      readiness: {
        has_user_intent: userMessages.length > 0,
        has_execution_trace: commands.length > 0,
        has_tool_trace: toolCalls.length > 0 || mcpCalls.length > 0,
        has_corrections: corrections.length > 0,
        quality,
        warnings
      }
    }
  };
}

export async function listGenericHostSessions(input: CodexHostSessionListRequest & {
  host: string;
}): Promise<CodexHostSessionListResponse> {
  const hostHome = resolveGenericHostHome(input.host, input.host_home ?? input.codex_home ?? null);
  const limit = normalizeMaxItems(input.limit);
  const entries = await listGenericSessionEntries(input.host, hostHome, limit);
  return {
    host: input.host,
    codex_home: hostHome,
    host_home: hostHome,
    items: entries.map((entry) => ({
      thread_id: entry.thread_id,
      thread_name: entry.thread_name,
      updated_at: entry.updated_at,
      session_file: entry.session_file
    }))
  };
}

function resolveGenericHostHome(host: string, customHostHome: string | null): string {
  if (customHostHome?.trim()) {
    return customHostHome.trim();
  }
  const dirName = host === "claude-code" ? ".claude" : `.${host}`;
  return path.join(os.homedir(), dirName);
}

async function listGenericSessionEntries(
  host: string,
  hostHome: string,
  limit: number
): Promise<GenericSessionEntry[]> {
  const files = (await findSessionFiles(hostHome)).slice(0, Math.max(limit * 5, limit));
  const entries = await Promise.all(
    files.map(async (filePath) => {
      const fileStat = await stat(filePath);
      const records = await readGenericRecords(filePath).catch(() => []);
      const firstUserText = records.map(extractMessageText).find((text) => text.trim()) ?? null;
      return {
        thread_id: inferThreadId(host, filePath),
        thread_name: firstUserText ? summarize(firstUserText.replace(/\s+/g, " "), 80) : path.basename(filePath),
        updated_at: fileStat.mtime.toISOString(),
        session_file: filePath
      };
    })
  );
  return entries
    .sort((left, right) => Date.parse(right.updated_at ?? "") - Date.parse(left.updated_at ?? ""))
    .slice(0, limit);
}

async function findSessionFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = await readdir(current, { withFileTypes: true, encoding: "utf8" });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith(".jsonl") || entry.name.endsWith(".json"))) {
        results.push(fullPath);
      }
    }
  }
  const stats = await Promise.all(results.map(async (filePath) => ({ filePath, mtimeMs: (await stat(filePath)).mtimeMs })));
  return stats.sort((left, right) => right.mtimeMs - left.mtimeMs).map((item) => item.filePath);
}

async function readGenericRecords(filePath: string): Promise<Record<string, unknown>[]> {
  const content = await readFile(filePath, "utf8");
  if (filePath.endsWith(".jsonl")) {
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }
  const parsed = JSON.parse(content) as unknown;
  if (Array.isArray(parsed)) {
    return parsed.filter(isRecord);
  }
  if (isRecord(parsed)) {
    const candidates = [parsed.messages, parsed.events, parsed.items, parsed.records, parsed.conversation];
    const array = candidates.find(Array.isArray);
    if (Array.isArray(array)) {
      return array.filter(isRecord);
    }
    return [parsed];
  }
  return [];
}

function resolveTargetSession(entries: GenericSessionEntry[], requestedThreadId: string | null): GenericSessionEntry {
  if (requestedThreadId) {
    const match = entries.find((entry) => entry.thread_id === requestedThreadId || entry.session_file === requestedThreadId);
    if (!match) {
      throw new Error(`Host thread not found: ${requestedThreadId}`);
    }
    return match;
  }
  const latest = entries[0];
  if (!latest) {
    throw new Error("No host session files found. Provide host_home that contains .jsonl or .json records.");
  }
  return latest;
}

function inferThreadId(host: string, filePath: string): string {
  return `${host}:${path.basename(filePath).replace(/\.(jsonl|json)$/i, "")}`;
}

function extractTimestamp(record: Record<string, unknown>): string {
  return readString(record, ["timestamp", "created_at", "createdAt", "time", "date"]) ?? new Date(0).toISOString();
}

function extractRole(record: Record<string, unknown>): GenericMessage["role"] | null {
  const role = readString(record, ["role", "speaker", "author", "type"]);
  if (!role) {
    return null;
  }
  const normalized = role.toLowerCase();
  if (normalized.includes("user") || normalized.includes("human")) {
    return "user";
  }
  if (normalized.includes("assistant") || normalized.includes("agent") || normalized.includes("model")) {
    return "assistant";
  }
  if (normalized.includes("commentary") || normalized.includes("system")) {
    return "commentary";
  }
  return null;
}

function extractMessageText(record: Record<string, unknown>): string {
  const direct = readString(record, ["text", "message", "content", "prompt", "response"]);
  if (direct) {
    return direct.trim();
  }
  const content = readUnknown(record, ["content", "messages"]);
  if (Array.isArray(content)) {
    return content.map((item) => (isRecord(item) ? extractMessageText(item) : String(item))).filter(Boolean).join("\n\n").trim();
  }
  return "";
}

function extractCommand(record: Record<string, unknown>): string[] {
  const command = readUnknown(record, ["command", "cmd", "argv"]);
  if (Array.isArray(command)) {
    return command.filter((item): item is string => typeof item === "string");
  }
  if (typeof command === "string" && command.trim()) {
    return [command.trim()];
  }
  return [];
}

function extractSignals(
  messages: GenericMessage[],
  patterns: string[],
  signalType: "correction" | "preference" | "decision",
  maxItems: number
): CodexCapturePreviewResponse["governance_preview"]["corrections"] {
  const items: CodexCapturePreviewResponse["governance_preview"]["corrections"] = [];
  for (const message of messages) {
    const matched = patterns.filter((pattern) => message.text.includes(pattern));
    if (matched.length === 0) {
      continue;
    }
    items.push({
      timestamp: message.timestamp,
      text: summarize(message.text, 280),
      signal_type: signalType,
      matched_rules: matched
    });
  }
  return items.slice(-maxItems);
}

function readString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function readNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function readUnknown(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }
  return null;
}

function inferGenericStatus(record: Record<string, unknown>): "success" | "failure" | "unknown" {
  const exitCode = readNumber(record, ["exit_code", "exitCode", "code"]);
  if (exitCode === 0) {
    return "success";
  }
  if (exitCode !== null) {
    return "failure";
  }
  const status = readString(record, ["status", "state"]);
  if (!status) {
    return "unknown";
  }
  const normalized = status.toLowerCase();
  if (["ok", "success", "completed", "succeeded"].includes(normalized)) {
    return "success";
  }
  if (["error", "failed", "failure"].includes(normalized)) {
    return "failure";
  }
  return "unknown";
}

function summarizeOptional(text: string | null): string | null {
  return text ? summarize(text, 240) : null;
}

function summarizeUnknown(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return summarize(value, 240);
  }
  try {
    return summarize(JSON.stringify(value), 240);
  } catch {
    return null;
  }
}

function summarize(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function normalizeMaxItems(value: number | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.min(500, Math.trunc(value)));
  }
  return 12;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
