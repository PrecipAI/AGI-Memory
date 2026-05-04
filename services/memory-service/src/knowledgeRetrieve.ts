import type { KnowledgeRetrieveRequest, KnowledgeRetrieveResponse } from "@super-agent/contracts";
import {
  createKnowledgeContextBundle,
  queryActiveDerivedKnowledge,
  queryDerivedKnowledgeEvidence,
  queryKnowledgeSections,
  queryKnowledgeSectionsBm25,
  queryKnowledgeSectionsByIds
} from "@super-agent/db";
import { buildRetrieveBundle } from "./retrieveBundle.js";
import type { RetrievalGate } from "./retrievalGate.js";
import { embedKnowledgeQuery } from "./embeddingProvider.js";
import { ensureMilvusKnowledgeCollection, milvusVectorEngineName, searchMilvusSections } from "./milvusVectorStore.js";

const STOPWORDS = new Set([
  "what",
  "why",
  "how",
  "when",
  "where",
  "which",
  "does",
  "should",
  "would",
  "could",
  "into",
  "from",
  "that",
  "this",
  "with",
  "without",
  "about",
  "only",
  "than",
  "then",
  "they",
  "them",
  "their",
  "have",
  "has",
  "been",
  "being",
  "because",
  "using",
  "used",
  "user",
  "system",
  "agent"
]);

const RRF_K = 60;

type RankedHit = Record<string, unknown> & {
  retrieval_score?: number;
  retrieval_scores?: Record<string, number>;
  retrieval_rank_sources?: Record<string, number>;
};

function asArrayOfObjects(input: unknown): Record<string, unknown>[] {
  return Array.isArray(input) ? input.filter((item) => item && typeof item === "object") as Record<string, unknown>[] : [];
}

function extractQueryTerms(query: string): string[] {
  const matches = query.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
  const unique = new Set<string>();
  for (const match of matches) {
    if (STOPWORDS.has(match)) {
      continue;
    }
    unique.add(match);
    if (unique.size >= 5) {
      break;
    }
  }
  return [...unique];
}

function buildTsQuery(query: string): string {
  const terms = extractQueryTerms(query)
    .map((term) => term.replace(/[^a-z0-9_-]/gi, ""))
    .filter(Boolean);
  return terms.length > 0 ? terms.join(" OR ") : query.replace(/[^a-z0-9_-]+/gi, " ").trim().split(/\s+/).filter(Boolean).join(" OR ");
}

function vectorRetrievalEnabled(): boolean {
  return process.env.KNOWLEDGE_VECTOR_RETRIEVAL_ENABLED === "1";
}

function isUnsupportedDynamicQuery(query: string): boolean {
  const normalized = query.toLowerCase();
  const dynamicSignals = [
    "latest price",
    "stock today",
    "weather",
    "tomorrow",
    "recipe",
    "scrambled eggs",
    "exact command",
    "what is the exact command",
    "flight",
    "train schedule",
    "实时",
    "股价",
    "股票价格",
    "天气",
    "明天",
    "菜谱",
    "高铁",
    "几点发车",
    "本地部署",
    "部署怎么做",
    "怎么安装",
    "具体命令"
  ];
  const domainSignals = [
    "memory",
    "knowledge",
    "agent",
    "rag",
    "mcp",
    "harness",
    "记忆",
    "知识",
    "治理",
    "检索",
    "召回",
    "图谱"
  ];
  return dynamicSignals.some((signal) => normalized.includes(signal)) && !domainSignals.some((signal) => normalized.includes(signal));
}

async function buildMilvusRankedSections(input: {
  tenantId: string;
  scope: string;
  query: string;
  limit: number;
}): Promise<{ items: RankedHit[]; vectorEngine: string; warning: string | null }> {
  if (!vectorRetrievalEnabled()) {
    return {
      items: [],
      vectorEngine: "disabled",
      warning: null
    };
  }

  try {
    await ensureMilvusKnowledgeCollection();
    const queryVector = await embedKnowledgeQuery(input.query);
    const hits = await searchMilvusSections({
      tenantId: input.tenantId,
      scope: input.scope,
      queryVector,
      limit: input.limit
    });
    if (hits.length === 0) {
      return {
        items: [],
        vectorEngine: milvusVectorEngineName(),
        warning: null
      };
    }
    const sections = await queryKnowledgeSectionsByIds({
      tenantId: input.tenantId,
      scope: input.scope,
      sectionIds: hits.map((item) => item.sectionId)
    });
    const sectionsById = new Map(sections.map((item) => [String(item.id), item]));
    const rankedItems: RankedHit[] = [];
    for (const hit of hits) {
      const section = sectionsById.get(hit.sectionId);
      if (!section) {
        continue;
      }
      rankedItems.push({
        ...section,
        retrieval_score: hit.score
      });
    }
    return {
      items: rankedItems,
      vectorEngine: milvusVectorEngineName(),
      warning: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      items: [],
      vectorEngine: "milvus_unavailable",
      warning: `milvus_vector_unavailable:${message.slice(0, 180)}`
    };
  }
}

function reciprocalRankFusion(inputs: Array<{ source: string; items: Record<string, unknown>[] }>, limit: number): RankedHit[] {
  const merged = new Map<string, RankedHit>();
  for (const input of inputs) {
    input.items.forEach((item, index) => {
      const id = String(item.id ?? "");
      if (!id) {
        return;
      }
      const existing = merged.get(id) ?? { ...item, retrieval_score: 0, retrieval_scores: {}, retrieval_rank_sources: {} };
      const score = 1 / (RRF_K + index + 1);
      existing.retrieval_score = Number(existing.retrieval_score ?? 0) + score;
      existing.retrieval_scores = {
        ...(existing.retrieval_scores ?? {}),
        [input.source]: Number(item.retrieval_score ?? item.bm25_score ?? score)
      };
      existing.retrieval_rank_sources = {
        ...(existing.retrieval_rank_sources ?? {}),
        [input.source]: index + 1
      };
      merged.set(id, existing);
    });
  }
  return [...merged.values()]
    .sort((left, right) => Number(right.retrieval_score ?? 0) - Number(left.retrieval_score ?? 0))
    .slice(0, limit);
}

function mergeById(groups: Record<string, unknown>[][], limit: number): Record<string, unknown>[] {
  const merged = new Map<string, Record<string, unknown>>();
  for (const group of groups) {
    for (const item of group) {
      const key = typeof item.id === "string" ? item.id : JSON.stringify(item);
      if (!merged.has(key)) {
        merged.set(key, item);
      }
      if (merged.size >= limit) {
        return [...merged.values()];
      }
    }
  }
  return [...merged.values()];
}

export async function buildKnowledgeRetrieveBundle(input: {
  tenantId: string;
  scope: string;
  traceId: string;
  body: KnowledgeRetrieveRequest;
  retrievalGate: RetrievalGate;
}): Promise<KnowledgeRetrieveResponse> {
  if (isUnsupportedDynamicQuery(input.body.query)) {
    const summary = "Knowledge retrieval skipped: query appears to require external real-time data outside the long-term knowledge scope.";
    const bundleId = await createKnowledgeContextBundle({
      tenantId: input.tenantId,
      scope: input.scope,
      requestRef: input.body.task_request_id,
      bundleType: input.body.intent_type ?? "knowledge_retrieve",
      summary,
      facts: [],
      entities: [],
      relations: [],
      evidenceRefs: [],
      sectionRefs: [],
      warnings: ["unsupported_dynamic_query"],
      assemblyTrace: {
        intent_type: input.body.intent_type ?? "knowledge_retrieve",
        retrieval: {
          method: "unsupported_dynamic_query_gate",
          mode: "no_recall"
        }
      },
      traceId: input.traceId
    });
    return {
      bundle_id: bundleId,
      query: input.body.query,
      summary,
      facts: [],
      derived_knowledge: [],
      evidence_trace: [],
      rules: [],
      skills: [],
      entities: [],
      relations: [],
      evidence_refs: [],
      section_refs: [],
      warnings: ["unsupported_dynamic_query"],
      assembly_trace: {
        entity_hit_ids: [],
        fact_hit_ids: [],
        derived_knowledge_hit_ids: [],
        relation_hit_ids: [],
        retrieval: {
          method: "unsupported_dynamic_query_gate",
          mode: "no_recall"
        }
      }
    };
  }

  const baseline = await buildRetrieveBundle({
    tenantId: input.tenantId,
    scope: input.scope,
    traceId: input.traceId,
    body: {
      task_request_id: input.body.task_request_id,
      query: input.body.query,
      runtime_summary: input.body.runtime_summary,
      fingerprint: input.body.fingerprint,
      fingerprint_status: input.body.fingerprint_status ?? "matched_or_na",
      include_factual: input.body.include_factual,
      include_procedural: input.body.include_procedural,
      limit: input.body.top_k ?? 10
    },
    retrievalGate: input.retrievalGate
  });

  const topK = input.body.top_k ?? 10;
  const queryTerms = extractQueryTerms(input.body.query);
  const bm25Query = buildTsQuery(input.body.query);
  const derivedKnowledgeHits = await queryActiveDerivedKnowledge({
    tenantId: input.tenantId,
    scope: input.scope,
    query: input.body.query,
    limit: topK
  });
  const derivedKnowledgeEvidence = await queryDerivedKnowledgeEvidence({
    tenantId: input.tenantId,
    scope: input.scope,
    synthesizedKnowledgeIds: derivedKnowledgeHits.map((item) => String(item.id))
  });

  const bm25SectionHits = await queryKnowledgeSectionsBm25({
    tenantId: input.tenantId,
    scope: input.scope,
    query: bm25Query,
    limit: Math.max(topK * 3, 20)
  });
  const milvusVectorResult = await buildMilvusRankedSections({
    tenantId: input.tenantId,
    scope: input.scope,
    query: input.body.query,
    limit: Math.max(topK * 3, 20)
  });
  const vectorEngine = milvusVectorResult.vectorEngine;
  const vectorSectionHits = milvusVectorResult.items;
  let lexicalSectionHits = await queryKnowledgeSections({
    tenantId: input.tenantId,
    scope: input.scope,
    query: input.body.query,
    limit: Math.max(topK * 2, 20)
  });

  if (lexicalSectionHits.length === 0 && queryTerms.length > 0) {
    lexicalSectionHits = mergeById(
      await Promise.all(
        queryTerms.map((term) =>
          queryKnowledgeSections({
            tenantId: input.tenantId,
            scope: input.scope,
            query: term,
            limit: topK
          })
        )
      ),
      topK
    );
  }

  const directSectionHits = reciprocalRankFusion(
    [
      { source: "bm25", items: bm25SectionHits },
      ...(vectorRetrievalEnabled() ? [{ source: "vector", items: vectorSectionHits }] : []),
      { source: "lexical", items: lexicalSectionHits }
    ],
    topK
  );

  const sectionHits = directSectionHits;
  const sectionRetrievalMode = vectorRetrievalEnabled() ? "bm25_vector_rrf" : "bm25_lexical_rrf";

  const baselineFacts = asArrayOfObjects(baseline.factual_memory).map((item) => ({
    id: item.id,
    fact_kind: "legacy_factual",
    statement: item.content,
    confidence_score: item.confidence_score,
    source: "memory"
  }));
  const rules: Record<string, unknown>[] = [];
  const skills = asArrayOfObjects(baseline.procedural_memory).map((item) => ({
    id: item.id,
    skill_key: item.skill_key,
    description: item.description,
    source: "memory"
  }));
  const warnings = [
    ...(derivedKnowledgeHits.length === 0 ? ["derived_knowledge_empty"] : []),
    ...(derivedKnowledgeEvidence.length === 0 && input.body.require_evidence !== false ? ["insufficient_evidence"] : []),
    ...(sectionHits.length === 0 ? ["section_retrieval_empty"] : []),
    ...(milvusVectorResult.warning ? [milvusVectorResult.warning] : [])
  ];

  const summary = [
    `Knowledge retrieval found ${derivedKnowledgeHits.length} derived knowledge objects`,
    `${sectionHits.length} sections`,
    `${baselineFacts.length} baseline factual memories`
  ].join(", ");
  const exposeAtomicKnowledge = derivedKnowledgeHits.length === 0 || input.body.include_trace === true;
  const responseFacts = derivedKnowledgeHits.length > 0 ? [] : baselineFacts;
  const responseSections = exposeAtomicKnowledge ? sectionHits : [];

  const bundleId = await createKnowledgeContextBundle({
    tenantId: input.tenantId,
    scope: input.scope,
    requestRef: input.body.task_request_id,
    bundleType: input.body.intent_type ?? "knowledge_retrieve",
    summary,
    facts: responseFacts,
    entities: [],
    relations: [],
    evidenceRefs: [
      ...derivedKnowledgeEvidence.map((item) => ({
        id: item.evidence_id,
        source_uri: item.source_uri,
        content_excerpt: item.content_excerpt,
        derived_knowledge_id: item.synthesized_knowledge_id,
        fact_id: item.fact_id,
        fact_statement: item.fact_statement
      }))
    ],
    sectionRefs: responseSections.map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      document_title: item.document_title,
      document_source_uri: item.document_source_uri,
      retrieval_score: item.retrieval_score,
      retrieval_scores: item.retrieval_scores,
      retrieval_rank_sources: item.retrieval_rank_sources
    })),
    warnings,
    assemblyTrace: {
      baseline_counts: {
        factual: baseline.factual_memory.length,
        procedural: baseline.procedural_memory.length
      },
      entity_hit_count: 0,
      fact_hit_count: 0,
      relation_hit_count: 0,
      evidence_hit_count: derivedKnowledgeEvidence.length,
      derived_knowledge_hit_count: derivedKnowledgeHits.length,
      derived_knowledge_evidence_count: derivedKnowledgeEvidence.length,
      section_hit_count: sectionHits.length,
      section_retrieval: {
        method: "derived_knowledge_first",
        mode: sectionRetrievalMode,
        fallback_method: vectorRetrievalEnabled() ? "bm25_vector_rrf" : "bm25_lexical_rrf",
        bm25_hit_count: bm25SectionHits.length,
        vector_hit_count: vectorSectionHits.length,
        lexical_hit_count: lexicalSectionHits.length,
        graph_section_hit_count: 0,
        rrf_k: RRF_K,
        vector_engine: vectorEngine
      },
      intent_type: input.body.intent_type ?? "knowledge_retrieve"
    },
    traceId: input.traceId
  });

  return {
    bundle_id: bundleId,
    query: input.body.query,
    summary,
    facts: responseFacts,
    derived_knowledge: derivedKnowledgeHits.map((item) => ({
      id: item.id,
      knowledge_type: item.knowledge_type,
      title: item.title,
      content: item.content,
      reasoning_summary: item.reasoning_summary,
      confidence_score: item.confidence_score,
      risk_level: item.risk_level,
      evidence_ids: item.evidence_ids,
      source_object_ids: item.source_object_ids,
      source: "derived_knowledge"
    })),
    evidence_trace: derivedKnowledgeEvidence.map((item) => ({
      derived_knowledge_id: item.synthesized_knowledge_id,
      evidence_id: item.evidence_id,
      source_uri: item.source_uri,
      source_object_type: item.source_object_type,
      source_object_id: item.source_object_id,
      fact_title: item.fact_title,
      fact_statement: item.fact_statement,
      content_excerpt: item.content_excerpt
    })),
    rules,
    skills,
    entities: [],
    relations: [],
    evidence_refs: [
      ...derivedKnowledgeEvidence.map((item) => ({
        id: item.evidence_id,
        source_uri: item.source_uri,
        content_excerpt: item.content_excerpt,
        derived_knowledge_id: item.synthesized_knowledge_id,
        fact_id: item.fact_id,
        fact_statement: item.fact_statement
      }))
    ],
    section_refs: responseSections.map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      document_title: item.document_title,
      document_source_uri: item.document_source_uri,
      retrieval_score: item.retrieval_score,
      retrieval_scores: item.retrieval_scores,
      retrieval_rank_sources: item.retrieval_rank_sources
    })),
    warnings,
    assembly_trace: {
      baseline,
      entity_hit_ids: [],
      fact_hit_ids: [],
      derived_knowledge_hit_ids: derivedKnowledgeHits.map((item) => item.id),
      relation_hit_ids: [],
      retrieval: {
        method: "derived_knowledge_first",
        mode: sectionRetrievalMode,
        fallback_method: vectorRetrievalEnabled() ? "bm25_vector_rrf" : "bm25_lexical_rrf",
        bm25_section_ids: bm25SectionHits.map((item) => item.id),
        vector_section_ids: vectorSectionHits.map((item) => item.id),
        lexical_section_ids: lexicalSectionHits.map((item) => item.id),
        graph_section_ids: [],
        fused_section_ids: sectionHits.map((item) => item.id),
        vector_engine: vectorEngine
      }
    }
  };
}
