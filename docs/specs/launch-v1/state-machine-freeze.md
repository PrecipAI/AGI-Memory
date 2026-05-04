# State Machine Freeze

## 1. 规范源

本文件的可执行枚举源是 `contracts/enums/state-machines.v1.json`。

本文件负责说明状态机的业务语义、触发条件、终态和非法迁移示例。

## 2. Task Step 状态机

### 2.1 枚举

- `pending`
- `ready`
- `running`
- `blocked`
- `succeeded`
- `failed`
- `cancelled`
- `aborting`

### 2.2 终态

- `succeeded`
- `failed`
- `cancelled`

### 2.3 规范迁移

| 当前状态 | 触发条件 | 下一个状态 | 说明 |
|---|---|---|---|
| `pending` | 依赖满足 | `ready` | 可进入调度 |
| `ready` | Router 派发成功 | `running` | 开始执行 |
| `ready` | 缺能力或策略拦截 | `blocked` | 被规则挡住 |
| `running` | 执行成功 | `succeeded` | 正常结束 |
| `running` | 非 cleanup 类失败 | `failed` | 失败退出 |
| `running` | 用户取消 | `cancelled` | 受控取消 |
| `running` | 熔断触发且为 effectful step | `aborting` | 交给 cleanup plane |
| `blocked` | 阻塞条件消除 | `ready` | 重新进入调度 |

### 2.4 非法迁移示例

1. `pending -> running`
2. `failed -> running`
3. `succeeded -> aborting`
4. `cancelled -> ready`

## 3. Cleanup 状态机

### 3.1 枚举

- `aborting`
- `compensating`
- `reconciling`
- `dlq_parked`
- `closed_clean`
- `closed_partial`
- `quarantined_drifted`
- `manual_recovery_required`

### 3.2 终态

- `dlq_parked`
- `closed_clean`
- `closed_partial`
- `quarantined_drifted`
- `manual_recovery_required`

### 3.3 规范迁移

| 当前状态 | 触发条件 | 下一个状态 | 说明 |
|---|---|---|---|
| `aborting` | `execution_journal + compensation_capsule` 就绪 | `compensating` | 开始补偿 |
| `compensating` | drift mismatch | `quarantined_drifted` | 阻断补偿，等待对账 |
| `compensating` | 补偿成功 | `reconciling` | 进入收口校验 |
| `compensating` | 自动重试超阈值 | `dlq_parked` | 写入 DLQ |
| `reconciling` | cleanup verifier 通过 | `closed_clean` | 收口成功 |
| `reconciling` | 仅部分恢复 | `closed_partial` | 受控退出 |
| `reconciling` | 无法确认或需要人工 | `manual_recovery_required` | 转人工 |

### 3.4 非法迁移示例

1. `aborting -> closed_clean`
2. `compensating -> closed_clean`
3. `dlq_parked -> compensating`
4. `quarantined_drifted -> compensating`

补充说明：

- `compensation_failed` 不是规范状态，只能作为 `failure_reason`
- Cleanup 读取来源只允许是 `execution_journal + compensation_capsule`

## 4. Dependency 状态机

### 4.1 枚举

- `DOWN`
- `HALF-OPEN`
- `UP`

### 4.2 终态

无永久终态，为循环状态机。

### 4.3 规范迁移

| 当前状态 | 触发条件 | 下一个状态 | 说明 |
|---|---|---|---|
| `DOWN` | `dependency.recovered` | `HALF-OPEN` | 只放极小流量 |
| `HALF-OPEN` | canary 失败、`503`、`timeout`、fatal drift | `DOWN` | 立即回弹 |
| `HALF-OPEN` | 时间窗口成功率达标 | `UP` | 正式恢复 |
| `UP` | 健康探测失败 | `DOWN` | 再次熔断 |

### 4.4 非法迁移示例

1. `DOWN -> UP`
2. `UP -> HALF-OPEN`
3. `HALF-OPEN -> HALF-OPEN`

## 5. Stream State 状态机

### 5.1 枚举

- `provisional`
- `committed`
- `revoked`
- `replanned`
- `blocked`

### 5.2 终态

- `committed`
- `revoked`
- `replanned`
- `blocked`

### 5.3 规范迁移

| 当前状态 | 触发条件 | 下一个状态 | 说明 |
|---|---|---|---|
| `provisional` | 冷路径验证通过 | `committed` | 正式确认 |
| `provisional` | 高优先级冲突事实返回 | `revoked` | 撤回先前输出 |
| `provisional` | 需要重新规划 | `replanned` | 进入新计划 |
| `provisional` | 策略或权限阻断 | `blocked` | 停止继续输出 |

### 5.4 非法迁移示例

1. `committed -> provisional`
2. `blocked -> committed`
3. `revoked -> committed`

## 6. 分离原则

1. `task_step` 状态机不承接 cleanup 终态
2. `cleanup` 状态机不复用 stream state
3. `stream_state` 只描述输出可撤回性，不描述执行可补偿性
4. `dependency` 状态机独立于任务状态机
