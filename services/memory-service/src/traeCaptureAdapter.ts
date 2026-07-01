import { readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  CodexCapturePreviewRequest,
  CodexCapturePreviewResponse,
  CodexHostSessionListRequest,
  CodexHostSessionListResponse
} from "./codexHostCapture.js";

// TRAE session_memory 单行记录的形状
// 每行是摘要而非对话：{intent, actions, outcome, learned, message_summary_time, message_id}
type TraeSessionMemoryRecord = {
  intent?: unknown;
  actions?: unknown;
  outcome?: unknown;
  learned?: unknown;
  message_summary_time?: unknown;
  message_id?: unknown;
};

type TraeSessionEntry = {
  thread_id: string;
  thread_name: string | null;
  updated_at: string | null;
  session_file: string;
};

type TraeMessage = {
  timestamp: string;
  role: "user" | "assistant" | "commentary";
  text: string;
};

// ─── 对外暴露的两个核心函数 ───────────────────────────────────────

export async function previewTraeHostCapture(
  input: CodexCapturePreviewRequest
): Promise<CodexCapturePreviewResponse> {
  const hostHome = resolveTraeHostHome(input.host_home ?? input.codex_home ?? null);
  const sessions = await listTraeSessionEntries(hostHome, normalizeMaxItems(1000));
  const target = resolveTargetSession(sessions, input.thread_id ?? null);
  const records = await readTraeRecords(target.session_file);
  const maxItems = normalizeMaxItems(input.max_items);

  // TRAE 的 session_memory 每行是摘要不是对话
  // 把 intent + learned 拼接作为 user_message（learned 含技术细节，能触发治理抽取）
  // outcome 作为 assistant_message
  const messages: TraeMessage[] = [];
  for (const record of records) {
    const timestamp = extractTraeTimestamp(record);
    const intent = extractString(record.intent);
    const outcome = extractString(record.outcome);
    const learned = extractString(record.learned);
    // 拼接 intent + learned 作为 user_message（learned 含技术细节如"netlify.toml 配置 publish 目录"）
    const userText = [intent, learned ? `学到的: ${learned}` : ""].filter(Boolean).join("\n");
    if (userText) {
      messages.push({ timestamp, role: "user", text: userText });
    }
    if (outcome) {
      messages.push({ timestamp, role: "assistant", text: outcome });
    }
  }

  const userMessages = messages.filter((m) => m.role === "user");
  const assistantMessages = messages.filter((m) => m.role === "assistant");
  const corrections = extractSignals(userMessages, CORRECTION_PATTERNS, "correction", maxItems);
  const preferences = extractSignals(userMessages, PREFERENCE_PATTERNS, "preference", maxItems);
  const decisions = extractDecisionSignals(userMessages, maxItems);

  const warnings: string[] = [];
  if (userMessages.length === 0) {
    warnings.push("No intent summaries found in the selected TRAE session_memory file.");
  }
  if (assistantMessages.length === 0) {
    warnings.push("No outcome summaries found in the selected TRAE session_memory file.");
  }

  const quality =
    userMessages.length > 0 && assistantMessages.length > 0
      ? "high"
      : userMessages.length > 0 || assistantMessages.length > 0
        ? "medium"
        : "low";

  return {
    host: "trae",
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
      workspace_paths: [],
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

export async function listTraeHostSessions(
  input: CodexHostSessionListRequest
): Promise<CodexHostSessionListResponse> {
  const hostHome = resolveTraeHostHome(input.host_home ?? input.codex_home ?? null);
  const limit = normalizeMaxItems(input.limit);
  const entries = await listTraeSessionEntries(hostHome, limit);
  return {
    host: "trae",
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

function resolveTraeHostHome(customHostHome: string | null): string {
  if (customHostHome && customHostHome.trim()) {
    return customHostHome.trim();
  }
  return path.join(os.homedir(), ".trae-cn");
}

async function listTraeSessionEntries(
  hostHome: string,
  limit: number
): Promise<TraeSessionEntry[]> {
  // 会话文件位于 {hostHome}/memory/projects/{project-hash}/{date}/session_memory_*.jsonl
  const memoryRoot = path.join(hostHome, "memory", "projects");
  const files = await findTraeSessionFiles(memoryRoot);
  const sliced = files.slice(0, Math.max(limit * 5, limit));
  const entries = await Promise.all(
    sliced.map(async (filePath) => {
      const fileStat = await stat(filePath);
      const records = await readTraeRecords(filePath).catch(() => [] as TraeSessionMemoryRecord[]);
      const firstIntent = records
        .map((r) => extractString(r.intent))
        .find((text) => text && text.trim());
      const messageId = records
        .map((r) => (typeof r.message_id === "string" ? r.message_id : null))
        .find((id): id is string => !!id);
      return {
        thread_id: messageId ?? path.basename(filePath).replace(/\.jsonl$/i, ""),
        thread_name: firstIntent
          ? summarize(firstIntent.replace(/\s+/g, " "), 80)
          : path.basename(filePath),
        updated_at: fileStat.mtime.toISOString(),
        session_file: filePath
      };
    })
  );
  return entries
    .sort((left, right) => Date.parse(right.updated_at ?? "") - Date.parse(left.updated_at ?? ""))
    .slice(0, limit);
}

async function findTraeSessionFiles(rootDir: string): Promise<string[]> {
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
        // 仅收集 session_memory_*.jsonl
        if (entry.name.startsWith("session_memory_")) {
          results.push(fullPath);
        }
      }
    }
  }
  const stats = await Promise.all(
    results.map(async (filePath) => ({ filePath, mtimeMs: (await stat(filePath)).mtimeMs }))
  );
  return stats.sort((left, right) => right.mtimeMs - left.mtimeMs).map((item) => item.filePath);
}

async function readTraeRecords(filePath: string): Promise<TraeSessionMemoryRecord[]> {
  const content = await readFile(filePath, "utf8");
  const rows: TraeSessionMemoryRecord[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      rows.push(JSON.parse(trimmed) as TraeSessionMemoryRecord);
    } catch {
      // 跳过解析失败的行
    }
  }
  return rows;
}

function resolveTargetSession(
  entries: TraeSessionEntry[],
  requestedThreadId: string | null
): TraeSessionEntry {
  if (requestedThreadId) {
    const match = entries.find(
      (entry) => entry.thread_id === requestedThreadId || entry.session_file === requestedThreadId
    );
    if (!match) {
      throw new Error(`TRAE thread not found: ${requestedThreadId}`);
    }
    return match;
  }
  const latest = entries[0];
  if (!latest) {
    throw new Error(
      "No TRAE session_memory files found. Provide host_home that contains memory/projects/{project-hash}/{date}/session_memory_*.jsonl."
    );
  }
  return latest;
}

function extractTraeTimestamp(record: TraeSessionMemoryRecord): string {
  if (
    typeof record.message_summary_time === "string" &&
    record.message_summary_time.trim()
  ) {
    return record.message_summary_time;
  }
  return new Date(0).toISOString();
}

function extractString(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  // 摘要字段有时是字符串数组
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      if (typeof item === "string" && item.trim()) {
        parts.push(item.trim());
      } else if (isRecord(item) && typeof item.text === "string" && item.text.trim()) {
        parts.push(item.text.trim());
      }
    }
    if (parts.length > 0) {
      return parts.join("\n");
    }
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
  messages: TraeMessage[],
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
  messages: TraeMessage[],
  maxItems: number
): CodexCapturePreviewResponse["governance_preview"]["decisions"] {
  const items: CodexCapturePreviewResponse["governance_preview"]["decisions"] = [];
  for (const message of messages) {
    const matched = DECISION_PATTERNS.filter((pattern) => message.text.includes(pattern));
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
