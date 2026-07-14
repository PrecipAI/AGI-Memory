import {
  GOVERNANCE_SCOPE_BY_LAYER,
  VALID_KNOWLEDGE_TYPES,
  type GovernanceBatchPreviewResponse,
  type GovernanceCandidatePreview
} from "./hostCaptureGovernanceBatch.js";
import { jaccardSimilarity } from "./governance/L2ConflictDetector.js";
import { CANARY_TEMPLATES } from "./governance/canaryTemplates.js";

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

// ─── P1-1: n-gram 具体性校验阈值 ───
// reasoning 与候选 title+content 的 Jaccard 相似度下限。
// title+content 通常 20-50 个有效 token，reasoning 需至少引用 3-5 个才算具体。
// Jaccard 0.15 对应约 3/20 的重合。需用 golden 50 数据集持续校准。
const REASONING_SPECIFICITY_THRESHOLD = 0.15;

// ─── P1-2: 同批次内跨候选 reasoning 雷同检测阈值 ───
// 同批次内两条候选的 decision_reasoning Jaccard 相似度超过此值 → 标记为雷同对。
// 同批次雷同对数超过 MAX_INTRA_BATCH_DUPLICATE_PAIRS → 整批 REJECT。
const INTRA_BATCH_SIMILARITY_THRESHOLD = 0.7;
const MAX_INTRA_BATCH_DUPLICATE_PAIRS = 2;

// ─── P1-3: self_test 交叉验证模式数组 ───
// 复用 validateLayerBoundary 的模式数组语义，提取为模块级常量以便交叉校验复用。
const IMPL_SIGNALS = [
  "we fixed", "we changed", "we modified", "修复了", "改了",
  "symptom:", "root_cause:", "fix_action:", "the build", "the service",
  "validation error", "schema", "compile", "deploy process",
  "port", "endpoint", "api call", "npm install", "git commit"
];

const USER_PROFILE_SIGNALS = [
  "user", "用户", "偏好", "prefer", "style", "风格", "习惯", "habit",
  "background", "背景", "engineer", "工程师", "developer", "开发者",
  "dislike", "讨厌", "不喜欢", "likes", "喜欢", "wants", "希望",
  "communication", "沟通", "communication style", "回答风格",
  "tech stack", "技术栈", "framework preference", "框架偏好",
  "work style", "工作方式", "workflow preference", "简洁", "concise",
  "verbose", "detailed", "详细", "废话", "filler", "直接", "direct"
];

// 时间敏感词：如果 memory content 含这些词，time_diluted 不能声明为 "stable"
const TIME_SENSITIVE_PATTERNS = [
  /今天|昨天|明天|刚刚|刚才|当前版本|本次|这次/,
  /v\d+\.\d+/i,  // 版本号 v2.3
  /\b\d{4}-\d{2}-\d{2}\b/,  // 日期 2026-07-10
  /\bversion\s+\d+/i,
];

// 常识性陈述：如果 knowledge content 匹配这些模式，ood_threshold 不能声明为 true（超出训练分布）
const COMMON_KNOWLEDGE_PATTERNS = [
  /^\w+\s+is\s+(a|an|the)\s+\w+/i,  // "X is a Y"
  /^\w+\s+是\s+(一种|一个|一款)/,  // "X 是一种 Y"
  /\b(widely known|commonly used|standard practice|industry standard)\b/i,
  /(众所周知|普遍使用|行业标准|常见做法)/,
];

// 具体事件绑定词：如果 knowledge content 含这些词，reusable 不能声明为 true
const SPECIFIC_EVENT_PATTERNS = [
  /今天|昨天|刚刚|刚才|本次|这次|那次/,
  /\b\d{4}-\d{2}-\d{2}\b/,
  /我们(发现|遇到|解决|修复)了/,
  /in\s+(this|that|the)\s+(session|conversation|incident|bug|issue)/i,
];

// 项目专有名词：如果 rule/skill content 含这些词，survives_without_project_nouns 不能声明为 true
const PROJECT_NOUN_PATTERNS = [
  /agi-memory|agi_memory/i,
  /hostModelGovernanceAdapter|governancePromptBuilder|L2ConflictDetector/i,
  /memory-service|memory-mcp-server/i,
  /trae|\.trae\//i,
  /super[-_]?agent/i,
  /kp_threshold_calibration|governance_change_proposal/i,
  /本仓库|本项目|本系统|本代码库/,
];

// ─── P3-2: canary 哨兵候选注入 ───
// 每 N 次 governance-run 注入 1 条人工标注的测试候选，校验 validateCandidate 的严格性。
// canary 候选不入库（validateCandidates 内部过滤），只记录 hit/miss 指标。
// miss 时给同批次其他候选追加 needs_review 标记，触发人工复核。
const CANARY_INJECTION_INTERVAL = 20;

interface CanaryResult {
  templateId: string;
  candidateType: string;
  title: string;
  hit: boolean;
  rejected: boolean;
  expectedReject: boolean;
  errorMessage: string | null;
  expectErrorPattern: string | null;
  timestamp: string;
}

interface CanaryExpectation {
  templateId: string;
  expectReject: boolean;
  expectErrorPattern: string | null;
}

const canaryState = {
  injectionCounter: 0,
  results: [] as CanaryResult[],
  pendingExpectations: new Map<string, CanaryExpectation>(),
  lastBatchHadMiss: false,
};

// 注入 canary 候选到 extraction_preview 的对应数组
// 接收 batch 以便为 rule 候选从 raw_inputs 构造真实的 source_refs（rule 候选强制要求 user_message + assistant_message）。
function maybeInjectCanary(
  extraction: Partial<GovernanceBatchPreviewResponse["extraction_preview"]>,
  batch: GovernanceBatchPreviewResponse
): void {
  canaryState.injectionCounter += 1;
  if (canaryState.injectionCounter % CANARY_INJECTION_INTERVAL !== 0) return;
  if (CANARY_TEMPLATES.length === 0) return;

  // 随机选 1 条模板
  const template = CANARY_TEMPLATES[Math.floor(Math.random() * CANARY_TEMPLATES.length)];

  // 构造 canary 候选（伪装成模型生成的候选）
  const canaryCandidate: Record<string, unknown> = {
    candidate_type: template.candidate_type,
    title: template.title,
    content: template.content,
    source_excerpt: template.source_excerpt,
    source_kind: template.source_kind,
    source_timestamp: template.source_timestamp,
    reason: template.reason,
    confidence: template.confidence,
    origin_scope: template.origin_scope,
    availability_scope: template.availability_scope,
    governance_level: template.governance_level,
    classification_trace: template.classification_trace,
    review_trace: template.review_trace,
    self_test: template.self_test,
    is_canary: true,
    canary_template_id: template.id,
  };

  // rule 候选额外字段：enforcement_level + metadata（validateCandidate 强制要求）
  if (template.candidate_type === "rule_candidate") {
    if (template.enforcement_level) {
      canaryCandidate.enforcement_level = template.enforcement_level;
    }
    if (template.metadata) {
      canaryCandidate.metadata = template.metadata;
    }
    // 从 batch.raw_inputs 构造 source_refs（rule 候选强制要求 user_message + assistant_message/commentary 各至少 1 条）
    // source_excerpt 取真实 session 文本，确保通过 P1-4 verifySourceExcerpt 校验。
    const userMessages = batch.raw_inputs?.user_messages ?? [];
    const commentaryMessages = batch.raw_inputs?.commentary_messages ?? [];
    const userMsg = userMessages[0];
    const commentaryMsg = commentaryMessages[0];
    if (userMsg && commentaryMsg) {
      canaryCandidate.source_refs = [
        {
          source_kind: "user_message",
          source_timestamp: userMsg.timestamp,
          source_excerpt: userMsg.text,
        },
        {
          source_kind: "commentary",
          source_timestamp: commentaryMsg.timestamp,
          source_excerpt: commentaryMsg.text,
        },
      ];
    }
  }

  // memory 候选额外字段：memory_type（不设时 validateCandidate 默认 session_memory）
  if (template.candidate_type === "memory_candidate" && template.memory_type) {
    canaryCandidate.memory_type = template.memory_type;
  }

  // skill 候选额外字段：promotion_status（强制 needs_review）+ skill 专属字段
  if (template.candidate_type === "skill_proposal_candidate") {
    if (template.promotion_status) {
      canaryCandidate.promotion_status = template.promotion_status;
    }
    canaryCandidate.target_skill = template.target_skill;
    canaryCandidate.proposed_text = template.proposed_text;
    canaryCandidate.current_gap = template.current_gap;
    canaryCandidate.change_type = template.change_type;
    canaryCandidate.validation_method = template.validation_method;
    canaryCandidate.description = template.description;
    canaryCandidate.applicable_scenarios = template.applicable_scenarios;
    canaryCandidate.non_applicable_scenarios = template.non_applicable_scenarios;
    canaryCandidate.execution_steps = template.execution_steps;
  }

  // 注入到对应数组
  const arrayKeyMap: Record<string, string> = {
    rule_candidate: "rule_candidates",
    memory_candidate: "memory_candidates",
    skill_proposal_candidate: "skill_proposal_candidates",
    knowledge_candidate: "knowledge_candidates",
  };
  const arrayKey = arrayKeyMap[template.candidate_type];
  const targetArray = (extraction as Record<string, unknown>)[arrayKey];
  if (Array.isArray(targetArray)) {
    targetArray.push(canaryCandidate);
  } else {
    (extraction as Record<string, unknown>)[arrayKey] = [canaryCandidate];
  }

  // 记录期望
  canaryState.pendingExpectations.set(template.id, {
    templateId: template.id,
    expectReject: template.expect_reject,
    expectErrorPattern: template.expect_error_pattern,
  });
}

// 校验 canary 候选的期望行为（不 throw，只记录 hit/miss）
function verifyCanaryCandidate(
  expectedType: GovernanceCandidatePreview["candidate_type"],
  candidate: unknown,
  rawSessionText: string
): void {
  const item = candidate as Record<string, unknown>;
  const templateId = String(item.canary_template_id ?? "");
  const title = String(item.title ?? "");

  const expectation = canaryState.pendingExpectations.get(templateId);
  if (!expectation) return;
  canaryState.pendingExpectations.delete(templateId);

  let rejected = false;
  let errorMessage: string | null = null;

  try {
    validateCandidate(expectedType, candidate, -1, rawSessionText);
  } catch (err) {
    rejected = true;
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  // 对比期望
  const rejectMatched = expectation.expectReject === rejected;
  const patternMatched = !expectation.expectErrorPattern ||
    (errorMessage?.includes(expectation.expectErrorPattern) ?? false);
  const hit = rejectMatched && patternMatched;

  canaryState.results.push({
    templateId,
    candidateType: expectedType,
    title,
    hit,
    rejected,
    expectedReject: expectation.expectReject,
    errorMessage,
    expectErrorPattern: expectation.expectErrorPattern,
    timestamp: new Date().toISOString(),
  });

  if (!hit) {
    canaryState.lastBatchHadMiss = true;
  }
}

// 导出 canary 监控指标（供治理健康度面板使用）
export function getCanaryStats(): {
  total: number;
  hit: number;
  miss: number;
  hitRate: number;
  recentResults: CanaryResult[];
} {
  const total = canaryState.results.length;
  const hit = canaryState.results.filter((r) => r.hit).length;
  const miss = total - hit;
  return {
    total,
    hit,
    miss,
    hitRate: total > 0 ? hit / total : 0,
    recentResults: canaryState.results.slice(-20),
  };
}

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

  // P0-c: host_model is the default, but if the host did not provide a model result,
  // do not hard-fail the ingestion. Loudly fall back to rules_fallback and quarantine
  // all candidates so that nothing reaches active recall.
  if (!input.hostModelResult?.extraction_preview) {
    return {
      batch: input.batch,
      modelAdapter: {
        mode: "rules_fallback",
        model_ref: null,
        generated_at: null,
        accepted: false,
        warning:
          "[P0-c] governance_mode=host_model but host_model_result.extraction_preview is missing. " +
          "Falling back to rules_fallback; all candidates are quarantined for review."
      }
    };
  }

  const extraction = input.hostModelResult.extraction_preview;
  // P3-2: canary 哨兵候选注入（每 N 次 governance-run 注入 1 条）
  maybeInjectCanary(extraction, input.batch);
  // P1-4: 提取原始 session 文本，用于 source_excerpt 真实性校验
  // 拼接 user_messages + commentary_messages 的 text 字段（这是 source_excerpt 的来源池）
  const rawSessionText = extractRawSessionText(input.batch.raw_inputs);

  const adaptedBatch: GovernanceBatchPreviewResponse = {
    ...input.batch,
    extraction_preview: {
      rule_candidates: validateCandidates("rule_candidate", extraction.rule_candidates, rawSessionText),
      memory_candidates: validateCandidates("memory_candidate", extraction.memory_candidates, rawSessionText),
      skill_proposal_candidates: validateCandidates("skill_proposal_candidate", extraction.skill_proposal_candidates, rawSessionText),
      knowledge_candidates: validateCandidates("knowledge_candidate", extraction.knowledge_candidates, rawSessionText),
      governance_evidence_candidates: validateCandidates("governance_evidence_candidate", extraction.governance_evidence_candidates, rawSessionText),
      // P1 派生机制：透传跨层派生关系，由 hostCaptureGovernanceBatch 计算 source_timestamp 同源链。
      layer_links: extraction.layer_links ?? []
    }
  };
  auditCrossLayerBoundaries(adaptedBatch);
  // P1-2: 同批次内跨候选 reasoning 雷同检测（防批量应付）
  auditIntraBatchSimilarity(adaptedBatch);

  // P3-2: canary miss 时给同批次其他候选追加 needs_review 标记
  if (canaryState.lastBatchHadMiss) {
    canaryState.lastBatchHadMiss = false;
    const allCandidates = [
      ...adaptedBatch.extraction_preview.rule_candidates,
      ...adaptedBatch.extraction_preview.memory_candidates,
      ...adaptedBatch.extraction_preview.skill_proposal_candidates,
      ...adaptedBatch.extraction_preview.knowledge_candidates,
    ];
    for (const candidate of allCandidates) {
      const originalReason = candidate.reason ?? "";
      if (!originalReason.includes("[⚠️ canary miss]")) {
        candidate.reason = `${originalReason} [⚠️ canary miss：同批次哨兵候选校验失败，走人工审批]`;
        if (candidate.promotion_status !== "needs_review") {
          candidate.promotion_status = "needs_review";
        }
      }
    }
  }

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

      // P0.5: §9 knowledge must not contain project-internal state, local paths, or user preferences.
      if (layer === "knowledge_candidate") {
        const text = `${item.title}\n${item.content ?? item.source_excerpt}`.toLowerCase();
        const projectInternalSignals = [
          // machine-specific paths (Windows / Unix / macOS)
          "d:\\workspace",
          "c:\\users\\administrator",
          "c:\\users\\yangy",
          "c:\\",
          "/users/",
          "/home/",
          "/workspace/",
          "superagentsystem",
          // project-internal framing (Chinese)
          "本项目",
          "本仓库",
          "本系统",
          "本代码库",
          "本机",
          "这台机器",
          "我的电脑",
          "我的机器",
          "项目内部",
          "项目路径",
          "项目根目录",
          "仓库根目录",
          "项目配置",
          "项目环境",
          "代码库",
          "workspace 目录",
          "workspace目录",
          "工作目录",
          "本地环境",
          "本地路径",
          "本机路径",
          "绝对路径",
          // user-preference framing (Chinese)
          "用户偏好",
          "用户希望",
          "用户喜欢",
          "用户讨厌",
          "用户习惯",
          "用户设置",
          "个人偏好",
          "偏好设置",
          "回答风格",
          "简洁回答",
          "详细回答",
          "不喜欢详细",
          // local network / dev-only endpoints
          "127.0.0.1",
          "0.0.0.0",
          "localhost",
          "://localhost",
          "://127.0.0.1",
          // database connection strings
          "postgresql://",
          "mysql://",
          "mongodb://",
          "mongodb+srv://",
          "redis://",
          "sqlite:",
          // common project-internal artifacts
          "process.cwd()",
          "node_modules",
          "npm run build",
          "package.json",
          "tsconfig.json",
          ".env"
        ];
        if (projectInternalSignals.some((signal) => text.includes(signal))) {
          throw new Error(formatValidationError(
            `knowledge_candidate[${index}]`,
            "contains project-internal, machine-specific, or user-preference content (spec 39 §9 violation)",
            "Knowledge must be universally reusable. Move project-internal facts to memory_candidate, user preferences to memory_candidate, machine paths to governance_evidence_candidate, or discard.",
            `knowledge_candidate content: "Zod catchall schemas silently strip undeclared fields during JSON-RPC serialization" (no paths, no machine names, no user preferences)`
          ));
        }
      }
    }
  }
}

function validateCandidates(
  expectedType: GovernanceCandidatePreview["candidate_type"],
  candidates: unknown,
  rawSessionText: string
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
  // P3-2: 分离 canary 候选（内部测试候选，不传给 validateCandidate 正常路径）
  const normalCandidates: unknown[] = [];
  const canaryCandidates: unknown[] = [];
  for (const c of candidates) {
    if (c && typeof c === "object" && (c as Record<string, unknown>).is_canary === true) {
      canaryCandidates.push(c);
    } else {
      normalCandidates.push(c);
    }
  }

  const validated = normalCandidates.map((candidate, index) => validateCandidate(expectedType, candidate, index, rawSessionText));

  // P3-2: 对 canary 候选做期望校验（不 throw，只记录 hit/miss），canary 候选不入库
  for (const canary of canaryCandidates) {
    verifyCanaryCandidate(expectedType, canary, rawSessionText);
  }

  if (expectedType === "rule_candidate") {
    return validated.filter((item) => !isHardcodedHostActionRule(item));
  }
  return validated;
}

function isHardcodedHostActionRule(item: GovernanceCandidatePreview): boolean {
  const text = `${item.title ?? ""}\n${item.content ?? ""}\n${item.source_excerpt ?? ""}`.toLowerCase();
  const mentionsHostAction = text.includes("host_action") || text.includes("宿主动作");
  const mentionsDoneSummary = text.includes("done") && text.includes("summary");
  const mentionsCodeGeneration = text.includes("gate-master") || text.includes("skill-creator") || text.includes("代码生成");
  return mentionsHostAction && mentionsDoneSummary && mentionsCodeGeneration;
}

function validateCandidate(
  expectedType: GovernanceCandidatePreview["candidate_type"],
  candidate: unknown,
  index: number,
  rawSessionText: string
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
  if (!containsChinese(title)) {
    throw new Error(formatValidationError(
      `${expectedType}[${index}].title`,
      "must be in Chinese",
      "标题必须包含中文。技术术语可保留英文，但整体必须是中文语句。",
      `"title": "Zod catchall 模式静默数据丢失陷阱"`
    ));
  }
  // P0-d: layer-aware scope validation from the shared single source of truth.
  const layerScopes = GOVERNANCE_SCOPE_BY_LAYER[expectedType];
  const originScope = readEnum(item, "origin_scope", layerScopes.origin_scope);
  const availabilityScope = readEnum(item, "availability_scope", layerScopes.availability_scope);
  const governanceLevel = readEnum(item, "governance_level", layerScopes.governance_level);
  const promotionStatus = readOptionalEnum(item, "promotion_status", VALID_PROMOTION_STATUSES) ?? "active";
  const sourceKind = readString(item, "source_kind") as GovernanceCandidatePreview["source_kind"];
  const sourceTimestamp = readString(item, "source_timestamp");
  const sourceExcerpt = readString(item, "source_excerpt");
  const reason = readString(item, "reason");
  if (!containsChinese(reason)) {
    throw new Error(formatValidationError(
      `${expectedType}[${index}].reason`,
      "must be in Chinese",
      "理由必须包含中文描述",
      `"reason": "该规则防止未来在类似场景下重复犯错"`
    ));
  }
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

    // 技能描述必填且必须为中文
    const description = readString(item, "description");
    if (!containsChinese(description)) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].description`,
        "must be in Chinese",
        "技能描述必须包含中文。格式：'做 X。在 Y 发生时或用户要求 Z 时调用。'",
        `"description": "在用户写小说新章节时自动检查设定一致性。在生成新章节或修改核心设定时调用。"`
      ));
    }

    // 适用场景必填，String 数组，每个元素必须含中文
    const applicableScenarios = item.applicable_scenarios;
    if (!Array.isArray(applicableScenarios) || applicableScenarios.length === 0) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].applicable_scenarios`,
        "is required and must be a non-empty String array",
        "提供至少一个适用场景，每个场景用中文描述",
        `"applicable_scenarios": ["生成新章节前预检设定一致性", "用户修改核心设定后检查矛盾"]`
      ));
    }
    for (let si = 0; si < applicableScenarios.length; si++) {
      if (typeof applicableScenarios[si] !== "string" || applicableScenarios[si].trim() === "") {
        throw new Error(formatValidationError(
          `${expectedType}[${index}].applicable_scenarios[${si}]`,
          "each scenario must be a non-empty string",
          "每个场景用一句中文描述",
          `"applicable_scenarios": ["生成新章节前预检设定一致性"]`
        ));
      }
      if (!containsChinese(applicableScenarios[si])) {
        throw new Error(formatValidationError(
          `${expectedType}[${index}].applicable_scenarios[${si}]`,
          "must be in Chinese",
          "适用场景必须包含中文",
          `"applicable_scenarios": ["生成新章节前预检设定一致性"]`
        ));
      }
    }

    // 非适用场景必填，String 数组，每个元素必须含中文
    const nonApplicableScenarios = item.non_applicable_scenarios;
    if (!Array.isArray(nonApplicableScenarios) || nonApplicableScenarios.length === 0) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].non_applicable_scenarios`,
        "is required and must be a non-empty String array",
        "提供至少一个非适用场景，每个场景用中文描述",
        `"non_applicable_scenarios": ["纯文字润色不涉及设定逻辑时不调用", "新建项目初始设定创建时不调用"]`
      ));
    }
    for (let si = 0; si < nonApplicableScenarios.length; si++) {
      if (typeof nonApplicableScenarios[si] !== "string" || nonApplicableScenarios[si].trim() === "") {
        throw new Error(formatValidationError(
          `${expectedType}[${index}].non_applicable_scenarios[${si}]`,
          "each scenario must be a non-empty string",
          "每个场景用一句中文描述",
          `"non_applicable_scenarios": ["纯文字润色不涉及设定逻辑时不调用"]`
        ));
      }
      if (!containsChinese(nonApplicableScenarios[si])) {
        throw new Error(formatValidationError(
          `${expectedType}[${index}].non_applicable_scenarios[${si}]`,
          "must be in Chinese",
          "非适用场景必须包含中文",
          `"non_applicable_scenarios": ["纯文字润色不涉及设定逻辑时不调用"]`
        ));
      }
    }

    // execution_steps 必填，String 数组
    const execSteps = item.execution_steps;
    if (!Array.isArray(execSteps) || execSteps.length === 0) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].execution_steps`,
        "is required and must be a non-empty String array",
        "提供至少一个执行步骤，每个步骤用中文描述一个原子动作",
        `"execution_steps": ["检查目标主机的 Node 版本兼容性", "生成 PM2 ecosystem.config.cjs"]`
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
      if (!containsChinese(execSteps[si])) {
        throw new Error(formatValidationError(
          `${expectedType}[${index}].execution_steps[${si}]`,
          "must be in Chinese",
          "执行步骤必须包含中文",
          `"execution_steps": ["1. 检查目标主机 Node 版本兼容性"]`
        ));
      }
    }

    // validation_method 必须为中文
    if (!containsChinese(validationMethod)) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].validation_method`,
        "must be in Chinese",
        "验证方法必须包含中文描述",
        `"validation_method": "选取最近 3 章由该技能预检查，确认无用户后续指出同类设定漏洞"`
      ));
    }

    // current_gap 必须为中文
    if (!containsChinese(currentGap)) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].current_gap`,
        "must be in Chinese",
        "当前缺口必须包含中文描述",
        `"current_gap": "当前技能缺少设定一致性检查步骤，导致章节间出现设定矛盾"`
      ));
    }

    // proposed_text 必须为中文
    if (!containsChinese(proposedText)) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].proposed_text`,
        "must be in Chinese",
        "提议文本必须包含中文描述",
        `"proposed_text": "在生成新章节前，加载设定文档并核对角色状态、道具规则等一致性"`
      ));
    }

    // §S-SelfTest 硬门控：LLM 必须显式回答两个自测问题，后端强制验证
    const skillSelfTest = readSelfTest(item, "skill_proposal_candidate", index, ["executable_with_generic_terms", "proven_multi_step"]);
    if (skillSelfTest.executable_with_generic_terms !== true) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].self_test.executable_with_generic_terms`,
        "must be true — 把项目特定名词替换成通用术语后，步骤是否仍然能被另一个 AI 完整执行？如果否，降级为 project 级或丢弃",
        "反例（全局级）：「打开 坑.txt 核对江妄的心跳」→ 换通用词就不知道核对了 → 重写或降级 project 级\n正例（全局级）：「将悬置状态物化为持久化追踪对象」→ 换通用词仍可执行 → 通过",
        `"self_test": { "executable_with_generic_terms": true, "proven_multi_step": true }`
      ));
    }
    if (skillSelfTest.proven_multi_step !== true) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].self_test.proven_multi_step`,
        "must be true — 必须是 ≥ 2 个原子动作的经验证流程。一次性命令不是 Skill，降级为 Rule 或丢弃",
        "反例：「运行 npm install」→ 单步命令 → 转 Rule 或丢弃\n正例：「检查 Node 版本 → 生成 PM2 ecosystem → 写 systemd 配置 → 验证 /healthz」→ 通过",
        `"self_test": { "executable_with_generic_terms": true, "proven_multi_step": true }`
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
      proposal_quality: proposalQuality as GovernanceCandidatePreview["proposal_quality"],
      description: description,
      applicable_scenarios: applicableScenarios,
      non_applicable_scenarios: nonApplicableScenarios,
      execution_steps: execSteps,
      self_test: skillSelfTest
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
    validated.rule_scope = (readOptionalEnum(item, "rule_scope", GOVERNANCE_SCOPE_BY_LAYER.rule_candidate.origin_scope) ?? originScope) as GovernanceCandidatePreview["rule_scope"];
    validated.applies_to_phase = readOptionalStringArrayEnum(item, "applies_to_phase", VALID_PHASES, ["review"]) as GovernanceCandidatePreview["applies_to_phase"];
    validated.violation_behavior = (readOptionalEnum(item, "violation_behavior", VALID_VIOLATION_BEHAVIORS) ?? "warn") as GovernanceCandidatePreview["violation_behavior"];
    // §R-SelfTest 硬门控：LLM 必须显式回答两个自测问题，后端强制验证
    const ruleSelfTest = readSelfTest(item, "rule_candidate", index, ["survives_without_project_nouns", "host_layer_gate"]);
    if (ruleSelfTest.survives_without_project_nouns !== true) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].self_test.survives_without_project_nouns`,
        "must be true — 抹掉项目名词后规则仍然成立吗？如果否，说明这是项目级 Memory 或 Skill 步骤，不是 Rule",
        "把项目特定名词替换成通用术语后，规则是否仍是一条运行时门控？如果是代码层约束，降级为 project_memory",
        `"self_test": { "survives_without_project_nouns": true, "host_layer_gate": true }`
      ));
    }
    if (ruleSelfTest.host_layer_gate !== true) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].self_test.host_layer_gate`,
        "must be true — 这是宿主层应该拦截的，还是代码层硬编码的？代码硬编码约束降级为 project_memory",
        "判据：这条规则是否需要在宿主调用动作前做拦截？如果是代码层面强制的，不进 Rule 层",
        `"self_test": { "survives_without_project_nouns": true, "host_layer_gate": true }`
      ));
    }
    (validated as Record<string, unknown>).self_test = ruleSelfTest;
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

    // 硬拦截：规则必须经人工审批，禁止直接激活
    validated.promotion_status = "needs_review";

    // 硬拦截：规则执行级别必须是 must，禁止 must_not
    const enforcementLevel = readOptionalString(item, "enforcement_level");
    if (enforcementLevel !== null && enforcementLevel !== "must") {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].enforcement_level`,
        `must be "must" but got "${enforcementLevel}"`,
        "All rules extracted from host governance are mandatory constraints and must use enforcement_level='must'.",
        `"enforcement_level": "must"`
      ));
    }

    // 硬拦截：人类可读解释必须存在且为中文
    const metadata = item.metadata ?? {};
    if (typeof metadata !== "object" || metadata === null) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].metadata`,
        "must be an object",
        "Provide a metadata object with human_readable_statement and classification_rationale",
        `"metadata": { "human_readable_statement": "...", "classification_rationale": "..." }`
      ));
    }
    const humanReadable = (metadata as Record<string, unknown>).human_readable_statement;
    if (typeof humanReadable !== "string" || humanReadable.trim().length === 0) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].metadata.human_readable_statement`,
        "is required and must be a non-empty Chinese statement",
        "Provide a Chinese human-readable summary of the rule intent and consequence.",
        `"metadata": { "human_readable_statement": "规则要求所有治理抽取的规则必须使用中文描述，否则会被拦截。" }`
      ));
    }
    if (!containsChinese(humanReadable)) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].metadata.human_readable_statement`,
        "must be in Chinese",
        "Translate the human-readable explanation into Chinese.",
        `"metadata": { "human_readable_statement": "规则要求..." }`
      ));
    }

    // 硬拦截：必须说明为何归类为 rule 而非 skill
    const classificationRationale = (metadata as Record<string, unknown>).classification_rationale;
    if (typeof classificationRationale !== "string" || classificationRationale.trim().length === 0) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].metadata.classification_rationale`,
        "is required",
        "Explain why this item is a rule (IF/THEN constraint) rather than a skill (reusable procedure).",
        `"metadata": { "classification_rationale": "这是约束性规则，因为它规定了 IF...THEN 必须/禁止的行为，而不是可复用的操作步骤。" }`
      ));
    }
    if (!containsChinese(classificationRationale)) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].metadata.classification_rationale`,
        "must be in Chinese",
        "Provide the classification rationale in Chinese.",
        `"metadata": { "classification_rationale": "这是约束性规则..." }`
      ));
    }

    // 硬拦截：来源对话必须至少包含一轮完整对话（user + assistant）
    const sourceRefs = Array.isArray(item.source_refs) ? item.source_refs : [];
    const userRefs = sourceRefs.filter(
      (r: unknown) => typeof r === "object" && r !== null && (r as Record<string, unknown>).source_kind === "user_message"
    );
    const assistantRefs = sourceRefs.filter(
      (r: unknown) => typeof r === "object" && r !== null &&
        ["assistant_message", "commentary"].includes(String((r as Record<string, unknown>).source_kind))
    );
    if (userRefs.length === 0 || assistantRefs.length === 0) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].source_refs`,
        "must contain at least one complete conversation round (user_message + assistant_message)",
        "Include both sides of the conversation that justifies this rule, not a single excerpt.",
        `"source_refs": [{ "source_kind": "user_message", ... }, { "source_kind": "assistant_message", ... }]`
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
    // §M-SelfTest 硬门控：LLM 必须显式回答三个自测问题，后端强制验证
    const memorySelfTest = readSelfTest(item, "memory_candidate", index, ["one_month_value", "about_user_not_code", "time_diluted"]);
    if (memorySelfTest.one_month_value !== true) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].self_test.one_month_value`,
        "must be true — 一月后回头看这条信息还支撑未来交互吗？如果否，说明这是一次性实现细节，降级为 Evidence 或丢弃",
        "反例：「这次把端口改成了 8080」→ 一月后毫无价值 → 丢弃\n正例：「用户偏好简洁回答」→ 永久价值 → 通过",
        `"self_test": { "one_month_value": true, "about_user_not_code": true, "time_diluted": "stable" }`
      ));
    }
    if (memorySelfTest.about_user_not_code !== true) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].self_test.about_user_not_code`,
        "must be true — Memory 必须刻画人，不是记录实现细节。如果是关于代码/配置/Bug修复的，降级为 Evidence 或 Knowledge",
        "反例：「我们把 .env 改成了 15432」→ 关于代码 → 转 Evidence\n正例：「用户偏好 PM2 部署而非 Docker」→ 关于用户 → 通过",
        `"self_test": { "one_month_value": true, "about_user_not_code": true, "time_diluted": "stable" }`
      ));
    }
    // time_diluted 影响 stability：如果 LLM 声明 temporary，强制 stability=temporary
    if (memorySelfTest.time_diluted === "temporary") {
      validated.stability = "temporary";
    }
    (validated as Record<string, unknown>).self_test = memorySelfTest;
  }

  if (expectedType === "knowledge_candidate") {
    validated.content = readOptionalString(item, "content") ?? sourceExcerpt;
    // P0-b: default to a spec-valid synthesis type; "cross_source_pattern" is not in spec 39 §7.5.
    validated.knowledge_type = (readOptionalEnum(item, "knowledge_type", VALID_KNOWLEDGE_TYPES) ?? "synthesis") as GovernanceCandidatePreview["knowledge_type"];
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
    // §K-SelfTest 硬门控：LLM 必须显式回答双重门槛，后端强制验证
    const knowledgeSelfTest = readSelfTest(item, "knowledge_candidate", index, ["ood_threshold", "reusable", "learning_chain_anchored"]);
    if (knowledgeSelfTest.ood_threshold !== true) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].self_test.ood_threshold`,
        "must be true — 这条认知是否超出主流大模型的训练分布？如果是模型都会的常识，降级为 Evidence",
        "反例：「PostgreSQL 支持 JSONB 类型」→ 主流模型都会 → 降级 Evidence\n正例：「Zod catchall 在 JSON-RPC 序列化时静默剥离嵌套字段」→ 模型训练数据里几乎没有 → 通过",
        `"self_test": { "ood_threshold": true, "reusable": true, "learning_chain_anchored": true }`
      ));
    }
    if (knowledgeSelfTest.reusable !== true) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].self_test.reusable`,
        "must be true — 未来在相似场景下，AI 真的会需要这条认知做决策吗？如果是一次性事实，降级为 Memory",
        "反例：「本次项目里我们用了 7 个 skill」→ 一次性事实 → 降级 Memory\n正例：「PowerShell 5.x 输出非 ASCII 必须显式设 OutputEncoding」→ 任何 Windows 环境都会复用 → 通过",
        `"self_test": { "ood_threshold": true, "reusable": true, "learning_chain_anchored": true }`
      ));
    }
    if (knowledgeSelfTest.learning_chain_anchored !== true) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].self_test.learning_chain_anchored`,
        "must be true — 必须有 search→learn→apply 三段式证据或跨事实归纳推理。没有总结性文本则不硬造 Knowledge",
        "如果是 acquired 类型，必须有外部检索学习链；如果是 synthesized 类型，必须给出跨事实归纳推理",
        `"self_test": { "ood_threshold": true, "reusable": true, "learning_chain_anchored": true }`
      ));
    }
    (validated as Record<string, unknown>).self_test = knowledgeSelfTest;
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

  // §Fix-3 强制决策树校验：rule/memory/skill/knowledge 候选必须携带 classification_trace
  // evidence 候选不需要（evidence 是原始数据，不需要分类判断）
  if (expectedType !== "governance_evidence_candidate") {
    const trace = item.classification_trace;
    if (!trace || typeof trace !== "object") {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].classification_trace`,
        "is required (evidence 候选除外)",
        "模型必须逐条过 Q1-Q4 决策树并记录中间结果，不接受裸结论。",
        `"classification_trace": { "q1_is_gate_decision": false, "q1a_trigger_binds_skill": null, "q2_is_reusable_workflow": false, "q3_binds_specific_event": true, "q4_is_general_knowledge": false, "decision_layer": "memory", "decision_reasoning": "Q1 不命中（不是放行判断），Q2 不命中（不是可复用流程），Q3 命中（绑定具体经历），归入 Memory" }`
      ));
    }
    const traceObj = trace as Record<string, unknown>;
    // 校验 decision_layer 与 candidate_type 一致
    const expectedLayer = candidateTypeToLayer(expectedType);
    const actualLayer = String(traceObj.decision_layer ?? "");
    if (actualLayer !== expectedLayer) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].classification_trace.decision_layer`,
        `must be "${expectedLayer}" to match candidate_type "${expectedType}" but got "${actualLayer}"`,
        "决策树最终分类必须与候选类型一致。如果不一致，说明分类判断有误，请重新过决策树或调整候选类型。",
        `"decision_layer": "${expectedLayer}"`
      ));
    }
    // 校验 decision_reasoning 引用了 Q 编号（证明真的过了决策树）
    const reasoning = String(traceObj.decision_reasoning ?? "");
    if (!/Q[1-4]/.test(reasoning)) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].classification_trace.decision_reasoning`,
        "must reference Q1-Q4 decision steps",
        "决策依据必须引用命中的 Q 编号，证明模型真的逐条过了决策树，不是直接给结论。",
        `"decision_reasoning": "Q1 命中（决定放行），Q1a 不命中（触发条件非具体Skill），归入 Rule"`
      ));
    }
    // 校验必需的 Q 字段存在且为 boolean
    const requiredQFields = ["q1_is_gate_decision", "q2_is_reusable_workflow", "q3_binds_specific_event", "q4_is_general_knowledge"];
    for (const qField of requiredQFields) {
      const val = traceObj[qField];
      if (typeof val !== "boolean") {
        throw new Error(formatValidationError(
          `${expectedType}[${index}].classification_trace.${qField}`,
          "must be a boolean (true/false)",
          "每个 Q 字段必须显式回答 true 或 false，不允许省略或填 null。",
          `"${qField}": true`
        ));
      }
    }
    (validated as Record<string, unknown>).classification_trace = traceObj;

    // P1-1: reasoning 具体性校验（n-gram 重合度）
    // 检查 decision_reasoning 是否真的针对这条候选，还是万能套话。
    // 复用 L2ConflictDetector 的 tokenize + jaccardSimilarity。
    const specificity = reasoningSpecificityScore(
      reasoning,
      validated.title,
      String(validated.content ?? "")
    );
    if (specificity < REASONING_SPECIFICITY_THRESHOLD) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].classification_trace.decision_reasoning`,
        `specificity score ${specificity.toFixed(3)} below threshold ${REASONING_SPECIFICITY_THRESHOLD}`,
        "decision_reasoning 必须引用候选 title/content 中的具体词汇，不能是万能套话。引用 Q 编号只是入门门槛，还需说明每个 Q 为什么命中/不命中（绑定候选的具体词汇）。",
        `BAD: "Q1 不命中，Q3 命中，归入 Memory"（万能套话，对任何 memory 候选都适用）\nGOOD: "Q1 不命中（不是关于 PostgreSQL 连接池的放行判断），Q3 命中（绑定 2026-07-10 连接池泄漏那次经历）"（引用了候选中的具体词汇）`
      ));
    }

    // §Fix-2 独立复核校验：rule/memory/skill/knowledge 候选必须携带 review_trace
    const review = item.review_trace;
    if (!review || typeof review !== "object") {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].review_trace`,
        "is required (evidence 候选除外)",
        "分类结果产出后必须做一次换位复核。假装你是另一个没看过这次对话的模型，只看 title+content 重新判断该归哪一层。",
        `"review_trace": { "review_layer": "memory", "review_reasoning": "只看标题和正文，这段内容绑定具体经历而非放行判断，归入 Memory 合理", "consensus": true }`
      ));
    }
    const reviewObj = review as Record<string, unknown>;
    const reviewLayer = String(reviewObj.review_layer ?? "");
    const validLayers = ["rule", "memory", "skill", "knowledge", "evidence"];
    if (!validLayers.includes(reviewLayer)) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].review_trace.review_layer`,
        `must be one of: ${validLayers.join(", ")}`,
        "复核分类必须是四层之一或 evidence。",
        `"review_layer": "${expectedLayer}"`
      ));
    }
    const consensus = reviewObj.consensus;
    if (typeof consensus !== "boolean") {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].review_trace.consensus`,
        "must be a boolean (true/false)",
        "consensus 表示复核结果是否与初判一致。",
        `"consensus": true`
      ));
    }
    const reviewReasoning = String(reviewObj.review_reasoning ?? "");
    if (!containsChinese(reviewReasoning)) {
      throw new Error(formatValidationError(
        `${expectedType}[${index}].review_trace.review_reasoning`,
        "must be in Chinese",
        "复核依据必须包含中文描述。",
        `"review_reasoning": "只看标题和正文，这段内容描述的是用户偏好而非放行判断，归入 Memory 合理"`
      ));
    }
    // consensus=false 时强制 promotion_status=needs_review（走人工审批）
    if (!consensus) {
      validated.promotion_status = "needs_review";
      // 在 reason 字段追加分歧标记
      const originalReason = validated.reason ?? "";
      validated.reason = `${originalReason} [⚠️ 复核分歧：初判=${expectedLayer}，复核=${reviewLayer}，走人工审批]`;
    }
    (validated as Record<string, unknown>).review_trace = reviewObj;
  }

  // P1-3: self_test 与 content 交叉验证（声明值 vs 实际内容一致性）
  // 在 validateLayerBoundary 之前执行，因为 self_test 已读取到 validated 对象上。
  crossValidateSelfTest(expectedType, validated, index);

  // P1-4: source_refs excerpt 真实性校验
  // 检查 source_excerpt 是否真的出现在原始 session 文本里，防止模型编造来源。
  // rawSessionText 为空时跳过（非 session 来源的候选，如 runGovernanceFromExtraction 路径）。
  verifySourceExcerpt(expectedType, validated, index, rawSessionText);

  validateLayerBoundary(expectedType, validated, index);
  return validated;
}

function formatValidationError(field: string, issue: string, fix: string, example: string): string {
  return `${field}: ${issue}. Fix: ${fix}. Example: ${example}`;
}

// ─── P1-1: reasoning 具体性评分 ───
// 检查 decision_reasoning 是否真的针对这条候选，还是万能套话。
// 不直接复用 jaccardSimilarity（它用字符级中文 token，交集太小易误杀）。
// 改用"候选特有 token 命中率"：提取候选的英文专名 + 中文 bigram 作为特有词汇，
// 检查 reasoning 命中了多少。套话 reasoning 命中 0，具体 reasoning 命中 3-5 个。
function reasoningSpecificityScore(
  reasoning: string,
  candidateTitle: string,
  candidateContent: string
): number {
  const candidateText = `${candidateTitle} ${candidateContent}`;
  const candidateTokens = extractTokensForSpecificity(candidateText);
  if (candidateTokens.size === 0) return 1;  // 候选无特有 token（如纯标点），无法校验，放行

  const reasoningTokens = extractTokensForSpecificity(reasoning);
  let hitCount = 0;
  for (const token of candidateTokens) {
    if (reasoningTokens.has(token)) hitCount++;
  }
  // 返回命中率（命中数 / 候选 token 总数）
  // 阈值 0.15 意味着候选有 20 个特有 token 时，reasoning 需命中 3 个。
  return hitCount / candidateTokens.size;
}

// 提取文本的特有 token：英文单词 + 中文 bigram（2字符滑动窗口）
// 中文用 bigram 而非单字符，因为"静默剥离"和"静默数据"的语义交集是"静默"（bigram），不是"静"/"默"（单字符）。
function extractTokensForSpecificity(text: string): Set<string> {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "have", "has",
    "do", "does", "will", "would", "could", "should", "may", "might", "must",
    "if", "then", "and", "or", "not", "but", "in", "on", "at", "to", "for",
    "this", "that", "with", "from", "by", "as", "of", "it", "its",
  ]);

  // 英文 token：长度 > 2 的单词（避免 "is"/"a" 等噪音）
  const englishTokens = (text.match(/[a-zA-Z][a-zA-Z0-9_]{2,}/g) ?? [])
    .map((t) => t.toLowerCase())
    .filter((t) => !stopWords.has(t));

  // 中文 bigram：2 字符滑动窗口
  const cjkBigrams: string[] = [];
  const cjkText = text.replace(/[^\u4e00-\u9fff]/g, "");
  for (let i = 0; i < cjkText.length - 1; i++) {
    const bigram = cjkText.slice(i, i + 2);
    cjkBigrams.push(bigram);
  }

  return new Set([...englishTokens, ...cjkBigrams]);
}

// ─── P1-2: 同批次内跨候选 reasoning 雷同检测 ───
// 遍历同批次内同层候选的 classification_trace.decision_reasoning，
// 对每对做 Jaccard 相似度。相似度 > 阈值 → 计为雷同对。
// 雷同对数 > MAX_INTRA_BATCH_DUPLICATE_PAIRS → 整批 REJECT。
function auditIntraBatchSimilarity(batch: GovernanceBatchPreviewResponse): void {
  const layers: Array<{ layer: string; candidates: GovernanceCandidatePreview[] }> = [
    { layer: "rule_candidate", candidates: batch.extraction_preview.rule_candidates },
    { layer: "memory_candidate", candidates: batch.extraction_preview.memory_candidates },
    { layer: "skill_proposal_candidate", candidates: batch.extraction_preview.skill_proposal_candidates },
    { layer: "knowledge_candidate", candidates: batch.extraction_preview.knowledge_candidates },
  ];

  for (const { layer, candidates } of layers) {
    // 单条或空候选无需比较
    if (candidates.length < 2) continue;

    // 提取每条候选的 reasoning
    const reasonings = candidates.map((c) => {
      const trace = (c as Record<string, unknown>).classification_trace as Record<string, unknown> | undefined;
      return String(trace?.decision_reasoning ?? "");
    });

    let duplicatePairCount = 0;
    const duplicatePairs: Array<{ i: number; j: number; score: number }> = [];

    for (let i = 0; i < reasonings.length; i++) {
      if (!reasonings[i]) continue;
      for (let j = i + 1; j < reasonings.length; j++) {
        if (!reasonings[j]) continue;
        const score = jaccardSimilarity(reasonings[i], reasonings[j]);
        if (score > INTRA_BATCH_SIMILARITY_THRESHOLD) {
          duplicatePairCount++;
          duplicatePairs.push({ i, j, score });
        }
      }
    }

    if (duplicatePairCount > MAX_INTRA_BATCH_DUPLICATE_PAIRS) {
      const pairDesc = duplicatePairs
        .slice(0, 5)  // 最多列 5 对，避免错误信息过长
        .map((p) => `[${p.i}]vs[${p.j}] score=${p.score.toFixed(3)}`)
        .join(", ");
      throw new Error(formatValidationError(
        `intra-batch audit (${layer})`,
        `${duplicatePairCount} duplicate reasoning pairs detected (threshold: ${MAX_INTRA_BATCH_DUPLICATE_PAIRS}). Pairs: ${pairDesc}`,
        "同批次内多条候选的 decision_reasoning 高度雷同（Jaccard > 0.7），疑似批量应付。每条候选的 reasoning 必须引用该候选特有的词汇，说明每个 Q 为什么命中/不命中。",
        `BAD: 3 条 memory 候选都写 "Q1 不命中，Q3 命中，归入 Memory"\nGOOD: 每条 reasoning 引用各自候选的 title/content 中的具体词汇，措辞各不相同`
      ));
    }

    // 雷同对数 ≤ 2：在每条雷同候选的 reason 字段追加警告标记
    if (duplicatePairCount > 0) {
      const flaggedIndices = new Set<number>();
      for (const pair of duplicatePairs) {
        flaggedIndices.add(pair.i);
        flaggedIndices.add(pair.j);
      }
      for (const idx of flaggedIndices) {
        const candidate = candidates[idx];
        const originalReason = candidate.reason ?? "";
        if (!originalReason.includes("[⚠️ 同批次雷同]")) {
          candidate.reason = `${originalReason} [⚠️ 同批次雷同：reasoning 与同批次其他候选高度相似，走人工审批]`;
          if (candidate.promotion_status !== "needs_review") {
            candidate.promotion_status = "needs_review";
          }
        }
      }
    }
  }
}

// ─── P1-3: self_test 与 content 交叉验证 ───
// 检查 self_test 声明的 true/false 是否与 content 实际内容一致。
// 如果声明 about_user_not_code=true 但 content 全是代码实现细节 → 矛盾，REJECT。
// 复用 validateLayerBoundary 的模式数组（已提取为模块级常量）。
function crossValidateSelfTest(
  expectedType: GovernanceCandidatePreview["candidate_type"],
  candidate: GovernanceCandidatePreview,
  index: number
): void {
  // evidence 候选不需要 self_test，跳过
  if (expectedType === "governance_evidence_candidate") return;

  const selfTest = (candidate as Record<string, unknown>).self_test as Record<string, unknown> | undefined;
  if (!selfTest) return;  // readSelfTest 已校验过必填，这里兜底

  const contentText = `${String(candidate.title ?? "")}\n${String(candidate.content ?? "")}`.toLowerCase();
  const contentForCheck = String(candidate.content ?? "");

  if (expectedType === "memory_candidate") {
    // about_user_not_code=true → content 不应全是代码实现细节
    const aboutUser = selfTest.about_user_not_code;
    if (aboutUser === true) {
      const implCount = IMPL_SIGNALS.filter((s) => contentText.includes(s)).length;
      const hasUserProfile = USER_PROFILE_SIGNALS.some((s) => contentText.includes(s));
      if (implCount >= 2 && !hasUserProfile) {
        throw new Error(formatValidationError(
          `${expectedType}[${index}].self_test.about_user_not_code`,
          `declared true but content contains ${implCount} implementation signals and 0 user-profile signals — declaration contradicts content`,
          "self_test.about_user_not_code=true 表示 content 是关于用户的，但实际 content 全是代码实现细节。要么改 content 为用户画像，要么把 self_test 改为 false 并丢弃该候选。",
          `BAD: content="MCP looseObjectSchema silently strips nested fields" + self_test.about_user_not_code=true\nGOOD: content="用户是后端工程师，偏好简洁回答" + self_test.about_user_not_code=true`
        ));
      }
    }

    // time_diluted="stable" → content 不应含时间敏感词
    const timeDiluted = selfTest.time_diluted;
    if (timeDiluted === "stable") {
      const matchedPattern = TIME_SENSITIVE_PATTERNS.find((p) => p.test(contentForCheck));
      if (matchedPattern) {
        throw new Error(formatValidationError(
          `${expectedType}[${index}].self_test.time_diluted`,
          `declared "stable" but content contains time-sensitive terms: "${contentForCheck.match(matchedPattern)?.[0] ?? ""}"`,
          "self_test.time_diluted=stable 表示这条记忆持久有效，但 content 含时间敏感词（今天/昨天/版本号/日期）。要么删除时间敏感词，要么把 time_diluted 改为 temporary。",
          `BAD: content="今天发现的 PostgreSQL 连接池泄漏" + time_diluted=stable\nGOOD: content="PostgreSQL 连接池泄漏的根因是 idle timeout 过短" + time_diluted=stable`
        ));
      }
    }
  }

  if (expectedType === "knowledge_candidate") {
    // ood_threshold=true → content 不应是常识性陈述
    const oodThreshold = selfTest.ood_threshold;
    if (oodThreshold === true) {
      const matchedPattern = COMMON_KNOWLEDGE_PATTERNS.find((p) => p.test(contentForCheck.trim()));
      if (matchedPattern) {
        throw new Error(formatValidationError(
          `${expectedType}[${index}].self_test.ood_threshold`,
          `declared true (out-of-distribution) but content matches common-knowledge pattern: "${contentForCheck.match(matchedPattern)?.[0] ?? ""}"`,
          "self_test.ood_threshold=true 表示这是超出训练分布的非常识洞察，但 content 是常识性陈述。要么补充因果推理/非显然联系使其成为真正的洞察，要么降级为 governance_evidence_candidate。",
          `BAD: content="Fastify is a web framework" + ood_threshold=true\nGOOD: content="Zod catchall schemas silently strip undeclared nested fields during JSON-RPC serialization, causing invisible data loss" + ood_threshold=true`
        ));
      }
    }

    // reusable=true → content 不应绑定具体一次事件
    const reusable = selfTest.reusable;
    if (reusable === true) {
      const matchedPattern = SPECIFIC_EVENT_PATTERNS.find((p) => p.test(contentForCheck));
      if (matchedPattern) {
        throw new Error(formatValidationError(
          `${expectedType}[${index}].self_test.reusable`,
          `declared true but content binds to a specific event: "${contentForCheck.match(matchedPattern)?.[0] ?? ""}"`,
          "self_test.reusable=true 表示这条知识可跨场景复用，但 content 绑定了具体一次事件（今天/昨天/日期/本次）。要么抽象掉具体事件描述，要么降级为 memory_candidate（绑定具体经历的生存指南）。",
          `BAD: content="2026-07-10 我们发现了连接池泄漏" + reusable=true\nGOOD: content="PostgreSQL idle_in_connection_session_timeout 过短会导致连接池耗尽" + reusable=true`
        ));
      }
    }
  }

  if (expectedType === "rule_candidate" || expectedType === "skill_proposal_candidate") {
    // survives_without_project_nouns=true (rule) / executable_with_generic_terms=true (skill)
    // → content 不应含项目专有名词
    const survives = expectedType === "rule_candidate"
      ? selfTest.survives_without_project_nouns
      : selfTest.executable_with_generic_terms;
    if (survives === true) {
      const matchedPattern = PROJECT_NOUN_PATTERNS.find((p) => p.test(contentText));
      if (matchedPattern) {
        const nounName = expectedType === "rule_candidate" ? "survives_without_project_nouns" : "executable_with_generic_terms";
        throw new Error(formatValidationError(
          `${expectedType}[${index}].self_test.${nounName}`,
          `declared true but content contains project-specific noun: "${contentText.match(matchedPattern)?.[0] ?? ""}"`,
          `self_test.${nounName}=true 表示规则/技能不依赖项目专有名词即可执行，但 content 含项目专名（agi-memory/memory-service/trae 等）。要么改写为通用表述，要么把 self_test 改为 false。`,
          `BAD: content="IF 在 agi-memory 项目中定义 MCP schema THEN..." + ${nounName}=true\nGOOD: content="IF 定义 MCP tool schema THEN 必须显式声明所有字段" + ${nounName}=true`
        ));
      }
    }
  }
}

// ─── P1-4: source_refs excerpt 真实性校验 ───

// 从 batch.raw_inputs 提取原始 session 文本，用于校验 source_excerpt 是否真实。
// 拼接 user_messages + commentary_messages 的 text 字段（这是 source_excerpt 的来源池）。
function extractRawSessionText(rawInputs: GovernanceBatchPreviewResponse["raw_inputs"]): string {
  if (!rawInputs) return "";
  const parts: string[] = [];
  for (const msg of rawInputs.user_messages ?? []) {
    if (msg?.text) parts.push(msg.text);
  }
  for (const msg of rawInputs.commentary_messages ?? []) {
    if (msg?.text) parts.push(msg.text);
  }
  // commands/tool_calls/mcp_calls 的 summary 也加入（source_excerpt 可能引用这些）
  for (const cmd of rawInputs.commands ?? []) {
    if (cmd?.command) parts.push(cmd.command.join(" "));
    if (cmd?.stdout_excerpt) parts.push(cmd.stdout_excerpt);
    if (cmd?.stderr_excerpt) parts.push(cmd.stderr_excerpt);
  }
  for (const tc of rawInputs.tool_calls ?? []) {
    if (tc?.arguments_summary) parts.push(tc.arguments_summary);
    if (tc?.result_summary) parts.push(tc.result_summary);
  }
  for (const mc of rawInputs.mcp_calls ?? []) {
    if (mc?.arguments_summary) parts.push(mc.arguments_summary);
    if (mc?.result_summary) parts.push(mc.result_summary);
  }
  return parts.join("\n");
}

// 校验 source_refs 中的 source_excerpt 是否真的出现在原始 session 文本里。
// 模型可能对 excerpt 做轻微改写（截断、加省略号），所以先尝试精确子串匹配，
// 失败后用前 50 字符做模糊匹配（容忍尾部截断）。
// 同一条候选的 source_refs 中"来源可疑"比例 > 30% → REJECT 该候选。
function verifySourceExcerpt(
  expectedType: GovernanceCandidatePreview["candidate_type"],
  candidate: GovernanceCandidatePreview,
  index: number,
  rawSessionText: string
): void {
  // rawSessionText 为空时跳过（非 session 来源的候选，如 runGovernanceFromExtraction 路径）
  if (!rawSessionText || rawSessionText.trim().length === 0) return;

  const sourceRefs = candidate.source_refs;
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) return;

  // normalize：去多余空白、转小写
  const normalizedRaw = rawSessionText.replace(/\s+/g, " ").toLowerCase();

  let suspiciousCount = 0;
  const suspiciousDetails: string[] = [];

  for (let i = 0; i < sourceRefs.length; i++) {
    const ref = sourceRefs[i];
    if (!ref || typeof ref !== "object") continue;
    const excerpt = String((ref as Record<string, unknown>).source_excerpt ?? "").trim();
    if (!excerpt) continue;

    const normalizedExcerpt = excerpt.replace(/\s+/g, " ").toLowerCase();

    // 精确子串匹配
    if (normalizedRaw.includes(normalizedExcerpt)) continue;

    // 模糊匹配：检查 excerpt 的前 50 字符是否在 raw 中出现
    // （模型可能截断尾部或加省略号）
    const excerptPrefix = normalizedExcerpt.slice(0, 50);
    if (excerptPrefix.length >= 10 && normalizedRaw.includes(excerptPrefix)) continue;

    // 模糊匹配：检查 excerpt 的后 50 字符
    const excerptSuffix = normalizedExcerpt.slice(-50);
    if (excerptSuffix.length >= 10 && normalizedRaw.includes(excerptSuffix)) continue;

    // 都不匹配 → 标记为来源可疑
    suspiciousCount++;
    suspiciousDetails.push(`source_refs[${i}]: "${excerpt.slice(0, 60)}..."`);
  }

  if (suspiciousCount === 0) return;

  const suspiciousRate = suspiciousCount / sourceRefs.length;
  if (suspiciousRate > 0.3) {
    throw new Error(formatValidationError(
      `${expectedType}[${index}].source_refs`,
      `${suspiciousCount}/${sourceRefs.length} source_excerpts not found in raw session text (suspicious rate: ${(suspiciousRate * 100).toFixed(0)}%). Details: ${suspiciousDetails.slice(0, 3).join("; ")}`,
      "source_excerpt 必须是原始 session 文本的真实子串（允许轻微截断/省略号），不能编造。从 raw_inputs.user_messages / commentary_messages 中逐字摘录。",
      `BAD: source_excerpt="用户说要用 PostgreSQL 连接池"（编造，原始对话中没有这句话）\nGOOD: source_excerpt 逐字复制自原始 user_message`
    ));
  }

  // 可疑比例 ≤ 30%：在 reason 字段追加警告标记
  const originalReason = candidate.reason ?? "";
  if (!originalReason.includes("[⚠️ 来源可疑]")) {
    candidate.reason = `${originalReason} [⚠️ 来源可疑：${suspiciousCount}/${sourceRefs.length} source_excerpt 未在原始 session 中找到，走人工审批]`;
    if (candidate.promotion_status !== "needs_review") {
      candidate.promotion_status = "needs_review";
    }
  }
}

// §Fix-3: candidate_type → layer 映射，用于校验 classification_trace.decision_layer
function candidateTypeToLayer(candidateType: string): string {
  const mapping: Record<string, string> = {
    rule_candidate: "rule",
    memory_candidate: "memory",
    skill_proposal_candidate: "skill",
    knowledge_candidate: "knowledge",
    governance_evidence_candidate: "evidence",
  };
  return mapping[candidateType] ?? "evidence";
}

// §SelfTest 硬门控辅助函数：读取并验证 self_test 结构化字段
// expectedFields 按层不同：
//   rule: ["survives_without_project_nouns", "host_layer_gate"] (boolean)
//   memory: ["one_month_value", "about_user_not_code", "time_diluted"] (boolean|enum)
//   knowledge: ["ood_threshold", "reusable", "learning_chain_anchored"] (boolean)
//   skill: ["executable_with_generic_terms", "proven_multi_step"] (boolean)
function readSelfTest(
  item: Record<string, unknown>,
  candidateType: string,
  index: number,
  expectedFields: string[]
): Record<string, unknown> {
  const raw = item.self_test;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    const exampleFields = expectedFields.map((f) => {
      if (f === "time_diluted") return `"${f}": "stable"`;
      return `"${f}": true`;
    }).join(", ");
    throw new Error(formatValidationError(
      `${candidateType}[${index}].self_test`,
      "must be an object with structured self-test answers. LLM 必须显式回答自测问题，不能跳过",
      `Provide a self_test object with these fields: ${expectedFields.join(", ")}`,
      `"self_test": { ${exampleFields} }`
    ));
  }
  const obj = raw as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const field of expectedFields) {
    const value = obj[field];
    if (field === "time_diluted") {
      if (value !== "temporary" && value !== "stable") {
        throw new Error(formatValidationError(
          `${candidateType}[${index}].self_test.${field}`,
          `must be "temporary" or "stable" but got ${value === undefined ? "undefined" : JSON.stringify(value)}`,
          "判断这条 Memory 是否会被时间稀释。临时性信息选 temporary，持久性用户特征选 stable",
          `"self_test": { "${field}": "stable" }`
        ));
      }
      result[field] = value;
    } else {
      if (typeof value !== "boolean") {
        throw new Error(formatValidationError(
          `${candidateType}[${index}].self_test.${field}`,
          `must be a boolean (true/false) but got ${value === undefined ? "undefined" : typeof value}`,
          `LLM 必须显式回答这个自测问题为 true 或 false。如果是 false，不要提交该候选，降级或丢弃`,
          `"self_test": { "${field}": true }`
        ));
      }
      result[field] = value;
    }
  }
  return result;
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
    // P0.5: project-internal / machine-specific / user-preference checks are enforced
    // centrally by auditCrossLayerBoundaries (spec 39 §9) so that the backstop is single-sourced.
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

function containsChinese(value: string): boolean {
  return /[\u4e00-\u9fa5]/.test(value);
}

function looksLikeProcedure(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.toLowerCase();
  // P1c 原则升级：只拦截"过程性词"（步骤/流程/序号序列/操作手册），
  // 不再拦截"结果性词"（修复了X、解决了Y、调整了Z）—— 这些是合法的 Memory 摘要。
  // 历史 bug：曾把 "修复" 当过程性词，导致大量合法的"修复了X"Memory 被误拦为 Skill。
  const procedureSignals = [
    "步骤",
    "流程",
    "playbook",
    "runbook",
    "操作手册",
    "执行步骤",
    /\bstep\s*\d/i,
    /\bstep\s+by\s+step/i,
    /\bworkflow\b/i,
    // 序列连接词必须组合出现才算过程性："先...然后...最后"
    /先[^，。；\n]{1,40}然后[^，。；\n]{1,40}最后/,
    // "1. xxx 2. xxx 3. xxx" 显式编号列表
    /\d+\.\s+[\u4e00-\u9fa5a-z]{2,}[\s\S]{0,80}\d+\.\s+[\u4e00-\u9fa5a-z]{2,}/i,
  ];
  return procedureSignals.some((signal) => {
    if (signal instanceof RegExp) return signal.test(normalized);
    return normalized.includes(signal);
  });
}
