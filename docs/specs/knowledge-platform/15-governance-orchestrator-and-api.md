# 治理编排器与 API 设计

## 1. 目标

在当前 `memory-service` 基础上，定义第一版知识平台治理编排器与 API，使系统能够：

- 接收治理触发
- 编排规则任务、模型任务和人工审查
- 写入 `kp_*` 对象
- 保留当前 `memory_run_governance` 的基础能力

## 2. 组件拆分

建议新增一个治理编排层，不把全部逻辑塞进单个 endpoint。

第一版可拆为：

- `governance-trigger`
- `governance-orchestrator`
- `governance-rule-worker`
- `governance-model-worker`
- `governance-review-service`
- `governance-maintenance-worker`

## 3. 组件职责

### 3.1 `governance-trigger`

负责接收触发源：

- 显式治理请求
- 候选进入事件
- 定时任务
- 冲突重检请求

输出：

- 创建治理 job
- 投递给 orchestrator

### 3.2 `governance-orchestrator`

负责：

- 判断任务类型
- 排定执行顺序
- 聚合同批对象
- 控制是否进入模型、人工审查或 maintenance

它是治理的主调度器，不直接承担所有抽取逻辑。

### 3.3 `governance-rule-worker`

负责：

- admission
- normalization
- 去重键生成
- 基础 domain/type 判定
- 低风险状态迁移

### 3.4 `governance-model-worker`

负责：

- entity 抽取
- fact 抽取
- relation 抽取
- merge 建议
- conflict 解释
- staleness 建议
- summary / snapshot 草稿

### 3.5 `governance-review-service`

负责：

- 写入 `kp_review_queue`
- 接收人工审查动作
- 把审查结果反馈给 orchestrator

### 3.6 `governance-maintenance-worker`

负责：

- summary rebuild
- resident rebuild
- staleness scan
- graph cleanup
- orphan relation scan

## 4. 第一版 API 设计

### 4.1 `POST /internal/knowledge/governance/jobs`

用途：

- 创建治理任务

请求字段：

- `job_type`
- `trigger_type`
- `trigger_ref`
- `target_object_type`
- `target_object_ids`
- `scope`
- `priority`
- `payload`

响应字段：

- `job_id`
- `status`
- `queued_at`

### 4.2 `GET /internal/knowledge/governance/jobs/:jobId`

用途：

- 查看治理任务状态与结果

返回：

- `job_id`
- `job_type`
- `status`
- `decision`
- `created_objects`
- `updated_objects`
- `warnings`
- `trace`

### 4.3 `POST /internal/knowledge/governance/run`

用途：

- 手动触发一轮治理

适用：

- 当前阶段兼容 `memory_run_governance` 的显式使用方式

请求字段：

- `scope`
- `run_modes[]`
- `max_items`
- `include_graph_governance`
- `include_summary_rebuild`
- `include_resident_rebuild`
- `include_staleness_scan`

### 4.4 `GET /internal/knowledge/review-queue`

用途：

- 查询待审对象

过滤：

- `scope`
- `status`
- `priority`
- `review_reason`

### 4.5 `POST /internal/knowledge/review-queue/:id/actions`

用途：

- 提交人工审查动作

动作：

- `approve`
- `reject`
- `merge`
- `split`
- `deprecate`
- `archive`
- `request_more_evidence`

### 4.6 `GET /internal/knowledge/context-bundles/:id`

用途：

- 查看某次装配结果和 trace

## 5. 与现有 memory API 的关系

第一阶段不替换：

- `memory_run_governance`
- `memory_retrieve_context`

兼容策略：

- `memory_run_governance` 继续负责当前 summary / resident / lifecycle
- 新 `knowledge governance` API 负责新增对象和新治理任务
- 后续可由 `memory_run_governance` 内部调用新的治理 orchestrator

## 6. 第一版编排顺序

对“新候选进入治理”的默认顺序建议为：

1. admission
2. normalization
3. fact extraction
4. entity extraction
5. relation extraction
6. conflict check
7. staleness check
8. review routing
9. persist curated objects
10. summary / resident rebuild if needed

## 7. 批处理与聚合策略

治理不要逐条对象单飞。

建议：

- 按 `scope + trigger_type + object family` 聚合
- 小批量执行
- 对同主题候选做 cluster 级治理

这样可以减少后续模型任务和重复归并。

## 8. 幂等与重试

### 8.1 幂等键

建议使用：

- `trigger_type`
- `trigger_ref`
- `target_object_ids hash`
- `job_type`

生成幂等键，避免同批任务重复治理。

### 8.2 重试策略

规则任务失败：

- 可自动重试少量次数

模型任务失败：

- 进入 `blocked` 或 `awaiting_review`
- 不无限自动重试

人工任务：

- 不自动重试

## 9. 持久化结果策略

治理结果分三类：

### 9.1 直接持久化

适用：

- 低风险 admission 结果
- 已确认的 normalization
- 非冲突对象落表

### 9.2 待审持久化

适用：

- 冲突对象
- 低置信度 merge
- 高影响 rule_memory

### 9.3 只记 trace 不落正式对象

适用：

- 模型抽取失败
- 证据不足
- 结果不稳定

## 10. 可观测性

每个治理 job 至少记录：

- 输入对象数
- 输出对象数
- 创建 / 更新 / 废弃数量
- review queue 数量
- 总耗时
- 失败原因

每个 worker 至少记录：

- 任务类型
- 开始结束时间
- 关键 decision
- 错误分类

## 11. 第一版代码边界建议

建议目录职责：

- `services/memory-service/src/knowledge/governance/trigger`
- `services/memory-service/src/knowledge/governance/orchestrator`
- `services/memory-service/src/knowledge/governance/rule`
- `services/memory-service/src/knowledge/governance/model`
- `services/memory-service/src/knowledge/governance/review`
- `services/memory-service/src/knowledge/governance/maintenance`

这样便于从当前 memory 服务中平滑长出新层。

## 12. 第一版实施顺序

建议顺序：

1. 先起治理 job 模型和 API
2. 先接 `candidate_admission + normalization`
3. 再接 `fact extraction`
4. 再接 `entity extraction`
5. 再接 `review queue`
6. 最后接 `relation / staleness / graph cleanup`

## 13. 验收标准

该设计完成后，应能直接支持后续实现：

- 能创建治理任务
- 能编排规则和模型任务
- 能进入人工审查
- 能把结果写入 `kp_*`
- 能保留当前 memory 治理能力

如果这五点成立，就可以开始 API、job 表和 orchestrator 代码实现。
