import type { CodexCapturePreviewResponse, HostCaptureName } from "./codexHostCapture.js";

type GovernanceSourceKind = "user_message" | "assistant_message" | "commentary" | "command" | "tool" | "mcp";

// P0-d: layer-aware single source of truth for origin_scope, availability_scope and governance_level.
// Derived directly from spec 39 §5.4 (rule), §6.4 (skill), §7.5 (knowledge),
// §8.5 (memory) and §9 (evidence). No layer may use values outside its spec set.
export const GOVERNANCE_SCOPE_BY_LAYER = {
  rule_candidate: {
    origin_scope: new Set(["session", "project", "workspace", "user", "team", "global"] as const),
    availability_scope: new Set(["session_only", "project_reusable", "workspace_reusable", "user_reusable", "team_reusable", "global_reusable"] as const),
    governance_level: new Set(["session", "shared"] as const)
  },
  memory_candidate: {
    origin_scope: new Set(["session", "project", "workspace", "user", "team", "global"] as const),
    availability_scope: new Set(["session_only", "project_reusable", "workspace_reusable", "user_reusable", "team_reusable", "global_reusable"] as const),
    governance_level: new Set(["session", "shared"] as const)
  },
  skill_proposal_candidate: {
    origin_scope: new Set(["session", "project", "workspace", "user", "team", "global"] as const),
    availability_scope: new Set(["session_only", "project_reusable", "workspace_reusable", "user_reusable", "team_reusable", "global_reusable"] as const),
    governance_level: new Set(["session", "shared"] as const)
  },
  knowledge_candidate: {
    origin_scope: new Set(["project", "team", "global"] as const),
    availability_scope: new Set(["project_reusable", "team_reusable", "global_reusable"] as const),
    governance_level: new Set(["shared"] as const)
  },
  governance_evidence_candidate: {
    origin_scope: new Set(["session", "project"] as const),
    availability_scope: new Set(["session_only", "project_reusable"] as const),
    governance_level: new Set(["session"] as const)
  }
} as const;

// P0-b: spec 39 §7.5 knowledge_type enumeration. Single source of truth for
// synthesis types used by host_model validation, fallback normalization and DB writes.
export const VALID_KNOWLEDGE_TYPES = new Set([
  "external_fact",
  "method",
  "pattern",
  "principle",
  "comparison",
  "limitation",
  "trend",
  "synthesis",
  "counterexample"
] as const);

export type GovernanceKnowledgeType = typeof VALID_KNOWLEDGE_TYPES extends Set<infer T> ? T : never;

type RuleOriginScope = typeof GOVERNANCE_SCOPE_BY_LAYER.rule_candidate.origin_scope extends Set<infer T> ? T : never;
type MemoryOriginScope = typeof GOVERNANCE_SCOPE_BY_LAYER.memory_candidate.origin_scope extends Set<infer T> ? T : never;
type SkillProposalOriginScope = typeof GOVERNANCE_SCOPE_BY_LAYER.skill_proposal_candidate.origin_scope extends Set<infer T> ? T : never;
type KnowledgeOriginScope = typeof GOVERNANCE_SCOPE_BY_LAYER.knowledge_candidate.origin_scope extends Set<infer T> ? T : never;
type GovernanceEvidenceOriginScope = typeof GOVERNANCE_SCOPE_BY_LAYER.governance_evidence_candidate.origin_scope extends Set<infer T> ? T : never;

export type GovernanceOriginScope =
  | RuleOriginScope
  | MemoryOriginScope
  | SkillProposalOriginScope
  | KnowledgeOriginScope
  | GovernanceEvidenceOriginScope;

type RuleAvailabilityScope = typeof GOVERNANCE_SCOPE_BY_LAYER.rule_candidate.availability_scope extends Set<infer T> ? T : never;
type MemoryAvailabilityScope = typeof GOVERNANCE_SCOPE_BY_LAYER.memory_candidate.availability_scope extends Set<infer T> ? T : never;
type SkillProposalAvailabilityScope = typeof GOVERNANCE_SCOPE_BY_LAYER.skill_proposal_candidate.availability_scope extends Set<infer T> ? T : never;
type KnowledgeAvailabilityScope = typeof GOVERNANCE_SCOPE_BY_LAYER.knowledge_candidate.availability_scope extends Set<infer T> ? T : never;
type GovernanceEvidenceAvailabilityScope = typeof GOVERNANCE_SCOPE_BY_LAYER.governance_evidence_candidate.availability_scope extends Set<infer T> ? T : never;

export type GovernanceAvailabilityScope =
  | RuleAvailabilityScope
  | MemoryAvailabilityScope
  | SkillProposalAvailabilityScope
  | KnowledgeAvailabilityScope
  | GovernanceEvidenceAvailabilityScope;

type GovernancePromotionStatus = "candidate" | "active" | "needs_review" | "rejected";
type GovernanceLevel = "session" | "shared";
type GovernancePhase = "planning" | "design" | "coding" | "testing" | "review" | "governance" | "reporting" | "integration";

export type GovernanceCandidatePreview = {
  candidate_type:
    | "rule_candidate"
    | "memory_candidate"
    | "skill_proposal_candidate"
    | "knowledge_candidate"
    | "governance_evidence_candidate";
  title: string;
  origin_scope: GovernanceOriginScope;
  availability_scope: GovernanceAvailabilityScope;
  governance_level: GovernanceLevel;
  promotion_status: GovernancePromotionStatus;
  rule_domain?: "design" | "execution" | "governance" | "memory" | "skill" | "tooling" | "reporting" | "safety" | "integration";
  rule_scope?: GovernanceOriginScope;
  applies_to_phase?: GovernancePhase[];
  violation_behavior?: "block" | "ask_user" | "warn" | "record";
  memory_type?:
    | "user_memory"
    | "project_memory"
    | "workspace_memory"
    | "team_memory"
    | "session_memory"
    | "design_decision"
    | "integration_context";
  stability?: "temporary" | "stable" | "long_lived";
  ttl?: string | null;
  revalidate_after?: string | null;
  knowledge_type?: GovernanceKnowledgeType;
  governance_action?:
    | "create"
    | "merge_evidence"
    | "update_existing"
    | "replace_existing"
    | "archive_existing"
    | "evidence_only"
    | "discard";
  related_existing_knowledge_ids?: string[];
  relation_proposals?: Array<{
    source: string;
    target: string;
    relation_type: "supports" | "refines" | "contradicts" | "replaces" | "generalizes" | "specializes" | "analogous_to";
    reason: string;
  }>;
  synthesis_reasoning?: string;
  recall_state?: "active" | "audit_only" | "archived";
  evidence_category?:
    | "external_source"
    | "uploaded_knowledge"
    | "execution_step"
    | "verification_evidence"
    | "failure_reason"
    | "success_reason"
    | "tool_execution"
    | "mcp_execution";
  source_kind: GovernanceSourceKind;
  source_timestamp: string;
  content?: string;
  target_skill?: string;
  target_skill_path?: string;
  change_type?: "add" | "update" | "split" | "merge" | "deprecate";
  current_section?: string;
  current_text?: string;
  current_gap?: string;
  proposed_text?: string;
  proposed_patch?: string;
  validation_method?: string;
  rationale?: string;
  proposal_quality?: "actionable" | "needs_review" | "rejected";
  description?: string;
  applicable_scenarios?: string[];
  non_applicable_scenarios?: string[];
  execution_steps?: string[];
  source_refs?: Array<{
    source_kind: GovernanceSourceKind;
    source_timestamp: string;
    source_excerpt: string;
  }>;
  merged_source_count?: number;
  source_excerpt: string;
  reason: string;
  confidence: "high" | "medium" | "low";
  // P1 派生机制：复合信号同时派生多个层候选时，记录跨层派生关系。
  // 这是同一批次内的候选 index（按各 candidate_type 数组的 index），
  // 持久化时由 hostCaptureGovernanceRun 替换为真实 id 写入 layer_links 表。
  derived_from_links?: Array<{
    source_layer: "rule" | "skill" | "knowledge" | "memory";
    source_candidate_index: number;
    target_layer: "rule" | "skill" | "knowledge" | "memory";
    target_candidate_index: number;
    link_type: "derived_from" | "explains" | "constrains" | "provenance";
  }>;
};

export type GovernanceBatchPreviewResponse = {
  host: HostCaptureName;
  thread_id: string;
  thread_name: string | null;
  session_file: string;
  ingestion_readiness: {
    status: "ready" | "partial" | "insufficient";
    warnings: string[];
  };
  raw_inputs: {
    user_messages: Array<{
      timestamp: string;
      text: string;
    }>;
    commentary_messages: Array<{
      timestamp: string;
      text: string;
    }>;
    commands: Array<{
      timestamp: string;
      command: string[];
      cwd: string | null;
      exit_code: number | null;
      stdout_excerpt: string | null;
      stderr_excerpt: string | null;
      status: "success" | "failure" | "unknown";
    }>;
    tool_calls: Array<{
      timestamp: string;
      tool_name: string;
      arguments_summary: string | null;
      result_summary: string | null;
      error_summary: string | null;
      status: "success" | "failure" | "unknown";
    }>;
    mcp_calls: Array<{
      timestamp: string;
      server: string;
      tool: string;
      arguments_summary: string | null;
      result_summary: string | null;
      error_summary: string | null;
      status: "success" | "failure" | "unknown";
    }>;
  };
  extraction_preview: {
    rule_candidates: GovernanceCandidatePreview[];
    memory_candidates: GovernanceCandidatePreview[];
    skill_proposal_candidates: GovernanceCandidatePreview[];
    knowledge_candidates: GovernanceCandidatePreview[];
    governance_evidence_candidates: GovernanceCandidatePreview[];
    // P1 派生机制：本批次跨层派生关系（按候选数组 index 引用，持久化时替换为真实 id）。
    // 复合信号（如"PowerShell + UTF-8 乱码"）同时派生 Memory（事实根因）+ Rule（门控）时，
    // 必须在此记录 derived_from 关系，禁止二选一。
    layer_links: Array<{
      source_layer: "rule" | "skill" | "knowledge" | "memory";
      source_candidate_index: number;
      target_layer: "rule" | "skill" | "knowledge" | "memory";
      target_candidate_index: number;
      link_type: "derived_from" | "explains" | "constrains" | "provenance";
      confidence: number;
      reason: string;
    }>;
  };
};

const RULE_PATTERNS = [
  "必须",
  "不要",
  "不允许",
  "只能",
  "默认",
  "must",
  "must_not",
  "must not",
  "涓嶈",
  "蹇呴¶",
  "涓嶅厑璁",
  "鍙兘",
  "榛樿"
];

const AGENT_RULE_TARGET_PATTERNS = [
  "你",
  "你要",
  "你先",
  "你需要",
  "你必须",
  "你不要",
  "对你生效",
  "agent",
  "codex",
  "assistant",
  "汇报给我",
  "先汇报",
  "补 interview",
  "重新 interview",
  "不要猜",
  "不要假设",
  "不能假设",
  "先确认",
  "继续前",
  "修改前",
  "写入前",
  "回答前"
];

const PROJECT_DECISION_PATTERNS = [
  "知识层",
  "治理层",
  "记忆层",
  "规则层",
  "skill层",
  "知识库",
  "召回",
  "抽取",
  "分层",
  "项目内",
  "修改项目",
  "项目本身",
  "会话级",
  "整体级",
  "每个会话",
  "所有会话",
  "跨会话",
  "不污染"
];

const SKILL_PATTERNS = [
  "应该",
  "需要",
  "记住",
  "记得",
  "触发",
  "抽取出来的结果",
  "只看数量",
  "效果是否ok",
  "效果是否 ok",
  "展示给我",
  "更新 spec",
  "update spec",
  "interview",
  "根据整个线程",
  "执行记录",
  "由浅入深",
  "由表及里",
  "搴旇",
  "闇€瑕",
  "璁颁綇",
  "璁板緱",
  "瑙﹀彂",
  "鏇存柊 spec",
  "鏍规嵁鏁翠釜绾跨▼",
  "鎵ц璁板綍",
  "鐢辨祬鍏ユ繁",
  "鐢辫〃鍙婇噷"
];

export function buildGovernanceBatchPreview(preview: CodexCapturePreviewResponse): GovernanceBatchPreviewResponse {
  const ruleCandidates: GovernanceCandidatePreview[] = [];
  const memoryCandidates: GovernanceCandidatePreview[] = [];
  const skillProposalCandidates: GovernanceCandidatePreview[] = [];
  const knowledgeCandidates: GovernanceCandidatePreview[] = [];
  const governanceEvidenceCandidates: GovernanceCandidatePreview[] = [];
  // P1 派生机制：layer_links 在 return 前由 buildLayerLinksFromFinalCandidates 计算，
  // 这样 index 指向去重后的最终候选数组，不会被去重/合并打乱。

  for (const message of preview.governance_preview.user_messages) {
    const compact = normalizeForMatch(message.text);
    const excerpt = summarize(compact, 320);
    const memoryTitle = inferMemoryTitle(compact);
    const ruleStatement = distillRuleStatement(compact);
    const isRule = Boolean(ruleStatement);
    const projectDecision = distillProjectDecisionMemory(compact);
    const isProjectDecision = Boolean(projectDecision);
    const hasStableMemoryHint = looksLikeStableFactualMemory(compact);
    const isSkillProposal = hasAny(compact, SKILL_PATTERNS);

    // P1 派生机制：复合信号同时命中 rule + memory 时，两条都派生。
    // 旧逻辑（错的）：分类单选，复合信号必然撕裂。
    // 新逻辑（对的）：派生一对多，用 layer_links 连起来。
    // 派生决策树：
    //   1. 描述"用户/环境是什么样"的持久事实？→ Memory
    //   2. 隐含"动手前必须拦"的约束？→ Rule（可与1并存，建 derived_from）
    //   3. 包含"换项目也能用"的操作流程？→ Skill
    //   4. 出现"模型盲区→检索→学会"的学习链？→ Knowledge(acquired)
    //   5. 跨多条事实归纳的新模式？→ Knowledge(synthesized，L4阶段)
    //   6. 全否，只是流水账 → 丢弃
    // 注：layer_links 的 index 在 return 前根据最终候选数组计算（见 buildLayerLinksFromFinalCandidates），
    // 这里只负责把同源 rule+memory 都 push 进候选数组。
    if (isRule) {
      ruleCandidates.push({
        candidate_type: "rule_candidate",
        title: inferRuleTitle(compact),
        ...inferGovernanceScope("rule_candidate", compact),
        rule_domain: inferRuleDomain(compact),
        rule_scope: inferGovernanceScope("rule_candidate", compact).origin_scope,
        applies_to_phase: inferRulePhases(compact),
        violation_behavior: inferViolationBehavior(compact),
        source_kind: "user_message",
        source_timestamp: message.timestamp,
        content: ruleStatement!,
        source_excerpt: excerpt,
        reason: "User message contains an explicit hard constraint that should directly govern future agent behavior.",
        confidence: "high"
      });
    }

    if (hasStableMemoryHint) {
      memoryCandidates.push({
        candidate_type: "memory_candidate",
        title: memoryTitle,
        ...inferGovernanceScope("memory_candidate", compact),
        memory_type: inferMemoryType(memoryTitle, compact),
        stability: inferMemoryStability(compact),
        source_kind: "user_message",
        source_timestamp: message.timestamp,
        content: distillMemoryContent(memoryTitle, compact),
        source_excerpt: excerpt,
        reason: "User message contains stable machine, workspace, or project context that may belong to long-term factual memory.",
        confidence: "medium"
      });
    }

    const skillChangeProposal = isSkillProposal
      ? buildSkillChangeProposal(compact)
      : null;

    if (skillChangeProposal && (!isRule || isSkillChangeAllowedFromRuleText(compact)) && !isProjectDecision) {
      skillProposalCandidates.push({
        candidate_type: "skill_proposal_candidate",
        title: skillChangeProposal.title,
        ...inferGovernanceScope("skill_proposal_candidate", compact),
        source_kind: "user_message",
        source_timestamp: message.timestamp,
        content: skillChangeProposal.proposed_text,
        target_skill: skillChangeProposal.target_skill,
        target_skill_path: skillChangeProposal.target_skill_path,
        change_type: skillChangeProposal.change_type,
        current_section: skillChangeProposal.current_section,
        current_text: skillChangeProposal.current_text,
        current_gap: skillChangeProposal.current_gap,
        proposed_text: skillChangeProposal.proposed_text,
        proposed_patch: skillChangeProposal.proposed_patch,
        validation_method: skillChangeProposal.validation_method,
        rationale: skillChangeProposal.rationale,
        description: skillChangeProposal.description,
        applicable_scenarios: skillChangeProposal.applicable_scenarios,
        non_applicable_scenarios: skillChangeProposal.non_applicable_scenarios,
        execution_steps: skillChangeProposal.execution_steps,
        proposal_quality: "actionable",
        source_refs: [{ source_kind: "user_message", source_timestamp: message.timestamp, source_excerpt: excerpt }],
        merged_source_count: 1,
        source_excerpt: excerpt,
        reason: "User message implies a concrete skill file change that should be reviewed by a human before editing the skill.",
        confidence: "high"
      });
    }

    if (isProjectDecision) {
      memoryCandidates.push({
        candidate_type: "memory_candidate",
        title: inferProjectDecisionMemoryTitle(compact),
        ...inferGovernanceScope("memory_candidate", compact),
        memory_type: "design_decision",
        stability: "long_lived",
        source_kind: "user_message",
        source_timestamp: message.timestamp,
        content: projectDecision!,
        source_excerpt: excerpt,
        reason: "User message describes a project-internal governance or layering decision that should guide the system as long-term design memory instead of agent rule activation.",
        confidence: "medium"
      });
    }

  }

  for (const message of preview.governance_preview.user_messages) {
    const externalRefs = extractExternalRefs(message.text);
    for (const ref of externalRefs) {
      governanceEvidenceCandidates.push({
        candidate_type: "governance_evidence_candidate",
        title: ref.kind === "url" ? "External source discovered during task" : "User-provided file reference",
        ...inferGovernanceScope("governance_evidence_candidate", ref.value),
        evidence_category: ref.kind === "url" ? "external_source" : "uploaded_knowledge",
        source_kind: "user_message",
        source_timestamp: message.timestamp,
        source_excerpt: summarize(ref.value, 320),
        reason:
          ref.kind === "url"
            ? "User message referenced an external source that governance may need to inspect or keep as task evidence."
            : "User message referenced a local file or artifact that governance may need as non-conversation evidence.",
        confidence: "medium"
      });
    }
  }

  for (const command of preview.governance_preview.commands) {
    const joined = command.command.join(" ");
    governanceEvidenceCandidates.push({
      candidate_type: "governance_evidence_candidate",
      title: inferCommandEvidenceTitle(joined),
      ...inferGovernanceScope("governance_evidence_candidate", joined),
      evidence_category: inferCommandEvidenceCategory(command, joined),
      source_kind: "command",
      source_timestamp: command.timestamp,
      source_excerpt: summarize(buildCommandEvidenceExcerpt(command), 320),
      reason: "Command execution is governance evidence because it records real task steps, verification steps, and failed or chosen paths.",
      confidence: "high"
    });
    const knowledgeCandidate = buildExecutionKnowledgeCandidate({
      text: [command.stdout_excerpt, command.stderr_excerpt].filter(Boolean).join("\n"),
      fallbackTitle: inferExecutionKnowledgeTitle(joined),
      sourceKind: "command",
      sourceTimestamp: command.timestamp,
      sourceExcerpt: summarize(buildCommandKnowledgeExcerpt(command), 520),
      reason: "Command output contains task-execution knowledge that may be reusable beyond this session."
    });
    if (knowledgeCandidate && knowledgeCandidates.length < 12) {
      knowledgeCandidates.push(knowledgeCandidate);
    }
  }

  for (const toolCall of preview.governance_preview.tool_calls) {
    governanceEvidenceCandidates.push({
      candidate_type: "governance_evidence_candidate",
      title: "Tool execution evidence",
      ...inferGovernanceScope("governance_evidence_candidate", toolCall.tool_name),
      evidence_category: "tool_execution",
      source_kind: "tool",
      source_timestamp: toolCall.timestamp,
      source_excerpt: summarize(
        `${toolCall.tool_name}${toolCall.arguments_summary ? ` ${toolCall.arguments_summary}` : ""}`,
        320
      ),
      reason: "Tool calls record execution behavior that may matter for governance even when not suitable for long-term memory.",
      confidence: "medium"
    });
    const knowledgeCandidate = buildExecutionKnowledgeCandidate({
      text: toolCall.result_summary ?? "",
      fallbackTitle: inferExecutionKnowledgeTitle(`${toolCall.tool_name} ${toolCall.arguments_summary ?? ""}`),
      sourceKind: "tool",
      sourceTimestamp: toolCall.timestamp,
      sourceExcerpt: summarize(`${toolCall.tool_name}${toolCall.result_summary ? ` ${toolCall.result_summary}` : ""}`, 520),
      reason: "Tool result contains task-execution knowledge that may be reusable beyond this session."
    });
    if (knowledgeCandidate && knowledgeCandidates.length < 12) {
      knowledgeCandidates.push(knowledgeCandidate);
    }
  }

  for (const mcpCall of preview.governance_preview.mcp_calls) {
    governanceEvidenceCandidates.push({
      candidate_type: "governance_evidence_candidate",
      title: "MCP execution evidence",
      ...inferGovernanceScope("governance_evidence_candidate", `${mcpCall.server}/${mcpCall.tool}`),
      evidence_category: "mcp_execution",
      source_kind: "mcp",
      source_timestamp: mcpCall.timestamp,
      source_excerpt: `${mcpCall.server}/${mcpCall.tool}`,
      reason: "MCP calls are part of task execution evidence and should be available during governance review.",
      confidence: "medium"
    });
  }

  const warnings = [...preview.governance_preview.readiness.warnings];
  const status =
    preview.governance_preview.readiness.quality === "high"
      ? "ready"
      : preview.governance_preview.readiness.quality === "medium"
        ? "partial"
        : "insufficient";

  if (ruleCandidates.length === 0 && memoryCandidates.length === 0 && skillProposalCandidates.length === 0 && knowledgeCandidates.length === 0) {
    warnings.push("No governance candidates were inferred from the selected Codex session.");
  }

  return {
    host: preview.host,
    thread_id: preview.thread_id,
    thread_name: preview.thread_name,
    session_file: preview.session_file,
    ingestion_readiness: {
      status,
      warnings
    },
    raw_inputs: {
      user_messages: preview.governance_preview.user_messages.map((item) => ({
        timestamp: item.timestamp,
        text: item.text
      })),
      commentary_messages: preview.governance_preview.corrections
        .concat(preview.governance_preview.preferences)
        .map((item) => ({
          timestamp: item.timestamp,
          text: item.text
        })),
      commands: preview.governance_preview.commands,
      tool_calls: preview.governance_preview.tool_calls,
      mcp_calls: preview.governance_preview.mcp_calls
    },
    extraction_preview: (() => {
      // P1 派生机制：先去重/合并得到最终候选数组，再根据最终 index 计算 layer_links。
      // 这样 layer_links 的 index 永远指向返回数组的真实位置，不会被去重打乱。
      const finalRuleCandidates = consolidateCandidates(dedupeBySource(ruleCandidates));
      const finalMemoryCandidates = dedupeMemoryCandidates(dedupeBySource(memoryCandidates));
      const finalSkillProposalCandidates = consolidateSkillProposals(dedupeBySource(skillProposalCandidates));
      const finalKnowledgeCandidates = dedupeKnowledgeCandidates(consolidateCandidates(dedupeBySource(knowledgeCandidates)));
      const finalGovernanceEvidenceCandidates = dedupeBySource(governanceEvidenceCandidates);
      const finalLayerLinks = buildLayerLinksFromFinalCandidates({
        ruleCandidates: finalRuleCandidates,
        memoryCandidates: finalMemoryCandidates
      });
      return {
        rule_candidates: finalRuleCandidates,
        memory_candidates: finalMemoryCandidates,
        skill_proposal_candidates: finalSkillProposalCandidates,
        knowledge_candidates: finalKnowledgeCandidates,
        governance_evidence_candidates: finalGovernanceEvidenceCandidates,
        layer_links: finalLayerLinks
      };
    })()
  };
}

// P1 派生机制：根据最终候选数组计算跨层派生关系。
// 复合信号（同 source_timestamp 的 rule + memory）→ Rule derived_from Memory。
// Rule 是从 Memory 事实根因推导出的门控逻辑——Memory 提供"为什么"，Rule 提供"拦什么"。
// 两者防的是不同失败模式：只有 Memory 模型会"忘"，只有 Rule 模型不懂"为什么"。
function buildLayerLinksFromFinalCandidates(input: {
  ruleCandidates: GovernanceCandidatePreview[];
  memoryCandidates: GovernanceCandidatePreview[];
}): GovernanceBatchPreviewResponse["extraction_preview"]["layer_links"] {
  const links: GovernanceBatchPreviewResponse["extraction_preview"]["layer_links"] = [];
  // 按 source_timestamp 配对同源的 rule + memory。
  // 同一条用户消息同时触发 isRule + hasStableMemoryHint 时，会派生出一对 derived_from 关系。
  for (let ruleIdx = 0; ruleIdx < input.ruleCandidates.length; ruleIdx++) {
    const rule = input.ruleCandidates[ruleIdx];
    for (let memIdx = 0; memIdx < input.memoryCandidates.length; memIdx++) {
      const mem = input.memoryCandidates[memIdx];
      // 同源判定：source_timestamp 相同（来自同一条用户消息）
      if (rule.source_timestamp === mem.source_timestamp) {
        links.push({
          source_layer: "rule",
          source_candidate_index: ruleIdx,
          target_layer: "memory",
          target_candidate_index: memIdx,
          link_type: "derived_from",
          confidence: 0.9,
          reason: "复合信号：Rule（硬门控）由同源 Memory（事实根因）派生，防不同失败模式"
        });
      }
    }
  }
  return links;
}

function consolidateCandidates(items: GovernanceCandidatePreview[]): GovernanceCandidatePreview[] {
  const byContent = new Map<string, GovernanceCandidatePreview>();
  for (const item of items) {
    const key = `${item.candidate_type}:${item.title}:${normalizeWhitespace(item.content ?? item.source_excerpt).toLowerCase()}`;
    const existing = byContent.get(key);
    if (!existing) {
      byContent.set(key, {
        ...item,
        source_refs: item.source_refs ?? [
          {
            source_kind: item.source_kind,
            source_timestamp: item.source_timestamp,
            source_excerpt: item.source_excerpt
          }
        ],
        merged_source_count: item.merged_source_count ?? 1
      });
      continue;
    }
    existing.source_refs = mergeSourceRefs(existing.source_refs, [
      {
        source_kind: item.source_kind,
        source_timestamp: item.source_timestamp,
        source_excerpt: item.source_excerpt
      }
    ]);
    existing.merged_source_count = existing.source_refs.length;
  }
  return [...byContent.values()];
}

function consolidateSkillProposals(items: GovernanceCandidatePreview[]): GovernanceCandidatePreview[] {
  const byTarget = new Map<string, GovernanceCandidatePreview>();
  for (const item of items) {
    if (!item.target_skill || !item.proposed_text) {
      continue;
    }
    const key = `${item.target_skill}:${item.change_type ?? "update"}:${item.current_section ?? item.title}`;
    const existing = byTarget.get(key);
    if (!existing) {
      byTarget.set(key, {
        ...item,
        proposal_quality: item.proposal_quality ?? "actionable",
        source_refs: item.source_refs ?? [
          {
            source_kind: item.source_kind,
            source_timestamp: item.source_timestamp,
            source_excerpt: item.source_excerpt
          }
        ],
        merged_source_count: item.merged_source_count ?? 1
      });
      continue;
    }
    existing.source_refs = mergeSourceRefs(existing.source_refs, item.source_refs ?? [
      {
        source_kind: item.source_kind,
        source_timestamp: item.source_timestamp,
        source_excerpt: item.source_excerpt
      }
    ]);
    existing.merged_source_count = existing.source_refs.length;
    existing.source_excerpt = existing.source_refs.map((source) => source.source_excerpt).join("\n---\n");
    existing.reason = "Multiple host-capture signals were consolidated into one concrete skill change proposal.";
  }
  return [...byTarget.values()];
}

function mergeSourceRefs(
  left: GovernanceCandidatePreview["source_refs"] = [],
  right: GovernanceCandidatePreview["source_refs"] = []
): NonNullable<GovernanceCandidatePreview["source_refs"]> {
  const merged = new Map<string, NonNullable<GovernanceCandidatePreview["source_refs"]>[number]>();
  for (const item of [...left, ...right]) {
    merged.set(`${item.source_kind}:${item.source_timestamp}:${item.source_excerpt}`, item);
  }
  return [...merged.values()];
}

function dedupeMemoryCandidates(items: GovernanceCandidatePreview[]): GovernanceCandidatePreview[] {
  const result: GovernanceCandidatePreview[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const normalizedTitle = item.title.toLowerCase();
    const contentText = item.content ?? item.source_excerpt;
    const normalizedPath = extractWindowsPath(contentText)?.toLowerCase() ?? "";
    const pathKey =
      normalizedPath && isWorkspacePathTitle(normalizedTitle) ? `workspace:${normalizedPath}` : null;
    const normalizedContent = normalizeWhitespace(contentText).toLowerCase();
    const key = pathKey ?? `memory-content:${normalizedContent}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(pathKey ? { ...item, title: "工作空间路径上下文", content: normalizedPath || item.content } : item);
  }

  return result;
}

function dedupeKnowledgeCandidates(items: GovernanceCandidatePreview[]): GovernanceCandidatePreview[] {
  const result: GovernanceCandidatePreview[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const normalized = normalizeWhitespace(item.content ?? item.source_excerpt).toLowerCase();
    const key = inferKnowledgeSemanticKey(normalized) ?? normalized.slice(0, 180);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function dedupeBySource(items: GovernanceCandidatePreview[]): GovernanceCandidatePreview[] {
  const seen = new Set<string>();
  const result: GovernanceCandidatePreview[] = [];
  for (const item of items) {
    const key =
      item.candidate_type === "memory_candidate"
        ? `${item.candidate_type}:${item.title}:${item.content ?? item.source_excerpt}`
        : `${item.candidate_type}:${item.source_kind}:${item.source_timestamp}:${item.title}:${item.content ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function extractWindowsPath(text: string): string | null {
  const match = text.match(/[A-Za-z]:\\[A-Za-z0-9_. ()\-\[\]]+(?:\\[A-Za-z0-9_. ()\-\[\]]+)*/);
  return match?.[0]?.trim() ?? null;
}

function isWorkspacePathTitle(title: string): boolean {
  return title.includes("工作空间路径") || title.includes("项目路径") || title.includes("工作空间上下文");
}

function normalizeWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function inferGovernanceScope(
  candidateType: GovernanceCandidatePreview["candidate_type"],
  text: string
): {
  origin_scope: GovernanceOriginScope;
  availability_scope: GovernanceAvailabilityScope;
  governance_level: GovernanceLevel;
  promotion_status: GovernancePromotionStatus;
} {
  if (candidateType === "governance_evidence_candidate") {
    return {
      origin_scope: "session",
      availability_scope: "session_only",
      governance_level: "session",
      promotion_status: "candidate"
    };
  }

  const normalized = text.toLowerCase();
  if (
    candidateType === "memory_candidate" &&
    (normalized.includes("skill proposal") || normalized.includes("skill proposal必须") || normalized.includes("skill proposal 必须")) &&
    (normalized.includes("具体") || normalized.includes("目标 skill") || normalized.includes("当前缺口") || normalized.includes("拟议修改") || normalized.includes("审批状态"))
  ) {
    return {
      origin_scope: "project",
      availability_scope: "project_reusable",
      governance_level: "shared",
      promotion_status: "active"
    };
  }

  if (normalized.includes("d:\\workspace") || normalized.includes("workspace") || normalized.includes("本机")) {
    return {
      origin_scope: "workspace",
      availability_scope: "workspace_reusable",
      governance_level: "shared",
      promotion_status: "active"
    };
  }

  if (
    normalized.includes("会话级") ||
    normalized.includes("整体级") ||
    normalized.includes("每个会话") ||
    normalized.includes("所有会话") ||
    normalized.includes("跨会话") ||
    normalized.includes("不污染") ||
    normalized.includes("项目") ||
    normalized.includes("superagentsystem") ||
    normalized.includes("知识库") ||
    normalized.includes("治理层") ||
    normalized.includes("记忆层")
  ) {
    return {
      origin_scope: "project",
      availability_scope: "project_reusable",
      governance_level: "shared",
      promotion_status: candidateType === "skill_proposal_candidate" ? "needs_review" : "active"
    };
  }

  if (candidateType === "rule_candidate" || candidateType === "skill_proposal_candidate") {
    return {
      origin_scope: "user",
      availability_scope: "user_reusable",
      governance_level: "shared",
      promotion_status: candidateType === "skill_proposal_candidate" ? "needs_review" : "active"
    };
  }

  // P0-d: layer-aware default origin_scope; knowledge cannot default to session.
  if (candidateType === "knowledge_candidate") {
    return {
      origin_scope: "project",
      availability_scope: "project_reusable",
      governance_level: "shared",
      promotion_status: "candidate"
    };
  }

  return {
    origin_scope: "session",
    availability_scope: "session_only",
    governance_level: "session",
    promotion_status: "candidate"
  };
}

function inferRuleDomain(
  text: string
): NonNullable<GovernanceCandidatePreview["rule_domain"]> {
  const normalized = text.toLowerCase();
  if (
    normalized.includes("完整验证") ||
    normalized.includes("真实调用验证") ||
    normalized.includes("smoke") ||
    (normalized.includes("mcp") && (normalized.includes("接入") || normalized.includes("验证") || normalized.includes("doctor")))
  ) {
    return "integration";
  }
  if (normalized.includes("mcp") || normalized.includes("工具") || normalized.includes("rg")) {
    return "tooling";
  }
  if (normalized.includes("设计") || normalized.includes("spec") || normalized.includes("interview")) {
    return "design";
  }
  if (normalized.includes("治理") || normalized.includes("抽取") || normalized.includes("分层")) {
    return "governance";
  }
  if (normalized.includes("汇报") || normalized.includes("数量") || normalized.includes("结果")) {
    return "reporting";
  }
  if (normalized.includes("memory") || normalized.includes("记忆")) {
    return "memory";
  }
  if (normalized.includes("skill")) {
    return "skill";
  }
  if (normalized.includes("接入") || normalized.includes("插件") || normalized.includes("host")) {
    return "integration";
  }
  if (normalized.includes("权限") || normalized.includes("安全")) {
    return "safety";
  }
  return "execution";
}

function inferRulePhases(text: string): NonNullable<GovernanceCandidatePreview["applies_to_phase"]> {
  const normalized = text.toLowerCase();
  if (normalized.includes("治理") || normalized.includes("抽取") || normalized.includes("分层")) {
    return ["governance", "reporting"];
  }
  if (normalized.includes("设计") || normalized.includes("spec") || normalized.includes("interview")) {
    return ["planning", "design"];
  }
  if (normalized.includes("测试") || normalized.includes("验证") || normalized.includes("doctor") || normalized.includes("smoke")) {
    return ["testing", "integration"];
  }
  if (normalized.includes("编码") || normalized.includes("实现") || normalized.includes("修改")) {
    return ["coding", "review"];
  }
  return ["planning", "coding", "testing"];
}

function inferViolationBehavior(text: string): NonNullable<GovernanceCandidatePreview["violation_behavior"]> {
  const normalized = text.toLowerCase();
  if (normalized.includes("不允许") || normalized.includes("不能") || normalized.includes("不得") || normalized.includes("must_not") || normalized.includes("must not")) {
    return "block";
  }
  if (normalized.includes("先确认") || normalized.includes("interview") || normalized.includes("用户确认")) {
    return "ask_user";
  }
  if (normalized.includes("汇报") || normalized.includes("展示")) {
    return "record";
  }
  return "warn";
}

function inferMemoryType(title: string, text: string): NonNullable<GovernanceCandidatePreview["memory_type"]> {
  const normalized = `${title} ${text}`.toLowerCase();
  if (normalized.includes("d:\\workspace") || normalized.includes("workspace") || normalized.includes("本机") || normalized.includes("这台机器")) {
    return "workspace_memory";
  }
  if (normalized.includes("团队") || normalized.includes("team")) {
    return "team_memory";
  }
  if (normalized.includes("用户") || normalized.includes("我希望") || normalized.includes("我觉得")) {
    return "user_memory";
  }
  if (normalized.includes("设计") || normalized.includes("决策") || normalized.includes("路线")) {
    return "design_decision";
  }
  if (normalized.includes("接入") || normalized.includes("mcp") || normalized.includes("host")) {
    return "integration_context";
  }
  if (normalized.includes("项目") || normalized.includes("superagentsystem") || normalized.includes("治理层") || normalized.includes("知识库")) {
    return "project_memory";
  }
  return "session_memory";
}

function inferMemoryStability(text: string): NonNullable<GovernanceCandidatePreview["stability"]> {
  const normalized = text.toLowerCase();
  if (normalized.includes("长期") || normalized.includes("以后") || normalized.includes("默认") || normalized.includes("每次") || normalized.includes("跨会话")) {
    return "long_lived";
  }
  if (normalized.includes("当前") || normalized.includes("这次") || normalized.includes("本轮")) {
    return "temporary";
  }
  return "stable";
}

function distillRuleStatement(text: string): string | null {
  if (text.includes("抽取出来的结果") || text.includes("不能只给用户数量") || text.includes("只看数量")) {
    return "每次治理完成后，必须向用户展示具体抽取结果，不能只汇报数量。";
  }
  if (text.includes("smoke") || text.includes("完整验证") || text.includes("真实调用验证")) {
    return "执行接入验证时，必须走真实完整验证链路，不能只做最小 smoke。";
  }
  if (text.includes("先确认") || text.includes("interview")) {
    return "当设计边界或需求覆盖不足时，必须先补访谈和确认，再继续执行。";
  }
  if (text.includes("不要猜") || text.includes("不能假设")) {
    return "遇到关键决策缺口时，不得靠猜测补空白。";
  }
  return null;
}

function distillMemoryContent(title: string, text: string): string {
  if (text.includes("每个电脑自定义") || text.includes("机器自定义") || text.includes("自定义的workspace目录")) {
    return "Workspace 目录是机器自定义配置；迁移、克隆或接入共享项目时，应先确认当前机器的 workspace 目录，不能直接复用其他机器路径。";
  }
  if (title === "Project path context" || title === "Workspace path context" || title === "Workspace context") {
    return extractWindowsPath(text) ?? summarize(text, 120);
  }

  // 通用逻辑：提取 "学到的:" 后的技术内容作为 memory content
  // TRAE 摘要格式："intent\n学到的: learned_content"
  const learnedMatch = text.match(/学到的[:：]\s*([\s\S]+)/);
  if (learnedMatch) {
    return summarize(learnedMatch[1].trim(), 200);
  }

  return summarize(text, 120);
}

function distillProjectDecisionMemory(text: string): string | null {
  if (text.includes("单个会话") || text.includes("会话级") || text.includes("整体级") || text.includes("每个会话") || text.includes("所有会话") || text.includes("不污染")) {
    return "治理产物必须区分会话级和整体级：会话级只属于当前会话，不污染其他会话；整体级可被后续符合范围的会话读取或检索。";
  }
  if ((text.includes("rule") || text.includes("规则")) && (text.includes("分类") || text.includes("像skill一样") || text.includes("方便读取") || text.includes("召回"))) {
    return "Rule 应像 skill 一样带分类元数据，例如 rule_domain、rule_scope、governance_level 和 availability_scope，以便抽取、读取、召回和执行检查。";
  }
  if (text.includes("skill proposal") && (text.includes("target") || text.includes("修改什么skill") || text.includes("原来的是什么"))) {
    return "Skill Proposal 必须是具体 skill 新增、修改、拆分或合并提案，并说明目标 skill、当前缺口、拟议修改、来源证据和审批状态。";
  }
  if (text.includes("memory-v3") && (text.includes("真实调用验证") || text.includes("完整验证") || text.includes("mcp"))) {
    return "Memory MCP 接入验证应优先做真实工具调用和完整链路验证；如果 MCP 工具不可见，应明确提示需要重启或刷新配置。";
  }
  if (text.includes("只做测试")) {
    return "Codex 仅作为宿主记录读取与治理链路的测试接入，不作为正式主接入目标。";
  }
  if (text.includes("统一读取") || text.includes("不重复记录") || text.includes("不重复存")) {
    return "若宿主已保存原始会话与任务执行记录，本系统只统一读取、归一化和治理，不重复记录原始层。";
  }
  if (text.includes("详情页面") || text.includes("跳转到对应的详情页面")) {
    return "治理回显界面应采用线程列表到详情页的结构，不应把所有结果挤在单页中。";
  }
  if (text.includes("只展示") && text.includes("抽取层级")) {
    return "治理回显页面只展示抽取层级和治理结果，不展示废弃或无关的知识库页面。";
  }
  if (text.includes("fetch failed") && text.includes("治理层") && (text.includes("收集") || text.includes("采集"))) {
    return "治理层应从任务执行证据中识别反复出现的工具/MCP/网络失败模式，例如 fetch failed，而不是只依赖用户显式整理。";
  }
  if (text.includes("rg") && (text.includes("报错") || text.includes("不可用") || text.includes("access is denied"))) {
    return "治理层应把重复出现的本机工具异常作为执行证据或环境事实候选，例如 rg.exe Access is denied，而不是忽略失败步骤。";
  }
  return null;
}

function distillSkillProposalContent(text: string): string {
  if (text.includes("抽取出来的结果") || text.includes("不能只给用户数量") || text.includes("只看数量")) {
    return "治理完成后的默认汇报格式应包含具体抽取结果与分层内容，不能只返回计数。";
  }
  if (text.includes("根据整个线程") || text.includes("执行记录")) {
    return "治理输入应默认覆盖完整线程与执行记录，而不是只读取候选记忆对象。";
  }
  if (text.includes("直接去根据文件") || text.includes("不是每次写入网页中")) {
    return "治理回显页面应直接读取真实文件和真实数据源，不维护展示副本。";
  }
  return summarize(text, 140);
}

function buildSkillChangeProposal(text: string): {
  title: string;
  target_skill: string;
  target_skill_path: string;
  change_type: "add" | "update" | "split" | "merge";
  current_section: string;
  current_text: string;
  current_gap: string;
  proposed_text: string;
  proposed_patch: string;
  validation_method: string;
  rationale: string;
  description: string;
  applicable_scenarios: string[];
  non_applicable_scenarios: string[];
  execution_steps: string[];
} | null {
  if (text.includes("抽取出来的结果") || text.includes("不能只给用户数量") || text.includes("只看数量")) {
    const proposedText =
      "新增或更新“治理结果汇报”规则：每次治理完成后，必须按 rule、memory、skill proposal、knowledge、governance evidence 分层展示具体抽取结果、来源依据和判断理由；不能只汇报数量或只说已完成。";
    return {
      title: "治理结果分层汇报技能更新",
      target_skill: "memory-governance-guidelines",
      target_skill_path: "C:\\Users\\Administrator\\.codex\\skills\\memory-governance-guidelines\\SKILL.md",
      change_type: "update",
      current_section: "治理完成后的汇报要求",
      current_text: "当前 skill 只约束治理运行职责，没有明确规定治理完成后必须展示具体抽取产物。",
      current_gap: "治理结果只返回数量时，用户无法审查 rule、memory、skill proposal、knowledge、governance evidence 的抽取质量。",
      proposed_text: proposedText,
      proposed_patch: buildSkillAppendPatch("治理结果汇报", proposedText),
      validation_method: "运行治理后，结果报告必须展示 rule、memory、skill proposal、knowledge、governance evidence 的具体内容和证据，而不是只有计数。",
      rationale: "用户需要直接看到治理产物内容，才能判断治理是否有效、是否污染长期层。",
      description: "在治理运行完成后，按四层架构分层展示具体抽取产物。在治理运行结束或用户要求查看治理结果时调用。",
      applicable_scenarios: ["治理运行完成后自动展示分层结果", "用户询问治理抽取了什么时回溯展示"],
      non_applicable_scenarios: ["治理尚未运行时不应调用", "仅查询历史治理记录时不调用此技能"],
      execution_steps: ["收集本次治理产出的 rule/memory/skill/knowledge/evidence 列表", "按层级分组并提取每条产物的来源依据", "格式化为分层展示报告并返回给用户"]
    };
  }
  if (text.includes("根据整个线程") || text.includes("执行记录")) {
    const proposedText =
      "新增或更新“治理输入范围”规则：治理输入默认包含完整会话记录、任务执行全记录、工具/MCP 调用结果、命令成功失败证据、治理证据层和已有长期层；不能只读取 memory candidate、resident snapshot 或已落库对象。";
    return {
      title: "治理输入范围技能更新",
      target_skill: "memory-governance-guidelines",
      target_skill_path: "C:\\Users\\Administrator\\.codex\\skills\\memory-governance-guidelines\\SKILL.md",
      change_type: "update",
      current_section: "治理输入范围",
      current_text: "当前 skill 只说明显式触发治理时的输入范围，没有明确输入必须覆盖完整线程与任务执行全记录。",
      current_gap: "只治理候选记忆对象会遗漏用户纠偏、工具失败、执行路径、搜索结果和未入库但影响治理判断的证据。",
      proposed_text: proposedText,
      proposed_patch: buildSkillAppendPatch("治理输入范围", proposedText),
      validation_method: "治理预览和治理运行报告必须包含完整线程、执行记录、工具/MCP 输出和已有长期层参与治理的证据。",
      rationale: "治理层需要完整证据才能正确区分 rule、memory、knowledge、skill proposal 和治理证据。",
      description: "在治理运行前，确保输入覆盖完整会话和执行记录。在触发治理或用户要求全量治理时调用。",
      applicable_scenarios: ["触发治理前确认输入范围完整性", "用户反馈治理遗漏上下文时回溯检查"],
      non_applicable_scenarios: ["仅查看单条记忆详情时不调用", "非治理相关的记忆查询不调用"],
      execution_steps: ["收集完整会话线程记录", "收集任务执行全记录含命令和工具输出", "收集已有长期层 rule/memory/knowledge 数据", "合并为治理输入并传入治理引擎"]
    };
  }
  if (text.includes("直接去根据文件") || text.includes("不是每次写入网页中")) {
    const proposedText =
      "新增或更新“治理结果审查”规则：治理回显必须读取真实会话文件、任务执行记录、数据库治理结果和真实产物路径，不维护仅供展示的重复副本。";
    return {
      title: "治理控制台数据源技能更新",
      target_skill: "memory-governance-guidelines",
      target_skill_path: "C:\\Users\\Administrator\\.codex\\skills\\memory-governance-guidelines\\SKILL.md",
      change_type: "update",
      current_section: "治理结果审查",
      current_text: "当前 skill 没有约束治理回显页面的数据来源。",
      current_gap: "如果为了展示另存一份网页副本，治理审查会偏离真实文件和真实数据源。",
      proposed_text: proposedText,
      proposed_patch: buildSkillAppendPatch("治理结果审查", proposedText),
      validation_method: "打开治理回显页面时，详情必须能追溯到真实会话文件、任务执行记录、数据库治理结果和真实产物路径。",
      rationale: "用户要求 Console 用于定位治理质量问题，而不是展示手写副本。",
      description: "在治理控制台展示数据时，直接从数据库和真实文件读取。在打开治理控制台或查看治理详情时调用。",
      applicable_scenarios: ["打开治理控制台页面时", "用户查看治理提议详情时"],
      non_applicable_scenarios: ["离线分析不涉及控制台展示时不调用", "纯 API 调用不涉及页面展示时不调用"],
      execution_steps: ["从 governance_change_proposal 表读取提议数据", "从对应长期层表读取 rule/memory/knowledge 详情", "从会话文件读取原始上下文", "渲染为控制台页面"]
    };
  }
  if (text.toLowerCase().includes("interview") || text.toLowerCase().includes("spec")) {
    const proposedText =
      "更新触发条件：当发现理解偏差、需求边界变化、阶段性确认缺失、SPEC 与用户新表达冲突，或用户指出需要先确认时，必须触发 interview 更新 SPEC 后再继续。";
    return {
      title: "Interview 技能触发条件精化",
      target_skill: "interview",
      target_skill_path: "C:\\Users\\Administrator\\.codex\\skills\\interview\\SKILL.md",
      change_type: "update",
      current_section: "触发条件",
      current_text: "当前 interview skill 可能无法覆盖发现理解偏差、阶段性需要确认或 SPEC 需要更新的场景。",
      current_gap: "当任务中途发现 agent 理解和用户方向不一致时，如果不重新触发 interview，会持续按错误 SPEC 执行。",
      proposed_text: proposedText,
      proposed_patch: buildSkillAppendPatch("触发条件补充", proposedText),
      validation_method: "当用户指出理解偏差或 SPEC 缺口时，后续执行前必须能看到 interview/SPEC 更新动作。",
      rationale: "减少长项目中反复返工，确保 SPEC 持续反映用户真实意图。",
      description: "在任务执行中发现理解偏差或 SPEC 过时时，触发 interview 重新确认需求。在用户指出方向偏差或 SPEC 需要更新时调用。",
      applicable_scenarios: ["用户指出 agent 理解与预期不符时", "SPEC 文档与用户新表达产生冲突时", "任务中途需求边界发生变化时"],
      non_applicable_scenarios: ["用户明确表示继续执行不修改时", "仅做小范围代码修改不涉及需求理解时不调用"],
      execution_steps: ["检测当前执行方向与用户预期是否一致", "如发现偏差，暂停执行并启动 interview 流程", "更新 SPEC 文档记录新确认的需求", "基于更新后的 SPEC 继续执行"]
    };
  }
  return null;
}

function buildSkillAppendPatch(sectionTitle: string, proposedText: string): string {
  return [
    "*** Begin Patch",
    "*** Update File: SKILL.md",
    "@@",
    `+## ${sectionTitle}`,
    "+",
    `+- ${proposedText}`,
    "*** End Patch"
  ].join("\n");
}

function isSkillChangeAllowedFromRuleText(text: string): boolean {
  return (
    text.includes("抽取出来的结果") ||
    text.includes("不能只给用户数量") ||
    text.includes("只看数量") ||
    text.includes("根据整个线程") ||
    text.includes("执行记录") ||
    text.includes("直接去根据文件") ||
    text.includes("不是每次写入网页中") ||
    text.toLowerCase().includes("interview") ||
    text.toLowerCase().includes("spec")
  );
}

function inferRuleTitle(text: string): string {
  if (text.includes("抽取出来的结果") || text.includes("不能只给用户数量") || text.includes("只看数量")) {
    return "治理结果汇报约束";
  }
  if (text.includes("smoke") || text.includes("完整验证") || text.includes("真实调用验证")) {
    return "验证完整性约束";
  }
  if (text.includes("不要") || text.includes("不允许") || text.includes("must_not") || text.includes("must not") || text.includes("涓嶈")) {
    return "用户否定偏好";
  }
  if (text.includes("interview")) {
    return "访谈升级约束";
  }
  if (text.includes("必须") || text.includes("只能") || text.includes("must") || text.includes("蹇呴¶")) {
    return "硬执行约束";
  }
  return "来自用户指令的规则候选";
}

function inferMemoryTitle(text: string): string {
  if (text.includes("项目路径") || text.includes("椤圭洰璺緞")) {
    return "项目路径上下文";
  }
  if (text.toLowerCase().includes("d:\\workspace")) {
    return "工作空间路径上下文";
  }
  if (text.includes("workspace") || text.includes("工作空间") || text.includes("工作区")) {
    return "工作空间上下文";
  }

  // 通用逻辑：根据 "学到的:" 后的技术内容推断标题
  const learnedMatch = text.match(/学到的[:：]\s*([\s\S]+)/);
  if (learnedMatch) {
    const content = learnedMatch[1].trim();
    if (/部署|发布|deploy|publish|netlify|render|github\s+pages/i.test(content)) {
      return "部署配置事实";
    }
    if (/配置|设置|toml|yaml|json|config/i.test(content)) {
      return "项目配置事实";
    }
    if (/目录|路径|path|directory/i.test(content)) {
      return "路径配置事实";
    }
    if (/集成|接入|mcp|api|sdk|工具/i.test(content)) {
      return "集成配置事实";
    }
    return summarize(content.split(/[，。；\n]/)[0], 60);
  }

  return "长期事实上下文候选";
}

function inferProjectDecisionMemoryTitle(text: string): string {
  if (text.includes("memory-v3") || (text.includes("memory") && text.includes("mcp"))) {
    return "Memory MCP 接入决策";
  }
  if (text.includes("只做测试")) {
    return "宿主接入范围决策";
  }
  if (text.includes("统一读取") || text.includes("不重复记录") || text.includes("不重复存")) {
    return "宿主原始记录治理决策";
  }
  if (text.includes("skill proposal")) {
    return "技能提案边界决策";
  }
  if (text.includes("规则层") || text.includes("rule")) {
    return "规则边界决策";
  }
  if (text.includes("知识层") || text.includes("knowledge")) {
    return "知识边界决策";
  }
  if (text.includes("治理层") || text.includes("governance")) {
    return "治理设计决策";
  }
  if (text.includes("记忆层") || text.includes("memory")) {
    return "记忆分层决策";
  }
  return "项目治理决策";
}

function inferSkillTitle(text: string): string {
  if (text.includes("抽取出来的结果") || text.includes("不能只给用户数量") || text.includes("只看数量")) {
    return "治理结果汇报技能优化提案";
  }
  if (text.includes("详情页面") || text.includes("跳转到对应的详情页面")) {
    return "治理控制台详情页技能优化提案";
  }
  if (text.includes("interview")) {
    return "访谈触发条件精化提案";
  }
  if (text.includes("更新 spec") || text.includes("update spec") || text.includes("鏇存柊 spec")) {
    return "SPEC 更新工作流优化提案";
  }
  if (text.includes("根据整个线程") || text.includes("执行记录") || text.includes("鏍规嵁鏁翠釜绾跨▼") || text.includes("鎵ц璁板綍")) {
    return "治理输入范围优化提案";
  }
  if (text.includes("由浅入深") || text.includes("由表及里") || text.includes("鐢辨祬鍏ユ繁") || text.includes("鐢辫〃鍙婇噷")) {
    return "推理原则技能优化提案";
  }
  if (text.includes("触发") || text.includes("瑙﹀彂")) {
    return "触发策略优化提案";
  }
  return "技能优化提案";
}

function hasAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

function looksLikeAgentBehaviorRule(text: string): boolean {
  return Boolean(distillRuleStatement(text));
}

function looksLikeProjectDecisionMemory(text: string): boolean {
  if (text.includes("抽取出来的结果") || text.includes("不能只给用户数量") || text.includes("只看数量")) {
    return false;
  }
  if (isLowValueTransientUtterance(text)) {
    return false;
  }
  return Boolean(distillProjectDecisionMemory(text));
}

function looksLikeStableFactualMemory(text: string): boolean {
  if (isLowValueTransientUtterance(text)) {
    return false;
  }

  // 原有逻辑：Windows 路径相关的事实（保留向后兼容 codex 会话）
  const path = extractWindowsPath(text);
  if (path) {
    if (!(path.toLowerCase().startsWith("c:\\workspace") && !text.includes("改成") && !text.includes("自定义"))) {
      if (
        text.includes("项目路径") ||
        text.includes("workspace 目录") ||
        text.includes("workspace目录") ||
        text.includes("工作目录") ||
        text.includes("默认到") ||
        text.includes("本机") ||
        text.includes("这台机器")
      ) {
        return true;
      }
    }
  }

  // 通用逻辑：识别 TRAE 摘要 "学到的:" 后的技术事实（无路径也能识别）
  return isTechnicalFactualStatement(text);
}

// 通用技术事实识别：用于 TRAE 等宿主的会话摘要
// TRAE session_memory 每行是摘要：{intent, learned, outcome}
// traeCaptureAdapter 把 intent + "学到的: learned" 拼成 user_message
// learned 字段通常含技术配置/部署细节，是稳定事实候选
function isTechnicalFactualStatement(text: string): boolean {
  // 提取 "学到的:" 后的内容；如果没有则用全文
  const learnedMatch = text.match(/学到的[:：]\s*([\s\S]+)/);
  const content = learnedMatch ? learnedMatch[1].trim() : text;

  // 排除太短的（纯意图，如"确认是否可以推送代码"）
  if (content.length < 25) {
    return false;
  }

  // 排除纯统计数字（"10个文件变更，325 insertions / 141 deletions"）
  if (/^[\d\s,，insertionsdeletions个张条/+_-]+$/.test(content)) {
    return false;
  }

  // 技术信号：至少命中 2 个才认为是稳定技术事实
  const techSignals: RegExp[] = [
    /配置/, /目录/, /路径/, /使用/, /采用/, /基于/, /加载/, /触发/, /启用/, /模式/,
    /部署/, /发布/, /编译/, /运行/, /启动/, /注册/, /生成/, /修复/, /集成/, /接入/,
    /更新/, /修改/, /实现/, /迁移/, /回退/, /降级/, /升格/, /拦截/, /校验/,
    /fallback/i, /publish/i, /auto/i, /mock/i, /workflow/i, /deploy/i, /pages/i,
    /\.(toml|yaml|yml|json|html|js|ts|py|md)\b/i,
    /(?:netlify|github|docker|fastapi|node|npm|python|render|powershell|typescript)\b/i,
  ];

  let signalCount = 0;
  for (const signal of techSignals) {
    if (signal.test(content)) {
      signalCount++;
    }
  }

  return signalCount >= 2;
}

function hasGovernanceDecisionVerb(text: string): boolean {
  return (
    text.includes("应该") ||
    text.includes("必须") ||
    text.includes("需要") ||
    text.includes("要") ||
    text.includes("不能") ||
    text.includes("不应该") ||
    text.includes("默认") ||
    text.includes("区分") ||
    text.includes("分类") ||
    text.includes("抽成") ||
    text.includes("作为") ||
    text.includes("读取") ||
    text.includes("检索") ||
    text.includes("污染") ||
    text.includes("升格")
  );
}

function isLowValueTransientUtterance(text: string): boolean {
  const normalized = text.toLowerCase();
  if (normalized.includes("tmd") || normalized.includes("nnd") || normalized.includes("服了")) {
    return true;
  }
  if (normalized.length < 35 && (normalized.includes("去github") || normalized.includes("现在就去") || normalized.includes("继续"))) {
    return true;
  }
  if (normalized.includes("怎么改") && normalized.includes("看看")) {
    return true;
  }
  return false;
}

function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function summarize(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function buildCommandEvidenceExcerpt(command: GovernanceBatchPreviewResponse["raw_inputs"]["commands"][number]): string {
  const joined = command.command.join(" ").trim();
  const cwd = command.cwd ? ` cwd=${command.cwd}` : "";
  const exitCode = command.exit_code === null ? "" : ` exit=${command.exit_code}`;
  return `${joined}${cwd}${exitCode}`.trim();
}

function buildCommandKnowledgeExcerpt(command: GovernanceBatchPreviewResponse["raw_inputs"]["commands"][number]): string {
  const joined = buildCommandEvidenceExcerpt(command);
  const stdout = command.stdout_excerpt ? ` stdout=${command.stdout_excerpt}` : "";
  const stderr = command.stderr_excerpt ? ` stderr=${command.stderr_excerpt}` : "";
  return `${joined}${stdout}${stderr}`.trim();
}

function inferCommandEvidenceTitle(text: string): string {
  const normalized = text.toLowerCase();
  if (normalized.includes("rg ") || normalized.includes("rg.exe") || normalized.includes("ripgrep")) {
    return "Command/tool availability evidence";
  }
  if (normalized.includes("not recognized") || normalized.includes("command not found") || normalized.includes("access is denied")) {
    return "Command/tool failure evidence";
  }
  if (normalized.includes("curl") || normalized.includes("invoke-webrequest") || normalized.includes("search") || normalized.includes("open")) {
    return "Search or fetch step evidence";
  }
  if (
    normalized.includes("verify") ||
    normalized.includes("doctor") ||
    normalized.includes("test") ||
    normalized.includes("build")
  ) {
    return "Verification step evidence";
  }
  if (normalized.includes("git")) {
    return "Repository operation evidence";
  }
  return "Execution step evidence";
}

function inferCommandEvidenceCategory(
  command: GovernanceBatchPreviewResponse["raw_inputs"]["commands"][number],
  text: string
): NonNullable<GovernanceCandidatePreview["evidence_category"]> {
  const normalized = text.toLowerCase();
  if (
    command.exit_code !== null &&
    command.exit_code !== 0 &&
    (normalized.includes("rg ") ||
      normalized.includes("rg.exe") ||
      normalized.includes("ripgrep") ||
      normalized.includes("not recognized") ||
      normalized.includes("command not found") ||
      normalized.includes("access is denied"))
  ) {
    return "failure_reason";
  }
  if (command.exit_code !== null && command.exit_code !== 0) {
    return "failure_reason";
  }
  if (
    normalized.includes("verify") ||
    normalized.includes("doctor") ||
    normalized.includes("test") ||
    normalized.includes("build")
  ) {
    return "verification_evidence";
  }
  if (normalized.includes("curl") || normalized.includes("invoke-webrequest") || normalized.includes("search") || normalized.includes("open")) {
    return "external_source";
  }
  if (command.exit_code === 0) {
    return "success_reason";
  }
  return "execution_step";
}

function extractExternalRefs(text: string): Array<{ kind: "url" | "file"; value: string }> {
  const refs: Array<{ kind: "url" | "file"; value: string }> = [];
  const urlMatches = text.match(/https?:\/\/[^\s<>"')]+/g) ?? [];
  for (const match of urlMatches) {
    refs.push({ kind: "url", value: match });
  }
  const fileMatches = text.match(/[A-Za-z]:\\[^\s<>"']+/g) ?? [];
  for (const match of fileMatches) {
    refs.push({ kind: "file", value: match });
  }
  return refs;
}

function buildExecutionKnowledgeCandidate(input: {
  text: string;
  fallbackTitle: string;
  sourceKind: GovernanceSourceKind;
  sourceTimestamp: string;
  sourceExcerpt: string;
  reason: string;
}): GovernanceCandidatePreview | null {
  const distilled = distillExecutionKnowledge(input.text);
  if (!distilled) {
    return null;
  }
  return {
    candidate_type: "knowledge_candidate",
    title: input.fallbackTitle,
    origin_scope: "project",
    availability_scope: "project_reusable",
    governance_level: "shared",
    promotion_status: "needs_review",
    knowledge_type: "synthesis",
    governance_action: "evidence_only",
    recall_state: "audit_only",
    source_kind: input.sourceKind,
    source_timestamp: input.sourceTimestamp,
    content: distilled,
    source_excerpt: input.sourceExcerpt || summarize(distilled, 520),
    reason: input.reason,
    confidence: "medium"
  };
}

function distillExecutionKnowledge(text: string): string | null {
  const normalized = normalizeWhitespace(stripExecutionOutputEnvelope(text));
  const lower = normalized.toLowerCase();
  if (normalized.length < 120) {
    return null;
  }
  if (isMostlyLocalExecutionNoise(lower)) {
    return null;
  }
  if (!looksLikeExternalOrReusableKnowledge(lower)) {
    return null;
  }
  const canonical = canonicalizeExecutionKnowledge(lower);
  if (canonical) {
    return canonical;
  }
  const readable = extractReadableKnowledgeExcerpt(normalized);
  return readable ? summarize(readable, 1200) : null;
}

function isMostlyLocalExecutionNoise(lower: string): boolean {
  if (
    lower.includes("d:\\workspace\\projects\\superagentsystem-main") ||
    lower.includes("c:\\users\\administrator\\") ||
    lower.includes("d:\\workspace\\") ||
    lower.includes("c:\\") ||
    lower.includes("c:\\users\\administrator\\.codex") ||
    lower.includes("superagentsystem") ||
    lower.includes("memory-governance-guidelines") ||
    lower.includes("memory-preflight") ||
    lower.includes("codex 全线程治理结果") ||
    lower.includes("knowledge from task execution") ||
    lower.includes("execution-derived knowledge") ||
    lower.includes("codex-all-governance") ||
    lower.includes("host capture and governance input") ||
    lower.includes("core 项目") ||
    lower.includes("`core` 项目") ||
    lower.includes("下一代记忆系统设计") ||
    lower.includes("用户会 fastapi") ||
    lower.includes("node_modules") ||
    lower.includes("tsc -p") ||
    lower.includes("npm run build") ||
    lower.includes("exit=0") ||
    lower.includes("exit=1") ||
    lower.includes("program 'rg.exe' failed") ||
    lower.includes("cannot find path") ||
    lower.includes("invoke-webrequest :") ||
    lower.includes("traceback") ||
    lower.includes("collecting ") ||
    lower.includes("requirement already satisfied") ||
    lower.includes("http/1.1 301") ||
    lower.includes("http/1.1 403") ||
    lower.includes("access is denied") ||
    lower.includes("无法将") ||
    lower.includes("找不到") ||
    lower.includes("错误") ||
    lower.includes("module_not_found") ||
    lower.includes("modulenotfounderror") ||
    lower.includes("<?xml") ||
    lower.includes("<w:document") ||
    lower.includes("localstorage.setitem") ||
    lower.includes("fps ") ||
    lower.includes("active ") ||
    lower.includes("stepstatus") ||
    lower.includes("请选择媒体资源") ||
    lower.includes("剪映") ||
    lower.includes("capcut.cn") ||
    lower.includes("淘宝") ||
    lower.includes("deleted=") ||
    /\b\d{4}:\s/.test(lower)
  ) {
    return true;
  }
  if (looksLikeMojibake(lower) || looksLikeCodeOrConfig(lower)) {
    return true;
  }
  return false;
}

function canonicalizeExecutionKnowledge(lower: string): string | null {
  if (lower.includes("symphony turns project work")) {
    return "Symphony 将项目工作组织为隔离的、自治的实现运行，让团队管理工作而不是逐步监督 coding agent。";
  }
  if (lower.includes("codex personal software agent is")) {
    return "Codex Personal Software Agent 的定位是 GUI-first agent framework，目标是让 Codex 成为能真实使用软件的助手，而不是只停留在聊天。";
  }
  if (lower.includes("agent teams is claude code")) {
    return "Claude Code Agent Teams 是多智能体协作机制，允许多个 Claude Code 会话以 Team Lead 和成员等角色协同工作。";
  }
  if (lower.includes("runtime memory")) {
    return "Runtime memory 适合作为 agent 执行链路中的运行态记忆层，但不应直接替代长期用户记忆。";
  }
  return null;
}

function inferKnowledgeSemanticKey(normalized: string): string | null {
  if (normalized.includes("symphony turns project work")) {
    return "knowledge:symphony";
  }
  if (normalized.includes("codex personal software agent is")) {
    return "knowledge:codex-personal-software-agent";
  }
  if (normalized.includes("agent teams is claude code")) {
    return "knowledge:claude-code-agent-teams";
  }
  if (normalized.includes("runtime memory")) {
    return "knowledge:runtime-memory";
  }
  return null;
}

function looksLikeExternalOrReusableKnowledge(lower: string): boolean {
  return (
    lower.includes("symphony turns project work") ||
    lower.includes("agent teams is claude code") ||
    lower.includes("codex personal software agent is") ||
    lower.includes("runtime memory") ||
    lower.includes("knowledge graph") ||
    lower.includes("openai memory") ||
    lower.includes("memory faq") ||
    lower.includes("rag ")
  );
}

function stripExecutionOutputEnvelope(text: string): string {
  return text
    .replace(/^Exit code:\s*\d+\s*Wall time:[\s\S]*?Output:\s*/i, "")
    .replace(/^command timed out[\s\S]*?Output:\s*/i, "")
    .trim();
}

function looksLikeMojibake(text: string): boolean {
  return /[�]|鍦|涓|荤|绯|鐭|娌|旇|嬫|粺|叧|棶|槸|殑/.test(text);
}

function looksLikeCodeOrConfig(text: string): boolean {
  const startsLikeData = text.trim().startsWith("{") || text.trim().startsWith("[") || text.trim().startsWith("<?xml");
  const codeMarkers = [
    "export async function",
    "function ",
    "const ",
    "import ",
    "defmodule ",
    "from __future__",
    "[build-system]",
    "[project]",
    "\"scripts\":",
    "\"dependencies\":",
    "angular.module",
    "class "
  ];
  if (startsLikeData) {
    return true;
  }
  return codeMarkers.some((marker) => text.includes(marker));
}

function extractReadableKnowledgeExcerpt(text: string): string | null {
  const lines = text
    .split(/\r?\n|(?=#+\s)/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("```"))
    .filter((line) => !line.startsWith("!["))
    .filter((line) => !/^\|?[-:\s|]+\|?$/.test(line));
  const prose = lines.filter((line) => {
    const lower = line.toLowerCase();
    if (looksLikeCodeOrConfig(lower) || looksLikeMojibake(lower)) {
      return false;
    }
    if (/^[\[{]/.test(line) || /^[A-Za-z]:\\/.test(line)) {
      return false;
    }
    return /[\u4e00-\u9fff]/.test(line) || /\b(is|are|provides|allows|enables|uses|supports|helps|turns|means|should|must)\b/i.test(line);
  });
  const joined = prose.slice(0, 6).join("\n");
  return joined.length >= 80 ? joined : null;
}

function inferExecutionKnowledgeTitle(seed: string): string {
  const lower = seed.toLowerCase();
  if (lower.includes("openai")) {
    return "OpenAI-related knowledge from task execution";
  }
  if (lower.includes("github")) {
    return "GitHub project knowledge from task execution";
  }
  if (lower.includes("arxiv") || lower.includes("paper") || lower.includes("论文")) {
    return "Research paper knowledge from task execution";
  }
  if (lower.includes("memory")) {
    return "Memory-system knowledge from task execution";
  }
  if (lower.includes("rag")) {
    return "RAG knowledge from task execution";
  }
  return "Execution-derived knowledge";
}
