# 统一长期知识系统子设计 02：整理触发与准入状态机

## 1. 设计目标

本设计定义统一长期知识系统的整理、准入和治理状态机，确保系统：

- 不是见到内容就直接入正式知识层
- 能区分捕获、候选、正式知识、冲突、废弃
- 能支持显式触发、事件触发、定时整理
- 能引入人类审查，而不是只靠自动覆盖

## 1.1 与当前 Memory Governance 的关系

当前模块已存在：

- `memory_ingest_candidate`
- `memory_run_governance`
- `summary/resident/index/lifecycle`

因此未来治理不是另起一套，而是扩展为：

- 当前 memory governance
- graph governance
- document/evidence governance
- review workflow

当前 governance 是 Phase 0 基础；图谱治理和人类审查是 Phase 1 以后追加。

## 2. 触发机制

### 2.1 显式触发

由用户或运维明确要求：

- 记住这个长期事实
- 纳入长期知识
- 整理最近的项目知识
- 运行知识治理

适用对象：

- 用户偏好
- 项目约束
- 设计决策
- 修复经验
- 外部资料入库

### 2.2 事件触发

由系统在观测到模式后自动触发整理任务。

建议触发条件：

- 同一主题被连续搜索和阅读
- 同一事实被多任务重复使用
- 项目扫描发现结构变化
- 多条候选事实指向同一实体
- 多个证据对同一结论产生支持或冲突

### 2.3 定时触发

由系统周期性运行治理任务。

建议任务：

- 每日 inbox 整理
- 每周项目知识归档
- 过期知识检查
- 冲突队列复核
- 使用频率与热点分析

## 3. 状态机

### 3.1 原始输入状态

用于 `document / section / evidence`：

- `captured`
- `normalized`
- `linked`
- `archived`

说明：

- `captured`：刚进入系统
- `normalized`：已做基本解析和结构化
- `linked`：已挂接实体、事实或关系
- `archived`：不再活跃，但仍可追溯

### 3.2 认知对象状态

用于 `entity / fact / relation`：

- `inbox`
- `candidate`
- `curated`
- `deprecated`
- `archived`

说明：

- `inbox`：已抽取，但尚未充分确认
- `candidate`：通过规则预筛，可进入审查或自动确认
- `curated`：当前正式知识
- `deprecated`：已过期、被替代或存在更新版本
- `archived`：退出主工作集，仅保留历史

### 3.3 审查状态

建议单独维护 `review_state`：

- `unreviewed`
- `auto_accepted`
- `human_approved`
- `human_rejected`
- `conflict_pending`

## 4. 准入规则

### 4.1 evidence/document 准入

原始材料可以先收，但不直接等于正式知识。

准入原则：

- 来源可识别
- 内容可追溯
- 允许低置信输入先进入 evidence 层

### 4.2 fact 准入

事实进入正式层前，至少满足：

- 有明确 statement
- 有主体或语义归属
- 有至少一个可追溯来源
- 能判断有效性和时效性

自动入 `curated` 的条件应严格限制在：

- 高置信规则命中
- 用户显式确认
- 与现有知识不冲突

### 4.3 relation 准入

关系必须说明：

- 起点对象
- 终点对象
- 关系类型
- 证据依据

无证据支撑的关系不得直接进入高权重正式层。

## 5. 冲突治理

### 5.1 冲突类型

- 同一主体出现互斥事实
- 同一实体存在身份重复
- 同一关系被新证据推翻
- 同一文档/section 被抽出冲突结论

### 5.2 冲突处理原则

- 不自动覆盖原结论
- 保留冲突双方
- 显式建立 `conflicts_with`
- 创建待审查项
- 必要时由人类确认 `supersedes`

## 6. 时效治理

### 6.1 记忆型对象

重点关注：

- 用户偏好是否仍有效
- 工作区、机器、主线项目是否变化
- 持续背景是否被新决策替代

### 6.2 知识型对象

重点关注：

- 技术资料是否过时
- 设计结论是否被实现变化推翻
- 外部系统行为是否已变化

### 6.3 过期动作

- 降权
- 标记 `deprecated`
- 建立 `supersedes`
- 推入复核队列

## 7. 使用追踪

正式知识不是“存进去就结束”，还要追踪“怎么被用”。

应记录：

- 哪次检索命中
- 哪次回答使用
- 被哪个 Agent / 用户流程消费
- 使用后是否被纠正或驳回

这直接影响后续：

- 置信度调整
- 热点知识识别
- 垃圾知识清理

## 8. 推荐治理任务类型

- `ingest_normalization`
- `entity_merge_review`
- `fact_conflict_review`
- `relation_conflict_review`
- `staleness_review`
- `usage_audit`
- `snapshot_rebuild`

## 9. 第一版落地建议

第一版不要做全自动全量治理，建议：

1. 显式触发优先
2. 事件触发进入候选队列
3. 定时任务做批处理治理
4. 冲突和时效必须可人工审查

这样能避免系统一开始就因为“自动整理过度”而污染长期知识层。
