# Knowledge Ops Console 结构设计

## 1. 目标

定义统一长期知识系统的人类审查与运维界面结构，使人类能够：

- 看见系统最近 ingest 了什么
- 看见系统抽取了什么实体、事实、关系
- 处理冲突、时效和待审对象
- 追踪某次 Agent 回答到底用了哪些知识

Ops Console 是正式系统的一部分，不是可有可无的辅助页面。

## 2. 核心原则

- 面向运维与审查，不做花哨展示
- 先支持可见、可查、可改状态
- 以对象和任务为中心，不以 prompt 为中心
- 证据和 trace 必须可见

## 3. 顶层信息架构

第一版建议 6 个主页面。

### 3.1 Inbox

用于查看新进入系统、尚未完成治理的对象。

重点内容：

- 新 evidence
- 新 candidate
- 新 document / section
- 新 entity / fact / relation draft

关键动作：

- 接受进入治理
- 标记噪音
- 合并候选
- 送人工审查

### 3.2 Knowledge Graph

用于查看治理后的核心对象关系。

重点内容：

- entity 列表
- fact 列表
- relation 列表
- 主题簇视图

第一版不必追求复杂图可视化，列表加关联视图即可。

### 3.3 Evidence Explorer

用于查看证据和文档载体。

重点内容：

- document 列表
- section 列表
- evidence 列表
- 证据到 fact / relation 的回链

关键动作：

- 打开原文
- 标记失效证据
- 请求补证据

### 3.4 Conflicts & Staleness

用于专门处理脏知识。

重点内容：

- 冲突 fact
- 冲突 relation
- 低置信度 merge
- 即将过期对象
- 已过期未处理对象

关键动作：

- approve supersede
- keep parallel
- deprecate
- archive
- request review

### 3.5 Retrieval Trace

用于查看某次 query / 某次 Agent 回答的知识使用路径。

重点内容：

- query
- 命中的 baseline memory
- 命中的 entity / fact / relation
- 选中的 evidence / section
- 输出的 context bundle
- warnings

关键动作：

- 复盘误召回
- 检查上下文污染
- 追踪错误答案来源

### 3.6 Governance Runs

用于查看治理任务流水。

重点内容：

- 最近任务
- 任务类型
- 任务输入
- 任务输出
- 失败原因
- 进入审查队列的对象

关键动作：

- retry
- cancel
- escalate to human review

## 4. 关键对象详情页

第一版建议所有核心对象都有详情页。

### 4.1 Entity Detail

包含：

- canonical name
- aliases
- summary
- related facts
- related relations
- evidence links
- staleness / review state

### 4.2 Fact Detail

包含：

- statement
- fact kind
- subject entity
- evidence list
- conflicts
- supersedes / superseded_by
- verification / review info

### 4.3 Relation Detail

包含：

- relation type
- from / to
- supporting evidence
- confidence
- conflicts

### 4.4 Document / Section Detail

包含：

- 原文
- 语义摘要
- 派生出的 entity / fact / relation
- 使用追踪

## 5. 审查动作设计

人工审查最少支持这些动作：

- approve
- reject
- merge
- split
- deprecate
- archive
- request_more_evidence
- mark_conflict

所有动作都应留下审计记录。

## 6. 检索与回答追踪设计

每次对外回答或关键 retrieval，应保留可追踪记录：

- query 文本
- query 类型
- 命中对象
- 最终 context bundle
- 使用的 evidence
- warnings
- 关联回答或 task ref

这样可以反查：

- 某条错误知识是怎么进来的
- 某次答案为什么会用到这条知识
- 某个误召回是 baseline 问题、图谱扩展问题还是装配问题

## 7. 第一版权限边界

第一版最少区分：

- `viewer`
- `reviewer`
- `operator`

权限含义：

- `viewer` 只看
- `reviewer` 可做对象审查
- `operator` 可重跑治理和执行高影响动作

## 8. 与 Obsidian 的关系

Obsidian 可以作为导出型知识浏览前端，但不是 Ops Console 本体。

区别：

- Obsidian 偏知识浏览与人工整理
- Ops Console 偏治理、审查、追踪、运维

因此：

- 可以把治理后的图谱导出到 Obsidian
- 但不能用 Obsidian 替代正式审查与运维界面

## 9. 第一版实现优先级

建议顺序：

1. Inbox
2. Conflicts & Staleness
3. Retrieval Trace
4. Governance Runs
5. Entity / Fact / Relation Detail
6. Knowledge Graph 视图增强

## 10. 验收标准

该结构设计完成后，应能回答：

- 人类怎样看到新进知识
- 人类怎样处理冲突和过期
- 人类怎样追踪某次回答使用了哪些知识
- 人类怎样重跑或审查治理任务

如果这些路径完整，则 Ops Console 可以进入页面与 API 设计阶段。
