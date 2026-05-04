# 统一长期知识系统子设计 01：节点/边数据模型

## 1. 设计目标

本设计定义统一长期知识系统的核心对象模型，使系统能同时承载：

- 长期记忆
- 外部知识
- 文档内容
- 原始证据
- 图谱关系
- 可解释的上下文装配输入

本设计遵循以下原则：

- 产品统一，工程分层
- 图谱是骨架，文档和证据是载体
- 向量索引不是知识本体
- 对象类型必须显式区分，不能把所有内容混成单表
- 每条高价值结论都必须可回溯到证据

## 1.1 与当前 Memory 模块的关系

当前 memory 模块不是旁路系统，而是本设计的现有基础层。

当前对象与未来对象的直接映射：

- 当前 `memory` -> 未来 `memory_fact` 的基础
- 当前 `skill` -> 未来过程知识对象的基础
- 当前 `memory_candidate` -> 未来 `candidate/inbox` 队列基础
- 当前 `resident_snapshot` -> 未来阶段性上下文快照基础
- 当前 `conversation_summary` -> 未来总结层基础

本设计新增的是：

- `entity`
- `relation`
- `document`
- `section`
- `evidence`

也就是说，本设计不是替换当前 memory schema，而是在其上补全长期知识系统缺失的骨架对象。

## 2. 核心对象

### 2.1 entity

用于表达长期存在的主体、系统、模块、概念或项目。

典型示例：

- OpenViking
- OpenClaw
- SuperAgentSystem
- Memory MCP
- HNSW
- Knowledge Ops Console

建议字段：

- `id`
- `entity_type`
- `canonical_name`
- `aliases[]`
- `summary`
- `status`
- `owner_scope`
- `confidence`
- `created_at`
- `updated_at`

### 2.2 document

用于表达一个人类可阅读的内容容器。

典型示例：

- README
- 设计文档
- 技术调研
- 网页快照
- 会议纪要
- 项目说明

建议字段：

- `id`
- `document_type`
- `title`
- `source_type`
- `source_uri`
- `author`
- `capture_method`
- `status`
- `created_at`
- `updated_at`

### 2.3 section

用于表达文档中的主检索语义单元。`section` 是内容组织和检索的主工作单元。

不建议把固定 token chunk 当主对象。固定切块只能作为派生辅助层。

建议字段：

- `id`
- `document_id`
- `heading_path`
- `section_type`
- `order_no`
- `summary`
- `text`
- `status`
- `embedding_ref`
- `created_at`
- `updated_at`

### 2.4 evidence

用于表达原始证据。证据负责回答“你为什么这么说”。

典型示例：

- 网页正文快照
- 代码片段
- 命令输出
- 对话片段
- 日志片段
- 文档原文

建议字段：

- `id`
- `evidence_type`
- `source_uri`
- `raw_ref`
- `hash`
- `trust_level`
- `captured_at`
- `status`

### 2.5 fact

事实分两种：

- `memory_fact`
- `knowledge_fact`

#### memory_fact

用于表达与用户、Agent 或长期工作上下文持续相关的稳定事实。

典型示例：

- 当前工作区根目录是 `D:\workspace`
- 当前本机要求统一 UTF-8 并配套校验
- 当前主线项目是长期知识系统设计

#### knowledge_fact

用于表达更加客观、证据化、可复用的工程知识或外部知识。

典型示例：

- 当前 Memory MCP retrieval 必须显式传 `fingerprint_status`
- 向量索引只适合做辅助召回，不适合作为知识本体
- OpenViking 旧 recall 方案存在文本注入风险

建议公共字段：

- `id`
- `fact_kind`
- `statement`
- `normalized_statement`
- `subject_entity_id`
- `status`
- `confidence`
- `review_state`
- `valid_from`
- `valid_to`
- `created_at`
- `updated_at`

### 2.6 relation

用于表达图谱边，是系统骨架的关键。

第一版建议支持：

- `mentions`
- `about`
- `belongs_to`
- `derived_from`
- `evidenced_by`
- `depends_on`
- `related_to`
- `conflicts_with`
- `supersedes`
- `produced_from`
- `used_in_answer`
- `assembled_into`

建议字段：

- `id`
- `relation_type`
- `from_object_type`
- `from_object_id`
- `to_object_type`
- `to_object_id`
- `direction`
- `confidence`
- `status`
- `review_state`
- `valid_from`
- `valid_to`
- `created_at`
- `updated_at`

## 3. 对象分层职责

### 3.1 原始层

- `document`
- `section`
- `evidence`

职责：

- 承载原始或近原始内容
- 保留回溯能力
- 为抽取和 grounding 提供依据

### 3.2 认知层

- `entity`
- `memory_fact`
- `knowledge_fact`
- `relation`

职责：

- 承载系统当前认可的长期认知
- 支持检索、扩边、治理、审查

### 3.3 装配层输入

上下文装配不直接消费裸文本，而消费结构化对象集合：

- `facts`
- `entities`
- `relations`
- `evidence_refs`
- `section_refs`

## 4. 关键约束

### 4.1 证据约束

- 任意高价值 `fact` 至少应能关联一个 `evidence` 或 `section`
- 任意高价值 `relation` 至少应能关联证据或来源对象

### 4.2 状态约束

- 原始对象与认知对象分开治理
- `captured/inbox/curated/deprecated/archived` 不能只靠布尔值表达

### 4.3 身份约束

- `entity` 的主名和别名分开存
- `fact` 不直接等价于 `section`
- `section` 不直接等价于 `snippet`

### 4.4 装配约束

- `section` 和 `evidence` 是引用对象，不应直接伪装成用户消息
- `fact` 与 `relation` 在上下文中必须带出处

## 5. 建议存储形态

第一阶段建议逻辑分层、物理可同库：

- 图骨架对象：关系型表
- 文档与 section：关系型表 + 可选对象存储
- 向量索引：独立 ANN 索引
- 审计与使用追踪：关系型表

不要求一开始就绑定特定图数据库，但必须先把 schema 定义稳定。

## 6. 第一版最小可用对象集

如果按工程顺序推进，第一版必须先落下这 7 类对象：

- `entity`
- `document`
- `section`
- `evidence`
- `memory_fact`
- `knowledge_fact`
- `relation`

`snippet` 可以晚于 `section`，作为派生辅助层上线。
