# Current Session Governance Report

## 1. 范围说明

本报告针对当前这条长会话中，围绕以下主题形成的治理结果：

- host raw records 为什么没有进入治理链
- Codex / Claude Code 的统一 host capture 设计
- 治理输入范围应该如何定义
- `rule / memory / skill / knowledge` 四层如何从会话与执行记录中抽取
- 当前已落地的 Codex host capture preview / governance batch preview

说明：

1. 当前活跃线程尚未刷写进 `C:\Users\Administrator\.codex\session_index.jsonl`。
2. 因此这份报告不是“从落盘 jsonl 自动重放出的正式治理产物”，而是基于当前线程上下文进行的人工治理。
3. 同时参考了已经落地的 Codex host capture preview 能力，以及上一条已落盘线程 `019df330-e9df-7ef3-90bc-7c403ef1741e` 的真实 execution trace。

## 2. 本轮应进入 Rule 的内容

以下内容应进入 active `rule`，并按 `must / must_not` 处理：

### Rule 1

- 类型：`must`
- 标题：治理必须纳入 host 原始记录
- 规则：
  每次治理不能只基于已写入 `memory_v3` 的 candidate，必须把未治理会话和任务执行记录纳入治理输入池。
- 进入原因：
  这是当前治理链正确性的硬约束，不满足则治理结果天然失真。

### Rule 2

- 类型：`must`
- 标题：host 接入设计必须跨宿主统一
- 规则：
  host capture 不能只给 Codex 打补丁，必须按统一 contract 设计，至少覆盖 `Codex` 和 `Claude Code`。
- 进入原因：
  这是后续整套系统可热插拔、可移植的硬边界。

### Rule 3

- 类型：`must`
- 标题：治理设计遵循由浅入深、由表及里
- 规则：
  先收集表层原始记录，再做结构化中间对象，最后产出长期层；先抽“发生了什么”，再抽“说明了什么”。
- 进入原因：
  这是整个治理系统的上位设计原则。

### Rule 4

- 类型：`must`
- 标题：知识治理必须做合并和抽象提升
- 规则：
  `knowledge` 不能只是观点堆积或为了产出而产出，必须做去重、合并、冲突处理和抽象提升。
- 进入原因：
  这是用户明确指出的质量门槛，属于长期硬约束。

### Rule 5

- 类型：`must_not`
- 标题：不得把接入事实和测试残留直接当长期层
- 规则：
  不得把一次性接入成功、安装说明、测试 smoke 结果、重复 MCP 调用轨迹直接塞进 active `rule / memory / skill`。
- 进入原因：
  这是对当前失真问题的直接修正。

## 3. 本轮应进入 Memory 的内容

以下内容适合进入长期 `memory`：

### Memory 1

- 标题：本机 Codex 原始记录落盘位置
- 内容：
  当前机器的 Codex 会话与执行记录保存在：
  - `C:\Users\Administrator\.codex\session_index.jsonl`
  - `C:\Users\Administrator\.codex\sessions\2026\...\*.jsonl`
  - `C:\Users\Administrator\.codex\logs_2.sqlite`
- 进入原因：
  这是稳定环境事实，后续做 Codex host capture 时可直接复用。

### Memory 2

- 标题：当前阶段先落 Codex，再补 Claude Code
- 内容：
  用户已确认当前实现顺序为：先做 `Codex` host capture / governance input，再补 `Claude Code` adapter。
- 进入原因：
  这是当前阶段的执行决策，不是永久产品边界，但在当前项目阶段内稳定有效。

### Memory 3

- 标题：当前会话治理以线程全量输入为准
- 内容：
  用户明确要求每次治理应基于整段未治理会话、执行记录和已有长期层，而不是只看零散 candidate。
- 进入原因：
  这是对治理输入范围的长期设计决策，适合作为项目记忆。

## 4. 本轮应形成 Skill Proposal 的内容

以下内容不应直接改真实 `SKILL.md`，但应形成 `skill proposal`：

### Skill Proposal 1

- 目标 skill：`interview`
- 建议修改：
  当发现“理解偏差 / 新阶段 / 新宿主接入 / SPEC 边界变化 / 用户指出思路不对”时，必须更强制地重新触发 interview 和更新 SPEC。
- 原因：
  本轮多次暴露出“进入新设计层后，没有第一时间重新校准 SPEC”的问题。

### Skill Proposal 2

- 目标 skill：`memory-governance-guidelines`
- 建议修改：
  governance 运行前，必须检查治理输入是否完整，且报告要区分：
  - 机制跑通
  - 输入完整
  - 内容合格
- 原因：
  当前最大问题不是治理命令失败，而是输入池不完整导致结果没价值。

### Skill Proposal 3

- 目标 skill：`memory-ingestion-guidelines`
- 建议修改：
  在 ingestion 前先做四层归类判断，避免把接入事实、测试事实、一次性状态说明误写成长期 memory。
- 原因：
  本轮已经多次验证当前入口过宽。

### Skill Proposal 4

- 目标 skill：`memory-retrieval-guidelines`
- 建议修改：
  retrieval 侧要显式支持 host raw records -> normalized capture corpus -> governance batch input 这一层，而不是默认只围绕 resident/factual/procedural。
- 原因：
  否则会一直错把“已写入的东西”当成“完整上下文”。

## 5. 本轮应进入 Knowledge 的内容

以下内容是本轮真正有价值的 `knowledge`：

### Knowledge 1

- 标题：统一长期知识系统的治理输入必须包含宿主原始记录
- 内容：
  对于接入 `Codex`、`Claude Code` 等 host 的长期知识系统，治理输入不能只来自已有 `memory_candidate` 或人工写入对象，而必须统一纳入：
  - 未治理会话
  - 未治理执行轨迹
  - 新知识资料
  - 已有长期层
  - proposal / 审批记录
- 价值：
  这是本轮最核心的系统性结论。

### Knowledge 2

- 标题：Host Capture 是治理前置层，不是小功能
- 内容：
  `host capture` 不应被理解为读取某个本地日志文件的小功能，而是统一长期知识系统中的前置输入层。它负责把不同宿主的原始记录标准化成统一治理原料，再进入 `rule / memory / skill / knowledge` 的判定与合成。
- 价值：
  这定义了架构分层，而不是某个实现细节。

### Knowledge 3

- 标题：知识治理应从“观点提取”升级为“规律合成”
- 内容：
  高质量的 `knowledge` 不是把一堆相近说法逐条保留，而是从多个事实、多个来源、多个任务结果中判断：
  - 是重复
  - 是补充
  - 是冲突
  - 还是可以上提为更高一层规律
  最终保留的是规律对象和溯源链，而不是观点列表。
- 价值：
  这是本轮用户最明确强调的质量标准。

### Knowledge 4

- 标题：由浅入深、由表及里是治理与上下文装配的通用设计原则
- 内容：
  对 agent host 的会话和执行记录治理，应先抓表层显式记录，再上提为结构化中间对象，最后产出长期层；先识别表层事实，再提炼里层偏好、约束、技能和知识。这条原则不仅适用于当前 memory/knowledge 系统，也适用于未来的 host integration、rule layer 和上下文装配。
- 价值：
  这是跨模块的设计原则，应进入长期知识层。

## 6. 本轮只保留为 Evidence，不进入长期层的内容

以下内容本轮只应保留为 evidence / trace，不应直接晋升：

1. `Get-Content` 读取脚本、`package.json`、本地配置的单次命令
2. 单次 `memory_health` / `memory_retrieve_context` / `memory_ingest_candidate` / `memory_run_governance` 调用记录
3. `npm run verify:mcp-cli`、`verify:mcp-client-smoke`、`verify:mcp` 的逐条命令本身
4. 当前活跃线程中的大段 AGENTS 规则原文
5. 重复出现的 `memory_retrieve_context` MCP 调用

这些内容的价值是：

- 证明这次执行确实发生过
- 给治理提供溯源
- 供后续 knowledge synthesis 使用

但它们本身不是长期层最终对象。

## 7. 本轮治理后的问题与不足

本轮虽然已经把“整段会话治理”的边界说清了，但还没有完成正式入库闭环。

当前已完成：

1. `Codex host capture preview`
2. `Codex governance batch preview`
3. 真实 `.codex` 线程原料读取
4. fixture 自动验证

当前未完成：

1. 当前活跃线程自动刷入 `.codex` 后的正式增量扫描
2. `governance_batch` 的正式持久化
3. 用这批 batch 输入直接驱动正式 `rule / memory / skill proposal / knowledge` 入库
4. `Claude Code` adapter

## 8. 本轮验收结论

结论：

1. 机制层已经前进到“能抓真实线程原料，并能形成治理批次预览”。
2. 这次整段会话里，真正值得进入长期层的主要是：
   - 治理输入范围规则
   - host capture 上位架构
   - 知识治理的合并/抽象原则
   - 与 `interview / governance / ingestion / retrieval` 相关的 skill proposal
3. 单条命令、重复 MCP 调用和单次验证结果不应直接进入长期层。
4. 下一步不是再做更多 preview，而是把这批结果接入正式 `governance_batch -> long-term outputs` 闭环。
