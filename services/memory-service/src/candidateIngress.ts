import type {
  MemoryCandidateRequest,
  MemoryCandidateResponse,
} from "@super-agent/contracts";
import {
  createMemoryCandidate,
  createOrReplaceFactualMemory,
  ensureMemoryCandidateTaskEnvelope,
  updateMemoryCandidate,
  upsertEnvironmentFingerprint,
} from "@super-agent/db";
import type { CandidateRanker } from "./candidateRanker.js";
import { persistCandidateProvenance } from "./candidateProvenance.js";
import type { MemoryExtractor } from "./memoryExtractor.js";
import type { MemoryRouter } from "./memoryRouter.js";
import type { RuleBuilder } from "./ruleBuilder.js";
import type { SkillBuilder } from "./skillBuilder.js";

export async function handleCandidateIngress(input: {
  tenantId: string;
  scope: string;
  traceId: string;
  body: MemoryCandidateRequest;
  extractor: MemoryExtractor;
  ranker: CandidateRanker;
  router: MemoryRouter;
  ruleBuilder: RuleBuilder;
  skillBuilder: SkillBuilder;
}): Promise<MemoryCandidateResponse> {
  if (input.body.fingerprint) {
    await upsertEnvironmentFingerprint({
      tenantId: input.tenantId,
      scope: input.scope,
      fingerprintKey: input.body.fingerprint,
      capabilityVersion: "memory-v3",
      configHash: "local-dev",
      schemaVersion: "v1",
      dependencySignature: "local-fallback",
      deploymentBaselineId: "memory-validation",
      status: "active",
      traceId: input.traceId,
    });
  }

  const candidate = input.extractor.extract(input.body);

  // §Fix-1: 防御性校验 — layer 和 artifact_tag 语义不一致时直接拒绝
  if (candidate.layer && candidate.artifact_tag) {
    const layerTagConsistent = checkLayerArtifactTagConsistency(candidate.layer, candidate.artifact_tag);
    if (!layerTagConsistent.consistent) {
      throw new Error(
        `LAYER_ARTIFACT_TAG_MISMATCH: layer="${candidate.layer}" but artifact_tag="${candidate.artifact_tag}". ` +
        `路由依据 layer 字段。${layerTagConsistent.reason}`
      );
    }
  }

  await ensureMemoryCandidateTaskEnvelope({
    tenantId: input.tenantId,
    scope: input.scope,
    taskRequestId: candidate.task_request_id,
    taskStepId: candidate.task_step_id,
    sourceRef: candidate.source_ref,
    artifactTag: candidate.artifact_tag,
    sideEffectClass: candidate.side_effect_class,
    traceId: input.traceId,
  });

  const rankScore = input.ranker.rank(candidate);
  const routed = input.router.route({
    ...candidate,
    rank_score: rankScore,
  });

  const created = await createMemoryCandidate({
    tenantId: input.tenantId,
    scope: input.scope,
    taskRequestId: candidate.task_request_id,
    taskStepId: candidate.task_step_id,
    sourceType: candidate.source_type,
    sourceRef: candidate.source_ref,
    artifactTag: candidate.artifact_tag,
    errorCode: candidate.error_code ?? null,
    verificationStatus: candidate.verification_status,
    sideEffectClass: candidate.side_effect_class,
    fingerprint: candidate.fingerprint ?? null,
    fingerprintStatus: candidate.fingerprint_status,
    routingDecision: routed.routingDecision,
    rankScore,
    candidatePayload: candidate.candidate_payload,
    llmRefinedPayload: candidate.llm_refined_payload,
    traceId: input.traceId,
  });

  let persistedObjectId: string | null = null;
  if (!created.existed) {
    if (routed.persistTarget === "memory") {
      persistedObjectId = await createOrReplaceFactualMemory({
        tenantId: input.tenantId,
        scope: input.scope,
        title: candidate.title,
        content: candidate.content,
        normalizedContent: candidate.content.toLowerCase(),
        sourceRef: candidate.source_ref,
        verificationStatus: candidate.verification_status,
        fingerprintRequirement:
          candidate.fingerprint_status === "matched_or_na"
            ? null
            : (candidate.fingerprint ?? null),
        tags: [candidate.artifact_tag, candidate.source_type, "memory-v3"],
        metadata: {
          candidate_id: created.id,
          candidate_hash: candidate.candidate_hash,
        },
        importance: rankScore,
        confidenceScore: Math.min(0.99, Math.max(0.5, rankScore / 100)),
        traceId: input.traceId,
      });
    } else if (routed.persistTarget === "rule") {
      persistedObjectId = await input.ruleBuilder.persist({
        tenantId: input.tenantId,
        scope: input.scope,
        candidate: {
          ...candidate,
          rank_score: rankScore,
        },
        traceId: input.traceId,
      });
    } else if (routed.persistTarget === "skill") {
      persistedObjectId = await input.skillBuilder.persist({
        tenantId: input.tenantId,
        scope: input.scope,
        candidate,
        traceId: input.traceId,
      });
    }

    // L1 写入后建立溯源链：
    //   a) evidence → rule/skill/memory（source_of）：这条规则从哪轮对话的哪句话抽的
    //   b) rule/skill/memory → entity（mentions）：这条规则提到了哪些技术实体
    // 失败不阻塞主流程(candidate 已写入,provenance 是增强信息),但接住返回值的 errors 记日志
    if (
      persistedObjectId &&
      (routed.persistTarget === "memory" ||
        routed.persistTarget === "rule" ||
        routed.persistTarget === "skill")
    ) {
      const provenanceResult = await persistCandidateProvenance({
        tenantId: input.tenantId,
        scope: input.scope,
        traceId: input.traceId,
        targetType: routed.persistTarget,
        targetId: persistedObjectId,
        title: candidate.title,
        content: candidate.content,
        sourceRef: candidate.source_ref,
        sourceType: candidate.source_type,
        artifactTag: candidate.artifact_tag,
      });
      if (provenanceResult.errors.length > 0) {
        console.warn(
          `[candidateIngress] provenance partial failure trace_id=${input.traceId} target=${routed.persistTarget}:${persistedObjectId} errors=${JSON.stringify(provenanceResult.errors)}`,
        );
      }
    }
  }

  await updateMemoryCandidate({
    candidateId: created.id,
    status: routed.candidateStatus,
    routingDecision: routed.routingDecision,
    rankScore,
  });

  return {
    accepted:
      routed.persistTarget !== "block" && routed.persistTarget !== "drop",
    candidate_hash: candidate.candidate_hash,
    candidate_id: created.id,
    candidate_status: routed.candidateStatus,
    routing_decision: routed.routingDecision,
    persist_target: routed.persistTarget,
    storage_decision: created.existed
      ? "idempotent-hit"
      : `single-tenant-${routed.persistTarget}`,
    persisted_object_id: persistedObjectId ?? undefined,
  };
}

function checkLayerArtifactTagConsistency(
  layer: string,
  artifactTag: string,
): { consistent: boolean; reason: string } {
  const ruleTags = new Set(["constraint_fact", "project_constraint", "rejection_preference", "policy_constraint", "quality_gate", "routing_rule", "retrieval_rule", "execution_boundary_rule"]);
  const memoryTags = new Set(["environment_fact", "profile_fact", "design_decision", "project_preference", "implementation_note"]);

  if (layer === "rule" && !ruleTags.has(artifactTag) && artifactTag !== "summary_only") {
    return { consistent: false, reason: `layer="rule" 应匹配 rule 类 artifact_tag（如 constraint_fact, quality_gate 等），但收到 "${artifactTag}"。` };
  }
  if (layer === "memory" && !memoryTags.has(artifactTag) && artifactTag !== "summary_only") {
    return { consistent: false, reason: `layer="memory" 应匹配 memory 类 artifact_tag（如 environment_fact, profile_fact 等），但收到 "${artifactTag}"。` };
  }
  if (layer === "skill" && artifactTag !== "workflow_tag=standard_path") {
    return { consistent: false, reason: `layer="skill" 应匹配 "workflow_tag=standard_path"，但收到 "${artifactTag}"。` };
  }
  return { consistent: true, reason: "" };
}
