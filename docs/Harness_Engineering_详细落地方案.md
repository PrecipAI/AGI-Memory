# Harness Engineering 详细落地方案(Implementation Blueprint)

> P1 期间以 [Launch Spec v1](./specs/launch-v1/Launch_Spec_v1.md) 为唯一实现规范源。  
> 本文负责解释落地思路、阶段划分与工程背景，不再承担 P1 实现裁决权。

## 一、摘要(Summary)

本方案用于承接《Harness Engineering 下的完整系统设计方案》，把“驾驭层”从架构概念落实到工程实现。核心任务不是继续堆抽象名词，而是补齐这几座桥：

1. 从架构层到服务层的桥
2. 从方法论到数据对象的桥
3. 从能力设计到注册发现机制的桥
4. 从任务编排到执行落点的桥
5. 从执行结果到验证反馈与持续改进的桥

默认资源配置：

1. 后端工程师 3 人
2. 平台工程师 1 人
3. QA 1 人
4. SRE 1 人

默认周期：

1. `Week 0-2`：规格冻结与基础设施
2. `Week 3-6`：编排主链路
3. `Week 7-10`：记忆、注册与执行闭环
4. `Week 11-14`：验证反馈与失败闭环
5. `Week 15-18`：治理、熵管理与生产加固

---

## 二、实施总原则(Implementation Principles)

1. 先有编排器，再有复杂能力。
2. 先把能力显式注册，再允许模型选择。
3. 先能验证，再让系统自动执行。
4. 先做最小可运行闭环，再谈高级自治。
5. 先把规则外部化，再把经验沉淀到 memory。

---

## 三、从架构到工程的映射(Architecture to Engineering Mapping)

### 3.1 逻辑模块到服务的映射

#### 3.1.1 Interaction Layer

工程落地为：

1. `agent-api`

职责：

1. 接收用户请求
2. 做请求规范化
3. 创建 `task_request`

#### 3.1.2 Task Orchestration Layer

工程落地为：

1. `task-orchestrator`

内部子模块：

1. `planner`
2. `resolver`
3. `router`
4. `synthesizer`

#### 3.1.3 Context and Memory Layer

工程落地为：

1. `memory-service`
2. `resident-builder`
3. `memory-governance-worker`

#### 3.1.4 Capability Registry Layer

工程落地为：

1. `registry-service`

管理：

1. `skill_registry`
2. `capability_registry`
3. `constraint_rule`
4. `policy_rule`

#### 3.1.5 Execution Substrate Layer

工程落地为：

1. `executor-runtime`
2. `mcp-gateway`
3. `workflow-engine-adapter`
4. `approval-gateway`

#### 3.1.6 Verification and Feedback Layer

工程落地为：

1. `verification-service`
2. `feedback-worker`

#### 3.1.7 Governance and Entropy Management Layer

工程落地为：

1. `governance-worker`
2. `doc-gardener`
3. `drift-scanner`

### 3.2 存储与基础设施映射

1. `PostgreSQL`：任务、记忆、注册表、规则、审计
2. `Redis`：短期状态、执行缓存、幂等、流式输出状态、轻量 journal buffer
3. `Kafka`：事件总线
4. `Temporal`：长流程执行
5. `S3-compatible`：artifact、日志、回放材料
6. `Milvus`：长期检索向量层
7. `OpenTelemetry + Prometheus + Grafana`：观测

---

## 四、必须先冻结的 Launch Spec(Launch Spec Freeze)

### 4.1 首发必须交付的系统能力

1. 请求进入后可生成 `TaskPlan`
2. 可查询和装配 memory 上下文
3. 可显式发现 skill 与 capability
4. 可把子任务路由到内部服务或 MCP
5. 可记录执行步骤和结果
6. 可自动验证结果
7. 可生成失败事件并回流 feedback
8. 可维护最小规则集和审计链
9. effectful 任务熔断后可进入 cleanup plane
10. 流式输出支持 `provisional / committed / revoked`
11. runtime state 支持确定性剪枝，不得无限膨胀

### 4.2 首发不交付

1. 完全自治多智能体协商
2. 自动回滚
3. 大规模自学习规则修改
4. 全量 UI 审批门户
5. 全量文档园丁自动 PR

### 4.3 首发冻结的数据对象

1. `task_request`
2. `task_plan`
3. `task_step`
4. `task_attempt`
5. `task_result`
6. `artifact`
7. `memory`
8. `skill`
9. `resident_snapshot`
10. `memory_candidate`
11. `memory_access_log`
12. `failure_event`
13. `remediation_action`
14. `retry_chain`
15. `recovery_outcome`
16. `skill_registry`
17. `capability_registry`
18. `constraint_rule`
19. `policy_rule`
20. `verification_result`
21. `audit_log`
22. `debt_item`
23. `execution_journal`
24. `cleanup_dlq`
25. `zombie_state`
26. `reconciliation_item`
27. `environment_fingerprint`
28. `stream_state`
29. `compensation_capsule`
30. `cleanup_incident_cluster`
31. `drift_check_result`
32. `dependency_state`

### 4.4 首发冻结的接口

外部接口：

1. `POST /v1/tasks`
2. `GET /v1/tasks/{taskId}`
3. `POST /v1/tasks/{taskId}/approve`
4. `POST /v1/tasks/{taskId}/cancel`
5. `GET /v1/memories/search`
6. `GET /v1/skills/search`

内部接口：

1. `POST /internal/planner/plan`
2. `POST /internal/resolver/resolve`
3. `POST /internal/router/dispatch`
4. `POST /internal/verifier/check`
5. `POST /internal/feedback/commit`
6. `POST /internal/cleanup/dispatch`

### 4.5 首发冻结的事件

1. `task.requested`
2. `task.planned`
3. `task.step.dispatched`
4. `task.step.succeeded`
5. `task.step.failed`
6. `verification.failed`
7. `feedback.committed`
8. `memory.candidate.created`
9. `memory.persisted`
10. `debt.detected`
11. `task.aborted`
12. `cleanup.started`
13. `cleanup.parked`
14. `scope.frozen`
15. `runtime.pruned`
16. `dependency.recovered`
17. `cleanup.replay.started`
18. `scope.thawed`
19. `drift.detected`
20. `dependency.half_opened`

---

## 五、阶段化实施方案(Phased Delivery Plan)

## Phase 0：规格冻结与环境准备(Week 0-2)

### 5.0.1 目标

把系统的骨架钉死，避免后续一边开发一边吵“这到底是谁负责”。

### 5.0.2 核心任务

1. 产出 `Launch Spec v1`
2. 冻结数据模型
3. 冻结 API / Event Contract
4. 搭建四套环境 `dev / staging / pre-prod / prod`
5. 选定统一日志、Trace、Metric 格式
6. 确定最小规则集和审批策略
7. 确定首发 MCP / Internal Capability 白名单

### 5.0.3 交付物

1. `Launch Spec`
2. `Schema Freeze`
3. `API Contract`
4. `Event Contract`
5. `Capability Bootstrap List`
6. `Runbook v1`
7. `Test Matrix v1`

### 5.0.4 人员分工

1. 后端 A：Task / Execution 数据模型
2. 后端 B：Memory / Snapshot 数据模型
3. 后端 C：Registry / Verification / Policy 数据模型
4. 平台：环境、Kafka、Temporal、Milvus、Secrets、Gateway
5. QA：测试矩阵
6. SRE：指标、告警、回退流程

### 5.0.5 退出条件

1. 所有一级模块职责无歧义
2. 首发能力边界冻结
3. 环境可部署可联通

---

## Phase 1：任务编排主链路(Week 3-6)

### 5.1.1 目标

先把“用户请求进来后能被拆、能被路由、能被执行、能被收口”这条主链打通。

### 5.1.2 实现顺序

1. `agent-api`
2. `task-orchestrator`
3. `task_request / task_plan / task_step`
4. `planner`
5. `resolver`
6. `router`
7. `synthesizer`
8. `executor-runtime`

### 5.1.3 功能要求

1. 请求进入后生成 `TaskPlan`
2. `TaskPlan` 中每个步骤都有：
   - `step_type`
   - `inputs`
   - `dependencies`
   - `acceptance_criteria`
   - `risk_level`
   - `side_effect_class`
   - `compensation_hint`
3. Router 可将任务分发到：
   - 内部查询
   - 内部 worker
   - MCP 调用
   - 人工审批
4. 首字节阶段仅允许装配最小热路径上下文，不等待全量冷路径治理完成

### 5.1.4 开发分工

#### 后端 A

1. `agent-api`
2. `task_request / task_plan / task_step`
3. 请求状态查询

#### 后端 B

1. `planner`
2. `synthesizer`

#### 后端 C

1. `resolver`
2. `router`
3. `executor-runtime`

### 5.1.5 验收

1. 用户需求能拆成多步骤计划
2. 每个步骤可被分配给明确执行器
3. 结果可被汇总成用户输出

---

## Phase 2：记忆与注册闭环(Week 7-10)

### 5.2.1 目标

让 Task Orchestrator 不再“凭空判断”，而是有 memory 和 capability registry 支撑。

### 5.2.2 实现顺序

1. `memory-service`
2. `memory-governance-worker`
3. `resident-builder`
4. `registry-service`
5. `skill_registry`
6. `capability_registry`
7. `memory search`
8. `skill search`

### 5.2.3 功能要求

1. Planner 可读取 resident / factual / procedural memory
2. Resolver 可显式查询 registry，而不是靠 prompt 猜
3. Memory 候选可从执行结果和失败结果中抽取
4. 稳定成功路径可沉淀为 skill
5. 程序性记忆复用前必须通过 environment fingerprint 过滤
6. Memory Router 必须规则主导，LLM 只做价值提炼

### 5.2.4 开发分工

#### 后端 A

1. Raw Fact / Artifact
2. Memory Candidate 抽取

#### 后端 B

1. `memory`
2. `skill`
3. `resident_snapshot`

#### 后端 C

1. `skill_registry`
2. `capability_registry`
3. registry 查询接口

### 5.2.5 验收

1. Planner 可用 memory 生成更稳定的计划
2. Resolver 可显式发现能力
3. 稳定成功步骤能被沉淀为 skill

---

## Phase 3：执行、验证、失败闭环(Week 11-14)

### 5.3.1 目标

把执行结果变成可验证、可归因、可回流的闭环。

### 5.3.2 实现顺序

1. `verification-service`
2. `feedback-worker`
3. `failure_event`
4. `remediation_action`
5. `retry_chain`
6. `recovery_outcome`
7. `mcp-gateway`
8. `workflow-engine-adapter`

### 5.3.3 功能要求

1. 每个执行步骤有 precheck / postcheck
2. 失败必须生成 `failure_event`
3. 修复动作必须结构化记录
4. Feedback 能影响：
   - skill 质量分
   - capability 风险等级
   - 规则系统
   - 后续规划
5. 触发熔断后必须进入 cleanup plane，不允许直接把任务扔成 `failed`
6. cleanup 失败超过极小阈值时，必须转 `cleanup_dlq` 并冻结 `tenant + scope` 写权限

### 5.3.4 执行落点

在本阶段，执行器要全部落成明确服务：

1. Internal Query -> `memory-service`
2. Internal Worker -> `memory-governance-worker` / `governance-worker`
3. MCP -> `mcp-gateway`
4. Workflow -> `workflow-engine-adapter` + `Temporal`
5. Approval -> `approval-gateway`

### 5.3.5 验收

1. 步骤失败可归因
2. 失败可触发修复计划
3. 结果可回流 memory / registry / rule

---

## Phase 4：治理、熵管理与生产加固(Week 15-18)

### 5.4.1 目标

让系统不只是“能工作”，而是“不会越跑越烂”。

### 5.4.2 实现顺序

1. `governance-worker`
2. `constraint_rule`
3. `policy_rule`
4. `doc-gardener`
5. `drift-scanner`
6. `debt_item`
7. 运营看板
8. `index-compactor`
9. `async-pressure-controller`

### 5.4.3 功能要求

1. 规则自动校验
2. 架构漂移扫描
3. 文档失真扫描
4. 技术债显式入账
5. 可观测与审计完善
6. 向量索引 compaction 可在低峰期执行
7. failure_event 风暴下可做 clustering / folding / low-value drop

### 5.4.4 验收

1. 规则可自动执行
2. 漂移可被检测
3. 文档过期可被发现
4. 技术债与风险项可被追踪

---

## 六、服务与模块的具体实现方式(Service Implementation Details)

### 6.1 `task-orchestrator`

### 内部模块

1. `planner`
2. `resolver`
3. `router`
4. `synthesizer`

### 持久化对象

1. `task_request`
2. `task_plan`
3. `task_step`
4. `task_result`

### 关键实现点

1. Planner 输出结构化计划，不输出自由文本段落冒充计划
2. Planner 只负责提案，不拥有最终放行权；计划必须继续经过 resolver / policy / verifier
3. 首屏输出必须区分 `provisional / committed`
4. Router 必须维护步骤状态机：
   - `pending`
   - `ready`
   - `running`
   - `blocked`
   - `succeeded`
   - `failed`
   - `cancelled`
   - `aborting`
   - `compensating`
   - `reconciling`
   - `dlq_parked`
   - `manual_recovery_required`
5. effectful step 必须带 `side_effect_class / compensation_hint / idempotency_key`
6. Synthesizer 同时产出：
   - 用户可见结果
   - 系统可消费结构化结果

### 6.2 `registry-service`

### 关键实现点

1. 所有 skill / capability 必须注册后才允许被 Resolver 使用
2. registry 支持：
   - by task_type 查询
   - by scope 查询
   - by risk 查询
   - by tenant 查询
3. registry 需要版本化
4. 对高风险 capability / playbook 需要记录 environment fingerprint requirement

### 6.3 `memory-service`

### 关键实现点

1. 提供 resident / factual / procedural 三类检索
2. 历史压缩层不得直接晋升正式候选
3. 所有向量命中必须回表
4. procedural memory 返回前必须可按 environment fingerprint 做过滤
5. 热路径检索必须有预算和超时，超时后允许降级而不是阻塞 TTFB
6. 向量检索必须先做 tenant / scope / status 前置过滤，不允许只做后置回表过滤
7. candidate routing 必须先走确定性规则，再做可选的 LLM refinement

为了避免 Memory Router 变成“模型一拍脑袋就改路由”，最小决策矩阵可以先冻结成：

| source / signal | verification | fingerprint | 默认去向 | 备注 |
|---|---|---|---|---|
| `environment_fact / profile_fact / constraint_fact` tag | `verified` | `matched_or_na` | factual memory | 规则直入 |
| `resident_hint` 且高频命中 | `verified` | `matched_or_na` | resident candidate | 构建快照 |
| allowlist `error_code` + `verified_fix` | `verified_fix` | `matched` | procedural candidate | 允许提炼 playbook |
| `standard_path` + 跨任务复用 | `verified` | `matched` | procedural candidate | 条件化先验 |
| summary_only / 临时日志 / 草稿 | `unverified` | `na` | summary / drop | 不晋升 |
| rollback / destructive 但未验证 | `unverified` | `mismatch_or_unknown` | block / summary only | 禁止直接准入 |

### 6.4 `mcp-gateway`

### 关键实现点

1. 不让 Orchestrator 直接裸调 MCP
2. 所有 MCP tool 必须在 `capability_registry` 中显式登记
3. 执行前必须走 scope / risk / policy 校验
4. 输出统一标准化为 `task_result + artifact + audit_log`

### 6.5 `verification-service`

### 关键实现点

1. 接收 step result
2. 执行 precheck / postcheck / acceptance check
3. 失败时生成结构化 `verification_result`
4. 必要时触发 `failure_event`
5. 维护 `Circuit Breaker`
6. 在 cleanup 结束后执行 `Cleanup Verifier`

### 6.6 `governance-worker`

### 关键实现点

1. 扫描 stale rules
2. 扫描 stale docs
3. 扫描 drift
4. 产出 `debt_item`
5. 管理 async backpressure 和 failure clustering
6. 驱动 Milvus 旧版本 embedding 的 compaction / purge
7. 维护 Runtime State Pruner 的预算阈值和聚类策略

### 6.7 `cleanup-coordinator`

### 关键实现点

1. 接收 `task.aborted`
2. 读取 `execution_journal + compensation_capsule` 中的关键检查点和精确补偿入参
3. 补偿前先执行 read-before-write drift check
4. drift mismatch 时直接写 `drift_check_result`，进入 `quarantined_drifted / reconciliation_required`
5. 按逆拓扑序执行 compensation 或 reconciliation
6. compensation 失败超过极小阈值后，转 `cleanup_dlq`
7. 进入 `cleanup_dlq` 后冻结 `tenant + scope` 写权限并触发高优先级告警

### 6.9 `dlq-replay-controller`

### 关键实现点

1. 将 `cleanup_dlq` item 按 dependency / error signature / compensator 聚类为 incident cluster
2. 接收 `dependency.recovered`
3. 将依赖状态切换到 `HALF-OPEN`
4. 执行 health recheck 与 thaw eligibility check
5. 对在线流量和 DLQ replay 流量施加双轨低配额
6. 先做 canary replay，再做分批 replay
7. replay 成功后逐步解冻 `scope`
8. replay 失败则回弹到 `DOWN` 并重新 park，而不是无限重放

恢复期双轨流控的最小配置表可以先定义为：

| 轨道 | 目的 | HALF-OPEN 配额 | 超时策略 | 失败处理 |
|---|---|---|---|---|
| Track A: 在线新流量 | 探测真实业务链路 | 常规流量的 5%-20% | 缩短到常规的 50% | 失败计入 dependency 健康度 |
| Track B: DLQ replay | 慢速排空积压 | 极低 QPS，例如 `1-2/s` 或 token bucket | 比在线更短 | 任一 503 / timeout 可触发回弹 |

### 6.8 `runtime-state-pruner`

### 关键实现点

1. 将 runtime state 拆成 `pinned state / active branch window / failure clusters / branch digests`
2. 采用 `soft_limit / hard_limit` 双阈值触发剪枝
3. 先折叠连续同质失败，再压缩非活跃分支，再裁剪 delta journal
4. 只对 shadow state 执行剪枝，下一轮调用再切换
5. `current_goal / active_step / immediate_predecessor / open_blockers` 永不驱逐

运行态状态层的槽位与预算建议可以先冻结成：

| 槽位 | 内容 | 是否可驱逐 | 驱逐优先级 | 预算建议 |
|---|---|---|---|---|
| `pinned_state.current_goal` | 当前目标 | 否 | 不可驱逐 | 40-80 tokens |
| `pinned_state.active_step` | 当前活跃步骤 | 否 | 不可驱逐 | 40-80 tokens |
| `pinned_state.immediate_predecessor` | 紧邻前驱 | 否 | 不可驱逐 | 60-120 tokens |
| `pinned_state.open_blockers` | 当前阻塞项 | 否 | 不可驱逐 | 60-120 tokens |
| `pinned_state.active_budget` | 当前预算与限额 | 否 | 不可驱逐 | 20-40 tokens |
| `active_branch_window` | 活跃分支最近事件 | 是 | 低 | 200-400 tokens |
| `failure_clusters` | 同质失败聚类摘要 | 是 | 中 | 120-240 tokens |
| `branch_digests` | 非活跃分支摘要 | 是 | 高 | 120-240 tokens |
| `delta_journal` | 最近关键跳变 | 是 | 最高 | 80-160 tokens |

推荐阈值：

- `soft_limit`: 900-1200 tokens
- `hard_limit`: 1400-1800 tokens

推荐剪枝顺序：

1. 先裁剪 `delta_journal`
2. 再折叠 `failure_clusters`
3. 再压缩 `branch_digests`
4. 最后收缩 `active_branch_window`
5. `pinned_state` 永不驱逐

---

## 七、任务拆解、能力发现、执行、输出的完整链路(End-to-End Lifecycle)

### 7.1 任务拆解

谁做：

1. `Task Planner`

怎么做：

1. 根据请求类型生成 `TaskPlan`
2. 将复杂需求切分为依赖有向图(DAG)上的 `TaskStep`
3. 热路径先给出最小可撤销结果，冷路径异步补全

### 7.2 能力发现

谁做：

1. `Capability Resolver`

依赖：

1. `Skill Registry`
2. `Capability Registry`
3. resident / procedural memory
4. environment fingerprint

输出：

1. 当前子任务的候选执行方案
2. 已通过 scope / risk / fingerprint 收缩的执行方案
3. 若 playbook 指纹失配，则进入 `exploration_mode / probe-first / block`

### 7.3 执行落点

谁做：

1. `Execution Router`

路由去向：

1. 内部查询服务
2. 内部 worker
3. MCP Gateway
4. Workflow Engine
5. Approval Gateway

### 7.4 执行完成后的输出

谁做：

1. `Result Synthesizer`

系统内部输出：

1. `task_result`
2. `artifact`
3. `failure_event`
4. `memory_candidate`
5. `audit_log`
6. `execution_journal`
7. `stream_state`

用户可见输出：

1. 状态摘要
2. 关键结果
3. 失败原因
4. 后续建议
5. 如果冷路径返回冲突结论，则显式输出 `revoked / replanned / blocked`

### 7.5 熔断后的收口

谁做：

1. `cleanup-coordinator`

怎么做：

1. `Circuit Breaker` 触发后冻结 DAG 的新步骤调度
2. 扫描 `execution_journal + compensation_capsule` 获取已发生副作用的步骤和精确补偿入参
3. 补偿前先做 drift check
4. 可补偿步骤执行 compensation
5. 不可逆步骤进入 reconciliation / forward recovery
6. cleanup 失败超过极小阈值后转 `cleanup_dlq`
7. 冻结 `tenant + scope` 写权限，等待人工接管
8. drift mismatch 时直接进入 `quarantined_drifted`

### 7.6 依赖恢复后的自动唤醒与重放

谁做：

1. `dlq-replay-controller`

怎么做：

1. 外部监控发出 `dependency.recovered`
2. 系统进入 `HALF-OPEN`
3. 按 incident cluster 找到受影响的 cleanup item
4. 做 health recheck 和 thaw eligibility check
5. 对在线流量和 replay 流量采用双轨低配额
6. 先做 canary replay
7. replay 成功后发出 `scope.thawed`
8. replay 失败则回弹到 `DOWN` 并重新 park 或升级人工接管

---

## 八、测试计划(Test Plan)

### 8.1 单元测试

覆盖：

1. Planner 任务拆解规则
2. Resolver 能力筛选规则
3. Router 状态机
4. Synthesizer 输出归并
5. Registry 查询与过滤
6. Memory 检索回表逻辑
7. Verification 判定逻辑
8. environment fingerprint 匹配规则
9. cleanup 状态机转换规则
10. Runtime State Pruner 驱逐顺序和 shadow switch 规则
11. compensation capsule 完整性和 cleanup 入参提取规则
12. DLQ incident cluster 的聚类与 replay 条件
13. drift check 指纹匹配与 mismatch 阻断规则
14. HALF-OPEN / DOWN / UP 状态切换规则

### 8.2 集成测试

覆盖：

1. 请求 -> 计划 -> 路由 -> 执行 -> 输出
2. 执行 -> 验证 -> feedback -> memory candidate
3. capability registry -> mcp gateway
4. failure_event -> remediation -> retry_chain
5. abort -> cleanup -> dlq / manual recovery
6. runtime token pressure -> prune -> next-call state switch
7. dependency.recovered -> incident cluster wakeup -> replay -> scope thaw
8. drift check mismatch -> quarantined_drifted -> reconciliation

### 8.3 回归测试

必须覆盖：

1. `conversation_summary` 不得直接晋升正式记忆
2. 未注册 capability 不得被路由
3. 高风险动作必须被 policy 拦截或审批挂起
4. 验证失败不得被误报为成功
5. procedural memory 在 fingerprint 不匹配时不得高权重复用
6. cleanup 失败超过阈值后不得继续递归自动补偿
7. 向量检索不得跳过 tenant / scope 前置过滤
8. Runtime State Pruner 不得驱逐 pinned state
9. cleanup 必须绕过 Runtime State，直接读取 journal / capsule
10. DLQ replay 不得无限制全量同时唤醒
11. drift mismatch 时不得继续执行补偿
12. dependency.recovered 后不得直接跳到全量 UP

### 8.4 安全测试

1. 多租户隔离
2. 越权调用 capability
3. 审计缺失
4. 敏感数据泄漏

### 8.5 故障注入测试

1. MCP 超时
2. Worker 卡死
3. Kafka 积压
4. Temporal 重试风暴
5. Memory 检索异常
6. cleanup API 503 / 限流
7. Milvus 幽灵索引积压

---

## 九、发布、回退与运营(Release, Rollback and Operations)

### 9.1 发布顺序

1. `dev`
2. `staging`
3. `pre-prod`
4. `prod canary`

### 9.2 首发发布策略

1. 先只开低风险只读任务
2. 再开受控写任务
3. 再开带人工审批的高风险任务

### 9.3 回退策略

1. Registry 异常：退回只允许内建固定能力
2. Memory 异常：退回短期上下文模式
3. Verification 异常：禁止 effectful action，仅保留只读
4. MCP 异常：关闭外部工具执行，只保留内部查询与人工接管
5. Cleanup Plane 异常：冻结高风险写 scope，所有 effectful DAG 只允许进入人工审批模式

### 9.4 运营看板

必须有：

1. 任务状态分布
2. 失败模式排行
3. capability 使用分布
4. skill 命中率
5. memory usefulness
6. drift / debt 趋势
7. TTFB
8. cleanup DLQ backlog
9. scope freeze 命中率
10. top-k 幽灵索引占比

---

## 十、上线门槛(Go-live Gates)

### 10.1 功能门槛

1. 请求能稳定转成 TaskPlan
2. Resolver 不依赖模型隐式记忆发现能力
3. 所有 effectful action 都能验证和审计
4. failure / remediation / feedback 闭环成立
5. effectful DAG 熔断后可进入 cleanup plane 并可被人工接管

### 10.2 指标门槛

1. Task Planning Success Rate 达标
2. Verification Pass Rate 达标
3. Misroute Rate 为 0
4. Unauthorized Capability Access Pass Rate 为 0
5. Audit Coverage 100%
6. Cleanup Success Rate 达标
7. Cleanup DLQ 积压在阈值内

### 10.3 运维门槛

1. Runbook 完整
2. 告警完整
3. 可回放
4. 至少一次 pre-prod 演练通过

---

## 十一、风险与对策(Risks and Mitigations)

### 11.1 没把编排器做成一级系统

风险：

1. 任务拆解和工具选择重新散落到 prompt 中

对策：

1. `task-orchestrator` 独立服务化
2. `planner/resolver/router/synthesizer` 独立职责

### 11.2 能力发现靠“模型记得”

风险：

1. 模型幻觉出不存在的 capability

对策：

1. 所有能力必须注册
2. Router 只接受 registry 内 capability

### 11.3 执行结果不回流

风险：

1. 系统不会学习，只会重复踩坑

对策：

1. 强制结果写 `task_result / failure_event / memory_candidate`
2. effectful task 强制写关键 `execution_journal` 检查点，不能只靠内存态猜自己碰过什么资源

### 11.4 规则和文档变成死物

风险：

1. Harness 逐渐失效

对策：

1. `doc-gardener`
2. `drift-scanner`
3. `debt register`

---

## 十二、设计到落地的桥梁总结(Bridge Summary)

真正把 Harness Engineering 落地，关键不是写一句“人类掌舵，智能体执行”，而是把这四件事工程化：

1. 规划工程化：让任务拆解从 prompt 技巧变成显式 `TaskPlan`
2. 能力工程化：让能力发现从模型隐式记忆变成 `Registry`
3. 执行工程化：让工具调用从“直接调”变成 `Router -> Executor`
4. 反馈工程化：让失败和验证从日志噪音变成结构化回流

这四件事补齐了，Harness 才不是口号；不补齐，所谓“驾驭工程”就只是高级一点的提示词包装。

---

## 十三、默认假设与锁定决策(Assumptions and Defaults)

1. 本方案中的 Harness 指方法论，不指厂商产品。
2. 首发采用“中心编排式多角色系统”。
3. 首发不做自动回滚。
4. 首发不做完全自治多智能体协商。
5. 所有 capability 必须显式注册后才能执行。
