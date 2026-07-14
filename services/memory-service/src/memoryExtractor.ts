import { createHash } from "node:crypto";
import type { MemoryCandidateRequest } from "@super-agent/contracts";
import { normalizeFingerprintStatus } from "./memoryPolicyEngine.js";
import type { NormalizedCandidate } from "./types.js";

export class MemoryExtractor {
  extract(request: MemoryCandidateRequest): NormalizedCandidate {
    const candidateHash = createHash("sha256")
      .update(`${request.source_ref}:${JSON.stringify(request.candidate_payload)}:${JSON.stringify(request.llm_refined_payload ?? {})}`)
      .digest("hex");

    const title =
      typeof request.candidate_payload.title === "string"
        ? String(request.candidate_payload.title)
        : `${request.artifact_tag}:${request.source_type}`;
    const content =
      typeof request.candidate_payload.content === "string"
        ? String(request.candidate_payload.content)
        : JSON.stringify(request.candidate_payload);

    return {
      ...request,
      layer: normalizeLayer((request as { layer?: unknown }).layer) ?? inferLayerFromArtifactTag(request.artifact_tag),
      fingerprint_status: normalizeFingerprintStatus(request.fingerprint_status, request.fingerprint),
      llm_refined_payload: request.llm_refined_payload ?? {},
      candidate_hash: candidateHash,
      title,
      content,
      candidate_payload: {
        ...request.candidate_payload,
        candidate_hash: candidateHash
      }
    };
  }
}

function inferLayerFromArtifactTag(artifactTag: string): "rule" | "memory" | "skill" | "knowledge" | "evidence" | null {
  const ruleTags = new Set(["constraint_fact", "project_constraint", "rejection_preference", "policy_constraint", "quality_gate", "routing_rule", "retrieval_rule", "execution_boundary_rule"]);
  const memoryTags = new Set(["environment_fact", "profile_fact", "design_decision", "project_preference", "implementation_note"]);
  if (ruleTags.has(artifactTag)) return "rule";
  if (memoryTags.has(artifactTag)) return "memory";
  if (artifactTag === "workflow_tag=standard_path") return "skill";
  return null;
}

// §Fix-1: 将原始 layer 值规范化为枚举类型，非法值返回 null
function normalizeLayer(value: unknown): "rule" | "memory" | "skill" | "knowledge" | "evidence" | null {
  if (value === "rule" || value === "memory" || value === "skill" || value === "knowledge" || value === "evidence") {
    return value;
  }
  return null;
}
