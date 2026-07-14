/**
 * TRAE 抽取增强器 — 结构化利用 session_memory 摘要字段
 *
 * 设计动机：
 *   traeCaptureAdapter 把 session_memory 摘要(intent/actions/outcome/learned)
 *   全部拼成 commentary 文本，丢失了结构化信息。
 *   - learned 字段可以直接作为 knowledge_candidate 候选
 *   - actions 字段可以作为 execution_trace（IDE 场景）
 *   - intent 字段可以作为 query_enhancement（召回时增强查询词）
 *
 *   本模块在 traeCaptureAdapter 调用 previewHostCapture 之前/之后做增强：
 *   1. 解析 session_memory 记录的结构化字段
 *   2. 按 profile 决定哪些字段直接作为候选
 *   3. 生成 query_enhancement 供召回端使用
 *   4. 生成 execution_trace 供治理抽取参考
 */

import type { TraeHostProfile } from "./traeHostProfile.js";

// TRAE session_memory 单行记录（与 traeCaptureAdapter 一致）
type TraeSessionMemoryRecord = {
  intent?: unknown;
  actions?: unknown;
  outcome?: unknown;
  learned?: unknown;
  message_summary_time?: unknown;
  message_id?: unknown;
};

// 增强后的结构化上下文
export interface TraeExtractionEnhancement {
  // 宿主变体（用于下游路由）
  variant: string;
  // 从 learned 字段提取的知识候选（直接给治理抽取器，不用 LLM 再抽）
  learned_knowledge_candidates: Array<{
    title: string;
    content: string;
    source_kind: "commentary";
    source_timestamp: string;
    source_excerpt: string;
    reason: string;
    confidence: string;
  }>;
  // 从 actions 字段提取的执行轨迹（IDE 场景用）
  execution_traces: Array<{
    timestamp: string;
    action: string;
  }>;
  // 从 intent 字段提取的查询增强词（召回端用）
  query_enhancements: string[];
  // 增强后的 quality 评级（比纯 commentary 的 medium 更高）
  enhanced_quality: "medium" | "high";
  // 增强说明（写进 warnings 让下游知道做了哪些增强）
  enhancement_notes: string[];
}

function extractString(value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      if (typeof item === "string" && item.trim()) {
        parts.push(item.trim());
      } else if (item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string") {
        parts.push(String((item as Record<string, unknown>).text).trim());
      }
    }
    if (parts.length > 0) return parts.join("\n");
  }
  return "";
}

function extractTimestamp(record: TraeSessionMemoryRecord): string {
  if (typeof record.message_summary_time === "string" && record.message_summary_time.trim()) {
    return record.message_summary_time;
  }
  return new Date().toISOString();
}

// 从文本中提取关键词（中英文混合）
function extractKeywords(text: string, maxCount: number): string[] {
  if (!text) return [];
  const keywords = new Set<string>();

  // 英文关键词（2+ 字符）
  const asciiMatches = text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
  for (const match of asciiMatches) {
    if (match.length >= 3) keywords.add(match);
    if (keywords.size >= maxCount) break;
  }

  // 中文关键词（CJK bigram + 长串）
  const cjkMatches = text.match(/[\u3400-\u9FFF]{2,}/g) ?? [];
  for (const cjk of cjkMatches) {
    if (cjk.length <= 4) {
      keywords.add(cjk);
    } else {
      // 长串拆 bigram
      for (let i = 0; i < cjk.length - 1; i++) {
        keywords.add(cjk.slice(i, i + 2));
      }
    }
    if (keywords.size >= maxCount) break;
  }

  return [...keywords].slice(0, maxCount);
}

/**
 * 增强 TRAE session_memory 抽取
 *
 * 输入：原始 session_memory 记录 + 宿主 profile
 * 输出：结构化增强上下文（learned_knowledge_candidates / execution_traces / query_enhancements）
 */
export function enhanceTraeExtraction(input: {
  records: TraeSessionMemoryRecord[];
  profile: TraeHostProfile;
}): TraeExtractionEnhancement {
  const { records, profile } = input;
  const notes: string[] = [];
  let enhancedQuality: "medium" | "high" = "medium";

  // 1. 从 learned 字段提取知识候选
  const learnedCandidates: TraeExtractionEnhancement["learned_knowledge_candidates"] = [];
  if (profile.extract_learned_as_knowledge) {
    for (const record of records) {
      const learned = extractString(record.learned);
      if (!learned || learned.length < 5) continue;

      // learned 字段是系统自动生成的"学到的知识"摘要
      // 直接作为 knowledge_candidate，不需要 LLM 再抽
      learnedCandidates.push({
        title: learned.length > 60 ? learned.slice(0, 57) + "…" : learned,
        content: learned,
        source_kind: "commentary",
        source_timestamp: extractTimestamp(record),
        source_excerpt: `[摘要·学到知识] ${learned}`,
        reason: `TRAE session_memory learned 字段直接提取（${profile.variant} profile）`,
        confidence: "medium"
      });
    }
    if (learnedCandidates.length > 0) {
      notes.push(`从 learned 字段提取 ${learnedCandidates.length} 个知识候选`);
      enhancedQuality = "high";
    }
  }

  // 2. 从 actions 字段提取执行轨迹（IDE 场景）
  const executionTraces: TraeExtractionEnhancement["execution_traces"] = [];
  if (profile.extract_actions_as_trace) {
    for (const record of records) {
      const actions = extractString(record.actions);
      if (!actions) continue;
      executionTraces.push({
        timestamp: extractTimestamp(record),
        action: actions
      });
    }
    if (executionTraces.length > 0) {
      notes.push(`从 actions 字段提取 ${executionTraces.length} 条执行轨迹`);
    }
  }

  // 3. 从 intent 字段提取查询增强词
  const queryEnhancements: string[] = [];
  if (profile.use_intent_as_query_boost) {
    const allIntents: string[] = [];
    for (const record of records) {
      const intent = extractString(record.intent);
      if (intent) allIntents.push(intent);
    }
    if (allIntents.length > 0) {
      // 从所有 intent 里提取关键词，去重
      const combined = allIntents.join(" ");
      const keywords = extractKeywords(combined, 15);
      queryEnhancements.push(...keywords);
      if (queryEnhancements.length > 0) {
        notes.push(`从 intent 字段提取 ${queryEnhancements.length} 个查询增强词`);
      }
    }
  }

  // 如果有任何增强生效，quality 提升到 high
  if (learnedCandidates.length > 0 || executionTraces.length > 0 || queryEnhancements.length > 0) {
    enhancedQuality = "high";
  }

  return {
    variant: profile.variant,
    learned_knowledge_candidates: learnedCandidates,
    execution_traces: executionTraces,
    query_enhancements: queryEnhancements,
    enhanced_quality: enhancedQuality,
    enhancement_notes: notes
  };
}
