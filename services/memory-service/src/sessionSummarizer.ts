import type { CodexCapturePreviewResponse } from "./codexHostCapture.js";

// ─── Types ─────────────────────────────────────────────────────────────

export type SummarizedSession = {
  /** Compressed mission brief text, ready to embed in MCP tool response */
  mission_brief: string;
  /** Token estimate of the mission brief (rough: chars / 3.5) */
  estimated_tokens: number;
  /** How many raw events were processed */
  raw_event_count: number;
  /** How many events survived compression */
  retained_event_count: number;
  /** Compression ratio */
  compression_ratio: number;
  /** Signal breakdown */
  signal_stats: {
    user_directives: number;
    failure_events: number;
    breakthrough_events: number;
    success_metadata: number;
  };
};

type ScoredSegment = {
  timestamp: string;
  category: "user_directive" | "failure_event" | "breakthrough" | "success_meta";
  score: number;
  text: string;
};

// ─── Config ────────────────────────────────────────────────────────────

const DEFAULT_TOKEN_BUDGET = 8000;
const CHARS_PER_TOKEN = 3.5;

/** Minimum text length to be considered a real user directive (not "继续"/"嗯") */
const MIN_DIRECTIVE_LENGTH = 4;

/** Signals that a user message is a throwaway (continuation, acknowledgment) */
const THROWAWAY_USER_MESSAGES = new Set([
  "继续", "就行", "可以", "好的", "嗯", "ok", "行", "是", "对",
  "继续目标看看目标是什么", "不要写了",
]);

/** Keywords that mark a user message as containing a strong preference or rule */
const RULE_SIGNAL_KEYWORDS = [
  "不要", "不需要", "必须", "不能", "不允许", "只能", "默认",
  "先不", "后面再", "记住就行", "记住这个",
  "禁止", "永远不", "绝对不",
  "must", "must not", "must_not", "never", "always", "only",
];

/** Keywords that mark a decision or architectural choice */
const DECISION_SIGNAL_KEYWORDS = [
  "用sql", "用队列", "用redis", "用docker",
  "选这个", "就这样", "按这个", "方案是",
  "决定", "确认", "跑通",
];

/** Keywords indicating a breakthrough or resolution moment */
const BREAKTHROUGH_KEYWORDS = [
  "跑通了", "成功了", "部署完成", "验证通过", "测试通过",
  "解决了", "修复了", "搞定了",
  "build succeeded", "deployed", "passed", "working",
];

/** Patterns for ephemeral values that should be replaced with placeholders */
const EPHEMERAL_PATTERNS: Array<{ regex: RegExp; placeholder: string }> = [
  { regex: /[A-Z]:\\(?:Users|home)\\[^\s"'})\]]+/gi, placeholder: "[USER_PATH]" },
  { regex: /\b(?:pid|PID)\s*[=:]\s*\d+/g, placeholder: "pid=[PID]" },
  { regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\b/g, placeholder: "[IP]" },
  { regex: /:\d{4,5}\b/g, placeholder: ":[PORT]" },
  { regex: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, placeholder: "[UUID]" },
  { regex: /sk[-_][a-zA-Z0-9]{16,}/gi, placeholder: "[SECRET_KEY]" },
  { regex: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, placeholder: "[TIMESTAMP]" },
];

// ─── Main Entry ────────────────────────────────────────────────────────

export function summarizeSession(
  capture: CodexCapturePreviewResponse,
  tokenBudget: number = DEFAULT_TOKEN_BUDGET
): SummarizedSession {
  const gp = capture.governance_preview;
  const segments: ScoredSegment[] = [];

  // 1. Score user directives
  for (const msg of gp.user_messages) {
    const text = msg.text.trim();
    if (isThrowaway(text)) continue;
    if (text.startsWith("<goal_context>") || text.startsWith("<turn_aborted>")) continue;
    if (text.length < MIN_DIRECTIVE_LENGTH) continue;

    const score = scoreUserDirective(text);
    if (score <= 0) continue;

    const tag = classifyDirectiveTag(text);
    const compressed = compressUserMessage(text, 200);

    segments.push({
      timestamp: formatTimestamp(msg.timestamp),
      category: "user_directive",
      score,
      text: `${tag} ${compressed}`,
    });
  }

  // 2. Score pre-classified signals (corrections, preferences, decisions)
  for (const signal of gp.corrections) {
    segments.push({
      timestamp: formatTimestamp(signal.timestamp),
      category: "user_directive",
      score: 8,
      text: `[CORRECTION] ${compressUserMessage(signal.text, 180)}`,
    });
  }
  for (const signal of gp.preferences) {
    segments.push({
      timestamp: formatTimestamp(signal.timestamp),
      category: "user_directive",
      score: 9,
      text: `[PREFERENCE] ${compressUserMessage(signal.text, 180)}`,
    });
  }
  for (const signal of gp.decisions) {
    segments.push({
      timestamp: formatTimestamp(signal.timestamp),
      category: "breakthrough",
      score: 6,
      text: `[DECISION] ${compressUserMessage(signal.text, 180)}`,
    });
  }

  // 3. Score commands
  for (const cmd of gp.commands) {
    if (cmd.status === "failure" || (cmd.exit_code !== null && cmd.exit_code !== 0)) {
      const errorSnippet = cmd.stderr_excerpt
        ? truncate(cmd.stderr_excerpt, 200)
        : cmd.stdout_excerpt
          ? truncate(cmd.stdout_excerpt, 200)
          : "no output";
      segments.push({
        timestamp: formatTimestamp(cmd.timestamp),
        category: "failure_event",
        score: 7,
        text: `Command: ${truncate(cmd.command.join(" "), 120)} | exit=${cmd.exit_code} | Error: ${stripEphemeral(errorSnippet)}`,
      });
    } else {
      // Success: metadata only
      segments.push({
        timestamp: formatTimestamp(cmd.timestamp),
        category: "success_meta",
        score: 1,
        text: `[CMD OK] ${truncate(cmd.command.join(" "), 80)}`,
      });
    }
  }

  // 4. Score tool calls
  for (const tc of gp.tool_calls) {
    if (tc.status === "failure" || tc.error_summary) {
      segments.push({
        timestamp: formatTimestamp(tc.timestamp),
        category: "failure_event",
        score: 7,
        text: `Tool: ${tc.tool_name} | FAIL | ${stripEphemeral(truncate(tc.error_summary ?? tc.result_summary ?? "unknown error", 200))}`,
      });
    } else {
      segments.push({
        timestamp: formatTimestamp(tc.timestamp),
        category: "success_meta",
        score: 1,
        text: `[TOOL OK] ${tc.tool_name}`,
      });
    }
  }

  // 5. Score MCP calls
  for (const mc of gp.mcp_calls) {
    if (mc.status === "failure" || mc.error_summary) {
      segments.push({
        timestamp: formatTimestamp(mc.timestamp),
        category: "failure_event",
        score: 8,
        text: `MCP: ${mc.server}/${mc.tool} | FAIL | ${stripEphemeral(truncate(mc.error_summary ?? "unknown", 200))}`,
      });
    } else {
      segments.push({
        timestamp: formatTimestamp(mc.timestamp),
        category: "success_meta",
        score: 1,
        text: `[MCP OK] ${mc.server}/${mc.tool}`,
      });
    }
  }

  // 6. Detect breakthrough events (successful resolution markers)
  for (const msg of gp.user_messages) {
    const text = msg.text.toLowerCase();
    if (BREAKTHROUGH_KEYWORDS.some((kw) => text.includes(kw))) {
      segments.push({
        timestamp: formatTimestamp(msg.timestamp),
        category: "breakthrough",
        score: 10,
        text: `[BREAKTHROUGH] ${compressUserMessage(msg.text, 150)}`,
      });
    }
  }

  // 7. Deduplicate by text similarity (keep highest-scored)
  const deduped = deduplicateSegments(segments);

  // 8. Budget-aware selection: sort by score desc, greedily pick until budget exhausted
  const charBudget = Math.floor(tokenBudget * CHARS_PER_TOKEN);
  const selected = selectWithinBudget(deduped, charBudget);

  // 9. Restore chronological order
  selected.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // 10. Assemble the mission brief text
  const missionBrief = assembleMissionBrief(selected, capture);

  const stats = {
    user_directives: selected.filter((s) => s.category === "user_directive").length,
    failure_events: selected.filter((s) => s.category === "failure_event").length,
    breakthrough_events: selected.filter((s) => s.category === "breakthrough").length,
    success_metadata: selected.filter((s) => s.category === "success_meta").length,
  };

  return {
    mission_brief: missionBrief,
    estimated_tokens: Math.ceil(missionBrief.length / CHARS_PER_TOKEN),
    raw_event_count: capture.totals.raw_event_count,
    retained_event_count: selected.length,
    compression_ratio: capture.totals.raw_event_count > 0
      ? selected.length / capture.totals.raw_event_count
      : 0,
    signal_stats: stats,
  };
}

// ─── Scoring ───────────────────────────────────────────────────────────

function scoreUserDirective(text: string): number {
  const lower = text.toLowerCase();
  let score = 3; // base score for any non-throwaway user message

  // Rule signals boost
  for (const kw of RULE_SIGNAL_KEYWORDS) {
    if (lower.includes(kw)) {
      score += 3;
      break;
    }
  }

  // Decision signals boost
  for (const kw of DECISION_SIGNAL_KEYWORDS) {
    if (lower.includes(kw)) {
      score += 2;
      break;
    }
  }

  // Emotional intensity (exclamation, repetition)
  if ((text.match(/!/g) || []).length > 0) score += 1;
  if ((text.match(/？/g) || []).length > 0) score += 1;

  // Longer messages with substance are more likely to contain context
  if (text.length > 100) score += 1;
  if (text.length > 300) score += 1;

  // Cap at 10
  return Math.min(score, 10);
}

function classifyDirectiveTag(text: string): string {
  const lower = text.toLowerCase();
  for (const kw of RULE_SIGNAL_KEYWORDS) {
    if (lower.includes(kw)) return "[RULE]";
  }
  for (const kw of DECISION_SIGNAL_KEYWORDS) {
    if (lower.includes(kw)) return "[DECISION]";
  }
  return "[CONTEXT]";
}

// ─── Compression ───────────────────────────────────────────────────────

function compressUserMessage(text: string, maxLen: number): string {
  // Remove goal_context wrappers and extract the objective
  let cleaned = text
    .replace(/<goal_context>[\s\S]*?<objective>/gi, "")
    .replace(/<\/objective>[\s\S]*/gi, "")
    .replace(/<turn_aborted>[\s\S]*?<\/turn_aborted>/gi, "[interrupted]")
    .replace(/<untrusted_objective>[\s\S]*?<\/untrusted_objective>/gi, "")
    .trim();

  // Strip ephemeral values
  cleaned = stripEphemeral(cleaned);

  // Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return truncate(cleaned, maxLen);
}

function stripEphemeral(text: string): string {
  let result = text;
  for (const { regex, placeholder } of EPHEMERAL_PATTERNS) {
    result = result.replace(regex, placeholder);
  }
  return result;
}

// ─── Selection ─────────────────────────────────────────────────────────

function selectWithinBudget(segments: ScoredSegment[], charBudget: number): ScoredSegment[] {
  // Sort by score descending
  const sorted = [...segments].sort((a, b) => b.score - a.score);
  const selected: ScoredSegment[] = [];
  let totalChars = 0;

  for (const seg of sorted) {
    const segLen = seg.text.length + seg.timestamp.length + 20; // overhead for formatting
    if (totalChars + segLen > charBudget) {
      // Try to include at least some low-score items if we haven't used much budget
      if (totalChars < charBudget * 0.5) continue; // skip this one, try smaller ones
      break;
    }
    selected.push(seg);
    totalChars += segLen;
  }

  return selected;
}

// ─── Deduplication ─────────────────────────────────────────────────────

function deduplicateSegments(segments: ScoredSegment[]): ScoredSegment[] {
  const seen = new Map<string, ScoredSegment>();
  for (const seg of segments) {
    const key = seg.text.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 120);
    const existing = seen.get(key);
    if (!existing || existing.score < seg.score) {
      seen.set(key, seg);
    }
  }
  return [...seen.values()];
}

// ─── Assembly ──────────────────────────────────────────────────────────

function assembleMissionBrief(segments: ScoredSegment[], capture: CodexCapturePreviewResponse): string {
  const lines: string[] = [];
  const threadName = capture.thread_name ?? "Untitled Session";
  const totals = capture.totals;

  lines.push("[AGI-MEMORY GOVERNANCE DIRECTIVE]");
  lines.push("");
  lines.push(`## Session: "${threadName}"`);
  lines.push(`## Raw events: ${totals.raw_event_count} | User messages: ${totals.user_message_count} | Commands: ${totals.command_event_count} | Tool calls: ${totals.tool_call_count} | MCP calls: ${totals.mcp_call_count}`);
  lines.push("");

  // Group by category
  const directives = segments.filter((s) => s.category === "user_directive");
  const failures = segments.filter((s) => s.category === "failure_event");
  const breakthroughs = segments.filter((s) => s.category === "breakthrough");
  const successMeta = segments.filter((s) => s.category === "success_meta");

  if (directives.length > 0) {
    lines.push("### User Directives & Preferences (chronological, high extraction value)");
    for (const d of directives) {
      lines.push(`- [${d.timestamp}] ${d.text}`);
    }
    lines.push("");
  }

  if (failures.length > 0) {
    lines.push("### Failure Events (extraction value: root cause → fix action)");
    for (const f of failures) {
      lines.push(`- [${f.timestamp}] ${f.text}`);
    }
    lines.push("");
  }

  if (breakthroughs.length > 0) {
    lines.push("### Breakthrough / Resolution Points");
    for (const b of breakthroughs) {
      lines.push(`- [${b.timestamp}] ${b.text}`);
    }
    lines.push("");
  }

  if (successMeta.length > 0) {
    lines.push("### Successful Operations (metadata only, low extraction value)");
    // Collapse into compact blocks of 5
    for (let i = 0; i < successMeta.length; i += 5) {
      const batch = successMeta.slice(i, i + 5);
      const names = batch.map((s) => s.text.replace(/\[.*?\]\s*/, "")).join(" | ");
      lines.push(`- ${names}`);
    }
    lines.push("");
  }

  // Workspace paths (if any)
  if (capture.governance_preview.workspace_paths.length > 0) {
    lines.push("### Workspace Paths");
    for (const wp of capture.governance_preview.workspace_paths) {
      lines.push(`- ${stripEphemeral(wp)}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Utilities ─────────────────────────────────────────────────────────

function isThrowaway(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (THROWAWAY_USER_MESSAGES.has(normalized)) return true;
  if (normalized.length < MIN_DIRECTIVE_LENGTH) return true;
  // Pure continuation signals
  if (/^(继续|继续吧|好|行|嗯|哦|ok|fine|go|yes|yeah)[。.!！?？]*$/i.test(normalized)) return true;
  return false;
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    const h = String(d.getUTCHours()).padStart(2, "0");
    const m = String(d.getUTCMinutes()).padStart(2, "0");
    const s = String(d.getUTCSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  } catch {
    return "00:00:00";
  }
}

function truncate(text: string, maxLen: number): string {
  if (!text) return "";
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 3)}...`;
}
