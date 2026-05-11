import { readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type SessionIndexEntry = {
  id: string;
  thread_name?: string;
  updated_at?: string;
};

type CaptureMessage = {
  timestamp: string;
  role: "user" | "assistant" | "commentary";
  text: string;
};

type CaptureCommand = {
  timestamp: string;
  command: string[];
  cwd: string | null;
  exit_code: number | null;
  stdout_excerpt: string | null;
  stderr_excerpt: string | null;
  status: "success" | "failure" | "unknown";
};

type CaptureToolCall = {
  timestamp: string;
  tool_name: string;
  arguments_summary: string | null;
  result_summary: string | null;
  error_summary: string | null;
  status: "success" | "failure" | "unknown";
};

type CaptureMcpCall = {
  timestamp: string;
  server: string;
  tool: string;
  arguments_summary: string | null;
  result_summary: string | null;
  error_summary: string | null;
  status: "success" | "failure" | "unknown";
};

type CaptureSignal = {
  timestamp: string;
  text: string;
  signal_type: "correction" | "preference" | "decision";
  matched_rules: string[];
};

export type HostCaptureName = "codex" | "claude-code" | "openclaw" | "opencode";

export type CodexCapturePreviewRequest = {
  codex_home?: string | null;
  host_home?: string | null;
  thread_id?: string | null;
  max_items?: number | null;
};

export type CodexHostSessionListRequest = {
  codex_home?: string | null;
  host_home?: string | null;
  limit?: number | null;
};

export type CodexHostSessionListResponse = {
  host: HostCaptureName;
  codex_home: string;
  host_home: string;
  items: Array<{
    thread_id: string;
    thread_name: string | null;
    updated_at: string | null;
    session_file: string | null;
  }>;
};

export type CodexCapturePreviewResponse = {
  host: HostCaptureName;
  codex_home: string;
  host_home: string;
  thread_id: string;
  thread_name: string | null;
  session_file: string;
  updated_at: string | null;
  totals: {
    raw_event_count: number;
    message_count: number;
    user_message_count: number;
    assistant_message_count: number;
    commentary_count: number;
    command_event_count: number;
    tool_call_count: number;
    mcp_call_count: number;
  };
  governance_preview: {
    user_messages: CaptureMessage[];
    corrections: CaptureSignal[];
    preferences: CaptureSignal[];
    decisions: CaptureSignal[];
    commands: CaptureCommand[];
    tool_calls: CaptureToolCall[];
    mcp_calls: CaptureMcpCall[];
    workspace_paths: string[];
    readiness: {
      has_user_intent: boolean;
      has_execution_trace: boolean;
      has_tool_trace: boolean;
      has_corrections: boolean;
      quality: "high" | "medium" | "low";
      warnings: string[];
    };
  };
};

const CORRECTION_PATTERNS = [
  "不是",
  "不对",
  "理解有问题",
  "我的意思",
  "应该",
  "重新",
  "先别",
  "先不用",
  "涓嶆槸",
  "涓嶅",
  "鐞嗚В鏈夐棶棰",
  "鎴戠殑鎰忔€",
  "搴旇",
  "閲嶆柊",
  "鍏堝埆",
  "鍏堜笉鐢"
];

const PREFERENCE_PATTERNS = [
  "不要",
  "不需要",
  "必须",
  "默认",
  "只能",
  "优先",
  "不允许",
  "must",
  "must_not",
  "must not",
  "涓嶈",
  "涓嶉渶瑕",
  "蹇呴』",
  "榛樿",
  "鍙兘",
  "浼樺厛",
  "涓嶅厑璁"
];

const DECISION_PATTERNS = [
  "可以",
  "好的",
  "是的",
  "确认",
  "按这个",
  "就这样",
  "继续",
  "ok",
  "鍙互",
  "濂界殑",
  "鏄殑",
  "纭",
  "鎸夎繖涓",
  "灏辫繖鏍",
  "缁х画"
];

export async function previewCodexHostCapture(input: CodexCapturePreviewRequest): Promise<CodexCapturePreviewResponse> {
  const codexHome = resolveCodexHome(input.codex_home ?? null);
  const sessionIndex = await readJsonlFile<SessionIndexEntry>(path.join(codexHome, "session_index.jsonl"));
  const targetThread = resolveTargetThread(sessionIndex, input.thread_id ?? null);
  const sessionFile = await resolveLatestSessionFile(codexHome, targetThread.id);
  const sessionEvents = await readJsonlFile<Record<string, unknown>>(sessionFile);
  const maxItems = normalizeMaxItems(input.max_items);

  const messages: CaptureMessage[] = [];
  const commands: CaptureCommand[] = [];
  const toolCalls: CaptureToolCall[] = [];
  const mcpCalls: CaptureMcpCall[] = [];
  const workspacePaths = new Set<string>();
  const toolCallIndexByCallId = new Map<string, number>();
  const commandIndexByCallId = new Map<string, number>();

  for (const event of sessionEvents) {
    const timestamp = typeof event.timestamp === "string" ? event.timestamp : new Date(0).toISOString();
    const eventType = typeof event.type === "string" ? event.type : null;
    const payload = isRecord(event.payload) ? event.payload : {};

    if (eventType === "response_item" && payload.type === "message") {
      const role = payload.role === "user" || payload.role === "assistant" ? payload.role : null;
      const text = collectMessageText(payload.content);
      if (role && text && !shouldSkipCapturedMessage(role, text)) {
        messages.push({ timestamp, role, text });
      }
      continue;
    }

    if (eventType === "event_msg" && payload.type === "agent_message") {
      const text = typeof payload.message === "string" ? payload.message.trim() : "";
      if (text) {
        messages.push({ timestamp, role: "commentary", text });
      }
      continue;
    }

    if (eventType === "response_item" && (payload.type === "function_call" || payload.type === "custom_tool_call")) {
      const toolName = typeof payload.name === "string" ? payload.name : "unknown";
      const argsSummary =
        typeof payload.arguments === "string"
          ? summarizeText(payload.arguments, 800)
          : typeof payload.input === "string"
            ? summarizeText(payload.input, 800)
            : null;
      const index = toolCalls.length;
      toolCalls.push({
        timestamp,
        tool_name: toolName,
        arguments_summary: argsSummary,
        result_summary: extractResultSummary(payload),
        error_summary: extractErrorSummary(payload),
        status: inferPayloadStatus(payload)
      });
      if (typeof payload.call_id === "string") {
        toolCallIndexByCallId.set(payload.call_id, index);
      }
      const shellCommand = toolName === "shell_command" ? parseShellCommandArguments(payload.arguments) : null;
      if (shellCommand) {
        const commandIndex = commands.length;
        if (shellCommand.cwd) {
          workspacePaths.add(shellCommand.cwd);
        }
        commands.push({
          timestamp,
          command: [shellCommand.command],
          cwd: shellCommand.cwd,
          exit_code: null,
          stdout_excerpt: null,
          stderr_excerpt: null,
          status: "unknown"
        });
        if (typeof payload.call_id === "string") {
          commandIndexByCallId.set(payload.call_id, commandIndex);
        }
      }
      continue;
    }

    if (eventType === "response_item" && (payload.type === "function_call_output" || payload.type === "custom_tool_call_output")) {
      const callId = typeof payload.call_id === "string" ? payload.call_id : null;
      const resultSummary = extractResultSummary(payload);
      const errorSummary = extractErrorSummary(payload);
      if (callId && toolCallIndexByCallId.has(callId)) {
        const index = toolCallIndexByCallId.get(callId)!;
        toolCalls[index] = {
          ...toolCalls[index],
          result_summary: resultSummary ?? toolCalls[index].result_summary,
          error_summary: errorSummary ?? toolCalls[index].error_summary,
          status: errorSummary ? "failure" : resultSummary ? "success" : toolCalls[index].status
        };
      }
      if (callId && commandIndexByCallId.has(callId)) {
        const index = commandIndexByCallId.get(callId)!;
        const parsed = parseFunctionCallOutput(resultSummary ?? "");
        commands[index] = {
          ...commands[index],
          exit_code: parsed.exitCode ?? commands[index].exit_code,
          stdout_excerpt: parsed.output ?? commands[index].stdout_excerpt,
          stderr_excerpt: parsed.error ?? commands[index].stderr_excerpt,
          status: parsed.status ?? commands[index].status
        };
      }
      continue;
    }

    if (eventType === "event_msg" && payload.type === "exec_command_end") {
      const command = Array.isArray(payload.command) ? payload.command.filter((item): item is string => typeof item === "string") : [];
      const cwd = typeof payload.cwd === "string" ? payload.cwd : null;
      if (cwd) {
        workspacePaths.add(cwd);
      }
      if (typeof payload.call_id === "string" && commandIndexByCallId.has(payload.call_id)) {
        const existingIndex = commandIndexByCallId.get(payload.call_id)!;
        commands[existingIndex] = {
          ...commands[existingIndex],
          command: command.length > 0 ? command : commands[existingIndex].command,
          cwd: cwd ?? commands[existingIndex].cwd,
          exit_code: typeof payload.exit_code === "number" ? payload.exit_code : commands[existingIndex].exit_code,
          stdout_excerpt:
            extractTextSummary(payload.stdout) ??
            extractTextSummary(payload.aggregated_output) ??
            extractTextSummary(payload.formatted_output) ??
            commands[existingIndex].stdout_excerpt,
          stderr_excerpt: extractTextSummary(payload.stderr) ?? commands[existingIndex].stderr_excerpt,
          status: inferCommandStatus(payload)
        };
        continue;
      }
      const index = commands.length;
      commands.push({
        timestamp,
        command,
        cwd,
        exit_code: typeof payload.exit_code === "number" ? payload.exit_code : null,
        stdout_excerpt: extractTextSummary(payload.stdout) ?? extractTextSummary(payload.aggregated_output) ?? extractTextSummary(payload.formatted_output),
        stderr_excerpt: extractTextSummary(payload.stderr),
        status: inferCommandStatus(payload)
      });
      if (typeof payload.call_id === "string") {
        commandIndexByCallId.set(payload.call_id, index);
      }
      continue;
    }

    if (eventType === "event_msg" && payload.type === "dynamic_tool_call_response") {
      toolCalls.push({
        timestamp,
        tool_name: typeof payload.tool === "string" ? payload.tool : "dynamic_tool",
        arguments_summary: summarizeUnknown(payload.arguments),
        result_summary: summarizeContentItems(payload.content_items),
        error_summary: extractErrorSummary(payload),
        status: inferPayloadStatus(payload)
      });
      continue;
    }

    if (eventType === "event_msg" && payload.type === "web_search_end") {
      toolCalls.push({
        timestamp,
        tool_name: "web_search",
        arguments_summary: summarizeUnknown(payload.action ?? payload.query),
        result_summary: null,
        error_summary: extractErrorSummary(payload),
        status: inferPayloadStatus(payload)
      });
      continue;
    }

    if (eventType === "event_msg" && payload.type === "mcp_tool_call_end") {
      const invocation = isRecord(payload.invocation) ? payload.invocation : {};
      const server = typeof invocation.server === "string" ? invocation.server : "unknown";
      const tool = typeof invocation.tool === "string" ? invocation.tool : "unknown";
      mcpCalls.push({
        timestamp,
        server,
        tool,
        arguments_summary: summarizeUnknown(invocation.arguments),
        result_summary: extractResultSummary(payload),
        error_summary: extractErrorSummary(payload),
        status: inferPayloadStatus(payload)
      });
    }
  }

  const userMessages = messages.filter((item) => item.role === "user");
  const corrections = extractSignals(userMessages, CORRECTION_PATTERNS, "correction", maxItems);
  const preferences = extractSignals(userMessages, PREFERENCE_PATTERNS, "preference", maxItems);
  const decisions = extractDecisionSignals(userMessages, maxItems);

  const readinessWarnings: string[] = [];
  if (userMessages.length === 0) {
    readinessWarnings.push("No user messages found in the selected Codex session file.");
  }
  if (commands.length === 0) {
    readinessWarnings.push("No command execution events found; execution trace may be incomplete.");
  }
  if (toolCalls.length === 0 && mcpCalls.length === 0) {
    readinessWarnings.push("No tool or MCP calls found; this session may be message-only.");
  }

  const quality =
    userMessages.length > 0 && commands.length > 0 && (toolCalls.length > 0 || mcpCalls.length > 0)
      ? "high"
      : userMessages.length > 0 && (commands.length > 0 || toolCalls.length > 0 || mcpCalls.length > 0)
        ? "medium"
        : "low";

  return {
    host: "codex",
    codex_home: codexHome,
    host_home: codexHome,
    thread_id: targetThread.id,
    thread_name: targetThread.thread_name ?? null,
    session_file: sessionFile,
    updated_at: targetThread.updated_at ?? null,
    totals: {
      raw_event_count: sessionEvents.length,
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
        warnings: readinessWarnings
      }
    }
  };
}

export async function listCodexHostSessions(input: CodexHostSessionListRequest): Promise<CodexHostSessionListResponse> {
  const codexHome = resolveCodexHome(input.codex_home ?? null);
  const sessionIndex = await readJsonlFile<SessionIndexEntry>(path.join(codexHome, "session_index.jsonl"));
  const limit = normalizeMaxItems(input.limit);
  const sorted = [...sessionIndex]
    .sort((left, right) => {
      const leftTime = left.updated_at ? Date.parse(left.updated_at) : 0;
      const rightTime = right.updated_at ? Date.parse(right.updated_at) : 0;
      return rightTime - leftTime;
    })
    .slice(0, limit);

  const items = await Promise.all(
    sorted.map(async (entry) => {
      try {
        const sessionFile = await resolveLatestSessionFile(codexHome, entry.id);
        return {
          thread_id: entry.id,
          thread_name: entry.thread_name ?? null,
          updated_at: entry.updated_at ?? null,
          session_file: sessionFile
        };
      } catch {
        return {
          thread_id: entry.id,
          thread_name: entry.thread_name ?? null,
          updated_at: entry.updated_at ?? null,
          session_file: null
        };
      }
    })
  );

  return {
    host: "codex",
    codex_home: codexHome,
    host_home: codexHome,
    items
  };
}

function resolveCodexHome(customCodexHome: string | null): string {
  if (customCodexHome && customCodexHome.trim()) {
    return customCodexHome.trim();
  }
  return path.join(os.homedir(), ".codex");
}

function normalizeMaxItems(value: number | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.min(500, Math.trunc(value)));
  }
  return 500;
}

async function readJsonlFile<T>(filePath: string): Promise<T[]> {
  const content = await readFile(filePath, "utf8");
  const rows: T[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    rows.push(JSON.parse(trimmed) as T);
  }
  return rows;
}

function resolveTargetThread(entries: SessionIndexEntry[], requestedThreadId: string | null): SessionIndexEntry {
  if (requestedThreadId) {
    const match = entries.find((entry) => entry.id === requestedThreadId);
    if (!match) {
      throw new Error(`Codex thread not found in session_index.jsonl: ${requestedThreadId}`);
    }
    return match;
  }

  const sorted = [...entries].sort((left, right) => {
    const leftTime = left.updated_at ? Date.parse(left.updated_at) : 0;
    const rightTime = right.updated_at ? Date.parse(right.updated_at) : 0;
    return rightTime - leftTime;
  });
  const latest = sorted[0];
  if (!latest) {
    throw new Error("No Codex threads found in session_index.jsonl.");
  }
  return latest;
}

async function resolveLatestSessionFile(codexHome: string, threadId: string): Promise<string> {
  const sessionsRoot = path.join(codexHome, "sessions");
  const matches = await findFilesBySuffix(sessionsRoot, `${threadId}.jsonl`);
  if (matches.length === 0) {
    throw new Error(`No Codex session file found for thread: ${threadId}`);
  }
  const stats = await Promise.all(
    matches.map(async (filePath) => ({
      filePath,
      mtimeMs: (await stat(filePath)).mtimeMs
    }))
  );
  stats.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return stats[0].filePath;
}

async function findFilesBySuffix(rootDir: string, suffix: string): Promise<string[]> {
  const results: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(suffix)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

function collectMessageText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }

  const parts: string[] = [];
  for (const item of content) {
    if (!isRecord(item)) {
      continue;
    }
    const text = typeof item.text === "string" ? item.text : "";
    if (text.trim()) {
      parts.push(text.trim());
    }
  }

  return parts.join("\n\n").trim();
}

function shouldSkipCapturedMessage(role: "user" | "assistant", text: string): boolean {
  if (role !== "user") {
    return false;
  }
  const compact = normalizeForMatch(text);
  return (
    compact.startsWith("# agents.md instructions for ") ||
    compact.includes("<environment_context>") ||
    compact.includes("</environment_context>")
  );
}

function extractSignals(
  messages: CaptureMessage[],
  patterns: string[],
  signalType: "correction" | "preference",
  maxItems: number
): CaptureSignal[] {
  const items: CaptureSignal[] = [];
  for (const message of messages) {
    const compact = normalizeForMatch(message.text);
    const matched = patterns.filter((pattern) => compact.includes(pattern));
    if (matched.length === 0) {
      continue;
    }
    items.push({
      timestamp: message.timestamp,
      text: summarizeText(message.text, 280),
      signal_type: signalType,
      matched_rules: matched
    });
  }
  return items.slice(-maxItems);
}

function extractDecisionSignals(messages: CaptureMessage[], maxItems: number): CaptureSignal[] {
  const items: CaptureSignal[] = [];
  for (const message of messages) {
    const compact = normalizeForMatch(message.text);
    const matched = DECISION_PATTERNS.filter((pattern) => compact.includes(pattern));
    const isShortDecision = compact.length <= 80 && matched.length > 0;
    if (!isShortDecision) {
      continue;
    }
    items.push({
      timestamp: message.timestamp,
      text: summarizeText(message.text.replace(/\s+/g, " ").trim(), 200),
      signal_type: "decision",
      matched_rules: matched
    });
  }
  return items.slice(-maxItems);
}

function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function summarizeText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function extractTextSummary(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const compact = value.trim();
  return compact ? summarizeText(compact, 4000) : null;
}

function summarizeContentItems(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return summarizeUnknown(value);
  }
  const texts: string[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const text = typeof item.text === "string" ? item.text : "";
    if (text.trim()) {
      texts.push(text.trim());
    }
  }
  return texts.length > 0 ? summarizeText(texts.join("\n"), 4000) : null;
}

function summarizeUnknown(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return summarizeText(value, 4000);
  }
  try {
    return summarizeText(JSON.stringify(value), 4000);
  } catch {
    return null;
  }
}

function extractResultSummary(payload: Record<string, any>): string | null {
  return (
    extractTextSummary(payload.result) ??
    extractTextSummary(payload.output) ??
    summarizeUnknown(payload.response) ??
    null
  );
}

function parseShellCommandArguments(value: unknown): { command: string; cwd: string | null } | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as { command?: unknown; workdir?: unknown };
    if (typeof parsed.command !== "string" || !parsed.command.trim()) {
      return null;
    }
    return {
      command: parsed.command.trim(),
      cwd: typeof parsed.workdir === "string" && parsed.workdir.trim() ? parsed.workdir.trim() : null
    };
  } catch {
    return null;
  }
}

function parseFunctionCallOutput(text: string): {
  output: string | null;
  error: string | null;
  exitCode: number | null;
  status: "success" | "failure" | "unknown" | null;
} {
  if (!text.trim()) {
    return { output: null, error: null, exitCode: null, status: null };
  }
  const exitMatch = text.match(/Exit code:\s*(-?\d+)/i);
  const exitCode = exitMatch ? Number(exitMatch[1]) : null;
  const outputMatch = text.match(/Output:\s*([\s\S]*?)(?:\nError:\s*[\s\S]*)?$/);
  const errorMatch = text.match(/Error:\s*([\s\S]*)$/);
  return {
    output: outputMatch?.[1]?.trim() ? summarizeText(outputMatch[1].trim(), 4000) : summarizeText(text.trim(), 4000),
    error: errorMatch?.[1]?.trim() ? summarizeText(errorMatch[1].trim(), 4000) : null,
    exitCode,
    status: exitCode === null ? null : exitCode === 0 ? "success" : "failure"
  };
}

function extractErrorSummary(payload: Record<string, any>): string | null {
  return (
    extractTextSummary(payload.error) ??
    extractTextSummary(payload.stderr) ??
    extractTextSummary(payload.message) ??
    null
  );
}

function inferPayloadStatus(payload: Record<string, any>): "success" | "failure" | "unknown" {
  if (payload.success === true) {
    return "success";
  }
  if (payload.success === false) {
    return "failure";
  }
  if (typeof payload.error === "string" && payload.error.trim()) {
    return "failure";
  }
  if (typeof payload.status === "string") {
    const normalized = payload.status.toLowerCase();
    if (["ok", "success", "completed"].includes(normalized)) {
      return "success";
    }
    if (["error", "failed", "failure"].includes(normalized)) {
      return "failure";
    }
  }
  return "unknown";
}

function inferCommandStatus(payload: Record<string, any>): "success" | "failure" | "unknown" {
  const exitCode = typeof payload.exit_code === "number" ? payload.exit_code : null;
  if (exitCode === 0) {
    return "success";
  }
  if (exitCode !== null) {
    return "failure";
  }
  return "unknown";
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
