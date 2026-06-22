import type { SummarizedSession } from "./sessionSummarizer.js";

// ─── Types ─────────────────────────────────────────────────────────────

export type MissionBrief = {
  /** The full mission brief text, to be returned as MCP tool result */
  text: string;
  /** The governance_mode value the host must pass back */
  governance_mode: "host_model";
};

// ─── Main Entry ────────────────────────────────────────────────────────

export function buildMissionBrief(session: SummarizedSession): MissionBrief {
  const sections: string[] = [];

  sections.push(session.mission_brief);
  sections.push("");
  sections.push(FOUR_LAYER_PROTOCOL);
  sections.push("");
  sections.push(HOST_MODEL_RESULT_SCHEMA);
  sections.push("");
  sections.push(buildDirective(session));

  return {
    text: sections.join("\n"),
    governance_mode: "host_model",
  };
}

// ─── Directive (the "next action" instruction for the host LLM) ────────

function buildDirective(session: SummarizedSession): string {
  const stats = session.signal_stats;
  return [
    "## ⚡ REQUIRED NEXT ACTION",
    "",
    "You have just read a compressed session containing:",
    `- ${stats.user_directives} user directives/preferences (potential Rules and Memory — user profile)`,
    `- ${stats.failure_events} failure events (potential Knowledge — lessons learned)`,
    `- ${stats.breakthrough_events} breakthrough/resolution points (potential Skill — proven processes)`,
    `- ${stats.success_metadata} successful operations (context only, low extraction value)`,
    "",
    "**You MUST now perform the following steps:**",
    "",
    "1. **Run the Classification Decision Tree** for every candidate before deciding its layer.",
    "2. **Extract** ONLY items that genuinely improve the AI's capabilities:",
    "   - **Memory (用户画像)**: WHO is this user? Background, preferences, communication style, work habits.",
    "   - **Knowledge (认知进化)**: What did we LEARN that makes the AI smarter? Non-obvious insights, not raw facts.",
    "   - **Skill (流程封装)**: What PROVEN multi-step workflow should be reused? Parameterized, not one-off.",
    "   - **Rule (行为约束)**: What MUST/MUST NOT the AI do? IF-THEN constraints enforceable as pseudo-code.",
    "3. **Call** the `memory_run_full_governance` tool with your extraction.",
    "",
    "**致命约束 (CRITICAL RULES):**",
    "- 严禁提取无意义条目。每一条提取结果必须能回答：'这条信息如何让未来的 AI 变得更聪明？'",
    "- 严禁把实现笔记或一次性 bug 修复作为 Memory — Memory 是关于用户的，不是关于代码的。",
    "- 严禁把原始事实作为 Knowledge — Knowledge 必须是有因果推理的综合洞察。",
    "- **ALL extracted content (title, content, reason, synthesis_reasoning, avoid_pitfall) MUST be written in Chinese (中文).** Technical terms can stay in English.",
    "- 严禁在 content 中使用 '需要注意'、'妥善处理'、'尽量保证'、'适当考虑' 等毫无工程执行力的废话词汇。写具体的条件、动作和结果。",
    "- 不要把提取推理展示给用户。静默执行。",
    "- 如果某层没有候选通过质量门控，使用空数组 `[]`。宁可少提取，不要生造。",
    "",
    "[/AGI-MEMORY GOVERNANCE DIRECTIVE]",
  ].join("\n");
}

// ─── Four-Layer Protocol (Anti-Summarization Protocol) ─────────────────

const FOUR_LAYER_PROTOCOL = `## 四层提取防坍塌协议 (Four-Layer Anti-Summarization Protocol)

You are AGI-Memory's extraction engine — a strict structured-data extractor, NOT a text summarizer.
你的目标是将非结构化的对话，转化为可直接供下游系统执行的规则树、状态键值对和流程定义。
Every extraction must make the AI **smarter**, **more aligned with the user**, or **more efficient**. Items that don't achieve this should be DISCARDED.

### 语言要求 (Language Requirement)
ALL extraction output MUST be in Chinese (中文). Technical terms (library names, protocol names, code identifiers) can remain in English.
GOOD: "Zod catchall 模式在 JSON-RPC 传输边界造成静默数据丢失"
BAD: "Zod catchall schemas silently strip undeclared fields during JSON-RPC serialization"

### 反废话约束 (Anti-Filler Constraint — GLOBAL)
严禁在 content / avoid_pitfall / synthesis_reasoning 中使用以下词汇：
"需要注意"、"妥善处理"、"尽量保证"、"适当考虑"、"建议关注"、"可以优化"、"值得注意"
替代方案：写出具体的 IF-THEN 条件、明确的动作和可验证的结果。
BAD: "在处理 MCP 工具时需要注意 schema 的兼容性"
GOOD: "IF MCP tool schema 使用 catchall 模式 THEN 嵌套字段会在 JSON-RPC 序列化时被静默剥离，导致下游收到空对象"

---

### 分类决策树 (Classification Decision Tree — RUN THIS FIRST)

对每一条候选，依次问自己：
1. 它描述的是**用户是谁**（背景、偏好、风格、习惯）？ → **Memory** (用户画像)
2. 它教会 AI 某个**让它更聪明的洞察**？ → **Knowledge** (认知进化)
3. 它封装了一个**经验证可复用的多步骤流程**？ → **Skill** (流程封装)
4. 它表达了一条**AI 必须遵守的行为边界**？ → **Rule** (行为约束)
5. 它只是原始执行数据、工具输出或事实观察？ → **Evidence** (governance_evidence_candidate)

如果一条候选不属于任何层 → 直接丢弃。宁可空数组，不要强行归类。

---

### Layer 1 — Memory (用户画像 User Profile)

**核心目的**: 构建用户的画像。他是谁？他偏好什么？他怎么工作？
Memory 是关于 PERSON 的，不是关于 code 的。它个性化 AI 的行为。

**应该提取:**
- 职业背景（工程师、设计师、PM、研究员...）
- 沟通偏好（简洁 vs 详细、中文 vs 英文、代码优先 vs 解释优先）
- 技术偏好（偏好语言、框架、工具、部署方式）
- 工作习惯（喜欢 PM2 不喜欢 Docker、喜欢直接回答、讨厌废话）
- 用户明确指令（"不要废话"、"给我路径没用"）

**严禁作为 Memory 提取:**
- 实现笔记 ("我们把端口改成了 8080") → Evidence
- 危机修复故事 ("Zod 验证失败了，我们通过...修好了") → Knowledge 或丢弃
- 工具/框架事实 ("Fastify 是 HTTP 框架") → Evidence

**质量门控**: "这条信息是否告诉我关于用户的一些事，帮助我下次更好地服务他？"
如果答案是否 → 不是 Memory。

**严格度 (strictness) 定义:**
- \`hard_rule\`: 用户明确表达、绝对遵守的偏好（如"不要废话"、"只用 TypeScript"）。下游召回时不可截断。
- \`soft_preference\`: 推断或隐含的倾向（如偏好简洁回答）。下游召回时可以按优先级截断。

GOOD: { "title": "用户沟通风格偏好", "content": "用户偏好简洁直接的回答，讨厌废话和过度格式化", "strictness": "hard_rule" }
GOOD: { "title": "用户技术栈偏好", "content": "用户偏好 PM2 部署而非 Docker，直接在本机启动 Node 服务", "strictness": "soft_preference" }
BAD: { "title": "Governance 验证需要默认值", "content": "..." } (实现细节，不是用户画像)
BAD: { "title": "MCP Zod catchall 静默剥离字段", "content": "..." } (技术事实，不是用户信息)

---

### Layer 2 — Knowledge (认知进化 Cognitive Evolution)

**核心目的**: 让 AI 更聪明。从经验中提炼能改善未来决策的洞察。
Knowledge 是 CURATED 的理解，不是事实堆砌。它随时间进化。

**应该提取:**
- 能防止未来犯错的非显然洞察
- 通过调试发现的架构模式或反模式
- 将多个事实综合为可行动智慧的理解
- 改变 AI 解决问题方式的领域知识

**严禁作为 Knowledge 提取:**
- 原始事实 ("X 用了 Y 框架", "Z 跑在端口 8080") → Evidence
- 一次性实现修复 → 丢弃或 Memory（如果揭示了用户偏好）
- 文档摘要 → Evidence

**质量门控**: "这个洞察是否会实质性地改变未来 AI 处理类似问题的方式？"
如果答案是否 → 不是 Knowledge，只是个事实 (→ Evidence)。

**避坑指南 (avoid_pitfall) 定义:**
基于该知识，未来必须避免的具体错误。必须写成 "IF [条件] THEN [后果]" 格式，禁止写成模糊的 "注意 X"。

GOOD: { "title": "Zod catchall 静默数据丢失陷阱", "content": "Zod catchall schemas 在 JSON-RPC 序列化时会静默剥离未声明的嵌套字段，导致下游收到空对象", "avoid_pitfall": "IF 定义 MCP tool schema THEN 必须使用 strict typed Zod schema，禁止使用 catchall 模式", "synthesis_reasoning": "从一次治理运行失败中追溯发现：必填字段验证失败 4 次，根因是 catchall 在传输层吞掉了嵌套对象" }
BAD: { "title": "Fastify 是 HTTP 框架", "content": "Fastify is the HTTP framework used by the memory service" } (原始事实 → Evidence)

---

### Layer 3 — Skill (流程封装 Workflow Encapsulation)

**核心目的**: 封装经验证的流程，让 AI 在类似场景下直接复用。
一个 Skill 节省了所有的探索成本 — 下次直接照着走。

**应该提取:**
- 经验证有效的多步骤流程
- 带有明确的**触发条件**: "当检测到 [场景 X] → 使用此流程"
- 参数化的步骤（禁止硬编码路径、PID、端口）

**严禁作为 Skill 提取:**
- 一次性命令 ("运行 npm install") → 不是流程
- 强制要求 ("必须验证 schema") → 这是 Rule
- 单步修复 → 不是工作流

**质量门控**: "这是一个经验证的多步骤流程吗？有明确的触发条件吗？未来的 AI 照着走能省时间吗？"
如果答案是否 → 不是 Skill。

**execution_steps 格式要求:**
必须是 String 数组，每个元素是一个不可再分的原子动作。禁止写成一段模糊描述。
BAD: "根据用户需求部署 Node 服务，注意版本兼容和配置优化"
GOOD: ["检查目标主机的 Node 版本兼容性", "生成 PM2 ecosystem.config.cjs", "写入 systemd service 配置实现自动重启", "验证 /healthz 端点返回 200"]

GOOD: { "title": "Node 服务部署流程", "content": "当用户要求部署 Node.js 服务到服务器时执行的标准化流程", "execution_steps": ["检查目标主机的 Node 版本兼容性", "生成 PM2 ecosystem.config.cjs", "写入 systemd service 配置实现自动重启", "验证 /healthz 端点返回 200"], "source_excerpt": "..." }
BAD: { "title": "重启服务", "content": "Run pm2 restart app" } (一个命令，不是流程)

---

### Layer 4 — Rule (行为约束 Behavioral Constraints)

**核心目的**: 强制执行行为边界。Rule 在执行前被检查，不是可选建议。
Rule 来自三个来源：
① 用户直接指令（"不要做X"、"必须做Y"）
② 经验中的重复模式（"每次做X都会出问题，所以必须..."）
③ 合规/质量要求（"代码必须通过 lint 才能合并"）

**应该提取:**
- 用户明确指令 AI 应该/不应该怎么做
- AI 应在相关操作前检查的约束
- project 级和 global 级的规则

**严禁作为 Rule 提取:**
- 一次性修复（"我们加了默认值来修复验证错误"） → 丢弃或 Knowledge
- 无执行力的观察（"用户似乎偏好..."） → Memory
- 事实（"Fastify 需要路由注册"） → Evidence

**质量门控**: "我会在相关操作前真的执行/检查这条规则吗？"
如果答案是否 → 不是 Rule。

**content 格式要求:**
Rule 的 content 必须能被翻译为 IF-ELSE 伪代码逻辑。禁止使用自然语言的模糊表述。
BAD: "定义 schema 的时候要好好检查字段完整性"
GOOD: "IF [定义 MCP tool schema] THEN MUST [显式声明所有期望字段]; MUST NOT [使用 catchall/looseObjectSchema]"

GOOD: { "title": "IF 用户表达不满 THEN MUST 切换为简洁模式", "content": "IF [用户说 '不要废话' 或对冗长输出表达不满] THEN MUST [给出简洁直接的回答]; MUST NOT [使用列表或过度格式化]", "rule_id": "UP_OVERRIDE_VERBOSE_MODE" }
BAD: { "title": "修复 Zod 验证", "content": "IF Zod 验证失败 THEN 必须加默认值" } (一次性修复，不是持续约束)

---

### Evidence (证据层: Supporting Material)

其他一切：原始事实、工具输出、执行日志、事实观察。
Evidence 支撑上面的层，但没有独立的召回价值。
Examples: "MCP 使用 stdio 传输", "项目使用 PostgreSQL", "构建耗时 3.2s"

---

### 变量剥离 (Variable Stripping — MANDATORY)
输出任何候选之前，替换: 本地路径→[USER_PATH], PID→[PID], 端口→[PORT], 时间戳→[TIMESTAMP], token/key→[SECRET], UUID→[UUID].

---

### 质量门控清单 (Quality Gate Checklist — per candidate)
- [ ] 它服务于该层的核心目的（用户画像 / 更聪明的AI / 经验证流程 / 可执行约束）？
- [ ] 未来处于相似场景的 AI 会觉得这有用？
- [ ] 所有临时值都已剥离？
- [ ] 通过了分类决策树？（没有归错层）
- [ ] content 中不含废话词汇？
如果任何一项为 NO → 丢弃或重新归类。`;

// ─── host_model_result JSON Schema ────────────────────────────────────

const HOST_MODEL_RESULT_SCHEMA = `## host_model_result Schema (REQUIRED for memory_run_full_governance)

你必须输出一段合法的 JSON。严禁包含 markdown 代码块标记。
严格按照以下 Schema 填写，每个字段都有明确的语义约束：

\`\`\`json
{
  "extraction_preview": {
    "rule_candidates": [
      {
        "candidate_type": "rule_candidate",
        "title": "IF [触发条件] THEN MUST/MUST NOT [行为约束]",
        "content": "完整的 IF-THEN 规则，可被翻译为 IF-ELSE 伪代码 (如: IF [定义 MCP tool schema] THEN MUST [显式声明所有字段]; MUST NOT [使用 catchall])",
        "rule_id": "UPPER_SNAKE_CASE 唯一标识 (如: FORBID_CATCHALL_SCHEMA, UP_OVERRIDE_VERBOSE_MODE)",
        "source_excerpt": "触发该规则的用户原话或观察",
        "source_kind": "user_message | assistant_message | command | tool | mcp",
        "source_timestamp": "ISO-8601 时间戳",
        "origin_scope": "session | project | workspace | user | team | global",
        "availability_scope": "session_only | project_reusable | workspace_reusable | user_reusable | team_reusable | global_reusable",
        "governance_level": "session | shared",
        "reason": "为什么需要这条规则（一句话，中文）",
        "confidence": "high | medium | low"
      }
    ],
    "memory_candidates": [
      {
        "candidate_type": "memory_candidate",
        "title": "用户画像事实 (如: 用户沟通风格偏好, 用户技术栈偏好)",
        "content": "用户的偏好、背景或工作习惯的完整描述（中文，可以较长）",
        "strictness": "hard_rule | soft_preference",
        "source_excerpt": "揭示该偏好的用户原话",
        "source_kind": "user_message | assistant_message | command | tool | mcp",
        "source_timestamp": "ISO-8601 时间戳",
        "origin_scope": "session | project | workspace | user",
        "availability_scope": "session_only | project_reusable | workspace_reusable | user_reusable",
        "governance_level": "session | shared",
        "reason": "该信息如何帮助个性化未来的交互（中文）",
        "confidence": "high | medium | low"
      }
    ],
    "knowledge_candidates": [
      {
        "candidate_type": "knowledge_candidate",
        "title": "认知洞察标题 (如: Zod catchall 静默数据丢失陷阱)",
        "content": "使 AI 更聪明的综合洞察（中文，包含因果推理）",
        "avoid_pitfall": "IF [条件] THEN [后果] — 基于该知识必须避免的具体错误（禁止写 '注意X'）",
        "synthesis_reasoning": "如何从原始观察中提炼出该洞察（中文）",
        "source_excerpt": "引发该洞察的关键观察原话",
        "source_kind": "user_message | assistant_message | command | tool | mcp",
        "source_timestamp": "ISO-8601 时间戳",
        "origin_scope": "session | project | workspace | user | team | global",
        "availability_scope": "session_only | project_reusable | workspace_reusable | user_reusable | team_reusable | global_reusable",
        "governance_level": "session | shared",
        "reason": "该洞察如何改变未来 AI 的行为（中文）",
        "confidence": "high | medium | low"
      }
    ],
    "skill_proposal_candidates": [
      {
        "candidate_type": "skill_proposal_candidate",
        "title": "流程名称 (动宾短语，如: Node 服务部署流程, 番茄小说章节生成流)",
        "content": "该流程的触发条件和使用场景描述（中文）",
        "execution_steps": [
          "1. 原子动作一（每个元素不可再分）",
          "2. 原子动作二",
          "3. 原子动作三"
        ],
        "source_excerpt": "该流程被验证过的场景原话",
        "source_kind": "user_message | assistant_message | command | tool | mcp",
        "source_timestamp": "ISO-8601 时间戳",
        "origin_scope": "session | project | workspace | user",
        "availability_scope": "session_only | project_reusable | workspace_reusable | user_reusable",
        "governance_level": "session | shared",
        "reason": "未来 AI 何时以及为何应遵循该流程（中文）",
        "confidence": "high | medium | low"
      }
    ],
    "governance_evidence_candidates": [
      {
        "candidate_type": "governance_evidence_candidate",
        "title": "证据标题",
        "content": "原始事实或观察",
        "source_excerpt": "来源",
        "source_kind": "user_message | assistant_message | command | tool | mcp",
        "source_timestamp": "ISO-8601 时间戳",
        "origin_scope": "session | project",
        "availability_scope": "session_only | project_reusable",
        "governance_level": "session",
        "reason": "该证据支撑了哪些上层候选",
        "confidence": "high | medium | low"
      }
    ]
  }
}
\`\`\`

**所有候选的必填字段:** candidate_type, title, origin_scope, availability_scope, governance_level, source_kind, source_timestamp, source_excerpt, reason, confidence.

**层特定必填字段:**
- rule_candidate: content (IF-THEN 格式), rule_id (UPPER_SNAKE_CASE)
- memory_candidate: content (画像描述), strictness (hard_rule | soft_preference)
- knowledge_candidate: content (洞察), avoid_pitfall (IF-THEN 避坑)
- skill_proposal_candidate: content (触发条件), execution_steps (String[])

**可选字段 (有默认值):** stability (stable), violation_behavior (warn), applies_to_phase ([review]), governance_action (create), promotion_status (candidate), memory_type (session_memory).`;
