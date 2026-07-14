/**
 * TRAE 宿主 Profile — 区分 TRAE IDE / TRAE Work，提供宿主级默认值
 *
 * 设计动机：
 *   TRAE IDE 和 TRAE Work 是两个不同产品：
 *   - TRAE IDE 是 AI 原生 IDE，开发者场景，代码为主，task_type 应偏 execution/debugging
 *   - TRAE Work 是 AI 原生工作空间，文档/数据/研究为主，task_type 应偏 design/answer/ingestion
 *   之前 host="trae" 把两者混在一起，导致 task_type 推断不准，召回效果差。
 *
 * 区分方式：
 *   - host 字段显式传 "trae_ide" 或 "trae_work" → 直接识别
 *   - host="trae" 时通过 session_memory 摘要内容启发式判断
 *   - 无法判断时回退到 "trae_generic"
 */

// TRAE 宿主变体
export type TraeHostVariant = "trae_ide" | "trae_work" | "trae_generic";

// TRAE 宿主 Profile
export interface TraeHostProfile {
  variant: TraeHostVariant;
  // 默认 task_type（用于 retrieveBundle 的 TASK_LAYER_DEFAULTS 路由）
  default_task_type: string;
  // 默认 task_phase
  default_task_phase: string;
  // 召回时优先的 layer 顺序（覆盖 TASK_LAYER_DEFAULTS）
  preferred_layers: string[];
  // 摘要字段权重（用于查询增强时决定哪些字段优先）
  summary_field_weights: {
    intent: number;
    actions: number;
    outcome: number;
    learned: number;
  };
  // 抽取端：是否把 learned 字段直接作为 knowledge_candidate
  extract_learned_as_knowledge: boolean;
  // 抽取端：是否把 actions 字段作为 execution_trace
  extract_actions_as_trace: boolean;
  // 召回端：是否用 intent 作为查询增强
  use_intent_as_query_boost: boolean;
}

// IDE Profile：开发者场景，代码为主
const TRAE_IDE_PROFILE: TraeHostProfile = {
  variant: "trae_ide",
  default_task_type: "execution",
  default_task_phase: "coding",
  preferred_layers: [
    "conversation_summary",
    "rules",
    "resident_snapshot",
    "factual_memory",
    "procedural_memory",
    "synthesized_knowledge"
  ],
  summary_field_weights: {
    intent: 0.3,
    actions: 0.4,  // IDE 场景 actions 最重要（代码执行动作）
    outcome: 0.2,
    learned: 0.1
  },
  extract_learned_as_knowledge: true,
  extract_actions_as_trace: true,
  use_intent_as_query_boost: true
};

// Work Profile：工作场景，文档/研究为主
const TRAE_WORK_PROFILE: TraeHostProfile = {
  variant: "trae_work",
  default_task_type: "answer",
  default_task_phase: "planning",
  preferred_layers: [
    "conversation_summary",
    "rules",
    "resident_snapshot",
    "factual_memory",
    "synthesized_knowledge",  // Work 场景合成知识优先级更高
    "procedural_memory"
  ],
  summary_field_weights: {
    intent: 0.4,  // Work 场景 intent 最重要（用户意图）
    actions: 0.2,
    outcome: 0.2,
    learned: 0.2   // Work 场景 learned 更重要（研究/洞察）
  },
  extract_learned_as_knowledge: true,
  extract_actions_as_trace: false,  // Work 场景 actions 通常是文档操作不是代码执行
  use_intent_as_query_boost: true
};

// Generic Profile：无法区分时的回退
const TRAE_GENERIC_PROFILE: TraeHostProfile = {
  variant: "trae_generic",
  default_task_type: "answer",
  default_task_phase: "planning",
  preferred_layers: [
    "conversation_summary",
    "rules",
    "resident_snapshot",
    "factual_memory",
    "procedural_memory",
    "synthesized_knowledge"
  ],
  summary_field_weights: {
    intent: 0.35,
    actions: 0.3,
    outcome: 0.2,
    learned: 0.15
  },
  extract_learned_as_knowledge: true,
  extract_actions_as_trace: true,
  use_intent_as_query_boost: true
};

/**
 * 检测 TRAE 宿主变体
 *
 * 优先级：
 * 1. host 字段显式传 "trae_ide" / "trae_work" → 直接识别
 * 2. host="trae" 时通过 session 摘要内容启发式判断
 * 3. 无法判断时回退到 "trae_generic"
 */
export function detectTraeHostVariant(input: {
  host?: string | null;
  sessionRecords?: Array<Record<string, unknown>> | null;
}): TraeHostVariant {
  const host = String(input.host ?? "").toLowerCase();

  // 1. 显式指定
  if (host === "trae_ide" || host === "trae-ide") return "trae_ide";
  if (host === "trae_work" || host === "trae-work") return "trae_work";

  // 2. host="trae" 时通过摘要内容启发式判断
  if (host === "trae" || host === "") {
    const records = input.sessionRecords ?? [];
    if (records.length === 0) return "trae_generic";

    // IDE 特征词：代码执行、文件操作、调试、构建、测试
    const ideKeywords = [
      "代码", "编译", "构建", "调试", "测试", "运行", "执行",
      "文件", "目录", "分支", "提交", "git", "npm", "node",
      "typescript", "javascript", "python", "java", "go",
      "error", "exception", "stack", "trace", "bug", "fix",
      "refactor", "类型", "接口", "函数", "方法", "类"
    ];
    // Work 特征词：文档、研究、分析、报告、演示
    const workKeywords = [
      "文档", "报告", "演示", "研究", "分析", "总结",
      "会议", "纪要", "邮件", "任务", "日程", "审批",
      "数据", "图表", "可视化", "调研", "方案", "规划",
      "营销", "产品", "用户", "市场", "竞品"
    ];

    let ideScore = 0;
    let workScore = 0;
    for (const record of records) {
      const text = [
        record.intent, record.actions, record.outcome, record.learned
      ].map((v) => (typeof v === "string" ? v : Array.isArray(v) ? v.join(" ") : "")).join(" ").toLowerCase();

      for (const kw of ideKeywords) {
        if (text.includes(kw.toLowerCase())) ideScore++;
      }
      for (const kw of workKeywords) {
        if (text.includes(kw.toLowerCase())) workScore++;
      }
    }

    if (ideScore > workScore && ideScore > 0) return "trae_ide";
    if (workScore > ideScore && workScore > 0) return "trae_work";
    return "trae_generic";
  }

  return "trae_generic";
}

/**
 * 获取 TRAE 宿主 Profile
 */
export function getTraeHostProfile(variant: TraeHostVariant): TraeHostProfile {
  switch (variant) {
    case "trae_ide":
      return TRAE_IDE_PROFILE;
    case "trae_work":
      return TRAE_WORK_PROFILE;
    default:
      return TRAE_GENERIC_PROFILE;
  }
}

/**
 * 从 session 摘要内容推断 task_type
 *
 * 用于 retrieveBundle 的 task_type 路由。
 * 不依赖宿主显式传 task_type（TRAE 摘要模式下宿主通常不传），
 * 而是根据 intent/actions 内容启发式判断。
 */
export function inferTaskTypeFromSession(input: {
  profile: TraeHostProfile;
  intent?: string | null;
  actions?: string | null;
}): string {
  const text = `${input.intent ?? ""} ${input.actions ?? ""}`.toLowerCase();

  // 调试特征
  if (/debug|调试|error|exception|报错|失败|bug|修复|fix|stack/.test(text)) {
    return "debugging";
  }
  // 治理特征
  if (/governance|治理|审批|规则|rule|review|审查/.test(text)) {
    return "governance";
  }
  // 设计特征
  if (/design|设计|架构|方案|规划|plan|spec/.test(text)) {
    return "design";
  }
  // 集成特征
  if (/integrate|集成|接入|deploy|部署|ci\/cd/.test(text)) {
    return "integration";
  }
  // 回退到 profile 默认值
  return input.profile.default_task_type;
}

/**
 * 判断 host 是否是 TRAE 系列（trae/trae_ide/trae_work）
 */
export function isTraeHost(host?: string | null): boolean {
  const h = String(host ?? "").toLowerCase();
  return h === "trae" || h === "trae_ide" || h === "trae_work" || h === "trae-ide" || h === "trae-work";
}
