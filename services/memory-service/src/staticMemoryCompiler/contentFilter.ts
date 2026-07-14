/**
 * 41. 静态记忆编译器 - 内容筛选
 *
 * 从 DB 查出的 Rule/Skill/Memory 行，筛选出适合编译进宿主原生静态记忆文件的条目。
 * 筛选原则：高置信度 + 长期稳定 + 非会话级 + 非时间敏感 + 非项目内部状态。
 */

// 时间敏感词：content 含这些词的条目不编译进静态文件（会过期）
const TIME_SENSITIVE_PATTERNS = [
  /今天|昨天|明天|刚刚|刚才|当前版本|本次|这次/,
  /v\d+\.\d+/i,
  /\b\d{4}-\d{2}-\d{2}\b/,
  /\bversion\s+\d+/i,
];

// 项目内部状态：content 含这些模式的条目不编译（安全风险）
const PROJECT_INTERNAL_PATTERNS = [
  /postgresql:\/\/|mysql:\/\//i,
  /\b(API_KEY|SECRET|TOKEN|PASSWORD)\b\s*[=:]/i,
  /\/Users\/|\/home\/|C:\\Users\\/i,
  /127\.0\.0\.1|localhost/i,
  /node_modules/,
];

// 项目专名：rule/skill content 含这些词的不编译（跨项目泄露风险）
const PROJECT_NOUN_PATTERNS = [
  /agi-memory|agi_memory/i,
  /hostModelGovernanceAdapter|governancePromptBuilder|L2ConflictDetector/i,
  /memory-service|memory-mcp-server/i,
  /trae|\.trae\//i,
  /super[-_]?agent/i,
];

export type CompilableLayer = "rule" | "skill" | "memory";

export interface FilterableItem {
  id: string;
  title: string;
  content?: string;
  statement?: string;
  promotion_status: string;
  enforcement_level?: string;
  origin_scope: string;
  availability_scope: string;
  governance_level?: string;
  stability?: string;
  memory_type?: string;
  self_test?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

export interface FilterResult {
  pass: boolean;
  reason?: string;
}

/**
 * 判断一条 DB 行是否适合编译进宿主原生静态记忆文件。
 * 通用排除 + 按层筛选。
 */
export function shouldCompileToStaticMemory(
  layer: CompilableLayer,
  item: FilterableItem
): FilterResult {
  // ── 通用排除 ──

  // 1. 未审批通过
  if (item.promotion_status !== "active") {
    return { pass: false, reason: `promotion_status=${item.promotion_status}` };
  }

  // 2. 会话级（不该跨会话编译）
  if (item.origin_scope === "session") {
    return { pass: false, reason: "origin_scope=session" };
  }

  // 3. 仅会话可用（不该跨会话编译）
  if (item.availability_scope === "session_only") {
    return { pass: false, reason: "availability_scope=session_only" };
  }

  // 4. 时间敏感词检查（content 或 statement）
  const textToCheck = item.content ?? item.statement ?? "";
  if (textToCheck && TIME_SENSITIVE_PATTERNS.some((p) => p.test(textToCheck))) {
    return { pass: false, reason: "content contains time-sensitive terms" };
  }

  // 5. 项目内部状态检查（安全风险）
  if (textToCheck && PROJECT_INTERNAL_PATTERNS.some((p) => p.test(textToCheck))) {
    return { pass: false, reason: "content contains project-internal state (security risk)" };
  }

  // ── 按层筛选 ──

  if (layer === "rule") {
    // rule 允许 must + must_not（都是强制规则，禁止性规则同样有价值）
    if (
      item.enforcement_level &&
      item.enforcement_level !== "must" &&
      item.enforcement_level !== "must_not"
    ) {
      return { pass: false, reason: `enforcement_level=${item.enforcement_level}` };
    }
    // rule 不能含项目专名（跨项目泄露风险）
    if (textToCheck && PROJECT_NOUN_PATTERNS.some((p) => p.test(textToCheck))) {
      return { pass: false, reason: "content contains project nouns (cross-project leak risk)" };
    }
    // rule 必须有 statement 或 content（格式化时能取到文本即可）
    if (!textToCheck) {
      return { pass: false, reason: "rule has no statement or content" };
    }
  }

  if (layer === "skill") {
    // skill 允许 shared + governance（都是经过治理流程的 skill）
    if (
      item.governance_level &&
      item.governance_level !== "shared" &&
      item.governance_level !== "governance"
    ) {
      return { pass: false, reason: `governance_level=${item.governance_level}` };
    }
    // skill 不能含项目专名
    if (textToCheck && PROJECT_NOUN_PATTERNS.some((p) => p.test(textToCheck))) {
      return { pass: false, reason: "content contains project nouns (cross-project leak risk)" };
    }
  }

  if (layer === "memory") {
    // memory 必须是 long_lived stability（没设 stability 的也放行，默认当 long_lived）
    if (item.stability && item.stability !== "long_lived") {
      return { pass: false, reason: `stability=${item.stability}` };
    }
    // user_memory 如果 self_test 明确标记 about_user_not_code=false 则跳过（代码细节不该编译）
    // self_test 不存在或字段缺失时放行（很多 memory 没填 self_test）
    if (item.memory_type === "user_memory") {
      const aboutUser = item.self_test?.about_user_not_code;
      if (aboutUser === false) {
        return { pass: false, reason: "user_memory and self_test.about_user_not_code=false" };
      }
    }
    // project_memory 额外检查项目专名（防止跨项目泄露到共享静态文件）
    if (item.memory_type === "project_memory" && textToCheck) {
      if (PROJECT_NOUN_PATTERNS.some((p) => p.test(textToCheck))) {
        return { pass: false, reason: "project_memory contains project nouns (cross-project leak risk)" };
      }
    }
  }

  return { pass: true };
}

/**
 * 批量筛选，返回通过的条目和被跳过的条目（含原因）。
 */
export function filterCompilableItems(
  layer: CompilableLayer,
  items: FilterableItem[]
): {
  passed: FilterableItem[];
  skipped: Array<{ id: string; title: string; reason: string }>;
} {
  const passed: FilterableItem[] = [];
  const skipped: Array<{ id: string; title: string; reason: string }> = [];

  for (const item of items) {
    const result = shouldCompileToStaticMemory(layer, item);
    if (result.pass) {
      passed.push(item);
    } else {
      skipped.push({
        id: item.id,
        title: item.title,
        reason: result.reason ?? "unknown",
      });
    }
  }

  return { passed, skipped };
}
