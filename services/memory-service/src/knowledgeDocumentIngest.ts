import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createKnowledgeContextBundle,
  createKnowledgeEvidence,
  createOrResolveKnowledgeDocument,
  createOrResolveKnowledgeSection,
  updateKnowledgeDocumentReviewState
} from "@super-agent/db";
import type { CandidateRanker } from "./candidateRanker.js";
import { handleCandidateIngress } from "./candidateIngress.js";
import type { MemoryExtractor } from "./memoryExtractor.js";
import type { MemoryRouter } from "./memoryRouter.js";
import type { RuleBuilder } from "./ruleBuilder.js";
import { runKnowledgeGovernance } from "./knowledgeGovernance.js";
import { convertWithMarkItDown } from "./markdownConversion.js";
import { createFrozenHttpError } from "./errors.js";
import { embedKnowledgePassages, getEmbeddingConfig } from "./embeddingProvider.js";
import { ensureMilvusKnowledgeCollection, milvusVectorEngineName, upsertMilvusSectionEmbeddings } from "./milvusVectorStore.js";
import type { SkillBuilder } from "./skillBuilder.js";

type KnowledgeDocumentIngestRequest = {
  task_request_id: string;
  task_step_id?: string;
  source_type: "local_file" | "inline_text" | "markdown_file" | "markdown_text" | "markitdown_file" | "markitdown_url";
  file_path?: string;
  source_uri?: string;
  title?: string;
  content?: string;
  memory_domain?: string;
  language?: string;
  author?: string;
  theme?: string;
  source_candidate_id?: string;
  source_kind?: string;
  expected_signals?: string[];
  markdown_converter?: string;
  sectioning_mode?: "auto" | "markdown" | "paragraph";
  max_section_chars?: number;
  promote_to_candidates?: boolean;
  trigger_governance?: boolean;
  artifact_tag?: string;
  fact_type?: string;
  verification_status?: string;
  fingerprint?: string;
  fingerprint_status?: "matched" | "matched_or_na" | "mismatch" | "unknown";
};

type SectionDraft = {
  sectionKey: string;
  title: string;
  content: string;
  summary: string;
  ordinal: number;
};

type DocumentQualityResult = {
  accepted: boolean;
  reason: string | null;
  usefulBodyCharCount: number;
  substantiveLineCount: number;
  shortSectionCount: number;
  relevanceSignalCount: number;
  relevanceMatchedSignals: string[];
};

function normalizeText(input: string): string {
  return input.replace(/\r\n/g, "\n").trim();
}

function contentHash(input: string): string {
  return createHash("sha256").update(normalizeText(input)).digest("hex");
}

function defaultKnowledgeSourceRoot(): string {
  return process.env.KNOWLEDGE_SOURCE_ROOT || "D:\\workspace\\outputs\\knowledge-sources";
}

function safePathPart(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "knowledge-source";
}

function vectorIndexEnabled(): boolean {
  return process.env.KNOWLEDGE_VECTOR_INDEX_ENABLED === "1";
}

function currentVectorEngineName(): string {
  return vectorIndexEnabled() ? milvusVectorEngineName() : "disabled";
}

async function writeMarkdownSourceFile(input: {
  documentId: string;
  title: string;
  content: string;
}): Promise<string> {
  const documentDir = path.join(defaultKnowledgeSourceRoot(), `${safePathPart(input.title)}-${input.documentId}`);
  await mkdir(documentDir, { recursive: true });
  const markdownPath = path.join(documentDir, "source.md");
  await writeFile(markdownPath, `${normalizeText(input.content)}\n`, "utf8");
  return markdownPath;
}

function toSummary(input: string, maxLength = 220): string {
  const compact = normalizeText(input).replace(/\s+/g, " ");
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 3)}...`;
}

function chunkParagraphs(text: string, maxSectionChars: number, titlePrefix: string): SectionDraft[] {
  const paragraphs = normalizeText(text)
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  const chunks: SectionDraft[] = [];
  let current = "";

  function pushChunk() {
    if (!current.trim()) {
      return;
    }
    const ordinal = chunks.length;
    const title = ordinal === 0 ? titlePrefix : `${titlePrefix} (part ${ordinal + 1})`;
    chunks.push({
      sectionKey: `section-${ordinal + 1}`,
      title,
      content: current.trim(),
      summary: toSummary(current),
      ordinal
    });
    current = "";
  }

  for (const paragraph of paragraphs) {
    const nextValue = current ? `${current}\n\n${paragraph}` : paragraph;
    if (nextValue.length > maxSectionChars && current) {
      pushChunk();
      current = paragraph;
      continue;
    }
    if (paragraph.length > maxSectionChars) {
      pushChunk();
      let remaining = paragraph;
      while (remaining.length > maxSectionChars) {
        const slice = remaining.slice(0, maxSectionChars);
        chunks.push({
          sectionKey: `section-${chunks.length + 1}`,
          title: `${titlePrefix} (part ${chunks.length + 1})`,
          content: slice.trim(),
          summary: toSummary(slice),
          ordinal: chunks.length
        });
        remaining = remaining.slice(maxSectionChars).trim();
      }
      current = remaining;
      continue;
    }
    current = nextValue;
  }

  pushChunk();
  return chunks;
}

function splitMarkdownSections(text: string, maxSectionChars: number, fallbackTitle: string): SectionDraft[] {
  const lines = normalizeText(text).split("\n");
  const sections: Array<{ heading: string; body: string }> = [];
  let currentHeading = fallbackTitle;
  let currentLines: string[] = [];
  let sawHeading = false;

  function pushCurrent() {
    const body = currentLines.join("\n").trim();
    if (!body) {
      currentLines = [];
      return;
    }
    sections.push({
      heading: currentHeading,
      body
    });
    currentLines = [];
  }

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      sawHeading = true;
      pushCurrent();
      currentHeading = headingMatch[2].trim();
      continue;
    }
    currentLines.push(line);
  }
  pushCurrent();

  if (!sawHeading || sections.length === 0) {
    return chunkParagraphs(text, maxSectionChars, fallbackTitle);
  }

  const drafts: SectionDraft[] = [];
  for (const section of sections) {
    const chunked = chunkParagraphs(section.body, maxSectionChars, section.heading);
    if (chunked.length === 0) {
      continue;
    }
    for (const chunk of chunked) {
      drafts.push({
        ...chunk,
        sectionKey: `section-${drafts.length + 1}`,
        ordinal: drafts.length
      });
    }
  }
  return drafts;
}

function splitSections(input: {
  content: string;
  title: string;
  sectioningMode: "auto" | "markdown" | "paragraph";
  maxSectionChars: number;
}): SectionDraft[] {
  const normalized = normalizeText(input.content);
  if (!normalized) {
    return [];
  }

  const looksLikeMarkdown = /^#{1,6}\s+/m.test(normalized);
  if (input.sectioningMode === "markdown" || (input.sectioningMode === "auto" && looksLikeMarkdown)) {
    return splitMarkdownSections(normalized, input.maxSectionChars, input.title);
  }
  return chunkParagraphs(normalized, input.maxSectionChars, input.title);
}

function shouldRunDocumentQualityGate(sourceType: KnowledgeDocumentIngestRequest["source_type"]): boolean {
  return sourceType === "markdown_file" || sourceType === "markitdown_file" || sourceType === "markitdown_url";
}

const TOPIC_RELEVANCE_PATTERNS: Record<string, RegExp[]> = {
  agent_memory: [
    /\b(agentic\s+memory|agent\s+memory|memory\s+system|long[-\s]?term\s+memory|persistent\s+memory)\b/i,
    /\bmem0\b|\bzep\b|\blangmem\b|\bletta\b/i,
    /智能体记忆|长期记忆|记忆系统|记忆管理|记忆治理/
  ],
  agent_framework: [
    /\b(agent|agents|multi-agent|agentic|workflow|tool\s+calling|function\s+calling)\b/i,
    /\bautogen\b|\bcrewai\b|\bpydantic\s+ai\b|\bagno\b|\bsemantic\s+kernel\b|\bqwen-agent\b|\bagentscope\b/i,
    /智能体|多智能体|工作流|工具调用|函数调用|应用构建/
  ],
  rag: [
    /\b(retrieval[-\s]?augmented\s+generation|rag|retriever|retrieval|rerank|reranker|hybrid\s+search|bm25|rrf|embedding|vector\s+search|query\s+engine|graphrag|node\s+parser|chunk|chunking|splitter)\b/i,
    /检索增强|检索增强生成|向量检索|混合检索|召回|重排|知识库问答|知识库|嵌入|切分|分块|图检索|切块/
  ],
  eval_harness: [
    /\b(eval|evaluation|benchmark|bench|harness|swe-bench|gaia|inspect\s+ai|promptfoo|deepeval|ragas)\b/i,
    /评测|评价|基准|测试集|测试框架|验证集/
  ],
  harness_engineering: [
    /\b(harness\s+engineering|agent\s+harness|ai\s+engineering\s+harness|swe-bench|benchmark|reliability)\b/i,
    /harness|测试脚手架|工程验证|可靠性|基准测试/
  ],
  mcp_tool_use: [
    /\b(model\s+context\s+protocol|mcp|tool\s+use|tools|resources|prompts|json-rpc)\b/i,
    /模型上下文协议|工具|资源|提示词|协议|客户端|服务器/
  ],
  knowledge_graph: [
    /\b(knowledge\s+graph|graph\s+rag|graphrag|ontology|entity|relation|graph\s+search|persistence|checkpoint|thread|stateful)\b/i,
    /知识图谱|图谱|实体|关系|本体|图检索|持久化|检查点|状态/
  ],
  observability: [
    /\b(observability|trace|tracing|telemetry|otel|opentelemetry|langfuse|phoenix|monitoring)\b/i,
    /可观测|追踪|监控|遥测|日志|指标/
  ],
  security: [
    /\b(security|prompt\s+injection|red\s+team|owasp|llm\s+risk|jailbreak|guardrail)\b/i,
    /安全|提示注入|红队|越狱|风险|防护/
  ],
  tool_use: [
    /\b(tool\s+use|tool\s+calling|function\s+calling|function-call|tools|agent\s+tool)\b/i,
    /工具调用|函数调用|工具使用|外部工具/
  ],
  vector_database: [
    /\b(vector\s+database|vector\s+search|hybrid\s+search|dense\s+vector|sparse\s+vector|weaviate|pinecone|qdrant|milvus|embedding)\b/i,
    /向量数据库|向量检索|混合检索|稠密向量|稀疏向量|嵌入/
  ],
  lexical_retrieval: [
    /\b(bm25|lexical\s+retrieval|similarity|elasticsearch|inverted\s+index|term\s+frequency)\b/i,
    /词法检索|倒排索引|相似度|词频/
  ],
  hybrid_retrieval: [
    /\b(hybrid\s+search|reciprocal\s+rank\s+fusion|rrf|bm25|vector\s+search|rank\s+fusion)\b/i,
    /混合检索|融合排序|向量检索|召回融合/
  ]
};

function analyzeRelevance(content: string, signals: string[]): { count: number; matched: string[] } {
  const normalizedContent = normalizeText(content);
  const matched = signals.filter((signal) => {
    const patterns = TOPIC_RELEVANCE_PATTERNS[signal] ?? [];
    return patterns.some((pattern) => pattern.test(normalizedContent));
  });
  return {
    count: matched.length,
    matched
  };
}

function analyzeDocumentQuality(content: string, sections: SectionDraft[], signals: string[] = []): DocumentQualityResult {
  const lines = normalizeText(content).split("\n");
  const contentLines = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^#{1,6}\s+/.test(line))
    .filter((line) => !/^source url:/i.test(line))
    .filter((line) => !/^[-*]\s*(source|url|authors?|published|doi|arxiv):/i.test(line));
  const usefulBodyCharCount = contentLines.join("\n").length;
  const substantiveLineCount = contentLines.filter((line) => line.length >= 80).length;
  const shortSectionCount = sections.filter((section) => section.content.trim().length < 120).length;
  const relevance = analyzeRelevance(content, signals);
  const reason =
    usefulBodyCharCount < 900
      ? `useful_body_too_short:${usefulBodyCharCount}`
      : substantiveLineCount < 3
        ? `too_few_substantive_lines:${substantiveLineCount}`
        : null;
  return {
    accepted: reason === null,
    reason,
    usefulBodyCharCount,
    substantiveLineCount,
    shortSectionCount,
    relevanceSignalCount: relevance.count,
    relevanceMatchedSignals: relevance.matched
  };
}

async function resolveSource(input: KnowledgeDocumentIngestRequest): Promise<{
  title: string;
  sourceUri: string;
  content: string;
  converter?: string;
}> {
  if (input.source_type === "markitdown_file" || input.source_type === "markitdown_url") {
    const converted = await convertWithMarkItDown({
      sourceType: input.source_type,
      filePath: input.file_path,
      sourceUri: input.source_uri
    });
    const sourceUri =
      input.source_type === "markitdown_file"
        ? pathToFileURL(path.resolve(input.file_path!)).toString()
        : input.source_uri!;
    return {
      title: input.title ?? path.basename(input.file_path ?? input.source_uri ?? "markitdown-source"),
      sourceUri,
      content: converted.content,
      converter: converted.converter
    };
  }

  if (input.source_type === "local_file" || input.source_type === "markdown_file") {
    if (!input.file_path) {
      throw createFrozenHttpError(400, `file_path is required when source_type=${input.source_type}`, "BAD_REQUEST");
    }
    const extension = path.extname(input.file_path).toLowerCase();
    if (![".md", ".markdown", ".txt"].includes(extension)) {
      throw createFrozenHttpError(400, `unsupported file extension for ingest: ${extension}`, "BAD_REQUEST");
    }
    const content = await readFile(input.file_path, "utf8");
    return {
      title: input.title?.trim() || path.basename(input.file_path, extension),
      sourceUri: input.source_uri?.trim() || pathToFileURL(input.file_path).toString(),
      content
    };
  }

  if (!input.content || !input.content.trim()) {
    throw createFrozenHttpError(400, `content is required when source_type=${input.source_type}`, "BAD_REQUEST");
  }

  return {
    title: input.title?.trim() || "Inline knowledge document",
    sourceUri: input.source_uri?.trim() || `inline://knowledge-document/${input.task_request_id}`,
    content: input.content
  };
}

export async function ingestKnowledgeDocument(input: {
  tenantId: string;
  scope: string;
  traceId: string;
  body: KnowledgeDocumentIngestRequest;
  extractor: MemoryExtractor;
  ranker: CandidateRanker;
  router: MemoryRouter;
  ruleBuilder: RuleBuilder;
  skillBuilder: SkillBuilder;
}) {
  const source = await resolveSource(input.body);
  const memoryDomain = input.body.memory_domain ?? "knowledge";
  const maxSectionChars = Math.max(400, Math.min(input.body.max_section_chars ?? 1600, 4000));
  const sectioningMode = input.body.sectioning_mode ?? "auto";
  const markdownConverter = input.body.markdown_converter ?? source.converter ?? "markdown-first-v1";
  const requestedPromoteToCandidates = input.body.promote_to_candidates !== false;
  const requestedTriggerGovernance = input.body.trigger_governance !== false;
  const taskStepId = input.body.task_step_id ?? input.body.task_request_id;

  const documentId = await createOrResolveKnowledgeDocument({
    tenantId: input.tenantId,
    scope: input.scope,
    memoryDomain,
    title: source.title,
    sourceType: input.body.source_type,
    sourceUri: source.sourceUri,
    sourceHash: contentHash(source.content),
    markdownContent: normalizeText(source.content),
    markdownContentHash: contentHash(source.content),
    markdownConverter,
    author: input.body.author ?? null,
    language: input.body.language ?? "zh-CN",
    metadata: {
      ingest_source_type: input.body.source_type,
      source_candidate_id: input.body.source_candidate_id,
      source_kind: input.body.source_kind,
      theme: input.body.theme,
      expected_signals: input.body.expected_signals,
      markdown_converter: markdownConverter,
      sectioning_mode: sectioningMode,
      markdown_content_hash: contentHash(source.content)
    },
    traceId: input.traceId
  });

  const markdownContentRef = await writeMarkdownSourceFile({
    documentId,
    title: source.title,
    content: source.content
  });

  await createOrResolveKnowledgeDocument({
    tenantId: input.tenantId,
    scope: input.scope,
    memoryDomain,
    title: source.title,
    sourceType: input.body.source_type,
    sourceUri: source.sourceUri,
    sourceHash: contentHash(source.content),
    markdownContent: normalizeText(source.content),
    markdownContentHash: contentHash(source.content),
    markdownContentRef: markdownContentRef,
    markdownConverter,
    author: input.body.author ?? null,
    language: input.body.language ?? "zh-CN",
    metadata: {
      ingest_source_type: input.body.source_type,
      source_candidate_id: input.body.source_candidate_id,
      source_kind: input.body.source_kind,
      theme: input.body.theme,
      expected_signals: input.body.expected_signals,
      markdown_converter: markdownConverter,
      sectioning_mode: sectioningMode,
      markdown_content_hash: contentHash(source.content),
      markdown_content_ref: markdownContentRef
    },
    traceId: input.traceId
  });

  const sections = splitSections({
    content: source.content,
    title: source.title,
    sectioningMode,
    maxSectionChars
  });
  const expectedSignals = [
    input.body.theme,
    ...(input.body.expected_signals ?? [])
  ].filter((item): item is string => Boolean(item));
  const documentQuality = analyzeDocumentQuality(source.content, sections, [...new Set(expectedSignals)]);
  const governanceFlags = documentQuality.relevanceSignalCount === 0 && expectedSignals.length > 0
    ? [`topic_relevance_missing:${[...new Set(expectedSignals)].join(",")}`]
    : [];
  const qualityGateEnabled = shouldRunDocumentQualityGate(input.body.source_type);
  const acceptedByQualityGate = !qualityGateEnabled || documentQuality.accepted;
  if (!acceptedByQualityGate) {
    await updateKnowledgeDocumentReviewState({
      tenantId: input.tenantId,
      scope: input.scope,
      documentId,
      lifecycleState: "quarantined",
      reviewState: "needs_review",
      metadata: {
        quality_gate: {
          accepted: false,
          reason: documentQuality.reason,
          useful_body_char_count: documentQuality.usefulBodyCharCount,
          substantive_line_count: documentQuality.substantiveLineCount,
          short_section_count: documentQuality.shortSectionCount,
          relevance_signal_count: documentQuality.relevanceSignalCount,
          relevance_matched_signals: documentQuality.relevanceMatchedSignals,
          governance_flags: governanceFlags
        }
      }
    });
  } else if (qualityGateEnabled) {
    await updateKnowledgeDocumentReviewState({
      tenantId: input.tenantId,
      scope: input.scope,
      documentId,
      lifecycleState: "curated",
      reviewState: "auto_accepted",
      metadata: {
        quality_gate: {
          accepted: true,
          reason: null,
          useful_body_char_count: documentQuality.usefulBodyCharCount,
          substantive_line_count: documentQuality.substantiveLineCount,
          short_section_count: documentQuality.shortSectionCount,
          relevance_signal_count: documentQuality.relevanceSignalCount,
          relevance_matched_signals: documentQuality.relevanceMatchedSignals,
          governance_flags: governanceFlags
        }
      }
    });
  }
  const promoteToCandidates = requestedPromoteToCandidates && acceptedByQualityGate;
  const triggerGovernance = requestedTriggerGovernance && acceptedByQualityGate;

  const sectionIds: string[] = [];
  const sectionVectorInputs: Array<{
    sectionId: string;
    documentId: string;
    contentHash: string;
    text: string;
  }> = [];
  const evidenceIds: string[] = [];
  const candidateIds: string[] = [];
  const warnings: string[] = [];
  if (!acceptedByQualityGate) {
    warnings.push(`document_quality_quarantined:${documentQuality.reason}`);
  }

  for (const section of sections) {
    const sectionContentHash = contentHash(section.content);
    const sectionId = await createOrResolveKnowledgeSection({
      documentId,
      tenantId: input.tenantId,
      scope: input.scope,
      memoryDomain,
      sectionKey: section.sectionKey,
      ordinal: section.ordinal,
      title: section.title,
      summary: section.summary,
      content: section.content,
      contentHash: sectionContentHash,
      metadata: {
        ingest_source_uri: source.sourceUri,
        ingest_section_key: section.sectionKey
      },
      traceId: input.traceId
    });
    sectionIds.push(sectionId);
    sectionVectorInputs.push({
      sectionId,
      documentId,
      contentHash: sectionContentHash,
      text: [
        source.title,
        section.title,
        section.summary,
        section.content
      ].join("\n")
    });

    const evidenceId = await createKnowledgeEvidence({
      tenantId: input.tenantId,
      scope: input.scope,
      memoryDomain,
      evidenceType: "document_section",
      sourceType: input.body.source_type,
      sourceUri: `${source.sourceUri}#${section.sectionKey}`,
      rawRef: sectionId,
      contentExcerpt: section.summary,
      contentHash: contentHash(section.content),
      metadata: {
        document_id: documentId,
        section_id: sectionId,
        section_title: section.title
      },
      traceId: input.traceId
    });
    evidenceIds.push(evidenceId);

    if (!promoteToCandidates) {
      continue;
    }

    const candidateResponse = await handleCandidateIngress({
      tenantId: input.tenantId,
      scope: input.scope,
      traceId: `${input.traceId}-section-${section.ordinal + 1}`,
      body: {
        task_request_id: input.body.task_request_id,
        task_step_id: taskStepId,
        source_type: "knowledge_document_section",
        source_ref: `${source.sourceUri}#${section.sectionKey}`,
        artifact_tag: input.body.artifact_tag ?? "document_fact",
        verification_status: input.body.verification_status ?? "verified",
        side_effect_class: "read_only",
        fingerprint: input.body.fingerprint,
        fingerprint_status: input.body.fingerprint_status ?? "matched_or_na",
        candidate_payload: {
          fact_type: input.body.fact_type ?? "document_section",
          title: section.title,
          content: section.content,
          statement: section.content,
          document_id: documentId,
          document_title: source.title,
          section_id: sectionId,
          section_key: section.sectionKey,
          evidence_id: evidenceId,
          memory_domain: memoryDomain
        }
      },
      extractor: input.extractor,
      ranker: input.ranker,
      router: input.router,
      ruleBuilder: input.ruleBuilder,
      skillBuilder: input.skillBuilder
    });

    candidateIds.push(candidateResponse.candidate_id);
    if (!candidateResponse.accepted) {
      warnings.push(`candidate_routed_non_persistent:${candidateResponse.candidate_id}`);
    }
  }

  if (sectionVectorInputs.length > 0 && vectorIndexEnabled()) {
    try {
      await ensureMilvusKnowledgeCollection();
      const vectors = await embedKnowledgePassages(sectionVectorInputs.map((item) => item.text));
      await upsertMilvusSectionEmbeddings(
        sectionVectorInputs.map((item, index) => ({
          tenantId: input.tenantId,
          scope: input.scope,
          sectionId: item.sectionId,
          documentId: item.documentId,
          contentHash: item.contentHash,
          vector: vectors[index]
        }))
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const embedding = getEmbeddingConfig();
      warnings.push(`milvus_embedding_unavailable:${embedding.engine}:${message.slice(0, 180)}`);
      if (process.env.KNOWLEDGE_EMBEDDING_REQUIRED === "1") {
        throw error;
      }
    }
  } else if (sectionVectorInputs.length > 0) {
    warnings.push("vector_index_disabled");
  }

  const bundleId = await createKnowledgeContextBundle({
    tenantId: input.tenantId,
    scope: input.scope,
    requestRef: input.body.task_request_id,
    bundleType: "document_ingest_summary",
    summary: `Ingested ${source.title} into ${sectionIds.length} sections and ${candidateIds.length} candidates.`,
    facts: [],
    entities: [],
    relations: [],
    evidenceRefs: evidenceIds,
    sectionRefs: sectionIds,
    warnings,
    assemblyTrace: {
      document_id: documentId,
      source_uri: source.sourceUri,
      markdown_content_ref: markdownContentRef,
      markdown_converter: markdownConverter,
      vector_engine: currentVectorEngineName(),
      promote_to_candidates: promoteToCandidates,
      trigger_governance: triggerGovernance,
      quality_gate: {
        enabled: qualityGateEnabled,
        accepted: acceptedByQualityGate,
        reason: documentQuality.reason,
        useful_body_char_count: documentQuality.usefulBodyCharCount,
        substantive_line_count: documentQuality.substantiveLineCount,
        short_section_count: documentQuality.shortSectionCount,
        relevance_signal_count: documentQuality.relevanceSignalCount,
        relevance_matched_signals: documentQuality.relevanceMatchedSignals,
        governance_flags: governanceFlags
      }
    },
    traceId: input.traceId
  });

  let governanceResult: Awaited<ReturnType<typeof runKnowledgeGovernance>> | null = null;
  if (triggerGovernance && candidateIds.length > 0) {
    governanceResult = await runKnowledgeGovernance({
      tenantId: input.tenantId,
      scope: input.scope,
      traceId: `${input.traceId}-governance`,
      body: {
        task_request_id: input.body.task_request_id,
        task_step_id: taskStepId,
        candidate_ids: candidateIds,
        max_items: candidateIds.length,
        include_graph_governance: true
      }
    });
  }

  return {
    document_id: documentId,
    title: source.title,
    source_uri: source.sourceUri,
    markdown_content_ref: markdownContentRef,
    markdown_converter: markdownConverter,
    section_count: sectionIds.length,
    section_ids: sectionIds,
    evidence_ids: evidenceIds,
    candidate_ids: candidateIds,
    context_bundle_id: bundleId,
    governance: governanceResult
      ? {
          job_id: governanceResult.job_id,
          status: governanceResult.status,
          created_fact_ids: governanceResult.created_fact_ids,
          created_entity_ids: governanceResult.created_entity_ids,
          created_relation_ids: governanceResult.created_relation_ids,
          context_bundle_id: governanceResult.context_bundle_id
        }
      : null,
    warnings
  };
}
