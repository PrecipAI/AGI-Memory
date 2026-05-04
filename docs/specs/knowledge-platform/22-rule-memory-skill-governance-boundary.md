# Rule / Memory / Skill 治理边界修订

对应项目：
- `D:\workspace\projects\SuperAgentSystem-main`

本文件修订当前长期知识系统中的 `memory / rule / skill / knowledge` 边界，作为后续实现 rule governance、memory governance 和 skill governance 的依据。

## 1. 修订原因

当前实现和部分旧文档仍把 `constraint_fact / project_constraint` 路由到 `memory`。

这不准确。

约束不是普通事实。约束会影响 planner、router、resolver、executor 和 context assembly 的行为边界，因此应该抽成 `rule`。

经验也不是普通 memory。只要它能指导后续执行，就应该进入 `skill` 治理链路。

因此新的分层是：

```text
knowledge: 外部资料治理后的结论 + 来源
memory: 稳定事实、偏好、状态和已确认决策
rule: 约束、政策、边界、禁止项、准入条件
skill: 可执行经验、流程、playbook、修复路径
```

## 2. 当前实现状态

当前物理表已有：

- `memory`
- `skill`
- `memory_candidate`
- `resident_snapshot`

当前物理表缺失：

- `rule`
- `rule_candidate`
- `rule_evidence`
- `rule_revision`
- `rule_decision`

当前代码问题：

- `D:\workspace\projects\SuperAgentSystem-main\services\memory-service\src\memoryRouter.ts`
- `FACTUAL_MEMORY_ARTIFACT_TAGS` 仍包含 `constraint_fact`、`project_constraint`、`implementation_note`。
- 当前实际路由是 `constraint_fact + verified + matched_or_na -> memory`。

当前文档问题：

- `D:\workspace\projects\SuperAgentSystem-main\docs\specs\launch-v1\schema-freeze.md`
- 冻结矩阵仍写着 `environment_fact / profile_fact / constraint_fact + verified + matched_or_na -> memory`。

这些都需要在后续实现中修订。

## 3. 新边界定义

### 3.1 Memory

`memory` 只保存稳定事实与状态，不直接表达行为约束。

适合进入 memory：

- 用户画像事实。
- 项目事实。
- 环境事实。
- 已确认架构决策。
- 当前机器路径、端口、服务状态等长期有效事实。
- 用户偏好中的事实性描述。

不应进入 memory：

- 禁止项。
- 必须遵守的流程约束。
- 权限、风险、安全策略。
- 可执行经验。
- 修复步骤。

### 3.2 Rule

`rule` 保存对系统行为有约束力的规则。

适合进入 rule：

- 用户拒绝偏好。
- 项目约束。
- 工程执行边界。
- 安全策略。
- 准入条件。
- 路由条件。
- 召回限制。
- 触发条件。
- 质量门禁。

示例：

- 不默认 MVP，除非用户明确要求。
- workspace 目录是机器自定义路径，迁移或 clone 前必须确认。
- facts/entities/relations 是治理中间产物，不作为长期默认召回对象。
- procedural memory 必须 fingerprint matched 才能进入高权重召回。
- 低质量 Markdown 不进入知识治理。

### 3.3 Skill

`skill` 保存可执行的过程知识。

适合进入 skill：

- 失败修复经验。
- 重复出现的工作流。
- 已验证操作 playbook。
- 工具接入步骤。
- 调试路径。
- 可复用执行规范。
- 有明确触发条件和退出条件的行动流程。

示例：

- Memory MCP 报 UUID 校验错误时，用 UUID 格式的 `task_request_id/task_step_id` 重试。
- Windows 上用 UTF-8 Node 脚本发送中文 JSON，避免 PowerShell 编码变成 `???`。
- codex-config 同步流程。

### 3.4 Knowledge

`knowledge` 保存外部资料或研究资料经过治理后的认知产物。

适合进入 knowledge：

- 跨来源总结。
- 设计原则。
- 技术判断。
- 领域知识。
- 抽象规律。

knowledge 必须保存 evidence/source trace。

## 4. 路由矩阵修订

新的候选路由应改为：

| 候选类型 | 条件 | 目标 |
|---|---|---|
| `environment_fact` | verified + matched_or_na | `memory` |
| `profile_fact` | verified + matched_or_na | `memory` |
| `architecture_decision` | verified + matched_or_na | `memory` |
| `project_state` | verified + matched_or_na | `memory` |
| `constraint_fact` | verified + matched_or_na | `rule_candidate` |
| `project_constraint` | verified + matched_or_na | `rule_candidate` |
| `rejection_preference` | verified + matched_or_na | `rule_candidate` |
| `policy_constraint` | verified + matched_or_na | `rule_candidate` |
| `quality_gate` | verified + matched_or_na | `rule_candidate` |
| `verified_fix` | verified_fix + matched | `skill_candidate` |
| `workflow_tag=standard_path` | verified + matched | `skill_candidate` |
| `recurring_experience` | verified + matched | `skill_candidate` |
| `knowledge_source` | normalized + evidence_available | `knowledge` ingestion |
| `summary_only` | unverified or transient | `summary_only / drop` |
| high risk + unverified + mismatch/unknown | blocked | `block` |

第一版可以先不新增 `rule_candidate` 表，而是让 `memory_candidate.persist_target` 增加 `rule`。

但长期设计应保留 `rule_candidate`，因为 rule 的治理状态、风险等级、适用范围和冲突判断不同于 memory。

## 5. Rule 数据模型

建议新增 `rule` 表。

核心字段：

- `id`
- `tenant_id`
- `scope`
- `status`
- `version`
- `rule_key`
- `rule_type`
- `title`
- `statement`
- `normalized_statement`
- `applies_to`
- `trigger_conditions`
- `enforcement_level`
- `priority`
- `risk_level`
- `verification_status`
- `source_refs`
- `evidence_refs`
- `supersedes_rule_id`
- `metadata`
- `trace_id`
- `created_at`
- `updated_at`

`rule_type` 建议：

- `user_preference_rule`
- `rejection_rule`
- `workspace_rule`
- `routing_rule`
- `retrieval_rule`
- `security_rule`
- `quality_gate_rule`
- `governance_rule`
- `execution_boundary_rule`

`enforcement_level` 建议：

- `hard_block`
- `must_follow`
- `should_follow`
- `advisory`

## 6. Rule 治理流程

```text
candidate ingest
-> classify factual/procedural/rule/knowledge
-> rule candidate
-> normalize statement
-> detect duplicate
-> detect conflict
-> detect supersession
-> assign enforcement level
-> assign applies_to
-> create governance_change_proposal
-> wait for human approval
-> apply approved change
-> rebuild rule bundle / resident snapshot
```

治理重点：

- 不把一次性口头描述直接变强规则。
- 用户明确“不要 / 必须 / 默认 / 除非”时，高优先级进入 rule。
- 后续用户修正时，系统只能生成 `replace_rule` proposal，不能直接 supersede 旧 rule。
- 有冲突时，系统只能生成 conflict proposal，不能直接修改 active rule。
- rule / skill 治理发现需要变动时，必须汇总成人类可审查的 proposal。
- 只有人类 approve 后，才能真正修改 active rule 或 skill。

## 7. Harness 结合方式

这套系统不是单独 memory，而是 memory 与 harness 结合。

因此 rule 的消费方不是普通检索，而是 harness 执行链：

```text
Planner
-> 读取目标相关 rule，约束方案生成

Resolver
-> 用 rule 约束 skill / tool / MCP / service 选择

Router
-> 用 rule 决定候选流向、风险门禁、执行路径

Executor
-> 用 skill 执行，用 rule 校验边界

Context Assembly
-> memory 提供事实上下文
-> rule 提供行为约束
-> skill 提供可执行流程
-> knowledge 提供领域依据
```

## 8. 与 Resident Snapshot 的关系

`resident_snapshot` 不应该只从 memory 和 skill 重建。

应拆成：

- `resident_memory_context`
- `resident_rule_context`
- `resident_skill_context`

第一版可以仍存在一个 `resident_snapshot` 表，但 payload 必须显式分区：

```json
{
  "memory": [],
  "rules": [],
  "skills": []
}
```

不能把 rule 文本混在 memory notes 里。

## 9. 与 Skill 治理的边界

rule 和 skill 的区别：

- rule 说“什么必须/禁止/默认/边界是什么”。
- skill 说“遇到某类任务具体怎么做”。

例子：

- “必须使用 UTF-8”是 rule。
- “Windows PowerShell 中文 JSON 用 Node fetch 发，避免编码变 `???`”是 skill。
- “不要默认最小可行方案”是 rule。
- “做工程设计时按目标、边界、数据、接口、状态、风险、验收展开”是 skill 或 design guideline。

## 10. 与 Knowledge 治理的边界

knowledge 中可以产出 `derived_rule`，但 `derived_rule` 不等于立即生效的 harness rule。

外部资料推导出的规则必须经过 rule governance：

```text
knowledge derived_rule
-> rule_candidate
-> rule governance
-> active rule
```

否则外部资料会直接改变 agent 行为，风险过高。

## 11. 实施顺序

### Phase 1：修正路由语义

- 从 factual memory tags 中移除 `constraint_fact / project_constraint`。
- 增加 `rule` persist target 或临时使用 `rule_candidate` 状态。
- 更新 `verify-memory-system.mjs`。
- 更新 schema freeze 文档。

### Phase 2：新增 rule 表

- 增加 migration。
- 增加 db repository。
- 增加 `RuleBuilder`。
- 增加 `queryActiveRules`。

### Phase 3：Rule Governance

- 去重。
- 冲突检测。
- supersede。
- enforcement level。
- applies_to 归类。
- governance change proposal。
- human approve / reject 后再应用变更。

### Phase 4：Context Assembly 接入

- `memory_retrieve_context` 返回 rules 独立字段。
- resident snapshot payload 显式拆为 memory/rules/skills。
- planner/router/resolver 消费 rules。

### Phase 5：Ops Console

- 展示 active rules。
- 展示 rule 冲突。
- 展示 rule 来源。
- 展示 superseded rule 链。

## 12. 验收标准

- `constraint_fact` 不再进入 `memory`。
- verified constraint 会进入 `rule` 或 `rule_candidate`。
- `memory` 只包含稳定事实、偏好和决策。
- `skill` 只包含可执行流程。
- `rule` 能独立召回、独立治理、独立展示。
- resident snapshot 不再混合 memory/rule/skill。
- harness planner/router/resolver 能读取 rule 并约束行为。
