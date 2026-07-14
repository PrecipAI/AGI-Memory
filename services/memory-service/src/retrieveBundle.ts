import type { MemoryRetrieveRequest, MemoryRetrieveResponse } from "@super-agent/contracts";
import {
  createMemoryAccessLog,
  extractLooseSearchTerms,
  getKnowledgeUtility,
  logRetrieveQuality,
  queryActiveDerivedKnowledge,
  queryActiveRules,
  queryActiveTaskBindings,
  queryConversationSummary,
  queryDerivedKnowledgeEvidence,
  queryFactualMemory,
  queryMemoryLayerVersions,
  queryProceduralMemory,
  queryRuleCheckpoints,
  queryResidentSnapshot,
  updateSynthesizedKnowledgeRecallTimestamp
} from "@super-agent/db";
import { createFrozenHttpError } from "./errors.js";
import { buildMetacognitionMissionBrief } from "./knowledgeModelWorker.js";
import type { RetrievalGate } from "./retrievalGate.js";
import { applyRetrievalHook } from "./retrievalHook.js";
import { semanticRerank } from "./semanticReranker.js";
import { adaptRetrieveRequestForTrae, buildTraeSessionContextFromRecords } from "./traeRetrieveAdapter.js";

type LayerAccessLoggerInput = {
  tenantId: string;
  scope: string;
  queryKind: string;
  queryPayload: Record<string, unknown>;
  decisionPayload: Record<string, unknown>;
  items: Record<string, unknown>[];
  traceId: string;
  objectType: string;
};

const TASK_LAYER_DEFAULTS: Record<string, string[]> = {
  design: ["conversation_summary", "rules", "resident_snapshot", "factual_memory", "synthesized_knowledge", "procedural_memory"],
  execution: ["conversation_summary", "rules", "resident_snapshot", "factual_memory", "procedural_memory"],
  debugging: ["conversation_summary", "rules", "resident_snapshot", "factual_memory", "procedural_memory", "synthesized_knowledge"],
  governance: [
    "conversation_summary",
    "rules",
    "resident_snapshot",
    "factual_memory",
    "synthesized_knowledge",
    "evidence_index",
    "procedural_memory"
  ],
  review: ["conversation_summary", "rules", "resident_snapshot", "factual_memory", "synthesized_knowledge", "evidence_index"],
  ingestion: ["conversation_summary", "rules", "resident_snapshot", "factual_memory", "synthesized_knowledge"],
  integration: ["conversation_summary", "rules", "resident_snapshot", "factual_memory", "procedural_memory", "synthesized_knowledge"],
  answer: [
    "conversation_summary",
    "rules",
    "resident_snapshot",
    "factual_memory",
    "procedural_memory",
    "synthesized_knowledge",
    "evidence_index"
  ]
};

const TASK_PHASE_DEFAULTS: Record<string, string> = {
  design: "design",
  execution: "coding",
  debugging: "coding",
  governance: "governance",
  review: "review",
  ingestion: "integration",
  integration: "integration",
  answer: "planning"
};

type RetrievalLayer =
  | "conversation_summary"
  | "resident_snapshot"
  | "rules"
  | "factual_memory"
  | "procedural_memory"
  | "synthesized_knowledge"
  | "evidence_index";

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function resolveTaskType(value: unknown): string {
  const taskType = typeof value === "string" && value.length > 0 ? value : "answer";
  return TASK_LAYER_DEFAULTS[taskType] ? taskType : "answer";
}

function resolveTaskPhase(value: unknown, taskType: string): string {
  const taskPhase = typeof value === "string" && value.length > 0 ? value : TASK_PHASE_DEFAULTS[taskType] ?? "planning";
  const allowed = new Set(["planning", "design", "coding", "testing", "review", "governance", "reporting", "integration"]);
  return allowed.has(taskPhase) ? taskPhase : TASK_PHASE_DEFAULTS[taskType] ?? "planning";
}

function resolveRequestedLayers(body: MemoryRetrieveRequest): Set<RetrievalLayer> {
  const taskType = resolveTaskType((body as Record<string, unknown>).task_type);
  const requested = new Set<RetrievalLayer>(TASK_LAYER_DEFAULTS[taskType] as RetrievalLayer[]);
  for (const layer of asStringArray((body as Record<string, unknown>).required_layers)) {
    requested.add(layer as RetrievalLayer);
  }
  for (const layer of asStringArray((body as Record<string, unknown>).forbidden_layers)) {
    requested.delete(layer as RetrievalLayer);
  }
  return requested;
}

function buildQueryHash(input: {
  query: string;
  taskType: string;
  fingerprintStatus: string;
  layers: string[];
  host?: unknown;
  projectRef?: unknown;
  operationIntent?: unknown;
  taskPhase?: unknown;
}): string {
  return Buffer.from(JSON.stringify(input)).toString("base64url").slice(0, 64);
}

function layerVersionsMatch(left: unknown, right: unknown): boolean {
  if (!left || !right || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function shouldReuseExistingBundle(input: {
  existingBundleId?: unknown;
  existingQueryHash?: unknown;
  queryHash: string;
  existingLayerVersions?: unknown;
  currentLayerVersions: Record<string, unknown>;
}): boolean {
  return (
    typeof input.existingBundleId === "string" &&
    input.existingBundleId.length > 0 &&
    typeof input.existingQueryHash === "string" &&
    input.existingQueryHash === input.queryHash &&
    layerVersionsMatch(input.existingLayerVersions, input.currentLayerVersions)
  );
}

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value ?? "").length / 4);
}

// ─── P1-3: utility_score 驱动 retrieve ranking ───
// 高效用知识浮上来，低效用沉底，NULL（无信号）排最后不影响冷启动
// rules 不参与——规则有 task_binding 显式优先语义，utility 不该覆盖绑定意图
function applyUtilityRanking<T extends Record<string, unknown>>(
  items: T[],
  utilityMap: Map<string, { utilityScore: number | null; totalRecalls: number }>
): T[] {
  if (items.length === 0) return items;
  return [...items].sort((a, b) => {
    const idA = String(a.id ?? "");
    const idB = String(b.id ?? "");
    const scoreA = utilityMap.get(idA)?.utilityScore ?? null;
    const scoreB = utilityMap.get(idB)?.utilityScore ?? null;
    // NULL 排后面——无信号知识不影响冷启动，但已知高效用的优先浮上来
    if (scoreA === null && scoreB === null) return 0;
    if (scoreA === null) return 1;
    if (scoreB === null) return -1;
    return scoreB - scoreA;
  });
}

// ─── fix-8-3: importance_weight 驱动 retrieve ranking（取代 utility_score）───
// importance_weight = 0.3×recency + 0.3×frequency + 0.4×utility（三因子加权）
// 优先用 importance_weight，没有则回退到 utility_score
// NULL 都没有时排最后，不影响冷启动
function applyImportanceRanking<T extends Record<string, unknown>>(
  items: T[],
  utilityMap: Map<string, { utilityScore: number | null; totalRecalls: number }>
): T[] {
  if (items.length === 0) return items;
  return [...items].sort((a, b) => {
    const idA = String(a.id ?? "");
    const idB = String(b.id ?? "");
    // 优先用 importance_weight（从 item 字段取，recomputeImportanceWeights 写入）
    const impA = typeof a.importance_weight === "number" ? a.importance_weight : null;
    const impB = typeof b.importance_weight === "number" ? b.importance_weight : null;
    if (impA !== null && impB !== null) return impB - impA;
    if (impA !== null) return -1;
    if (impB !== null) return 1;
    // 都没 importance_weight 时回退到 utility_score（旧知识库兼容）
    const scoreA = utilityMap.get(idA)?.utilityScore ?? null;
    const scoreB = utilityMap.get(idB)?.utilityScore ?? null;
    if (scoreA === null && scoreB === null) return 0;
    if (scoreA === null) return 1;
    if (scoreB === null) return -1;
    return scoreB - scoreA;
  });
}

function applyContextBudget<T extends Record<string, unknown>>(items: T[], tokenBudget: number, mode: string): T[] {
  if (mode === "none" || tokenBudget <= 0) {
    return items;
  }
  const output: T[] = [];
  let used = 0;
  for (const item of items) {
    const slim =
      mode === "aggressive" || mode === "evidence_only"
        ? ({
            id: item.id,
            title: item.title ?? item.rule_key ?? item.skill_key ?? item.source_uri,
            source_ref: item.source_ref ?? item.source_uri,
            enforcement_level: item.enforcement_level,
            priority: item.priority,
            risk_level: item.risk_level
          } as unknown as T)
        : item;
    const next = estimateTokens(slim);
    if (used + next > tokenBudget) {
      break;
    }
    output.push(slim);
    used += next;
  }
  return output;
}

function buildContextPackage(input: {
  body: MemoryRetrieveRequest;
  taskType: string;
  taskPhase: string;
  requestedLayers: Set<RetrievalLayer>;
  compressionMode: string;
  contextBudgetTokens: number;
  rules: Record<string, unknown>[];
  ruleCheckpoints: Record<string, unknown>[];
  residentSnapshot: Record<string, unknown>[];
  factualMemory: Record<string, unknown>[];
  proceduralMemory: Record<string, unknown>[];
  synthesizedKnowledge: Record<string, unknown>[];
  evidenceIndex: Record<string, unknown>[];
}) {
  const ruleBudget = Math.max(200, Math.floor(input.contextBudgetTokens * 0.2));
  const memoryBudget = Math.max(200, Math.floor(input.contextBudgetTokens * 0.2));
  const skillBudget = Math.max(200, Math.floor(input.contextBudgetTokens * 0.15));
  const knowledgeBudget = Math.max(200, Math.floor(input.contextBudgetTokens * 0.2));
  const evidenceBudget = Math.max(100, Math.floor(input.contextBudgetTokens * 0.1));

  return {
    attention_layout: (input.body as Record<string, unknown>).attention_layout ?? "front_rules_tail_reminder",
    sections: [
      {
        name: "Execution Rules",
        layer: "rules",
        priority: 1,
        placement: "front",
        items: applyContextBudget(
          input.rules.map((rule) => ({
            ...rule,
            checkpoints: input.ruleCheckpoints.filter((checkpoint) => checkpoint.rule_id === rule.id)
          })),
          ruleBudget,
          input.compressionMode
        )
      },
      {
        name: "Task Goal",
        layer: "runtime",
        priority: 2,
        placement: "front",
        items: [{ query: input.body.query, task_type: input.taskType, task_phase: input.taskPhase, runtime_summary: input.body.runtime_summary ?? null }]
      },
      {
        name: "Relevant Memory",
        layer: "memory",
        priority: 3,
        placement: "middle",
        items: applyContextBudget([...input.residentSnapshot, ...input.factualMemory], memoryBudget, input.compressionMode)
      },
      {
        name: "Relevant Skills",
        layer: "skill",
        priority: 4,
        placement: "middle",
        items: applyContextBudget(input.proceduralMemory, skillBudget, input.compressionMode)
      },
      {
        name: "Synthesized Knowledge",
        layer: "knowledge",
        priority: 5,
        placement: "middle",
        items: applyContextBudget(input.synthesizedKnowledge, knowledgeBudget, input.compressionMode)
      },
      {
        name: "Evidence Index",
        layer: "evidence",
        priority: 6,
        placement: "middle",
        items: applyContextBudget(input.evidenceIndex, evidenceBudget, input.compressionMode)
      },
      {
        name: "Current Step Reminder",
        layer: "runtime",
        priority: 7,
        placement: "tail",
        items: [
          {
            reminder: "Follow Execution Rules first. Use memory as reference context. Ask the user when a rule failure cannot be bypassed."
          }
        ]
      }
    ],
    compression: {
      mode: input.compressionMode,
      estimated_tokens: estimateTokens({
        rules: input.rules,
        memory: input.factualMemory,
        skills: input.proceduralMemory,
        knowledge: input.synthesizedKnowledge,
        evidence: input.evidenceIndex
      }),
      budget_tokens: input.contextBudgetTokens
    }
  };
}

export async function logLayerAccess(input: LayerAccessLoggerInput) {
  for (const item of input.items) {
    const itemId = item.id ? String(item.id) : null;
    await createMemoryAccessLog({
      tenantId: input.tenantId,
      scope: input.scope,
      memoryId: input.objectType === "memory" && itemId ? itemId : null,
      queryKind: input.queryKind,
      queryPayload: input.queryPayload,
      decisionPayload: {
        ...input.decisionPayload,
        returned: true
      },
      objectType: input.objectType,
      objectRef: itemId,
      traceId: input.traceId
    });
  }
}

// ─── fix-6 真正的元认知：per-query 知识边界评估 ───
// 回答三个问题：我有多大把握？高置信覆盖哪些方面？我明确不知道什么？
// 这是 per-query 评估，不是对知识库的全局统计
//
// fix-8 新增 retrieve_quality：区分"知识真没有" vs "有但没召回"
// fix-8 新增 method：标识元认知来源（rule / llm / llm_fallback）
type RetrieveQuality = "good" | "partial" | "poor";
type MetacognitionMethod = "rule" | "llm" | "llm_fallback";

type MetacognitionAssessment = {
  overall_confidence: number;
  confidence_basis: {
    layer_coverage: number;
    avg_item_confidence: number;
    high_utility_ratio: number;
    evidence_backed_ratio: number;
  };
  retrieve_quality: RetrieveQuality;
  method: MetacognitionMethod;
  boundary: {
    status: "covered" | "partial" | "unknown";
    covered_aspects: string[];
    uncertain_aspects: string[];
    unknown_aspects: string[];
  };
  coverage_areas: Array<{
    area: string;
    layer_hits: string[];
    confidence: number;
    item_count: number;
  }>;
  knowledge_gaps: Array<{
    term: string;
    checked_layers: string[];
    hit: boolean;
    hint?: string;
  }>;
  recommended_actions: string[];
};

const HIGH_UTILITY_THRESHOLD = 0.7;
const HIGH_CONFIDENCE_THRESHOLD = 0.7;
const PARTIAL_CONFIDENCE_THRESHOLD = 0.4;
const DEFAULT_ITEM_CONFIDENCE = 0.5;

function itemConfidenceScore(item: Record<string, unknown>): number {
  const raw = item.confidence_score ?? item.importance ?? item.success_rate;
  if (typeof raw === "number" && raw >= 0 && raw <= 1) return raw;
  if (typeof raw === "number" && raw > 1) return Math.min(1, raw / 100);
  // rule 没有 confidence 字段，enforcement_level='must' 视为 0.8，'must_not' 0.7，其他 0.5
  const enforcement = String(item.enforcement_level ?? "").toLowerCase();
  if (enforcement === "must") return 0.8;
  if (enforcement === "must_not") return 0.7;
  return DEFAULT_ITEM_CONFIDENCE;
}

function itemTitle(item: Record<string, unknown>): string {
  const raw = item.title ?? item.rule_key ?? item.skill_key ?? item.statement ?? item.content ?? "";
  const text = String(raw).trim();
  if (!text) return "(untitled)";
  return text.length > 60 ? text.slice(0, 60) + "…" : text;
}

function itemSearchableText(item: Record<string, unknown>): string {
  const parts = [
    item.title, item.rule_key, item.skill_key, item.statement,
    item.content, item.normalized_content, item.normalized_statement,
    item.description
  ].map((v) => (typeof v === "string" ? v : "")).join(" ");
  return parts.toLowerCase();
}

function termHitsItem(term: string, itemText: string): boolean {
  if (!term) return false;
  return itemText.includes(term.toLowerCase());
}

function buildMetacognitionAssessment(input: {
  query: string;
  queryTerms: string[];
  rules: Record<string, unknown>[];
  factualMemory: Record<string, unknown>[];
  proceduralMemory: Record<string, unknown>[];
  synthesizedKnowledge: Record<string, unknown>[];
  evidenceIndex: Record<string, unknown>[];
  utilityMap: Map<string, { utilityScore: number | null; totalRecalls: number }>;
}): MetacognitionAssessment {
  const rules = input.rules;
  const factual = input.factualMemory;
  const procedural = input.proceduralMemory;
  const synthesized = input.synthesizedKnowledge;
  const evidence = input.evidenceIndex;

  // ─── 1. confidence_basis 四个维度 ───
  const layerHits: string[] = [];
  if (rules.length > 0) layerHits.push("rules");
  if (factual.length > 0) layerHits.push("factual_memory");
  if (procedural.length > 0) layerHits.push("procedural_memory");
  if (synthesized.length > 0) layerHits.push("synthesized_knowledge");
  const layerCoverage = layerHits.length / 4;

  const allItems = [...rules, ...factual, ...procedural, ...synthesized];
  const avgItemConfidence = allItems.length > 0
    ? allItems.reduce((sum, item) => sum + itemConfidenceScore(item), 0) / allItems.length
    : 0;

  let highUtilityCount = 0;
  let scoredCount = 0;
  for (const item of [...factual, ...procedural, ...synthesized]) {
    const id = String(item.id ?? "");
    if (!id) continue;
    const entry = input.utilityMap.get(id);
    if (entry && entry.utilityScore !== null) {
      scoredCount++;
      if (entry.utilityScore >= HIGH_UTILITY_THRESHOLD) highUtilityCount++;
    }
  }
  const highUtilityRatio = scoredCount > 0 ? highUtilityCount / scoredCount : 0;

  const evidenceKnowledgeIds = new Set(
    evidence
      .map((e) => String(e.synthesized_knowledge_id ?? ""))
      .filter(Boolean)
  );
  const evidenceBackedRatio = synthesized.length > 0
    ? synthesized.filter((k) => evidenceKnowledgeIds.has(String(k.id ?? ""))).length / synthesized.length
    : 0;

  // ─── 2. overall_confidence 加权 ───
  // layer_coverage 是覆盖广度（30%），avg_item_confidence 是质量（30%），
  // high_utility_ratio 是 outcome 信号（20%），evidence_backed_ratio 是证据支撑（20%）
  const overallConfidence = Number((
    layerCoverage * 0.3 +
    avgItemConfidence * 0.3 +
    highUtilityRatio * 0.2 +
    evidenceBackedRatio * 0.2
  ).toFixed(4));

  // ─── 3. coverage_areas：从召回条目提取覆盖方面 ───
  // 按 title 聚合：相同 title 合并，layer_hits 收集所有出现该 title 的层
  const areaMap = new Map<string, { layer_hits: Set<string>; confidences: number[]; item_count: number }>();
  const collectArea = (item: Record<string, unknown>, layer: string) => {
    const area = itemTitle(item);
    const existing = areaMap.get(area);
    if (existing) {
      existing.layer_hits.add(layer);
      existing.confidences.push(itemConfidenceScore(item));
      existing.item_count++;
    } else {
      areaMap.set(area, {
        layer_hits: new Set([layer]),
        confidences: [itemConfidenceScore(item)],
        item_count: 1
      });
    }
  };
  rules.forEach((r) => collectArea(r, "rules"));
  factual.forEach((m) => collectArea(m, "factual_memory"));
  procedural.forEach((s) => collectArea(s, "procedural_memory"));
  synthesized.forEach((k) => collectArea(k, "synthesized_knowledge"));
  const coverageAreas = [...areaMap.entries()]
    .map(([area, info]) => ({
      area,
      layer_hits: [...info.layer_hits],
      confidence: Number((info.confidences.reduce((a, b) => a + b, 0) / info.confidences.length).toFixed(4)),
      item_count: info.item_count
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10);

  // ─── 4. knowledge_gaps：查询术语中没命中任何召回条目的 ───
  const allItemTexts = allItems.map(itemSearchableText);
  const knowledgeGaps = input.queryTerms.map((term) => {
    const hit = allItemTexts.some((text) => termHitsItem(term, text));
    return {
      term,
      checked_layers: layerHits.length > 0 ? layerHits : [],
      hit,
      hint: hit ? undefined : (input.queryTerms.length >= 5 ? "查询术语未命中，可能是知识库缺口或分词未对齐" : "知识库可能缺失该方面")
    };
  });

  // ─── 5. boundary 三态判定 ───
  const hitTerms = knowledgeGaps.filter((g) => g.hit).map((g) => g.term);
  const missedTerms = knowledgeGaps.filter((g) => !g.hit).map((g) => g.term);
  const highConfidenceAreas = coverageAreas.filter((a) => a.confidence >= HIGH_CONFIDENCE_THRESHOLD).map((a) => a.area);
  const lowConfidenceAreas = coverageAreas.filter((a) => a.confidence < PARTIAL_CONFIDENCE_THRESHOLD).map((a) => a.area);

  let boundaryStatus: "covered" | "partial" | "unknown";
  if (allItems.length === 0) {
    boundaryStatus = "unknown";
  } else if (overallConfidence >= HIGH_CONFIDENCE_THRESHOLD && missedTerms.length <= Math.floor(input.queryTerms.length / 3)) {
    boundaryStatus = "covered";
  } else if (overallConfidence < PARTIAL_CONFIDENCE_THRESHOLD || missedTerms.length >= Math.ceil(input.queryTerms.length * 2 / 3)) {
    boundaryStatus = "unknown";
  } else {
    boundaryStatus = "partial";
  }

  // ─── fix-8: retrieve_quality 评估 ───
  // 区分"知识真没有" vs "有但没召回"
  // term_hit_ratio = 命中查询词数 / 查询词总数
  // 复用 knowledge_gaps.term/hit 信号，零额外成本
  const totalTerms = knowledgeGaps.length;
  const hitCount = knowledgeGaps.filter((g) => g.hit).length;
  const termHitRatio = totalTerms > 0 ? hitCount / totalTerms : 0;
  let retrieveQuality: RetrieveQuality;
  if (termHitRatio >= 0.6) retrieveQuality = "good";
  else if (termHitRatio >= 0.3) retrieveQuality = "partial";
  else retrieveQuality = "poor";

  // ─── 6. recommended_actions ───
  // fix-8: poor 时加 "retrieve_quality_poor_investigate"（先查 retrieve 算法而非归档知识）
  const recommendedActions: string[] = [];
  if (boundaryStatus === "covered") {
    recommendedActions.push("proceed_with_confidence");
  } else if (boundaryStatus === "partial") {
    recommendedActions.push("verify_before_use");
    if (missedTerms.length > 0) recommendedActions.push("supplement_with_search");
  } else {
    recommendedActions.push("supplement_with_search");
    if (allItems.length === 0) recommendedActions.push("escalate_to_human");
  }
  if (retrieveQuality === "poor") {
    recommendedActions.push("retrieve_quality_poor_investigate");
  }

  // ─── fix-8: method 判定 ───
  // rule：confidence >= 0.4 或 retrieve_quality='poor'（poor 时 trigger LLM 会循环依赖）
  // llm：confidence < 0.4 且 retrieve_quality='good' 或 'partial'
  // llm_fallback：LLM 失败时回退（此处只是规则阶段，默认 rule，LLM 阶段会改写）
  let method: MetacognitionMethod = "rule";
  if (overallConfidence < PARTIAL_CONFIDENCE_THRESHOLD && (retrieveQuality === "good" || retrieveQuality === "partial")) {
    method = "llm";  // 标记需要 LLM 升级，实际 LLM 调用在 buildRetrieveBundle 主流程里做
  }

  return {
    overall_confidence: overallConfidence,
    confidence_basis: {
      layer_coverage: Number(layerCoverage.toFixed(4)),
      avg_item_confidence: Number(avgItemConfidence.toFixed(4)),
      high_utility_ratio: Number(highUtilityRatio.toFixed(4)),
      evidence_backed_ratio: Number(evidenceBackedRatio.toFixed(4))
    },
    retrieve_quality: retrieveQuality,
    method,
    boundary: {
      status: boundaryStatus,
      covered_aspects: highConfidenceAreas,
      uncertain_aspects: lowConfidenceAreas,
      unknown_aspects: missedTerms
    },
    coverage_areas: coverageAreas,
    knowledge_gaps: knowledgeGaps,
    recommended_actions: recommendedActions,
    // fix-8: 暴露 term_hit_ratio 给归档保护用（不入 schema，仅内部传递）
    _term_hit_ratio: termHitRatio,
    _hit_terms: hitTerms,
    _missed_terms: missedTerms
  } as MetacognitionAssessment & { _term_hit_ratio: number; _hit_terms: string[]; _missed_terms: string[] };
}

export function assertRetrieveContract(body: MemoryRetrieveRequest): void {
  if (!body.fingerprint_status) {
    throw createFrozenHttpError(
      400,
      "fingerprint_status is required for /internal/memory/retrieve so retrieval gates do not guess caller intent.",
      "FINGERPRINT_STATUS_REQUIRED"
    );
  }

  if (body.include_procedural !== false && !body.fingerprint) {
    throw createFrozenHttpError(
      400,
      "fingerprint is required when include_procedural=true because procedural retrieval must be fingerprint-gated.",
      "FINGERPRINT_REQUIRED"
    );
  }
}

export async function buildRetrieveBundle(input: {
  tenantId: string;
  scope: string;
  traceId: string;
  body: MemoryRetrieveRequest;
  retrievalGate: RetrievalGate;
}): Promise<MemoryRetrieveResponse> {
  assertRetrieveContract(input.body);

  // §TRAE 适配：检测 host 是否 TRAE，是则改写请求（task_type/task_phase/查询增强/preferred_layers）
  // 非 TRAE 宿主原样透传，不改变任何行为
  // 如果调用方（如 MCP memory_retrieve_context_trae 工具）传了 trae_session_records，
  // 从中提取 intent/actions 作为 sessionContext，让适配器能用会话上下文做精准推断
  const traeSessionRecordsField = (input.body as Record<string, unknown>).trae_session_records;
  const traeSessionRecords = Array.isArray(traeSessionRecordsField)
    ? traeSessionRecordsField.filter((item): item is Record<string, unknown> => item != null && typeof item === "object")
    : null;
  const traeSessionContext = traeSessionRecords && traeSessionRecords.length > 0
    ? buildTraeSessionContextFromRecords(traeSessionRecords)
    : null;
  const traeAdaptation = adaptRetrieveRequestForTrae({ body: input.body, sessionContext: traeSessionContext });
  // 保存原始 query（适配前的值），用于返回值里报告适配效果
  const traeOriginalQuery = typeof input.body.query === "string" ? input.body.query : null;
  if (traeAdaptation.adapted) {
    input.body = traeAdaptation.adaptedBody;
    // 把 trae_query_boost 增强词拼到 query 后面，让下游 DB 查询（queryFactualMemory 等）能用到
    // 适配器已保证只有 originalQuery 非空时才设置 boost，所以这里可以安全拼接
    const boostField = (input.body as Record<string, unknown>).trae_query_boost;
    if (Array.isArray(boostField) && boostField.length > 0) {
      const boostText = boostField.filter((t): t is string => typeof t === "string").join(" ");
      const currentQuery = typeof input.body.query === "string" ? input.body.query : "";
      if (boostText && currentQuery) {
        (input.body as { query: string }).query = `${currentQuery} ${boostText}`;
      }
    }
  }
  const traeAdaptationReport = traeAdaptation.adapted ? {
    adapted: true as const,
    variant: traeAdaptation.profile?.variant ?? null,
    notes: traeAdaptation.notes,
    original_query: traeOriginalQuery,
    adapted_query: typeof input.body.query === "string" ? input.body.query : null,
    query_boost: (input.body as Record<string, unknown>).trae_query_boost ?? null
  } : null;

  const bodyRecord = input.body as Record<string, unknown>;
  const taskType = resolveTaskType(bodyRecord.task_type);
  const taskPhase = resolveTaskPhase(bodyRecord.task_phase, taskType);
  const requestedLayers = resolveRequestedLayers(input.body);
  const currentLayerVersions = await queryMemoryLayerVersions({
    tenantId: input.tenantId,
    scope: input.scope
  });
  const queryHash = buildQueryHash({
    query: input.body.query,
    taskType,
    taskPhase,
    fingerprintStatus: input.body.fingerprint_status,
    layers: [...requestedLayers].sort(),
    host: bodyRecord.host ?? null,
    projectRef: bodyRecord.project_ref ?? null,
    operationIntent: bodyRecord.operation_intent ?? null
  });
  const reuseExistingBundle = shouldReuseExistingBundle({
    existingBundleId: bodyRecord.existing_bundle_id,
    existingQueryHash: bodyRecord.existing_query_hash,
    queryHash,
    existingLayerVersions: bodyRecord.layer_versions,
    currentLayerVersions
  });

  const gates = input.retrievalGate.build({
    fingerprint: input.body.fingerprint ?? null,
    fingerprintStatus: input.body.fingerprint_status,
    includeFactual: input.body.include_factual,
    includeProcedural: input.body.include_procedural
  });

  const [conversationSummary, residentSnapshot, taskBindings, rules, factualMemory, proceduralMemory, synthesizedKnowledge] = await Promise.all([
    requestedLayers.has("conversation_summary")
      ? queryConversationSummary({
          tenantId: input.tenantId,
          scope: input.scope,
          taskRequestId: input.body.task_request_id,
          limit: input.body.limit ?? 10
        })
      : Promise.resolve([]),
    requestedLayers.has("resident_snapshot")
      ? queryResidentSnapshot({
          tenantId: input.tenantId,
          scope: input.scope,
          limit: 5
        })
      : Promise.resolve([]),
    requestedLayers.has("rules") || requestedLayers.has("procedural_memory")
      ? queryActiveTaskBindings({
          tenantId: input.tenantId,
          scope: input.scope,
          taskType,
          host: typeof bodyRecord.host === "string" ? bodyRecord.host : null,
          projectRef: typeof bodyRecord.project_ref === "string" ? bodyRecord.project_ref : null,
          limit: input.body.limit ?? 10
        })
      : Promise.resolve([]),
    requestedLayers.has("rules")
      ? queryActiveRules({
          tenantId: input.tenantId,
          scope: input.scope,
          query: input.body.query,
          taskType: typeof bodyRecord.task_type === "string" ? taskType : null,
          taskPhase,
          projectRef: typeof bodyRecord.project_ref === "string" ? bodyRecord.project_ref : null,
          limit: input.body.limit ?? 10
        })
      : Promise.resolve([]),
    requestedLayers.has("factual_memory") && gates.factual.allowed
      ? queryFactualMemory({
          tenantId: input.tenantId,
          scope: input.scope,
          query: input.body.query,
          // 放大 3 倍候选给语义重排，重排后截断到原始 limit
          limit: (input.body.limit ?? 10) * 3
        })
      : Promise.resolve([]),
    requestedLayers.has("procedural_memory") && gates.procedural.allowed
      ? queryProceduralMemory({
          tenantId: input.tenantId,
          scope: input.scope,
          fingerprint: input.body.fingerprint ?? null,
          projectRef: typeof bodyRecord.project_ref === "string" ? bodyRecord.project_ref : null,
          query: input.body.query ?? null,
          limit: (input.body.limit ?? 10) * 3
        })
      : Promise.resolve([]),
    requestedLayers.has("synthesized_knowledge")
      ? queryActiveDerivedKnowledge({
          tenantId: input.tenantId,
          scope: input.scope,
          query: input.body.query,
          limit: (input.body.limit ?? 10) * 3
        })
      : Promise.resolve([])
  ]);
  const boundRuleKeys = new Set(
    taskBindings.flatMap((binding) => (Array.isArray(binding.rule_keys) ? binding.rule_keys.map(String) : []))
  );
  const sortedRules =
    boundRuleKeys.size > 0
      ? [...rules].sort((left, right) => Number(boundRuleKeys.has(String(right.rule_key))) - Number(boundRuleKeys.has(String(left.rule_key))))
      : rules;
  const ruleCheckpoints = await queryRuleCheckpoints({
    tenantId: input.tenantId,
    scope: input.scope,
    ruleIds: sortedRules.map((item) => String(item.id)).filter(Boolean),
    operation: typeof bodyRecord.operation_intent === "string" ? bodyRecord.operation_intent : null
  });
  const ruleChecklist = ruleCheckpoints.map((checkpoint) => ({
    checkpoint_key: checkpoint.checkpoint_key,
    rule_id: checkpoint.rule_id,
    rule_key: sortedRules.find((rule) => rule.id === checkpoint.rule_id)?.rule_key ?? null,
    phase: checkpoint.checkpoint_phase,
    operation: checkpoint.operation,
    requirement: checkpoint.requirement,
    evidence_required: checkpoint.evidence_required,
    failure_behavior: checkpoint.failure_behavior,
    verifier_ref: checkpoint.verifier_ref
  }));
  const compressionMode =
    typeof bodyRecord.compression_mode === "string"
      ? bodyRecord.compression_mode
      : Number(bodyRecord.context_budget_tokens ?? 0) > 0
        ? "light"
        : "none";
  const contextBudgetTokens = Number(bodyRecord.context_budget_tokens ?? 8000);

  // ─── 语义重排：embedding 余弦相似度混合排序 ───
  // DB 层 ILIKE 拿到 3×候选后，用 embedding 做二次重排，截断到原始 limit。
  // embedding 服务不可用时降级跳过（semanticRerank 内部 catch 返回原列表）。
  const queryText = typeof input.body.query === "string" ? input.body.query : "";
  const userLimit = input.body.limit ?? 10;
  const [factualMemoryFinal, proceduralMemoryFinal, synthesizedKnowledgeFinal] = await Promise.all([
    factualMemory.length > 0
      ? semanticRerank({
          query: queryText,
          items: factualMemory,
          contentField: "content",
          matchCountField: "memory_match_count",
          limit: userLimit
        })
      : Promise.resolve(factualMemory),
    proceduralMemory.length > 0
      ? semanticRerank({
          query: queryText,
          items: proceduralMemory,
          contentField: "description",
          matchCountField: "skill_match_count",
          limit: userLimit
        })
      : Promise.resolve(proceduralMemory),
    synthesizedKnowledge.length > 0
      ? semanticRerank({
          query: queryText,
          items: synthesizedKnowledge,
          contentField: "content",
          matchCountField: "derived_match_count",
          limit: userLimit
        })
      : Promise.resolve(synthesizedKnowledge)
  ]);

  const evidenceIndex =
    requestedLayers.has("evidence_index") && synthesizedKnowledgeFinal.length > 0
      ? await queryDerivedKnowledgeEvidence({
          tenantId: input.tenantId,
          scope: input.scope,
          synthesizedKnowledgeIds: synthesizedKnowledgeFinal.map((item) => String(item.id))
        })
      : [];

  // ─── P1-3: utility_score 驱动 ranking ───
  // 收集 factual/procedural/synthesized 的 id，查 utility_score 后按高效用重排
  // rules 不参与（保持 task_binding 优先语义）；NULL 排最后不影响冷启动
  const rankingIds = [
    ...factualMemoryFinal.map((m) => String(m.id ?? "")),
    ...proceduralMemoryFinal.map((s) => String(s.id ?? "")),
    ...synthesizedKnowledgeFinal.map((k) => String(k.id ?? ""))
  ].filter(Boolean);
  const utilityMap = rankingIds.length > 0
    ? await getKnowledgeUtility({
        tenantId: input.tenantId,
        scope: input.scope,
        entryIds: rankingIds
      })
    : new Map();
  const rankedFactualMemory = applyUtilityRanking(factualMemoryFinal, utilityMap);
  const rankedProceduralMemory = applyUtilityRanking(proceduralMemoryFinal, utilityMap);
  // fix-8-3: synthesized_knowledge 用 importance_weight 排序（三因子加权衰减）
  // factual/procedural 暂不动，只管 synthesized_knowledge（按 SPEC 范围）
  const rankedSynthesizedKnowledge = applyImportanceRanking(synthesizedKnowledgeFinal, utilityMap);

  // 遗忘机制：更新被召回的合成知识的 last_recalled_at
  // 90 天没被召回的会被 archiveStaleSynthesizedKnowledge 归档
  if (rankedSynthesizedKnowledge.length > 0) {
    const recalledKnowledgeIds = rankedSynthesizedKnowledge
      .map((k) => String(k.id ?? ""))
      .filter(Boolean);
    if (recalledKnowledgeIds.length > 0) {
      try {
        await updateSynthesizedKnowledgeRecallTimestamp({
          tenantId: input.tenantId,
          scope: input.scope,
          knowledgeIds: recalledKnowledgeIds,
        });
      } catch {
        // 更新失败不阻塞 retrieve 主流程
      }
    }
  }

  const contextPackage = buildContextPackage({
    body: input.body,
    taskType,
    taskPhase,
    requestedLayers,
    compressionMode,
    contextBudgetTokens,
    rules: sortedRules,
    ruleCheckpoints,
    residentSnapshot,
    factualMemory: rankedFactualMemory,
    proceduralMemory: rankedProceduralMemory,
    synthesizedKnowledge: rankedSynthesizedKnowledge,
    evidenceIndex
  });

  const queryPayload = {
    task_request_id: input.body.task_request_id,
    query: input.body.query,
    fingerprint: input.body.fingerprint ?? null,
    fingerprint_status: input.body.fingerprint_status,
    task_type: taskType,
    task_phase: taskPhase,
    host: bodyRecord.host ?? null,
    project_ref: bodyRecord.project_ref ?? null,
    operation_intent: bodyRecord.operation_intent ?? null,
    query_hash: queryHash,
    requested_layers: [...requestedLayers],
    existing_bundle_id: bodyRecord.existing_bundle_id ?? null,
    reuse_existing_bundle: reuseExistingBundle
  };

  const bundleId = await createMemoryAccessLog({
    tenantId: input.tenantId,
    scope: input.scope,
    queryKind: "retrieve:bundle",
    queryPayload,
    decisionPayload: {
      gates,
      rule_count: sortedRules.length,
      task_binding_count: taskBindings.length,
      rule_checkpoint_count: ruleCheckpoints.length,
      factual_count: factualMemoryFinal.length,
      procedural_count: proceduralMemoryFinal.length,
      synthesized_knowledge_count: synthesizedKnowledgeFinal.length,
      evidence_index_count: evidenceIndex.length,
      layer_versions: currentLayerVersions,
      compression: contextPackage.compression,
      reuse_existing_bundle: reuseExistingBundle
    },
    objectType: "bundle",
    objectRef: input.body.task_request_id,
    traceId: input.traceId
  });

  // ─── fix-6 元认知：per-query 知识边界评估 ───
  // 回答三个问题：多大把握？高置信覆盖哪些方面？明确不知道什么？
  // 不是全局统计，是基于本次召回结果的边界评估
  const queryTerms = extractLooseSearchTerms(input.body.query);
  const metacognition = buildMetacognitionAssessment({
    query: input.body.query,
    queryTerms,
    rules: sortedRules,
    factualMemory: rankedFactualMemory,
    proceduralMemory: rankedProceduralMemory,
    synthesizedKnowledge: rankedSynthesizedKnowledge,
    evidenceIndex,
    utilityMap
  });

  // ─── fix-8: 记录 retrieve_quality 到 log 表 ───
  // 给归档保护做数据底子（避免 retrieve 失败导致误归档）
  // 异步不阻塞主流程
  const metaWithRatio = metacognition as MetacognitionAssessment & { _term_hit_ratio?: number; _hit_terms?: string[] };
  try {
    await logRetrieveQuality({
      tenantId: input.tenantId,
      scope: input.scope,
      traceId: input.traceId,
      query: input.body.query,
      queryTerms,
      hitTerms: metaWithRatio._hit_terms ?? [],
      termHitRatio: metaWithRatio._term_hit_ratio ?? 0,
      retrieveQuality: metacognition.retrieve_quality
    });
  } catch {
    // 日志失败不阻塞 retrieve 主流程
  }

  // 清理内部字段，不输出到 response
  const cleanMetacognition: MetacognitionAssessment = {
    overall_confidence: metacognition.overall_confidence,
    confidence_basis: metacognition.confidence_basis,
    retrieve_quality: metacognition.retrieve_quality,
    method: metacognition.method,
    boundary: metacognition.boundary,
    coverage_areas: metacognition.coverage_areas,
    knowledge_gaps: metacognition.knowledge_gaps,
    recommended_actions: metacognition.recommended_actions
  };

  // ─── fix-9: 删掉 LLM 三阶段调用，改成返回 mission_brief 让宿主自己做 ───
  // MCP 架构下 memory-service 不调 LLM，method='llm' 时附 mission_brief 给宿主
  // 宿主拿到 mission_brief 后用自己的 LLM 评估，结果可直接用或回写（回写留后续）
  let finalMetacognition = cleanMetacognition;
  let metacognitionMissionBrief: string | null = null;
  if (cleanMetacognition.method === "llm") {
    const topItems: Array<{ layer: string; title: string; confidence: number | null; utility: number | null }> = [];
    const collectTop = (items: Record<string, unknown>[], layer: string, limit = 3) => {
      for (const item of items.slice(0, limit)) {
        topItems.push({
          layer,
          title: String(item.title ?? item.rule_key ?? item.skill_key ?? ""),
          confidence: typeof item.confidence_score === "number" ? item.confidence_score : null,
          utility: typeof item.utility_score === "number" ? item.utility_score : null
        });
      }
    };
    collectTop(sortedRules, "rules");
    collectTop(rankedFactualMemory, "factual_memory");
    collectTop(rankedProceduralMemory, "procedural_memory");
    collectTop(rankedSynthesizedKnowledge, "synthesized_knowledge");

    metacognitionMissionBrief = buildMetacognitionMissionBrief({
      query: input.body.query,
      retrieve_quality: cleanMetacognition.retrieve_quality,
      rule_baseline: {
        overall_confidence: cleanMetacognition.overall_confidence,
        confidence_basis: cleanMetacognition.confidence_basis,
        boundary_status: cleanMetacognition.boundary.status,
        coverage_areas: cleanMetacognition.coverage_areas,
        knowledge_gaps: cleanMetacognition.knowledge_gaps.map((g) => ({ term: g.term, hit: g.hit, hint: g.hint })),
        recommended_actions: cleanMetacognition.recommended_actions
      },
      retrieved_summary: {
        rules_count: sortedRules.length,
        factual_memory_count: rankedFactualMemory.length,
        procedural_memory_count: rankedProceduralMemory.length,
        synthesized_knowledge_count: rankedSynthesizedKnowledge.length,
        evidence_count: evidenceIndex.length,
        top_items: topItems
      }
    });
    // method 保持 'llm'，宿主看到 method='llm' + mission_brief 就知道要做 LLM 评估
    // 宿主不评估则按规则版本用，不需要回退标记
  }

  const response: MemoryRetrieveResponse = {
    bundle_id: bundleId,
    runtime_summary: input.body.runtime_summary ?? {
      query: input.body.query
    },
    conversation_summary: conversationSummary,
    resident_snapshot: residentSnapshot,
    rules: sortedRules,
    factual_memory: rankedFactualMemory,
    procedural_memory: rankedProceduralMemory,
    synthesized_knowledge: rankedSynthesizedKnowledge,
    evidence_index: evidenceIndex,
    layer_versions: currentLayerVersions,
    assembly_context: {
      task_type: taskType,
      task_phase: taskPhase,
      query_hash: queryHash,
      requested_layers: [...requestedLayers],
      task_bindings: taskBindings,
      rule_checklist: ruleChecklist,
      reuse_existing_bundle: reuseExistingBundle,
      existing_bundle_id: bodyRecord.existing_bundle_id ?? null,
      compression_mode: compressionMode,
      context_budget_tokens: contextBudgetTokens,
      rule_failure_policy: "rule_declares_failure_behavior"
    },
    context_package: contextPackage,
    gates,
    metacognition: finalMetacognition,
    // fix-9: method='llm' 时附 mission_brief，宿主自己用 LLM 评估
    // 宿主不评估则按 metacognition 规则版本用
    metacognition_mission_brief: metacognitionMissionBrief,
    // §TRAE 适配报告（仅 TRAE 宿主有值，非 TRAE 为 null）
    // 让调用方能验证适配是否生效、variant 是什么、query 被增强成了什么
    trae_adaptation: traeAdaptationReport
  } as MemoryRetrieveResponse;

  await Promise.all([
    logLayerAccess({
      tenantId: input.tenantId,
      scope: input.scope,
      queryKind: "retrieve:conversation_summary",
      queryPayload,
      decisionPayload: {
        gates
      },
      items: conversationSummary,
      traceId: input.traceId,
      objectType: "conversation_summary"
    }),
    logLayerAccess({
      tenantId: input.tenantId,
      scope: input.scope,
      queryKind: "retrieve:resident_snapshot",
      queryPayload,
      decisionPayload: {
        gates
      },
      items: residentSnapshot,
      traceId: input.traceId,
      objectType: "resident_snapshot"
    }),
    logLayerAccess({
      tenantId: input.tenantId,
      scope: input.scope,
      queryKind: "retrieve:rules",
      queryPayload,
      decisionPayload: {
        source: "active_rules"
      },
      items: sortedRules,
      traceId: input.traceId,
      objectType: "rule"
    }),
    logLayerAccess({
      tenantId: input.tenantId,
      scope: input.scope,
      queryKind: "retrieve:factual_memory",
      queryPayload,
      decisionPayload: {
        gate: gates.factual
      },
      items: rankedFactualMemory,
      traceId: input.traceId,
      objectType: "memory"
    }),
    logLayerAccess({
      tenantId: input.tenantId,
      scope: input.scope,
      queryKind: "retrieve:procedural_memory",
      queryPayload,
      decisionPayload: {
        gate: gates.procedural
      },
      items: rankedProceduralMemory,
      traceId: input.traceId,
      objectType: "skill"
    }),
    logLayerAccess({
      tenantId: input.tenantId,
      scope: input.scope,
      queryKind: "retrieve:synthesized_knowledge",
      queryPayload,
      decisionPayload: {
        source: "active_synthesized_knowledge"
      },
      items: rankedSynthesizedKnowledge,
      traceId: input.traceId,
      objectType: "synthesized_knowledge"
    }),
    logLayerAccess({
      tenantId: input.tenantId,
      scope: input.scope,
      queryKind: "retrieve:evidence_index",
      queryPayload,
      decisionPayload: {
        source: "derived_knowledge_evidence"
      },
      items: evidenceIndex,
      traceId: input.traceId,
      objectType: "evidence"
    })
  ]);

  // ─── 检索 Hook：按作用域过滤检索结果 ───
  const hookedResponse = applyRetrievalHook(
    response as unknown as Record<string, unknown>,
    {
      scope: input.scope,
      tenantId: input.tenantId,
      projectId: (bodyRecord.project_ref as string | null) ?? input.scope,
    }
  ) as unknown as MemoryRetrieveResponse;

  return hookedResponse;
}
