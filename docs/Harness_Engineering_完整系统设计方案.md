# Harness Engineering 下的完整系统设计方案(System Design Doc)

> P1 期间以 [Launch Spec v1](./specs/launch-v1/Launch_Spec_v1.md) 为唯一实现规范源。  
> 本文负责解释架构动机、系统分层与设计背景，不再承担 P1 实现裁决权。

## 一、摘要(Summary)

本方案从 `Harness Engineering` 方法论出发，设计一套面向生产环境(Production)的通用智能体平台。该平台不是“一个会调工具的大模型外壳”，而是一套围绕智能体运行构建的控制系统(Control System)，目标是让智能体在真实业务环境中具备：

1. 可规划(Plannable)
2. 可约束(Constrainable)
3. 可执行(Executable)
4. 可验证(Verifiable)
5. 可回退(Recoverable)
6. 可持续改进(Continuously Improvable)

本方案中的 `Harness` 是“驾驭层(Harness Layer)”本身。它位于模型(Model)与业务系统(Business Systems)之间，负责把原本不稳定、易漂移、易失控的智能体行为，变成受约束、可观测、可修正的工程系统。

本方案的系统核心由五部分组成：

1. 任务编排层(Task Orchestration Layer)
2. 上下文与记忆层(Context and Memory Layer)
3. 能力注册与执行层(Capability Registry and Execution Layer)
4. 验证反馈层(Verification and Feedback Layer)
5. 治理与熵管理层(Governance and Entropy Management Layer)

这五部分共同构成智能体的“驾驭系统”，而不是把责任全甩给模型本身。

---

## 二、设计出发点(Design Motivation)

### 2.1 Harness Engineering 的问题意识

在传统 Prompt Engineering 里，主要问题是“怎么把话说清楚”；在 Context Engineering 里，主要问题是“怎么把信息喂进去”；而在 Harness Engineering 里，核心问题变成：

1. 模型做错了怎么办？
2. 错过一次之后，下次如何不再犯？
3. 长流程任务如何稳定推进而不是中途失忆？
4. 如何把失败、修复、验证、回退纳入系统闭环？
5. 如何让系统随着 Agent 的运行越来越稳，而不是越来越乱？

### 2.2 为什么不能只靠模型

模型本身不擅长稳定负责以下事情：

1. 长流程状态持久化
2. 跨任务上下文治理
3. 权限与风险控制
4. 结构化验证与回归
5. 失败后的策略性纠偏
6. 技术债与架构漂移控制

所以系统必须把这些能力从“模型脑内”搬到“模型外部的工程系统”中。

### 2.3 系统级目标

本平台要解决的不是“让 Agent 更聪明”，而是：

1. 让 Agent 的工作环境更可靠
2. 让人类注意力集中在高杠杆决策点上
3. 让系统具备持续纠错能力
4. 让架构、文档、验证、运行形成闭环

---

## 三、目标与非目标(Goals and Non-goals)

### 3.1 目标(Goals)

1. 支持复杂需求进入后被结构化拆解、分配、执行和收口。
2. 支持 Memory 作为长期知识真源，参与规划、检索、执行和修复。
3. 支持 MCP、Skill、内部服务、外部系统被统一发现、统一治理、统一调用。
4. 支持执行前约束、执行中监控、执行后验证、失败后回流。
5. 支持多租户、权限隔离、审计、回退、可重放。
6. 支持“失败一次，系统规则更强一次”的持续改进循环。
7. 支持 effectful 任务在熔断后进入受控收口(cleanup) 而不是留下无人认领的脏状态。
8. 支持热路径极瘦、冷路径异步，避免把 TTFB、Token 预算和上下文窗口一起炸穿。

### 3.2 非目标(Non-goals)

1. 不把所有逻辑都塞给单次 prompt 决定。
2. 不让原始工具调用裸奔到业务环境。
3. 不把聊天摘要当正式事实真源。
4. 不在首发阶段追求完全自治、完全无人值守。
5. 不将自动回滚纳入首发能力。
6. 不追求关系库与向量库的严格实时强一致。
7. 不让 Planner 以一次零样本规划结果独裁整个执行链路。

---

## 四、系统形态选择(System Shape)

### 4.1 采用什么智能体结构

本方案采用：

**中心编排式多角色系统(Centrally Orchestrated Multi-role System)**

它不是“多个平级自由发挥的 Agent 群聊”，而是：

1. 一个总控智能体(Supervisor / Planner)
2. 一组受控的专职执行角色(Specialized Workers)
3. 一套外部化的状态、规则、验证、反馈系统

### 4.2 为什么不做纯单智能体

如果只用一个智能体从头干到尾，会出现：

1. 上下文窗口膨胀
2. 思考、执行、验证职责混在一起
3. 长流程任务容易丢状态
4. 错误更难定位是“规划错”“执行错”还是“验证漏”

### 4.3 为什么不做完全分布式多智能体

如果一上来就搞多个完全自治的平级 Agent，会立刻引入：

1. 状态同步难题
2. 冲突解决难题
3. 重复执行难题
4. 结果仲裁难题
5. 调试复杂度爆炸

所以采用折中但工程上靠谱的结构：

1. 总控负责规划与收口
2. Worker 负责限定职责的执行
3. 规则、状态、验证外部化

---

## 五、总体架构(Overall Architecture)

### 5.1 架构总览

平台由八层组成：

1. 交互接入层(Interaction Layer)
2. 任务编排层(Task Orchestration Layer)
3. 上下文与记忆层(Context and Memory Layer)
4. 能力注册层(Capability Registry Layer)
5. 执行基座层(Execution Substrate Layer)
6. 验证反馈层(Verification and Feedback Layer)
7. 治理与熵管理层(Governance and Entropy Management Layer)
8. 观测与运营层(Observability and Operations Layer)

### 5.2 各层核心作用

#### 5.2.1 交互接入层(Interaction Layer)

职责：

1. 接收用户需求、系统事件、外部触发器
2. 规范化请求(Request Normalization)
3. 产生统一任务上下文(Task Envelope)

为什么要有这层：

1. 智能体不应该直接面对原始外部输入，否则不同入口会产生不同执行语义。

#### 5.2.2 任务编排层(Task Orchestration Layer)

职责：

1. 拆任务
2. 选能力
3. 路由执行
4. 汇总结果

为什么是一级核心层：

1. 这是整个系统的中枢，没有它，Memory、Skill、MCP、Worker 都是散件。

#### 5.2.3 上下文与记忆层(Context and Memory Layer)

职责：

1. 提供短期运行态上下文
2. 提供长期事实记忆与程序性记忆
3. 提供常驻快照和可检索知识

#### 5.2.4 能力注册层(Capability Registry Layer)

职责：

1. 维护平台当前有哪些可用 Skill、MCP、内部服务、外部工具
2. 维护它们的参数结构、风险级别、作用域和权限边界

#### 5.2.5 执行基座层(Execution Substrate Layer)

职责：

1. 真正承载任务执行
2. 调用内部服务、MCP、工作流引擎、批处理任务
3. 管理执行状态

#### 5.2.6 验证反馈层(Verification and Feedback Layer)

职责：

1. 对执行结果做自动验证
2. 对失败做结构化归因
3. 将信号回流给 Memory、规则系统和任务编排器

#### 5.2.7 治理与熵管理层(Governance and Entropy Management Layer)

职责：

1. 维护约束规则
2. 管理技术债、规则漂移、文档过期、架构腐化
3. 形成持续小额修复机制

#### 5.2.8 观测与运营层(Observability and Operations Layer)

职责：

1. 指标
2. 日志
3. Trace
4. 审计
5. 回放
6. 发布控制

---

## 六、任务编排层设计(Task Orchestration Layer)

### 6.1 组成模块

任务编排层包含四个一级模块：

1. `Task Planner`
2. `Capability Resolver`
3. `Execution Router`
4. `Result Synthesizer`

### 6.2 Task Planner

职责：

1. 判断请求类型
2. 生成任务计划
3. 切分步骤和依赖关系
4. 标注每一步的目标、输入、风险和完成条件

输入：

1. 用户请求
2. 当前会话上下文
3. resident memory
4. factual memory
5. procedural memory

输出：

1. `TaskPlan`
2. `TaskStep[]`

典型字段：

1. `task_id`
2. `goal`
3. `task_type`
4. `steps`
5. `dependencies`
6. `acceptance_criteria`
7. `risk_level`

这里必须再补一条工程边界：

**Task Planner 是提案器(proposer)，不是独裁调度器(dictator)。**

也就是说，Planner 的输出必须继续经过：

1. `Capability Resolver` 的显式能力约束
2. `Constraint / Policy` 的规则检查
3. `Precheck Verifier` 的执行前校验
4. 必要时的人工审批或只读探测步骤

所以系统真正相信的不是“Planner 说了啥”，而是：

**Planner 提案 + Registry 约束 + Policy 校验 + Verifier 放行之后的计划。**

### 6.3 Capability Resolver

职责：

1. 根据任务步骤匹配可用 Skill / MCP / Internal Service
2. 结合租户权限、作用域、风险与白名单做筛选
3. 生成候选执行方案
4. 对程序性记忆和高风险修复方案做环境指纹(environment fingerprint) 匹配
5. 对程序性记忆失配场景触发 fallback protocol，而不是直接放任 zero-shot effectful exploration

### 6.4 Execution Router

职责：

1. 决定当前子任务交给哪个执行器
2. 决定同步执行、异步执行还是人工审批挂起
3. 维护执行状态机

### 6.5 Result Synthesizer

职责：

1. 汇总多步骤结果
2. 归并结构化输出
3. 生成用户可见结果和系统内部结果

输出分两类：

1. 用户可见响应(User-facing Output)
2. 系统可消费结果(System-facing Structured Output)

---

## 七、上下文与记忆层设计(Context and Memory Layer)

### 7.1 分层

1. 原始事实层(Raw Fact Layer)
2. 运行态状态层(Runtime State Layer)
3. 历史压缩层(History Compression Layer)
4. 常驻快照层(Resident Snapshot Layer)
5. 长期事实记忆层(Long-term Factual Memory Layer)
6. 程序性记忆层(Procedural Memory Layer)

### 7.2 各层职责

#### 7.2.1 原始事实层

职责：

1. 保存对话、任务、执行、日志、产物、事件
2. 作为正式记忆晋升的事实来源

#### 7.2.2 运行态状态层

职责：

1. 服务当前任务
2. 保存中间结论、最近失败、当前工作假设
3. 保存流式输出状态，例如 `provisional / committed / revoked / replanned / blocked`
4. 在严格 token 预算下维护最小 working set，并支持确定性剪枝

#### 7.2.3 历史压缩层

职责：

1. 压缩对话上下文
2. 不得直接晋升正式记忆

#### 7.2.4 常驻快照层

职责：

1. 保存租户级稳定上下文
2. 提高读取速度
3. 默认服务热路径，但必须支持标脏(dirty) 与异步重建(rebuild)

#### 7.2.5 长期事实记忆层

职责：

1. 保存已验证事实
2. 保存长期偏好、约束、环境、资源关系

#### 7.2.6 程序性记忆层

职责：

1. 保存高复用步骤模板、操作套路、修复路径
2. 为 Skill 和执行计划提供经验支持
3. 以“条件化先验(conditional prior)”而不是“硬脚本(hard script)”的方式参与规划
4. 绑定外部可验证的环境指纹(environment fingerprint)，不允许只靠 LLM 语义猜测环境匹配
5. 在指纹失配时进入 `exploration_mode / probe-first / block` 的受控 fallback，而不是直接自由探索

### 7.3 为什么 memory 是 Harness 的一部分而不是独立孤岛

在 Harness Engineering 里，memory 不是“可选外挂”，而是控制系统的一部分。因为：

1. 没有记忆，就没有跨任务稳定性
2. 没有记忆，失败就无法沉淀为规则
3. 没有记忆，Task Planner 只能每次从零猜

---

## 八、能力注册层设计(Capability Registry Layer)

### 8.1 为什么要有注册层

系统不能依赖模型“凭记忆知道有哪些工具”。能力必须被显式注册、显式治理、显式发现。

### 8.2 两类注册表

1. `Skill Registry`
2. `Capability Registry`

### 8.3 Skill Registry

记录：

1. `skill_id`
2. `skill_type`
3. `trigger_pattern`
4. `applicability_rules`
5. `required_inputs`
6. `required_scope`
7. `risk_level`
8. `target_executor`
9. `version`
10. `state`

来源：

1. 平台内建 Skill
2. 从稳定成功路径沉淀出来的程序性记忆

### 8.4 Capability Registry

记录：

1. `capability_id`
2. `capability_kind`：`mcp_tool | internal_service | workflow | human_gate`
3. `executor_type`
4. `input_schema`
5. `output_schema`
6. `allowed_scopes`
7. `risk_level`
8. `requires_approval`
9. `tenant_policy`
10. `version`

### 8.5 发现机制

系统通过两类方式发现能力：

1. 启动时装载(Boot-time Load)
2. 运行时校验(Run-time Check)

启动时装载：

1. 配置文件
2. Registry 数据表
3. MCP 元信息

运行时校验：

1. scope 是否允许
2. 参数是否满足 schema
3. 当前 Feature Flag 是否开启
4. 当前租户是否有权限
5. 程序性记忆和高风险 capability 的 environment fingerprint 是否匹配

---

## 九、执行基座层设计(Execution Substrate Layer)

### 9.1 执行器类型

系统中的执行器分为六类：

1. Internal Query Executor
2. Internal Worker Executor
3. MCP Executor
4. Workflow Executor
5. Human Approval Executor
6. Cleanup Executor

### 9.2 Internal Query Executor

负责：

1. memory 查询
2. 索引查询
3. 审计查询
4. 只读内部服务调用

这里要额外强调一个检索边界：

**向量检索必须先做 tenant / scope / status 的前置过滤(pre-filtering)，不能只靠“先 Top-K 再回表过滤”的后置方案。**

回表校验仍然必须存在，但它是第二道保险，不是主权限机制。

### 9.3 Internal Worker Executor

负责：

1. 候选抽取
2. 生命周期扫描
3. 快照构建
4. 索引同步
5. 失败聚类

### 9.4 MCP Executor

负责：

1. 通过 MCP 调用外部系统
2. 在本方案中，MCP 是协议层，不等于某个厂商产品

职责：

1. 参数映射
2. 超时与重试
3. 错误标准化
4. 请求审计

### 9.5 Workflow Executor

负责：

1. 多步骤长流程执行
2. 任务重试
3. 状态持久化
4. 人工挂起与恢复

### 9.6 Human Approval Executor

负责：

1. 高风险动作审批
2. 人工接管
3. 驳回与重新规划

### 9.7 Cleanup Executor

负责：

1. 在主干 DAG 熔断后冻结新步骤调度
2. 按逆拓扑序执行补偿(compensation)
3. 对不可逆副作用执行 reconciliation / forward recovery
4. 在补偿失败超过极小阈值时转入 `cleanup_dlq`
5. 冻结 `tenant + scope` 的后续写权限，直到人工介入
6. 直接从 `execution_journal + compensation capsule` 读取补偿入参，而不是依赖 Runtime State
7. 在真正补偿前执行 read-before-write drift check，确认目标资源仍与 precondition_snapshot 匹配

---

## 十、验证反馈层设计(Verification and Feedback Layer)

### 10.1 验证不是测试附属品，而是系统主干

在 Harness Engineering 里，执行完就算完成是典型事故源。验证层必须和执行层并列存在。

### 10.2 组成模块

1. `Precheck Verifier`
2. `Runtime Monitor`
3. `Postcondition Verifier`
4. `Failure Analyzer`
5. `Feedback Consolidator`
6. `Circuit Breaker`
7. `Cleanup Verifier`

### 10.3 Precheck Verifier

职责：

1. 在执行前检查依赖、权限、输入、作用域、预算

### 10.4 Runtime Monitor

职责：

1. 跟踪执行状态
2. 检测超时、重试风暴、成本异常、步骤卡死
3. 识别热路径超时、流式输出冲突、异步队列积压与 cleanup plane 堵塞
4. 识别 runtime state token 膨胀并触发 Runtime State Pruner

### 10.5 Postcondition Verifier

职责：

1. 判断结果是否真的满足 acceptance criteria
2. 避免“过早宣布胜利”

### 10.6 Failure Analyzer

职责：

1. 结构化归因
2. 生成 `failure_event`
3. 输出 remediation suggestion

### 10.7 Circuit Breaker

职责：

1. 对 token、时间、调用次数、相同错误重复次数设置绝对硬阈值
2. 触发主干任务从 `running` 进入 `aborting`
3. 阻断“执行 -> 触发相同规则 -> 再执行老套路”的死循环

### 10.8 Cleanup Verifier

职责：

1. 验证补偿动作是否真的完成
2. 验证临时资源、锁、配置、中间态是否已被清理
3. 决定任务进入 `closed_clean / closed_partial / dlq_parked / manual_recovery_required`
4. 当 drift check 失配时，推动任务进入 `quarantined_drifted / reconciliation_required`

### 10.9 Feedback Consolidator

职责：

1. 把验证信号回流到：
   - memory
   - skill 质量分
   - capability 风险等级
   - 规则系统
   - 任务规划器

---

## 十一、治理与熵管理层设计(Governance and Entropy Management Layer)

### 11.1 为什么需要熵管理

Agent 很擅长复制模式，好模式会被放大，坏模式也会被放大。所以如果没有熵管理，系统会越来越快地产生越来越大的技术债。

### 11.2 组成模块

1. `Constraint Engine`
2. `Policy Engine`
3. `Doc Gardener`
4. `Drift Scanner`
5. `Debt Register`
6. `Async Pressure Controller`
7. `Index Compactor`

### 11.3 Constraint Engine

职责：

1. 维护架构约束
2. 维护输入输出契约
3. 维护层级依赖规则
4. 约束进入 Linter / CI / Runtime Check

### 11.4 Policy Engine

职责：

1. 控制风险动作
2. 控制 Feature Flag
3. 控制租户与作用域
4. 控制审批要求

### 11.5 Doc Gardener

职责：

1. 扫描文档与代码不一致
2. 维护 AGENTS.md、设计文档、知识入口点的有效性

### 11.6 Drift Scanner

职责：

1. 扫描架构漂移
2. 扫描规则失效
3. 扫描索引与正式仓不一致
4. 扫描环境指纹漂移导致的 procedural memory 失配

### 11.7 Async Pressure Controller

职责：

1. 对 failure_event、memory candidate、cleanup task 做优先级队列和背压控制
2. 对阵风型重复失败做 clustering / folding / low-value drop
3. 避免冷路径堵死后系统继续使用陈旧 snapshot 与陈旧 skill

### 11.10 Runtime State Pruner

职责：

1. 对运行态状态层执行滑动窗口(sliding window) 与语义剪枝(semantic pruning)
2. 死保 `current_goal / active_step / immediate_predecessor / open_blockers`
3. 折叠连续同质失败为 error cluster
4. 将非活跃分支压缩为 branch digest
5. 仅对 shadow state 剪枝，下一轮再切换，避免打断当前推理连续性

### 11.11 DLQ Replay Controller

职责：

1. 按共同依赖故障将 `cleanup_dlq` item 聚类为 incident cluster
2. 监听 `dependency.recovered` 等健康恢复事件
3. 对满足条件的 cluster 执行 conditional wakeup
4. 以分批、限流、可回退的方式重放 cleanup / reconciliation
5. replay 成功后驱动 scope thaw，失败则重新 park
6. 在依赖恢复后先进入 Half-Open，而不是直接全面恢复
7. 对在线新流量和 DLQ replay 流量施加双轨配额控制

### 11.8 Index Compactor

职责：

1. 对向量索引中的 tombstone 和旧版本 embedding 做物理抹除
2. 减少“幽灵索引”占据 top-k 召回坑位
3. 在低峰期执行 compaction，避免和在线召回抢资源

### 11.9 Debt Register

职责：

1. 把技术债、知识债、规则债显式记录
2. 作为后续任务规划的输入

---

## 十二、关键业务流程(Key Flows)

### 12.1 用户需求进入后的完整链路

1. 用户请求进入 Interaction Layer
2. Request Normalizer 生成 `Task Envelope`
3. 热路径优先装配 `runtime + resident snapshot + tiny retrieval`
4. Task Planner 生成 `TaskPlan` 草案
5. Capability Resolver 结合 Registry、Policy 与环境指纹做候选收缩
6. Retrieval Gateway 按预算组装上下文
7. Execution Router 路由到具体执行器
8. 执行结果进入 Verification Layer
9. 结果与失败信号写回 Memory 和 Audit
10. Result Synthesizer 生成最终输出

这里的关键不是“所有层都在首字节前跑完”，而是：

**热路径只做最小必要判断，冷路径继续异步补全。**

如果后续冷路径返回了和已输出内容冲突的高优先级事实，那么输出状态必须从 `provisional` 切换到 `revoked / replanned / blocked`，而不是让模型硬着头皮把错话往下说。

同时，冷路径中的 Memory Router 也不应该把每一条候选都交给 LLM 自由分类。
更合理的顺序是：

1. 结构化提取
2. 确定性规则打标
3. 候选排序与准入
4. 仅在价值提炼(value refinement) 时调用 LLM

### 12.2 执行完成后的输出链

执行结果必须双输出：

1. 写入系统内部结果链：
   - `task_step`
   - `artifact`
   - `failure_event`
   - `memory_candidate`
   - `audit_log`
2. 生成用户可见结果：
   - 结果摘要
   - 关键证据
   - 状态(success / partial / failed / blocked)
   - 后续建议

### 12.3 失败后的闭环

1. Failure Analyzer 生成结构化失败对象
2. memory 检索相关事实与经验
3. Task Planner 重新生成修复计划
4. 验证结果回流 Skill / Rule / Policy

### 12.4 熔断后的收口(Cleanup After Abort)

1. `Circuit Breaker` 触发后，任务从 `running` 进入 `aborting`
2. `Cleanup Executor` 冻结 DAG 的新步骤调度
3. 系统根据 `execution_journal + compensation capsule` 找出已发生副作用的步骤和精确补偿入参
4. 在补偿前先做 read-before-write drift check
5. 可补偿步骤按逆拓扑序执行 compensation
5. 不可逆步骤进入 reconciliation / forward recovery
6. `Cleanup Verifier` 校验收口结果
7. 如果补偿失败超过极小阈值，则写入 `cleanup_dlq`，生成 `zombie_state`，冻结 `tenant + scope` 写权限并转人工接管

如果 drift check 明确失配，则不应继续补偿，而应直接进入：

- `quarantined_drifted`
- `reconciliation_required`

### 12.5 依赖恢复后的唤醒与重放(Wakeup and Replay After Dependency Recovery)

1. 外部监控系统发出 `dependency.recovered`
2. 系统先从 `DOWN` 切入 `HALF-OPEN`
3. `DLQ Replay Controller` 找到受该依赖影响的 incident cluster
4. 先做 health recheck 和 thaw eligibility check
5. 在 HALF-OPEN 期间，对在线流量和 DLQ replay 流量施加双轨低配额
6. 先执行小批量 canary replay
7. 如果出现 503 / timeout / fatal drift，则立即从 `HALF-OPEN` 弹回 `DOWN`
8. 只有当在线流量和 replay 流量在时间窗口内稳定达标时，才切回 `UP`
9. 切回 `UP` 后逐步放大 replay 配额并 thaw scope

为了避免 Cleanup、Replay、Dependency 三套状态机各写各的，可以先统一成下面这张迁移表：

| 领域 | 当前状态 | 触发条件 | 下一状态 | 说明 |
|---|---|---|---|---|
| task cleanup | `running` | `Circuit Breaker` 触发 | `aborting` | 冻结新步骤调度 |
| task cleanup | `aborting` | `execution_journal + compensation_capsule` 就绪 | `compensating` | 进入补偿 |
| task cleanup | `compensating` | drift mismatch | `quarantined_drifted` | 阻断补偿 |
| task cleanup | `compensating` | 补偿成功 | `reconciling` | 进入对账 |
| task cleanup | `compensating` | 重试超阈值 | `dlq_parked` | 进入 DLQ |
| task cleanup | `reconciling` | cleanup verifier 通过 | `closed_clean` | 正常收口 |
| task cleanup | `reconciling` | 仅部分恢复 | `closed_partial` | 受控退出 |
| task cleanup | `reconciling` | 无法确认或需要人工 | `manual_recovery_required` | 转人工 |
| dependency | `DOWN` | `dependency.recovered` | `HALF-OPEN` | 恢复探测期 |
| dependency | `HALF-OPEN` | canary 失败 / 503 / timeout | `DOWN` | 回弹 |
| dependency | `HALF-OPEN` | 时间窗口成功率达标 | `UP` | 正式恢复 |
| dependency | `UP` | 健康探测失败 | `DOWN` | 重新熔断 |
| scope | `frozen` | replay + verify 成功 | `thawed` | 解冻 |
| scope | `frozen` | replay 未达标 | `frozen` | 维持冻结 |

---

## 十三、数据对象设计(Core Data Objects)

### 13.1 任务与执行对象

1. `task_request`
2. `task_plan`
3. `task_step`
4. `task_attempt`
5. `task_result`
6. `artifact`
7. `execution_journal`
8. `stream_state`
9. `compensation_capsule`
10. `dependency_state`

### 13.2 记忆对象

1. `memory`
2. `skill`
3. `resident_snapshot`
4. `memory_candidate`
5. `memory_access_log`
6. `environment_fingerprint`

### 13.3 失败与反馈对象

1. `failure_event`
2. `remediation_action`
3. `retry_chain`
4. `recovery_outcome`
5. `verification_result`
6. `cleanup_dlq`
7. `zombie_state`
8. `reconciliation_item`
9. `cleanup_incident_cluster`
10. `drift_check_result`

为避免对象只写名字不写边界，`compensation_capsule` 的最小字段可以先固定为：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `task_id` | string | 是 | 所属任务 |
| `step_id` | string | 是 | 副作用步骤 |
| `tenant` | string | 是 | 租户边界 |
| `scope` | string | 是 | 作用域边界 |
| `side_effect_class` | enum | 是 | 副作用类别 |
| `idempotency_key` | string | 是 | 幂等键 |
| `target_dependency` | string | 是 | 目标依赖 |
| `compensator_id` | string | 是 | 补偿器 |
| `compensator_version` | string | 是 | 补偿器版本 |
| `resource_locator` | object | 是 | 外部资源定位 |
| `request_payload_hash` | string | 是 | 请求哈希 |
| `precondition_snapshot` | object | 是 | 轻量漂移指纹 |
| `cleanup_precondition` | object | 否 | 补偿前置条件 |
| `fingerprint_at_execution` | string | 是 | 执行时环境指纹 |
| `committed_resource_id` | string | 否 | 外部返回的资源 ID |
| `response_handle` | string | 否 | 外部响应句柄 |
| `revision` | string | 否 | etag / revision / version |

### 13.4 治理对象

1. `capability_registry`
2. `skill_registry`
3. `constraint_rule`
4. `policy_rule`
5. `debt_item`
6. `audit_log`

---

## 十四、接口设计(Interface Design)

### 14.1 外部接口

1. `POST /v1/tasks`
2. `GET /v1/tasks/{taskId}`
3. `POST /v1/tasks/{taskId}/approve`
4. `POST /v1/tasks/{taskId}/cancel`
5. `GET /v1/tasks/{taskId}/artifacts`
6. `GET /v1/memories/search`
7. `GET /v1/skills/search`

### 14.2 内部接口

1. `POST /internal/planner/plan`
2. `POST /internal/resolver/resolve`
3. `POST /internal/router/dispatch`
4. `POST /internal/verifier/check`
5. `POST /internal/feedback/commit`
6. `POST /internal/memory/candidates`

### 14.3 接口原则

1. 外部只见任务，不直接见底层工具
2. 内部调用全部结构化，不做自由文本传递
3. 所有 effectful action 必须可审计、可回放

---

## 十五、安全、租户与审计(Security, Tenancy and Audit)

### 15.1 租户隔离

1. 所有任务、记忆、能力、日志必须带 `tenant_id`
2. 能力路由必须受租户策略控制
3. 跨租户数据绝不共享运行态上下文

### 15.2 权限

控制维度：

1. tenant
2. project
3. role
4. sensitivity
5. capability scope

### 15.3 审计

必须审计：

1. 计划生成
2. 能力选择
3. 工具调用
4. 高风险动作
5. 验证失败
6. 人工接管
7. 记忆晋升/退役

---

## 十六、可观测性(Observability)

### 16.1 核心指标

1. 任务完成率
2. 步骤重试率
3. 任务阻塞率
4. 验证失败率
5. Skill 命中率
6. 误选能力率
7. 记忆有用性评分
8. 审批触发率
9. 技术债增量趋势
10. TTFB
11. cleanup 成功率
12. cleanup DLQ backlog
13. snapshot stale ratio
14. top-k 幽灵索引占比

### 16.2 关键视图

1. 任务状态总览
2. 能力使用分布
3. 失败模式排行
4. 记忆命中/误召回
5. 规则漂移与债务看板
6. cleanup plane 状态总览
7. scope freeze 命中视图
8. 异步队列积压与背压视图

---

## 十七、实施原则(Implementation Principles)

1. 先做 Task Orchestration Layer，再做丰富工具接入。
2. 先做 Capability / Skill Registry，再做复杂执行。
3. 先做 Verification / Feedback，再做更强自治。
4. 先做 Governance / Entropy Management 的基本能力，再扩工具范围。
5. 首发不做自动回滚。
6. 先定义 Circuit Breaker 与 Cleanup Plane，再放开 effectful DAG。
7. 先定义热路径预算，再讨论更多上下文与更多记忆。

---

## 十八、验收标准(Acceptance Criteria)

1. 用户需求进入后能被结构化拆解为任务计划。
2. 系统能显式发现、筛选、调用可用能力，而不是靠模型隐性记忆。
3. 所有执行都能被记录、验证、回流。
4. 失败后能形成结构化反馈并影响后续规划或规则。
5. memory、skill、registry、policy、verification 形成闭环。
6. 高风险动作可被拦截、审批、审计和回放。
7. effectful 任务熔断后可进入受控 cleanup，而不是留下不可解释的中间态。

---

## 十九、默认假设与锁定决策(Assumptions and Defaults)

1. 本方案讨论的是 Harness Engineering 方法论下的系统设计，不是某个厂商产品接入方案。
2. 首发采用“中心编排式多角色系统”，而不是完全自治多智能体群。
3. Memory 是 Harness 的核心组成，不是外挂。
4. MCP 是协议与能力接入方式，不预设绑定某一家平台。
5. 自动回滚不进入首发能力。
