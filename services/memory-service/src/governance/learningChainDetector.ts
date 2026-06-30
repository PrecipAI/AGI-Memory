/**
 * P3 学习行为链检测器
 *
 * 设计动机：
 *   "agent 不会自己说『我学会了』"——如果只是偶然查一次资料，不能判定为"习得认知"。
 *   只有出现 search → learn → apply 三段式 + 终点总结性文本，才允许合成 Knowledge。
 *
 * 检测算法：
 *   1. 扫描 tool_calls 序列，按 timestamp 排序
 *   2. 识别 search 阶段：tool_name 匹配检索类工具（web_search / grep / read / fetch / search_*）
 *   3. 识别 learn 阶段：search 后 ≤ 30 分钟内出现 assistant_message 含分析性词
 *      （发现 / 结论 / 原因 / 总结 / 综合 / 归纳 / 学到 / 知道 / 原来是）
 *   4. 识别 apply 阶段：learn 后 ≤ 60 分钟内出现 command / tool_call 实际应用该认知
 *   5. 终点锚定：apply 之后必须有总结性文本（"我们 X 了" / "因此 Y" / "综上 Z"）
 *   6. 防御：序列不完整或终点无总结 → 输出 empty chain，下游不硬造 Knowledge
 *
 * 输出语义：
 *   - learningChains.length === 0：本次 session 无学习行为；下游 Knowledge 候选必须为空
 *   - learningChains.length > 0：每条 chain 给出检索词 / 学到的关键词 / 应用证据 / 总结文本
 *     下游 Knowledge 候选必须能关联到某条 chain，否则降级为 Memory
 */

export interface LearningChainInput {
  /** 按 timestamp 升序的所有事件（tool_calls + user/assistant messages + commands） */
  events: LearningChainEvent[];
}

export interface LearningChainEvent {
  timestamp: string;
  kind: "tool_call" | "user_message" | "assistant_message" | "command";
  /** tool_call 时填工具名；message 时填消息文本；command 时填命令文本 */
  payload: string;
  status?: "success" | "failure" | "unknown";
}

export interface LearningChain {
  /** 检索阶段起始时间 */
  searchStartedAt: string;
  /** 检索阶段使用的工具 */
  searchTools: string[];
  /** 检索关键词（从工具 arguments 或 message 文本提取） */
  searchKeywords: string[];
  /** 学习阶段：assistant 给出分析的时间 */
  learnedAt: string | null;
  /** 学到的关键词（从 assistant 消息提取） */
  learnedKeywords: string[];
  /** 应用阶段：是否在后续出现实际应用（command 或 tool_call） */
  appliedAt: string | null;
  /** 终点锚定：apply 后是否有总结性文本 */
  summaryText: string | null;
  /** 整条链是否完整（search + learn + apply + summary 四段齐全） */
  isComplete: boolean;
  /** 防御信号：未达成完整链时给出原因 */
  incompleteReason?: "missing_learn" | "missing_apply" | "missing_summary";
}

// 检索类工具名识别
const SEARCH_TOOL_PATTERNS = [
  /^web_search$/i,
  /^search/i,
  /^grep$/i,
  /^glob$/i,
  /^read$/i,
  /^fetch$/i,
  /^webfetch$/i,
  /^query$/i,
  /^retrieve/i,
  /^find/i,
  /^locate/i,
  /^searchcodebase$/i,
];

// 分析性词汇（learn 阶段判定）
const LEARN_KEYWORDS = [
  "发现", "结论", "原因", "总结", "综合", "归纳", "学到", "知道", "原来是",
  "根因", "本质上", "底层是", "关键在于", "之所以", "因此", "所以",
  "realized", "found that", "the reason", "conclude", "summary",
];

// 应用类工具（apply 阶段判定）
const APPLY_TOOL_PATTERNS = [
  /^edit$/i, /^write$/i, /^run_command$/i, /^execute$/i, /^apply$/i,
  /^create$/i, /^update$/i, /^delete$/i, /^patch$/i, /^commit$/i,
  /^sed$/i, /^replace$/i,
];

// 终点总结性词（终点锚定判定）
const SUMMARY_KEYWORDS = [
  "综上", "因此", "所以", "最终", "我们 X 了", "解决了", "完成了",
  "这样一来", "至此", "已经", "现在可以", "于是",
  "in summary", "therefore", "as a result", "now we can",
];

const SEARCH_WINDOW_MS = 30 * 60 * 1000;   // 30 分钟
const APPLY_WINDOW_MS = 60 * 60 * 1000;    // 60 分钟

/**
 * 检测学习行为链。
 *
 * 防御原则（无总结则不造）：
 *   即使 search→learn→apply 三段齐全，如果 apply 之后没有总结性文本，
 *   isComplete 仍然为 false，incompleteReason='missing_summary'。
 *   下游 Knowledge 合成器必须只接受 isComplete=true 的 chain。
 */
export function detectLearningChains(input: LearningChainInput): LearningChain[] {
  const events = [...input.events].sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const chains: LearningChain[] = [];

  // 第一阶段：找所有 search 起点
  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    if (evt.kind !== "tool_call") continue;
    if (!isSearchTool(evt.payload)) continue;

    const searchStartedAt = evt.timestamp;
    const searchTools = [evt.payload];
    const searchKeywords = extractKeywords(evt.payload);

    // 第二阶段：在 SEARCH_WINDOW 内找 learn（assistant_message 含分析性词）
    const learnResult = findLearnEvent(events, i + 1, searchStartedAt, SEARCH_WINDOW_MS);
    if (!learnResult) {
      // 序列不完整：缺 learn 阶段
      chains.push({
        searchStartedAt,
        searchTools,
        searchKeywords,
        learnedAt: null,
        learnedKeywords: [],
        appliedAt: null,
        summaryText: null,
        isComplete: false,
        incompleteReason: "missing_learn",
      });
      continue;
    }

    const { event: learnEvent, index: learnIndex } = learnResult;
    const learnedKeywords = extractKeywords(learnEvent.payload);

    // 第三阶段：在 APPLY_WINDOW 内找 apply（command 或 apply 类 tool_call）
    const applyResult = findApplyEvent(events, learnIndex + 1, learnEvent.timestamp, APPLY_WINDOW_MS);
    if (!applyResult) {
      chains.push({
        searchStartedAt,
        searchTools,
        searchKeywords,
        learnedAt: learnEvent.timestamp,
        learnedKeywords,
        appliedAt: null,
        summaryText: null,
        isComplete: false,
        incompleteReason: "missing_apply",
      });
      continue;
    }

    const { event: applyEvent } = applyResult;

    // 第四阶段：终点锚定——apply 之后必须出现总结性文本
    const summaryResult = findSummaryEvent(events, applyResult.index + 1, applyEvent.timestamp, APPLY_WINDOW_MS);
    if (!summaryResult) {
      // 防御核心：无总结则不造
      chains.push({
        searchStartedAt,
        searchTools,
        searchKeywords,
        learnedAt: learnEvent.timestamp,
        learnedKeywords,
        appliedAt: applyEvent.timestamp,
        summaryText: null,
        isComplete: false,
        incompleteReason: "missing_summary",
      });
      continue;
    }

    chains.push({
      searchStartedAt,
      searchTools,
      searchKeywords,
      learnedAt: learnEvent.timestamp,
      learnedKeywords,
      appliedAt: applyEvent.timestamp,
      summaryText: summaryResult.event.payload,
      isComplete: true,
    });
  }

  return chains;
}

function isSearchTool(toolName: string): boolean {
  return SEARCH_TOOL_PATTERNS.some((p) => p.test(toolName));
}

function isApplyTool(toolName: string): boolean {
  return APPLY_TOOL_PATTERNS.some((p) => p.test(toolName));
}

function findLearnEvent(
  events: LearningChainEvent[],
  startIndex: number,
  anchorTime: string,
  windowMs: number
): { event: LearningChainEvent; index: number } | null {
  const anchorMs = new Date(anchorTime).getTime();
  for (let i = startIndex; i < events.length; i++) {
    const evt = events[i];
    const evtMs = new Date(evt.timestamp).getTime();
    if (evtMs - anchorMs > windowMs) break;
    if (evt.kind !== "assistant_message") continue;
    if (LEARN_KEYWORDS.some((kw) => evt.payload.toLowerCase().includes(kw.toLowerCase()))) {
      return { event: evt, index: i };
    }
  }
  return null;
}

function findApplyEvent(
  events: LearningChainEvent[],
  startIndex: number,
  anchorTime: string,
  windowMs: number
): { event: LearningChainEvent; index: number } | null {
  const anchorMs = new Date(anchorTime).getTime();
  for (let i = startIndex; i < events.length; i++) {
    const evt = events[i];
    const evtMs = new Date(evt.timestamp).getTime();
    if (evtMs - anchorMs > windowMs) break;
    if (evt.kind === "command") return { event: evt, index: i };
    if (evt.kind === "tool_call" && isApplyTool(evt.payload)) return { event: evt, index: i };
  }
  return null;
}

function findSummaryEvent(
  events: LearningChainEvent[],
  startIndex: number,
  anchorTime: string,
  windowMs: number
): { event: LearningChainEvent; index: number } | null {
  const anchorMs = new Date(anchorTime).getTime();
  for (let i = startIndex; i < events.length; i++) {
    const evt = events[i];
    const evtMs = new Date(evt.timestamp).getTime();
    if (evtMs - anchorMs > windowMs) break;
    if (evt.kind !== "assistant_message" && evt.kind !== "user_message") continue;
    if (SUMMARY_KEYWORDS.some((kw) => evt.payload.toLowerCase().includes(kw.toLowerCase()))) {
      return { event: evt, index: i };
    }
  }
  return null;
}

function extractKeywords(text: string): string[] {
  // 简单关键词提取：英文 token + 中文 2-4 字短语
  const englishTokens = (text.match(/[a-zA-Z][a-zA-Z0-9_-]{2,}/g) ?? [])
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 2)
    .slice(0, 8);
  const cjkMatches = text.match(/[\u4e00-\u9fff]{2,6}/g) ?? [];
  return [...englishTokens, ...cjkMatches].slice(0, 12);
}
