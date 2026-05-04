import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  createKnowledgeCandidateLink,
  createKnowledgeContextBundle,
  createGovernanceCleaningLog,
  createGovernanceDecision,
  createOrResolveKnowledgeDocument,
  createOrResolveKnowledgeSection,
  createKnowledgeEvidence,
  createKnowledgeFact,
  createKnowledgeGovernanceJob,
  createKnowledgeRelation,
  createKnowledgeReviewQueueItem,
  createOrResolveKnowledgeEntity,
  createSynthesizedKnowledge,
  finalizeKnowledgeGovernanceJob,
  getKnowledgeGovernanceJobById,
  linkSynthesizedKnowledgeEvidence,
  listGovernableKnowledgeDocuments,
  listGovernableMemoryCandidates,
  markKnowledgeGovernanceJobRunning,
  querySynthesisFactEvidence,
  purgeKnowledgeIntermediateArtifacts,
  updateKnowledgeDocumentMarkdownGovernance,
  upsertRecallSurfaceState
} from "@super-agent/db";
import { KnowledgeModelWorker, type KnowledgeSynthesisInput } from "./knowledgeModelWorker.js";

type KnowledgeGovernanceJobCreateRequest = {
  job_type: string;
  trigger_type: string;
  trigger_ref?: string;
  target_object_type?: string;
  target_object_ids?: string[];
  priority?: number;
  payload?: Record<string, unknown>;
};

type KnowledgeGovernanceRunRequest = {
  task_request_id: string;
  task_step_id?: string;
  candidate_ids?: string[];
  run_modes?: string[];
  max_items?: number;
  include_graph_governance?: boolean;
  include_summary_rebuild?: boolean;
  include_resident_rebuild?: boolean;
  include_staleness_scan?: boolean;
};

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function contentHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function hasRunMode(input: KnowledgeGovernanceRunRequest, mode: string): boolean {
  return !input.run_modes?.length || input.run_modes.includes(mode);
}

function hasExplicitRunMode(input: KnowledgeGovernanceRunRequest, mode: string): boolean {
  return Array.isArray(input.run_modes) && input.run_modes.includes(mode);
}

function cleanCanonicalMarkdown(content: string): {
  cleaned: string;
  removed: Array<{ line: number; reason: string; text: string }>;
  keptLineCount: number;
} {
  const removed: Array<{ line: number; reason: string; text: string }> = [];
  const boilerplatePatterns: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /^(skip to content|table of contents|on this page|edit this page)$/i, reason: "navigation_boilerplate" },
    { pattern: /^(previous|next|back to top|copyright|all rights reserved)$/i, reason: "navigation_footer" },
    { pattern: /^(sign in|sign up|subscribe|newsletter|advertisement|cookie)/i, reason: "non_knowledge_boilerplate" },
    { pattern: /^source url:\s*$/i, reason: "empty_source_marker" }
  ];
  const kept: string[] = [];
  const seenDenseLines = new Set<string>();

  content.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    const matched = boilerplatePatterns.find((item) => item.pattern.test(trimmed));
    if (matched) {
      removed.push({ line: index + 1, reason: matched.reason, text: trimmed.slice(0, 180) });
      return;
    }

    const denseKey = trimmed.toLowerCase();
    if (denseKey.length > 40 && seenDenseLines.has(denseKey)) {
      removed.push({ line: index + 1, reason: "duplicate_line", text: trimmed.slice(0, 180) });
      return;
    }
    if (denseKey.length > 40) {
      seenDenseLines.add(denseKey);
    }
    kept.push(line);
  });

  const cleaned = kept.join("\n").replace(/\n{4,}/g, "\n\n\n").trim() + "\n";
  return {
    cleaned,
    removed,
    keptLineCount: kept.filter((line) => line.trim().length > 0).length
  };
}

function buildSynthesisInput(rows: Record<string, unknown>[]): KnowledgeSynthesisInput | null {
  const topicKeywords: Array<{ topic: string; pattern: RegExp }> = [
    { topic: "memory_governance", pattern: /\b(memory|persistent|long-term|governance|forgetting|consolidation|reconsolidation|poisoned|authorization)\b/i },
    { topic: "rag_retrieval", pattern: /\b(rag|retrieval|grounding|evidence|vector|bm25|hybrid|rerank|graphrag)\b/i },
    { topic: "agent_workflow", pattern: /\b(agent|workflow|tool|planning|orchestration|autonomous)\b/i },
    { topic: "evaluation", pattern: /\b(evaluation|benchmark|judge|accuracy|metric|eval)\b/i }
  ];
  const topicFor = (row: Record<string, unknown>): string | null => {
    const text = `${row.fact_title ?? ""}\n${row.fact_statement ?? ""}\n${row.evidence_source_uri ?? ""}`.toLowerCase();
    return topicKeywords.find((item) => item.pattern.test(text))?.topic ?? null;
  };
  const seenStatements = new Set<string>();
  const filtered = rows
    .filter((row) => {
      if (typeof row.fact_id !== "string" || typeof row.fact_statement !== "string" || typeof row.evidence_id !== "string") {
        return false;
      }
      const normalized = normalizeText(row.fact_statement);
      const source = normalizeText(`${row.evidence_source_uri ?? ""} ${row.document_title ?? ""} ${row.fact_title ?? ""}`);
      if (source.includes("verify://") || source.includes("smoke") || normalized.includes("knowledge governance smoke")) {
        return false;
      }
      if (seenStatements.has(normalized)) {
        return false;
      }
      seenStatements.add(normalized);
      const title = normalizeText(String(row.fact_title ?? ""));
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
        /[🔥]{2,}/u.test(String(row.fact_statement)) ||
        normalized.length < 80;
      return !lowValueTitle && !lowValueStatement && topicFor(row) !== null;
    });
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of filtered) {
    const topic = topicFor(row);
    if (!topic) {
      continue;
    }
    grouped.set(topic, [...(grouped.get(topic) ?? []), row]);
  }
  const [topic, usable = []] = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  if (usable.length < 2) {
    return null;
  }
  const selected = usable.slice(0, 8);
  const sourceCount = new Set(selected.map((row) => String(row.document_id ?? row.evidence_source_uri ?? ""))).size;
  if (sourceCount < 2) {
    return null;
  }

  return {
    synthesis_type: "cross_source_pattern",
    facts: selected.map((row) => ({
      fact_id: String(row.fact_id),
      title: String(row.fact_title ?? "Untitled fact"),
      statement: String(row.fact_statement),
      evidence_id: String(row.evidence_id),
      evidence_source_uri: typeof row.evidence_source_uri === "string" ? row.evidence_source_uri : null,
      document_title: typeof row.document_title === "string" ? row.document_title : null
    })),
    metadata: {
      evidence_bound: true,
      source: "knowledge_governance",
      topic,
      routing_policy: {
        derived_knowledge: "facts, concepts, principles, relations, boundaries, conflicts, and supersession decisions",
        skill_candidate: "reusable execution procedures, troubleshooting steps, coding workflows, and tool operation experience",
        memory_candidate: "stable user preferences, project constraints, machine environment facts, and long-term decisions",
        audit_only: "weakly related, uncertain, low-confidence, or insufficiently connected candidates",
        archive: "low-value, stale, invalid, duplicate, or superseded content"
      },
      relation_boundary_policy: {
        allow_islands: true,
        do_not_force_weak_relations: true,
        require_governance_meaning_for_active_relations: true
      }
    }
  };
}

function readCandidatePayloadField(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function readStringField(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function conciseFactStatement(input: string): string {
  const normalized = input.trim().replace(/\s+/g, " ");
  const sentences = normalized
    .split(/(?<=[.!?。！？])\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 24);
  const first = sentences[0] ?? normalized;
  return first.length <= 420 ? first : `${first.slice(0, 417)}...`;
}

function inferProjection(candidate: Record<string, unknown>): {
  accepted: boolean;
  memoryDomain?: string;
  factKind?: string;
  factSubtype?: string;
  title?: string;
  statement?: string;
  needsReview?: boolean;
  reviewReason?: string;
} {
  const artifactTag = typeof candidate.artifact_tag === "string" ? candidate.artifact_tag : "";
  const verificationStatus = typeof candidate.verification_status === "string" ? candidate.verification_status : "";
  const payload = (candidate.candidate_payload ?? {}) as Record<string, unknown>;
  const factType = typeof payload.fact_type === "string" ? payload.fact_type : "";
  const title = readCandidatePayloadField(payload, ["title", "name"]);
  const statement = readCandidatePayloadField(payload, ["statement", "content", "summary"]);

  if (!title || !statement) {
    return { accepted: false };
  }

  if (verificationStatus !== "verified" && verificationStatus !== "verified_fix") {
    return { accepted: false };
  }

  if (factType === "design_constraint" || artifactTag === "constraint_fact") {
    return {
      accepted: true,
      memoryDomain: "rule",
      factKind: "rule_fact",
      factSubtype: factType || artifactTag,
      title,
      statement,
      needsReview: true,
      reviewReason: "high_impact_rule"
    };
  }

  if (factType === "design_progress") {
    return {
      accepted: true,
      memoryDomain: "knowledge",
      factKind: "knowledge_fact",
      factSubtype: factType,
      title,
      statement
    };
  }

  if (artifactTag.includes("workflow_tag") || verificationStatus === "verified_fix") {
    return {
      accepted: true,
      memoryDomain: "skill",
      factKind: "skill_fact",
      factSubtype: artifactTag || "workflow",
      title,
      statement,
      needsReview: true,
      reviewReason: "manual_hold"
    };
  }

  if (artifactTag.includes("preference")) {
    return {
      accepted: true,
      memoryDomain: "profile",
      factKind: "memory_fact",
      factSubtype: artifactTag || factType || "preference",
      title,
      statement
    };
  }

  if (factType === "document_section") {
    return {
      accepted: true,
      memoryDomain: "knowledge",
      factKind: "knowledge_fact",
      factSubtype: factType,
      title,
      statement: conciseFactStatement(statement),
      needsReview: false
    };
  }

  return {
    accepted: true,
    memoryDomain: "knowledge",
    factKind: "knowledge_fact",
    factSubtype: factType || artifactTag || "candidate_fact",
    title,
    statement,
    needsReview: false
  };
}

export async function createKnowledgeGovernanceJobRecord(input: {
  tenantId: string;
  scope: string;
  traceId: string;
  body: KnowledgeGovernanceJobCreateRequest;
}) {
  const jobId = await createKnowledgeGovernanceJob({
    tenantId: input.tenantId,
    scope: input.scope,
    jobType: input.body.job_type,
    triggerType: input.body.trigger_type,
    triggerRef: input.body.trigger_ref ?? null,
    targetObjectType: input.body.target_object_type ?? null,
    targetObjectIds: input.body.target_object_ids ?? [],
    priority: input.body.priority ?? 50,
    requestedBy: "api",
    payload: input.body.payload ?? {},
    traceId: input.traceId
  });

  const record = await getKnowledgeGovernanceJobById({
    jobId,
    tenantId: input.tenantId,
    scope: input.scope
  });

  return {
    job_id: jobId,
    status: typeof record?.run_status === "string" ? record.run_status : "pending",
    queued_at: typeof record?.created_at === "string" ? record.created_at : new Date().toISOString()
  };
}

export async function getKnowledgeGovernanceJobRecord(input: {
  tenantId: string;
  scope: string;
  jobId: string;
}) {
  const record = await getKnowledgeGovernanceJobById({
    tenantId: input.tenantId,
    scope: input.scope,
    jobId: input.jobId
  });
  if (!record) {
    return null;
  }

  return {
    job_id: record.id,
    job_type: record.job_type,
    status: record.run_status,
    decision: (record.result_payload as Record<string, unknown> | null)?.decision ?? null,
    created_objects: (record.result_payload as Record<string, unknown> | null)?.created_objects ?? [],
    updated_objects: (record.result_payload as Record<string, unknown> | null)?.updated_objects ?? [],
    warnings: (record.result_payload as Record<string, unknown> | null)?.warnings ?? [],
    trace: record.result_payload ?? {},
    started_at: record.started_at ?? null,
    finished_at: record.finished_at ?? null
  };
}

export async function runKnowledgeGovernance(input: {
  tenantId: string;
  scope: string;
  traceId: string;
  body: KnowledgeGovernanceRunRequest;
}) {
  const modelWorker = new KnowledgeModelWorker();
  const jobId = await createKnowledgeGovernanceJob({
    tenantId: input.tenantId,
    scope: input.scope,
    jobType: "knowledge_governance_run",
    triggerType: "manual_run",
    triggerRef: input.body.task_request_id,
    targetObjectType: "memory_candidate",
    priority: 60,
    requestedBy: "api",
    payload: {
      task_request_id: input.body.task_request_id,
      task_step_id: input.body.task_step_id ?? null,
      run_modes: input.body.run_modes ?? [],
      candidate_ids: input.body.candidate_ids ?? [],
      max_items: input.body.max_items ?? 20,
      include_graph_governance: input.body.include_graph_governance !== false
    },
    traceId: input.traceId
  });

  await markKnowledgeGovernanceJobRunning({ jobId });

  const warnings: string[] = [];
  const createdDocumentIds: string[] = [];
  const createdSectionIds: string[] = [];
  const createdFactIds: string[] = [];
  const createdEntityIds: string[] = [];
  const createdEvidenceIds: string[] = [];
  const createdRelationIds: string[] = [];
  const reviewQueueItemIds: string[] = [];
  const processedCandidateIds: string[] = [];
  const governanceDecisionIds: string[] = [];
  const cleaningLogIds: string[] = [];
  const synthesizedKnowledgeIds: string[] = [];
  const skillCandidateOutputs: string[] = [];
  const memoryCandidateOutputs: string[] = [];
  const auditOnlyOutputs: string[] = [];
  const archivedOutputs: string[] = [];
  const recallSurfaceStateIds: string[] = [];
  let intermediateArtifactPurge:
    | Awaited<ReturnType<typeof purgeKnowledgeIntermediateArtifacts>>
    | null = null;

  try {
    const candidates = await listGovernableMemoryCandidates({
      tenantId: input.tenantId,
      scope: input.scope,
      candidateIds: input.body.candidate_ids ?? [],
      limit: input.body.max_items ?? 20
    });

    for (const candidate of candidates) {
      const projection = inferProjection(candidate);
      if (!projection.accepted || !projection.memoryDomain || !projection.factKind || !projection.title || !projection.statement) {
        warnings.push(`candidate_skipped:${String(candidate.id)}`);
        continue;
      }

      const payload = (candidate.candidate_payload ?? {}) as Record<string, unknown>;
      const metadata = {
        source_candidate_id: candidate.id,
        source_type: candidate.source_type,
        artifact_tag: candidate.artifact_tag,
        fact_type: payload.fact_type ?? null
      };
      const modelOutput = await modelWorker.analyze({
        memoryDomain: projection.memoryDomain,
        title: projection.title,
        statement: projection.statement,
        artifactTag: String(candidate.artifact_tag ?? ""),
        sourceType: String(candidate.source_type ?? ""),
        metadata
      });

      const reusedDocumentId = readStringField(payload, "document_id");
      const reusedSectionId = readStringField(payload, "section_id");
      const reusedEvidenceId = readStringField(payload, "evidence_id");

      let documentId = reusedDocumentId;
      if (!documentId) {
        documentId = await createOrResolveKnowledgeDocument({
          tenantId: input.tenantId,
          scope: input.scope,
          memoryDomain: projection.memoryDomain,
          title: projection.title,
          sourceType: String(candidate.source_type ?? "memory_candidate"),
          sourceUri: String(candidate.source_ref ?? `memory-candidate://${candidate.id}`),
          sourceHash: normalizeText(String(candidate.source_ref ?? candidate.id)),
          metadata,
          traceId: input.traceId
        });
        createdDocumentIds.push(documentId);
      }

      let sectionId = reusedSectionId;
      if (!sectionId) {
        sectionId = await createOrResolveKnowledgeSection({
          documentId,
          tenantId: input.tenantId,
          scope: input.scope,
          memoryDomain: projection.memoryDomain,
          sectionKey: `candidate-${String(candidate.id)}`,
          ordinal: 0,
          title: projection.title,
          summary: projection.statement.slice(0, 240),
          content: projection.statement,
          contentHash: normalizeText(projection.statement),
          metadata,
          traceId: input.traceId
        });
        createdSectionIds.push(sectionId);
      }

      const documentHasSectionRelationId = await createKnowledgeRelation({
        tenantId: input.tenantId,
        scope: input.scope,
        memoryDomain: projection.memoryDomain,
        relationType: "has_section",
        fromObjectType: "document",
        fromObjectId: documentId,
        toObjectType: "section",
        toObjectId: sectionId,
        statement: `${projection.title} belongs to source document ${documentId}`,
        confidenceScore: 0.95,
        metadata: {
          ...metadata,
          relation_scope: "explicit_evidence_internal"
        },
        traceId: input.traceId
      });
      createdRelationIds.push(documentHasSectionRelationId);

      let evidenceId = reusedEvidenceId;
      if (!evidenceId) {
        evidenceId = await createKnowledgeEvidence({
          tenantId: input.tenantId,
          scope: input.scope,
          memoryDomain: projection.memoryDomain,
          evidenceType: "memory_candidate",
          sourceType: String(candidate.source_type ?? "memory_candidate"),
          sourceUri: String(candidate.source_ref ?? `memory-candidate://${candidate.id}`),
          rawRef: String(candidate.id),
          contentExcerpt: projection.statement.slice(0, 500),
          contentHash: normalizeText(projection.statement),
          metadata,
          traceId: input.traceId
        });
        createdEvidenceIds.push(evidenceId);
      }

      const entityName = modelOutput.entity_name;
      let entityId: string | null = null;
      if (entityName) {
        entityId = await createOrResolveKnowledgeEntity({
          tenantId: input.tenantId,
          scope: input.scope,
          memoryDomain: projection.memoryDomain,
          entityType: modelOutput.entity_type,
          canonicalName: entityName,
          aliases: modelOutput.aliases,
          summary: modelOutput.summary,
          metadata: {
            ...metadata,
            model_provider: modelOutput.provider
          },
          traceId: input.traceId
        });
        createdEntityIds.push(entityId);
      }

      const factId = await createKnowledgeFact({
        tenantId: input.tenantId,
        scope: input.scope,
        memoryDomain: projection.memoryDomain,
        factKind: projection.factKind,
        factSubtype: projection.factSubtype ?? null,
        title: projection.title,
        statement: projection.statement,
        normalizedStatement: normalizeText(projection.statement),
        verificationStatus: String(candidate.verification_status ?? "verified"),
        confidenceScore: Math.max(0.1, Math.min(0.99, (projection.needsReview ? 0.68 : 0.82) + modelOutput.confidence_delta)),
        importance: projection.memoryDomain === "rule" ? 85 : 70,
        metadata: {
          ...metadata,
          model_provider: modelOutput.provider
        },
        traceId: input.traceId
      });
      createdFactIds.push(factId);

      if (entityId) {
        const sectionMentionsEntityRelationId = await createKnowledgeRelation({
          tenantId: input.tenantId,
          scope: input.scope,
          memoryDomain: projection.memoryDomain,
          relationType: "mentions",
          fromObjectType: "section",
          fromObjectId: sectionId,
          toObjectType: "entity",
          toObjectId: entityId,
          statement: `Section ${sectionId} mentions ${entityName}`,
          confidenceScore: 0.8,
          metadata: {
            ...metadata,
            relation_scope: "explicit_evidence_internal"
          },
          traceId: input.traceId
        });
        createdRelationIds.push(sectionMentionsEntityRelationId);

        const aboutRelationId = await createKnowledgeRelation({
          tenantId: input.tenantId,
          scope: input.scope,
          memoryDomain: projection.memoryDomain,
          relationType: "about",
          fromObjectType: "fact",
          fromObjectId: factId,
          toObjectType: "entity",
          toObjectId: entityId,
          statement: `${projection.title} is about ${entityName}`,
          confidenceScore: 0.85,
          metadata,
          traceId: input.traceId
        });
        createdRelationIds.push(aboutRelationId);
      }

      const sectionStatesFactRelationId = await createKnowledgeRelation({
        tenantId: input.tenantId,
        scope: input.scope,
        memoryDomain: projection.memoryDomain,
        relationType: "states",
        fromObjectType: "section",
        fromObjectId: sectionId,
        toObjectType: "fact",
        toObjectId: factId,
        statement: `Section ${sectionId} states fact ${factId}`,
        confidenceScore: 0.86,
        metadata: {
          ...metadata,
          relation_scope: "explicit_evidence_internal"
        },
        traceId: input.traceId
      });
      createdRelationIds.push(sectionStatesFactRelationId);

      const sectionSupportsFactRelationId = await createKnowledgeRelation({
        tenantId: input.tenantId,
        scope: input.scope,
        memoryDomain: projection.memoryDomain,
        relationType: "derived_from",
        fromObjectType: "fact",
        fromObjectId: factId,
        toObjectType: "section",
        toObjectId: sectionId,
        statement: `${projection.title} is derived from section ${sectionId}`,
        confidenceScore: 0.82,
        metadata,
        traceId: input.traceId
      });
      createdRelationIds.push(sectionSupportsFactRelationId);

      const relationId = await createKnowledgeRelation({
        tenantId: input.tenantId,
        scope: input.scope,
        memoryDomain: projection.memoryDomain,
        relationType: "evidenced_by",
        fromObjectType: "fact",
        fromObjectId: factId,
        toObjectType: "evidence",
        toObjectId: evidenceId,
        statement: `${projection.title} is evidenced by ${String(candidate.source_ref ?? candidate.id)}`,
        confidenceScore: 0.9,
        metadata,
        traceId: input.traceId
      });
      createdRelationIds.push(relationId);

      await createKnowledgeCandidateLink({
        tenantId: input.tenantId,
        scope: input.scope,
        candidateId: String(candidate.id),
        targetObjectType: "fact",
        targetObjectId: factId,
        linkRole: "derived_from_candidate",
        metadata,
        traceId: input.traceId
      });

      processedCandidateIds.push(String(candidate.id));

      const effectiveReviewReason = projection.reviewReason ?? modelOutput.review_reason ?? null;
      if (projection.needsReview || effectiveReviewReason) {
        const reviewQueueId = await createKnowledgeReviewQueueItem({
          tenantId: input.tenantId,
          scope: input.scope,
          targetObjectType: "fact",
          targetObjectId: factId,
          reviewReason: effectiveReviewReason ?? "manual_hold",
          priority: projection.memoryDomain === "rule" ? 90 : 70,
          payload: {
            ...metadata,
            model_provider: modelOutput.provider
          },
          traceId: input.traceId
        });
        reviewQueueItemIds.push(reviewQueueId);
      }
    }

    const requestedDocumentIds = asStringArray((input.body as KnowledgeGovernanceRunRequest & { document_ids?: unknown }).document_ids);
    const shouldRunDocumentGovernance =
      hasRunMode(input.body, "batch_governance") ||
      hasRunMode(input.body, "source_cleaning_governance") ||
      hasRunMode(input.body, "object_quality_governance") ||
      hasRunMode(input.body, "library_alignment_governance") ||
      hasRunMode(input.body, "global_governance");

    if (shouldRunDocumentGovernance) {
      const documents = await listGovernableKnowledgeDocuments({
        tenantId: input.tenantId,
        scope: input.scope,
        documentIds: requestedDocumentIds,
        limit: input.body.max_items ?? 20
      });

      for (const document of documents) {
        const documentId = String(document.id);
        const markdownContent = typeof document.markdown_content === "string" ? document.markdown_content : "";
        const metadata = (document.metadata ?? {}) as Record<string, unknown>;
        const governanceFlags = asStringArray(metadata.governance_flags);

        if (!markdownContent.trim()) {
          const reviewQueueId = await createKnowledgeReviewQueueItem({
            tenantId: input.tenantId,
            scope: input.scope,
            targetObjectType: "document",
            targetObjectId: documentId,
            reviewReason: "missing_canonical_markdown",
            priority: 80,
            payload: {
              document_title: document.title,
              source_uri: document.source_uri
            },
            traceId: input.traceId
          });
          reviewQueueItemIds.push(reviewQueueId);
          governanceDecisionIds.push(
            await createGovernanceDecision({
              tenantId: input.tenantId,
              scope: input.scope,
              governanceJobId: jobId,
              governanceType: "object_quality_governance",
              targetObjectType: "document",
              targetObjectId: documentId,
              decision: "needs_human_review",
              confidenceScore: 0.9,
              riskLevel: "medium",
              reason: "Document has no canonical Markdown content.",
              beforeState: {
                lifecycle_state: document.lifecycle_state,
                review_state: document.review_state
              },
              afterState: {
                review_queue_item_id: reviewQueueId
              },
              traceId: input.traceId
            })
          );
          continue;
        }

        const cleaned = cleanCanonicalMarkdown(markdownContent);
        const beforeHash = typeof document.markdown_content_hash === "string" ? document.markdown_content_hash : contentHash(markdownContent);
        const afterHash = contentHash(cleaned.cleaned);
        const changed = beforeHash !== afterHash;

        if (changed) {
          await updateKnowledgeDocumentMarkdownGovernance({
            tenantId: input.tenantId,
            scope: input.scope,
            documentId,
            markdownContent: cleaned.cleaned,
            markdownContentHash: afterHash,
            lifecycleState: "curated",
            reviewState: governanceFlags.length ? "needs_review" : "model_accepted",
            metadata: {
              governance: {
                last_cleaned_by_job_id: jobId,
                cleaning_ruleset_version: "source-cleaning-rules-v1",
                removed_line_count: cleaned.removed.length
              }
            }
          });

          const markdownRef = typeof document.markdown_content_ref === "string" ? document.markdown_content_ref : "";
          if (markdownRef) {
            try {
              await writeFile(markdownRef, cleaned.cleaned, "utf8");
            } catch (error) {
              warnings.push(`markdown_file_update_failed:${documentId}:${error instanceof Error ? error.message : String(error)}`);
            }
          }

          cleaningLogIds.push(
            await createGovernanceCleaningLog({
              tenantId: input.tenantId,
              scope: input.scope,
              governanceJobId: jobId,
              documentId,
              cleaningType: "source_cleaning_governance",
              beforeHash,
              afterHash,
              removedSectionsSummary: cleaned.removed,
              removedLineCount: cleaned.removed.length,
              keptLineCount: cleaned.keptLineCount,
              traceId: input.traceId
            })
          );

          governanceDecisionIds.push(
            await createGovernanceDecision({
              tenantId: input.tenantId,
              scope: input.scope,
              governanceJobId: jobId,
              governanceType: "source_cleaning_governance",
              targetObjectType: "document",
              targetObjectId: documentId,
              decision: governanceFlags.length ? "needs_review" : "model_accepted",
              confidenceScore: 0.88,
              riskLevel: governanceFlags.length ? "medium" : "low",
              reason: `Removed ${cleaned.removed.length} boilerplate or duplicate Markdown lines from canonical source.`,
              beforeState: {
                markdown_content_hash: beforeHash,
                lifecycle_state: document.lifecycle_state,
                review_state: document.review_state
              },
              afterState: {
                markdown_content_hash: afterHash,
                lifecycle_state: "curated",
                review_state: governanceFlags.length ? "needs_review" : "model_accepted"
              },
              traceId: input.traceId
            })
          );
        }

        recallSurfaceStateIds.push(
          await upsertRecallSurfaceState({
            tenantId: input.tenantId,
            scope: input.scope,
            objectType: "document",
            objectId: documentId,
            recallState: "active",
            contextAssemblyState: "active",
            governanceJobId: jobId,
            reason: changed ? "Document canonical Markdown cleaned and remains active." : "Document remains active after governance scan.",
            metadata: {
              governance_flags: governanceFlags
            },
            traceId: input.traceId
          })
        );
      }
    }

    for (const object of [
      ...createdFactIds.map((id) => ({ type: "fact", id })),
      ...createdRelationIds.map((id) => ({ type: "relation", id })),
      ...createdEvidenceIds.map((id) => ({ type: "evidence", id })),
      ...createdSectionIds.map((id) => ({ type: "section", id }))
    ]) {
      recallSurfaceStateIds.push(
        await upsertRecallSurfaceState({
          tenantId: input.tenantId,
          scope: input.scope,
          objectType: object.type,
          objectId: object.id,
          recallState: "audit_only",
          contextAssemblyState: "audit_only",
          governanceJobId: jobId,
          reason: "Atomic evidence object is retained for provenance and governance, not default recall.",
          traceId: input.traceId
        })
      );
    }

    if (input.body.include_graph_governance !== false && hasRunMode(input.body, "cross_source_synthesis_governance")) {
      const synthesisRows = await querySynthesisFactEvidence({
        tenantId: input.tenantId,
        scope: input.scope,
        documentIds: requestedDocumentIds,
        limit: input.body.max_items ?? 20
      });
      const synthesisInput = buildSynthesisInput(synthesisRows);
      const synthesis = synthesisInput ? await modelWorker.synthesize(synthesisInput) : null;

      if (synthesis && synthesisInput) {
        const sourceObjectIds = synthesisInput.facts.map((fact) => fact.fact_id);
        const evidenceIds = Array.from(new Set(synthesisInput.facts.map((fact) => fact.evidence_id)));
        const governanceOutputType = synthesis.governance_output_type ?? "derived_knowledge";
        if (governanceOutputType !== "derived_knowledge") {
          const outputRef = `${governanceOutputType}:${normalizeText(synthesis.title).slice(0, 80)}`;
          if (governanceOutputType === "skill_candidate") {
            skillCandidateOutputs.push(outputRef);
          } else if (governanceOutputType === "memory_candidate") {
            memoryCandidateOutputs.push(outputRef);
          } else if (governanceOutputType === "archive") {
            archivedOutputs.push(outputRef);
          } else {
            auditOnlyOutputs.push(outputRef);
          }
          governanceDecisionIds.push(
            await createGovernanceDecision({
              tenantId: input.tenantId,
              scope: input.scope,
              governanceJobId: jobId,
              governanceType: "governance_output_routing",
              targetObjectType: governanceOutputType,
              targetObjectId: null,
              decision: governanceOutputType,
              confidenceScore: synthesis.confidence_score,
              riskLevel: synthesis.risk_level,
              evidenceRefs: evidenceIds,
              reason: synthesis.reasoning_summary,
              afterState: {
                governance_output_type: governanceOutputType,
                knowledge_type: synthesis.knowledge_type,
                title: synthesis.title,
                content: synthesis.content,
                source_object_ids: sourceObjectIds,
                evidence_ids: evidenceIds,
                recall_state: "audit_only",
                context_assembly_state: "audit_only"
              },
              modelName: synthesis.provider,
              promptVersion: "knowledge-governance-routing-v1",
              traceId: input.traceId
            })
          );
          warnings.push(`synthesis_routed:${governanceOutputType}`);
        } else {
        const synthesisNeedsReview =
          synthesis.provider === "heuristic-synthesis" ||
          synthesis.risk_level === "high" ||
          synthesis.risk_level === "critical" ||
          synthesis.confidence_score < 0.85;
        const synthesizedRecallState = synthesis.recall_state ?? (synthesisNeedsReview ? "audit_only" : "active");
        const synthesizedContextState = synthesis.context_assembly_state ?? (synthesisNeedsReview ? "audit_only" : "active");
        const synthesized = await createSynthesizedKnowledge({
          tenantId: input.tenantId,
          scope: input.scope,
          memoryDomain: "knowledge",
          knowledgeType: synthesis.knowledge_type,
          title: synthesis.title,
          content: synthesis.content,
          normalizedContent: normalizeText(synthesis.content),
          lifecycleState: synthesisNeedsReview ? "candidate" : "curated",
          reviewState: synthesisNeedsReview ? "needs_human_review" : "model_accepted",
          recallState: synthesizedRecallState,
          sourceObjectIds,
          evidenceIds,
          reasoningSummary: synthesis.reasoning_summary,
          confidenceScore: synthesis.confidence_score,
          riskLevel: synthesis.risk_level,
          governanceJobId: jobId,
          metadata: {
            synthesis_provider: synthesis.provider,
            governance_output_type: governanceOutputType,
            evidence_bound: true,
            abstraction_layer: "derived_knowledge",
            requires_model_confirmation: synthesis.provider === "heuristic-synthesis"
          },
          traceId: input.traceId
        });
        synthesizedKnowledgeIds.push(synthesized.id);

        if (synthesisNeedsReview) {
          reviewQueueItemIds.push(
            await createKnowledgeReviewQueueItem({
              tenantId: input.tenantId,
              scope: input.scope,
              targetObjectType: "synthesized_knowledge",
              targetObjectId: synthesized.id,
              reviewReason: "synthesized_knowledge_high_risk",
              priority: 85,
              payload: {
                synthesized_knowledge_id: synthesized.id,
                knowledge_type: synthesis.knowledge_type,
                risk_level: synthesis.risk_level,
                confidence_score: synthesis.confidence_score,
                evidence_ids: evidenceIds
              },
              traceId: input.traceId
            })
          );
        }

        for (const fact of synthesisInput.facts) {
          await linkSynthesizedKnowledgeEvidence({
            tenantId: input.tenantId,
            scope: input.scope,
            synthesizedKnowledgeId: synthesized.id,
            evidenceId: fact.evidence_id,
            sourceObjectType: "fact",
            sourceObjectId: fact.fact_id,
            supportRole: "supports",
            traceId: input.traceId
          });
        }

        governanceDecisionIds.push(
          await createGovernanceDecision({
            tenantId: input.tenantId,
            scope: input.scope,
            governanceJobId: jobId,
            governanceType: "cross_source_synthesis_governance",
            targetObjectType: "synthesized_knowledge",
            targetObjectId: synthesized.id,
            decision: synthesisNeedsReview ? "needs_human_review" : "model_accepted",
            confidenceScore: synthesis.confidence_score,
            riskLevel: synthesis.risk_level,
            evidenceRefs: evidenceIds,
            reason: synthesis.reasoning_summary,
            afterState: {
              governance_output_type: governanceOutputType,
              knowledge_type: synthesis.knowledge_type,
              recall_state: synthesizedRecallState,
              context_assembly_state: synthesizedContextState,
              existed: synthesized.existed
            },
            modelName: synthesis.provider,
            promptVersion: "knowledge-governance-synthesis-v1",
            traceId: input.traceId
          })
        );

        recallSurfaceStateIds.push(
          await upsertRecallSurfaceState({
            tenantId: input.tenantId,
            scope: input.scope,
            objectType: "synthesized_knowledge",
            objectId: synthesized.id,
            recallState: synthesizedRecallState,
            contextAssemblyState: synthesizedContextState,
            governanceJobId: jobId,
            reason: synthesisNeedsReview
              ? "Abstract synthesized knowledge is kept audit-only until model or human confirmation."
              : "Evidence-bound abstract knowledge confirmed by model-led manual governance run.",
            metadata: {
              knowledge_type: synthesis.knowledge_type,
              governance_output_type: governanceOutputType,
              abstraction_layer: "derived_knowledge"
            },
            traceId: input.traceId
          })
        );
        }
      } else {
        const modelEndpointConfigured = Boolean(process.env.KNOWLEDGE_MODEL_ENDPOINT?.trim());
        const heuristicEnabled = process.env.KNOWLEDGE_HEURISTIC_SYNTHESIS_ENABLED === "1";
        warnings.push(
          synthesisInput
            ? modelEndpointConfigured || heuristicEnabled
              ? "synthesis_skipped:model_rejected_or_invalid_output"
              : "synthesis_skipped:model_not_configured"
            : "synthesis_skipped:not_enough_evidence_bound_facts"
        );
      }
    }

    if (hasExplicitRunMode(input.body, "purge_intermediate_artifacts")) {
      intermediateArtifactPurge = await purgeKnowledgeIntermediateArtifacts({
        tenantId: input.tenantId,
        scope: input.scope,
        traceId: input.traceId
      });
      governanceDecisionIds.push(
        await createGovernanceDecision({
          tenantId: input.tenantId,
          scope: input.scope,
          governanceJobId: jobId,
          governanceType: "intermediate_artifact_governance",
          targetObjectType: "knowledge_intermediate_artifacts",
          targetObjectId: null,
          decision: "purged",
          confidenceScore: 1,
          riskLevel: "low",
          reason: "Facts, entities, and relations are intermediate governance artifacts and are physically purged after synthesized knowledge is linked to evidence.",
          beforeState: {},
          afterState: intermediateArtifactPurge,
          traceId: input.traceId
        })
      );
    }

    const contextBundleId = await createKnowledgeContextBundle({
      tenantId: input.tenantId,
      scope: input.scope,
      requestRef: input.body.task_request_id,
      bundleType: "governance_run_summary",
      summary: `Knowledge governance processed ${processedCandidateIds.length} candidates, created ${createdFactIds.length} facts, cleaned ${cleaningLogIds.length} documents, produced ${synthesizedKnowledgeIds.length} derived knowledge objects, routed ${skillCandidateOutputs.length} skill candidates, and routed ${memoryCandidateOutputs.length} memory candidates.`,
      facts: createdFactIds,
      entities: createdEntityIds,
      relations: createdRelationIds,
      evidenceRefs: createdEvidenceIds,
      sectionRefs: createdSectionIds,
      warnings,
      assemblyTrace: {
        job_id: jobId,
        processed_candidate_ids: processedCandidateIds,
        review_queue_item_ids: reviewQueueItemIds,
        governance_decision_ids: governanceDecisionIds,
        cleaning_log_ids: cleaningLogIds,
        synthesized_knowledge_ids: synthesizedKnowledgeIds,
        skill_candidate_outputs: skillCandidateOutputs,
        memory_candidate_outputs: memoryCandidateOutputs,
        audit_only_outputs: auditOnlyOutputs,
        archived_outputs: archivedOutputs,
        recall_surface_state_ids: recallSurfaceStateIds
      },
      traceId: input.traceId
    });

    const resultPayload = {
      decision: "completed",
      created_objects: [
        ...createdDocumentIds.map((id) => `document:${id}`),
        ...createdSectionIds.map((id) => `section:${id}`),
        ...createdFactIds.map((id) => `fact:${id}`),
        ...createdEntityIds.map((id) => `entity:${id}`),
        ...createdEvidenceIds.map((id) => `evidence:${id}`),
        ...createdRelationIds.map((id) => `relation:${id}`),
        ...synthesizedKnowledgeIds.map((id) => `synthesized_knowledge:${id}`),
        ...skillCandidateOutputs,
        ...memoryCandidateOutputs,
        ...auditOnlyOutputs,
        ...archivedOutputs
      ],
      updated_objects: [
        ...cleaningLogIds.map((id) => `cleaning_log:${id}`),
        ...governanceDecisionIds.map((id) => `governance_decision:${id}`),
        ...recallSurfaceStateIds.map((id) => `recall_surface_state:${id}`)
      ],
      warnings,
      processed_candidate_ids: processedCandidateIds,
      review_queue_item_ids: reviewQueueItemIds,
      governance_decision_ids: governanceDecisionIds,
      cleaning_log_ids: cleaningLogIds,
      synthesized_knowledge_ids: synthesizedKnowledgeIds,
      skill_candidate_outputs: skillCandidateOutputs,
      memory_candidate_outputs: memoryCandidateOutputs,
      audit_only_outputs: auditOnlyOutputs,
      archived_outputs: archivedOutputs,
      recall_surface_state_ids: recallSurfaceStateIds,
      intermediate_artifact_purge: intermediateArtifactPurge,
      context_bundle_id: contextBundleId
    };

    await finalizeKnowledgeGovernanceJob({
      jobId,
      runStatus: "completed",
      resultPayload
    });

    return {
      job_id: jobId,
      status: "completed",
      processed_candidate_count: processedCandidateIds.length,
      created_document_ids: createdDocumentIds,
      created_section_ids: createdSectionIds,
      created_fact_ids: createdFactIds,
      created_entity_ids: createdEntityIds,
      created_evidence_ids: createdEvidenceIds,
      created_relation_ids: createdRelationIds,
      review_queue_item_ids: reviewQueueItemIds,
      governance_decision_ids: governanceDecisionIds,
      cleaning_log_ids: cleaningLogIds,
      synthesized_knowledge_ids: synthesizedKnowledgeIds,
      recall_surface_state_ids: recallSurfaceStateIds,
      intermediate_artifact_purge: intermediateArtifactPurge,
      context_bundle_id: contextBundleId,
      warnings
    };
  } catch (error) {
    await finalizeKnowledgeGovernanceJob({
      jobId,
      runStatus: "failed",
      resultPayload: {
        decision: "failed",
        warnings,
        error_message: error instanceof Error ? error.message : String(error)
      }
    });
    throw error;
  }
}
