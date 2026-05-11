# 从既往任务抽取的分层样例（2026-05-05）

这份不是把内容直接写入正式长期层，而是按我们当前已经定好的治理规则，从之前这批任务里抽取一些**样例产物**给你看。

目的只有一个：

- 看当前分层是否合理
- 看哪些该进 `rule`
- 哪些该进 `memory`
- 哪些只能是 `skill proposal`
- 哪些应该留在 `governance evidence`
- 哪些才配进 `knowledge`

---

## 1. Rule 样例

这些属于必须执行的硬规则，使用 `must / must_not` 表达，并且必须**直接对 agent 自身生效**。

### Rule 1

- 类型：`must`
- 标题：`rule 与 skill 的变更必须先汇报给人类确认`
- 内容：
  `Rule and skill changes must be summarized for human review before any real rule activation or SKILL.md modification.`
- 来源：
  - 你对 `skill` 与 `rule` 治理边界的多次确认
- 判断原因：
  - 是强约束
  - 直接约束 agent 后续动作

### Rule 2

- 类型：`must`
- 标题：`继续靠猜测会造成高返工风险时必须补 interview`
- 内容：
  `When ambiguity or drift is large enough that continuing by assumption would create expensive rework, interview must be retriggered before implementation continues.`
- 来源：
  - 你多次指出发现偏差时不应继续靠猜测推进
- 判断原因：
  - 是强约束
  - 直接约束 agent 后续动作

### Rule 3

- 类型：`must_not`
- 标题：`不能为了产出而产出`
- 内容：
  `Governance must not promote content into long-term layers unless long-term value is demonstrated.`
- 来源：
  - 你对“为了做 knowledge 而做 knowledge”的批评
- 判断原因：
  - 是治理总约束
  - 能直接约束后续产出数量与质量

---

## 2. Long-term Memory 样例

这些是个体化、系统内、长期稳定事实，不是外部知识。

### Memory 1

- 类型：`project_memory`
- 标题：`本机默认 workspace 路径`
- 内容：
  `On this machine, new shared projects default to D:\workspace\projects after user confirmation.`
- 来源：
  - 你明确指定当前机器路径规范
- 判断原因：
  - 机器相关
  - 长期稳定
  - 跨会话高概率重复使用

### Memory 2

- 类型：`project_memory`
- 标题：`本机默认输出目录`
- 内容：
  `On this machine, deliverables, distilled documents, and backups default to D:\workspace\outputs.`
- 来源：
  - 你明确指定 outputs 路径
- 判断原因：
  - 机器/项目组织事实
  - 属于长期可复用上下文

### Memory 3

- 类型：`user_preference_memory`
- 标题：`默认完整工程设计，不自动退化为 MVP`
- 内容：
  `By default, design work should be complete and engineering-grade, not automatically reduced to MVP or toy scope unless explicitly requested.`
- 来源：
  - 你多次强调“默认完整设计，按工程标准展开”
- 判断原因：
  - 这是用户长期偏好
  - 不属于知识

### Memory 4

- 类型：`design_decision_memory`
- 标题：`治理证据层只给治理读，不给日常问答读`
- 内容：
  `The governance evidence layer exists for governance-only inputs such as search results, uploaded knowledge, execution traces, success/failure reasons, and validation evidence. It is not part of normal answer-time context.`
- 来源：
  - 本轮架构定稿
- 判断原因：
  - 这是我们系统的本地设计决策
  - 应作为本地记忆，而不是外部知识

### Memory 5

- 类型：`design_decision_memory`
- 标题：`治理必须读取未治理会话与执行记录`
- 内容：
  `Governance input must include ungoverned conversations, execution traces, and governance evidence instead of relying only on previously written memory candidates.`
- 来源：
  - 你对治理输入范围的持续纠偏
- 判断原因：
  - 这是项目内部治理设计要求
  - 应通过系统实现来落实，而不是作为 agent rule 激活

---

## 3. Skill Proposal 样例

这些不是立即生效的 skill，而是“应该怎么改”的提案。

### Skill Proposal 1

- 目标 skill：`interview`
- 提案：
  `When sustained design drift, layering mismatch, or governance-boundary confusion is detected, interview must be retriggered before implementation continues.`
- 来源：
  - 你指出我发现理解偏差时没有及时重新调用 `interview`
- 为什么是 `skill proposal`
  - 这是方法改进
  - 不是当前直接生效的长期知识
  - 需要你确认后再改真实 skill

### Skill Proposal 2

- 目标 skill：`memory-governance-guidelines`
- 提案：
  `Memory governance should explicitly read ungoverned sessions, execution traces, governance evidence, and existing long-term layers before promoting outputs.`
- 来源：
  - 你对治理输入范围的纠偏
- 为什么是 `skill proposal`
  - 这是治理执行方法改进

### Skill Proposal 3

- 目标 skill：`memory-ingestion-guidelines`
- 提案：
  `Do not ingest verification traces, smoke-path conclusions, or session-specific internal rules as long-term knowledge or long-term memory unless they have proven durable value.`
- 来源：
  - 本轮清理历史污染时暴露的问题
- 为什么是 `skill proposal`
  - 它是写入规范的修订建议

---

## 4. Governance Evidence 样例

这些内容应该进入治理证据层，而不是直接进入长期层，也不参与日常回答。

### Evidence 1

- 类别：`search_result`
- 内容：
  我为了研究 memory / knowledge / graph / harness 这条路线，实际检索并导入的一批外部资料：
  - `GitHub Copilot memory`
  - `Mem0`
  - `OpenAI Agents SDK`
  - `LangChain / LangGraph`
  - `LlamaIndex`
  - `DeepEval`
  - `Pinecone / Qdrant`
  - `RAGFlow / FastGPT / DB-GPT`
  - `AgentScope / CrewAI / CAMEL / MetaGPT / ADK / Lagent`
- 为什么是治理证据：
  - 这些是治理原料
  - 不是最终长期层对象

### Evidence 2

- 类别：`execution_step`
- 内容：
  为接通 `memory-v3`，实际完成了：
  - `doctor`
  - `verify:mcp-cli`
  - `verify:mcp-client-smoke`
  - `verify:mcp`
  - host config 安装与真实调用验证
- 为什么是治理证据：
  - 它解释“我们怎么知道接通了”
  - 但不该长期留在 `knowledge`

### Evidence 3

- 类别：`failure_reason`
- 内容：
  之前治理结果偏差的直接原因：
  - 治理输入没有读完整会话与执行记录
  - `knowledge` 抽取把内部采纳决策混成了外部知识
- 为什么是治理证据：
  - 这是失败原因与复盘依据
  - 不是外部知识

### Evidence 4

- 类别：`success_reason`
- 内容：
  本轮治理修正成功的依据：
  - 历史脏 `knowledge` 已退役
  - host governance 不再从内部会话误产 `knowledge`
  - legacy synthesis 脚本已删除
- 为什么是治理证据：
  - 这是治理成效说明
  - 不应直接长期暴露成 `knowledge`

### Evidence 5

- 类别：`failure_reason`
- 内容：
  在真实执行中，本机工具或命令链路失败本身应保留为治理依据，例如：
  - `rg` / `ripgrep` 不可用
  - 命令权限失败
  - CLI 未安装
  - 路径或依赖错误
- 为什么是治理证据：
  - 这些问题反映执行环境与执行路径的真实边界
  - 它们不应进长期知识层，但必须作为治理和复盘输入被保留

---

## 5. Knowledge 样例

这里故意只放“更像外部通用知识”的样例，不混本地采纳决策。

### Knowledge 1

- 类型：`cross_source_pattern`
- 标题：
  `成熟知识平台正在收敛为知识库、工作流、Agent 和多源数据的一体化系统`
- 外部来源：
  - `RAGFlow`
  - `FastGPT`
  - `DB-GPT`
- 为什么能进 `knowledge`
  - 这是外部生态共性
  - 不是我们系统自己的偏好

### Knowledge 2

- 类型：`cross_source_pattern`
- 标题：
  `Agent 框架正在收敛到工具、记忆、工作流、多智能体和评估的一体化运行时`
- 外部来源：
  - `AgentScope`
  - `CrewAI`
  - `Google ADK`
  - `CAMEL`
  - `MetaGPT`
  - `Lagent`
- 为什么能进 `knowledge`
  - 这是外部框架共性
  - 不依赖本地项目

### Knowledge 3

- 类型：`boundary_condition`
- 标题：
  `图谱召回适合关系型问题，但不能替代证据治理和事实有效性判断`
- 外部来源：
  - `GraphRAG` 对比资料
  - 相关 memory / graph critique 资料
- 为什么能进 `knowledge`
  - 这是外部方法边界
  - 不是我们的本地硬规则本身

### Knowledge 4

- 类型：`boundary_condition`
- 标题：
  `图谱抽取不等于知识治理，chunk 内路径只能作为图谱候选`
- 外部来源：
  - `LlamaIndex Property Graph`
- 为什么能进 `knowledge`
  - 这是对外部技术能力边界的抽象

---

## 6. 当前我对分层质量的判断

如果按今天修正后的标准看：

- `rule` 样例：基本合理
- `memory` 样例：基本合理
- `skill proposal` 样例：合理
- `governance evidence` 样例：合理
- `knowledge` 样例：仍然需要继续收紧

`knowledge` 现在最大的问题已经不是“没来源”，而是：

- 有些条目是外部知识没错
- 但它们表达成了“我们应该怎样做”的本地采纳语气

这类后续应拆成：

1. 外部通用知识对象
2. 本地采纳后的 `memory/rule`

---

## 7. 用这批样例验证出的下一步

这批样例说明，当前最该继续做的不是再扩层，而是：

1. 给 `knowledge` synthesis 增加“外部知识表述”和“本地采纳表述”的区分
2. 把外部知识被我们采纳后的结果，单独路由到 `memory/rule`
3. 保持 `governance evidence` 只做治理输入，不进入日常回答层
