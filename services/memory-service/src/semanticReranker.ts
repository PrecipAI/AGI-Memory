/**
 * 语义重排器
 *
 * 在 DB 层 ILIKE 词法匹配拿到候选后，用 embedding 余弦相似度做二次重排。
 * 混合排序：final_score = 0.4 * lexical_score + 0.6 * semantic_similarity
 *
 * 降级策略：embedding 服务不可用时直接返回原列表，不影响召回主流程。
 * 延迟考量：一次 retrieve 最多 3 层 × 30 候选 = 90 条 passage embedding，
 * 走批量 HTTP 请求（embedKnowledgePassages 支持数组），单次 round trip。
 */

import { embedKnowledgePassages, embedKnowledgeQuery } from "./embeddingProvider.js";

/** 混合排序权重：词法 40%，语义 60% */
const LEXICAL_WEIGHT = 0.4;
const SEMANTIC_WEIGHT = 0.6;

export interface RerankOptions {
  /** 原始查询文本 */
  query: string;
  /** 候选列表，每条需有 id 和 content/title 用于算 embedding */
  items: Record<string, unknown>[];
  /** 提取候选文本的列名，默认 "content" */
  contentField?: string;
  /** 词法命中分数字段名，默认 "memory_match_count" / "skill_match_count" / "derived_match_count" */
  matchCountField?: string;
  /** 最终返回的条目数，默认等于 items.length */
  limit?: number;
}

/**
 * 对候选列表做语义混合重排。
 * embedding 服务不可用时降级返回原列表（按原顺序截断到 limit）。
 */
export async function semanticRerank(options: RerankOptions): Promise<Record<string, unknown>[]> {
  const { query, items, contentField = "content", limit = items.length } = options;

  if (items.length === 0 || !query?.trim()) {
    return items.slice(0, limit);
  }

  // 1. 算 query 向量
  let queryVector: number[];
  try {
    queryVector = await embedKnowledgeQuery(query);
  } catch {
    // embedding 服务不可用，降级
    return items.slice(0, limit);
  }

  // 2. 批量算候选向量
  const passages = items.map((item) => String(item[contentField] ?? item.title ?? ""));
  let passageVectors: number[][];
  try {
    passageVectors = await embedKnowledgePassages(passages);
  } catch {
    return items.slice(0, limit);
  }

  if (passageVectors.length !== items.length) {
    return items.slice(0, limit);
  }

  // 3. 计算混合分数并排序
  const matchCountField = options.matchCountField ?? "memory_match_count";
  const maxMatchCount = Math.max(
    1,
    ...items.map((item) => Number(item[matchCountField] ?? 0))
  );

  const scored = items.map((item, index) => {
    const semanticScore = cosineSimilarity(queryVector, passageVectors[index]);
    const lexicalScore = Number(item[matchCountField] ?? 0) / maxMatchCount;
    const finalScore = LEXICAL_WEIGHT * lexicalScore + SEMANTIC_WEIGHT * semanticScore;
    return { item, finalScore, semanticScore };
  });

  scored.sort((a, b) => b.finalScore - a.finalScore);

  return scored.slice(0, limit).map((s) => ({
    ...s.item,
    _semantic_score: Number(s.semanticScore.toFixed(4)),
    _final_score: Number(s.finalScore.toFixed(4)),
  }));
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
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
