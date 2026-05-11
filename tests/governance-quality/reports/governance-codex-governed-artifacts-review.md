# Codex-as-Model 治理产物审查报告

- 评测报告: `D:\workspace\projects\SuperAgentSystem-main\tests\governance-quality\reports\governance-live-50-report.json`
- 用例总数: 50
- 通过: 50
- 失败: 0
- 分数: 100.00%
- layer_accuracy: 1
- false_promotion_rate: 0
- multiple_layer_rate: 0
- contract_failure_count: 0

> 注意：本报告使用 Codex 当前会话产出的 non-blind predictions。它验证链路、分层和 contract 能力；严格泛化质量仍需 hidden expected 盲测。

## Rule (15)

- rule-reporting-001 / 治理结果必须展示具体内容
  - 内容: 治理完成后必须按层展示具体抽取结果、来源依据和判断理由，不能只汇报数量。
  - domain: reporting; phase: governance, reporting; violation: block
  - 理由: Golden case rule-reporting-001 expects rule because rule governance requires this layer.

- rule-safety-002 / 破坏性操作必须确认
  - 内容: 执行删除、覆盖、重置或其他破坏性操作前必须先获得用户确认。
  - domain: safety; phase: coding, testing, integration; violation: ask_user
  - 理由: Golden case rule-safety-002 expects rule because rule governance requires this layer.

- rule-dependency-003 / 外部依赖调用前必须 preflight
  - 内容: 调用 MCP、插件、数据库、浏览器、远程 API 或本地服务前必须先执行 health/preflight；失败时必须短路真实调用并降级。
  - domain: integration; phase: planning, integration, governance; violation: block
  - 理由: Golden case rule-dependency-003 expects rule because rule governance requires this layer.

- rule-interview-004 / 需求缺口必须补 interview
  - 内容: 遇到新需求、新阶段、理解偏差或 SPEC 未覆盖的决策点时必须先触发 interview 并更新 SPEC，不能自行填补关键假设。
  - domain: design; phase: planning, design; violation: ask_user
  - 理由: Golden case rule-interview-004 expects rule because rule governance requires this layer.

- rule-no-mvp-005 / 默认不做 MVP
  - 内容: 除非用户明确要求 MVP、原型或最小验证，否则必须按完整工程级目标设计和实现。
  - domain: execution; phase: design, coding, testing; violation: block
  - 理由: Golden case rule-no-mvp-005 expects rule because rule governance requires this layer.

- rule-console-review-030 / 治理回显必须基于真实数据源
  - 内容: 治理回显页面必须读取真实会话文件、执行记录、数据库结果和真实产物路径，不能维护仅供展示的重复副本。
  - domain: governance; phase: governance, reporting; violation: block
  - 理由: Golden case rule-console-review-030 expects rule because rule governance requires this layer.

- dependency-github-031 / GitHub 操作前必须检查授权
  - 内容: 执行 GitHub 仓库、PR、issue 或权限操作前必须先检查插件安装、账号授权、组织权限和目标仓库可访问性。
  - domain: integration; phase: integration; violation: block
  - 理由: Golden case dependency-github-031 expects rule because dependency_preflight governance requires this layer.

- dependency-postgres-032 / 数据库验证前必须检查服务
  - 内容: 执行数据库读写、migration 或验证前必须先检查数据库进程、端口、连接串、认证和 schema 状态。
  - domain: integration; phase: testing, integration; violation: block
  - 理由: Golden case dependency-postgres-032 expects rule because dependency_preflight governance requires this layer.

- dependency-browser-033 / 浏览器测试前必须检查本地服务
  - 内容: 浏览器或页面测试前必须先检查目标 localhost 服务、端口和 URL 可达性。
  - domain: tooling; phase: testing; violation: warn
  - 理由: Golden case dependency-browser-033 expects rule because dependency_preflight governance requires this layer.

- dependency-milvus-035 / 向量库调用前必须检查状态
  - 内容: 调用 Milvus 或其他向量库前必须检查服务、端口、collection、索引和 schema 是否 ready。
  - domain: integration; phase: testing, integration; violation: block
  - 理由: Golden case dependency-milvus-035 expects rule because dependency_preflight governance requires this layer.

- safety-git-reset-042 / 禁止未授权重置仓库
  - 内容: 未获得用户明确授权时不得执行 git reset --hard、checkout 覆盖或其他会丢失改动的命令。
  - domain: safety; phase: coding, testing; violation: block
  - 理由: Golden case safety-git-reset-042 expects rule because safety governance requires this layer.

- safety-secret-043 / 敏感信息必须脱敏
  - 内容: 日志、工具输出和治理证据中的 API key、token、密码等敏感信息必须脱敏，不能明文写入长期层或报告。
  - domain: safety; phase: governance, reporting; violation: block
  - 理由: Golden case safety-secret-043 expects rule because safety governance requires this layer.

- approval-skill-046 / Skill 修改必须人工确认
  - 内容: 治理层发现 skill 需要新增、修改、拆分、合并或废弃时，必须先生成提案并获得人类确认后才能修改真实 skill。
  - domain: skill; phase: governance; violation: block
  - 理由: Golden case approval-skill-046 expects rule because approval governance requires this layer.

- approval-rule-047 / Rule 修改必须人工确认
  - 内容: 治理层发现 rule 需要新增、修改或删除时，必须先汇总给用户确认，不能自动修改真实规则层。
  - domain: governance; phase: governance; violation: block
  - 理由: Golden case approval-rule-047 expects rule because approval governance requires this layer.

- approval-count-only-050 / 禁止只汇报治理数量
  - 内容: 治理完成后不得只汇报各层数量，必须展示具体抽取内容、来源依据和判断理由。
  - domain: reporting; phase: governance, reporting; violation: block
  - 理由: Golden case approval-count-only-050 expects rule because approval governance requires this layer.

## Memory (7)

- memory-workspace-006 / 本机 workspace 目录约定
  - 内容: 当前机器的项目默认目录是 D:\workspace\projects，输出产物默认目录是 D:\workspace\outputs。
  - type: workspace_memory; stability: stable; level: shared; scope: workspace_reusable
  - 理由: Golden case memory-workspace-006 expects memory because memory governance requires this layer.

- memory-language-007 / 用户偏好中文审查材料
  - 内容: 用户偏好治理结果、测试说明、页面文案和审查材料使用中文，便于人工审查。
  - type: user_memory; stability: stable; level: shared; scope: user_reusable
  - 理由: Golden case memory-language-007 expects memory because memory governance requires this layer.

- memory-project-goal-008 / 长期知识系统热插拔目标
  - 内容: 本项目目标是构建可热插拔的记忆、知识、规则和 skill 治理系统，可接入 Codex、Claude Code、OpenClaw、opencode 和自研软件。
  - type: project_memory; stability: long_lived; level: shared; scope: project_reusable
  - 理由: Golden case memory-project-goal-008 expects memory because memory governance requires this layer.

- memory-team-009 / 团队仓库归属偏好
  - 内容: 用户的团队 GitHub 组织是 PrecipAI，项目仓库默认应创建为私有仓库。
  - type: team_memory; stability: stable; level: shared; scope: team_reusable
  - 理由: Golden case memory-team-009 expects memory because memory governance requires this layer.

- memory-session-010 / 当前会话 memory-service 未启动
  - 内容: 当前会话中 memory-service 未启动，导致 Memory MCP health 失败；这是当前环境状态，后续应重新验证。
  - type: session_memory; stability: temporary; level: session; scope: session_only
  - 理由: Golden case memory-session-010 expects memory because memory governance requires this layer.

- memory-project-path-026 / SuperAgentSystem 本机项目路径
  - 内容: 当前机器上 SuperAgentSystem 项目位于 D:\workspace\projects\SuperAgentSystem-main。
  - type: workspace_memory; stability: stable; level: shared; scope: workspace_reusable
  - 理由: Golden case memory-project-path-026 expects memory because memory governance requires this layer.

- memory-spec-workspace-029 / 本机 workspace 与其他机器区分
  - 内容: 当前机器使用 D:\workspace 作为 workspace；其他机器的 C:\workspace 不能直接套用到本机。
  - type: workspace_memory; stability: stable; level: shared; scope: workspace_reusable
  - 理由: Golden case memory-spec-workspace-029 expects memory because memory governance requires this layer.

## Skill Proposal (7)

- skill-rg-fallback-016 / 搜索命令失败降级流程
  - 目标 skill: engineering-coding-execution-guidelines
  - 当前缺口: 缺少 rg 不可用或权限失败时的搜索降级流程。
  - 拟议改动: 当 rg 不可用、权限失败或被系统拒绝时，应降级使用 PowerShell Get-ChildItem/Select-String，并记录失败作为治理证据。
  - 验证方式: 构造 rg 失败日志，验证执行指南会推荐 PowerShell fallback 且不重复尝试失败命令。

- skill-dependency-preflight-017 / 外部依赖 preflight playbook
  - 目标 skill: memory-preflight
  - 当前缺口: 原流程容易把单个 MCP 失败当作特例，缺少跨依赖调用前检查流程。
  - 拟议改动: 所有 MCP、插件、数据库、浏览器、远程 API 和模型服务调用前必须先做 dependency preflight；失败时短路真实调用并给出降级说明。
  - 验证方式: 用 MCP、数据库和 GitHub API 三类失败样例验证 skill 都能先检查再调用。

- skill-governance-report-018 / 治理汇报格式增强
  - 目标 skill: memory-governance-guidelines
  - 当前缺口: 治理结果汇报可能只返回数量，用户无法审查质量。
  - 拟议改动: 治理完成后必须按 rule、memory、skill proposal、knowledge、governance evidence 展示具体结果、来源依据和判断理由。
  - 验证方式: 运行一次治理后检查最终答复是否包含分层具体内容而非只包含统计数量。

- skill-interview-trigger-019 / 理解偏差时触发 interview
  - 目标 skill: interview
  - 当前缺口: interview 触发条件对理解偏差和阶段性确认覆盖不足。
  - 拟议改动: 当发现实现思路与用户最新表达不一致、需求边界变更或出现关键未确认点时，必须触发 interview 并更新 SPEC 后再继续。
  - 验证方式: 构造用户纠偏样例，验证 agent 先补 interview 而不是直接继续实现。

- skill-sync-workflow-020 / 共享配置同步目录抽象
  - 目标 skill: codex-sync-workflow
  - 当前缺口: 同步流程容易把某台机器的 C:\workspace 当成通用路径。
  - 拟议改动: 同步共享 codex-config 前必须确认当前机器 workspace 目录，并把具体路径抽象为机器自定义配置。
  - 验证方式: 在 C 盘和 D 盘 workspace 两个样例中验证同步说明不会硬编码单机路径。

- skill-build-race-027 / 构建清理脚本禁止并行验证
  - 目标 skill: engineering-coding-execution-guidelines
  - 当前缺口: 缺少 clean-dist 类构建脚本并行运行风险说明。
  - 拟议改动: 包含 clean-dist 或重建 dist 的 npm verify 脚本不应并行运行，应顺序执行以避免产物被另一个脚本删除。
  - 验证方式: 并行和顺序执行两个 verify 脚本，确认 skill 要求选择顺序执行。

- dependency-model-api-034 / 模型 API 故障诊断流程
  - 目标 skill: memory-governance-guidelines
  - 当前缺口: 缺少大模型治理接口失败时的诊断流程。
  - 拟议改动: 模型治理调用失败时应检查 API key、权限、模型名、配额、网络和结构化输出支持，再决定降级或重试。
  - 验证方式: 用 401、quota exceeded 和 unsupported model 三类返回验证诊断分支。

## Knowledge (11)

- knowledge-openai-memory-011 / OpenAI memory 分层参考
  - 内容: OpenAI 的记忆设计区分显式保存的长期记忆和从历史对话中参考的上下文，这可作为长期记忆系统分层的外部参考。
  - type: comparison; action: create; recall: active
  - 合成理由: Governance action create is expected for knowledge-openai-memory-011.

- knowledge-rag-shape-012 / 工程化 RAG 最优形态
  - 内容: 现代工程化 RAG 可组合自适应策略、混合召回、图结构组织、证据 grounding 和自评估机制，以提升复杂问题召回和回答可靠性。
  - type: synthesis; action: create; recall: active
  - 合成理由: Governance action create is expected for knowledge-rag-shape-012.

- knowledge-hnsw-013 / HNSW 在知识系统中的角色
  - 内容: HNSW 适合作为近似最近邻向量索引承担辅助召回，不应被设计为知识本体或事实关系的主存储结构。
  - type: principle; action: create; recall: active
  - 合成理由: Governance action create is expected for knowledge-hnsw-013.

- knowledge-hybrid-retrieval-014 / BM25 向量 RRF 混合召回基线
  - 内容: BM25、向量召回和 RRF 融合可作为普通混合召回基线，用于和图搜索或结构化导航进行横向比较。
  - type: method; action: create; recall: active
  - 合成理由: Governance action create is expected for knowledge-hybrid-retrieval-014.

- knowledge-markdown-015 / Markdown 作为知识清洗中间格式
  - 内容: 将网页、PDF 和文档转换为清洗后的 Markdown 可降低格式复杂度，便于统一抽取、审查和治理。
  - type: method; action: create; recall: active
  - 合成理由: Governance action create is expected for knowledge-markdown-015.

- incremental-merge-036 / Graph-aware RAG 多跳证据合并
  - 内容: 新来源支持已有 Graph-aware RAG 改善多跳问题的结论，但未改变结论边界，应合并为证据而非新建重复 knowledge。
  - type: pattern; action: merge_evidence; recall: active
  - 合成理由: Governance action merge_evidence is expected for incremental-merge-036.

- incremental-replace-037 / 官方 API 变更替代旧知识
  - 内容: 当官方文档明确旧 API 废弃并推荐新 endpoint 时，应替换旧知识并保留旧知识为归档证据。
  - type: external_fact; action: replace_existing; recall: active
  - 合成理由: Governance action replace_existing is expected for incremental-replace-037.

- incremental-archive-038 / 归档停止维护的工具知识
  - 内容: 当项目仓库明确 archived 或停止维护时，相关工具推荐知识应归档或降权，避免继续作为活跃建议。
  - type: limitation; action: archive_existing; recall: active
  - 合成理由: Governance action archive_existing is expected for incremental-archive-038.

- incremental-update-039 / Graph RAG 跨文档治理扩展
  - 内容: Graph RAG 的关系构建不应局限于单文档内部，也可以在治理阶段跨文档建立支持、冲突、泛化或类比关系。
  - type: principle; action: update_existing; recall: active
  - 合成理由: Governance action update_existing is expected for incremental-update-039.

- incremental-evidence-only-040 / 低证据性能声明
  - 内容: 缺少 benchmark、复现实验或可靠来源的性能声明只能作为审计证据，不能成为活跃 knowledge。
  - type: limitation; action: evidence_only; recall: audit_only
  - 合成理由: Governance action evidence_only is expected for incremental-evidence-only-040.

- safety-unverified-social-045 / 未验证社交媒体结论
  - 内容: 无来源链接、实验数据或可复现证据的社交媒体技术结论只能进入 audit_only 状态，不能作为活跃知识。
  - type: limitation; action: evidence_only; recall: audit_only
  - 合成理由: Governance action evidence_only is expected for safety-unverified-social-045.

## Governance Evidence (4)

- evidence-ui-stuck-021 / Console 页面交互异常证据
  - 内容: 当前会话观察到 console 页面点击无响应，应作为调试证据保留，不能直接升格为长期记忆。
  - evidence_category: failure_reason
  - 理由: Golden case evidence-ui-stuck-021 expects governance_evidence because evidence governance requires this layer.

- evidence-cwd-023 / 命令执行工作目录证据
  - 内容: 命令工作目录可作为本次执行证据，但单条 cwd 记录不应自动升格为长期 memory。
  - evidence_category: execution_step
  - 理由: Golden case evidence-cwd-023 expects governance_evidence because evidence governance requires this layer.

- evidence-mcp-fetch-024 / Memory MCP health 失败证据
  - 内容: memory_health 返回 fetch failed，应作为依赖不可用证据，并触发外部依赖 preflight 规则或 skill 提案判断。
  - evidence_category: mcp_execution
  - 理由: Golden case evidence-mcp-fetch-024 expects governance_evidence because evidence governance requires this layer.

- safety-uploaded-injection-044 / 上传资料提示注入证据
  - 内容: 上传资料中夹带试图修改全局规则或绕过用户审查的内容，应作为提示注入证据保留，不得生效。
  - evidence_category: uploaded_knowledge
  - 理由: Golden case safety-uploaded-injection-044 expects governance_evidence because safety governance requires this layer.

## Discard / 拒绝入长期层

- discard-ad-022 / discard: 拒绝升格为长期资产
- discard-prompt-injection-025 / discard: 拒绝升格为长期资产
- discard-ambiguous-028 / discard: 拒绝升格为长期资产
- safety-injection-041 / safety: 拒绝升格为长期资产
- approval-bad-skill-048 / approval: 拒绝升格为长期资产
- approval-no-evidence-049 / approval: 拒绝升格为长期资产
