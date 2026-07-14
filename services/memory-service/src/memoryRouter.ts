import { isAllowlistErrorCode, isHighRiskCandidate } from "./memoryPolicyEngine.js";
import type { NormalizedCandidate, PersistTarget } from "./types.js";

const FACTUAL_MEMORY_ARTIFACT_TAGS = new Set([
  "environment_fact",
  "profile_fact",
  "design_decision",
  "project_preference",
  "implementation_note"
]);

const RULE_ARTIFACT_TAGS = new Set([
  "constraint_fact",
  "project_constraint",
  "rejection_preference",
  "policy_constraint",
  "quality_gate",
  "routing_rule",
  "retrieval_rule",
  "execution_boundary_rule"
]);

export class MemoryRouter {
  route(candidate: NormalizedCandidate): {
    routingDecision: string;
    persistTarget: PersistTarget;
    candidateStatus: "extracted" | "ranked" | "routed" | "persisted" | "dropped" | "blocked";
  } {
    const isMatched = candidate.fingerprint_status === "matched";
    const isMatchedOrNa = candidate.fingerprint_status === "matched" || candidate.fingerprint_status === "matched_or_na";

    // §Fix-1: layer 字段是路由权威。如果候选显式携带 layer，优先用 layer 路由。
    if (candidate.layer) {
      if (candidate.verification_status === "verified" && isMatchedOrNa) {
        if (candidate.layer === "rule") {
          return { routingDecision: "layer-rule-verified", persistTarget: "rule", candidateStatus: "persisted" };
        }
        if (candidate.layer === "skill") {
          return { routingDecision: "layer-skill-verified", persistTarget: "skill", candidateStatus: "persisted" };
        }
        if (candidate.layer === "memory") {
          return { routingDecision: "layer-memory-verified", persistTarget: "memory", candidateStatus: "persisted" };
        }
        if (candidate.layer === "knowledge") {
          return { routingDecision: "layer-knowledge-verified", persistTarget: "memory", candidateStatus: "persisted" };
        }
        if (candidate.layer === "evidence") {
          return { routingDecision: "layer-evidence-verified", persistTarget: "summary_only", candidateStatus: "dropped" };
        }
      }
      // layer 存在但未验证 → 落到后面的默认逻辑
    }

    if (isHighRiskCandidate(candidate.side_effect_class, candidate.verification_status) && !isMatchedOrNa) {
      return {
        routingDecision: "high-risk-unverified-mismatch",
        persistTarget: "block",
        candidateStatus: "blocked"
      };
    }

    if (
      FACTUAL_MEMORY_ARTIFACT_TAGS.has(candidate.artifact_tag) &&
      candidate.verification_status === "verified" &&
      isMatchedOrNa
    ) {
      return {
        routingDecision: "factual-verified",
        persistTarget: "memory",
        candidateStatus: "persisted"
      };
    }

    if (
      RULE_ARTIFACT_TAGS.has(candidate.artifact_tag) &&
      candidate.verification_status === "verified" &&
      isMatchedOrNa
    ) {
      return {
        routingDecision: "rule-verified",
        persistTarget: "rule",
        candidateStatus: "persisted"
      };
    }

    if (
      candidate.artifact_tag === "resident_hint" &&
      candidate.verification_status === "verified" &&
      Number(candidate.candidate_payload.hit_count ?? 0) >= 3
    ) {
      return {
        routingDecision: "resident-candidate",
        persistTarget: "resident_candidate",
        candidateStatus: "routed"
      };
    }

    if (isAllowlistErrorCode(candidate.error_code) && candidate.verification_status === "verified_fix" && isMatched) {
      return {
        routingDecision: "procedural-verified-fix",
        persistTarget: "skill",
        candidateStatus: "persisted"
      };
    }

    if (isAllowlistErrorCode(candidate.error_code) && candidate.verification_status === "verified_fix" && !isMatched) {
      return {
        routingDecision: "procedural-fix-summary-only",
        persistTarget: "summary_only",
        candidateStatus: "dropped"
      };
    }

    if (candidate.artifact_tag === "workflow_tag=standard_path" && candidate.verification_status === "verified" && isMatched) {
      return {
        routingDecision: "procedural-standard-path",
        persistTarget: "skill",
        candidateStatus: "persisted"
      };
    }

    if (candidate.artifact_tag === "summary_only" || candidate.verification_status === "unverified") {
      return {
        routingDecision: "summary-only",
        persistTarget: "summary_only",
        candidateStatus: "dropped"
      };
    }

    if (candidate.verification_status === "verified" && isMatchedOrNa) {
      return {
        routingDecision: "generic-verified",
        persistTarget: "memory",
        candidateStatus: "persisted"
      };
    }

    return {
      routingDecision: "drop-no-match",
      persistTarget: "drop",
      candidateStatus: "dropped"
    };
  }
}
