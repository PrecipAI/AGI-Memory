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

type HttpModelResponse = Partial<KnowledgeModelOutput & KnowledgeSynthesisOutput> & Record<string, unknown>;

const ALLOWED_SYNTHESIS_TYPES = new Set([
  "consolidated_fact",
  "derived_relation",
  "cross_source_pattern",
  "design_principle",
  "derived_rule",
  "boundary_condition",
  "application_result",
  "memory_revision",
  "conflict_summary"
]);

const ALLOWED_GOVERNANCE_OUTPUT_TYPES = new Set([
  "derived_knowledge",
  "skill_candidate",
  "memory_candidate",
  "audit_only",
  "archive"
]);

function normalizeGovernanceOutputType(value: unknown, fallback = "derived_knowledge"): KnowledgeSynthesisOutput["governance_output_type"] {
  return typeof value === "string" && ALLOWED_GOVERNANCE_OUTPUT_TYPES.has(value) ? value as KnowledgeSynthesisOutput["governance_output_type"] : fallback as KnowledgeSynthesisOutput["governance_output_type"];
}

function normalizeKnowledgeType(value: unknown, fallback = "cross_source_pattern"): string {
  return typeof value === "string" && ALLOWED_SYNTHESIS_TYPES.has(value) ? value : fallback;
}

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

function heuristicSynthesize(input: KnowledgeSynthesisInput): KnowledgeSynthesisOutput | null {
  const seenStatements = new Set<string>();
  const usable = input.facts
    .filter((fact) => {
      const normalized = fact.statement.trim().replace(/\s+/g, " ").toLowerCase();
      const source = `${fact.evidence_source_uri ?? ""} ${fact.document_title ?? ""} ${fact.title}`.toLowerCase();
      if (source.includes("verify://") || source.includes("smoke")) {
        return false;
      }
      if (normalized.includes("knowledge governance smoke")) {
        return false;
      }
      if (seenStatements.has(normalized)) {
        return false;
      }
      seenStatements.add(normalized);
      const title = fact.title.trim().toLowerCase();
      const lowValueTitle = ["metadata", "source note", "languages", "uh oh"].includes(title);
      const lowValueStatement =
        normalized.includes("this markdown was generated from") ||
        normalized.includes("you can't perform that action") ||
        normalized.includes("there was an error while loading") ||
        normalized.startsWith("- source:") ||
        normalized.includes("@article") ||
        normalized.includes("@misc") ||
        normalized.includes("curl -") ||
        normalized.includes("autotokenizer.from_pretrained") ||
        normalized.includes("open-source models -") ||
        /[🔥]{2,}/u.test(fact.statement) ||
        normalized.length < 80;
      return !lowValueTitle && !lowValueStatement;
    })
    .slice(0, 8);
  if (usable.length < 2) {
    return null;
  }

  const sourceTitles = Array.from(new Set(usable.map((fact) => fact.document_title ?? fact.evidence_source_uri ?? "unknown source"))).slice(0, 5);
  if (sourceTitles.length < 2) {
    return null;
  }

  const topic = typeof input.metadata?.topic === "string" ? input.metadata.topic : "governed knowledge";
  const title = `Cross-source pattern: ${topic}`;
  const content = [
    `# ${title}`,
    "",
    "## Pattern",
    "",
    "Multiple evidence-backed facts appear to describe a reusable cross-source pattern. This fallback output is only an audit candidate; a model-led governance pass must decide whether it is a principle, rule, boundary condition, or application result.",
    "",
    "## Supporting facts",
    "",
    ...usable.map((fact, index) => `${index + 1}. ${fact.statement}`),
    "",
    "## Evidence sources",
    "",
    ...sourceTitles.map((source, index) => `${index + 1}. ${source}`)
  ].join("\n");

  return {
    provider: "heuristic-synthesis",
    governance_output_type: "audit_only",
    knowledge_type: "cross_source_pattern",
    title,
    content,
    reasoning_summary: `Rules-based fallback detected ${usable.length} non-duplicate evidence-backed facts from ${sourceTitles.length} sources. It is a pattern proposal only, not an accepted derived rule.`,
    confidence_score: 0.64,
    risk_level: "medium",
    recall_state: "audit_only",
    context_assembly_state: "audit_only"
  };
}

export class KnowledgeModelWorker {
  async analyze(input: KnowledgeModelInput): Promise<KnowledgeModelOutput> {
    const endpoint = process.env.KNOWLEDGE_MODEL_ENDPOINT?.trim();
    if (!endpoint) {
      return heuristicAnalyze(input);
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          task: "knowledge_governance_analyze",
          input
        })
      });
      if (!response.ok) {
        return heuristicAnalyze(input);
      }

      const payload = (await response.json()) as HttpModelResponse;
      return {
        provider: typeof payload.provider === "string" ? payload.provider : "http-model",
        entity_name: typeof payload.entity_name === "string" ? payload.entity_name : heuristicAnalyze(input).entity_name,
        entity_type: typeof payload.entity_type === "string" ? payload.entity_type : heuristicAnalyze(input).entity_type,
        aliases: Array.isArray(payload.aliases) ? payload.aliases.filter((item): item is string => typeof item === "string") : heuristicAnalyze(input).aliases,
        summary: typeof payload.summary === "string" ? payload.summary : heuristicAnalyze(input).summary,
        confidence_delta: typeof payload.confidence_delta === "number" ? payload.confidence_delta : heuristicAnalyze(input).confidence_delta,
        review_reason: typeof payload.review_reason === "string" ? payload.review_reason : heuristicAnalyze(input).review_reason
      };
    } catch {
      return heuristicAnalyze(input);
    }
  }

  async synthesize(input: KnowledgeSynthesisInput): Promise<KnowledgeSynthesisOutput | null> {
    const endpoint = process.env.KNOWLEDGE_MODEL_ENDPOINT?.trim();
    if (!endpoint) {
      return process.env.KNOWLEDGE_HEURISTIC_SYNTHESIS_ENABLED === "1" ? heuristicSynthesize(input) : null;
    }
    const fallback = process.env.KNOWLEDGE_HEURISTIC_SYNTHESIS_ENABLED === "1" ? heuristicSynthesize(input) : null;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          task: "knowledge_governance_synthesize",
          contract: {
            goal: "derive reusable abstract knowledge from evidence-backed facts; do not summarize unrelated documents",
            allowed_knowledge_types: [...ALLOWED_SYNTHESIS_TYPES],
            allowed_governance_output_types: [...ALLOWED_GOVERNANCE_OUTPUT_TYPES],
            output_policy: {
              derived_knowledge_is_primary_recall_object: true,
              facts_are_evidence_only: true,
              route_execution_experience_to_skill_candidate: true,
              route_user_project_environment_preferences_to_memory_candidate: true,
              keep_weak_or_uncertain_links_audit_only: true,
              allow_knowledge_islands_when_relation_is_weak: true,
              require_evidence_chain: true,
              reject_if_topic_mixed: true,
              reject_if_only_tutorial_toc_citation_install_or_metadata: true,
              use_active_recall_only_for_high_confidence_low_risk_model_outputs: true
            },
            required_output_fields: [
              "provider",
              "governance_output_type",
              "knowledge_type",
              "title",
              "content",
              "reasoning_summary",
              "confidence_score",
              "risk_level",
              "recall_state",
              "context_assembly_state"
            ]
          },
          input
        })
      });
      if (!response.ok) {
        return fallback;
      }

      const payload = (await response.json()) as HttpModelResponse;
      if (typeof payload.title !== "string" || typeof payload.content !== "string" || typeof payload.reasoning_summary !== "string") {
        return fallback;
      }

      const riskLevel =
        payload.risk_level === "low" || payload.risk_level === "medium" || payload.risk_level === "high" || payload.risk_level === "critical"
          ? payload.risk_level
          : fallback?.risk_level ?? "medium";

      return {
        provider: typeof payload.provider === "string" ? payload.provider : "http-model",
        governance_output_type: normalizeGovernanceOutputType(payload.governance_output_type, fallback?.governance_output_type ?? "derived_knowledge"),
        knowledge_type: normalizeKnowledgeType(payload.knowledge_type, fallback?.knowledge_type ?? "cross_source_pattern"),
        title: payload.title,
        content: payload.content,
        reasoning_summary: payload.reasoning_summary,
        confidence_score: typeof payload.confidence_score === "number" ? Math.max(0, Math.min(0.99, payload.confidence_score)) : fallback?.confidence_score ?? 0.65,
        risk_level: riskLevel,
        recall_state: payload.recall_state === "active" || payload.recall_state === "inactive" || payload.recall_state === "audit_only" ? payload.recall_state : fallback?.recall_state,
        context_assembly_state:
          payload.context_assembly_state === "active" || payload.context_assembly_state === "inactive" || payload.context_assembly_state === "audit_only"
            ? payload.context_assembly_state
            : fallback?.context_assembly_state
      };
    } catch {
      return fallback;
    }
  }
}
