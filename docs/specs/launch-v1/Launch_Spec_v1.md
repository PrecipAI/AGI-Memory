# Launch Spec v1

## 1. 文档定位

- 状态：`Frozen`
- 生效日期：`2026-04-23`
- 规范优先级：本规格包高于仓库内其他设计文档中的冲突表述
- 规范来源：
  - `C:\Users\qinsh\Downloads\Memory System V3.md`
  - `C:\Users\qinsh\Desktop\SuperAgentSystem\docs\Harness_Engineering_完整系统设计方案.md`
  - `C:\Users\qinsh\Desktop\SuperAgentSystem\docs\Harness_Engineering_详细落地方案.md`

凡是 P1 期间涉及表结构、状态机、内部接口、事件契约与 Memory System V3 落地边界的实现，都以本规格包为唯一规范源。

## 2. 冻结目标

Launch Spec v1 冻结以下内容：

1. 数据表与字段
2. 状态机枚举与非法迁移
3. 内部 API 契约
4. 事件名、事件载荷和幂等键

冻结策略：

- 冻结范围采用“全量冻结，按 Phase 标记实现优先级”
- 内部 API 同时保留 `/internal/cleanup/dispatch` 与 `/internal/memory/candidates`
- `/internal/feedback/commit` 保留，但不承接 cleanup 与 memory candidate 的职责
- 事件命名统一采用 `dot-case`
- `snake_case` 不再作为规范事件名保留

## 3. P1 当前优先级

### 3.1 单租户 memory validation 模式

P1 当前优先级已经切到 Memory System V3 的单租户验证落地，运行模式固定为：

- `tenant_id = tenant-local`
- `scope = memory.validation`
- `MEMORY_SINGLE_TENANT_MODE = true`

当前阶段约束：

1. 不实现多租户隔离治理、跨租户准入和跨租户回收策略。
2. schema 继续保留 `tenant_id` 字段，只作为未来扩展位。
3. 当前验收重点是 memory raw fact、summary、candidate、factual、procedural、resident、retrieval 与 governance 主链。

### 3.2 Launch Spec v1 原始 15 张基线表

基线表保留不变：

1. `task_request`
2. `task_plan`
3. `task_step`
4. `task_result`
5. `execution_journal`
6. `compensation_capsule`
7. `failure_event`
8. `cleanup_dlq`
9. `cleanup_incident_cluster`
10. `dependency_state`
11. `memory`
12. `skill`
13. `resident_snapshot`
14. `capability_registry`
15. `verification_result`

### 3.3 Memory System V3 扩展表

以下对象从 Deferred-Frozen 提升为本轮正式实现范围：

1. `message`
2. `task_run`
3. `artifact`
4. `conversation_summary`
5. `memory_candidate`
6. `environment_fingerprint`
7. `memory_access_log`

### 3.4 Memory production 治理扩展表

以下对象从 Deferred-Frozen 提升为 production memory governance 正式实现范围：

1. `drift_check_result`
2. `zombie_state`
3. `reconciliation_item`
4. `task_attempt`

## 4. 服务与实现顺序

服务实现顺序基线不变：

1. `task-orchestrator`
2. `registry-service`
3. `memory-service`
4. `verification-service`
5. `cleanup-coordinator`
6. `runtime-state-pruner`
7. `dlq-replay-controller`

当前执行优先级按 memory-first 调整为：

1. `memory-service`
2. `task-orchestrator`
3. `registry-service`
4. `verification-service`
5. `cleanup-coordinator`
6. `runtime-state-pruner`
7. `dlq-replay-controller`

## 5. Memory System V3 落地边界

本轮目标不是复杂 Agent，而是把七层 memory 主链落地：

1. raw fact：`message / task_run / artifact`
2. runtime state：仍由上游服务持有，本轮只消费其摘要输入
3. history compression：`conversation_summary`
4. resident memory：`resident_snapshot`
5. long-term factual memory：`memory`
6. procedural memory：`skill + environment_fingerprint`
7. governance / retrieval / index sync：`memory-service` 内部模块
8. access audit：`memory_access_log`
9. production governance evidence：`drift_check_result / zombie_state / reconciliation_item / task_attempt`

规则冻结：

- Memory Router 必须 rule-first，LLM 只保留 refinement 接口，默认 no-op
- `memory` 只承载 factual memory
- `skill` 只承载 procedural playbook
- `conversation_summary` 只做上下文压缩，不直接晋升正式 memory
- procedural 复用必须经过 environment fingerprint 匹配或受控降级

## 6. 当前黄金链路

Memory System V3 当前最小闭环固定为：

1. `task-orchestrator` 在 planner 入口写 `task_request / task_run / message`
2. step 执行、验证与 cleanup 证据写入 `artifact`
3. `verification-service` 产出 `memory_candidate_preview`
4. `memory-service` 持久化 `memory_candidate`
5. deterministic router 将候选路由到 `memory / skill / resident_candidate / summary_only / block`
6. governance 生成 `conversation_summary`，重建 `resident_snapshot`
7. retrieval 按 `runtime summary -> conversation summary -> resident snapshot -> gated factual/procedural` 装配上下文
8. retrieval 与 governance 写入 `memory_access_log`

## 7. 关键规范答案

### 7.1 cleanup 状态机

cleanup 规范状态固定为：

- `aborting`
- `compensating`
- `reconciling`
- `dlq_parked`
- `closed_clean`
- `closed_partial`
- `quarantined_drifted`
- `manual_recovery_required`

`compensation_failed` 不是规范状态，只能作为失败原因或事件字段。

### 7.2 capability 与 procedural 放行边界

- Resolver 只能选择已注册 capability。
- 高风险 capability 没有 `fingerprint_requirement` 不得放行。
- LLM 不能直接决定路由、权限和准入。
- procedural memory 在 `mismatch / unknown` 时只允许 `exploration / probe-first / summary-only` 降级路径。

## 8. 规格文件与实现产物

规格文件：

1. `docs/specs/launch-v1/schema-freeze.md`
2. `docs/specs/launch-v1/state-machine-freeze.md`
3. `docs/specs/launch-v1/internal-api-freeze.md`
4. `docs/specs/launch-v1/event-contract-freeze.md`

当前实现产物：

1. `db/migrations/0001_launch_spec_v1_p1.sql`
2. `db/migrations/0002_memory_system_v3_extension.sql`
3. `contracts/internal/internal-api-v1.openapi.yaml`
4. `contracts/enums/state-machines.v1.json`
5. `tests/integration/minimal-golden-path.v1.yaml`

## 9. 验收基线

当前阶段至少验证：

1. 15 张基线表和 7 张 memory 扩展表存在。
2. `task_request -> task_run` 投影一对一成立。
3. `message + task_run + artifact` 能生成 `conversation_summary`。
4. `memory_candidate` 能按规则进入 `memory / skill / summary_only / block`。
5. `resident_snapshot` 能由 factual memory 与 procedural skill 重建。
6. retrieval 在 fingerprint mismatch 时不得返回 procedural memory。
7. governance 能执行 resident rebuild、index sync 和 lifecycle sweep。
8. retrieval 与 governance 会写入 `memory_access_log`，并能返回治理统计。
