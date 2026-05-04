import { createOrReplaceRule } from "@super-agent/db";
import type { NormalizedCandidate } from "./types.js";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function inferRuleType(artifactTag: string): string {
  switch (artifactTag) {
    case "rejection_preference":
      return "rejection_rule";
    case "project_constraint":
      return "workspace_rule";
    case "policy_constraint":
      return "security_rule";
    case "quality_gate":
      return "quality_gate_rule";
    case "routing_rule":
      return "routing_rule";
    case "retrieval_rule":
      return "retrieval_rule";
    case "execution_boundary_rule":
      return "execution_boundary_rule";
    case "constraint_fact":
    default:
      return "governance_rule";
  }
}

function inferEnforcementLevel(candidate: NormalizedCandidate): string {
  const explicit = candidate.candidate_payload.enforcement_level;
  if (typeof explicit === "string" && explicit.trim()) {
    return explicit;
  }
  if (candidate.artifact_tag === "rejection_preference" || candidate.artifact_tag === "policy_constraint") {
    return "must_follow";
  }
  return "should_follow";
}

export class RuleBuilder {
  async persist(input: {
    tenantId: string;
    scope: string;
    candidate: NormalizedCandidate;
    traceId: string;
  }): Promise<string> {
    const ruleKey =
      typeof input.candidate.candidate_payload.rule_key === "string"
        ? String(input.candidate.candidate_payload.rule_key)
        : `${slugify(input.candidate.artifact_tag)}-${input.candidate.task_step_id.slice(0, 8)}`;

    return createOrReplaceRule({
      tenantId: input.tenantId,
      scope: input.scope,
      ruleKey,
      ruleType:
        typeof input.candidate.candidate_payload.rule_type === "string"
          ? String(input.candidate.candidate_payload.rule_type)
          : inferRuleType(input.candidate.artifact_tag),
      title: input.candidate.title,
      statement: input.candidate.content,
      appliesTo: Array.isArray(input.candidate.candidate_payload.applies_to)
        ? input.candidate.candidate_payload.applies_to
        : [],
      triggerConditions: {
        source_type: input.candidate.source_type,
        artifact_tag: input.candidate.artifact_tag,
        fingerprint_status: input.candidate.fingerprint_status
      },
      enforcementLevel: inferEnforcementLevel(input.candidate),
      priority:
        typeof input.candidate.candidate_payload.priority === "number"
          ? input.candidate.candidate_payload.priority
          : Math.round(input.candidate.rank_score ?? 75),
      riskLevel:
        typeof input.candidate.candidate_payload.risk_level === "string"
          ? String(input.candidate.candidate_payload.risk_level)
          : "medium",
      verificationStatus: input.candidate.verification_status,
      sourceRefs: [input.candidate.source_ref],
      evidenceRefs: [
        {
          candidate_hash: input.candidate.candidate_hash,
          source_type: input.candidate.source_type,
          source_ref: input.candidate.source_ref
        }
      ],
      metadata: {
        candidate_hash: input.candidate.candidate_hash,
        artifact_tag: input.candidate.artifact_tag,
        ...(typeof input.candidate.candidate_payload.conflicts_with_rule_key === "string"
          ? { conflicts_with_rule_key: input.candidate.candidate_payload.conflicts_with_rule_key }
          : {}),
        ...(typeof input.candidate.candidate_payload.conflict_type === "string"
          ? { conflict_type: input.candidate.candidate_payload.conflict_type }
          : {})
      },
      traceId: input.traceId
    });
  }
}
