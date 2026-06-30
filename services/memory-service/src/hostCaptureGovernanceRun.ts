import { createHash, randomUUID } from "node:crypto";
import {
  createKnowledgeContextBundle,
  createKnowledgeEvidence,
  createKnowledgeGovernanceJob,
  markKnowledgeGovernanceJobRunning,
  finalizeKnowledgeGovernanceJob,
  createSynthesizedKnowledge,
  createMemoryCandidate,
  createOrReplaceFactualMemory,
  createOrReplaceRule,
  ensureMemoryCandidateTaskEnvelope,
  getPool,
  updateMemoryCandidate,
} from "@super-agent/db";
import type { CodexCapturePreviewRequest, HostCaptureName } from "./codexHostCapture.js";
import { previewHostCapture } from "./hostCapture.js";
import { buildGovernanceBatchPreview, VALID_KNOWLEDGE_TYPES, type GovernanceBatchPreviewResponse, type GovernanceKnowledgeType } from "./hostCaptureGovernanceBatch.js";
import { applyHostModelGovernanceResult } from "./hostModelGovernanceAdapter.js";
import { detectConflicts } from "./governance/L2ConflictDetector.js";
import { scanEvolution } from "./governance/L3EvolutionScanner.js";
import { runCognitiveEngine } from "./governance/L4CognitiveEngine.js";

// Hard guard: never persist unnamed or empty-title/empty-content assets.
// The adapter already validates this, but this is the persistence-layer backstop
// that prevents UI "未命名记忆" rows from any code path.
function requirePresentFields(layer: string, index: number, title: string, content: string) {
  if (typeof title !== "string" || title.trim() === "") {
    throw new Error(`[persistence guard] ${layer}[${index}] has empty title; refusing to create unnamed asset`);
  }
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error(`[persistence guard] ${layer}[${index}] has empty content; refusing to create empty asset`);
  }
}

type HostGovernanceRunRequest = CodexCapturePreviewRequest & {
  host?: HostCaptureName | null;
  task_request_id?: string | null;
  fingerprint?: string | null;
  governance_mode?: "rules_fallback" | "host_model" | null;
  host_model_result?: {
    model_ref?: string | null;
    generated_at?: string | null;
    extraction_preview?: Partial<GovernanceBatchPreviewResponse["extraction_preview"]> | null;
  } | null;
};

export type HostGovernanceRunResponse = {
  host: HostCaptureName;
  thread_id: string;
  thread_name: string | null;
  session_file: string;
  task_request_id: string;
  governance_job_id: string | null;
  persisted: {
    rule_ids: string[];
    rule_items: Array<{
      id: string;
      title: string;
      statement: string;
      enforcement_level: "must" | "must_not";
      rule_domain: string;
      rule_scope: string;
      governance_level: string;
      availability_scope: string;
      promotion_status: string;
    }>;
    memory_ids: string[];
    memory_items: Array<{
      id: string;
      title: string;
      content: string;
      artifact_tag: string;
      origin_scope: string;
      governance_level: string;
      availability_scope: string;
      promotion_status: string;
    }>;
    memory_candidate_ids: string[];
    skill_proposal_ids: string[];
    skill_proposal_items: Array<{
      id: string;
      title: string;
      target_skill: string;
      target_skill_path: string | null;
      change_type: string;
      current_section: string | null;
      current_text: string | null;
      current_gap: string | null;
      proposed_text: string;
      proposed_patch: string | null;
      validation_method: string | null;
      rationale: string | null;
      proposal_quality: string;
      origin_scope: string;
      governance_level: string;
      availability_scope: string;
      promotion_status: string;
      merged_source_count: number;
      source_refs: Array<{
        source_kind: SourceKind;
        source_timestamp: string;
        source_excerpt: string;
      }>;
      source_excerpt: string;
      skill_key_hints: string[];
      description: string | null;
      applicable_scenarios: string[] | null;
      non_applicable_scenarios: string[] | null;
      execution_steps: string[] | null;
    }>;
    synthesized_knowledge_ids: string[];
    knowledge_items: Array<{ id: string; title: string; content: string; knowledge_type: string }>;
    evidence_ids: string[];
    governance_evidence_bundle_id: string | null;
    governance_decision_ids: string[];
    context_bundle_id: string | null;
  };
  acceptance_report: {
    inputs_read: {
      user_message_count: number;
      commentary_signal_count: number;
      command_count: number;
      tool_call_count: number;
      mcp_call_count: number;
    };
    governance_candidates: {
      rule_count: number;
      memory_count: number;
      skill_proposal_count: number;
      knowledge_count: number;
      governance_evidence_count: number;
    };
    governance_evidence_retained: Array<{
      title: string;
      evidence_category: string | null;
      source_kind: SourceKind;
      source_excerpt: string;
    }>;
    promoted_outputs: {
      rule_count: number;
      long_term_memory_count: number;
      skill_proposal_count: number;
      synthesized_knowledge_count: number;
    };
    retained_non_answering_layers: {
      governance_evidence_bundle_id: string | null;
    };
    discarded_or_not_promoted: {
      knowledge_candidates_not_promoted: number;
      governance_candidates_left_as_evidence_only: number;
    };
    incremental: {
      new_candidate_count: number;
      skipped_previously_governed_count: number;
    };
    governance_model: {
      mode: "host_model" | "rules_fallback";
      model_ref: string | null;
      generated_at: string | null;
      accepted: boolean;
      warning: string | null;
    };
  };
  warnings: string[];
  preview: GovernanceBatchPreviewResponse;
};

type SourceKind = "user_message" | "assistant_message" | "commentary" | "command" | "tool" | "mcp";

type CandidatePreview = GovernanceBatchPreviewResponse["extraction_preview"]["rule_candidates"][number];
type ExtractionPreview = GovernanceBatchPreviewResponse["extraction_preview"];

function assertValidKnowledgeType(value: unknown, context: string): GovernanceKnowledgeType {
  if (typeof value === "string" && VALID_KNOWLEDGE_TYPES.has(value as GovernanceKnowledgeType)) {
    return value as GovernanceKnowledgeType;
  }
  throw new Error(
    `[P0-b] Invalid knowledge_type "${String(value)}" ${context}. ` +
      `Allowed types: ${[...VALID_KNOWLEDGE_TYPES].join(", ")}. ` +
      `execution_derived_knowledge is not a valid synthesis type.`
  );
}

function resolveKnowledgePromotionState(
  governanceMode: "host_model" | "rules_fallback",
  candidatePromotionStatus: unknown,
  options?: { knowledgeTypeValid?: boolean }
): { lifecycleState: string; reviewState: string; recallState: string } {
  // P0-a: fallback path must never write active knowledge, regardless of candidate promotion_status.
  // P0-b: schema-invalid knowledge_type must never be active either.
  const knowledgeTypeValid = options?.knowledgeTypeValid ?? true;
  if (governanceMode !== "host_model" || !knowledgeTypeValid) {
    return {
      lifecycleState: "pending_review",
      reviewState: "pending_review",
      recallState: "audit_only"
    };
  }
  if (candidatePromotionStatus === "rejected") {
    return { lifecycleState: "pending_review", reviewState: "rejected", recallState: "inactive" };
  }
  if (candidatePromotionStatus === "needs_review") {
    return { lifecycleState: "pending_review", reviewState: "pending_review", recallState: "audit_only" };
  }
  // host_model + active/accepted
  return { lifecycleState: "curated", reviewState: "model_accepted", recallState: "active" };
}

function normalizeKnowledgeType(value: unknown): { type: GovernanceKnowledgeType; valid: boolean } {
  if (typeof value === "string" && VALID_KNOWLEDGE_TYPES.has(value as GovernanceKnowledgeType)) {
    return { type: value as GovernanceKnowledgeType, valid: true };
  }
  // P0-b: map legacy/invalid types to the most conservative spec-39 type and quarantine via resolveKnowledgePromotionState.
  // "synthesis" is a high-claim flagship type (§7.1) and must not be used as a catch-all for unknown garbage.
  return { type: "external_fact", valid: false };
}

// P0-a: fallback path must never promote any candidate to active, regardless of type.
// Force every candidate in the batch to a quarantine promotion status before persistence.
function forceFallbackQuarantine(batch: { extraction_preview: ExtractionPreview }): void {
  // Candidate-level promotion status only supports candidate | active | needs_review | rejected.
  // "needs_review" is the closest candidate-level signal; persistence will map it to
  // DB-level pending_review / audit_only quarantine states.
  for (const candidate of batch.extraction_preview.rule_candidates) {
    candidate.promotion_status = "needs_review";
  }
  for (const candidate of batch.extraction_preview.memory_candidates) {
    candidate.promotion_status = "needs_review";
  }
  for (const candidate of batch.extraction_preview.skill_proposal_candidates) {
    candidate.promotion_status = "needs_review";
  }
  for (const candidate of batch.extraction_preview.knowledge_candidates) {
    candidate.promotion_status = "needs_review";
  }
}

// P0-a: after persisting fallback candidates, hard-update the DB rows to quarantine states.
// Persistence helpers may still create rows with status='active' for needs_review candidates;
// this post-step is the backstop that guarantees nothing from fallback reaches active recall.
async function quarantineFallbackOutputs(input: {
  tenantId: string;
  scope: string;
  traceId: string;
  ruleIds: string[];
  memoryIds: string[];
  skillProposalIds: string[];
  synthesizedKnowledgeIds: string[];
}): Promise<void> {
  const pool = getPool();
  if (input.ruleIds.length > 0) {
    await pool.query(
      `UPDATE rule SET status = 'parked' WHERE tenant_id = $1 AND scope = $2 AND id = ANY($3::uuid[])`,
      [input.tenantId, input.scope, input.ruleIds]
    );
  }
  if (input.memoryIds.length > 0) {
    await pool.query(
      `UPDATE memory SET status = 'parked' WHERE tenant_id = $1 AND scope = $2 AND id = ANY($3::uuid[])`,
      [input.tenantId, input.scope, input.memoryIds]
    );
  }
  if (input.skillProposalIds.length > 0) {
    await pool.query(
      `UPDATE governance_change_proposal SET status = 'parked' WHERE tenant_id = $1 AND scope = $2 AND id = ANY($3::uuid[])`,
      [input.tenantId, input.scope, input.skillProposalIds]
    );
  }
  if (input.synthesizedKnowledgeIds.length > 0) {
    await pool.query(
      `UPDATE kp_synthesized_knowledge
       SET lifecycle_state = 'pending_review', review_state = 'pending_review', recall_state = 'audit_only'
       WHERE tenant_id = $1 AND scope = $2 AND id = ANY($3::uuid[])`,
      [input.tenantId, input.scope, input.synthesizedKnowledgeIds]
    );
  }
}

export async function runCodexHostGovernance(input: {
  tenantId: string;
  scope: string;
  traceId: string;
  body: HostGovernanceRunRequest;
}): Promise<HostGovernanceRunResponse> {
  const preview = await previewHostCapture(input.body);
  const fallbackBatch = buildGovernanceBatchPreview(preview);
  // P0-c: do not silently default to rules_fallback. Force explicit opt-in.
  const governanceMode = input.body.governance_mode ?? "host_model";
  const { batch, modelAdapter } = applyHostModelGovernanceResult({
    batch: fallbackBatch,
    governanceMode,
    hostModelResult: input.body.host_model_result ?? null
  });
  // P0-a: if the pipeline resolved to rules_fallback, nothing may reach active recall.
  if (modelAdapter.mode === "rules_fallback") {
    forceFallbackQuarantine(batch);
  }
  const taskRequestId = input.body.task_request_id?.trim() || randomUUID();
  const warnings = [...batch.ingestion_readiness.warnings];
  if (modelAdapter.warning) {
    warnings.push(modelAdapter.warning);
  }
  if (governanceMode === "rules_fallback") {
    warnings.push(`[P0-c] Governance ran in rules_fallback mode for ${preview.session_file}. All knowledge candidates are quarantined for review.`);
  }
  const incremental = await filterNewGovernanceCandidates({
    tenantId: input.tenantId,
    scope: input.scope,
    traceId: input.traceId,
    preview,
    batch
  });
  const existingMemoryFilter = await filterExistingFactualMemoryCandidates({
    tenantId: input.tenantId,
    scope: input.scope,
    extractionPreview: incremental.extraction_preview
  });
  incremental.extraction_preview.memory_candidates = existingMemoryFilter.memoryCandidates;
  incremental.skippedCandidateCount += existingMemoryFilter.skippedExistingMemoryCount;
  const existingRuleFilter = await filterExistingRuleCandidates({
    tenantId: input.tenantId,
    scope: input.scope,
    extractionPreview: incremental.extraction_preview
  });
  incremental.extraction_preview.rule_candidates = existingRuleFilter.ruleCandidates;
  incremental.skippedCandidateCount += existingRuleFilter.skippedExistingRuleCount;
  const existingSkillProposalFilter = await filterExistingSkillProposalCandidates({
    tenantId: input.tenantId,
    scope: input.scope,
    extractionPreview: incremental.extraction_preview
  });
  incremental.extraction_preview.skill_proposal_candidates = existingSkillProposalFilter.skillProposalCandidates;
  incremental.skippedCandidateCount += existingSkillProposalFilter.skippedExistingSkillProposalCount;

  const ruleIds: string[] = [];
  const ruleItems: HostGovernanceRunResponse["persisted"]["rule_items"] = [];
  const memoryIds: string[] = [];
  const memoryItems: HostGovernanceRunResponse["persisted"]["memory_items"] = [];
  const memoryCandidateIds: string[] = [];
  const skillProposalIds: string[] = [];
  const skillProposalItems: HostGovernanceRunResponse["persisted"]["skill_proposal_items"] = [];
  const synthesizedKnowledgeIds: string[] = [];
  const knowledgeItems: HostGovernanceRunResponse["persisted"]["knowledge_items"] = [];
  const evidenceIds: string[] = [];
  const governanceDecisionIds: string[] = [];
  let governanceEvidenceBundleId: string | null = null;

  for (const candidate of incremental.extraction_preview.rule_candidates) {
    const canonicalContent = candidate.content ?? candidate.source_excerpt;
    requirePresentFields("rule_candidate", ruleIds.length, candidate.title, canonicalContent);
    const enforcementLevel = inferRuleEnforcement(canonicalContent);
    const ruleId = await createOrReplaceRule({
      tenantId: input.tenantId,
      scope: input.scope,
      ruleKey: buildStableKey("host-rule", candidate.availability_scope, candidate.rule_domain ?? "execution", candidate.title, canonicalContent),
      ruleType: `${candidate.rule_domain ?? "execution"}_rule`,
      title: candidate.title,
      statement: canonicalContent,
      normalizedStatement: normalizeText(canonicalContent),
      appliesTo: candidate.applies_to_phase ?? ["governance", "integration", "execution"],
      triggerConditions: {
        host: preview.host,
        source: "host_capture",
        thread_id: preview.thread_id,
        source_session_file: preview.session_file,
        origin_scope: candidate.origin_scope,
        governance_level: candidate.governance_level,
        availability_scope: candidate.availability_scope,
        promotion_status: candidate.promotion_status,
        rule_domain: candidate.rule_domain ?? "execution",
        rule_scope: candidate.rule_scope ?? candidate.origin_scope,
        violation_behavior: candidate.violation_behavior ?? "warn"
      },
      enforcementLevel,
      priority: enforcementLevel === "must_not" ? 95 : 90,
      riskLevel: "medium",
      verificationStatus: "verified",
      sourceRefs: [buildSourceRef(preview.session_file, candidate.source_timestamp, candidate.source_kind)],
      evidenceRefs: [],
      originScope: candidate.origin_scope,
      governanceLevel: candidate.governance_level,
      availabilityScope: candidate.availability_scope,
      promotionStatus: candidate.promotion_status,
      ruleDomain: candidate.rule_domain ?? "execution",
      ruleScope: candidate.rule_scope ?? candidate.origin_scope,
      metadata: {
        source_kind: candidate.source_kind,
        host: preview.host,
        thread_id: preview.thread_id,
        applies_to_phase: candidate.applies_to_phase ?? ["governance", "integration", "execution"],
        violation_behavior: candidate.violation_behavior ?? "warn",
        source_excerpt: candidate.source_excerpt,
        source_refs: candidate.source_refs ?? [
          {
            source_kind: candidate.source_kind,
            source_timestamp: candidate.source_timestamp,
            source_excerpt: candidate.source_excerpt
          }
        ],
      },
      traceId: input.traceId
    });
    ruleIds.push(ruleId);
    ruleItems.push({
      id: ruleId,
      title: candidate.title,
      statement: canonicalContent,
      enforcement_level: enforcementLevel,
      rule_domain: candidate.rule_domain ?? "execution",
      rule_scope: candidate.rule_scope ?? candidate.origin_scope,
      governance_level: candidate.governance_level,
      availability_scope: candidate.availability_scope,
      promotion_status: candidate.promotion_status
    });
  }

  for (const candidate of incremental.extraction_preview.memory_candidates) {
    const taskStepId = randomUUID();
    const sourceRef = buildSourceRef(preview.session_file, candidate.source_timestamp, candidate.source_kind);
    const canonicalContent = candidate.content ?? candidate.source_excerpt;
    const artifactTag = inferMemoryArtifactTag(candidate.title, canonicalContent);
    const normalizedMemoryContent = normalizeMemoryContent(candidate.title, canonicalContent);
    requirePresentFields("memory_candidate", memoryIds.length, candidate.title, normalizedMemoryContent);
    const candidatePayload = buildMemoryCandidatePayload({
      preview,
      candidate,
      title: candidate.title,
      content: normalizedMemoryContent,
      factType: artifactTag === "environment_fact" ? "environment_context" : "design_progress"
    });

    await ensureMemoryCandidateTaskEnvelope({
      tenantId: input.tenantId,
      scope: input.scope,
      taskRequestId,
      taskStepId,
      sourceRef,
      artifactTag,
      sideEffectClass: "read_only",
      traceId: input.traceId
    });
    const created = await createMemoryCandidate({
      tenantId: input.tenantId,
      scope: input.scope,
      taskRequestId,
      taskStepId,
      sourceType: `${preview.host}_host_capture`,
      sourceRef,
      artifactTag,
      verificationStatus: "verified",
      sideEffectClass: "read_only",
      fingerprint: input.body.fingerprint ?? null,
      fingerprintStatus: input.body.fingerprint ? "matched" : "matched_or_na",
      routingDecision: "host-capture-memory",
      rankScore: candidate.confidence === "high" ? 90 : candidate.confidence === "medium" ? 78 : 62,
      candidatePayload,
      llmRefinedPayload: null,
      traceId: input.traceId
    });
    await updateMemoryCandidate({
      candidateId: created.id,
      status: "persisted",
      routingDecision: "host-capture-memory",
      rankScore: candidate.confidence === "high" ? 90 : candidate.confidence === "medium" ? 78 : 62
    });
    memoryCandidateIds.push(created.id);

    const memoryId = await createOrReplaceFactualMemory({
      tenantId: input.tenantId,
      scope: input.scope,
      title: candidate.title,
      content: normalizedMemoryContent,
      normalizedContent: normalizeText(normalizedMemoryContent),
      sourceRef,
      verificationStatus: "verified",
      fingerprintRequirement: null,
      tags: ["host-capture", preview.host, artifactTag],
      metadata: {
        candidate_id: created.id,
        thread_id: preview.thread_id,
        source_session_file: preview.session_file,
        source_kind: candidate.source_kind,
        origin_scope: candidate.origin_scope,
        governance_level: candidate.governance_level,
        availability_scope: candidate.availability_scope,
        promotion_status: candidate.promotion_status,
        source_excerpt: candidate.source_excerpt,
        source_refs: candidate.source_refs ?? [
          {
            source_kind: candidate.source_kind,
            source_timestamp: candidate.source_timestamp,
            source_excerpt: candidate.source_excerpt
          }
        ],
      },
      importance: candidate.confidence === "high" ? 90 : candidate.confidence === "medium" ? 78 : 62,
      confidenceScore: candidate.confidence === "high" ? 0.92 : candidate.confidence === "medium" ? 0.82 : 0.68,
      originScope: candidate.origin_scope,
      governanceLevel: candidate.governance_level,
      availabilityScope: candidate.availability_scope,
      promotionStatus: candidate.promotion_status,
      traceId: input.traceId
    });
    memoryIds.push(memoryId);
    memoryItems.push({
      id: memoryId,
      title: candidate.title,
      content: normalizedMemoryContent,
      artifact_tag: artifactTag,
      origin_scope: candidate.origin_scope,
      governance_level: candidate.governance_level,
      availability_scope: candidate.availability_scope,
      promotion_status: candidate.promotion_status
    });
  }

  for (const candidate of incremental.extraction_preview.skill_proposal_candidates) {
    requirePresentFields("skill_proposal_candidate", skillProposalIds.length, candidate.title, candidate.proposed_text ?? candidate.source_excerpt);
    const proposalId = await createSkillProposal({
      tenantId: input.tenantId,
      scope: input.scope,
      traceId: input.traceId,
      title: candidate.title,
      sourceRef: buildSourceRef(preview.session_file, candidate.source_timestamp, candidate.source_kind),
      sourceExcerpt: candidate.source_excerpt,
      targetSkill: candidate.target_skill ?? inferSkillKeyHints(candidate.title, candidate.content ?? candidate.source_excerpt)[0] ?? "unknown",
      targetSkillPath: candidate.target_skill_path ?? null,
      changeType: candidate.change_type ?? "update",
      currentSection: candidate.current_section ?? null,
      currentText: candidate.current_text ?? null,
      currentGap: candidate.current_gap ?? null,
      proposedText: candidate.proposed_text ?? candidate.content ?? candidate.source_excerpt,
      proposedPatch: candidate.proposed_patch ?? null,
      validationMethod: candidate.validation_method ?? null,
      rationale: candidate.rationale ?? null,
      proposalQuality: candidate.proposal_quality ?? "actionable",
      originScope: candidate.origin_scope,
      governanceLevel: candidate.governance_level,
      availabilityScope: candidate.availability_scope,
      promotionStatus: candidate.promotion_status,
      mergedSourceCount: candidate.merged_source_count ?? 1,
      sourceRefs: candidate.source_refs ?? [
        {
          source_kind: candidate.source_kind,
          source_timestamp: candidate.source_timestamp,
          source_excerpt: candidate.source_excerpt
        }
      ],
      host: preview.host,
      threadId: preview.thread_id,
      description: candidate.description ?? null,
      applicableScenarios: candidate.applicable_scenarios ?? null,
      nonApplicableScenarios: candidate.non_applicable_scenarios ?? null,
      executionSteps: candidate.execution_steps ?? null
    });
    skillProposalIds.push(proposalId);
    skillProposalItems.push({
      id: proposalId,
      title: candidate.title,
      target_skill: candidate.target_skill ?? inferSkillKeyHints(candidate.title, candidate.content ?? candidate.source_excerpt)[0] ?? "unknown",
      target_skill_path: candidate.target_skill_path ?? null,
      change_type: candidate.change_type ?? "update",
      current_section: candidate.current_section ?? null,
      current_text: candidate.current_text ?? null,
      current_gap: candidate.current_gap ?? null,
      proposed_text: candidate.proposed_text ?? candidate.content ?? candidate.source_excerpt,
      proposed_patch: candidate.proposed_patch ?? null,
      validation_method: candidate.validation_method ?? null,
      rationale: candidate.rationale ?? null,
      proposal_quality: candidate.proposal_quality ?? "actionable",
      origin_scope: candidate.origin_scope,
      governance_level: candidate.governance_level,
      availability_scope: candidate.availability_scope,
      promotion_status: candidate.promotion_status,
      merged_source_count: candidate.merged_source_count ?? 1,
      source_refs: candidate.source_refs ?? [
        {
          source_kind: candidate.source_kind,
          source_timestamp: candidate.source_timestamp,
          source_excerpt: candidate.source_excerpt
        }
      ],
      source_excerpt: candidate.source_excerpt,
      skill_key_hints: inferSkillKeyHints(
        candidate.title,
        `${candidate.target_skill ?? ""} ${candidate.proposed_text ?? candidate.content ?? candidate.source_excerpt}`
      ),
      description: candidate.description ?? null,
      applicable_scenarios: candidate.applicable_scenarios ?? null,
      non_applicable_scenarios: candidate.non_applicable_scenarios ?? null,
      execution_steps: candidate.execution_steps ?? null
    });
  }

  if (incremental.extraction_preview.governance_evidence_candidates.length > 0) {
    governanceEvidenceBundleId = await createKnowledgeContextBundle({
      tenantId: input.tenantId,
      scope: input.scope,
      requestRef: taskRequestId,
      bundleType: "governance_evidence_bundle",
      summary: `${preview.host} host governance collected ${incremental.extraction_preview.governance_evidence_candidates.length} governance evidence items for later synthesis and review.`,
      warnings: [],
      evidenceRefs: incremental.extraction_preview.governance_evidence_candidates.map((candidate) => ({
        title: candidate.title,
        evidence_category: candidate.evidence_category ?? null,
        source_kind: candidate.source_kind,
        source_timestamp: candidate.source_timestamp,
        source_excerpt: candidate.source_excerpt,
        reason: candidate.reason,
        confidence: candidate.confidence
      })),
      assemblyTrace: {
        host: preview.host,
        thread_id: preview.thread_id,
        session_file: preview.session_file,
        evidence_candidate_count: incremental.extraction_preview.governance_evidence_candidates.length,
        evidence_titles: incremental.extraction_preview.governance_evidence_candidates.map((candidate) => candidate.title),
        evidence_categories: incremental.extraction_preview.governance_evidence_candidates.map((candidate) => ({
          title: candidate.title,
          category: candidate.evidence_category ?? null
        }))
      },
      traceId: input.traceId
    });
  } else {
    warnings.push("No governance evidence candidates were collected from non-conversation task traces.");
  }

  let governanceJobId: string | null = null;
  const knowledgeCandidates = incremental.extraction_preview.knowledge_candidates;
  if (knowledgeCandidates.length > 0) {
    governanceJobId = await createKnowledgeGovernanceJob({
      tenantId: input.tenantId,
      scope: input.scope,
      jobType: "host_capture_session_governance",
      triggerType: "manual_run",
      triggerRef: preview.thread_id,
      targetObjectType: `${preview.host}_thread`,
      targetObjectIds: [],
      priority: 70,
      requestedBy: "api",
      payload: {
        host: preview.host,
        thread_id: preview.thread_id,
        thread_name: preview.thread_name,
        session_file: preview.session_file
      },
      traceId: input.traceId
    });

    await markKnowledgeGovernanceJobRunning({ jobId: governanceJobId });

    for (const candidate of knowledgeCandidates) {
      const canonicalContent = candidate.content ?? candidate.source_excerpt;
      requirePresentFields("knowledge_candidate", synthesizedKnowledgeIds.length, candidate.title, canonicalContent);
      const knowledgeTypeResult = normalizeKnowledgeType(candidate.knowledge_type);
      if (!knowledgeTypeResult.valid) {
        warnings.push(
          `[P0-b] Invalid knowledge_type "${String(candidate.knowledge_type)}" for "${candidate.title}". ` +
            `Normalized to "${knowledgeTypeResult.type}" and quarantined for review.`
        );
      }
      const promotionState = resolveKnowledgePromotionState(governanceMode, candidate.promotion_status, {
        knowledgeTypeValid: knowledgeTypeResult.valid
      });
      const evidenceId = await createKnowledgeEvidence({
        tenantId: input.tenantId,
        scope: input.scope,
        memoryDomain: "knowledge",
        evidenceType: "host_capture_excerpt",
        sourceType: `${preview.host}_session`,
        sourceUri: buildSourceRef(preview.session_file, candidate.source_timestamp, candidate.source_kind),
        rawRef: preview.thread_id,
        contentExcerpt: candidate.source_excerpt,
        contentHash: sha256(candidate.source_excerpt),
        metadata: {
          title: candidate.title,
          reason: candidate.reason,
          source_kind: candidate.source_kind,
          thread_id: preview.thread_id,
          source_session_file: preview.session_file,
          origin_scope: candidate.origin_scope,
          governance_level: candidate.governance_level,
          availability_scope: candidate.availability_scope,
          promotion_status: candidate.promotion_status
        },
        traceId: input.traceId
      });
      evidenceIds.push(evidenceId);
      const synthesized = await createSynthesizedKnowledge({
        tenantId: input.tenantId,
        scope: input.scope,
        memoryDomain: "knowledge",
        knowledgeType: knowledgeTypeResult.type,
        title: candidate.title,
        content: canonicalContent,
        normalizedContent: normalizeText(canonicalContent),
        lifecycleState: promotionState.lifecycleState,
        reviewState: promotionState.reviewState,
        recallState: promotionState.recallState,
        sourceObjectIds: [preview.thread_id],
        evidenceIds: [evidenceId],
        reasoningSummary:
          "Derived from host task execution records. This is promoted only when execution outputs contain reusable external or cross-task knowledge.",
        confidenceScore: candidate.confidence === "high" ? 0.9 : candidate.confidence === "medium" ? 0.78 : 0.62,
        riskLevel: candidate.promotion_status === "needs_review" ? "medium" : "low",
        governanceJobId,
        metadata: {
          source_kind: candidate.source_kind,
          host: preview.host,
          thread_id: preview.thread_id,
          source_session_file: preview.session_file,
          origin_scope: candidate.origin_scope,
          governance_level: candidate.governance_level,
          availability_scope: candidate.availability_scope,
          promotion_status: candidate.promotion_status,
          governance_mode: governanceMode,
          source_excerpt: candidate.source_excerpt,
          source_refs: candidate.source_refs ?? [
            {
              source_kind: candidate.source_kind,
              source_timestamp: candidate.source_timestamp,
              source_excerpt: candidate.source_excerpt
            }
          ],
        },
        traceId: input.traceId
      });
      if (synthesized.existed) {
        continue;
      }
      synthesizedKnowledgeIds.push(synthesized.id);
      knowledgeItems.push({
        id: synthesized.id,
        title: candidate.title,
        content: canonicalContent,
        knowledge_type: knowledgeTypeResult.type
      });
    }
  }

  // P0-a backstop: if this run resolved to rules_fallback, hard-quarantine every
  // persisted output so that nothing reaches active recall.
  if (modelAdapter.mode === "rules_fallback") {
    await quarantineFallbackOutputs({
      tenantId: input.tenantId,
      scope: input.scope,
      traceId: input.traceId,
      ruleIds,
      memoryIds,
      skillProposalIds,
      synthesizedKnowledgeIds
    });
  }

  const contextBundleId = await createKnowledgeContextBundle({
    tenantId: input.tenantId,
    scope: input.scope,
    requestRef: taskRequestId,
    bundleType: "host_capture_governance_summary",
    summary: `${preview.host} host governance processed ${ruleIds.length} rules, ${memoryIds.length} memories, ${skillProposalIds.length} skill proposals, and ${synthesizedKnowledgeIds.length} synthesized knowledge objects.`,
    warnings,
    assemblyTrace: {
      host: preview.host,
      thread_id: preview.thread_id,
      session_file: preview.session_file,
      governance_evidence_bundle_id: governanceEvidenceBundleId,
      rule_ids: ruleIds,
      memory_ids: memoryIds,
      skill_proposal_ids: skillProposalIds,
      synthesized_knowledge_ids: synthesizedKnowledgeIds,
      evidence_ids: evidenceIds,
      governance_decision_ids: governanceDecisionIds
    },
    traceId: input.traceId
  });

  // Finalize governance job in DB with acceptance report
  const acceptanceReport1 = {
    inputs_read: {
      user_message_count: batch.raw_inputs.user_messages.length,
      commentary_signal_count: batch.raw_inputs.commentary_messages.length,
      command_count: batch.raw_inputs.commands.length,
      tool_call_count: batch.raw_inputs.tool_calls.length,
      mcp_call_count: batch.raw_inputs.mcp_calls.length
    },
    governance_candidates: {
      rule_count: incremental.extraction_preview.rule_candidates.length,
      memory_count: incremental.extraction_preview.memory_candidates.length,
      skill_proposal_count: incremental.extraction_preview.skill_proposal_candidates.length,
      knowledge_count: incremental.extraction_preview.knowledge_candidates.length,
      governance_evidence_count: incremental.extraction_preview.governance_evidence_candidates.length
    },
    promoted_outputs: {
      rule_count: ruleIds.length,
      long_term_memory_count: memoryIds.length,
      skill_proposal_count: skillProposalIds.length,
      synthesized_knowledge_count: synthesizedKnowledgeIds.length
    }
  };

  if (governanceJobId) {
    await finalizeKnowledgeGovernanceJob({
      jobId: governanceJobId,
      runStatus: "completed",
      resultPayload: acceptanceReport1
    });
  }

  return {
    host: preview.host,
    thread_id: preview.thread_id,
    thread_name: preview.thread_name,
    session_file: preview.session_file,
    task_request_id: taskRequestId,
    governance_job_id: governanceJobId,
    persisted: {
      rule_ids: ruleIds,
      rule_items: ruleItems,
      memory_ids: memoryIds,
      memory_items: memoryItems,
      memory_candidate_ids: memoryCandidateIds,
      skill_proposal_ids: skillProposalIds,
      skill_proposal_items: skillProposalItems,
      synthesized_knowledge_ids: synthesizedKnowledgeIds,
      knowledge_items: knowledgeItems,
      evidence_ids: evidenceIds,
      governance_evidence_bundle_id: governanceEvidenceBundleId,
      governance_decision_ids: governanceDecisionIds,
      context_bundle_id: contextBundleId
    },
    acceptance_report: {
      inputs_read: {
        user_message_count: batch.raw_inputs.user_messages.length,
        commentary_signal_count: batch.raw_inputs.commentary_messages.length,
        command_count: batch.raw_inputs.commands.length,
        tool_call_count: batch.raw_inputs.tool_calls.length,
        mcp_call_count: batch.raw_inputs.mcp_calls.length
      },
      governance_candidates: {
        rule_count: incremental.extraction_preview.rule_candidates.length,
        memory_count: incremental.extraction_preview.memory_candidates.length,
        skill_proposal_count: incremental.extraction_preview.skill_proposal_candidates.length,
        knowledge_count: incremental.extraction_preview.knowledge_candidates.length,
        governance_evidence_count: incremental.extraction_preview.governance_evidence_candidates.length
      },
      governance_evidence_retained: incremental.extraction_preview.governance_evidence_candidates.map((candidate) => ({
        title: candidate.title,
        evidence_category: candidate.evidence_category ?? null,
        source_kind: candidate.source_kind,
        source_excerpt: candidate.source_excerpt
      })),
      promoted_outputs: {
        rule_count: ruleIds.length,
        long_term_memory_count: memoryIds.length,
        skill_proposal_count: skillProposalIds.length,
        synthesized_knowledge_count: synthesizedKnowledgeIds.length
      },
      retained_non_answering_layers: {
        governance_evidence_bundle_id: governanceEvidenceBundleId
      },
      discarded_or_not_promoted: {
        knowledge_candidates_not_promoted: Math.max(0, incremental.extraction_preview.knowledge_candidates.length - synthesizedKnowledgeIds.length),
        governance_candidates_left_as_evidence_only: incremental.extraction_preview.governance_evidence_candidates.length
      },
      incremental: {
        new_candidate_count: incremental.newCandidateCount,
        skipped_previously_governed_count: incremental.skippedCandidateCount
      },
      governance_model: {
        mode: modelAdapter.mode,
        model_ref: modelAdapter.model_ref,
        generated_at: modelAdapter.generated_at,
        accepted: modelAdapter.accepted,
        warning: modelAdapter.warning
      }
    },
    warnings,
    preview: batch
  };
}

// ---------------------------------------------------------------------------
// Host-agnostic governance run from a pre-built extraction_preview
// ---------------------------------------------------------------------------

export type GovernanceFromExtractionInput = {
  tenantId: string;
  scope: string;
  traceId: string;
  extraction_preview: ExtractionPreview;
  host?: string;
  task_request_id?: string | null;
  fingerprint?: string | null;
  governance_mode?: "rules_fallback" | "host_model" | null;
};

export type GovernanceFromExtractionResponse = {
  host: string;
  task_request_id: string;
  governance_job_id: string | null;
  pipeline: {
    l2: { skipped_count: number; merged_count: number; conflict_proposal_count: number; skipped_titles: string[] };
    l3: { signals_count: number; relations_count: number; proposal_ids: string[] };
    l4: { hypotheses_count: number; synthesized_knowledge_ids: string[]; proposal_ids: string[]; meta_cognition: Record<string, unknown> };
  } | null;
  persisted: HostGovernanceRunResponse["persisted"];
  acceptance_report: HostGovernanceRunResponse["acceptance_report"];
  warnings: string[];
};

export async function runGovernanceFromExtraction(input: GovernanceFromExtractionInput): Promise<GovernanceFromExtractionResponse> {
  const hostName = input.host ?? "generic";
  const taskRequestId = input.task_request_id?.trim() || randomUUID();
  const warnings: string[] = [];
  // P0-c: do not silently default to rules_fallback in the generic extraction path either.
  const governanceMode = input.governance_mode ?? "host_model";
  if (governanceMode === "rules_fallback") {
    warnings.push(`[P0-c] Governance ran in rules_fallback mode for generic-extraction://${taskRequestId}. All candidates are quarantined for review.`);
  }

  // Use the extraction_preview directly — skip previewHostCapture,
  // buildGovernanceBatchPreview, and filterNewGovernanceCandidates
  // (no Codex session to dedup against).
  let extractionPreview: ExtractionPreview = {
    rule_candidates: input.extraction_preview.rule_candidates ?? [],
    memory_candidates: input.extraction_preview.memory_candidates ?? [],
    skill_proposal_candidates: input.extraction_preview.skill_proposal_candidates ?? [],
    knowledge_candidates: input.extraction_preview.knowledge_candidates ?? [],
    governance_evidence_candidates: input.extraction_preview.governance_evidence_candidates ?? []
  };

  if (governanceMode === "rules_fallback") {
    forceFallbackQuarantine({ extraction_preview: extractionPreview });
  }

  // Build a virtual preview object for persistence references that
  // normally come from the Codex session file.
  const virtualPreview = {
    host: hostName as HostCaptureName,
    thread_id: `generic-${taskRequestId}`,
    thread_name: null as string | null,
    session_file: `generic-extraction://${taskRequestId}`
  };

  // P0.5: host_model mode must still run schema/cross-layer audit even when
  // the caller supplied a pre-built extraction_preview.
  if (governanceMode === "host_model") {
    const virtualBatch: GovernanceBatchPreviewResponse = {
      host: virtualPreview.host,
      thread_id: virtualPreview.thread_id,
      thread_name: virtualPreview.thread_name,
      session_file: virtualPreview.session_file,
      ingestion_readiness: { status: "ready", warnings: [] },
      raw_inputs: {
        user_messages: [],
        commentary_messages: [],
        commands: [],
        tool_calls: [],
        mcp_calls: []
      },
      extraction_preview: extractionPreview
    };
    const validated = applyHostModelGovernanceResult({
      batch: virtualBatch,
      governanceMode,
      hostModelResult: { extraction_preview: extractionPreview }
    });
    extractionPreview = validated.batch.extraction_preview;
  }

  // Still apply filterExisting* checks to avoid duplicate memories / rules / skill proposals
  const existingMemoryFilter = await filterExistingFactualMemoryCandidates({
    tenantId: input.tenantId,
    scope: input.scope,
    extractionPreview
  });
  extractionPreview.memory_candidates = existingMemoryFilter.memoryCandidates;

  const existingRuleFilter = await filterExistingRuleCandidates({
    tenantId: input.tenantId,
    scope: input.scope,
    extractionPreview
  });
  extractionPreview.rule_candidates = existingRuleFilter.ruleCandidates;

  const existingSkillProposalFilter = await filterExistingSkillProposalCandidates({
    tenantId: input.tenantId,
    scope: input.scope,
    extractionPreview
  });
  extractionPreview.skill_proposal_candidates = existingSkillProposalFilter.skillProposalCandidates;

  // ── L2: 语义冲突检测（写入前） ──────────────────────
  const l2SkippedTitles: string[] = [];
  let l2MergedCount = 0;
  let l2ConflictProposalCount = 0;

  const survivingRuleCandidates: typeof extractionPreview.rule_candidates = [];
  for (const candidate of extractionPreview.rule_candidates) {
    const candidateContent = candidate.content ?? candidate.source_excerpt ?? "";
    try {
      const result = await detectConflicts({
        tenantId: input.tenantId,
        scope: input.scope,
        traceId: input.traceId,
        layer: "rule",
        candidateId: candidate.title,
        candidateTitle: candidate.title,
        candidateContent,
      });
      l2ConflictProposalCount += result.conflicts.length;
      if (result.blockingAction === "SKIP") {
        l2SkippedTitles.push(candidate.title);
        continue;
      }
      if (result.mergedContent) {
        candidate.content = result.mergedContent;
        l2MergedCount++;
      }
      survivingRuleCandidates.push(candidate);
    } catch (err) {
      console.error(`[L2] detectConflicts failed for rule "${candidate.title}":`, err instanceof Error ? err.message : String(err));
      survivingRuleCandidates.push(candidate);
    }
  }
  extractionPreview.rule_candidates = survivingRuleCandidates;

  const survivingMemoryCandidates: typeof extractionPreview.memory_candidates = [];
  for (const candidate of extractionPreview.memory_candidates) {
    const candidateContent = candidate.content ?? candidate.source_excerpt ?? "";
    try {
      const result = await detectConflicts({
        tenantId: input.tenantId,
        scope: input.scope,
        traceId: input.traceId,
        layer: "memory",
        candidateId: candidate.title,
        candidateTitle: candidate.title,
        candidateContent,
      });
      l2ConflictProposalCount += result.conflicts.length;
      if (result.blockingAction === "SKIP") {
        l2SkippedTitles.push(candidate.title);
        continue;
      }
      if (result.mergedContent) {
        candidate.content = result.mergedContent;
        l2MergedCount++;
      }
      survivingMemoryCandidates.push(candidate);
    } catch (err) {
      console.error(`[L2] detectConflicts failed for memory "${candidate.title}":`, err instanceof Error ? err.message : String(err));
      survivingMemoryCandidates.push(candidate);
    }
  }
  extractionPreview.memory_candidates = survivingMemoryCandidates;

  // ---- Persistence (same logic as runCodexHostGovernance) ----

  const ruleIds: string[] = [];
  const ruleItems: HostGovernanceRunResponse["persisted"]["rule_items"] = [];
  const memoryIds: string[] = [];
  const memoryItems: HostGovernanceRunResponse["persisted"]["memory_items"] = [];
  const memoryCandidateIds: string[] = [];
  const skillProposalIds: string[] = [];
  const skillProposalItems: HostGovernanceRunResponse["persisted"]["skill_proposal_items"] = [];
  const synthesizedKnowledgeIds: string[] = [];
  const knowledgeItems: HostGovernanceRunResponse["persisted"]["knowledge_items"] = [];
  const evidenceIds: string[] = [];
  const governanceDecisionIds: string[] = [];
  let governanceEvidenceBundleId: string | null = null;

  for (const candidate of extractionPreview.rule_candidates) {
    const canonicalContent = candidate.content ?? candidate.source_excerpt;
    const enforcementLevel = inferRuleEnforcement(canonicalContent);
    const ruleId = await createOrReplaceRule({
      tenantId: input.tenantId,
      scope: input.scope,
      ruleKey: buildStableKey("host-rule", candidate.availability_scope, candidate.rule_domain ?? "execution", candidate.title, canonicalContent),
      ruleType: `${candidate.rule_domain ?? "execution"}_rule`,
      title: candidate.title,
      statement: canonicalContent,
      normalizedStatement: normalizeText(canonicalContent),
      appliesTo: candidate.applies_to_phase ?? ["governance", "integration", "execution"],
      triggerConditions: {
        host: hostName,
        source: "host_capture",
        thread_id: virtualPreview.thread_id,
        source_session_file: virtualPreview.session_file,
        origin_scope: candidate.origin_scope,
        governance_level: candidate.governance_level,
        availability_scope: candidate.availability_scope,
        promotion_status: candidate.promotion_status,
        rule_domain: candidate.rule_domain ?? "execution",
        rule_scope: candidate.rule_scope ?? candidate.origin_scope,
        violation_behavior: candidate.violation_behavior ?? "warn"
      },
      enforcementLevel,
      priority: enforcementLevel === "must_not" ? 95 : 90,
      riskLevel: "medium",
      verificationStatus: "verified",
      sourceRefs: [buildSourceRef(virtualPreview.session_file, candidate.source_timestamp, candidate.source_kind)],
      evidenceRefs: [],
      originScope: candidate.origin_scope,
      governanceLevel: candidate.governance_level,
      availabilityScope: candidate.availability_scope,
      promotionStatus: candidate.promotion_status,
      ruleDomain: candidate.rule_domain ?? "execution",
      ruleScope: candidate.rule_scope ?? candidate.origin_scope,
      metadata: {
        source_kind: candidate.source_kind,
        host: hostName,
        thread_id: virtualPreview.thread_id,
        applies_to_phase: candidate.applies_to_phase ?? ["governance", "integration", "execution"],
        violation_behavior: candidate.violation_behavior ?? "warn",
        source_excerpt: candidate.source_excerpt,
        source_refs: candidate.source_refs ?? [
          {
            source_kind: candidate.source_kind,
            source_timestamp: candidate.source_timestamp,
            source_excerpt: candidate.source_excerpt
          }
        ],
      },
      traceId: input.traceId
    });
    ruleIds.push(ruleId);
    ruleItems.push({
      id: ruleId,
      title: candidate.title,
      statement: canonicalContent,
      enforcement_level: enforcementLevel,
      rule_domain: candidate.rule_domain ?? "execution",
      rule_scope: candidate.rule_scope ?? candidate.origin_scope,
      governance_level: candidate.governance_level,
      availability_scope: candidate.availability_scope,
      promotion_status: candidate.promotion_status
    });
  }

  for (const candidate of extractionPreview.memory_candidates) {
    const taskStepId = randomUUID();
    const sourceRef = buildSourceRef(virtualPreview.session_file, candidate.source_timestamp, candidate.source_kind);
    const canonicalContent = candidate.content ?? candidate.source_excerpt;
    const artifactTag = inferMemoryArtifactTag(candidate.title, canonicalContent);
    const normalizedMemoryContent = normalizeMemoryContent(candidate.title, canonicalContent);
    const candidatePayload = buildMemoryCandidatePayload({
      preview: virtualPreview,
      candidate,
      title: candidate.title,
      content: normalizedMemoryContent,
      factType: artifactTag === "environment_fact" ? "environment_context" : "design_progress"
    });

    await ensureMemoryCandidateTaskEnvelope({
      tenantId: input.tenantId,
      scope: input.scope,
      taskRequestId,
      taskStepId,
      sourceRef,
      artifactTag,
      sideEffectClass: "read_only",
      traceId: input.traceId
    });
    const created = await createMemoryCandidate({
      tenantId: input.tenantId,
      scope: input.scope,
      taskRequestId,
      taskStepId,
      sourceType: `${hostName}_host_capture`,
      sourceRef,
      artifactTag,
      verificationStatus: "verified",
      sideEffectClass: "read_only",
      fingerprint: input.fingerprint ?? null,
      fingerprintStatus: input.fingerprint ? "matched" : "matched_or_na",
      routingDecision: "host-capture-memory",
      rankScore: candidate.confidence === "high" ? 90 : candidate.confidence === "medium" ? 78 : 62,
      candidatePayload,
      llmRefinedPayload: null,
      traceId: input.traceId
    });
    await updateMemoryCandidate({
      candidateId: created.id,
      status: "persisted",
      routingDecision: "host-capture-memory",
      rankScore: candidate.confidence === "high" ? 90 : candidate.confidence === "medium" ? 78 : 62
    });
    memoryCandidateIds.push(created.id);

    const memoryId = await createOrReplaceFactualMemory({
      tenantId: input.tenantId,
      scope: input.scope,
      title: candidate.title,
      content: normalizedMemoryContent,
      normalizedContent: normalizeText(normalizedMemoryContent),
      sourceRef,
      verificationStatus: "verified",
      fingerprintRequirement: null,
      tags: ["host-capture", hostName, artifactTag],
      metadata: {
        candidate_id: created.id,
        thread_id: virtualPreview.thread_id,
        source_session_file: virtualPreview.session_file,
        source_kind: candidate.source_kind,
        origin_scope: candidate.origin_scope,
        governance_level: candidate.governance_level,
        availability_scope: candidate.availability_scope,
        promotion_status: candidate.promotion_status,
        source_excerpt: candidate.source_excerpt,
        source_refs: candidate.source_refs ?? [
          {
            source_kind: candidate.source_kind,
            source_timestamp: candidate.source_timestamp,
            source_excerpt: candidate.source_excerpt
          }
        ],
      },
      importance: candidate.confidence === "high" ? 90 : candidate.confidence === "medium" ? 78 : 62,
      confidenceScore: candidate.confidence === "high" ? 0.92 : candidate.confidence === "medium" ? 0.82 : 0.68,
      originScope: candidate.origin_scope,
      governanceLevel: candidate.governance_level,
      availabilityScope: candidate.availability_scope,
      promotionStatus: candidate.promotion_status,
      traceId: input.traceId
    });
    memoryIds.push(memoryId);
    memoryItems.push({
      id: memoryId,
      title: candidate.title,
      content: normalizedMemoryContent,
      artifact_tag: artifactTag,
      origin_scope: candidate.origin_scope,
      governance_level: candidate.governance_level,
      availability_scope: candidate.availability_scope,
      promotion_status: candidate.promotion_status
    });
  }

  for (const candidate of extractionPreview.skill_proposal_candidates) {
    const proposalId = await createSkillProposal({
      tenantId: input.tenantId,
      scope: input.scope,
      traceId: input.traceId,
      title: candidate.title,
      sourceRef: buildSourceRef(virtualPreview.session_file, candidate.source_timestamp, candidate.source_kind),
      sourceExcerpt: candidate.source_excerpt,
      targetSkill: candidate.target_skill ?? inferSkillKeyHints(candidate.title, candidate.content ?? candidate.source_excerpt)[0] ?? "unknown",
      targetSkillPath: candidate.target_skill_path ?? null,
      changeType: candidate.change_type ?? "update",
      currentSection: candidate.current_section ?? null,
      currentText: candidate.current_text ?? null,
      currentGap: candidate.current_gap ?? null,
      proposedText: candidate.proposed_text ?? candidate.content ?? candidate.source_excerpt,
      proposedPatch: candidate.proposed_patch ?? null,
      validationMethod: candidate.validation_method ?? null,
      rationale: candidate.rationale ?? null,
      proposalQuality: candidate.proposal_quality ?? "actionable",
      originScope: candidate.origin_scope,
      governanceLevel: candidate.governance_level,
      availabilityScope: candidate.availability_scope,
      promotionStatus: candidate.promotion_status,
      mergedSourceCount: candidate.merged_source_count ?? 1,
      sourceRefs: candidate.source_refs ?? [
        {
          source_kind: candidate.source_kind,
          source_timestamp: candidate.source_timestamp,
          source_excerpt: candidate.source_excerpt
        }
      ],
      host: hostName as HostCaptureName,
      threadId: virtualPreview.thread_id,
      description: candidate.description ?? null,
      applicableScenarios: candidate.applicable_scenarios ?? null,
      nonApplicableScenarios: candidate.non_applicable_scenarios ?? null,
      executionSteps: candidate.execution_steps ?? null
    });
    skillProposalIds.push(proposalId);
    skillProposalItems.push({
      id: proposalId,
      title: candidate.title,
      target_skill: candidate.target_skill ?? inferSkillKeyHints(candidate.title, candidate.content ?? candidate.source_excerpt)[0] ?? "unknown",
      target_skill_path: candidate.target_skill_path ?? null,
      change_type: candidate.change_type ?? "update",
      current_section: candidate.current_section ?? null,
      current_text: candidate.current_text ?? null,
      current_gap: candidate.current_gap ?? null,
      proposed_text: candidate.proposed_text ?? candidate.content ?? candidate.source_excerpt,
      proposed_patch: candidate.proposed_patch ?? null,
      validation_method: candidate.validation_method ?? null,
      rationale: candidate.rationale ?? null,
      proposal_quality: candidate.proposal_quality ?? "actionable",
      origin_scope: candidate.origin_scope,
      governance_level: candidate.governance_level,
      availability_scope: candidate.availability_scope,
      promotion_status: candidate.promotion_status,
      merged_source_count: candidate.merged_source_count ?? 1,
      source_refs: candidate.source_refs ?? [
        {
          source_kind: candidate.source_kind,
          source_timestamp: candidate.source_timestamp,
          source_excerpt: candidate.source_excerpt
        }
      ],
      source_excerpt: candidate.source_excerpt,
      skill_key_hints: inferSkillKeyHints(
        candidate.title,
        `${candidate.target_skill ?? ""} ${candidate.proposed_text ?? candidate.content ?? candidate.source_excerpt}`
      ),
      description: candidate.description ?? null,
      applicable_scenarios: candidate.applicable_scenarios ?? null,
      non_applicable_scenarios: candidate.non_applicable_scenarios ?? null,
      execution_steps: candidate.execution_steps ?? null
    });
  }

  if (extractionPreview.governance_evidence_candidates.length > 0) {
    governanceEvidenceBundleId = await createKnowledgeContextBundle({
      tenantId: input.tenantId,
      scope: input.scope,
      requestRef: taskRequestId,
      bundleType: "governance_evidence_bundle",
      summary: `${hostName} host governance collected ${extractionPreview.governance_evidence_candidates.length} governance evidence items for later synthesis and review.`,
      warnings: [],
      evidenceRefs: extractionPreview.governance_evidence_candidates.map((candidate) => ({
        title: candidate.title,
        evidence_category: candidate.evidence_category ?? null,
        source_kind: candidate.source_kind,
        source_timestamp: candidate.source_timestamp,
        source_excerpt: candidate.source_excerpt,
        reason: candidate.reason,
        confidence: candidate.confidence
      })),
      assemblyTrace: {
        host: hostName,
        thread_id: virtualPreview.thread_id,
        session_file: virtualPreview.session_file,
        evidence_candidate_count: extractionPreview.governance_evidence_candidates.length,
        evidence_titles: extractionPreview.governance_evidence_candidates.map((candidate) => candidate.title),
        evidence_categories: extractionPreview.governance_evidence_candidates.map((candidate) => ({
          title: candidate.title,
          category: candidate.evidence_category ?? null
        }))
      },
      traceId: input.traceId
    });
  } else {
    warnings.push("No governance evidence candidates were collected from the extraction preview.");
  }

  let governanceJobId: string | null = null;
  const knowledgeCandidates = extractionPreview.knowledge_candidates;
  if (knowledgeCandidates.length > 0) {
    governanceJobId = await createKnowledgeGovernanceJob({
      tenantId: input.tenantId,
      scope: input.scope,
      jobType: "host_capture_session_governance",
      triggerType: "manual_run",
      triggerRef: virtualPreview.thread_id,
      targetObjectType: `${hostName}_thread`,
      targetObjectIds: [],
      priority: 70,
      requestedBy: "api",
      payload: {
        host: hostName,
        thread_id: virtualPreview.thread_id,
        thread_name: virtualPreview.thread_name,
        session_file: virtualPreview.session_file
      },
      traceId: input.traceId
    });

    await markKnowledgeGovernanceJobRunning({ jobId: governanceJobId });

    for (const candidate of knowledgeCandidates) {
      const canonicalContent = candidate.content ?? candidate.source_excerpt;
      requirePresentFields("knowledge_candidate", synthesizedKnowledgeIds.length, candidate.title, canonicalContent);
      const knowledgeTypeResult = normalizeKnowledgeType(candidate.knowledge_type);
      if (!knowledgeTypeResult.valid) {
        warnings.push(
          `[P0-b] Invalid knowledge_type "${String(candidate.knowledge_type)}" for "${candidate.title}". ` +
            `Normalized to "${knowledgeTypeResult.type}" and quarantined for review.`
        );
      }
      const promotionState = resolveKnowledgePromotionState(governanceMode, candidate.promotion_status, {
        knowledgeTypeValid: knowledgeTypeResult.valid
      });
      const evidenceId = await createKnowledgeEvidence({
        tenantId: input.tenantId,
        scope: input.scope,
        memoryDomain: "knowledge",
        evidenceType: "host_capture_excerpt",
        sourceType: `${hostName}_session`,
        sourceUri: buildSourceRef(virtualPreview.session_file, candidate.source_timestamp, candidate.source_kind),
        rawRef: virtualPreview.thread_id,
        contentExcerpt: candidate.source_excerpt,
        contentHash: sha256(candidate.source_excerpt),
        metadata: {
          title: candidate.title,
          reason: candidate.reason,
          source_kind: candidate.source_kind,
          thread_id: virtualPreview.thread_id,
          source_session_file: virtualPreview.session_file,
          origin_scope: candidate.origin_scope,
          governance_level: candidate.governance_level,
          availability_scope: candidate.availability_scope,
          promotion_status: candidate.promotion_status
        },
        traceId: input.traceId
      });
      evidenceIds.push(evidenceId);
      const synthesized = await createSynthesizedKnowledge({
        tenantId: input.tenantId,
        scope: input.scope,
        memoryDomain: "knowledge",
        knowledgeType: knowledgeTypeResult.type,
        title: candidate.title,
        content: canonicalContent,
        normalizedContent: normalizeText(canonicalContent),
        lifecycleState: promotionState.lifecycleState,
        reviewState: promotionState.reviewState,
        recallState: promotionState.recallState,
        sourceObjectIds: [virtualPreview.thread_id],
        evidenceIds: [evidenceId],
        reasoningSummary:
          "Derived from host task execution records. This is promoted only when execution outputs contain reusable external or cross-task knowledge.",
        confidenceScore: candidate.confidence === "high" ? 0.9 : candidate.confidence === "medium" ? 0.78 : 0.62,
        riskLevel: candidate.promotion_status === "needs_review" ? "medium" : "low",
        governanceJobId,
        metadata: {
          source_kind: candidate.source_kind,
          host: hostName,
          thread_id: virtualPreview.thread_id,
          source_session_file: virtualPreview.session_file,
          origin_scope: candidate.origin_scope,
          governance_level: candidate.governance_level,
          availability_scope: candidate.availability_scope,
          promotion_status: candidate.promotion_status,
          governance_mode: governanceMode,
          source_excerpt: candidate.source_excerpt,
          source_refs: candidate.source_refs ?? [
            {
              source_kind: candidate.source_kind,
              source_timestamp: candidate.source_timestamp,
              source_excerpt: candidate.source_excerpt
            }
          ],
        },
        traceId: input.traceId
      });
      if (synthesized.existed) {
        continue;
      }
      synthesizedKnowledgeIds.push(synthesized.id);
      knowledgeItems.push({
        id: synthesized.id,
        title: candidate.title,
        content: canonicalContent,
        knowledge_type: knowledgeTypeResult.type
      });
    }
  }

  // P0-a backstop: rules_fallback must not leave any output active.
  if (governanceMode === "rules_fallback") {
    await quarantineFallbackOutputs({
      tenantId: input.tenantId,
      scope: input.scope,
      traceId: input.traceId,
      ruleIds,
      memoryIds,
      skillProposalIds,
      synthesizedKnowledgeIds
    });
  }

  const contextBundleId = await createKnowledgeContextBundle({
    tenantId: input.tenantId,
    scope: input.scope,
    requestRef: taskRequestId,
    bundleType: "host_capture_governance_summary",
    summary: `${hostName} host governance processed ${ruleIds.length} rules, ${memoryIds.length} memories, ${skillProposalIds.length} skill proposals, and ${synthesizedKnowledgeIds.length} synthesized knowledge objects.`,
    warnings,
    assemblyTrace: {
      host: hostName,
      thread_id: virtualPreview.thread_id,
      session_file: virtualPreview.session_file,
      governance_evidence_bundle_id: governanceEvidenceBundleId,
      rule_ids: ruleIds,
      memory_ids: memoryIds,
      skill_proposal_ids: skillProposalIds,
      synthesized_knowledge_ids: synthesizedKnowledgeIds,
      evidence_ids: evidenceIds,
      governance_decision_ids: governanceDecisionIds
    },
    traceId: input.traceId
  });

  // Build acceptance_report and finalize governance job in DB
  const acceptanceReport = {
    inputs_read: {
      user_message_count: 0,
      commentary_signal_count: 0,
      command_count: 0,
      tool_call_count: 0,
      mcp_call_count: 0
    },
    governance_candidates: {
      rule_count: extractionPreview.rule_candidates.length,
      memory_count: extractionPreview.memory_candidates.length,
      skill_proposal_count: extractionPreview.skill_proposal_candidates.length,
      knowledge_count: extractionPreview.knowledge_candidates.length,
      governance_evidence_count: extractionPreview.governance_evidence_candidates.length
    },
    promoted_outputs: {
      rule_count: ruleIds.length,
      long_term_memory_count: memoryIds.length,
      skill_proposal_count: skillProposalIds.length,
      synthesized_knowledge_count: synthesizedKnowledgeIds.length
    },
    governance_evidence_retained: extractionPreview.governance_evidence_candidates.map((candidate) => ({
      title: candidate.title,
      evidence_category: candidate.evidence_category ?? null,
      source_kind: candidate.source_kind,
      source_excerpt: candidate.source_excerpt
    })),
    discarded_or_not_promoted: {
      knowledge_candidates_not_promoted: Math.max(0, extractionPreview.knowledge_candidates.length - synthesizedKnowledgeIds.length),
      governance_candidates_left_as_evidence_only: extractionPreview.governance_evidence_candidates.length
    },
    incremental: {
      new_candidate_count:
        extractionPreview.rule_candidates.length +
        extractionPreview.memory_candidates.length +
        extractionPreview.skill_proposal_candidates.length +
        extractionPreview.knowledge_candidates.length +
        extractionPreview.governance_evidence_candidates.length,
      skipped_previously_governed_count:
        existingMemoryFilter.skippedExistingMemoryCount +
        existingRuleFilter.skippedExistingRuleCount +
        existingSkillProposalFilter.skippedExistingSkillProposalCount
    }
  };

  if (governanceJobId) {
    await finalizeKnowledgeGovernanceJob({
      jobId: governanceJobId,
      runStatus: "completed",
      resultPayload: acceptanceReport
    });
  }

  // ── L3 + L4: 演进扫描 + 认知引擎（写入后） ──────────
  let pipelineResult: {
    l2: { skipped_count: number; merged_count: number; conflict_proposal_count: number; skipped_titles: string[] };
    l3: { signals_count: number; relations_count: number; proposal_ids: string[] };
    l4: { hypotheses_count: number; synthesized_knowledge_ids: string[]; proposal_ids: string[]; meta_cognition: Record<string, unknown> };
  } | null = null;

  try {
    const l3Result = await scanEvolution({
      tenantId: input.tenantId,
      scope: input.scope,
      traceId: input.traceId,
      newRuleIds: ruleIds,
      newMemoryIds: memoryIds,
      newSkillIds: skillProposalIds,
      newKnowledgeIds: synthesizedKnowledgeIds,
    });

    const l4Result = await runCognitiveEngine({
      tenantId: input.tenantId,
      scope: input.scope,
      traceId: input.traceId,
      newRuleIds: ruleIds,
      newMemoryIds: memoryIds,
      newSkillIds: skillProposalIds,
      newKnowledgeIds: synthesizedKnowledgeIds,
      l3Signals: l3Result.signals.map((s) => ({
        entryId: s.entryId,
        layer: s.layer,
        signalKind: s.signalKind,
        signalData: s.signalData,
        title: s.title,
        content: s.content,
      })),
    });

    pipelineResult = {
      l2: {
        skipped_count: l2SkippedTitles.length,
        merged_count: l2MergedCount,
        conflict_proposal_count: l2ConflictProposalCount,
        skipped_titles: l2SkippedTitles,
      },
      l3: {
        signals_count: l3Result.signals.length,
        relations_count: l3Result.relations.length,
        proposal_ids: l3Result.proposalIds,
      },
      l4: {
        hypotheses_count: l4Result.hypotheses.length,
        synthesized_knowledge_ids: l4Result.synthesizedKnowledgeIds,
        proposal_ids: l4Result.proposalIds,
        meta_cognition: l4Result.metaCognition,
      },
    };
  } catch (error) {
    warnings.push(`[pipeline] L3/L4 failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    host: hostName,
    task_request_id: taskRequestId,
    governance_job_id: governanceJobId,
    pipeline: pipelineResult,
    persisted: {
      rule_ids: ruleIds,
      rule_items: ruleItems,
      memory_ids: memoryIds,
      memory_items: memoryItems,
      memory_candidate_ids: memoryCandidateIds,
      skill_proposal_ids: skillProposalIds,
      skill_proposal_items: skillProposalItems,
      synthesized_knowledge_ids: synthesizedKnowledgeIds,
      knowledge_items: knowledgeItems,
      evidence_ids: evidenceIds,
      governance_evidence_bundle_id: governanceEvidenceBundleId,
      governance_decision_ids: governanceDecisionIds,
      context_bundle_id: contextBundleId
    },
    acceptance_report: {
      inputs_read: {
        user_message_count: 0,
        commentary_signal_count: 0,
        command_count: 0,
        tool_call_count: 0,
        mcp_call_count: 0
      },
      governance_candidates: {
        rule_count: extractionPreview.rule_candidates.length,
        memory_count: extractionPreview.memory_candidates.length,
        skill_proposal_count: extractionPreview.skill_proposal_candidates.length,
        knowledge_count: extractionPreview.knowledge_candidates.length,
        governance_evidence_count: extractionPreview.governance_evidence_candidates.length
      },
      governance_evidence_retained: extractionPreview.governance_evidence_candidates.map((candidate) => ({
        title: candidate.title,
        evidence_category: candidate.evidence_category ?? null,
        source_kind: candidate.source_kind,
        source_excerpt: candidate.source_excerpt
      })),
      promoted_outputs: {
        rule_count: ruleIds.length,
        long_term_memory_count: memoryIds.length,
        skill_proposal_count: skillProposalIds.length,
        synthesized_knowledge_count: synthesizedKnowledgeIds.length
      },
      retained_non_answering_layers: {
        governance_evidence_bundle_id: governanceEvidenceBundleId
      },
      discarded_or_not_promoted: {
        knowledge_candidates_not_promoted: Math.max(0, extractionPreview.knowledge_candidates.length - synthesizedKnowledgeIds.length),
        governance_candidates_left_as_evidence_only: extractionPreview.governance_evidence_candidates.length
      },
      incremental: {
        new_candidate_count:
          extractionPreview.rule_candidates.length +
          extractionPreview.memory_candidates.length +
          extractionPreview.skill_proposal_candidates.length +
          extractionPreview.knowledge_candidates.length +
          extractionPreview.governance_evidence_candidates.length,
        skipped_previously_governed_count:
          existingMemoryFilter.skippedExistingMemoryCount +
          existingRuleFilter.skippedExistingRuleCount +
          existingSkillProposalFilter.skippedExistingSkillProposalCount
      },
      governance_model: {
        mode: governanceMode,
        model_ref: null,
        generated_at: null,
        accepted: true,
        warning: governanceMode === "rules_fallback" ? "rules_fallback: outputs quarantined for review" : null
      }
    },
    warnings
  };
}

function buildStableKey(prefix: string, ...parts: string[]): string {
  return `${prefix}-${sha256(parts.join("\n")).slice(0, 12)}`;
}

function buildSourceRef(sessionFile: string, timestamp: string, sourceKind: SourceKind): string {
  return `${sessionFile}#${sourceKind}@${timestamp}`;
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function filterNewGovernanceCandidates(input: {
  tenantId: string;
  scope: string;
  traceId: string;
  preview: {
    host: HostCaptureName;
    thread_id: string;
    session_file: string;
  };
  batch: GovernanceBatchPreviewResponse;
}): Promise<{
  extraction_preview: ExtractionPreview;
  newCandidateCount: number;
  skippedCandidateCount: number;
}> {
  const pool = getPool();
  const output: ExtractionPreview = {
    rule_candidates: [],
    memory_candidates: [],
    skill_proposal_candidates: [],
    knowledge_candidates: [],
    governance_evidence_candidates: []
  };
  let newCandidateCount = 0;
  let skippedCandidateCount = 0;

  const buckets: Array<keyof ExtractionPreview> = [
    "rule_candidates",
    "memory_candidates",
    "skill_proposal_candidates",
    "knowledge_candidates",
    "governance_evidence_candidates"
  ];
  for (const bucket of buckets) {
    for (const candidate of input.batch.extraction_preview[bucket]) {
      const eventHash = buildCandidateEventHash(input.preview, candidate);
      const result = await pool.query<{ id: string }>(
        `
        INSERT INTO host_governance_event (
          tenant_id, scope, host, thread_id, session_file, source_kind,
          source_timestamp, candidate_type, event_hash, origin_scope,
          governance_level, availability_scope, promotion_status, metadata, trace_id
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7::timestamptz, $8, $9, $10,
          $11, $12, $13, $14::jsonb, $15
        )
        ON CONFLICT (tenant_id, scope, host, event_hash) DO NOTHING
        RETURNING id
        `,
        [
          input.tenantId,
          input.scope,
          input.preview.host,
          input.preview.thread_id,
          input.preview.session_file,
          candidate.source_kind,
          candidate.source_timestamp,
          candidate.candidate_type,
          eventHash,
          candidate.origin_scope,
          candidate.governance_level,
          candidate.availability_scope,
          candidate.promotion_status,
          JSON.stringify({
            title: candidate.title,
            content: candidate.content ?? null,
            source_excerpt: candidate.source_excerpt,
            rule_domain: candidate.rule_domain ?? null,
            rule_scope: candidate.rule_scope ?? null
          }),
          input.traceId
        ]
      );
      if (result.rowCount === 0) {
        skippedCandidateCount += 1;
        continue;
      }
      output[bucket].push(candidate as never);
      newCandidateCount += 1;
    }
  }

  return { extraction_preview: output, newCandidateCount, skippedCandidateCount };
}

async function filterExistingFactualMemoryCandidates(input: {
  tenantId: string;
  scope: string;
  extractionPreview: ExtractionPreview;
}): Promise<{ memoryCandidates: ExtractionPreview["memory_candidates"]; skippedExistingMemoryCount: number }> {
  const pool = getPool();
  const memoryCandidates: ExtractionPreview["memory_candidates"] = [];
  let skippedExistingMemoryCount = 0;

  for (const candidate of input.extractionPreview.memory_candidates) {
    const canonicalContent = candidate.content ?? candidate.source_excerpt;
    const normalizedMemoryContent = normalizeMemoryContent(candidate.title, canonicalContent);
    const normalizedContent = normalizeText(normalizedMemoryContent);
    // 候选 memory_type 是业务类型（user_memory/project_memory 等），与 DB memory.memory_type 字段一致。
    // 历史 bug：原 SQL 写死 memory_type='factual'，而 factual 从未真正写入 DB（VALID_MEMORY_TYPES 不含），
    // 导致去重永远查不到已存在记录，重复写入。现在按候选自身 memory_type 精确匹配；未指定时退到 session_memory（适配器默认值）。
    const candidateMemoryType = candidate.memory_type ?? "session_memory";
    const existing = await pool.query<{ id: string }>(
      `
      SELECT id
      FROM memory
      WHERE tenant_id = $1
        AND scope = $2
        AND status = 'active'
        AND memory_type = $3
        AND normalized_content = $4
      LIMIT 1
      `,
      [input.tenantId, input.scope, candidateMemoryType, normalizedContent]
    );
    if (existing.rowCount && existing.rows[0]) {
      skippedExistingMemoryCount += 1;
      continue;
    }
    memoryCandidates.push(candidate);
  }

  return { memoryCandidates, skippedExistingMemoryCount };
}

async function filterExistingRuleCandidates(input: {
  tenantId: string;
  scope: string;
  extractionPreview: ExtractionPreview;
}): Promise<{ ruleCandidates: ExtractionPreview["rule_candidates"]; skippedExistingRuleCount: number }> {
  const pool = getPool();
  const ruleCandidates: ExtractionPreview["rule_candidates"] = [];
  let skippedExistingRuleCount = 0;

  for (const candidate of input.extractionPreview.rule_candidates) {
    const canonicalContent = candidate.content ?? candidate.source_excerpt;
    const normalizedStatement = normalizeText(canonicalContent);
    const existing = await pool.query<{ id: string }>(
      `
      SELECT id
      FROM rule
      WHERE tenant_id = $1
        AND scope = $2
        AND status = 'active'
        AND normalized_statement = $3
      LIMIT 1
      `,
      [input.tenantId, input.scope, normalizedStatement]
    );
    if (existing.rowCount && existing.rows[0]) {
      skippedExistingRuleCount += 1;
      continue;
    }
    ruleCandidates.push(candidate);
  }

  return { ruleCandidates, skippedExistingRuleCount };
}

async function filterExistingSkillProposalCandidates(input: {
  tenantId: string;
  scope: string;
  extractionPreview: ExtractionPreview;
}): Promise<{
  skillProposalCandidates: ExtractionPreview["skill_proposal_candidates"];
  skippedExistingSkillProposalCount: number;
}> {
  const pool = getPool();
  const skillProposalCandidates: ExtractionPreview["skill_proposal_candidates"] = [];
  let skippedExistingSkillProposalCount = 0;

  for (const candidate of input.extractionPreview.skill_proposal_candidates) {
    const targetSkill = candidate.target_skill ?? inferSkillKeyHints(candidate.title, candidate.content ?? candidate.source_excerpt)[0] ?? "unknown";
    const proposedText = candidate.proposed_text ?? candidate.content ?? candidate.source_excerpt;
    const existing = await pool.query<{ id: string }>(
      `
      SELECT id
      FROM governance_change_proposal
      WHERE tenant_id = $1
        AND scope = $2
        AND target_object_type = 'skill'
        AND proposed_action = 'skill_update_proposal'
        AND proposed_payload->>'target_skill' = $3
        AND proposed_payload->>'proposed_text' = $4
      LIMIT 1
      `,
      [input.tenantId, input.scope, targetSkill, proposedText]
    );
    if (existing.rowCount && existing.rows[0]) {
      skippedExistingSkillProposalCount += 1;
      continue;
    }
    skillProposalCandidates.push(candidate);
  }

  return { skillProposalCandidates, skippedExistingSkillProposalCount };
}

function buildCandidateEventHash(preview: { host: string; thread_id: string; session_file: string }, candidate: CandidatePreview): string {
  return sha256(
    [
      preview.host,
      preview.thread_id,
      preview.session_file,
      candidate.candidate_type,
      candidate.source_kind,
      candidate.source_timestamp,
      candidate.title,
      candidate.content ?? "",
      candidate.proposed_text ?? "",
      candidate.source_excerpt
    ].join("\n")
  );
}

function inferRuleEnforcement(text: string): "must" | "must_not" {
  // 硬拦截：所有治理抽取的规则统一为 must，禁止 must_not
  return "must";
}

function inferMemoryArtifactTag(title: string, content: string): string {
  const normalized = `${title} ${content}`.toLowerCase();
  if (normalized.includes("workspace") || normalized.includes("本机") || normalized.includes("链満") || normalized.includes("项目路径") || normalized.includes("d:\\workspace")) {
    return "environment_fact";
  }
  return "implementation_note";
}

function buildMemoryCandidatePayload(input: {
  preview: {
    host: HostCaptureName;
    thread_id: string;
    thread_name: string | null;
    session_file: string;
  };
  candidate: CandidatePreview;
  title: string;
  content: string;
  factType: string;
}): Record<string, unknown> {
  return {
    title: input.title,
    content: input.content,
    statement: input.content,
    summary: input.content,
    fact_type: input.factType,
    host: input.preview.host,
    thread_id: input.preview.thread_id,
    thread_name: input.preview.thread_name,
    session_file: input.preview.session_file,
    source_kind: input.candidate.source_kind,
    source_timestamp: input.candidate.source_timestamp,
    candidate_hash: sha256(`${input.preview.thread_id}\n${input.candidate.title}\n${input.content}`)
  };
}

function normalizeMemoryContent(title: string, excerpt: string): string {
  if (title === "项目路径上下文" || title === "工作空间路径上下文" || title === "工作空间上下文") {
    const match = excerpt.match(/[A-Za-z]:\\[A-Za-z0-9_. ()\-\[\]]+(?:\\[A-Za-z0-9_. ()\-\[\]]+)*/);
    if (match?.[0]) {
      return match[0].trim();
    }
  }
  return excerpt;
}

async function createSkillProposal(input: {
  tenantId: string;
  scope: string;
  traceId: string;
  title: string;
  sourceRef: string;
  sourceExcerpt: string;
  targetSkill: string;
  targetSkillPath: string | null;
  changeType: string;
  currentSection: string | null;
  currentText: string | null;
  currentGap: string | null;
  proposedText: string;
  proposedPatch: string | null;
  validationMethod: string | null;
  rationale: string | null;
  proposalQuality: string;
  originScope: string;
  governanceLevel: string;
  availabilityScope: string;
  promotionStatus: string;
  mergedSourceCount: number;
  sourceRefs: Array<{
    source_kind: SourceKind;
    source_timestamp: string;
    source_excerpt: string;
  }>;
  host: HostCaptureName;
  threadId: string;
  description: string | null;
  applicableScenarios: string[] | null;
  nonApplicableScenarios: string[] | null;
  executionSteps: string[] | null;
}): Promise<string> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO governance_change_proposal (
      tenant_id, scope, status, version, target_object_type, target_object_id,
      proposed_action, proposed_payload, reason, risk_level, source_ref,
      origin_scope, governance_level, availability_scope, promotion_status, trace_id
    )
    VALUES (
      $1, $2, 'recorded', 1, 'skill', NULL,
      'skill_update_proposal', $3::jsonb, '技能变更需要人工审批', 'medium', $4,
      $5, $6, $7, $8, $9
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      JSON.stringify({
        title: input.title,
        target_skill: input.targetSkill,
        target_skill_path: input.targetSkillPath,
        change_type: input.changeType,
        current_section: input.currentSection,
        current_text: input.currentText,
        current_gap: input.currentGap,
        proposed_text: input.proposedText,
        proposed_patch: input.proposedPatch,
        validation_method: input.validationMethod,
        rationale: input.rationale,
        proposal_quality: input.proposalQuality,
        origin_scope: input.originScope,
        governance_level: input.governanceLevel,
        availability_scope: input.availabilityScope,
        promotion_status: input.promotionStatus,
        merged_source_count: input.mergedSourceCount,
        source_refs: input.sourceRefs,
        description: input.description,
        applicable_scenarios: input.applicableScenarios,
        non_applicable_scenarios: input.nonApplicableScenarios,
        execution_steps: input.executionSteps,
        model_adapter: {
          mode: "rules_fallback",
          status: "available_for_external_llm",
          note: "The governance layer can replace this deterministic proposal builder with a model adapter without changing the persisted payload contract."
        },
        source_excerpt: input.sourceExcerpt,
        skill_key_hints: inferSkillKeyHints(input.title, `${input.targetSkill} ${input.proposedText}`),
        host: input.host,
        thread_id: input.threadId
      }),
      input.sourceRef,
      input.originScope,
      input.governanceLevel,
      input.availabilityScope,
      input.promotionStatus,
      input.traceId
    ]
  );
  return result.rows[0].id;
}

function inferSkillKeyHints(title: string, excerpt: string): string[] {
  const normalized = `${title} ${excerpt}`.toLowerCase();
  const hints = new Set<string>();
  if (normalized.includes("interview")) {
    hints.add("interview");
  }
  if (normalized.includes("spec")) {
    hints.add("interview");
  }
  if (normalized.includes("governance") || normalized.includes("治理") || normalized.includes("娌荤悊")) {
    hints.add("memory-governance-guidelines");
  }
  if (normalized.includes("retrieve") || normalized.includes("召回") || normalized.includes("鍙洖")) {
    hints.add("memory-retrieval-guidelines");
  }
  if (normalized.includes("ingest") || normalized.includes("写入") || normalized.includes("鍐欏叆")) {
    hints.add("memory-ingestion-guidelines");
  }
  if (hints.size === 0) {
    hints.add("interview");
  }
  return [...hints];
}
