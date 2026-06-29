// KnowledgeModelWorker — MCP 架构下的 LLM 适配层
//
// 架构认知（fix-9 纠正后）：
// - memory-service 是 MCP 插件后端，所有 LLM 调用都在宿主侧（TRAE/Qoder/Codex/CC）
// - memory-service 不应该自己调 LLM（KNOWLEDGE_MODEL_ENDPOINT 已废弃）
// - 宿主 LLM 产物通过 host_model_result.extraction_preview / synthesis_result 传入
//
// 三个方法的当前状态：
// - analyze: 纯启发式（heuristicAnalyze），不再调 HTTP endpoint
// - synthesize: 返回 null，由调用方读 host_model_result.synthesis_result
// - assessMetacognition: 返回 null，由调用方返回 mission_brief 让宿主自己做 LLM 评估

type KnowledgeModelInput = {
  memoryDomain: string;
  title: string;
  statement: string;
  artifactTag: string;
  sourceType: string;
  metadata?: Record<string, unknown>;
};

type KnowledgeModelOutput = {
  provider: string;
  entity_name: string | null;
  entity_type: string;
  aliases: string[];
  summary: string;
  confidence_delta: number;
  review_reason?: string | null;
};

export type KnowledgeSynthesisInput = {
  synthesis_type: string;
  facts: Array<{
    fact_id: string;
    title: string;
    statement: string;
    evidence_id: string;
    evidence_source_uri?: string | null;
    document_title?: string | null;
  }>;
  metadata?: Record<string, unknown>;
};

export type KnowledgeSynthesisOutput = {
  provider: string;
  governance_output_type?: "derived_knowledge" | "skill_candidate" | "memory_candidate" | "audit_only" | "archive";
  knowledge_type: string;
  title: string;
  content: string;
  reasoning_summary: string;
  confidence_score: number;
  risk_level: "low" | "medium" | "high" | "critical";
  recall_state?: "active" | "inactive" | "audit_only";
  context_assembly_state?: "active" | "inactive" | "audit_only";
};

function trimText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 3)}...`;
}

function inferEntityName(title: string, statement: string): string | null {
  const text = `${title}\n${statement}`;
  const knownTerms = [
    "LangGraph",
    "LangChain",
    "OpenAI Agents SDK",
    "GitHub Copilot",
    "Mem0",
    "Zep",
    "Letta",
    "AutoGen",
    "Semantic Kernel",
    "CrewAI",
    "LlamaIndex",
    "Haystack",
    "RAGAS",
    "DeepEval",
    "Inspect AI",
    "SWE-bench",
    "Model Context Protocol",
    "MCP",
    "GraphRAG",
    "Milvus",
    "Qdrant",
    "Weaviate",
    "Dify",
    "Qwen",
    "AgentScope",
    "OpenCompass",
    "RAG",
    "agent memory",
    "long-term memory",
    "knowledge graph",
    "prompt injection"
  ];
  for (const term of knownTerms) {
    if (text.toLowerCase().includes(term.toLowerCase())) {
      return term;
    }
  }

  const cleanTitle = title.trim();
  if (cleanTitle.length > 0 && cleanTitle.length <= 90 && !/\(part \d+\)$/i.test(cleanTitle)) {
    return cleanTitle;
  }
  const sentence = statement.split(/[.!?]/)[0]?.trim();
  return sentence && sentence.length <= 80 ? sentence : null;
}

function inferEntityType(input: KnowledgeModelInput, entityName: string | null): string {
  if (input.memoryDomain === "rule") {
    return "rule_topic";
  }
  if (input.memoryDomain === "skill") {
    return "skill_topic";
  }
  const text = `${entityName ?? ""} ${input.title} ${input.statement}`.toLowerCase();
  if (/(sdk|framework|autogen|langgraph|crewai|agentscope|semantic kernel)/.test(text)) {
    return "framework";
  }
  if (/(ragas|deepeval|inspect|benchmark|eval|swe-bench|opencompass)/.test(text)) {
    return "evaluation";
  }
  if (/(memory|profile|long-term|persistent)/.test(text)) {
    return "memory_concept";
  }
  if (/(mcp|tool|protocol)/.test(text)) {
    return "tool_protocol";
  }
  if (/(graph|entity|relation|fact)/.test(text)) {
    return "knowledge_graph_concept";
  }
  return "knowledge_topic";
}

function heuristicAnalyze(input: KnowledgeModelInput): KnowledgeModelOutput {
  const entityName = inferEntityName(input.title, input.statement);
  const aliases = entityName && entityName !== input.title ? [input.title] : [];
  let confidenceDelta = 0;
  let reviewReason: string | null = null;

  if (input.memoryDomain === "rule") {
    confidenceDelta = -0.07;
    reviewReason = "high_impact_rule";
  } else if (input.memoryDomain === "skill") {
    confidenceDelta = -0.05;
    reviewReason = "manual_hold";
  } else if (input.statement.length > 300) {
    confidenceDelta = 0.03;
  }

  return {
    provider: "heuristic",
    entity_name: entityName,
    entity_type: inferEntityType(input, entityName),
    aliases,
    summary: trimText(input.statement, 240),
    confidence_delta: confidenceDelta,
    review_reason: reviewReason
  };
}

export type MetacognitionAssessmentInput = {
  query: string;
  retrieve_quality: "good" | "partial" | "poor";
  rule_baseline: {
    overall_confidence: number;
    confidence_basis: {
      layer_coverage: number;
      avg_item_confidence: number;
      high_utility_ratio: number;
      evidence_backed_ratio: number;
    };
    boundary_status: "covered" | "partial" | "unknown";
    coverage_areas: Array<{ area: string; layer_hits: string[]; confidence: number; item_count: number }>;
    knowledge_gaps: Array<{ term: string; hit: boolean; hint?: string }>;
    recommended_actions: string[];
  };
  retrieved_summary: {
    rules_count: number;
    factual_memory_count: number;
    procedural_memory_count: number;
    synthesized_knowledge_count: number;
    evidence_count: number;
    top_items: Array<{ layer: string; title: string; confidence: number | null; utility: number | null }>;
  };
};

export type MetacognitionAssessmentOutput = {
  provider: string;
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
  reasoning_summary: string;
};

// ─── mission_brief 生成器：让宿主 LLM 自己做元认知评估 ───
// fix-9: 删掉 HTTP fetch 后，改成返回 mission_brief 让宿主自己跑 LLM
// 宿主拿到 mission_brief 后自己用 LLM 评估，结果可直接用或回写（回写留后续）
export function buildMetacognitionMissionBrief(input: MetacognitionAssessmentInput): string {
  return JSON.stringify({
    task: "metacognition_assessment",
    contract: {
      goal: "基于 retrieve 结果推理查询的知识边界——高置信覆盖什么、明确不知道什么、需要查证什么",
      input_policy: {
        query_is_user_intent: true,
        retrieved_summary_is_ground_truth: true,
        rule_baseline_is_reference_only: true,
        do_not_invent_items_not_in_retrieved_summary: true
      },
      output_policy: {
        boundary_status_must_match_rule_baseline_if_covered: true,
        unknown_aspects_must_come_from_knowledge_gaps: true,
        recommended_actions_can_extend_preset: true,
        reasoning_summary_required: true
      },
      retrieve_quality_hint:
        input.retrieve_quality === "partial"
          ? "召回可能不完整，部分查询词未命中，boundary.unknown_aspects 的判断需保守"
          : "召回质量良好，boundary 判断可基于完整 retrieve 结果"
    },
    input
  }, null, 2);
}

export class KnowledgeModelWorker {
  // fix-9: 纯启发式，不再调 KNOWLEDGE_MODEL_ENDPOINT
  // 宿主 LLM 产物通过 host_model_result 通道传入，不在这里调 LLM
  async analyze(input: KnowledgeModelInput): Promise<KnowledgeModelOutput> {
    return heuristicAnalyze(input);
  }

  // fix-9: synthesize 改成返回 null
  // 调用方（knowledgeGovernance/L4CognitiveEngine）应改用 host_model_result.synthesis_result
  async synthesize(_input: KnowledgeSynthesisInput): Promise<KnowledgeSynthesisOutput | null> {
    return null;
  }

  // fix-9: assessMetacognition 改成返回 null
  // 调用方（retrieveBundle）应改用 buildMetacognitionMissionBrief 返回 mission_brief
  async assessMetacognition(_input: MetacognitionAssessmentInput): Promise<MetacognitionAssessmentOutput | null> {
    return null;
  }
}
