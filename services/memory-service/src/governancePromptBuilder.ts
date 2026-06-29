import {
  GOVERNANCE_SCOPE_BY_LAYER,
  VALID_KNOWLEDGE_TYPES,
} from "./hostCaptureGovernanceBatch.js";
import type { SummarizedSession } from "./sessionSummarizer.js";

// P0-d: layer-aware scope/level/type labels shared with the validation layer.
// Derived directly from spec 39 §5.4 (rule), §6.4 (skill), §7.5 (knowledge),
// §8.5 (memory) and §9 (evidence).
const RULE_ORIGIN_SCOPES = [...GOVERNANCE_SCOPE_BY_LAYER.rule_candidate.origin_scope].join(" | ");
const RULE_AVAILABILITY_SCOPES = [...GOVERNANCE_SCOPE_BY_LAYER.rule_candidate.availability_scope].join(" | ");
const RULE_GOVERNANCE_LEVELS = [...GOVERNANCE_SCOPE_BY_LAYER.rule_candidate.governance_level].join(" | ");

const MEMORY_ORIGIN_SCOPES = [...GOVERNANCE_SCOPE_BY_LAYER.memory_candidate.origin_scope].join(" | ");
const MEMORY_AVAILABILITY_SCOPES = [...GOVERNANCE_SCOPE_BY_LAYER.memory_candidate.availability_scope].join(" | ");
const MEMORY_GOVERNANCE_LEVELS = [...GOVERNANCE_SCOPE_BY_LAYER.memory_candidate.governance_level].join(" | ");

const KNOWLEDGE_ORIGIN_SCOPES = [...GOVERNANCE_SCOPE_BY_LAYER.knowledge_candidate.origin_scope].join(" | ");
const KNOWLEDGE_AVAILABILITY_SCOPES = [...GOVERNANCE_SCOPE_BY_LAYER.knowledge_candidate.availability_scope].join(" | ");
const KNOWLEDGE_GOVERNANCE_LEVELS = [...GOVERNANCE_SCOPE_BY_LAYER.knowledge_candidate.governance_level].join(" | ");

const SKILL_ORIGIN_SCOPES = [...GOVERNANCE_SCOPE_BY_LAYER.skill_proposal_candidate.origin_scope].join(" | ");
const SKILL_AVAILABILITY_SCOPES = [...GOVERNANCE_SCOPE_BY_LAYER.skill_proposal_candidate.availability_scope].join(" | ");
const SKILL_GOVERNANCE_LEVELS = [...GOVERNANCE_SCOPE_BY_LAYER.skill_proposal_candidate.governance_level].join(" | ");

const EVIDENCE_ORIGIN_SCOPES = [...GOVERNANCE_SCOPE_BY_LAYER.governance_evidence_candidate.origin_scope].join(" | ");
const EVIDENCE_AVAILABILITY_SCOPES = [...GOVERNANCE_SCOPE_BY_LAYER.governance_evidence_candidate.availability_scope].join(" | ");
const EVIDENCE_GOVERNANCE_LEVELS = [...GOVERNANCE_SCOPE_BY_LAYER.governance_evidence_candidate.governance_level].join(" | ");

const KNOWLEDGE_TYPES = [...VALID_KNOWLEDGE_TYPES].join(" | ");

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
    "- **作用域感知**：项目级 (origin_scope=project) 必须保留具体名词（路径、角色名、文件名）；全局级 (origin_scope=global) 必须剥离所有领域特定名词。严禁一刀切。",
    "- **ALL extracted content MUST be written in Chinese (中文).** This includes: title, content, reason, synthesis_reasoning, avoid_pitfall, proposed_text, current_gap, validation_method, rationale, description, applicable_scenarios, non_applicable_scenarios, execution_steps. Technical terms (library names, protocol names, code identifiers) can remain in English, but the surrounding sentence must be Chinese.",
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

### 语言要求 (Language Requirement — GLOBAL)
ALL extraction output MUST be in Chinese (中文). This is a hard requirement for ALL fields including: title, content, reason, synthesis_reasoning, avoid_pitfall, proposed_text, current_gap, validation_method, rationale, description, applicable_scenarios, non_applicable_scenarios, execution_steps, source_excerpt.
Technical terms (library names, protocol names, code identifiers) can remain in English, but the surrounding sentence structure must be Chinese.
GOOD: "Zod catchall 模式在 JSON-RPC 传输边界造成静默数据丢失"
BAD: "Zod catchall schemas silently strip undeclared fields during JSON-RPC serialization"
GOOD: "在用户要求部署 Node 服务时调用此技能"
BAD: "Invoke this skill when user asks to deploy Node service"

### 反废话约束 (Anti-Filler Constraint — GLOBAL)
严禁在 content / avoid_pitfall / synthesis_reasoning 中使用以下词汇：
"需要注意"、"妥善处理"、"尽量保证"、"适当考虑"、"建议关注"、"可以优化"、"值得注意"
替代方案：写出具体的 IF-THEN 条件、明确的动作和可验证的结果。
BAD: "在处理 MCP 工具时需要注意 schema 的兼容性"
GOOD: "IF MCP tool schema 使用 catchall 模式 THEN 嵌套字段会在 JSON-RPC 序列化时被静默剥离，导致下游收到空对象"

---

### §3 作用域感知协议 (Scope-Aware Protocol — MANDATORY)

每一条候选在通过分类决策树之后、写入之前，必须确定其 origin_scope 并遵守对应的作用域规则。
作用域决定了内容的**具体性等级**：项目级允许且鼓励保留具体名词，全局级必须剥离所有领域特定名词。

#### 作用域判定规则
1. 如果当前 session 绑定了 project_id → 默认 origin_scope = \`project\`
2. 如果当前 session 没有项目上下文 → 默认 origin_scope = \`user\`
3. 如果某条候选揭示了跨项目通用的逻辑缺陷 → 可主动升格为 \`global\`
4. **严禁**从 global 降级到 session 或 project

#### 项目级 (origin_scope = project) — 极致局部忠诚
项目级治理的任务是把当前项目的"血肉"固化下来，不是做哲学抽象。
- **必须保留**具体变量名、文件名、角色名、路径、端口号
- **必须保留**项目特定的设定值（如角色心跳数、特定文件名）
- execution_steps 中**允许且鼓励**出现具体操作对象（如"打开 坑.txt"、"核对江妄的心跳"）
- title 和 content 必须能让下一个 session 的 AI 直接定位到具体对象

GOOD (项目级): { "title": "视角角色江妄的生理常数一致性", "content": "在所有涉及紧张/战斗的描写中，江妄的心跳必须稳定在 60，这是其冷静疯批人设的核心物理表现" }
BAD (项目级): { "title": "角色生理状态一致性", "content": "视角角色的生理参数应保持一致" } (太抽象，丢失了项目血肉)

#### 全局级 (origin_scope = global) — 纯逻辑骨架
全局级治理必须剥离所有血肉，只保留可跨领域复用的逻辑骨架。
- **必须剥离**所有项目特定名词（角色名、文件名、路径、端口号）
- **必须使用**通用系统术语（如"待办追踪文件"替代"坑.txt"，"视角角色"替代具体角色名）
- execution_steps 必须用抽象逻辑术语（如"将悬置状态物化为持久化对象"）
- 判据：换一个完全不同的项目，这条还成立吗？

GOOD (全局级): { "title": "异步逻辑依赖追踪", "content": "将所有未闭环的逻辑承诺转化为持久化对象，并在任务完结前执行强制对齐" }
BAD (全局级): { "title": "坑.txt 同步规则", "content": "修改 1.txt 到 5.txt 时必须同步更新坑.txt" } (包含项目特定文件名)

#### 通用性审计 (Generalization Audit — per candidate)
在确定 origin_scope 后，必须执行以下校验：
- 如果 origin_scope = project 但 content 中没有任何项目特定名词 → 标记 promotion_status = "needs_review"（过度抽象，项目级应有血肉）
- 如果 origin_scope = global 但 content 中包含项目特定名词 → 标记 promotion_status = "needs_review"（抽象不足，全局级应剥离）
- 如果同一条信号同时具有项目级和全局级价值 → 拆分为两条候选：一条 project 级（带血肉），一条 global 级（纯骨架）

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

### §4.4 行为模式审计 (Behavioral Pattern Audit)

对 Session 中重复出现（≥2 次）的命令、报错或纠正动作，禁止将其视为琐碎事件丢弃。必须判断它是否代表一种规律：

1. **它是解决某类问题的必经之路吗？** → 升格为 **Skill** (SOP)。
   - 例：当发生 X 错误时，连续运行 A 和 B 命令可快速验证。
2. **它是用户明确或隐含的偏好吗？** → 升格为 **Memory** (Preference)。
   - 例：用户倾向于在每次 Commit 前手动运行全量验证。
3. **它是后续工作的必要前置条件吗？** → 升格为 **Rule** (Constraint)。
   - 例：MUST run verify:mcp before triggering governance。

**关键问题**: "如果同一个动作/命令出现了 2 次以上，它意味着什么？"
- 若为了解决问题 → Skill。
- 若是固定习惯 → Memory。
- 若是必要前提 → Rule。

---

### §4.5 复盘审计 (Retrospective Audit — Failure Mode Analysis)

针对本次任务中的所有【失败尝试】或【用户纠正】，必须执行以下复盘：

1. **统计频率**: 该错误是否在本次或历史 Session 中重复出现？
2. **定位根因**: 是事实错误（Memory）、流程错误（Skill）、还是违反了未成文的约束（Rule）？
3. **由具体到模式**: 不要记录"这里报错了"，要记录"为了避免此类报错，必须遵守什么规则"。

**四类故障模式分类:**
- **同一个地方的相同犯错 (Stubborn Error)**: 模型三次尝试修改 memory-service，三次都忘了先运行 npm run build。 → 产出 Rule: "修改 service 代码后 MUST 立即运行 npm run build"。
- **不同任务相同的地方犯错 (Structural Flaw)**: 任务 A 和 B 在涉及"写数据库"时都报同样权限错误。 → 更新 Memory 或产出 Skill: DB_ACCESS_PREFLIGHT。
- **同一个地方的不同犯错 (Unstable Point)**: 修改 governancePromptBuilder.ts 时，第一次 JSON 格式错，第二次 Token 超限，第三次逻辑冲突。 → 产出 Knowledge (limitation): 该组件属于高风险脆弱点，修改时需分段提交。
- **不同地方的不同犯错 (Random Noise)**: 无关联的随机错误。 → 触发 Step 0 克制门，直接 Discard。

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

### **Knowledge 致命约束 (FATAL CONSTRAINTS — HARD REJECTION)**

违反以下任何一条，该候选**严禁**进入 knowledge_candidates，必须降级为 memory_candidate 或丢弃。

1. **来源隔离 (Provenance Isolation)**:
   - 严禁将“本次对话中的讨论、计划、待办、Bug 修复过程或项目内部决策”直接抽成 Knowledge。
   - 判据：如果该条目的唯一证据是 User/Assistant 的对话内容，且不包含外部文档、论文、第三方工具文档或通用技术协议的引用，必须将其降级为 Memory 或 Discard。
   - *反例*：“我们决定把数据库连接字符串改掉” → Memory。
   - *反例*：“Zod 验证失败后我们加了默认值修好了” → Memory（项目内部修复记录）。
   - *正例*：“PostgreSQL 在处理 UUID 时存在 X 性能瓶颈（引用自 PG 官方文档 v16）” → Knowledge。

2. **有效半径判别 (Radius Check)**:
   - 在输出前强制自问：换一个项目，这条还成立吗？
   - 凡是包含本项目特定变量名（如 memory-service）、特定文件路径（如 .env, hostModelGovernanceAdapter.ts）、特定 UI 描述（如气泡+时间）、本机路径（如 C:\, /home/, 127.0.0.1）或环境特定配置（如端口号、连接字符串、token）的内容，严禁进入 Knowledge。
   - 这些内容即使看起来是“洞察”，也只会污染知识库，必须归入 Memory 或 Evidence。

3. **禁止“元讨论”知识化**:
   - 不要把“我们如何改进治理协议”、“我们应该加什么规则”、“这次重构要注意什么”抽成 Knowledge。
   - 这是项目内部的架构决策（Design Decision），属于 Memory 或 session-only Evidence。

### §7.2 Knowledge 增量加工要求 (Anti-Proxy-Search)

**Knowledge 的目标不是“保存搜索结果”。**

致命约束：严禁直接搬运搜索工具的原文。每一条 Knowledge 候选必须通过以下测试：

1. **加工测试**: 它是否结合了本次 Session 的具体失败/成功案例？
   - 及格：搜索结果说 Zod 有风险，Knowledge 必须结合我们本次“传输边界静默丢数据”的具体证据。
   - 不及格：只有搜索结果的陈述，没有本次 Session 的关联。
2. **去水测试**: 删掉那些通用的背景介绍，只保留对本项目或未来 Agent 执行有指导意义的核心结论。
3. **物理隔离**: 如果 source_excerpt 里只有搜索工具的输出（如 google_search_output），而没有 user_message 或 assistant_message 的分析，该 Knowledge 自动降级为 governance_evidence_candidate（只存不召回）。

**判据**: "这条 Knowledge 如果没有本次 Session 的具体证据，还能成立吗？"
- 如果能 → 它是通用搜索事实，降级为 Evidence。
- 如果不能 → 它是基于本次实践加工过的洞察，可以进入 Knowledge。

**应该提取:**
- 能防止未来犯错的非显然洞察
- 通过调试发现的架构模式或反模式
- 将多个事实综合为可行动智慧的理解
- 改变 AI 解决问题方式的领域知识

**严禁作为 Knowledge 提取:**
- 原始事实 ("X 用了 Y 框架", "Z 跑在端口 8080") → Evidence
- 一次性实现修复 → 丢弃或 Memory（如果揭示了用户偏好）
- 文档摘要 → Evidence
- 本次对话内部讨论 → Memory 或 Discard

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
- 参数化的步骤（全局级禁止硬编码路径、PID、端口；项目级允许保留具体文件名和路径）

**严禁作为 Skill 提取:**
- 一次性命令 ("运行 npm install") → 不是流程
- 强制要求 ("必须验证 schema") → 这是 Rule
- 单步修复 → 不是工作流

**质量门控**: "这是一个经验证的多步骤流程吗？有明确的触发条件吗？未来的 AI 照着走能省时间吗？"
如果答案是否 → 不是 Skill。

**execution_steps 格式要求 (SCOPE-AWARE):**
必须是 String 数组，每个元素是一个不可再分的原子动作。禁止写成一段模糊描述。
- **项目级 Skill** (origin_scope=project)：步骤中保留具体操作对象（文件名、角色名、路径），让下一个 session 的 AI 能直接执行
- **全局级 Skill** (origin_scope=global)：步骤中使用通用术语，剥离所有领域特定名词

BAD (项目级，过度抽象): "检查设定一致性" (太模糊，AI 不知道检查什么)
GOOD (项目级): ["打开 D-404次列车设定.txt", "核对反噬来源是否为欺诈系统衍生", "若不是，必须询问用户"]
BAD (全局级，不够抽象): ["打开 坑.txt", "核对江妄的心跳"]
GOOD (全局级): ["将悬置状态物化为持久化追踪对象", "在任务完结前执行待办对象库对齐", "输出未闭环项报告"]

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

### 变量剥离 (Variable Stripping — SCOPE-AWARE)
变量剥离规则现在由 origin_scope 决定，不再一刀切：

**仅当 origin_scope = global 时**，执行完整剥离：本地路径→[USER_PATH], PID→[PID], 端口→[PORT], 时间戳→[TIMESTAMP], token/key→[SECRET], UUID→[UUID].

**当 origin_scope = project 或 user 时**，保留具体路径、文件名、角色名、端口号等项目特定信息。这些是项目级治理的核心价值。仅剥离 token/key→[SECRET] 等安全敏感信息。

**当 origin_scope = session 时**，保留所有原始信息（仅剥离 token/key→[SECRET]）。

---

### 质量门控清单 (Quality Gate Checklist — per candidate)
- [ ] 它服务于该层的核心目的（用户画像 / 更聪明的AI / 经验证流程 / 可执行约束）？
- [ ] 未来处于相似场景的 AI 会觉得这有用？
- [ ] 通过了分类决策树？（没有归错层）
- [ ] content 中不含废话词汇？
- [ ] **通用性审计**：origin_scope 与内容具体性匹配？（project 级有血肉 / global 级已剥离）
- [ ] **安全审计**：token/key 等敏感信息已剥离？（所有作用域都必须执行）
- [ ] **作用域判定**：origin_scope 选择合理？（不能从 global 降级到 session/project）
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
        "origin_scope": "${RULE_ORIGIN_SCOPES}",
        "availability_scope": "${RULE_AVAILABILITY_SCOPES}",
        "governance_level": "${RULE_GOVERNANCE_LEVELS}",
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
        "origin_scope": "${MEMORY_ORIGIN_SCOPES}",
        "availability_scope": "${MEMORY_AVAILABILITY_SCOPES}",
        "governance_level": "${MEMORY_GOVERNANCE_LEVELS}",
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
        "knowledge_type": "${KNOWLEDGE_TYPES}",
        "source_excerpt": "引发该洞察的关键观察原话",
        "source_kind": "user_message | assistant_message | command | tool | mcp",
        "source_timestamp": "ISO-8601 时间戳",
        "origin_scope": "${KNOWLEDGE_ORIGIN_SCOPES}",
        "availability_scope": "${KNOWLEDGE_AVAILABILITY_SCOPES}",
        "governance_level": "${KNOWLEDGE_GOVERNANCE_LEVELS}",
        "reason": "该洞察如何改变未来 AI 的行为（中文）",
        "confidence": "high | medium | low"
      }
    ],
    "skill_proposal_candidates": [
      {
        "candidate_type": "skill_proposal_candidate",
        "title": "流程名称 (动宾短语，如: Node 服务部署流程, 番茄小说章节生成流)",
        "content": "该流程的触发条件和使用场景描述（中文）",
        "description": "技能描述：做什么 + 何时触发。格式：'做 X。在 Y 发生时或用户要求 Z 时调用。'（中文）",
        "applicable_scenarios": [
          "适用场景一：具体描述何时应该使用此技能（中文）",
          "适用场景二：另一个适用场景（中文）"
        ],
        "non_applicable_scenarios": [
          "非适用场景一：具体描述何时不应该使用此技能（中文）",
          "非适用场景二：另一个非适用场景（中文）"
        ],
        "execution_steps": [
          "1. 原子动作一（每个元素不可再分，中文）",
          "2. 原子动作二（中文）",
          "3. 原子动作三（中文）"
        ],
        "validation_method": "如何验证此技能正确执行（中文）",
        "source_excerpt": "该流程被验证过的场景原话",
        "source_kind": "user_message | assistant_message | command | tool | mcp",
        "source_timestamp": "ISO-8601 时间戳",
        "origin_scope": "${SKILL_ORIGIN_SCOPES}",
        "availability_scope": "${SKILL_AVAILABILITY_SCOPES}",
        "governance_level": "${SKILL_GOVERNANCE_LEVELS}",
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
        "origin_scope": "${EVIDENCE_ORIGIN_SCOPES}",
        "availability_scope": "${EVIDENCE_AVAILABILITY_SCOPES}",
        "governance_level": "${EVIDENCE_GOVERNANCE_LEVELS}",
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
- skill_proposal_candidate: content (触发条件), description (技能描述), applicable_scenarios (String[]), non_applicable_scenarios (String[]), execution_steps (String[]), validation_method (验证方法)

**可选字段 (有默认值):** stability (stable), violation_behavior (warn), applies_to_phase ([review]), governance_action (create), promotion_status (candidate), memory_type (session_memory).`;
