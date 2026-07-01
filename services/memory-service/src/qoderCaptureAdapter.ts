import { readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  CodexCapturePreviewRequest,
  CodexCapturePreviewResponse,
  CodexHostSessionListRequest,
  CodexHostSessionListResponse
} from "./codexHostCapture.js";

// QoderWork 会话 JSONL 单行记录的形状
type QoderRecord = {
  uuid?: unknown;
  parentUuid?: unknown;
  sessionId?: unknown;
  type?: unknown; // user / assistant / system 等
  timestamp?: unknown;
  cwd?: unknown;
  version?: unknown;
  agentId?: unknown;
  message?: unknown;
};

type QoderSessionEntry = {
  thread_id: string;
  thread_name: string | null;
  updated_at: string | null;
  session_file: string;
};

type QoderMessage = {
  timestamp: string;
  role: "user" | "assistant" | "commentary";
  text: string;
};

// ─── 对外暴露的两个核心函数 ───────────────────────────────────────

export async function previewQoderHostCapture(
  input: CodexCapturePreviewRequest
): Promise<CodexCapturePreviewResponse> {
  const hostHome = resolveQoderHostHome(input.host_home ?? input.codex_home ?? null);
  const sessions = await listQoderSessionEntries(hostHome, normalizeMaxItems(1000));
  const target = resolveTargetSession(sessions, input.thread_id ?? null);
  const records = await readQoderRecords(target.session_file);
  const maxItems = normalizeMaxItems(input.max_items);

  const messages: QoderMessage[] = [];
  const workspacePaths = new Set<string>();

  for (const record of records) {
    const role = extractQoderRole(record);
    const text = extractQoderMessageText(record);
    const timestamp = extractQoderTimestamp(record);
    if (role && text) {
      messages.push({ timestamp, role, text });
    }
    // 收集 cwd 作为 workspace 路径
    if (typeof record.cwd === "string" && record.cwd.trim()) {
      workspacePaths.add(record.cwd.trim());
    }
  }

  const userMessages = messages.filter((m) => m.role === "user");
  const assistantMessages = messages.filter((m) => m.role === "assistant");
  const corrections = extractSignals(userMessages, CORRECTION_PATTERNS, "correction", maxItems);
  const preferences = extractSignals(userMessages, PREFERENCE_PATTERNS, "preference", maxItems);
  const decisions = extractDecisionSignals(userMessages, maxItems);

  const warnings: string[] = [];
  if (userMessages.length === 0) {
    warnings.push("No user messages found in the selected QoderWork session file.");
  }
  if (assistantMessages.length === 0) {
    warnings.push("No assistant messages found in the selected QoderWork session file.");
  }

  const quality =
    userMessages.length > 0 && assistantMessages.length > 0
      ? "high"
      : userMessages.length > 0 || assistantMessages.length > 0
        ? "medium"
        : "low";

  return {
    host: "qoder",
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
      assistant_message_count: assistantMessages.length,
      commentary_count: messages.filter((m) => m.role === "commentary").length,
      command_event_count: 0,
      tool_call_count: 0,
      mcp_call_count: 0
    },
    governance_preview: {
      user_messages: userMessages.slice(-maxItems),
      corrections,
      preferences,
      decisions,
      commands: [],
      tool_calls: [],
      mcp_calls: [],
      workspace_paths: Array.from(workspacePaths).sort(),
      readiness: {
        has_user_intent: userMessages.length > 0,
        has_execution_trace: false,
        has_tool_trace: false,
        has_corrections: corrections.length > 0,
        quality,
        warnings
      }
    }
  };
}

export async function listQoderHostSessions(
  input: CodexHostSessionListRequest
): Promise<CodexHostSessionListResponse> {
  const hostHome = resolveQoderHostHome(input.host_home ?? input.codex_home ?? null);
  const limit = normalizeMaxItems(input.limit);
  const entries = await listQoderSessionEntries(hostHome, limit);
  return {
    host: "qoder",
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

// ─── 内部辅助函数 ─────────────────────────────────────────────────

function resolveQoderHostHome(customHostHome: string | null): string {
  if (customHostHome && customHostHome.trim()) {
    return customHostHome.trim();
  }
  return path.join(os.homedir(), ".qoderworkcn");
}

async function listQoderSessionEntries(
  hostHome: string,
  limit: number
): Promise<QoderSessionEntry[]> {
  // 会话文件位于 {hostHome}/projects/{workspace-hash}/*.jsonl
  const projectsRoot = path.join(hostHome, "projects");
  const files = await findQoderSessionFiles(projectsRoot);
  // 按 mtime 倒序
  const sliced = files.slice(0, Math.max(limit * 5, limit));
  const entries = await Promise.all(
    sliced.map(async (filePath) => {
      const fileStat = await stat(filePath);
      const records = await readQoderRecords(filePath).catch(() => [] as QoderRecord[]);
      const firstUserText = records
        .filter((r) => extractQoderRole(r) === "user")
        .map(extractQoderMessageText)
        .find((text) => text.trim());
      const sessionId = records
        .map((r) => (typeof r.sessionId === "string" ? r.sessionId : null))
        .find((id): id is string => !!id);
      return {
        thread_id: sessionId ?? path.basename(filePath).replace(/\.jsonl$/i, ""),
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

async function findQoderSessionFiles(rootDir: string): Promise<string[]> {
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
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        results.push(fullPath);
      }
    }
  }
  const stats = await Promise.all(
    results.map(async (filePath) => ({ filePath, mtimeMs: (await stat(filePath)).mtimeMs }))
  );
  return stats.sort((left, right) => right.mtimeMs - left.mtimeMs).map((item) => item.filePath);
}

async function readQoderRecords(filePath: string): Promise<QoderRecord[]> {
  const content = await readFile(filePath, "utf8");
  const rows: QoderRecord[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      rows.push(JSON.parse(trimmed) as QoderRecord);
    } catch {
      // 跳过解析失败的行
    }
  }
  return rows;
}

function resolveTargetSession(
  entries: QoderSessionEntry[],
  requestedThreadId: string | null
): QoderSessionEntry {
  if (requestedThreadId) {
    const match = entries.find(
      (entry) => entry.thread_id === requestedThreadId || entry.session_file === requestedThreadId
    );
    if (!match) {
      throw new Error(`QoderWork thread not found: ${requestedThreadId}`);
    }
    return match;
  }
  const latest = entries[0];
  if (!latest) {
    throw new Error(
      "No QoderWork session files found. Provide host_home that contains projects/{workspace-hash}/*.jsonl."
    );
  }
  return latest;
}

function extractQoderTimestamp(record: QoderRecord): string {
  if (typeof record.timestamp === "string" && record.timestamp.trim()) {
    return record.timestamp;
  }
  return new Date(0).toISOString();
}

function extractQoderRole(record: QoderRecord): QoderMessage["role"] | null {
  // QoderWork 用 type 字段标识角色：user / assistant / system
  const typeValue = typeof record.type === "string" ? record.type.toLowerCase() : "";
  if (typeValue === "user") {
    return "user";
  }
  if (typeValue === "assistant") {
    return "assistant";
  }
  if (typeValue === "system") {
    return "commentary";
  }
  return null;
}

function extractQoderMessageText(record: QoderRecord): string {
  // message.content 是数组 [{type:"text", text:"..."}]，需要 join 所有 type=text 的 text
  const message = record.message;
  // 兜底：message 本身是字符串
  if (typeof message === "string" && message.trim()) {
    return message.trim();
  }
  if (!isRecord(message)) {
    return "";
  }
  const content = message.content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (!isRecord(item)) {
        continue;
      }
      // 仅聚合 type=text 的文本
      if (typeof item.type === "string" && item.type !== "text") {
        continue;
      }
      if (typeof item.text === "string" && item.text.trim()) {
        parts.push(item.text);
      }
    }
    return parts.join("\n\n").trim();
  }
  // 兜底：message.content 是字符串
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }
  return "";
}

// ─── 信号提取（与 codexHostCapture 风格保持一致） ──────────────────

const CORRECTION_PATTERNS = [
  "不是",
  "不对",
  "理解有问题",
  "我的意思",
  "应该",
  "重新",
  "先别",
  "先不用"
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
  "must not"
];

const DECISION_PATTERNS = [
  "可以",
  "好的",
  "是的",
  "确认",
  "按这个",
  "就这样",
  "继续",
  "ok"
];

function extractSignals(
  messages: QoderMessage[],
  patterns: string[],
  signalType: "correction" | "preference",
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

function extractDecisionSignals(
  messages: QoderMessage[],
  maxItems: number
): CodexCapturePreviewResponse["governance_preview"]["decisions"] {
  const items: CodexCapturePreviewResponse["governance_preview"]["decisions"] = [];
  for (const message of messages) {
    const matched = DECISION_PATTERNS.filter((pattern) => message.text.includes(pattern));
    // 仅当用户消息较短且命中决策模式时，才视为决策信号
    const isShortDecision = message.text.replace(/\s+/g, " ").trim().length <= 80 && matched.length > 0;
    if (!isShortDecision) {
      continue;
    }
    items.push({
      timestamp: message.timestamp,
      text: summarize(message.text.replace(/\s+/g, " ").trim(), 200),
      signal_type: "decision",
      matched_rules: matched
    });
  }
  return items.slice(-maxItems);
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
