# Internal API Freeze

## 1. 规范源

本文件的可执行接口契约文件是 `contracts/internal/internal-api-v1.openapi.yaml`。

本文档冻结 P1 单租户 memory validation 模式下的业务语义、幂等规则和兼容边界。

## 2. 通用协议

### 2.1 统一请求头

所有内部接口必须透传以下头：

| 头 | 必填 | 说明 |
|---|---|---|
| `X-Tenant-Id` | 是 | 逻辑租户边界，P1 固定为 `tenant-local` |
| `X-Scope` | 是 | 作用域边界，P1 固定为 `memory.validation` |
| `X-Trace-Id` | 是 | 链路追踪 |
| `Idempotency-Key` | 是 | 幂等键 |

### 2.2 统一错误结构

所有非 `2xx` 响应都返回：

```json
{
  "error_code": "string",
  "message": "string",
  "trace_id": "string",
  "retryable": false,
  "details": {}
}
```

### 2.3 幂等规则

1. 同一 `Idempotency-Key + X-Tenant-Id + 路径` 的重复请求必须返回同一逻辑结果。
2. `router/dispatch` 对 effectful step 必须幂等。
3. `cleanup/dispatch` 对同一 capsule 必须幂等。
4. `memory/candidates` 对同一 `task_request_id + task_step_id + source_ref + candidate_hash` 必须幂等。
5. `memory/governance/run` 对同一 `task_request_id + governance_window` 必须幂等。

## 3. 冻结接口

### 3.1 `POST /internal/planner/plan`

职责：输入规范化任务信封，输出结构化 `TaskPlanDraft`，并在本地持久化 `task_request / task_run / message` 原始事实。

关键请求字段：

- `task_request_id`
- `task_type`
- `goal`
- `normalized_envelope`
- `resident_context`
- `retrieval_budget`

关键响应字段：

- `task_plan_id`
- `plan_version`
- `risk_level`
- `acceptance_criteria`
- `steps[]`

### 3.2 `POST /internal/resolver/resolve`

职责：针对单个 step 给出 capability 候选，只允许从 `capability_registry` 选择。

关键请求字段：

- `task_plan_id`
- `task_step_id`
- `step_type`
- `risk_level`
- `side_effect_class`
- `required_scopes`
- `fingerprint_context`

关键响应字段：

- `resolved_capability_id`
- `candidate_capabilities[]`
- `approval_required`
- `resolution_reason`

### 3.3 `POST /internal/router/dispatch`

职责：执行单个步骤，不允许跳过 precheck 直接 effectful dispatch，并同步写入 `artifact / execution_journal / compensation_capsule`。

关键请求字段：

- `task_request_id`
- `task_plan_id`
- `task_step_id`
- `resolved_capability_id`
- `dispatch_payload`
- `precheck_token`

关键响应字段：

- `dispatch_status`
- `attempt_no`
- `execution_reference`
- `journal_checkpoint`
- `stream_state`

### 3.4 `POST /internal/verifier/check`

职责：执行 `precheck / postcheck / acceptance / cleanup`，落 `verification_result`，必要时产出 `memory_candidate_preview`。

关键请求字段：

- `task_request_id`
- `task_plan_id`
- `task_step_id`
- `verification_phase`
- `expected_state`
- `observed_state`

关键响应字段：

- `verification_result_id`
- `verdict`
- `failure_event_id`
- `evidence_payload`
- `memory_candidate_preview`

### 3.5 `POST /internal/cleanup/dispatch`

职责：以 `execution_journal + compensation_capsule` 为唯一输入执行 cleanup。

关键请求字段：

- `task_request_id`
- `task_plan_id`
- `task_step_id`
- `cleanup_status`
- `journal_cursor`
- `capsule_id`
- `dependency_state`

关键响应字段：

- `cleanup_status`
- `drift_detected`
- `dlq_item_id`
- `scope_frozen`
- `reconciliation_required`

### 3.6 `POST /internal/memory/query`

职责：调试与验证指定 memory layer 的读取，不承担生产编排职责。

允许的 `kind`：

- `resident`
- `factual`
- `procedural`
- `summary`
- `candidate`

关键请求字段：

- `kind`
- `task_request_id`
- `fingerprint`
- `limit`

关键响应字段：

- `kind`
- `tenant_id`
- `scope`
- `items[]`

### 3.7 `POST /internal/memory/candidates`

职责：接收结构化 `memory_candidate`，持久化后执行 deterministic routing，并按结果写入 `memory / skill / resident_snapshot dirty marker / summary_only`。

关键请求字段：

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
- `candidate_payload`
- `llm_refined_payload`

关键响应字段：

- `accepted`
- `candidate_hash`
- `candidate_id`
- `candidate_status`
- `routing_decision`
- `persist_target`
- `storage_decision`

### 3.8 `POST /internal/memory/retrieve`

职责：装配 retrieval bundle，顺序固定为 `runtime summary -> conversation summary -> resident snapshot -> gated factual/procedural retrieval`。

关键请求字段：

- `task_request_id`
- `query`
- `runtime_summary`
- `fingerprint`
- `fingerprint_status`
- `include_procedural`
- `include_factual`
- `limit`

补充冻结规则：

1. `fingerprint_status` 是 retrieval gate 的强制输入，不允许服务层根据 `fingerprint` 是否存在自行猜测调用方意图。
2. 当 `include_procedural=true` 时，请求必须同时提供 `fingerprint` 与 `fingerprint_status`。
3. 只有 `fingerprint_status=matched` 时，procedural memory 才允许进入高权重召回路径。

关键响应字段：

- `runtime_summary`
- `conversation_summary[]`
- `resident_snapshot[]`
- `factual_memory[]`
- `procedural_memory[]`
- `gates`

### 3.9 `POST /internal/memory/governance/run`

职责：触发 `conversation_summary` 生成、`resident_snapshot` 重建、index sync 和 lifecycle sweep。

关键请求字段：

- `task_request_id`
- `task_step_id`
- `fingerprint`
- `rebuild_resident`
- `sync_index`
- `run_lifecycle`

关键响应字段：

- `summary_ids[]`
- `rebuilt_snapshot_id`
- `persisted_memory_ids[]`
- `persisted_skill_ids[]`
- `drift_check_result_ids[]`
- `reconciliation_item_ids[]`
- `zombie_state_ids[]`
- `index_sync`
- `lifecycle`
- `lifecycle.access_log_count`

### 3.10 `POST /internal/feedback/commit`

职责：把验证与执行反馈提交到规则、能力与记忆治理链。

关键请求字段：

- `task_request_id`
- `task_step_id`
- `verification_result_id`
- `failure_event_id`
- `capability_feedback`
- `policy_feedback`

关键响应字段：

- `feedback_status`
- `affected_objects[]`
- `committed_at`

## 4. 错误码冻结

| 错误码 | 语义 | 是否可重试 |
|---|---|---|
| `REGISTRY_NOT_FOUND` | capability 未注册 | 否 |
| `POLICY_BLOCKED` | 路由或治理策略阻断 | 否 |
| `PRECHECK_REQUIRED` | 缺少 precheck 令牌 | 否 |
| `FINGERPRINT_STATUS_REQUIRED` | 缺少 retrieval gate 必需的 `fingerprint_status` | 否 |
| `FINGERPRINT_REQUIRED` | 请求 procedural retrieval 但未提供 `fingerprint` | 否 |
| `FINGERPRINT_MISMATCH` | 环境指纹失配 | 否 |
| `DEPENDENCY_DOWN` | 依赖不可用 | 是 |
| `DRIFT_DETECTED` | cleanup 前漂移校验失败 | 否 |
| `DLQ_PARKED` | 自动 cleanup 已入 DLQ | 否 |
| `SINGLE_TENANT_ONLY` | 非默认租户或作用域请求 | 否 |

## 5. 兼容性要求

1. 字段新增只能追加，不能改名。
2. 已冻结路径不得合并职责。
3. `cleanup` 与 `memory candidates` 必须是两条独立契约。
4. `memory/retrieve` 不得直接返回索引载荷，命中后必须回表到 `memory` 或 `skill`。
5. LLM refinement 只允许作为 `llm_refined_payload` 的可选输入，不得取代 deterministic routing。
