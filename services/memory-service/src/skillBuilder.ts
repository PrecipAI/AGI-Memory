import { createOrReplaceSkill } from "@super-agent/db";
import type { NormalizedCandidate } from "./types.js";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export class SkillBuilder {
  async persist(input: {
    tenantId: string;
    scope: string;
    candidate: NormalizedCandidate;
    traceId: string;
  }): Promise<string> {
    const skillKey =
      typeof input.candidate.candidate_payload.skill_key === "string"
        ? String(input.candidate.candidate_payload.skill_key)
        : `${slugify(input.candidate.artifact_tag)}-${input.candidate.task_step_id.slice(0, 8)}`;

    return createOrReplaceSkill({
      tenantId: input.tenantId,
      scope: input.scope,
      skillKey,
      title: input.candidate.title,
      description: input.candidate.content,
      triggerConditions: {
        source_type: input.candidate.source_type,
        artifact_tag: input.candidate.artifact_tag,
        error_code: input.candidate.error_code ?? null
      },
      procedurePayload: {
        ...input.candidate.candidate_payload,
        source_ref: input.candidate.source_ref
      },
      verificationStatus: input.candidate.verification_status,
      fingerprintRequirement: input.candidate.fingerprint ?? null,
      riskLevel: "low",
      successRate: 95,
      tags: [input.candidate.artifact_tag, "memory-v3"],
      traceId: input.traceId
    });
  }
}
