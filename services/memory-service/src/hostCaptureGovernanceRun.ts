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
import { buildGovernanceBatchPreview, type GovernanceBatchPreviewResponse } from "./hostCaptureGovernanceBatch.js";
import { applyHostModelGovernanceResult } from "./hostModelGovernanceAdapter.js";

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
    }>;
    synthesized_knowledge_ids: string[];
    knowledge_items: Array<{ id: string; title: string; content: string }>;
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

export async function runCodexHostGovernance(input: {
  tenantId: string;
  scope: string;
  traceId: string;
  body: HostGovernanceRunRequest;
}): Promise<HostGovernanceRunResponse> {
  const preview = await previewHostCapture(input.body);
  const fallbackBatch = buildGovernanceBatchPreview(preview);
  const { batch, modelAdapter } = applyHostModelGovernanceResult({
    batch: fallbackBatch,
    governanceMode: input.body.governance_mode ?? "rules_fallback",
    hostModelResult: input.body.host_model_result ?? null
  });
  const taskRequestId = input.body.task_request_id?.trim() || randomUUID();
  const warnings = [...batch.ingestion_readiness.warnings];
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
      threadId: preview.thread_id
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
      )
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
        knowledgeType: "execution_derived_knowledge",
        title: candidate.title,
        content: canonicalContent,
        normalizedContent: normalizeText(canonicalContent),
        lifecycleState: "curated",
        reviewState: candidate.promotion_status === "needs_review" ? "pending_review" : "model_accepted",
        recallState: candidate.promotion_status === "rejected" ? "inactive" : "active",
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
        content: canonicalContent
      });
    }
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
  persisted: HostGovernanceRunResponse["persisted"];
  acceptance_report: HostGovernanceRunResponse["acceptance_report"];
  warnings: string[];
};

export async function runGovernanceFromExtraction(input: GovernanceFromExtractionInput): Promise<GovernanceFromExtractionResponse> {
  const hostName = input.host ?? "generic";
  const taskRequestId = input.task_request_id?.trim() || randomUUID();
  const warnings: string[] = [];

  // Use the extraction_preview directly — skip previewHostCapture,
  // buildGovernanceBatchPreview, applyHostModelGovernanceResult,
  // and filterNewGovernanceCandidates (no Codex session to dedup against).
  const extractionPreview: ExtractionPreview = {
    rule_candidates: input.extraction_preview.rule_candidates ?? [],
    memory_candidates: input.extraction_preview.memory_candidates ?? [],
    skill_proposal_candidates: input.extraction_preview.skill_proposal_candidates ?? [],
    knowledge_candidates: input.extraction_preview.knowledge_candidates ?? [],
    governance_evidence_candidates: input.extraction_preview.governance_evidence_candidates ?? []
  };

  // Build a virtual preview object for persistence references that
  // normally come from the Codex session file.
  const virtualPreview = {
    host: hostName as HostCaptureName,
    thread_id: `generic-${taskRequestId}`,
    thread_name: null as string | null,
    session_file: `generic-extraction://${taskRequestId}`
  };

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
      threadId: virtualPreview.thread_id
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
      )
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
        knowledgeType: "execution_derived_knowledge",
        title: candidate.title,
        content: canonicalContent,
        normalizedContent: normalizeText(canonicalContent),
        lifecycleState: "curated",
        reviewState: candidate.promotion_status === "needs_review" ? "pending_review" : "model_accepted",
        recallState: candidate.promotion_status === "rejected" ? "inactive" : "active",
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
        content: canonicalContent
      });
    }
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

  return {
    host: hostName,
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
        mode: input.governance_mode ?? "host_model",
        model_ref: null,
        generated_at: null,
        accepted: true,
        warning: null
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
    const existing = await pool.query<{ id: string }>(
      `
      SELECT id
      FROM memory
      WHERE tenant_id = $1
        AND scope = $2
        AND status = 'active'
        AND memory_type = 'factual'
        AND normalized_content = $3
      LIMIT 1
      `,
      [input.tenantId, input.scope, normalizedContent]
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
  const normalized = normalizeText(text);
  if (normalized.includes("不要") || normalized.includes("不允许") || normalized.includes("must_not") || normalized.includes("must not") || normalized.includes("涓嶈")) {
    return "must_not";
  }
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
  if (title === "Project path context" || title === "Workspace path context" || title === "Workspace context") {
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
      'skill_update_proposal', $3::jsonb, 'host_capture_skill_refinement_requires_human_approval', 'medium', $4,
      $5, $6, $7, $8, $9
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      JSON.stringify({
        proposal_title: input.title,
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
