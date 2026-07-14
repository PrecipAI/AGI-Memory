import { readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  CodexCapturePreviewRequest,
  CodexCapturePreviewResponse,
  CodexHostSessionListRequest,
  CodexHostSessionListResponse
} from "./codexHostCapture.js";
import { detectTraeHostVariant, getTraeHostProfile } from "./traeHostProfile.js";
import { enhanceTraeExtraction, type TraeExtractionEnhancement } from "./traeExtractionEnhancer.js";

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

  // ─── §TRAE 适配：检测宿主变体（IDE/Work/generic）───
  const variant = detectTraeHostVariant({
    host: "trae",
    sessionRecords: records as Array<Record<string, unknown>>
  });
  const profile = getTraeHostProfile(variant);

  // ─── §TRAE 适配：结构化增强 session_memory 摘要 ───
  const enhancement = enhanceTraeExtraction({
    records,
    profile
  });

  // TRAE 的 session_memory 每行是摘要不是原始对话。
  // 设计原则：绝不虚构原始对话——trae 宿主的对话原文存在加密 SQLCipher DB 中无法读取，
  // 只能拿到 memory 系统自动生成的摘要（intent/actions/outcome/learned）。
  // 因此所有摘要都标记为 commentary 角色，并在 text 前加 [摘要] 前缀，
  // 下游治理抽取器据此知道这是摘要而非用户原话，不会误以为是真实对话。
  const messages: TraeMessage[] = [];
  for (const record of records) {
    const timestamp = extractTraeTimestamp(record);
    const intent = extractString(record.intent);
    const outcome = extractString(record.outcome);
    const learned = extractString(record.learned);
    const actions = extractString(record.actions);

    // intent 是用户意图摘要，标注为 commentary 而非 user（不是用户原话）
    if (intent) {
      messages.push({ timestamp, role: "commentary", text: `[摘要·用户意图] ${intent}` });
    }
    // actions 是执行动作摘要
    if (actions) {
      messages.push({ timestamp, role: "commentary", text: `[摘要·执行动作] ${actions}` });
    }
    // outcome 是结果摘要，标注为 commentary 而非 assistant（不是助手原话）
    if (outcome) {
      messages.push({ timestamp, role: "commentary", text: `[摘要·执行结果] ${outcome}` });
    }
    // learned 是学到的知识摘要
    if (learned) {
      messages.push({ timestamp, role: "commentary", text: `[摘要·学到知识] ${learned}` });
    }
  }

  // ─── §TRAE 适配：把 learned_knowledge_candidates 作为额外 commentary 消息 ───
  // 这些是增强器从 learned 字段直接提取的知识候选，不需要 LLM 再抽
  for (const candidate of enhancement.learned_knowledge_candidates) {
    messages.push({
      timestamp: candidate.source_timestamp,
      role: "commentary",
      text: `[TRAE增强·知识候选] ${candidate.title} | ${candidate.content}`
    });
  }

  // ─── §TRAE 适配：把 execution_traces 作为额外 commentary 消息（IDE 场景）───
  if (profile.extract_actions_as_trace) {
    for (const trace of enhancement.execution_traces) {
      messages.push({
        timestamp: trace.timestamp,
        role: "commentary",
        text: `[TRAE增强·执行轨迹] ${trace.action}`
      });
    }
  }

  // trae 摘要模式下没有真正的 user/assistant 消息
  const userMessages: TraeMessage[] = [];
  const assistantMessages: TraeMessage[] = [];
  const commentaryMessages = messages.filter((m) => m.role === "commentary");

  // 不从摘要里提取 corrections/preferences/decisions 信号——
  // 摘要里的"应该""必须"是描述性词汇，不是用户真实说的，提取出来是虚构信号。
  // 信号提取留给宿主模型在 host_model 模式下基于摘要内容自行判断。

  const warnings: string[] = [
    "TRAE 宿主仅提供会话摘要，非原始对话（trae 对话原文存于加密 DB 无法读取）。",
    "所有消息标记为 commentary 角色，治理抽取器应基于摘要内容判断而非当作原话。",
    "corrections/preferences/decisions 信号未提取（避免从摘要描述性词汇虚构信号）。",
    `§TRAE 适配: 检测到变体=${variant}，已应用 ${profile.variant} profile`
  ];
  // 把增强说明加到 warnings
  for (const note of enhancement.enhancement_notes) {
    warnings.push(`§TRAE 增强: ${note}`);
  }
  if (commentaryMessages.length === 0) {
    warnings.push("No summary records found in the selected TRAE session_memory file.");
  }

  // 增强后 quality 提升
  const quality = enhancement.enhanced_quality === "high"
    ? "high"
    : (commentaryMessages.length > 0 ? "medium" : "low");

  const response: CodexCapturePreviewResponse = {
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
      user_message_count: 0,
      assistant_message_count: 0,
      commentary_count: commentaryMessages.length,
      command_event_count: 0,
      tool_call_count: 0,
      mcp_call_count: 0
    },
    governance_preview: {
      // 关键修正：trae 摘要走 commentary_messages 而非 user_messages。
      // 这样下游 buildGovernanceBatchPreview 的启发式抽取循环（line 359/491）不会执行
      // （因为它迭代 user_messages，user_messages 为空时跳过），
      // sessionSummarizer 也不会把摘要错误计入 signal_stats.user_directives。
      // 候选抽取完全交给 host_model LLM 基于 commentary_messages 做判断。
      user_messages: [],
      commentary_messages: commentaryMessages.slice(-maxItems),
      corrections: [],
      preferences: [],
      decisions: [],
      commands: [],
      tool_calls: [],
      mcp_calls: [],
      workspace_paths: [],
      readiness: {
        has_user_intent: commentaryMessages.length > 0,
        // §TRAE 适配: 有 execution_traces 时标记 has_execution_trace
        has_execution_trace: enhancement.execution_traces.length > 0,
        has_tool_trace: false,
        has_corrections: false,
        quality,
        warnings
      }
    }
  };

  // §TRAE 适配: 把增强上下文附加到 response（通过类型扩展）
  // 下游 hostCaptureGovernanceRun 可以读取 trae_enhancement 字段，
  // 把 learned_knowledge_candidates 直接作为 knowledge_candidates 预填
  (response as CodexCapturePreviewResponse & { trae_enhancement?: TraeExtractionEnhancement }).trae_enhancement = enhancement;

  return response;
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

// ─── 信号提取 ─────────────────────────────────────────────────────
// 注意：trae 摘要模式下不再提取 corrections/preferences/decisions 信号。
// 这些信号必须来自真实用户原话，从摘要描述性词汇里提取会虚构信号。
// 信号提取留给宿主模型在 host_model 模式下基于摘要内容自行判断。

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
