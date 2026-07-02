/**
 * L2 冲突检测器
 *
 * 在候选写入前执行语义级查重和冲突分类。
 * 两段式阈值：
 *   - Jaccard/embedding ≥ 0.96 → DUPLICATE，静默丢弃
 *   - 0.50 ≤ similarity < 0.96 → 启发式分类（CONTRADICTION / SPECIALIZATION / EXTENSION / GENERALIZATION）
 *   - similarity < 0.50 → 无冲突
 *
 * 降级策略：
 *   1. 优先用 embedding HTTP 服务算余弦相似度
 *   2. 服务不可用时降级为 token-level Jaccard 相似度
 *   3. 分类用启发式规则，不依赖 LLM
 */

import { getPool } from "@super-agent/db";
import { createGovernanceChangeProposal, getLatestThresholdCalibration } from "@super-agent/db";
import { embedKnowledgeQuery, embedKnowledgePassages } from "../embeddingProvider.js";

export type ConflictKind =
  | "DUPLICATE"
  | "CONTRADICTION"
  | "SPECIALIZATION"
  | "EXTENSION"
  | "GENERALIZATION";

export type ProposedAction = "SKIP" | "MERGE" | "SUPERSEDE" | "HOLD_FOR_REVIEW";

export interface ConflictResult {
  existingId: string;
  existingTitle: string;
  existingContent: string;
  similarityScore: number;
  conflictKind: ConflictKind;
  proposedAction: ProposedAction;
  analysis: string;
}

export interface L2ConflictInput {
  tenantId: string;
  scope: string;
  traceId: string;
  layer: "rule" | "memory" | "skill" | "knowledge";
  candidateId: string;
  candidateTitle: string;
  candidateContent: string;
}

export interface L2ConflictOutput {
  conflicts: ConflictResult[];
  blockingAction: ProposedAction | null;
  mergedContent: string | null;
}

const DEFAULT_SIMILARITY_TRIGGER = 0.50;
const DEFAULT_DUPLICATE_THRESHOLD = 0.96;
// Jaccard 降级模式的 DUPLICATE 阈值：Jaccard 天然偏低，0.96 是为 embedding 设计的
const DEFAULT_JACCARD_DUPLICATE_THRESHOLD = 0.80;

const ACTION_MAP: Record<ConflictKind, ProposedAction> = {
  DUPLICATE: "SKIP",
  CONTRADICTION: "HOLD_FOR_REVIEW",
  SPECIALIZATION: "SUPERSEDE",
  EXTENSION: "MERGE",
  GENERALIZATION: "HOLD_FOR_REVIEW",
};

// ─── fix-7 阈值自适应：动态读取校准后的阈值 ───
// 优先读 kp_threshold_calibration 的 applied_value，无则用默认值
// 5 分钟内存缓存避免每次 detectConflicts 都查库
type CachedThreshold = {
  value: number;
  cachedAt: number;
};
const thresholdCache = new Map<string, CachedThreshold>();
const THRESHOLD_CACHE_TTL_MS = 5 * 60 * 1000;

async function getL2Threshold(
  tenantId: string,
  scope: string,
  thresholdName: string,
  defaultValue: number
): Promise<number> {
  const cacheKey = `${tenantId}:${scope}:${thresholdName}`;
  const cached = thresholdCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < THRESHOLD_CACHE_TTL_MS) {
    return cached.value;
  }
  try {
    const calibration = await getLatestThresholdCalibration({ tenantId, scope, thresholdName });
    const value = calibration ? calibration.applied_value : defaultValue;
    thresholdCache.set(cacheKey, { value, cachedAt: Date.now() });
    return value;
  } catch {
    // 查询失败时用默认值（数据库不可用等降级场景）
    return defaultValue;
  }
}

async function getActiveThresholds(tenantId: string, scope: string): Promise<{
  similarityTrigger: number;
  duplicateThreshold: number;
  jaccardDuplicateThreshold: number;
}> {
  const [similarityTrigger, duplicateThreshold, jaccardDuplicateThreshold] = await Promise.all([
    getL2Threshold(tenantId, scope, "similarity_trigger", DEFAULT_SIMILARITY_TRIGGER),
    getL2Threshold(tenantId, scope, "duplicate_threshold", DEFAULT_DUPLICATE_THRESHOLD),
    getL2Threshold(tenantId, scope, "jaccard_duplicate_threshold", DEFAULT_JACCARD_DUPLICATE_THRESHOLD)
  ]);
  return { similarityTrigger, duplicateThreshold, jaccardDuplicateThreshold };
}

// 校准更新后清缓存（lifecycleWorker 跑完 calibration 后调）
export function invalidateL2ThresholdCache(tenantId?: string, scope?: string): void {
  if (!tenantId || !scope) {
    thresholdCache.clear();
    return;
  }
  for (const key of thresholdCache.keys()) {
    if (key.startsWith(`${tenantId}:${scope}:`)) {
      thresholdCache.delete(key);
    }
  }
}

export async function detectConflicts(input: L2ConflictInput): Promise<L2ConflictOutput> {
  const pool = getPool();
  const existing = await queryPotentialConflicts(input);
  if (existing.length === 0) {
    return { conflicts: [], blockingAction: null, mergedContent: null };
  }

  // fix-7: 动态读取校准后的阈值（不再用硬编码常数）
  const { similarityTrigger, duplicateThreshold, jaccardDuplicateThreshold } = await getActiveThresholds(input.tenantId, input.scope);

  const conflicts: ConflictResult[] = [];
  let embeddingAvailable = false;
  let candidateEmbedding: number[] | null = null;

  try {
    candidateEmbedding = await embedKnowledgeQuery(input.candidateContent);
    embeddingAvailable = true;
  } catch {
    embeddingAvailable = false;
  }

  // 批量计算所有 existing 候选的 embedding（一次 HTTP round trip 替代 N 次逐条调用）
  let existingEmbeddings: (number[] | null)[] = [];
  if (embeddingAvailable) {
    try {
      const vectors = await embedKnowledgePassages(existing.map((e) => e.content));
      existingEmbeddings = vectors.map((v) => v ?? null);
    } catch {
      // 批量 embedding 失败，逐条降级为 Jaccard
      existingEmbeddings = existing.map(() => null);
    }
  } else {
    existingEmbeddings = existing.map(() => null);
  }

  for (let i = 0; i < existing.length; i++) {
    const entry = existing[i];
    let similarity: number;
    let usedJaccard = false;

    const existingEmbedding = existingEmbeddings[i];
    if (embeddingAvailable && existingEmbedding) {
      similarity = cosineSimilarity(candidateEmbedding!, existingEmbedding);
    } else {
      similarity = jaccardSimilarity(input.candidateContent, entry.content);
      usedJaccard = true;
    }

    if (similarity < similarityTrigger) continue;

    const kind = classifyConflict(input.candidateContent, entry.content, similarity, usedJaccard, duplicateThreshold, jaccardDuplicateThreshold);
    const action = ACTION_MAP[kind];

    conflicts.push({
      existingId: entry.id,
      existingTitle: entry.title,
      existingContent: entry.content,
      similarityScore: similarity,
      conflictKind: kind,
      proposedAction: action,
      analysis: buildAnalysis(kind, similarity, input.candidateContent, entry.content),
    });
  }

  if (conflicts.length === 0) {
    return { conflicts: [], blockingAction: null, mergedContent: null };
  }

  conflicts.sort((a, b) => b.similarityScore - a.similarityScore);

  const blocking = conflicts.find(
    (c) => c.proposedAction === "SKIP" || c.proposedAction === "SUPERSEDE"
  );

  const mergeConflict = conflicts.find((c) => c.proposedAction === "MERGE");
  const mergedContent = mergeConflict
    ? buildMergedContent(input.candidateContent, mergeConflict.existingContent)
    : null;

  for (const conflict of conflicts) {
    const proposedAction = `l2_conflict_${conflict.proposedAction.toLowerCase()}`;

    // 幂等：相同目标 + 相同动作 + 相同候选内容的 L2 proposal 已存在则跳过，避免审批历史重复。
    const existingL2 = await pool.query<{ id: string }>(
      `
      SELECT id
      FROM governance_change_proposal
      WHERE tenant_id = $1
        AND scope = $2
        AND target_object_type = $3
        AND target_object_id = $4
        AND proposed_action = $5
        AND status = 'recorded'
        AND proposed_payload ->> 'candidate_content' = $6
      LIMIT 1
      `,
      [input.tenantId, input.scope, input.layer, conflict.existingId, proposedAction, input.candidateContent]
    );
    if (existingL2.rowCount && existingL2.rows[0]) {
      continue;
    }

    await createGovernanceChangeProposal({
      tenantId: input.tenantId,
      scope: input.scope,
      targetObjectType: input.layer,
      targetObjectId: conflict.existingId,
      proposedAction,
      proposedPayload: {
        candidate_id: input.candidateId,
        candidate_title: input.candidateTitle,
        candidate_content: input.candidateContent,
        existing_id: conflict.existingId,
        existing_title: conflict.existingTitle,
        existing_content: conflict.existingContent,
        conflict_kind: conflict.conflictKind,
        similarity_score: conflict.similarityScore,
        analysis: conflict.analysis,
        merged_content: conflict.proposedAction === "MERGE" ? mergedContent : null,
      },
      reason: `L2冲突检测：${conflict.analysis}`,
      riskLevel: conflict.conflictKind === "CONTRADICTION" ? "high" : "medium",
      traceId: input.traceId,
      originScope: "session",
      availabilityScope: "session_only",
      promotionStatus: "needs_review",
      governanceLevel: "session",
      conflictMetadata: {
        conflict_kind: conflict.conflictKind,
        similarity_score: conflict.similarityScore,
        existing_id: conflict.existingId,
      },
      proposedActionType: conflict.proposedAction === "SKIP" ? "delete" : conflict.proposedAction.toLowerCase(),
    });
  }

  return {
    conflicts,
    blockingAction: blocking?.proposedAction ?? null,
    mergedContent,
  };
}

async function queryPotentialConflicts(
  input: L2ConflictInput
): Promise<Array<{ id: string; title: string; content: string }>> {
  const pool = getPool();
  const keywords = extractKeywords(input.candidateContent);
  if (keywords.length === 0) return [];

  const patterns = keywords.map((k) => `%${k}%`);
  const results: Array<{ id: string; title: string; content: string }> = [];

  if (input.layer === "rule") {
    // 1. 查 rule 表（已激活的规则）
    const activeRules = await pool.query(
      `SELECT id, title, statement AS content
       FROM rule
       WHERE tenant_id = $1
         AND (scope = $2 OR origin_scope = 'global_reusable')
         AND status = 'active'
         AND (statement ILIKE ANY($3::text[]))
       ORDER BY created_at DESC
       LIMIT 50`,
      [input.tenantId, input.scope, patterns]
    );
    for (const row of activeRules.rows) {
      results.push({ id: String(row.id), title: String(row.title ?? ""), content: String(row.content ?? "") });
    }

    // 2. 查 governance_change_proposal 表（待审批的 create_rule proposal）
    // 规则必须经人工审批，所以 pending proposal 也是潜在的冲突源
    const pendingProposals = await pool.query(
      `SELECT id, proposed_payload->>'title' AS title, proposed_payload->>'statement' AS content
       FROM governance_change_proposal
       WHERE tenant_id = $1
         AND scope = $2
         AND target_object_type = 'rule'
         AND proposed_action = 'create_rule'
         AND status IN ('recorded', 'parked')
         AND (proposed_payload->>'statement' ILIKE ANY($3::text[]))
       ORDER BY created_at DESC
       LIMIT 50`,
      [input.tenantId, input.scope, patterns]
    );
    for (const row of pendingProposals.rows) {
      results.push({ id: String(row.id), title: String(row.title ?? ""), content: String(row.content ?? "") });
    }
  } else if (input.layer === "memory") {
    const result = await pool.query(
      `SELECT id, title, content
       FROM memory
       WHERE tenant_id = $1
         AND (scope = $2 OR origin_scope = 'global_reusable')
         AND status = 'active'
         AND (content ILIKE ANY($3::text[]))
       ORDER BY created_at DESC
       LIMIT 50`,
      [input.tenantId, input.scope, patterns]
    );
    for (const row of result.rows) {
      results.push({ id: String(row.id), title: String(row.title ?? ""), content: String(row.content ?? "") });
    }
  } else if (input.layer === "knowledge") {
    const result = await pool.query(
      `SELECT id, title, content
       FROM kp_synthesized_knowledge
       WHERE tenant_id = $1
         AND (scope = $2 OR availability_scope = 'global_reusable')
         AND status = 'active'
         AND (content ILIKE ANY($3::text[]))
       ORDER BY created_at DESC
       LIMIT 50`,
      [input.tenantId, input.scope, patterns]
    );
    for (const row of result.rows) {
      results.push({ id: String(row.id), title: String(row.title ?? ""), content: String(row.content ?? "") });
    }
  } else if (input.layer === "skill") {
    // skill 表用 description 列而非 content
    const result = await pool.query(
      `SELECT id, title, description AS content
       FROM skill
       WHERE tenant_id = $1
         AND (scope = $2 OR origin_scope = 'global_reusable')
         AND status = 'active'
         AND (description ILIKE ANY($3::text[]))
       ORDER BY created_at DESC
       LIMIT 50`,
      [input.tenantId, input.scope, patterns]
    );
    for (const row of result.rows) {
      results.push({ id: String(row.id), title: String(row.title ?? ""), content: String(row.content ?? "") });
    }
  } else {
    // 其他层（兜底）
    const tableName = input.layer;
    const result = await pool.query(
      `SELECT id, title, content
       FROM ${tableName}
       WHERE tenant_id = $1
         AND (scope = $2 OR origin_scope = 'global_reusable')
         AND status = 'active'
         AND (content ILIKE ANY($3::text[]))
       ORDER BY created_at DESC
       LIMIT 50`,
      [input.tenantId, input.scope, patterns]
    );
    for (const row of result.rows) {
      results.push({ id: String(row.id), title: String(row.title ?? ""), content: String(row.content ?? "") });
    }
  }

  return results;
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个",
    "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好",
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "have", "has",
    "do", "does", "will", "would", "could", "should", "may", "might", "must",
    "if", "then", "and", "or", "not", "but", "in", "on", "at", "to", "for",
  ]);

  // 英文 token
  const englishTokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !stopWords.has(t));

  // 中文 bigram（2字符滑动窗口）
  const cjkBigrams: string[] = [];
  const cjkChars = text.replace(/[^\u4e00-\u9fff]/g, "");
  for (let i = 0; i < cjkChars.length - 1; i++) {
    const bigram = cjkChars.slice(i, i + 2);
    if (!stopWords.has(bigram)) {
      cjkBigrams.push(bigram);
    }
  }

  const allTokens = [...englishTokens, ...cjkBigrams];
  return [...new Set(allTokens)].slice(0, 15);
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

export function tokenize(text: string): string[] {
  const stopWords = new Set([
    "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
    "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "看", "好",
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "have", "has",
    "do", "does", "will", "would", "could", "should", "may", "might", "must",
    "if", "then", "and", "or", "not", "but", "in", "on", "at", "to", "for",
  ]);

  // 英文 token：只提取 ASCII 字母+数字组成的单词（避免把中文长字符串当成单个 token）
  const englishTokens = (text.match(/[a-zA-Z][a-zA-Z0-9_]{1,}/g) ?? [])
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 1 && !stopWords.has(t));

  // 中文字符级 token（单字符）
  const cjkChars: string[] = [];
  const cjkText = text.replace(/[^\u4e00-\u9fff]/g, "");
  for (const ch of cjkText) {
    if (!stopWords.has(ch)) {
      cjkChars.push(ch);
    }
  }

  return [...englishTokens, ...cjkChars];
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function classifyConflict(
  newContent: string,
  existingContent: string,
  similarity: number,
  usedJaccard: boolean = false,
  duplicateThreshold?: number,
  jaccardDuplicateThreshold?: number
): ConflictKind {
  // fix-7: 用动态校准阈值（不再用硬编码常数）
  // Jaccard 降级模式用更低的 DUPLICATE 阈值（Jaccard 天然偏低）
  const effectiveDupThreshold = usedJaccard
    ? (jaccardDuplicateThreshold ?? DEFAULT_JACCARD_DUPLICATE_THRESHOLD)
    : (duplicateThreshold ?? DEFAULT_DUPLICATE_THRESHOLD);
  if (similarity >= effectiveDupThreshold) {
    return "DUPLICATE";
  }

  const newTokens = new Set(tokenize(newContent));
  const existingTokens = new Set(tokenize(existingContent));

  let newOnly = 0;
  let existingOnly = 0;
  for (const t of newTokens) {
    if (!existingTokens.has(t)) newOnly++;
  }
  for (const t of existingTokens) {
    if (!newTokens.has(t)) existingOnly++;
  }

  const hasNegationDiff = hasNegationDifference(newContent, existingContent);
  if (hasNegationDiff) {
    return "CONTRADICTION";
  }

  if (newOnly > existingOnly && existingOnly <= 2) {
    return "EXTENSION";
  }
  if (existingOnly > newOnly && newOnly <= 2) {
    return "SPECIALIZATION";
  }

  return "GENERALIZATION";
}

function hasNegationDifference(a: string, b: string): boolean {
  const negationPatterns = [
    /禁止|不得|不能|不要|must\s*not|do\s*not|don't|never|不允许|不可以/gi,
    /必须|应当|应该|要|需要|must|should|shall|allow|permit/gi,
  ];
  const aNeg = a.match(negationPatterns[0]) ?? [];
  const bNeg = b.match(negationPatterns[0]) ?? [];
  const aPos = a.match(negationPatterns[1]) ?? [];
  const bPos = b.match(negationPatterns[1]) ?? [];
  return (aNeg.length > 0 && bPos.length > 0 && bNeg.length === 0) ||
         (bNeg.length > 0 && aPos.length > 0 && aNeg.length === 0);
}

function buildAnalysis(
  kind: ConflictKind,
  similarity: number,
  newContent: string,
  existingContent: string
): string {
  const simPct = (similarity * 100).toFixed(1);
  switch (kind) {
    case "DUPLICATE":
      return `相似度 ${simPct}% ≥ 96%，判定为重复，建议跳过。`;
    case "CONTRADICTION":
      return `相似度 ${simPct}%，检测到否定/肯定差异，判定为矛盾，需人工审核。`;
    case "SPECIALIZATION":
      return `相似度 ${simPct}%，新条目是现有条目的特化，建议覆盖旧条目。`;
    case "EXTENSION":
      return `相似度 ${simPct}%，新条目扩充了现有条目，建议合并。`;
    case "GENERALIZATION":
      return `相似度 ${simPct}%，新条目比现有更宽泛，需人工确认。`;
  }
}

function buildMergedContent(newContent: string, oldContent: string): string {
  const newTokens = tokenize(newContent);
  const oldTokens = tokenize(oldContent);
  const oldSet = new Set(oldTokens);
  const additions = newTokens.filter((t) => !oldSet.has(t));
  if (additions.length === 0) return newContent;
  return `${oldContent}（补充：${additions.join("、")}）`;
}
