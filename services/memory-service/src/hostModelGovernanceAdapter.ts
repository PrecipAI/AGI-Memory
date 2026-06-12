import type { GovernanceBatchPreviewResponse, GovernanceCandidatePreview } from "./hostCaptureGovernanceBatch.js";

type HostModelGovernanceResult = {
  model_ref?: string | null;
  generated_at?: string | null;
  extraction_preview?: Partial<GovernanceBatchPreviewResponse["extraction_preview"]> | null;
};

type ApplyHostModelGovernanceResult = {
  batch: GovernanceBatchPreviewResponse;
  modelAdapter: {
    mode: "host_model" | "rules_fallback";
    model_ref: string | null;
    generated_at: string | null;
    accepted: boolean;
    warning: string | null;
  };
};

const VALID_CANDIDATE_TYPES = new Set([
  "rule_candidate",
  "memory_candidate",
  "skill_proposal_candidate",
  "knowledge_candidate",
  "governance_evidence_candidate"
]);

const VALID_ORIGIN_SCOPES = new Set(["session", "project", "workspace", "user", "team", "global"]);
const VALID_AVAILABILITY_SCOPES = new Set([
  "session_only",
  "project_reusable",
  "workspace_reusable",
  "user_reusable",
  "team_reusable",
  "global_reusable"
]);
const VALID_GOVERNANCE_LEVELS = new Set(["session", "shared"]);
const VALID_PROMOTION_STATUSES = new Set(["candidate", "active", "needs_review", "rejected"]);
const VALID_RULE_DOMAINS = new Set(["design", "execution", "governance", "memory", "skill", "tooling", "reporting", "safety", "integration"]);
const VALID_PHASES = new Set(["planning", "design", "coding", "testing", "review", "governance", "reporting", "integration"]);
const VALID_VIOLATION_BEHAVIORS = new Set(["block", "ask_user", "warn", "record"]);
const VALID_MEMORY_TYPES = new Set([
  "user_memory",
  "project_memory",
  "workspace_memory",
  "team_memory",
  "session_memory",
  "design_decision",
  "integration_context"
]);
const VALID_STABILITY = new Set(["temporary", "stable", "long_lived"]);
const VALID_KNOWLEDGE_TYPES = new Set([
  "external_fact",
  "method",
  "pattern",
  "principle",
  "comparison",
  "limitation",
  "trend",
  "synthesis",
  "counterexample"
]);
const VALID_GOVERNANCE_ACTIONS = new Set([
  "create",
  "merge_evidence",
  "update_existing",
  "replace_existing",
  "archive_existing",
  "evidence_only",
  "discard"
]);
const VALID_RECALL_STATES = new Set(["active", "audit_only", "archived"]);

export function applyHostModelGovernanceResult(input: {
  batch: GovernanceBatchPreviewResponse;
  governanceMode?: string | null;
  hostModelResult?: HostModelGovernanceResult | null;
}): ApplyHostModelGovernanceResult {
  if (input.governanceMode !== "host_model") {
    return {
      batch: input.batch,
      modelAdapter: {
        mode: "rules_fallback",
        model_ref: null,
        generated_at: null,
        accepted: true,
        warning: null
      }
    };
  }

  if (!input.hostModelResult?.extraction_preview) {
    throw new Error(formatValidationError(
      "host_model_result.extraction_preview",
      "is required when governance_mode=host_model",
      "Call memory_preview_host_governance first to get the mission brief, then perform extraction and pass the result back in host_model_result.extraction_preview",
      `"host_model_result": { "extraction_preview": { "rule_candidates": [...], "memory_candidates": [...], ... } }`
    ));
  }

  const extraction = input.hostModelResult.extraction_preview;
  const adaptedBatch: GovernanceBatchPreviewResponse = {
    ...input.batch,
    extraction_preview: {
      rule_candidates: validateCandidates("rule_candidate", extraction.rule_candidates),
      memory_candidates: validateCandidates("memory_candidate", extraction.memory_candidates),
      skill_proposal_candidates: validateCandidates("skill_proposal_candidate", extraction.skill_proposal_candidates),
      knowledge_candidates: validateCandidates("knowledge_candidate", extraction.knowledge_candidates),
      governance_evidence_candidates: validateCandidates("governance_evidence_candidate", extraction.governance_evidence_candidates)
    }
  };
  auditCrossLayerBoundaries(adaptedBatch);

  return {
    batch: adaptedBatch,
    modelAdapter: {
      mode: "host_model",
      model_ref: input.hostModelResult.model_ref ?? null,
      generated_at: input.hostModelResult.generated_at ?? null,
      accepted: true,
      warning: null
    }
  };
}

function auditCrossLayerBoundaries(batch: GovernanceBatchPreviewResponse): void {
  const layers = {
    rule_candidate: batch.extraction_preview.rule_candidates,
    memory_candidate: batch.extraction_preview.memory_candidates,
    skill_proposal_candidate: batch.extraction_preview.skill_proposal_candidates,
    knowledge_candidate: batch.extraction_preview.knowledge_candidates
  };
  const seen = new Map<string, string>();
  for (const [layer, items] of Object.entries(layers)) {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const normalized = normalizeForAudit(item.content ?? item.proposed_text ?? item.source_excerpt);
      if (!normalized) {
        continue;
      }
      const existing = seen.get(normalized);
      if (existing && existing !== layer) {
        throw new Error(formatValidationError(
          `cross-layer audit`,
          `the same content is classified as both ${existing} and ${layer}`,
          `Each piece of content must appear in exactly ONE layer. Remove the duplicate from ${existing} or ${layer} and keep only the most appropriate classification.`,
          `If it's an IF/THEN constraint → rule_candidate; if it's a symptom→fix pattern → memory_candidate`
        ));
      }
      seen.set(normalized, layer);

      if (layer === "memory_candidate" && looksLikeProcedure(item.content ?? item.source_excerpt)) {
        throw new Error(formatValidationError(
          `memory_candidate[${index}]`,
          "looks like a reusable procedure (contains workflow/step/process language)",
          "Move to skill_proposal_candidate if it describes a repeatable procedure, or rewrite to focus on {symptom, root_cause, fix_action} without procedural steps.",
          `memory_candidate content: "Node 18 incompatibility caused build failure; root cause was CI default version; fix is .nvmrc + CI pre-step" (not a step-by-step guide)`
        ));
      }
      if (layer === "skill_proposal_candidate" && item.promotion_status !== "needs_review") {
        throw new Error(formatValidationError(
          `skill_proposal_candidate[${index}]`,
          `promotion_status="${String(item.promotion_status)}" is not allowed for skills`,
          "All skill proposals MUST use promotion_status='needs_review' because skills require human validation.",
          `"promotion_status": "needs_review"`
        ));
      }
    }
  }
}

function validateCandidates(
  expectedType: GovernanceCandidatePreview["candidate_type"],
  candidates: unknown
): GovernanceCandidatePreview[] {
  if (candidates === undefined || candidates === null) {
    return [];
  }
  if (!Array.isArray(candidates)) {
    throw new Error(formatValidationError(
      expectedType,
      "must be an array",
      `Wrap candidates in a JSON array under the "${expectedType.replace("_candidate", "_candidates")}" key`,
      `"${expectedType.replace("_candidate", "_candidates")}": [{ "candidate_type": "${expectedType}", ... }]`
    ));
  }
  return candidates.map((candidate, index) => validateCandidate(expectedType, candidate, index));
}

function validateCandidate(
  expectedType: GovernanceCandidatePreview["candidate_type"],
  candidate: unknown,
  index: number
): GovernanceCandidatePreview {
  if (!candidate || typeof candidate !== "object") {
    throw new Error(formatValidationError(
      `${expectedType}[${index}]`,
      "must be an object",
      "Each candidate must be a JSON object with all required fields",
      `{ "candidate_type": "${expectedType}", "title": "...", ... }`
    ));
  }
  const item = candidate as Record<string, unknown>;
  const candidateType = readString(item, "candidate_type");
  if (!VALID_CANDIDATE_TYPES.has(candidateType) || candidateType !== expectedType) {
    throw new Error(formatValidationError(
      `${expectedType}[${index}].candidate_type`,
      `must be "${expectedType}" but got "${candidateType}"`,
      `candidate_type must exactly match the array it belongs to`,
      `"candidate_type": "${expectedType}"`
    ));
  }
  const title = readString(item, "title");
  const originScope = readEnum(item, "origin_scope", VALID_ORIGIN_SCOPES);
  const availabilityScope = readEnum(item, "availability_scope", VALID_AVAILABILITY_SCOPES);
  const governanceLevel = readEnum(item, "governance_level", VALID_GOVERNANCE_LEVELS);
  const promotionStatus = readEnum(item, "promotion_status", VALID_PROMOTION_STATUSES);
  const sourceKind = readString(item, "source_kind") as GovernanceCandidatePreview["source_kind"];
  const sourceTimestamp = readString(item, "source_timestamp");
  const sourceExcerpt = readString(item, "source_excerpt");
  const reason = readString(item, "reason");
  const confidence = readOptionalString(item, "confidence") ?? "medium";

  if (expectedType === "skill_proposal_candidate") {
    const targetSkill = readString(item, "target_skill");
    const proposedText = readString(item, "proposed_text");
    const currentGap = readString(item, "current_gap");
    const changeType = readEnum(item, "change_type", new Set(["add", "update", "split", "merge", "deprecate"]));
    const validationMethod = readString(item, "validation_method");
    const proposalQuality = readOptionalString(item, "proposal_quality") ?? "actionable";
    if (proposalQuality !== "actionable" && proposalQuality !== "needs_review" && proposalQuality !== "rejected") {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].proposal_quality`,
        `has invalid value: "${proposalQuality}"`,
        "Use one of: actionable, needs_review, rejected",
        `"proposal_quality": "actionable"`
      ));
    }
    return {
      ...(item as Partial<GovernanceCandidatePreview>),
      candidate_type: expectedType,
      title,
      origin_scope: originScope as GovernanceCandidatePreview["origin_scope"],
      availability_scope: availabilityScope as GovernanceCandidatePreview["availability_scope"],
      governance_level: governanceLevel as GovernanceCandidatePreview["governance_level"],
      promotion_status: promotionStatus as GovernanceCandidatePreview["promotion_status"],
      source_kind: sourceKind,
      source_timestamp: sourceTimestamp,
      source_excerpt: sourceExcerpt,
      reason,
      confidence: normalizeConfidence(confidence),
      target_skill: targetSkill,
      proposed_text: proposedText,
      current_gap: currentGap,
      change_type: changeType as GovernanceCandidatePreview["change_type"],
      validation_method: validationMethod,
      proposal_quality: proposalQuality as GovernanceCandidatePreview["proposal_quality"]
    } as GovernanceCandidatePreview;
  }

  const validated: GovernanceCandidatePreview = {
    ...(item as Partial<GovernanceCandidatePreview>),
    candidate_type: expectedType,
    title,
    origin_scope: originScope as GovernanceCandidatePreview["origin_scope"],
    availability_scope: availabilityScope as GovernanceCandidatePreview["availability_scope"],
    governance_level: governanceLevel as GovernanceCandidatePreview["governance_level"],
    promotion_status: promotionStatus as GovernanceCandidatePreview["promotion_status"],
    source_kind: sourceKind,
    source_timestamp: sourceTimestamp,
    source_excerpt: sourceExcerpt,
    reason,
    confidence: normalizeConfidence(confidence)
  } as GovernanceCandidatePreview;

  if (expectedType === "rule_candidate") {
    validated.content = readString(item, "content");
    validated.rule_domain = readEnum(item, "rule_domain", VALID_RULE_DOMAINS) as GovernanceCandidatePreview["rule_domain"];
    validated.rule_scope = readEnum(item, "rule_scope", VALID_ORIGIN_SCOPES) as GovernanceCandidatePreview["rule_scope"];
    validated.applies_to_phase = readStringArrayEnum(item, "applies_to_phase", VALID_PHASES) as GovernanceCandidatePreview["applies_to_phase"];
    validated.violation_behavior = readEnum(item, "violation_behavior", VALID_VIOLATION_BEHAVIORS) as GovernanceCandidatePreview["violation_behavior"];
  }

  if (expectedType === "memory_candidate") {
    validated.content = readString(item, "content");
    validated.memory_type = readEnum(item, "memory_type", VALID_MEMORY_TYPES) as GovernanceCandidatePreview["memory_type"];
    validated.stability = readEnum(item, "stability", VALID_STABILITY) as GovernanceCandidatePreview["stability"];
  }

  if (expectedType === "knowledge_candidate") {
    validated.content = readString(item, "content");
    validated.knowledge_type = readEnum(item, "knowledge_type", VALID_KNOWLEDGE_TYPES) as GovernanceCandidatePreview["knowledge_type"];
    validated.governance_action = readEnum(item, "governance_action", VALID_GOVERNANCE_ACTIONS) as GovernanceCandidatePreview["governance_action"];
    const recallState = readOptionalEnum(item, "recall_state", VALID_RECALL_STATES);
    validated.recall_state = (recallState ?? "audit_only") as GovernanceCandidatePreview["recall_state"];
    validated.synthesis_reasoning = readString(item, "synthesis_reasoning");
  }

  validateLayerBoundary(expectedType, validated, index);
  return validated;
}

function formatValidationError(field: string, issue: string, fix: string, example: string): string {
  return `${field}: ${issue}. Fix: ${fix}. Example: ${example}`;
}

function readString(item: Record<string, unknown>, field: string): string {
  const value = item[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(formatValidationError(
      field,
      "must be a non-empty string",
      "Provide a descriptive, non-empty string value",
      `"${field}": "Descriptive text summarizing the extracted asset"`
    ));
  }
  return value;
}

function readOptionalString(item: Record<string, unknown>, field: string): string | null {
  const value = item[field];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(formatValidationError(
      field,
      "must be a string",
      "Provide a string value or omit the field entirely",
      `"${field}": "high"`
    ));
  }
  return value;
}

function readStringArrayEnum(item: Record<string, unknown>, field: string, validValues: Set<string>): string[] {
  const value = item[field];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(formatValidationError(
      field,
      "must be a non-empty array of valid enum values",
      `Use values from: ${[...validValues].join(", ")}`,
      `"${field}": ["${[...validValues][0]}", "${[...validValues][1] ?? [...validValues][0]}"]`
    ));
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || !validValues.has(entry)) {
      throw new Error(formatValidationError(
        `${field}[${index}]`,
        `has invalid value: ${String(entry)}`,
        `Use one of: ${[...validValues].join(", ")}`,
        `"${field}": ["${[...validValues][0]}"]`
      ));
    }
    return entry;
  });
}

function readEnum(item: Record<string, unknown>, field: string, validValues: Set<string>): string {
  const value = readString(item, field);
  if (!validValues.has(value)) {
    throw new Error(formatValidationError(
      field,
      `has invalid value: "${value}"`,
      `Use one of: ${[...validValues].join(", ")}`,
      `"${field}": "${[...validValues][0]}"`
    ));
  }
  return value;
}

function readOptionalEnum(item: Record<string, unknown>, field: string, validValues: Set<string>): string | null {
  const value = item[field];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string" || !validValues.has(value)) {
    throw new Error(formatValidationError(
      field,
      `has invalid value: ${String(value)}`,
      `Use one of: ${[...validValues].join(", ")} or omit the field`,
      `"${field}": "${[...validValues][0]}"`
    ));
  }
  return value;
}

function normalizeConfidence(value: string): GovernanceCandidatePreview["confidence"] {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return "medium";
}

function validateLayerBoundary(
  expectedType: GovernanceCandidatePreview["candidate_type"],
  candidate: GovernanceCandidatePreview,
  index: number
): void {
  const text = `${candidate.title}\n${candidate.content ?? ""}\n${candidate.source_excerpt}`.toLowerCase();
  if (expectedType === "knowledge_candidate") {
    const projectOrPrivateSignals = [
      "d:\\workspace",
      "c:\\users\\administrator",
      "superagentsystem",
      "本机",
      "这台机器",
      "项目路径",
      "workspace 目录",
      "用户偏好"
    ];
    if (projectOrPrivateSignals.some((signal) => text.includes(signal))) {
      throw new Error(formatValidationError(
        `knowledge_candidate[${index}]`,
        "contains project/user/machine-specific context",
        "Move this to memory_candidate (if it's a project-specific fact) or governance_evidence_candidate (if it's just a log). Knowledge must be universally reusable.",
        `knowledge_candidate content: "Fastify is the HTTP framework used by the memory service" (no paths, no machine names)`
      ));
    }
    if (candidate.governance_level !== "shared" || candidate.availability_scope === "session_only") {
      throw new Error(formatValidationError(
        `knowledge_candidate[${index}]`,
        `governance_level="${candidate.governance_level}" and availability_scope="${candidate.availability_scope}" are not shared/reusable`,
        "Set governance_level to 'shared' and availability_scope to 'project_reusable' or wider",
        `"governance_level": "shared", "availability_scope": "project_reusable"`
      ));
    }
  }

  if (expectedType === "memory_candidate") {
    const externalSignals = ["http://", "https://", "arxiv.org", "github.com", "docs.", "paper"];
    if (externalSignals.some((signal) => text.includes(signal)) && candidate.memory_type !== "project_memory") {
      throw new Error(formatValidationError(
        `memory_candidate[${index}]`,
        "appears to describe external knowledge (URLs, docs, papers)",
        "Move to knowledge_candidate (if it's a reusable fact) or set memory_type to 'project_memory'",
        `knowledge_candidate with content: "Redis sorted sets support O(log(N)+M) ZRANGEBYSCORE"`
      ));
    }
  }

  if (expectedType === "rule_candidate") {
    const ruleText = String(candidate.content ?? "").toLowerCase();
    if (!/\bmust\b|\bmust_not\b|\bmust not\b|必须|不得|不能|不允许|不要|只能|默认/.test(ruleText)) {
      throw new Error(formatValidationError(
        `rule_candidate[${index}]`,
        "does not express an enforceable must/must_not behavior constraint",
        "Rewrite as an IF/THEN rule using MUST, MUST NOT, 必须, 不得, 不能, or 不允许. Prefix user preference rules with [UP-Override].",
        `"[UP-Override] IF user asks for explanation THEN MUST provide conceptual reasoning first; MUST NOT output code before explanation"`
      ));
    }
  }
}

function normalizeForAudit(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized.length > 12 ? normalized : null;
}

function looksLikeProcedure(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.toLowerCase();
  const procedureSignals = [
    "步骤",
    "流程",
    "然后",
    "最后",
    "失败时",
    "报错时",
    "修复",
    "playbook",
    "runbook",
    "step",
    "workflow"
  ];
  return procedureSignals.some((signal) => normalized.includes(signal));
}
