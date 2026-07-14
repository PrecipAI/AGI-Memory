/**
 * P3-2: canary 哨兵候选模板池
 *
 * 人工标注的测试候选，混入治理批次后用 validateCandidate 校验，
 * 对比校验结果与期望（expect_reject）判断治理流水线是否在走过场。
 *
 * 设计原则：
 *   - 模板由人工标注，不用模型生成（防模型记住模板）
 *   - 覆盖四种类型 + 常见投机取巧模式（套话/声明不一致/项目专名/常识声明OOD）
 *   - 期望通过的模板不带 source_refs（避免 P1-4 误杀，因 canary 的 source_excerpt 不在真实 session 中）
 *   - 期望拒绝的模板故意埋雷，触发对应校验（P1-1/P1-3/P1-4 或原有校验）
 *
 * 模板定期更新（建议每季度 review 一次），防止模型记忆。
 */

export type CanaryCandidateType =
  | "rule_candidate"
  | "memory_candidate"
  | "knowledge_candidate"
  | "skill_proposal_candidate";

export interface CanaryTemplate {
  id: string;
  candidate_type: CanaryCandidateType;
  title: string;
  content: string;
  source_excerpt: string;
  source_kind: "user_message" | "assistant_message" | "commentary" | "command" | "tool" | "mcp";
  source_timestamp: string;
  reason: string;
  confidence: "high" | "medium" | "low";
  origin_scope: string;
  availability_scope: string;
  governance_level: string;
  classification_trace: {
    q1_is_gate_decision: boolean;
    q1a_trigger_binds_skill: boolean | null;
    q2_is_reusable_workflow: boolean;
    q3_binds_specific_event: boolean;
    q4_is_general_knowledge: boolean;
    decision_layer: "rule" | "memory" | "skill" | "knowledge";
    decision_reasoning: string;
  };
  review_trace: {
    review_layer: "rule" | "memory" | "skill" | "knowledge";
    review_reasoning: string;
    consensus: boolean;
  };
  self_test: Record<string, unknown>;
  expect_reject: boolean;
  /** 期望的校验错误信息片段（用于确认拒绝原因对路），null 表示不校验错误信息 */
  expect_error_pattern: string | null;
  /** skill 候选额外字段 */
  target_skill?: string;
  proposed_text?: string;
  current_gap?: string;
  change_type?: string;
  validation_method?: string;
  description?: string;
  applicable_scenarios?: string[];
  non_applicable_scenarios?: string[];
  execution_steps?: string[];
  /** rule 候选额外字段（validateCandidate 对 rule 强制要求） */
  enforcement_level?: string;
  metadata?: {
    human_readable_statement: string;
    classification_rationale: string;
  };
  /** memory 候选额外字段（不设默认 session_memory 时的显式声明） */
  memory_type?: string;
  /** skill 候选额外字段（强制 needs_review） */
  promotion_status?: string;
}

export const CANARY_TEMPLATES: CanaryTemplate[] = [
  // ─── memory canary（4 条）───

  // 1. 合规 memory（期望通过）
  {
    id: "canary-memory-1-compliant",
    candidate_type: "memory_candidate",
    title: "用户偏好简洁直接的回答风格",
    content: "用户在多次对话中明确表示偏好简洁直接的回答，不喜欢冗长解释和废话",
    source_excerpt: "用户偏好简洁直接的回答",
    source_kind: "user_message",
    source_timestamp: "2026-01-01T00:00:00Z",
    reason: "该记忆记录用户的沟通偏好，影响后续回答风格",
    confidence: "high",
    origin_scope: "user",
    availability_scope: "user_reusable",
    governance_level: "shared",
    classification_trace: {
      q1_is_gate_decision: false,
      q1a_trigger_binds_skill: null,
      q2_is_reusable_workflow: false,
      q3_binds_specific_event: false,
      q4_is_general_knowledge: false,
      decision_layer: "memory",
      decision_reasoning: "Q1 不命中（偏好简洁回答不是放行判断），Q2 不命中（不是可复用工作流），Q3 不命中（不绑定具体事件），Q4 不命中（不是通用知识）。内容描述用户偏好简洁直接的回答风格，是关于用户沟通偏好的事实，归入 Memory。",
    },
    review_trace: {
      review_layer: "memory",
      review_reasoning: "只看标题和正文，内容描述的是用户偏好简洁回答风格而非放行判断或可复用流程，归入 Memory 合理",
      consensus: true,
    },
    self_test: {
      one_month_value: true,
      about_user_not_code: true,
      time_diluted: "stable",
    },
    expect_reject: false,
    expect_error_pattern: null,
  },

  // 2. 代码细节当 memory（期望拒绝：about_user_not_code 不一致）
  {
    id: "canary-memory-2-code-as-memory",
    candidate_type: "memory_candidate",
    title: "PostgreSQL 连接池泄漏修复方案",
    content: "修复了 PostgreSQL 连接池泄漏问题，root_cause: connection 释放逻辑缺失，fix_action: 在 finally 块中调用 release() 方法",
    source_excerpt: "PostgreSQL 连接池泄漏修复",
    source_kind: "user_message",
    source_timestamp: "2026-01-01T00:00:00Z",
    reason: "记录连接池泄漏的修复经验",
    confidence: "medium",
    origin_scope: "project",
    availability_scope: "project_reusable",
    governance_level: "shared",
    memory_type: "project_memory",
    classification_trace: {
      q1_is_gate_decision: false,
      q1a_trigger_binds_skill: null,
      q2_is_reusable_workflow: false,
      q3_binds_specific_event: true,
      q4_is_general_knowledge: false,
      decision_layer: "memory",
      decision_reasoning: "Q1 不命中，Q2 不命中，Q3 命中（绑定具体修复事件），Q4 不命中。内容描述 PostgreSQL 连接池泄漏修复，归入 Memory。",
    },
    review_trace: {
      review_layer: "memory",
      review_reasoning: "连接池泄漏修复是具体事件，归入 Memory 合理",
      consensus: true,
    },
    self_test: {
      one_month_value: true,
      about_user_not_code: true,
      time_diluted: "stable",
    },
    expect_reject: true,
    expect_error_pattern: "about_user_not_code",
  },

  // 3. 套话 reasoning（期望拒绝：specificity 不足）
  {
    id: "canary-memory-3-filler-reasoning",
    candidate_type: "memory_candidate",
    title: "用户喜欢用 Python 写脚本",
    content: "用户在多个项目中偏好使用 Python 语言编写脚本，尤其是数据处理和自动化任务",
    source_excerpt: "用户喜欢用 Python 写脚本",
    source_kind: "user_message",
    source_timestamp: "2026-01-01T00:00:00Z",
    reason: "记录用户编程语言偏好",
    confidence: "high",
    origin_scope: "user",
    availability_scope: "user_reusable",
    governance_level: "shared",
    classification_trace: {
      q1_is_gate_decision: false,
      q1a_trigger_binds_skill: null,
      q2_is_reusable_workflow: false,
      q3_binds_specific_event: false,
      q4_is_general_knowledge: false,
      decision_layer: "memory",
      // 故意写套话：不引用 "Python"/"脚本"/"数据处理" 等候选特有词汇
      decision_reasoning: "Q1 不命中，Q2 不命中，Q3 命中，Q4 不命中，归入 Memory。",
    },
    review_trace: {
      review_layer: "memory",
      review_reasoning: "内容描述用户偏好，归入 Memory 合理",
      consensus: true,
    },
    self_test: {
      one_month_value: true,
      about_user_not_code: true,
      time_diluted: "stable",
    },
    expect_reject: true,
    expect_error_pattern: "specificity",
  },

  // 4. 时间敏感词声明 stable（期望拒绝：time_diluted 不一致）
  {
    id: "canary-memory-4-time-sensitive",
    candidate_type: "memory_candidate",
    title: "用户今天遇到 PostgreSQL 连接池泄漏",
    content: "用户今天遇到了 PostgreSQL 连接池泄漏问题，刚才修复了 finally 块中的 release 调用",
    source_excerpt: "用户今天遇到 PostgreSQL 连接池泄漏",
    source_kind: "user_message",
    source_timestamp: "2026-01-01T00:00:00Z",
    reason: "记录今天发生的连接池泄漏事件",
    confidence: "medium",
    origin_scope: "session",
    availability_scope: "session_only",
    governance_level: "session",
    classification_trace: {
      q1_is_gate_decision: false,
      q1a_trigger_binds_skill: null,
      q2_is_reusable_workflow: false,
      q3_binds_specific_event: true,
      q4_is_general_knowledge: false,
      decision_layer: "memory",
      decision_reasoning: "Q1 不命中，Q2 不命中，Q3 命中（今天遇到的连接池泄漏是具体事件），Q4 不命中。内容描述今天发生的 PostgreSQL 连接池泄漏，归入 Memory。",
    },
    review_trace: {
      review_layer: "memory",
      review_reasoning: "今天遇到的连接池泄漏是具体事件，归入 Memory 合理",
      consensus: true,
    },
    self_test: {
      one_month_value: true,
      about_user_not_code: true,
      time_diluted: "stable",  // 故意声明 stable，但 content 含 "今天"/"刚才"
    },
    expect_reject: true,
    expect_error_pattern: "time_diluted",
  },

  // ─── rule canary（2 条）───

  // 5. 合规 rule（期望通过）
  // 注意：rule 候选要求 source_refs 含 user_message + commentary，且 metadata 必填。
  // source_refs 由 maybeInjectCanary 从 batch.raw_inputs 动态构造（确保通过 P1-4）。
  {
    id: "canary-rule-1-compliant",
    candidate_type: "rule_candidate",
    title: "MCP 工具 schema 必须显式声明所有字段",
    content: "IF 定义 MCP tool schema THEN 必须显式声明所有字段的类型和可选性，禁止使用 catchall 或 optional 绕过校验",
    source_excerpt: "MCP schema 必须显式声明",
    source_kind: "commentary",
    source_timestamp: "2026-01-01T00:00:00Z",
    reason: "防止 MCP schema 使用 catchall 绕过校验导致数据丢失",
    confidence: "high",
    origin_scope: "project",
    availability_scope: "project_reusable",
    governance_level: "shared",
    enforcement_level: "must",
    metadata: {
      human_readable_statement: "定义 MCP 工具 schema 时必须显式声明所有字段类型和可选性，禁止用 catchall 绕过校验",
      classification_rationale: "这是约束性规则，规定 IF 定义 MCP schema THEN 必须显式声明字段，是放行判断而非可复用操作流程",
    },
    classification_trace: {
      q1_is_gate_decision: true,
      q1a_trigger_binds_skill: false,
      q2_is_reusable_workflow: false,
      q3_binds_specific_event: false,
      q4_is_general_knowledge: false,
      decision_layer: "rule",
      decision_reasoning: "Q1 命中（是放行判断：MCP schema 字段必须显式声明），Q1a 不命中（不绑定技能），Q2 不命中（不是可复用工作流），Q3 不命中（不绑定具体事件），Q4 不命中（不是通用知识）。内容定义 MCP schema 字段必须显式声明的放行判断，归入 Rule。",
    },
    review_trace: {
      review_layer: "rule",
      review_reasoning: "内容是 MCP schema 字段必须显式声明的放行判断，归入 Rule 合理",
      consensus: true,
    },
    self_test: {
      survives_without_project_nouns: true,
      host_layer_gate: true,
    },
    expect_reject: false,
    expect_error_pattern: null,
  },

  // 6. rule 含项目专名声明通用（期望拒绝：survives_without_project_nouns 不一致）
  {
    id: "canary-rule-2-project-noun",
    candidate_type: "rule_candidate",
    title: "agi-memory 项目中 MCP schema 必须显式声明",
    content: "IF 在 agi-memory 项目中定义 MCP schema THEN 必须在 hostModelGovernanceAdapter 中显式声明所有字段",
    source_excerpt: "agi-memory 项目 MCP schema 声明",
    source_kind: "commentary",
    source_timestamp: "2026-01-01T00:00:00Z",
    reason: "agi-memory 项目的 MCP schema 校验规则",
    confidence: "medium",
    origin_scope: "project",
    availability_scope: "project_reusable",
    governance_level: "shared",
    enforcement_level: "must",
    metadata: {
      human_readable_statement: "在 agi-memory 项目中定义 MCP schema 时必须在 hostModelGovernanceAdapter 中显式声明所有字段",
      classification_rationale: "这是约束性规则，规定 IF 在 agi-memory 中定义 MCP schema THEN 必须显式声明字段，是放行判断",
    },
    classification_trace: {
      q1_is_gate_decision: true,
      q1a_trigger_binds_skill: false,
      q2_is_reusable_workflow: false,
      q3_binds_specific_event: false,
      q4_is_general_knowledge: false,
      decision_layer: "rule",
      decision_reasoning: "Q1 命中（MCP schema 必须显式声明），Q2 不命中，Q3 不命中，Q4 不命中。内容定义 agi-memory 项目 MCP schema 声明规则，归入 Rule。",
    },
    review_trace: {
      review_layer: "rule",
      review_reasoning: "内容是 agi-memory 项目的 MCP schema 声明规则，归入 Rule 合理",
      consensus: true,
    },
    self_test: {
      survives_without_project_nouns: true,  // 故意声明 true，但 content 含 "agi-memory"/"hostModelGovernanceAdapter"
      host_layer_gate: true,
    },
    expect_reject: true,
    expect_error_pattern: "survives_without_project_nouns",
  },

  // ─── knowledge canary（3 条）───

  // 7. 合规 knowledge（期望通过）
  {
    id: "canary-knowledge-1-compliant",
    candidate_type: "knowledge_candidate",
    title: "Zod catchall 模式导致静默数据丢失",
    content: "Zod schema 使用 catchall 模式时，未知字段会被静默剥离而不报错，导致数据丢失难以排查。这种模式在 schema 校验中是反模式。",
    source_excerpt: "Zod catchall 静默数据丢失",
    source_kind: "commentary",
    source_timestamp: "2026-01-01T00:00:00Z",
    reason: "记录 Zod catchall 模式的数据丢失陷阱，供后续 schema 设计参考",
    confidence: "high",
    origin_scope: "project",
    availability_scope: "project_reusable",
    governance_level: "shared",
    classification_trace: {
      q1_is_gate_decision: false,
      q1a_trigger_binds_skill: null,
      q2_is_reusable_workflow: false,
      q3_binds_specific_event: false,
      q4_is_general_knowledge: true,
      decision_layer: "knowledge",
      decision_reasoning: "Q1 不命中（不是放行判断），Q2 不命中（不是可复用工作流），Q3 不命中（不绑定具体事件），Q4 命中（Zod catchall 静默数据丢失是通用知识）。内容描述 Zod catchall 模式导致静默数据丢失的通用知识，归入 Knowledge。",
    },
    review_trace: {
      review_layer: "knowledge",
      review_reasoning: "内容是 Zod catchall 静默数据丢失的通用知识，归入 Knowledge 合理",
      consensus: true,
    },
    self_test: {
      ood_threshold: true,
      reusable: true,
      learning_chain_anchored: true,
    },
    expect_reject: false,
    expect_error_pattern: null,
  },

  // 8. 常识声明 OOD（期望拒绝：ood_threshold 不一致）
  {
    id: "canary-knowledge-2-common-knowledge",
    candidate_type: "knowledge_candidate",
    title: "PostgreSQL 是一种关系型数据库",
    content: "PostgreSQL 是一种广泛使用的关系型数据库管理系统，支持 SQL 查询和事务，是行业标准的数据存储方案。",
    source_excerpt: "PostgreSQL 是关系型数据库",
    source_kind: "commentary",
    source_timestamp: "2026-01-01T00:00:00Z",
    reason: "记录 PostgreSQL 是关系型数据库的常识",
    confidence: "medium",
    origin_scope: "project",
    availability_scope: "project_reusable",
    governance_level: "shared",
    classification_trace: {
      q1_is_gate_decision: false,
      q1a_trigger_binds_skill: null,
      q2_is_reusable_workflow: false,
      q3_binds_specific_event: false,
      q4_is_general_knowledge: true,
      decision_layer: "knowledge",
      decision_reasoning: "Q1 不命中，Q2 不命中，Q3 不命中，Q4 命中（PostgreSQL 是关系型数据库）。内容描述 PostgreSQL 是关系型数据库，归入 Knowledge。",
    },
    review_trace: {
      review_layer: "knowledge",
      review_reasoning: "PostgreSQL 是关系型数据库是通用知识，归入 Knowledge 合理",
      consensus: true,
    },
    self_test: {
      ood_threshold: true,  // 故意声明 true，但 content 匹配常识模式
      reusable: true,
      learning_chain_anchored: true,
    },
    expect_reject: true,
    expect_error_pattern: "ood_threshold",
  },

  // 9. 具体事件声明 reusable（期望拒绝：reusable 不一致）
  {
    id: "canary-knowledge-3-specific-event",
    candidate_type: "knowledge_candidate",
    title: "今天发现的 Zod catchall 静默丢失问题",
    content: "今天我们在 agi-memory 项目中发现了 Zod catchall 模式导致的静默数据丢失，本次修复了 schema 定义并加了校验。",
    source_excerpt: "今天发现 Zod catchall 静默丢失",
    source_kind: "commentary",
    source_timestamp: "2026-01-01T00:00:00Z",
    reason: "记录今天发现的 Zod catchall 问题",
    confidence: "medium",
    origin_scope: "project",
    availability_scope: "project_reusable",
    governance_level: "shared",
    classification_trace: {
      q1_is_gate_decision: false,
      q1a_trigger_binds_skill: null,
      q2_is_reusable_workflow: false,
      q3_binds_specific_event: true,
      q4_is_general_knowledge: false,
      decision_layer: "knowledge",
      decision_reasoning: "Q1 不命中，Q2 不命中，Q3 命中（今天发现的 catchall 问题是具体事件），Q4 不命中。内容描述今天发现的 Zod catchall 静默数据丢失，归入 Knowledge。",
    },
    review_trace: {
      review_layer: "knowledge",
      review_reasoning: "今天发现的 catchall 问题是具体事件，归入 Knowledge 合理",
      consensus: true,
    },
    self_test: {
      ood_threshold: true,
      reusable: true,  // 故意声明 true，但 content 含 "今天"/"本次"/"我们发现了"
      learning_chain_anchored: true,
    },
    expect_reject: true,
    expect_error_pattern: "reusable",
  },

  // ─── skill canary（1 条）───

  // 10. 合规 skill（期望通过）
  {
    id: "canary-skill-1-compliant",
    candidate_type: "skill_proposal_candidate",
    title: "设定一致性检查技能",
    content: "在生成新章节前加载设定文档并核对角色状态、道具规则等一致性",
    source_excerpt: "设定一致性检查技能提议",
    source_kind: "commentary",
    source_timestamp: "2026-01-01T00:00:00Z",
    reason: "该技能可复用于小说创作中的设定一致性检查，是多步骤可执行流程",
    confidence: "high",
    origin_scope: "global",
    availability_scope: "global_reusable",
    governance_level: "shared",
    promotion_status: "needs_review",
    target_skill: "设定一致性检查",
    proposed_text: "在生成新章节前，加载设定文档并核对角色状态、道具规则、时间线等一致性",
    current_gap: "当前技能缺少设定一致性检查步骤，导致章节间出现设定矛盾",
    change_type: "add",
    validation_method: "选取最近 3 章由该技能预检查，确认无用户后续指出同类设定漏洞",
    description: "做设定一致性检查。在生成新章节或修改核心设定时调用。",
    applicable_scenarios: ["生成新章节前预检设定一致性", "用户修改核心设定后检查矛盾"],
    non_applicable_scenarios: ["纯文字润色不涉及设定逻辑时不调用", "新建项目初始设定创建时不调用"],
    execution_steps: ["加载设定文档并解析角色状态", "核对当前章节与设定的一致性", "输出矛盾清单供人工确认"],
    classification_trace: {
      q1_is_gate_decision: false,
      q1a_trigger_binds_skill: true,
      q2_is_reusable_workflow: true,
      q3_binds_specific_event: false,
      q4_is_general_knowledge: false,
      decision_layer: "skill",
      decision_reasoning: "Q1 不命中（不是放行判断），Q1a 命中（绑定设定一致性检查技能），Q2 命中（是可复用工作流：加载设定→核对→输出矛盾），Q3 不命中（不绑定具体事件），Q4 不命中。内容描述设定一致性检查的多步骤可复用流程，归入 Skill。",
    },
    review_trace: {
      review_layer: "skill",
      review_reasoning: "内容是设定一致性检查的多步骤可复用流程，归入 Skill 合理",
      consensus: true,
    },
    self_test: {
      executable_with_generic_terms: true,
      proven_multi_step: true,
    },
    expect_reject: false,
    expect_error_pattern: null,
  },
];
