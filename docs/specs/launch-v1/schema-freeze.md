# Schema Freeze

## 1. 适用范围

本文档冻结 Launch Spec v1 在 P1 单租户 memory validation 模式下的数据对象、字段边界、索引策略和 Phase 标记。

单租户运行上下文固定为：

- `tenant_id = tenant-local`
- `scope = memory.validation`
- `MEMORY_SINGLE_TENANT_MODE = true`

多租户字段不删除，但 P1 不实现跨租户治理。

## 2. 全局共享字段

所有正式对象至少包含以下字段：

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | `uuid` | PK | 主键 |
| `tenant_id` | `text` | not null | 逻辑租户边界 |
| `scope` | `text` | not null | 作用域边界 |
| `status` | `text` 或受限枚举 | not null | 当前业务状态 |
| `version` | `integer` | not null, default `1` | 乐观版本 |
| `created_at` | `timestamptz` | not null | 创建时间 |
| `updated_at` | `timestamptz` | not null | 更新时间 |

补充约束：

1. 所有检索类对象必须至少具备 `(tenant_id, scope, status)` 复合索引。
2. 所有任务链对象必须保留 `trace_id`。
3. `execution_journal` 与 `compensation_capsule` 独立于 runtime state，不允许混表。
4. `dependency_state` 独立建模 `DOWN / HALF-OPEN / UP`。
5. `cleanup_dlq` 与 `cleanup_incident_cluster` 独立建模，并支持按依赖故障聚类。

## 3. P1 已落地物理表

### 3.1 编排与执行真源

| 表 | 用途 | 关键附加字段 |
|---|---|---|
| `task_request` | 任务入口与规范化请求真源 | `request_channel`, `requester_id`, `task_type`, `goal`, `normalized_envelope`, `idempotency_key`, `trace_id` |
| `task_plan` | Planner 结构化计划真源 | `task_request_id`, `planning_model`, `plan_hash`, `acceptance_criteria`, `risk_level`, `plan_payload`, `trace_id` |
| `task_step` | 计划内最小执行单元 | `task_plan_id`, `step_key`, `step_order`, `step_type`, `side_effect_class`, `capability_hint`, `compensation_hint`, `assigned_capability_id`, `trace_id` |
| `task_result` | 用户可见输出和系统结构化输出汇总 | `task_request_id`, `task_plan_id`, `final_step_id`, `output_state`, `system_result`, `verification_summary`, `cleanup_summary`, `trace_id` |
| `execution_journal` | effectful step 关键检查点日志 | `task_request_id`, `task_plan_id`, `task_step_id`, `journal_seq`, `checkpoint`, `effect_phase`, `dependency_id`, `resource_locator`, `payload_hash`, `journal_payload`, `trace_id` |
| `compensation_capsule` | cleanup 精确补偿上下文 | `task_request_id`, `task_plan_id`, `task_step_id`, `target_dependency`, `compensator_id`, `resource_locator`, `request_payload_hash`, `fingerprint_at_execution`, `committed_resource_id`, `trace_id` |
| `failure_event` | 失败归因对象 | `task_request_id`, `task_plan_id`, `task_step_id`, `failure_code`, `failure_class`, `error_signature`, `dependency_id`, `verifier_phase`, `detail_payload`, `trace_id` |
| `verification_result` | verifier 正式结果 | `task_request_id`, `task_plan_id`, `task_step_id`, `verification_phase`, `verdict`, `verifier_id`, `evidence_payload`, `failure_event_id`, `trace_id` |
| `cleanup_dlq` | cleanup 自动收口失败死信 | `task_request_id`, `task_plan_id`, `task_step_id`, `dependency_id`, `error_signature`, `compensator_id`, `fingerprint`, `retry_count`, `replay_after`, `trace_id` |
| `cleanup_incident_cluster` | DLQ 聚类对象 | `dependency_id`, `error_signature`, `compensator_id`, `fingerprint`, `affected_item_count`, `dependency_state_snapshot`, `thaw_eligible`, `trace_id` |
| `dependency_state` | 外部依赖状态机 | `dependency_id`, `display_name`, `last_probe_result`, `failure_rate`, `last_failure_at`, `last_recovered_at`, `half_open_since`, `trace_id` |

### 3.2 Registry 与长期记忆真源

| 表 | 用途 | 关键附加字段 |
|---|---|---|
| `capability_registry` | Resolver 唯一 capability 真源 | `capability_key`, `capability_type`, `task_types`, `risk_level`, `fingerprint_requirement`, `approval_mode`, `trace_id` |
| `memory` | factual memory 真源 | `memory_type`, `title`, `content`, `normalized_content`, `source_kind`, `source_ref`, `verification_status`, `fingerprint_requirement`, `tags`, `metadata`, `importance`, `confidence_score`, `supersedes_id`, `trace_id` |
| `skill` | procedural playbook 真源 | `skill_key`, `title`, `description`, `skill_type`, `trigger_conditions`, `procedure_payload`, `verification_status`, `fingerprint_requirement`, `risk_level`, `success_rate`, `tags`, `trace_id` |
| `resident_snapshot` | 热路径稳定小快照 | `snapshot_key`, `snapshot_payload`, `source_memory_ids`, `source_skill_ids`, `dirty_reason`, `generated_at`, `expires_at`, `trace_id` |

## 4. Memory System V3 扩展表

以下对象从 Deferred-Frozen 提升为本轮正式实现范围。

### 4.1 `message`

用途：原始会话事实真源。

核心字段：

- `task_request_id`
- `role`
- `content`
- `normalized_content`
- `message_type`
- `metadata`
- `trace_id`

索引与约束：

- index(`tenant_id`, `scope`, `status`)
- index(`task_request_id`, `created_at`)

### 4.2 `task_run`

用途：memory pipeline 对 `task_request` 的运行时投影，与 `task_request` 一对一。

核心字段：

- `task_request_id`
- `run_status`
- `goal`
- `started_at`
- `finished_at`
- `recovery_state`
- `trace_id`

索引与约束：

- unique(`task_request_id`)
- index(`tenant_id`, `scope`, `status`)
- index(`run_status`, `started_at`)

### 4.3 `artifact`

用途：承接检索结果、验证结果、草稿、执行产物和修复证据。

核心字段：

- `task_request_id`
- `task_step_id`
- `artifact_type`
- `artifact_tag`
- `content`
- `structured_payload`
- `verification_status`
- `side_effect_class`
- `source_ref`
- `trace_id`

索引与约束：

- index(`tenant_id`, `scope`, `status`)
- index(`task_request_id`, `artifact_type`, `artifact_tag`)
- index(`task_step_id`, `created_at`)

### 4.4 `conversation_summary`

用途：对原始事实做历史压缩，仅用于上下文注入，不允许直接晋升正式 memory。

核心字段：

- `task_request_id`
- `summary_key`
- `summary_type`
- `source_range_start`
- `source_range_end`
- `summary_payload`
- `supersedes_id`
- `rebuild_status`
- `trace_id`

索引与约束：

- unique(`tenant_id`, `scope`, `summary_key`, `version`)
- index(`tenant_id`, `scope`, `status`)
- index(`task_request_id`, `summary_type`)

### 4.5 `memory_candidate`

用途：memory ingress 的结构化候选对象。

核心字段：

- `task_request_id`
- `task_step_id`
- `source_type`
- `source_ref`
- `artifact_tag`
- `error_code`
- `verification_status`
- `side_effect_class`
- `fingerprint`
- `fingerprint_status`
- `routing_decision`
- `rank_score`
- `candidate_payload`
- `llm_refined_payload`
- `trace_id`

状态固定为：

- `extracted`
- `ranked`
- `routed`
- `persisted`
- `dropped`
- `blocked`

指纹状态固定为：

- `matched`
- `matched_or_na`
- `mismatch`
- `unknown`

索引与约束：

- index(`tenant_id`, `scope`, `status`)
- index(`task_request_id`, `task_step_id`, `created_at`)
- index(`artifact_tag`, `verification_status`, `fingerprint_status`)
- index(`routing_decision`, `rank_score`)

### 4.6 `environment_fingerprint`

用途：procedural memory 与 runtime environment 的绑定真源。

核心字段：

- `fingerprint_key`
- `capability_version`
- `config_hash`
- `schema_version`
- `dependency_signature`
- `deployment_baseline_id`
- `status`
- `trace_id`

索引与约束：

- unique(`tenant_id`, `scope`, `fingerprint_key`)
- index(`tenant_id`, `scope`, `status`)

### 4.7 `memory_access_log`

用途：记录 retrieval、query 和 governance 的访问决策审计。

核心字段：

- `memory_id`
- `query_kind`
- `query_payload`
- `decision_payload`
- `object_type`
- `object_ref`
- `trace_id`

索引与约束：

- index(`tenant_id`, `scope`, `status`)
- index(`query_kind`, `created_at`)
- index(`memory_id`, `created_at`)

## 5. Memory 路由与入层约束

1. `memory` 只承载 factual memory，不再写入 procedural playbook 或约束规则。
2. `rule` 承载 constraint / policy / rejection / quality gate / routing boundary。
3. `skill` 只承载 procedural memory。
4. `conversation_summary` 只做上下文压缩，不直接提升为正式 memory。
5. `memory_candidate` 必须先持久化，再允许进入 router / governance。
6. `resident_snapshot` 必须显式拆分 memory / rules / skills，不能把规则混入 factual memory notes。
7. procedural 复用必须绑定 `environment_fingerprint`，没有匹配不得进入高权重召回。
8. rule / skill 治理发现需要修改已生效对象时，必须先写入 `governance_change_proposal`，等待人类 approve/reject；未批准前不得直接修改 active rule 或 skill。

默认路由矩阵冻结为：

| 条件 | 结果 |
|---|---|
| `environment_fact / profile_fact / design_decision + verified + matched_or_na` | `memory` |
| `constraint_fact / project_constraint / rejection_preference / policy_constraint / quality_gate + verified + matched_or_na` | `rule` |
| `resident_hint + verified + 高频命中` | `resident_candidate` |
| `allowlist error_code + verified_fix + matched` | `skill` |
| `workflow_tag=standard_path + verified + matched` | `skill` |
| `summary_only / 一次性噪音 + unverified` | `conversation_summary / drop` |
| `高风险修复 + unverified + mismatch_or_unknown` | `block / summary_only` |

## 6. Production Governance 扩展表

以下对象已进入 production memory platform 物理表：

| 对象 | 关键字段 |
|---|---|
| `drift_check_result` | `task_request_id`, `task_step_id`, `resource_locator`, `probe_payload`, `match_result`, `drift_reason`, `trace_id` |
| `zombie_state` | `task_request_id`, `task_step_id`, `resource_locator`, `handoff_reason`, `operator_owner`, `remediation_payload`, `trace_id` |
| `reconciliation_item` | `task_request_id`, `task_step_id`, `reconciliation_type`, `expected_state`, `observed_state`, `action_state`, `trace_id` |
| `task_attempt` | `task_request_id`, `task_plan_id`, `task_step_id`, `attempt_no`, `dispatch_payload`, `dispatch_started_at`, `dispatch_finished_at`, `outcome_code`, `outcome_payload`, `trace_id` |

## 7. 实施约束

1. Launch Spec v1 的原 15 张表保留不变，Memory V3 扩展表通过后续 migration 增量追加。
2. 所有 SQL 落地前，字段名必须与本文档逐项对齐。
3. 单租户模式下仍保留 `tenant_id` 和 `scope` 过滤，但所有服务默认只接受 `tenant-local / memory.validation`。
4. 非默认租户请求必须显式拒绝，不允许“先放过去再说”。
