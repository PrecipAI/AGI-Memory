/**
 * TRAE 召回适配器 — 在 retrieveBundle 主流程前做 TRAE 专用适配
 *
 * 设计动机：
 *   retrieveBundle 的 task_type 路由和查询词提取对 TRAE 不友好：
 *   1. TRAE 摘要模式下宿主通常不传 task_type，回退到 "answer"，召回层不全
 *   2. 查询词提取对中文不友好（extractMemorySearchTerms 有 CJK bigram 但
 *      knowledgeRetrieve.extractQueryTerms 只匹配 ASCII）
 *   3. TRAE session_memory 摘要里的 intent/actions/outcome/learned 是结构化
 *      上下文，可以直接用来增强查询，但之前没利用
 *
 * 适配策略（不破坏 retrieveBundle 主流程）：
 *   - 在 buildRetrieveBundle 入口处检查 host 是否 TRAE
 *   - 是 TRAE 则调用 adaptRetrieveRequestForTrae 改写请求
 *   - 改写后的请求走原 retrieveBundle 逻辑
 *   - 非 TRAE 则原样透传
 */

import type { MemoryRetrieveRequest } from "@super-agent/contracts";
import {
  detectTraeHostVariant,
  getTraeHostProfile,
  inferTaskTypeFromSession,
  isTraeHost,
  type TraeHostProfile
} from "./traeHostProfile.js";

// TRAE 召回适配结果
export interface TraeRetrieveAdaptation {
  // 是否应用了 TRAE 适配
  adapted: boolean;
  // 改写后的 body（传给 buildRetrieveBundle）
  adaptedBody: MemoryRetrieveRequest;
  // 适配说明（用于日志/调试）
  notes: string[];
  // 检测到的 TRAE profile
  profile: TraeHostProfile | null;
}

// TRAE session 摘要上下文（可选传入，用于增强查询）
export interface TraeSessionContext {
  // 当前会话的 intent 摘要（最新 N 条）
  intents?: string[];
  // 当前会话的 actions 摘要
  actions?: string[];
  // 从 traeExtractionEnhancer 提取的 query_enhancements
  query_enhancements?: string[];
}

// 中文查询词提取（CJK bigram + 长串拆分）
function extractCjkTerms(text: string, maxCount: number): string[] {
  const terms = new Set<string>();
  // CJK bigram + 长串
  const cjkMatches = text.match(/[\u3400-\u9FFF]{2,}/g) ?? [];
  for (const cjk of cjkMatches) {
    if (cjk.length <= 4) {
      terms.add(cjk);
    } else {
      for (let i = 0; i < cjk.length - 1; i++) {
        terms.add(cjk.slice(i, i + 2));
      }
    }
    if (terms.size >= maxCount) break;
  }
  return [...terms].slice(0, maxCount);
}

// 英文查询词提取（3+ 字符，过滤停用词）
const STOPWORDS_EN = new Set([
  "the", "and", "how", "should", "would", "could", "what", "why",
  "when", "where", "this", "that", "with", "without", "about",
  "into", "from", "they", "them", "their", "have", "been"
]);

function extractAsciiTerms(text: string, maxCount: number): string[] {
  const terms = new Set<string>();
  const matches = text.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
  for (const match of matches) {
    if (match.length >= 3 && !STOPWORDS_EN.has(match)) {
      terms.add(match);
    }
    if (terms.size >= maxCount) break;
  }
  return [...terms].slice(0, maxCount);
}

/**
 * 适配 TRAE 召回请求
 *
 * 调用时机：buildRetrieveBundle 入口处
 * 调用条件：host 是 TRAE 系列
 * 作用：
 *   1. 检测 TRAE 变体（IDE/Work/generic）
 *   2. 推断 task_type（如未显式传）
 *   3. 用 session 摘要字段增强查询词
 *   4. 设置 preferred_layers（如未显式传 required_layers）
 */
export function adaptRetrieveRequestForTrae(input: {
  body: MemoryRetrieveRequest;
  sessionContext?: TraeSessionContext | null;
}): TraeRetrieveAdaptation {
  const body = input.body as Record<string, unknown>;
  const host = typeof body.host === "string" ? body.host : null;

  // 非 TRAE 宿主，原样透传
  if (!isTraeHost(host)) {
    return {
      adapted: false,
      adaptedBody: input.body,
      notes: [],
      profile: null
    };
  }

  const notes: string[] = [];
  const adaptedBody: Record<string, unknown> = { ...body };

  // 1. 检测 TRAE 变体
  // 从 sessionContext 构造 records 给 detectTraeHostVariant 用（召回时没有完整 session_memory 记录，
  // 但 sessionContext 里有从摘要提取的 intents/actions，可以用来做变体检测）
  const sessionRecordsForDetection: Array<Record<string, unknown>> | null = input.sessionContext
    ? (input.sessionContext.intents ?? []).map((intent, i) => ({
        intent,
        actions: input.sessionContext?.actions?.[i] ?? ""
      }))
    : null;

  const variant = detectTraeHostVariant({
    host,
    sessionRecords: sessionRecordsForDetection
  });
  const profile = getTraeHostProfile(variant);
  notes.push(`检测到 TRAE 变体: ${variant}`);

  // 2. 推断 task_type（如未显式传）
  const existingTaskType = typeof body.task_type === "string" ? body.task_type : null;
  if (!existingTaskType) {
    const sessionCtx = input.sessionContext;
    const latestIntent = sessionCtx?.intents?.[sessionCtx.intents.length - 1] ?? null;
    const latestActions = sessionCtx?.actions?.[sessionCtx.actions.length - 1] ?? null;
    const inferredTaskType = inferTaskTypeFromSession({
      profile,
      intent: latestIntent,
      actions: latestActions
    });
    adaptedBody.task_type = inferredTaskType;
    notes.push(`推断 task_type: ${inferredTaskType}（基于 session 摘要）`);
  }

  // 3. 推断 task_phase（如未显式传）
  const existingTaskPhase = typeof body.task_phase === "string" ? body.task_phase : null;
  if (!existingTaskPhase) {
    adaptedBody.task_phase = profile.default_task_phase;
    notes.push(`设置 task_phase: ${profile.default_task_phase}（profile 默认值）`);
  }

  // 4. 用 session 摘要字段增强查询词
  const originalQuery = typeof body.query === "string" ? body.query : "";
  const sessionCtx = input.sessionContext;

  if (sessionCtx && profile.use_intent_as_query_boost) {
    // 把 intent 摘要里的关键词追加到查询词后面
    // 不能直接拼整个 intent（太长会稀释查询精度），只提取关键词
    const intentText = sessionCtx.intents?.join(" ") ?? "";
    const enhancementKeywords = sessionCtx.query_enhancements ?? [];

    if (intentText || enhancementKeywords.length > 0) {
      // 从 intent 提取中英文关键词
      const cjkTerms = extractCjkTerms(intentText, 5);
      const asciiTerms = extractAsciiTerms(intentText, 5);
      const allEnhancements = [...new Set([...cjkTerms, ...asciiTerms, ...enhancementKeywords])].slice(0, 10);

      if (allEnhancements.length > 0 && originalQuery) {
        // 追加增强词到查询后面（用空格分隔，让 DB 的 ILIKE 能匹配到）
        // 不直接改 query，而是存到 trae_query_boost 字段，让 retrieveBundle 内部使用
        adaptedBody.trae_query_boost = allEnhancements;
        notes.push(`查询增强: 追加 ${allEnhancements.length} 个关键词（${allEnhancements.slice(0, 5).join(", ")}...）`);
      }
    }
  }

  // 5. 设置 preferred_layers（如未显式传 required_layers）
  const existingRequiredLayers = Array.isArray(body.required_layers) ? body.required_layers : null;
  if (!existingRequiredLayers || existingRequiredLayers.length === 0) {
    adaptedBody.required_layers = profile.preferred_layers;
    notes.push(`设置 preferred_layers: ${profile.preferred_layers.join(", ")}`);
  }

  return {
    adapted: true,
    adaptedBody: adaptedBody as unknown as MemoryRetrieveRequest,
    notes,
    profile
  };
}

/**
 * 从 TRAE session_memory 文件提取 TraeSessionContext
 *
 * 给 MCP 工具用：TRAE 调用 retrieve_context 时，自动读取当前会话的
 * session_memory 文件，提取 intent/actions 作为查询上下文。
 */
export function buildTraeSessionContextFromRecords(records: Array<Record<string, unknown>>): TraeSessionContext {
  const intents: string[] = [];
  const actions: string[] = [];
  const queryEnhancements: string[] = [];

  for (const record of records) {
    const intent = typeof record.intent === "string" ? record.intent.trim() : "";
    const action = typeof record.actions === "string" ? record.actions.trim() : "";

    if (intent) intents.push(intent);
    if (action) actions.push(action);

    // 从 intent 提取关键词作为 query_enhancement
    if (intent) {
      const cjk = extractCjkTerms(intent, 3);
      const ascii = extractAsciiTerms(intent, 3);
      queryEnhancements.push(...cjk, ...ascii);
    }
  }

  return {
    intents: intents.slice(-5),  // 最近 5 条 intent
    actions: actions.slice(-5),
    query_enhancements: [...new Set(queryEnhancements)].slice(0, 15)
  };
}
