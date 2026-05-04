# 治理任务协议设计

## 1. 目标

定义统一长期知识系统治理层的任务协议，明确：

- 哪些任务由规则完成
- 哪些任务由模型完成
- 哪些任务进入人工审查
- 各任务的输入、输出、触发、状态和失败处理

本设计遵守当前已定原则：

- 写入入口规则优先
- 正式知识形成主要在治理层
- 图谱整理属于治理层
- 模型参与治理，但不单独拥有最终裁决权

## 2. 治理层职责

治理层负责 6 件事：

1. 候选准入
2. 抽取与归一化
3. 图谱归并与冲突处理
4. 时效治理
5. 摘要与快照重建
6. 审查与回退

## 3. 治理任务总分类

第一版治理任务拆成 4 类。

### 3.1 `rule_governance_job`

规则驱动任务，低成本、高频、确定性。

适用：

- 格式校验
- 基础去重
- 候选分域初判
- 低风险状态迁移
- 基础时效扫描

### 3.2 `model_governance_job`

模型驱动任务，用于语义抽取和复杂治理。

适用：

- entity 抽取
- fact 抽取
- relation 抽取
- 合并建议
- 冲突说明
- 时效复核建议
- summary / snapshot 生成

### 3.3 `human_review_job`

人工审查任务，用于高价值、高风险、高歧义对象。

适用：

- 规则冲突
- 低置信度合并
- 高影响 rule_memory
- 大范围 supersede
- 模型分歧大

### 3.4 `maintenance_job`

系统维护型治理任务。

适用：

- 索引刷新
- 过期归档
- 脏对象清理
- 孤立节点扫描
- resident / summary rebuild

## 4. 治理触发机制

第一版支持 3 类触发。

### 4.1 显式触发

来源：

- 用户明确要求治理
- 用户要求整理记忆
- 用户要求图谱整理

### 4.2 事件触发

来源：

- 新候选对象入池
- 某对象发生状态变更
- 新证据命中已有 fact / entity / relation
- 新冲突被检测到

### 4.3 定时触发

来源：

- 定期摘要重建
- 定期图谱归并
- 定期时效检查
- 定期 review backlog 清理

## 5. 治理任务通用协议

所有治理任务建议统一协议字段。

### 5.1 输入字段

- `job_id`
- `job_type`
- `tenant_id`
- `scope`
- `trigger_type`
- `trigger_ref`
- `target_object_type`
- `target_object_ids[]`
- `priority`
- `requested_by`
- `requested_at`
- `payload json`

### 5.2 输出字段

- `job_id`
- `status`
- `decision`
- `created_objects[]`
- `updated_objects[]`
- `deprecated_objects[]`
- `review_queue_items[]`
- `warnings[]`
- `trace`
- `started_at`
- `finished_at`

### 5.3 状态字段

- `pending`
- `running`
- `blocked`
- `awaiting_review`
- `completed`
- `failed`

## 6. 候选准入任务

### 6.1 `candidate_admission_job`

职责：

- 判断候选是否保留
- 判断候选属于哪个 domain
- 判断候选是 fact、rule、skill 还是 entity 线索
- 生成初始去重键

输入：

- `memory_candidate`
- 关联 source_ref
- 可选 evidence / task / conversation context

规则输出：

- `drop`
- `keep_inbox`
- `promote_to_governance`

说明：

这一阶段默认不直接写正式长期对象。

## 7. 抽取与归一化任务

### 7.1 `entity_extraction_job`

职责：

- 从候选、section、evidence 中抽 entity 候选
- 产出 `kp_entity` 草稿

输出：

- 新建 entity
- 关联 evidence
- 候选 merge suggestion

### 7.2 `fact_extraction_job`

职责：

- 从候选或文档片段抽取规范化 fact
- 区分 `memory_fact / knowledge_fact / rule_fact / skill_fact`

输出：

- `kp_fact`
- 对应 evidence link
- 与 subject entity 的关系

### 7.3 `relation_extraction_job`

职责：

- 从结构化对象和证据中抽取 relation

输出：

- `kp_relation`
- relation evidence link
- relation confidence

### 7.4 `normalization_job`

职责：

- 别名归一化
- title / statement 规范化
- slug 规范化

说明：

该任务优先由规则处理，模型仅用于模糊情况。

## 8. 归并与冲突任务

### 8.1 `entity_merge_job`

职责：

- 检测同名、别名、同指对象
- 生成 merge 建议

输出：

- `merge_candidate`
- `keep_separate`
- `needs_human_review`

### 8.2 `fact_conflict_job`

职责：

- 检测 factual 与 knowledge 层中的冲突陈述
- 判断是否是：
  - 真冲突
  - 版本替代
  - 时间窗差异
  - 范围差异

输出：

- `no_conflict`
- `conflicts_with`
- `supersedes`
- `requires_review`

### 8.3 `relation_conflict_job`

职责：

- 识别重复边
- 识别方向冲突
- 识别互斥关系

输出：

- merge
- keep parallel
- conflict pending

## 9. 时效治理任务

### 9.1 `staleness_scan_job`

职责：

- 根据 `valid_to / review_at / last_verified_at / staleness_score` 扫描对象

输出：

- `still_valid`
- `needs_review`
- `should_deprecate`
- `should_archive`

### 9.2 `supersede_job`

职责：

- 处理新对象替代旧对象的关系

输出：

- 旧对象标记 `deprecated`
- 建立 `supersedes` relation

## 10. 摘要与快照任务

### 10.1 `conversation_summary_rebuild_job`

继续承接当前 `conversation_summary` 能力。

### 10.2 `resident_snapshot_rebuild_job`

继续承接当前 `resident_snapshot` 能力。

### 10.3 `knowledge_cluster_summary_job`

新增能力，用于按主题簇生成知识摘要，供后续检索和 Ops 浏览使用。

## 11. 审查队列协议

进入人工审查的条件建议包括：

- 低置信度 merge
- 高影响 `rule_memory`
- 高风险 conflict
- 多证据互相矛盾
- 将大范围改写现有 curated 对象

人工审查动作：

- approve
- reject
- split
- merge
- deprecate
- archive
- request_more_evidence

## 12. 失败与回退策略

### 12.1 规则任务失败

- 记录日志
- 进入 `blocked`
- 不直接污染正式对象

### 12.2 模型任务失败

- 保留原候选
- 标记 `awaiting_review` 或 `retryable`
- 不直接覆盖 curated 对象

### 12.3 人工审查中断

- 保留待审状态
- 不自动关闭冲突

## 13. 第一版落地顺序

建议先实现：

1. `candidate_admission_job`
2. `fact_extraction_job`
3. `entity_extraction_job`
4. `fact_conflict_job`
5. `staleness_scan_job`
6. `resident_snapshot_rebuild_job`

图谱更深的 relation 整理和 cluster summary 可以后置。

## 14. 验收标准

该协议设计完成后，应能直接回答：

- 一个候选对象如何进入治理
- 哪些任务是规则，哪些是模型，哪些是人工
- 冲突和时效怎么处理
- 当前 summary / resident 如何被保留
- 图谱整理如何挂进治理层

如果这些路径清晰，则治理层可进入任务编排实现阶段。
