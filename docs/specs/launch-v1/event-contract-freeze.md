# Event Contract Freeze

## 1. 通用事件封装

所有事件统一采用以下包络：

| 字段 | 必填 | 说明 |
|---|---|---|
| `event_id` | 是 | 全局唯一事件 ID |
| `event_name` | 是 | `dot-case` 事件名 |
| `event_version` | 是 | 当前固定 `v1` |
| `occurred_at` | 是 | 事件发生时间 |
| `trace_id` | 是 | 链路追踪 |
| `tenant_id` | 是 | 逻辑租户边界 |
| `scope` | 是 | 作用域边界 |
| `task_request_id` | 否 | 相关任务请求 |
| `task_plan_id` | 否 | 相关计划 |
| `task_step_id` | 否 | 相关步骤 |
| `idempotency_key` | 是 | 幂等键 |
| `producer` | 是 | 事件生产者 |
| `payload` | 是 | 业务负载 |

命名规则：

- 统一使用 `dot-case`
- 不再保留 `snake_case` 规范别名
- 规范名固定为 `scope.frozen`、`scope.thawed`、`dependency.half-opened`

## 2. 冻结事件列表

| 事件名 | Producer | Consumer | 幂等键 |
|---|---|---|---|
| `task.requested` | `agent-api` | `task-orchestrator` | `task_request_id` |
| `task.planned` | `task-orchestrator` | `resolver`, `audit` | `task_plan_id:version` |
| `task.step.dispatched` | `task-orchestrator` | `verification-service`, `audit` | `task_step_id:attempt` |
| `task.step.succeeded` | `task-orchestrator` | `verification-service`, `feedback` | `task_step_id:attempt:success` |
| `task.step.failed` | `task-orchestrator` | `verification-service`, `feedback` | `task_step_id:attempt:failure` |
| `verification.failed` | `verification-service` | `feedback`, `cleanup-coordinator` | `verification_result_id` |
| `feedback.committed` | `verification-service` | `memory-service`, `registry-service` | `task_step_id:feedback` |
| `memory.candidate.created` | `task-orchestrator`, `verification-service` | `memory-service` | `task_step_id:candidate` |
| `memory.persisted` | `memory-service` | `resident-builder`, `audit` | `persist_target:object_id:version` |
| `memory.access.logged` | `memory-service` | `audit`, `ops` | `query_kind:object_ref:trace_id` |
| `resident.snapshot.rebuilt` | `memory-service` | `task-orchestrator`, `audit` | `snapshot_key:version` |
| `memory.governance.swept` | `memory-service` | `audit`, `ops` | `task_request_id:governance_window` |
| `memory.index.synced` | `memory-service` | `audit`, `ops` | `index_target:object_id:version` |
| `memory.drift.checked` | `memory-service` | `audit`, `ops` | `task_request_id:task_step_id:drift_window` |
| `memory.reconciliation.recorded` | `memory-service` | `audit`, `ops` | `task_request_id:task_step_id:reconciliation_window` |
| `memory.zombie.detected` | `memory-service` | `audit`, `ops` | `task_request_id:task_step_id:zombie_window` |
| `task.attempt.recorded` | `task-orchestrator` | `audit`, `ops` | `task_step_id:attempt_no` |
| `debt.detected` | `governance-worker` | `debt-register`, `audit` | `tenant_id:scope:debt_hash` |
| `task.aborted` | `verification-service` | `cleanup-coordinator` | `task_request_id:abort` |
| `cleanup.started` | `cleanup-coordinator` | `audit`, `ops` | `task_step_id:cleanup:start` |
| `cleanup.parked` | `cleanup-coordinator` | `dlq-replay-controller`, `ops` | `cleanup_dlq_id` |
| `scope.frozen` | `cleanup-coordinator` | `gateway`, `ops` | `tenant_id:scope:frozen` |
| `runtime.pruned` | `runtime-state-pruner` | `audit`, `ops` | `tenant_id:scope:prune_window` |
| `dependency.recovered` | `external-monitor` | `dlq-replay-controller` | `dependency_id:recovered_at` |
| `cleanup.replay.started` | `dlq-replay-controller` | `cleanup-coordinator`, `ops` | `cluster_id:replay_batch` |
| `scope.thawed` | `dlq-replay-controller` | `gateway`, `ops` | `tenant_id:scope:thawed` |
| `drift.detected` | `cleanup-coordinator` | `ops`, `audit` | `task_step_id:drift` |
| `dependency.half-opened` | `dlq-replay-controller` | `gateway`, `ops` | `dependency_id:half-opened` |

## 3. 关键 payload 冻结

- `task.requested`：`task_type`, `goal`, `request_channel`, `priority`
- `task.planned`：`risk_level`, `acceptance_criteria`, `step_count`, `plan_hash`
- `task.step.dispatched`：`attempt_no`, `resolved_capability_id`, `step_type`, `side_effect_class`
- `task.step.failed`：`attempt_no`, `failure_code`, `retryable`, `dependency_id`
- `verification.failed`：`verification_phase`, `failure_code`, `error_signature`, `candidate_preview`
- `memory.candidate.created`：`source_type`, `artifact_tag`, `verification_status`, `fingerprint_status`, `routing_inputs`
- `memory.persisted`：`persist_target`, `object_id`, `routing_decision`, `candidate_id`
- `memory.access.logged`：`query_kind`, `object_type`, `object_ref`, `decision_summary`
- `resident.snapshot.rebuilt`：`snapshot_id`, `snapshot_key`, `source_memory_ids`, `source_skill_ids`, `dirty_reason`
- `memory.governance.swept`：`summary_ids`, `rebuilt_snapshot_id`, `downgraded_skill_ids`, `stale_index_ids`
- `memory.index.synced`：`index_target`, `object_id`, `index_backend`, `sync_action`
- `memory.drift.checked`：`drift_check_result_ids`, `matched_count`, `mismatch_count`, `unknown_count`
- `memory.reconciliation.recorded`：`reconciliation_item_ids`, `reconciliation_types`, `task_step_id`
- `memory.zombie.detected`：`zombie_state_ids`, `resource_locators`, `handoff_reason`
- `task.attempt.recorded`：`attempt_no`, `dispatch_started_at`, `outcome_code`, `resolved_capability_id`
- `task.aborted`：`abort_reason`, `active_step_id`, `cleanup_required`
- `cleanup.started`：`capsule_id`, `journal_cursor`, `target_dependency`
- `cleanup.parked`：`cleanup_dlq_id`, `retry_count`, `error_signature`, `scope_frozen`
- `dependency.recovered`：`dependency_id`, `recovered_at`, `source`
- `scope.thawed`：`cluster_id`, `replay_batch_id`, `thaw_reason`
- `drift.detected`：`capsule_id`, `resource_locator`, `probe_result`, `resolution`

## 4. 兼容性约束

1. 所有 payload 必须包含 `trace_id`。
2. 任务相关事件必须包含 `task_request_id`。
3. 步骤相关事件必须包含 `task_step_id`。
4. 不允许删除已冻结字段。
5. 如需新增字段，只能追加且保持向后兼容。
