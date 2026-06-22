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

const VALID_STRICTNESS = new Set(["hard_rule", "soft_preference"]);
const FILLER_PATTERNS = [
  /需要注意/,
  /妥善处理/,
  /尽量保证/,
  /适当考虑/,
  /建议关注/,
  /可以优化/,
  /值得注意/,
  /建议.*关注/,
  /应该.*注意/,
];
const RULE_ID_PATTERN = /^[A-Z][A-Z0-9_]{2,}$/;

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
  const promotionStatus = readOptionalEnum(item, "promotion_status", VALID_PROMOTION_STATUSES) ?? "active";
  const sourceKind = readString(item, "source_kind") as GovernanceCandidatePreview["source_kind"];
  const sourceTimestamp = readString(item, "source_timestamp");
  const sourceExcerpt = readString(item, "source_excerpt");
  const reason = readString(item, "reason");
  const confidence = readOptionalEnum(item, "confidence", new Set(["high", "medium", "low"])) ?? "medium";

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
    // NEW: validate execution_steps as String array (if provided)
    const execSteps = item.execution_steps;
    if (execSteps !== undefined && execSteps !== null) {
      if (!Array.isArray(execSteps)) {
        throw new Error(formatValidationError(
          `${expectedType}[${index}].execution_steps`,
          "must be a String array, not a paragraph",
          "Provide an array where each element is one atomic action step",
          `"execution_steps": ["检查 Node 版本兼容性", "生成 PM2 配置文件", "验证 /healthz 端点"]`
        ));
      }
      for (let si = 0; si < execSteps.length; si++) {
        if (typeof execSteps[si] !== "string" || execSteps[si].trim() === "") {
          throw new Error(formatValidationError(
            `${expectedType}[${index}].execution_steps[${si}]`,
            "each step must be a non-empty string",
            "Each element should describe one atomic action",
            `"execution_steps": ["1. 检查目标主机 Node 版本", "2. 生成 PM2 ecosystem.config.cjs"]`
          ));
        }
      }
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
    validated.content = readOptionalString(item, "content") ?? sourceExcerpt;
    validated.rule_domain = (readOptionalEnum(item, "rule_domain", VALID_RULE_DOMAINS) ?? "execution") as GovernanceCandidatePreview["rule_domain"];
    validated.rule_scope = (readOptionalEnum(item, "rule_scope", VALID_ORIGIN_SCOPES) ?? originScope) as GovernanceCandidatePreview["rule_scope"];
    validated.applies_to_phase = readOptionalStringArrayEnum(item, "applies_to_phase", VALID_PHASES, ["review"]) as GovernanceCandidatePreview["applies_to_phase"];
    validated.violation_behavior = (readOptionalEnum(item, "violation_behavior", VALID_VIOLATION_BEHAVIORS) ?? "warn") as GovernanceCandidatePreview["violation_behavior"];
    // NEW: validate rule_id (UPPER_SNAKE_CASE)
    const ruleId = readOptionalString(item, "rule_id");
    if (ruleId !== null && !RULE_ID_PATTERN.test(ruleId)) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].rule_id`,
        `must be UPPER_SNAKE_CASE (e.g. FORBID_CATCHALL_SCHEMA) but got "${ruleId}"`,
        "Use uppercase letters, digits, and underscores only. Must start with a letter.",
        `"rule_id": "UP_OVERRIDE_VERBOSE_MODE"`
      ));
    }
  }

  if (expectedType === "memory_candidate") {
    validated.content = readOptionalString(item, "content") ?? sourceExcerpt;
    validated.memory_type = (readOptionalEnum(item, "memory_type", VALID_MEMORY_TYPES) ?? "session_memory") as GovernanceCandidatePreview["memory_type"];
    validated.stability = (readOptionalEnum(item, "stability", VALID_STABILITY) ?? "stable") as GovernanceCandidatePreview["stability"];
    // NEW: validate strictness (hard_rule | soft_preference)
    const strictness = readOptionalEnum(item, "strictness", VALID_STRICTNESS);
    if (strictness !== null) {
      (validated as Record<string, unknown>).strictness = strictness;
    }
  }

  if (expectedType === "knowledge_candidate") {
    validated.content = readOptionalString(item, "content") ?? sourceExcerpt;
    validated.knowledge_type = (readOptionalEnum(item, "knowledge_type", VALID_KNOWLEDGE_TYPES) ?? "external_fact") as GovernanceCandidatePreview["knowledge_type"];
    validated.governance_action = (readOptionalEnum(item, "governance_action", VALID_GOVERNANCE_ACTIONS) ?? "create") as GovernanceCandidatePreview["governance_action"];
    const recallState = readOptionalEnum(item, "recall_state", VALID_RECALL_STATES);
    validated.recall_state = (recallState ?? "audit_only") as GovernanceCandidatePreview["recall_state"];
    validated.synthesis_reasoning = readOptionalString(item, "synthesis_reasoning") ?? "";
    // NEW: validate avoid_pitfall (must contain IF-THEN structure, not vague "注意X")
    const avoidPitfall = readOptionalString(item, "avoid_pitfall");
    if (avoidPitfall !== null) {
      (validated as Record<string, unknown>).avoid_pitfall = avoidPitfall;
      // Check: avoid_pitfall should not be a vague warning
      const isVague = /^注意/.test(avoidPitfall.trim()) || /^小心/.test(avoidPitfall.trim());
      if (isVague) {
        throw new Error(formatValidationError(
          `${expectedType}[${index}].avoid_pitfall`,
          "must be a specific IF-THEN pitfall, not a vague '注意X' warning",
          "Rewrite as: IF [condition] THEN [consequence]. Example: IF 使用 catchall schema THEN 嵌套字段会在序列化时被静默剥离",
          `"avoid_pitfall": "IF 定义 MCP tool schema THEN 必须使用 strict typed schema，禁止 catchall"`
        ));
      }
    }
  }

  // NEW: Anti-filler check on content field (applies to all layers except evidence)
  if (expectedType !== "governance_evidence_candidate") {
    const contentToCheck = validated.content ?? "";
    const matchedFiller = FILLER_PATTERNS.find(p => p.test(contentToCheck));
    if (matchedFiller) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].content`,
        `contains forbidden filler phrase: "${contentToCheck.match(matchedFiller)?.[0]}"`,
        "Replace vague filler with specific IF-THEN conditions, concrete actions, and verifiable results. Ask: can this be translated into executable code?",
        `BAD: "在处理 MCP 工具时需要注意 schema 的兼容性"\nGOOD: "IF 定义 MCP tool schema THEN 必须显式声明所有字段; catchall 会在序列化时静默剥离嵌套字段"`
      ));
    }
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

function readOptionalStringArrayEnum(item: Record<string, unknown>, field: string, validValues: Set<string>, fallback: string[]): string[] {
  const value = item[field];
  if (value === undefined || value === null) {
    return fallback;
  }
  if (!Array.isArray(value)) {
    throw new Error(formatValidationError(
      field,
      "must be an array of valid enum values or omitted",
      `Use values from: ${[...validValues].join(", ")}`,
      `"${field}": ["${[...validValues][0]}"]`
    ));
  }
  if (value.length === 0) {
    return fallback;
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
        `knowledge_candidate content: "Zod catchall schemas silently strip undeclared fields during JSON-RPC serialization" (no paths, no machine names)`
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
    // Quality gate: knowledge must be a synthesized INSIGHT, not a raw fact
    // Raw facts ("X is used for Y", "X has version Z") belong in evidence, not knowledge
    const rawFactPatterns = [
      /^\w+ is the \w+ (framework|library|tool|database|language|server) (used|for)\b/i,
      /^\w+ uses \w+\b/i,
      /^\w+ runs on (port|version)\b/i,
      /^\w+ is a \w+\b/i,
      /^the \w+ of \w+ is \w+\b/i,
    ];
    const contentText = String(candidate.content ?? "");
    const isRawFact = rawFactPatterns.some((pattern) => pattern.test(contentText.trim()));
    // Also check: does the content have any insight/causal reasoning?
    const insightSignals = ["because", "causes", "leads to", "prevents", "ensures", "triggers",
      "避免", "导致", "防止", "确保", "触发", "意味着", "insight", "lesson", "pitfall",
      "non-obvious", "反直觉", "陷阱", "关键", "crucial", "critical", "gotcha"];
    const hasInsight = insightSignals.some((s) => contentText.toLowerCase().includes(s));
    if (isRawFact && !hasInsight) {
      throw new Error(formatValidationError(
        `knowledge_candidate[${index}]`,
        "appears to be a raw fact (e.g. 'X is the Y framework') rather than a synthesized insight",
        "Move to governance_evidence_candidate if this is just a factual observation. Knowledge should be a synthesized insight that would meaningfully change how a future agent approaches similar problems — it should contain causal reasoning, non-obvious connections, or actionable wisdom.",
        `BAD: "Fastify is the HTTP framework used by the memory service" (raw fact → evidence)\nGOOD: "Zod catchall schemas silently strip undeclared nested fields during JSON-RPC serialization, causing invisible data loss at the transport boundary" (insight that prevents future mistakes)`
      ));
    }
  }

  if (expectedType === "memory_candidate") {
    // Hard rejection: implementation notes, bug descriptions, technical facts
    const hardRejectPatterns = [
      /implementation[_\s]?note/i,
      /symptom\s*:/i,
      /root\s*cause\s*:/i,
      /fix[_\s]?action\s*:/i,
      /silently\s*(strip|drop|lose)/i,
      /静默(剥离|丢失|丢弃)/,
      /during\s*(json-?rpc\s*)?transport/i,
      /传输(边界|层|过程)/i,
      /validation\s*error/i,
      /验证(错误|失败)/i,
    ];
    const contentAndTitle = `${String(candidate.content ?? "")} ${String(candidate.title ?? "")}`;
    const matchedHardReject = hardRejectPatterns.find(p => p.test(contentAndTitle));
    if (matchedHardReject) {
      throw new Error(formatValidationError(
        `memory_candidate[${index}]`,
        "describes a technical implementation detail, bug, or system behavior — NOT the user's profile",
        "Memory is 用户画像 (user profile). It must describe WHO the user is, their preferences, background, and communication style. Technical bugs, implementation notes, and system facts belong in Knowledge (if insightful) or Evidence (if raw facts).",
        `BAD: "MCP looseObjectSchema silently strips nested fields during JSON-RPC transport" (technical bug)\nBAD: "Governance validation requires optional fields to have defaults" (implementation note)\nGOOD: "用户是后端工程师，偏好简洁回答，讨厌废话" (user profile)`
      ));
    }

    // Memory = user profile/preferences (用户画像). Must describe the USER, not code or implementation.
    const userProfileSignals = [
      "user", "用户", "偏好", "prefer", "style", "风格", "习惯", "habit",
      "background", "背景", "engineer", "工程师", "developer", "开发者",
      "dislike", "讨厌", "不喜欢", "likes", "喜欢", "wants", "希望",
      "communication", "沟通", "communication style", "回答风格",
      "tech stack", "技术栈", "framework preference", "框架偏好",
      "work style", "工作方式", "workflow preference", "简洁", "concise",
      "verbose", "detailed", "详细", "废话", "filler", "直接", "direct"
    ];
    const implSignals = [
      "we fixed", "we changed", "we modified", "修复了", "改了",
      "symptom:", "root_cause:", "fix_action:", "the build", "the service",
      "validation error", "schema", "compile", "deploy process",
      "port", "endpoint", "api call", "npm install", "git commit"
    ];
    const hasUserProfile = userProfileSignals.some((s) => text.includes(s));
    const hasImplDetail = implSignals.filter((s) => text.includes(s)).length >= 2;
    if (hasImplDetail && !hasUserProfile) {
      throw new Error(formatValidationError(
        `memory_candidate[${index}]`,
        "describes an implementation detail or crisis-resolution story, NOT the user's profile/preferences",
        "Memory must describe WHO the user is — their background, preferences, communication style, work habits. Implementation notes belong in Knowledge (if they're insights) or Evidence (if they're raw facts).",
        `BAD: "Governance validation requires optional fields to have defaults" (implementation detail)\nGOOD: "User is a backend engineer who prefers concise answers, dislikes verbose formatting and filler text" (user profile)`
      ));
    }
    const externalSignals = ["http://", "https://", "arxiv.org", "github.com", "docs.", "paper"];
    if (externalSignals.some((signal) => text.includes(signal)) && candidate.memory_type !== "project_memory") {
      throw new Error(formatValidationError(
        `memory_candidate[${index}]`,
        "appears to describe external knowledge (URLs, docs, papers)",
        "Move to knowledge_candidate (if it's a synthesized insight) or governance_evidence_candidate (if it's a raw fact)",
        `knowledge_candidate with content: "Redis sorted sets support O(log(N)+M) ZRANGEBYSCORE"`
      ));
    }

    // If memory_type is session_memory but content has no user profile signals, reject
    // (Note: "factual" is not a valid memory_type — it would already be rejected by the enum validator.
    //  If you need to add "factual" as a valid type, also add it to this check.)
    if (candidate.memory_type === "session_memory") {
      const hasUserProfile = userProfileSignals.some((s) => text.includes(s));
      if (!hasUserProfile) {
        throw new Error(formatValidationError(
          `memory_candidate[${index}]`,
          `memory_type is "${candidate.memory_type}" but content does not describe the user's profile/preferences`,
          "Memory must be about the USER — their identity, preferences, work habits. Change to knowledge_candidate (if it's an insight) or governance_evidence_candidate (if it's a raw fact).",
          `Change candidate_type to "knowledge_candidate" or "governance_evidence_candidate"`
        ));
      }
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
    // Quality gate: reject rules that describe one-time fixes with no ongoing enforcement value
    // A meaningful rule has a clear trigger condition AND an ongoing mandate
    // A meaningless rule is just a one-time workaround rephrased as a constraint
    const oneTimeFixPatterns = [
      /we (fixed|changed|modified|added|removed|patched)\b/i,
      /修复了|改了|加了|删了|补了/,
      /\bthis (bug|error|issue|fix|crash|failure)\b/i,
      /刚才|刚刚|上一次|今天的/,
      /to (fix|resolve|solve|patch) (this|the|that) (bug|error|issue|problem)/i,
    ];
    const isOneTimeFix = oneTimeFixPatterns.some((p) => p.test(ruleText));
    // Also check: does the rule have an IF/THEN structure with ongoing applicability?
    const hasConditionalStructure = /\bif\b.*\bthen\b/i.test(ruleText) || /如果.*那么|当.*时/.test(ruleText);
    const hasOngoingScope = /\b(defining|creating|building|deploying|designing|implementing|writing|configuring|validating)\b/i.test(ruleText);
    if (isOneTimeFix && !hasConditionalStructure && !hasOngoingScope) {
      throw new Error(formatValidationError(
        `rule_candidate[${index}]`,
        "describes a one-time fix rather than an ongoing behavioral constraint — a rule must be something you'd actually enforce in future operations",
        "If this is a crisis-resolution story → memory_candidate. If it has no future enforcement value → discard. A meaningful rule has: (1) a clear IF trigger condition for future operations, (2) an ongoing MUST/MUST NOT mandate, (3) practical enforceability.",
        `BAD: "IF the Zod validation fails THEN MUST add optional defaults" (one-time fix → memory)\nGOOD: "IF defining MCP tool schemas THEN MUST use typed Zod schemas; MUST NOT use catchall schemas" (ongoing constraint for all future tool development)`
      ));
    }
  }

  if (expectedType === "skill_proposal_candidate") {
    const skillText = `${candidate.title}\n${candidate.content ?? ""}\n${candidate.proposed_text ?? ""}`.toLowerCase();
    // Detect if this "skill" is actually a mandate/constraint (should be a rule)
    const mandateSignals = ["必须", "不得", "不能", "不允许", "must", "must not", "never", "always"];
    const procedureSignals = ["步骤", "流程", "procedure", "runbook", "playbook", "how to", "howto", "step-by-step", "tutorial"];
    const mandateCount = mandateSignals.filter((s) => skillText.includes(s)).length;
    const procedureCount = procedureSignals.filter((s) => skillText.includes(s)).length;
    if (mandateCount >= 2 && procedureCount === 0) {
      throw new Error(formatValidationError(
        `skill_proposal_candidate[${index}]`,
        "expresses a mandate/constraint (contains must/must_not language) without procedural steps",
        "This belongs in rule_candidates as an IF/THEN behavioral constraint, NOT as a skill proposal. Skill proposals are for parameterized, repeatable procedures.",
        `Move to rule_candidates with: "IF [condition] THEN MUST [behavior]"`
      ));
    }
    // Detect if this "skill" is just a one-off fix (should be memory or discarded)
    const oneOffSkillSignals = ["fixed", "fixed it", "修好了", "解决了", "this bug", "this error", "workaround"];
    const oneOffCount = oneOffSkillSignals.filter((s) => skillText.includes(s)).length;
    if (oneOffCount >= 2) {
      throw new Error(formatValidationError(
        `skill_proposal_candidate[${index}]`,
        "describes a one-off fix rather than a reusable parameterized procedure",
        "Move to memory_candidates if this is a pitfall survival guide {symptom, root_cause, fix_action}, or discard if not reusable.",
        `memory_candidate: {"symptom": "build fails on Node 16", "root_cause": "CI defaults to old Node", "fix_action": "Add .nvmrc + CI pre-step"}`
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
    /\bstep\s*\d/i,
    /\bstep\s+by\s+step/i,
    /\bworkflow\b/i,
  ];
  return procedureSignals.some((signal) => {
    if (signal instanceof RegExp) return signal.test(normalized);
    return normalized.includes(signal);
  });
}
