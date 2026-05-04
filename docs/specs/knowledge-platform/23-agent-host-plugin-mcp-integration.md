# Agent 宿主插件/MCP 接入设计

## 1. 目标

把当前长期知识/记忆系统通过统一 MCP server 接入各类 agent 宿主，包括：

- Codex
- Claude Code
- Claude Desktop
- OpenClaw
- OpenCode
- 其他支持 MCP stdio 的 agent/client

本设计的目标不是只让本机跑通一次，而是形成可复用、可发布、可诊断、可热插拔的接入层。

## 2. 非目标

- 不把每个宿主都做成独立后端服务。
- 不绕过 MCP 协议直接侵入宿主内部。
- 不在未获得用户初次授权时修改用户全局配置文件。
- 不在本阶段实现在线 graph search 对照。

## 3. 总体路线

以 `@super-agent/memory-mcp` 作为唯一稳定协议入口。

宿主差异只放在 client adapter/template 层：

- MCP server 本体：`memory-mcp start`
- 本地配置：`.memory-mcp/config.json`
- 宿主模板：`.memory-mcp/clients/*`
- 诊断入口：`memory-mcp doctor`
- 发布形态：npm tarball / npm package / 本地 workspace package

## 4. 宿主接入矩阵

| 宿主 | 推荐接入 | 配置形态 | 当前策略 |
| --- | --- | --- | --- |
| Codex | MCP stdio | `~/.codex/config.toml` 的 `[mcp_servers.<name>]` | 生成 TOML 片段，不直接改全局文件 |
| Claude Code | MCP stdio | 项目 `.mcp.json` 或 `claude mcp add` | 生成 `.mcp.json` 和 CLI 命令 |
| Claude Desktop | MCP stdio | `claude_desktop_config.json` | 生成 JSON 片段 |
| OpenCode | MCP local | `opencode.json` 的 `mcp` | 生成 `opencode.jsonc` 片段 |
| OpenClaw | MCP registry | `openclaw mcp set <name> <json>` | 生成命令说明和 JSON |
| Generic MCP | MCP stdio | `mcpServers` JSON | 生成通用模板 |

## 5. 接入契约

统一 MCP server 暴露：

- `memory_health`
- `memory_query_layer`
- `memory_retrieve_context`
- `memory_ingest_candidate`
- `memory_run_governance`
- `memory://health`
- `memory://defaults`

关键约束：

- `memory-service` 必须先运行。
- 当前 beta 是 single-tenant：`tenant-local / memory.validation`。
- `memory_retrieve_context` 必须显式传 `fingerprint_status`。
- procedural memory 需要 `fingerprint_status=matched`。
- stdout 只允许 MCP 协议，诊断日志走 stderr 或 doctor。

## 6. 插件层设计

“插件”不直接替代 MCP，而是给宿主补两类能力：

1. 安装与配置能力：生成对应宿主的配置片段、命令和说明。
2. 使用规范能力：告诉宿主什么时候读 memory、什么时候写候选、什么时候治理。

因此第一阶段插件层产物是模板和说明：

- `codex-config.toml`
- `claude-code-project.mcp.json`
- `claude-desktop.json`
- `opencode.jsonc`
- `openclaw-mcp-set.md`
- `generic-mcp.json`
- `usage-instructions.md`
- `agent-memory-policy.md`
- `codex-AGENTS-snippet.md`
- `claude-CLAUDE-snippet.md`
- `opencode-instructions-snippet.md`
- `openclaw-skill-snippet.md`

后续如果某个宿主有正式 plugin SDK，再把这些模板封装成该宿主原生插件。

## 7. 原有记忆系统对接

MCP 接入只解决“工具可见”，不解决“宿主一定会读上下文”。

要让各宿主真正接入原有记忆系统，必须同时满足三层：

### 7.1 协议层

宿主能看到 `memory-v3` MCP server，并能调用：

- `memory_health`
- `memory_retrieve_context`
- `memory_ingest_candidate`
- `memory_run_governance`

### 7.2 策略层

宿主的 agent rules / skill / instructions 必须写明：

- 任务开始前何时读取 memory。
- 读取时如何传 `fingerprint_status`。
- 读取结果如何并入当前任务上下文。
- 什么内容完成后要写回候选记忆。
- 治理只在人工要求或阶段性 checkpoint 触发。

### 7.3 上下文装配层

`memory_retrieve_context` 返回的是结构化上下文，不是自动注入系统 prompt。

宿主必须把结果当作“参考上下文”使用：

- `resident_snapshot`：长期稳定环境/用户/项目背景。
- `conversation_summary`：历史对话摘要。
- `factual_memory`：稳定事实、约束、设计决策。
- `procedural_memory`：可复用流程/skill，只有 fingerprint matched 才能执行性采纳。

如果宿主没有这层 instructions，即使 MCP 连接成功，也很可能不会主动读取或不会正确使用。

## 8. 访谈确认的接入策略

### 8.1 安装器写入策略

安装器后续允许直接写入宿主配置，但必须满足：

- 初次加入某个宿主时，必须向用户索要授权。
- 写入前必须备份原配置。
- 写入时应保留用户已有配置，不覆盖无关内容。
- 写入后必须能验证 MCP 是否可见、doctor 是否通过。
- 不采用“静默写入且无备份”的方式。

### 8.2 读取策略

读取策略不是简单每轮都读，而是：

- 如果当前任务上下文中已经存在本轮有效的 memory bundle，可以不重复读取。
- 如果当前已有上下文无法覆盖本次设计/实现所需背景，必须触发读取。
- 设计、接入、架构、治理、调试、评测、跨模块实现、skill/MCP/plugin 改动默认属于需要读取的任务。
- 普通问题按需读取：只有当当前上下文不足、涉及用户长期偏好/项目背景/历史决策/已有知识、或用户显式要求使用 memory 时才读取。
- memory 不可用时降级继续，但必须说明处于 degraded mode。

### 8.3 写入策略

写入口子必须保留并默认可用：

- verified 设计决策。
- verified 修复。
- 失败模式。
- 环境约束。
- 用户正向/否决偏好。
- 可复用流程。
- skill 候选。
- 运行中发现的重要事实。

用户显式要求“记住/写入/沉淀”时必须支持。

### 8.4 治理触发策略

治理入口必须保留：

- 用户显式触发。
- 阶段性 checkpoint。
- 多条候选积累后。
- resident/index/lifecycle 明显需要刷新时。

默认不在每个小任务后自动治理，避免 token 和模型调用浪费。

### 8.5 第一阶段宿主优先级

第一阶段只做 Codex 和 Claude Code 的自动写入/备份/验证闭环：

- Codex：写入或提示合并 `~/.codex/config.toml`、`AGENTS.md` 规则片段和本地 skill 使用策略。
- Claude Code：写入或提示合并项目 `.mcp.json`、`CLAUDE.md` 规则片段。

OpenCode、OpenClaw、Claude Desktop、Generic MCP 第一阶段保持模板和手动说明，等 Codex/Claude Code 跑稳后再扩展自动写入。

### 8.6 变更同步原则

治理层发现需要修改 rule、skill、host instructions 或用户长期偏好时，不允许直接静默写入：

- 先生成变更 proposal，包含变更原因、影响范围、来源证据、风险等级和建议落点。
- 汇总给人类确认。
- 用户确认后，才允许写入 MCP 数据库或宿主本地文件。
- 用户拒绝后，记录拒绝偏好，后续治理不得重复提出同一类无效变更。

知识层 synthesized knowledge 可以按治理策略直接生效；rule 和 skill 属于会改变 agent 行为的执行资产，必须走确认。

## 9. 分层记忆与上下文装配问题

当前系统不是单一 memory 层，而至少包含：

- 知识库原始层：原始/清洗后的 markdown、document、evidence，用于溯源和必要时展开。
- 规律抽取层：治理后形成的 synthesized knowledge、规则、跨来源结论，是知识召回的主要产物。
- 记忆层：用户画像、项目事实、历史设计决策、环境约束、偏好、conversation/resident。
- 规则层：必须严格执行的约束、流程门禁、任务阶段规则、宿主/项目/安全边界，不同任务和步骤可有不同规则。
- skill 层：可复用流程、执行规范、工具经验、编码/设计/治理类技能。

已确认设计决策：

- 默认按任务类型分级召回：设计任务偏 knowledge + memory + rules，执行任务偏 memory + skill + rules，治理/接入/高风险任务读取更完整层，溯源任务再展开原始层，不采用所有层每次全量读取。
- 已有 memory bundle 是否有效使用 `query_hash + layer_versions` 判断；任务变更或任一关键层版本变化时刷新。
- 上下文优先级为：当前用户指令和任务目标 > 规则层 > 任务必要记忆 > 当前步骤 skill/procedural > 规律抽取层 > 证据索引 > 原始层。
- 只有证据不足、用户要求溯源、或回答/设计需要展开时，才读取原始 markdown/evidence。
- skill 层如果 fingerprint matched，可作为执行性流程；否则只作为参考。
- skill 治理结果应落回宿主原生 skill，但要和 MCP procedural memory 结合，二者不是互斥关系。
- knowledge 层负责“知识和规律”，memory 层负责“用户/项目/环境/历史事实”，rule 层负责“必须执行”，skill 层负责“怎么做”。
- 同一条信息的归类按执行语义决定：必须执行的是 rule，可复用步骤是 skill/procedural，长期事实和偏好是 memory，跨来源抽象结论是 knowledge，原始出处和证据留在 evidence/raw 层。

## 10. 上下文装配、遗忘曲线与压缩原则

### 10.1 基本问题

宿主上下文不是无限的，且模型存在注意力遗忘曲线：

- 靠前内容容易被后续内容淹没。
- 中间长上下文容易被忽略。
- 末尾内容影响最近输出最大。
- 重复、噪声、长原文会挤占真正关键规则和当前任务信息。

因此上下文装配不能简单“召回多少塞多少”，必须按注意力和 token 预算设计。

### 10.2 装配优先级

上下文应按以下优先级装配：

1. 当前用户指令和当前任务目标。
2. 规则层：必须严格执行的规则、禁令、门禁、阶段要求。
3. 当前任务所需的最小 memory：用户偏好、项目约束、环境约束、近期决策。
4. 当前任务所需的 skill/procedural：只放当前步骤要用的流程，不放全量 skill。
5. 规律抽取层：与当前任务直接相关的 synthesized knowledge。
6. 证据摘要：只放证据标题、来源、关键片段。
7. 原始层：只有需要溯源、审查、证明或细节展开时再读取。

规则层必须优先于普通记忆层。普通记忆可以作为参考，规则层必须执行。

### 10.3 遗忘曲线布置原则

为降低注意力遗忘：

- 关键规则放在靠前的“执行约束区”。
- 当前任务目标和下一步行动放在靠后的“当前任务区”。
- 中间放可压缩的背景、历史和证据摘要。
- 长原文不要直接放中间；用引用和 evidence id 占位，需要时再展开。
- 对特别关键的规则，可在上下文尾部用短句再次重申。

推荐上下文结构：

1. `Execution Rules`：必须执行的规则层。
2. `Task Goal`：当前任务目标。
3. `Relevant Memory`：最小必要记忆。
4. `Relevant Skills`：当前步骤相关 skill。
5. `Synthesized Knowledge`：规律抽取层。
6. `Evidence Index`：证据索引，不展开全文。
7. `Current Step Reminder`：下一步行动和关键禁令。

### 10.4 Token 满时的压缩原则

当上下文 token 接近预算上限时，按以下顺序压缩：

1. 删除无关层：与当前任务无关的历史、候选、旧 evidence。
2. 原文转引用：原始 markdown/evidence 只保留 source id、标题、关键句。
3. 多条同类事实归并为规则或结论。
4. 低置信、过时、冲突未解决内容移出当前上下文，只保留 warning。
5. skill 只保留入口、适用条件和当前步骤，不放完整 skill 文档。
6. memory 保留稳定偏好和硬约束，压缩叙事型历史。
7. 保留规则层全文或最小可执行表达，不允许把 must-follow 规则压没。

压缩后的内容必须保留：

- 来源引用。
- 适用边界。
- 冲突/不确定性提示。
- 是否为规则、记忆、知识、skill、证据。

### 10.5 分层预算建议

默认 token 预算采用“硬阈值 + 分层比例”，避免不同宿主上下文大小差异导致规则被挤掉。

默认硬阈值：

- `context_budget_tokens` 未传时按 `12000` 估算。
- 低上下文宿主建议 `4000`。
- 中等上下文宿主建议 `12000`。
- 大上下文宿主建议 `24000`。
- 超过 `24000` 不默认继续扩大，除非宿主显式声明可用预算；长原文仍然只通过 evidence/raw 按需展开。

压缩水位：

- 超过预算 `70%`：启用 `light` 压缩，合并重复 memory 和 skill。
- 超过预算 `85%`：启用 `aggressive` 压缩，只保留规则、关键记忆、skill 入口、knowledge 结论和 evidence id。
- 超过预算 `95%`：启用 `evidence_only`，原文和长证据全部转为引用，必须保留规则层和当前任务目标。

默认 token 预算按比例分配，而不是固定长度：

- 规则层：优先保留，约 10%-20%。
- 当前任务和用户输入：优先保留，约 20%-30%。
- 记忆层：约 10%-20%。
- skill 层：约 10%-20%。
- 规律抽取层：约 10%-20%。
- 证据索引/原始层：默认 0%-15%，按需展开。

如果任务是治理或知识审查，规律抽取层和证据层预算上调。

如果任务是代码执行，skill 层和规则层预算上调。

如果任务是新设计，规则层、记忆层、规律抽取层预算上调。

### 10.6 需要实现的接口能力

后续上下文装配接口应支持：

- `task_type`：design / execution / debugging / governance / review / ingestion / integration / answer。
- `context_budget_tokens`：宿主可用预算。
- `existing_bundle_id`：当前上下文已有 bundle。
- `existing_query_hash`：当前任务 query hash。
- `layer_versions`：knowledge / memory / rule / skill / evidence 版本。
- `required_layers`：强制读取层。
- `forbidden_layers`：禁止展开层。
- `compression_mode`：none / light / aggressive / evidence_only。
- `attention_layout`：front_rules_tail_reminder 等布局策略。

### 10.7 召回触发工程规则

宿主侧 instructions 应采用以下默认触发规则：

- 新任务开始时，如果任务类型是 design / execution / debugging / governance / review / ingestion / integration，先检查当前上下文是否已有有效 bundle；没有则读取。
- 普通 answer 任务默认不强制读；当问题涉及项目历史、用户偏好、已有知识、长期规则、之前失败经验或当前上下文明显不足时读取。
- 当前任务跨越新的架构边界、插件/MCP 接入边界、治理边界或安全边界时，即使已有 bundle 也要重新计算 `query_hash` 并检查 `layer_versions`。
- 同一轮任务中，只有 `query_hash + layer_versions` 不变时才复用 bundle。

## 11. 规则层生成与执行

### 11.1 规则层来源

规则层采用本系统自定义规则模型，不强依赖某个宿主原生规则格式。宿主只需要拿到本系统输出的规则上下文并执行。

规则层不只来自人工手写，也允许治理层生成提案。

采用策略：

- 人工明确规则可直接进入规则层。
- 治理层从记忆、知识、失败案例、用户偏好、执行经验中发现“应严格执行”的内容时，生成 rule proposal。
- rule proposal 必须经用户确认或项目授权流程批准后生效。
- 未确认的规则提案不能作为 must-follow 规则执行。

### 11.2 规则层按任务类型拆分

规则必须分任务类型召回，不允许所有规则每次全量进入上下文。

至少区分：

- design：设计规则。
- execution：编码/执行规则。
- debugging：调试规则。
- governance：记忆/知识/skill 治理规则。
- integration：MCP/plugin/宿主接入规则。
- review：审查/评测规则。
- ingestion：知识/文档/记忆写入规则。

每条规则应带：

- `rule_key`
- `task_types`
- `enforcement`
- `failure_behavior`
- `priority`
- `source`
- `version`
- `status`

### 11.3 规则执行失败处理

规则层内部必须声明失败行为，而不是由宿主临时猜。

支持：

- `block_and_report`：无法继续时停止执行并反馈用户。
- `ask_user`：需要用户确认后继续。
- `warn_and_continue`：提示风险但允许继续。
- `defer_to_current_evidence`：当前代码/事实证据优先。

如果遇到无法越过的问题，必须反馈给用户，不能擅自绕过规则。

规则层是 must-follow 执行边界，不是普通 memory；普通 memory 可以被当前证据覆盖，规则只能按自身失败策略处理。

### 11.4 规则层落地形态

规则的权威来源是 MCP 数据库中的 rule layer。

宿主本地文件只作为启动约束和触发说明，不作为完整规则数据库：

- `AGENTS.md` / `CLAUDE.md` 写入“必须读取并执行 rule layer”的基础规则。
- 具体规则通过 `memory_retrieve_context` 返回。
- 宿主不需要兼容本系统内部规则存储，只需要按返回的 context package 执行。
- 如果某条规则需要长期固化到宿主本地文件，必须先走 proposal 和人工确认。

### 11.5 治理模型接口是否固定

治理接口需要固定稳定外壳，但不要固定内部模型实现。

固定外壳的意义：

- Codex、Claude Code、OpenClaw、OpenCode、自研后端都能接同一套输入输出。
- 治理结果可测试、可回放、可审计。
- 后续替换 DeepSeek、OpenAI、本地模型或人工治理时，不改业务层。

不固定内部实现的意义：

- 不绑定某个模型供应商。
- 允许规则治理、skill 治理、知识治理采用不同模型或 agent。
- 允许先由 Codex/Claude Code 直接充当治理模型，后续再接独立大模型服务。

因此采用稳定 schema + pluggable executor：

- 输入固定：`governance_task`、`target_layers`、`candidate_items`、`existing_assets`、`evidence_refs`、`risk_policy`、`budget`。
- 输出固定：`proposals`、`accepted_knowledge`、`conflicts`、`rule_changes`、`skill_changes`、`memory_changes`、`discarded_items`、`audit_log`。
- 执行器可替换：`codex_agent`、`claude_agent`、`llm_api`、`local_model`、`manual_review`。
- rule/skill 变更输出只能是 proposal，不能直接静默生效。

### 11.6 用户可扩展规则与 Skill

本系统必须支持用户自定义 rule、skill，并把它们绑定到指定任务中。

核心对象：

- `extension_pack`：一组可安装、可启用/禁用、可导出共享的 rule、skill、binding。
- `task_binding`：定义某类任务、某个宿主、某个项目或某组条件下应加载哪些 rule/skill。
- `rule_checkpoint`：rule 对执行过程的检查点，例如 before/after/verify/handoff。
- `rule_gate`：高风险操作的可阻断门禁，例如写宿主配置、修改 rule/skill、删除数据、治理生效。

用户创建流程：

1. 用户提交 rule/skill/pack 定义。
2. 系统做 schema 校验、冲突检查、风险分类。
3. 普通 skill 可以进入 inactive/draft 状态。
4. rule 和 task binding 默认生成 proposal，用户确认后才 active。
5. active 后进入 registry，被任务匹配器召回。

任务运行流程：

1. 识别 `task_type`、host、project、scope、operation intent。
2. 读取 active `task_binding`。
3. 匹配对应 rules 和 skills。
4. rules 进入 `Execution Rules` 和 `rule_checklist`。
5. skills 进入 `Relevant Skills`。
6. 如果执行触发 `rule_gate.operation`，必须先通过 gate。
7. 执行后写入 `rule_gate_audit`，记录遵守、跳过、阻断或人工确认。

热插拔要求：

- rule、binding、extension pack 的 `status` 必须在每次 retrieve/gate check 时读取，不允许长时间缓存成固定 prompt。
- 启用 pack 后，下一次 `memory_retrieve_context` 和 `rule_gate_check` 必须能匹配新规则。
- 禁用 pack/binding 后，下一次 `rule_gate_check` 必须不再触发对应 checkpoint。
- `layer_versions` 必须包含 rule、task binding、rule checkpoint、extension pack 的版本/数量信息，用于判断已有 context bundle 是否失效。

rule 与 skill 的区别：

- skill 是执行流程，可被参考或调用。
- rule 是执行约束，必须根据 `enforcement_level` 和 `failure_behavior` 处理。
- skill 可以指导“怎么做”；rule 可以阻断“不能这样做”。
- skill 变更影响流程质量；rule 变更影响执行边界，所以 rule 变更必须更严格。

推荐 rule 契约：

```yaml
rule_key: require-config-backup
task_types: [integration, execution]
enforcement: must
failure_behavior: block_and_report
trigger:
  operation: write_host_config
checkpoints:
  before:
    - backup_existing_config
  after:
    - verify_mcp_visible
evidence_required:
  - backup_file_path
  - doctor_result
```

推荐 binding 契约：

```yaml
binding_key: mcp-integration-default
task_types: [integration, debugging]
hosts: [codex, claude_code]
rules:
  - require-config-backup
  - report-degraded-mode
skills:
  - memory-retrieval
  - mcp-doctor-debug
```

约束：

- 不允许用户自定义 rule 绕过系统级安全规则。
- 低优先级 pack 不能覆盖高优先级 rule，只能生成冲突 proposal。
- rule/skill/binding 都必须有来源、版本、状态和审计记录。
- 禁止只把 rule 当 prompt 文本塞入上下文，关键 rule 必须有 checkpoint/gate。

### 11.7 Rule Enforcement 等级

rule 的强制力分级：

1. `prompt_rule`：仅进入上下文，适合低风险偏好。
2. `checklist_rule`：进入执行 checklist，要求执行前/后显式确认。
3. `verifier_rule`：必须运行验证命令或检查函数。
4. `tool_gate_rule`：必须通过系统工具门禁，高风险操作可被阻断。
5. `human_approval_rule`：必须生成 proposal 或请求用户确认后才允许继续。

默认策略：

- 普通偏好用 `prompt_rule` 或 `checklist_rule`。
- 配置写入、规则变更、skill 变更、治理生效、删除数据用 `tool_gate_rule` 或 `human_approval_rule`。
- 无法程序化验证的规则必须至少进入 checklist 和 audit log。
- gate 失败时按 rule 的 `failure_behavior` 执行，不允许 agent 自行降级。

### 11.8 节点检查接口

高风险操作前必须调用节点检查接口，而不是只依赖 agent 自觉：

```text
rule_gate_check(task_request_id, task_type, host, operation, evidence)
```

接口职责：

- 根据当前 active `task_binding` 找到适用 rule。
- 根据 `operation` 找到适用 `rule_checkpoint`。
- 检查 `evidence_required` 是否满足。
- 返回 `allow / warn / ask_user / block`。
- 写入 `rule_gate_audit`。

典型操作：

- `write_host_config`
- `sync_skill_to_host`
- `activate_rule`
- `approve_governance_change`
- `delete_memory_or_knowledge`

如果返回 `block`，宿主不得继续执行该操作；如果返回 `ask_user`，必须先获得用户确认。

## 12. 工程化评测标准

接入层、记忆层、规则层和治理层必须按工程指标评测，而不是只看一次 demo。

### 12.1 接入层评测

- `memory-mcp init` 模板完整率：Codex、Claude Code、Claude Desktop、OpenCode、OpenClaw、Generic MCP 全部生成。
- `memory-mcp doctor` 诊断准确率：配置缺失、service 不通、工具不可见、fingerprint 契约错误能给出明确原因。
- Codex / Claude Code 自动写入安全性：首次授权、备份、保留已有配置、写入后可验证。
- 降级行为：memory 不可用时主任务不中断，并明确 degraded mode。

### 12.2 召回与上下文装配评测

- 触发正确率：该读时能读，普通问题不无谓读取。
- 重复读取率：同一 `query_hash + layer_versions` 下不重复装配。
- 分层命中率：design / execution / debugging / governance / integration 能拿到对应层。
- 规则保留率：压缩后 must-follow rule 不丢失。
- 溯源完整率：knowledge / memory / skill 结论能回到 evidence 或来源。
- Token 控制：不同预算下能进入对应压缩模式，不超预算。

### 12.3 规则与执行评测

- 规则遵守率：规则层返回的 must-follow 条目在后续执行中被显式遵守。
- 失败处理正确率：`block_and_report`、`ask_user`、`warn_and_continue` 等行为符合规则声明。
- 任务类型过滤正确率：不同任务只召回相关规则，不全量污染上下文。
- 冲突处理：rule 与 memory/knowledge 冲突时 rule 优先，并产生可审计记录。

### 12.4 治理层评测

- Proposal 准确率：rule/skill 变更建议应有来源证据、风险说明和合理落点。
- 误合并率：低关联知识不能强行合并。
- 孤岛保留率：确实无关的信息允许保持孤岛。
- 增量治理有效性：新知识能与已有 synthesized knowledge 做匹配、替换、补充或保留。
- 人工确认链路：rule/skill 变更在确认前不生效，确认后可追踪。

### 12.5 端到端评测

- Codex 真实任务：设计、编码、调试、接入各一组。
- Claude Code 真实任务：项目读取、修改建议、执行约束各一组。
- 记忆写入闭环：任务完成后写入候选，治理后能被后续任务召回。
- 热插拔能力：同一 MCP server 和同一治理 schema 能换宿主运行。
- 回归测试：旧 `memory_retrieve_context` 调用不被新增字段破坏。

## 13. 验收标准

- `memory-mcp init` 能生成所有宿主模板。
- `memory-mcp doctor` 能验证 config、memory-service、MCP tools/resources。
- `verify:mcp-cli` 覆盖新增模板。
- `verify:mcp-pack` 确认打包产物包含模板、README 和 CLI。
- Codex/Claude/OpenCode/OpenClaw 的配置说明不混用格式。
- 每个宿主都有对应的 memory 使用规则片段，避免“接上但不读”。
- usage instruction 明确 memory 不可用时降级继续，不阻塞主任务。
- 后续安装器必须支持初次授权、备份和直接写入。
- 上下文装配必须覆盖知识库原始层、规律抽取层、记忆层、规则层、skill 层的读取与优先级规则。
- 上下文压缩必须遵守规则层不丢失、原文可引用展开、证据可溯源、任务目标靠后重申的原则。
- 规则层必须支持人工规则和治理提案，提案确认后才生效。
- 规则层必须按任务类型召回，并按规则自身声明处理失败。
- 工程化评测至少覆盖接入层、召回装配、规则执行、治理层和端到端真实任务。
- 第一阶段自动写入只要求 Codex 和 Claude Code 完整闭环，其他宿主保持模板和手动说明。

## 14. Symphony 参考结论

OpenAI Symphony 的规则组织方式对本系统有参考价值，但不能直接照搬。

### 14.1 Symphony 的做法

Symphony 把执行策略拆成两类仓库内资产：

- `WORKFLOW.md`：仓库级 workflow contract，包含 tracker、workspace、hook、agent、Codex sandbox/approval 配置，以及完整任务执行 prompt。
- `.codex/skills/*/SKILL.md`：按动作拆分的执行 skill，例如 `commit`、`pull`、`push`、`land`、`debug`、`linear`。

它的核心特点：

- 策略随仓库版本化，而不是只存在外部服务。
- workflow prompt 是执行主入口，skill 是特定动作的操作规范。
- 规则很具体，直接约束无人值守 agent 的行为，例如状态流转、workpad、PR feedback sweep、测试门禁、merge/land 流程。
- spec 用 MUST/SHOULD/MAY 这类规范语言，明确 implementation-defined 的边界。
- 运行策略和安全姿态不假设统一答案，而要求实现方记录选择。

### 14.2 对我们的启发

可吸收：

- 把“宿主启动规则”和“动态 rule layer”分开。宿主本地文件只负责让 agent 知道必须读取 MCP rule layer，不承载完整规则库。
- 把 workflow / policy / skill 分层。workflow 负责任务生命周期，rule 负责必须遵守，skill 负责具体动作。
- 对规则使用规范语言，区分 `must`、`should`、`may`、`forbidden`，避免规则语气模糊。
- 为高风险流程写成明确状态流，例如 commit、push、land、review、governance。
- 每个规则和 skill 都要带适用条件、失败处理、验证要求。
- 规则需要可版本化、可审计、可回滚。

不直接照搬：

- Symphony 偏单仓库/单 workflow；我们要跨 Codex、Claude Code、OpenCode、OpenClaw 和自研软件热插拔。
- Symphony 的规则主要靠文件被宿主读入；我们还需要 MCP 动态召回、`query_hash + layer_versions` 复用、分层上下文装配。
- Symphony 的 skill 是静态仓库文件；我们的 skill 还需要治理 proposal、人工确认和同步到宿主本地 skill。
- Symphony 没有把长期 memory、knowledge、rule、skill、evidence 统一成可治理的长期系统。

### 14.3 我们的优化方向

本系统采用“双层规则资产”：

1. 本地 bootstrap 规则：
   - 写入 `AGENTS.md`、`CLAUDE.md` 或宿主等价文件。
   - 内容尽量短，只说明何时调用 MCP、如何处理 degraded mode、规则层优先级、变更需人工确认。
   - 类似 Symphony 的 `WORKFLOW.md`，但只做启动契约，不做完整规则数据库。

2. MCP rule layer：
   - 规则权威来源。
   - 支持任务类型过滤、优先级、失败行为、版本、来源证据、状态。
   - 通过 `memory_retrieve_context` 返回到 context package 的 `Execution Rules` 区域。
   - rule/skill 变更必须先生成 proposal，经人确认后生效。

对 skill 的处理：

- 静态通用 skill 可以像 Symphony 一样落成本地 `SKILL.md`。
- 动态沉淀的经验先进入 procedural memory。
- 治理层判断其稳定、可复用、足够明确后，生成 skill change proposal。
- 用户确认后再写入宿主原生 skill 文件。

### 14.4 当前是否只能这样

短期内基本只能采用“双层模式”：

- 只靠宿主本地规则文件：简单，但无法动态治理、跨宿主同步、按任务召回、做版本判断。
- 只靠 MCP rule layer：动态，但宿主未必主动调用，启动阶段没有基础约束。
- 双层模式：本地文件保证触发和最小执行约束，MCP rule layer 负责动态、可治理、可审计规则。

因此当前路线不是折中，而是工程上必要的组合。

## 15. 风险

- 各宿主配置格式会变，模板必须尽量薄，避免把宿主逻辑写死到 MCP server。
- Codex/Claude/OpenCode/OpenClaw 对 stdio/HTTP 支持和配置路径不同，不能强制统一到一个文件。
- 自动写用户全局配置风险高，必须初次授权并备份。
- 各宿主是否会主动调用 MCP 取决于其 agent rules/skill/hook 机制；MCP 本身不是强制执行器。
- 如果四层上下文装配没有设计好，宿主可能读了 memory 但仍然拿不到真正需要的上下文。
