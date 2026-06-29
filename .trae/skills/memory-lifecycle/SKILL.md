---
name: memory-lifecycle
description: 触发 memory-service 的 lifecycle 维护任务（重算 importance_weight、归档低权重知识、阈值校准）。Invoke when user says 整理记忆 / 跑生命周期 / 清理过期知识 / 重算权重 / 归档旧知识，或调用方明确需要 lifecycleWorker 显式触发.
---

# Memory Lifecycle

触发 memory-service 的 `LifecycleWorker.run`，做以下维护：

1. **recomputeImportanceWeights**（fix-8-3）：重算 `kp_synthesized_knowledge.importance_weight`
   - 三因子加权：`0.3×recency + 0.3×frequency + 0.4×utility`
   - utility 从 `kp_retrieve_quality_log` 反推（同 scope 最近 30 天平均 term_hit_ratio）
   - 数据不足时降级（session_outcomes < 300 全写 0.5）

2. **archiveStaleSynthesizedKnowledge**（fix-8-3）：归档低权重知识
   - 阈值：`importance_weight < 0.2` 持续 30 天
   - 归档保护：同 scope 平均 term_hit_ratio < 0.4 时跳过归档（retrieve 的锅不扣知识头上）
   - 样本不足 10 条时跳过归档

3. **calibrateL2Thresholds**（fix-7）：阈值自适应校准

4. 其他 retire/downgrade/重建任务

## 何时调用

- 用户说"整理记忆" / "跑生命周期" / "清理过期知识" / "重算权重" / "归档旧知识"
- 用户感觉 retrieve 召回质量下降，想让系统重新评估重要性
- 长时间未跑过 lifecycle（建议每周 1 次，但当前需要用户显式触发）

## 怎么调用

通过 MCP 调用 memory-service 的 governance-run 接口，**显式传 `run_lifecycle: true`**：

```
POST /internal/memory/governance/run
{
  "task_request_id": "<unique-id>",
  "run_lifecycle": true,
  ...
}
```

或通过 host-capture governance-run 接口（如果同时在做 host_capture）：

```
POST /internal/host-capture/:host/governance-run
{
  "task_request_id": "<unique-id>",
  "run_lifecycle": true,
  ...
}
```

**注意**：fix-9 后 lifecycle 默认不自动触发，必须显式 `run_lifecycle: true`。

## 返回值关键字段

- `lifecycle.reweighted_knowledge_count`：重算的条数
- `lifecycle.reweight_degraded`：是否走降级模式（session_outcomes 不足）
- `lifecycle.reweight_reason`：降级原因
- `lifecycle.archived_stale_knowledge_count`：归档的条数
- `lifecycle.archive_skipped_count`：跳过归档的条数
- `lifecycle.archive_skipped_reason`：跳过原因（`retrieve_quality_poor:0.358` 或 `retrieve_quality_sample_too_small:5`）
- `lifecycle.threshold_calibration`：阈值校准结果

## 注意事项

- lifecycle 不会破坏数据：归档是状态变更（lifecycle_state='archived'），不是删除
- 归档保护生效时（retrieve_quality 整体 poor），归档会跳过——这是设计如此，不要手动绕过
- 降级模式下 importance_weight 全写 0.5，不区分度，但也不惩罚新知识
- utility_score 是 scope 级别（同 scope 共用一个值），后期可改成 per-knowledge utility

## 不做什么

- 不做"按需重算单条知识"（当前是 scope 级别批量重算）
- 不做定时任务（需要宿主侧定时器，留后续）
- 不做 utility_score 手动调整入口（自动反推够用）
