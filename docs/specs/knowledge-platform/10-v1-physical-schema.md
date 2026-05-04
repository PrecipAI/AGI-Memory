# 第一版物理 Schema 设计

## 1. 目标

在不推翻当前 `memory-service` 数据基础的前提下，定义统一长期知识系统第一版物理 schema，用于承载：

- 长期记忆分域
- 图谱骨架
- 文档与证据载体
- 治理状态与时效字段
- 检索与上下文装配所需的引用关系

本设计默认落在当前 PostgreSQL 体系内，不要求第一阶段引入独立图库。

## 2. 设计边界

### 2.1 本轮要做

- 明确新增对象表
- 明确与现有 `memory / memory_candidate / skill` 的映射
- 明确状态字段与时效字段
- 明确主键、索引、唯一约束和关键外键

### 2.2 本轮不做

- 不决定最终 ORM 写法
- 不直接给出完整 migration SQL
- 不引入 Neo4j 或独立图数据库
- 不替换当前 memory retrieval 表结构

## 3. 总体策略

第一版采用“旧表承接 + 新表扩展”的方式。

保留当前基础表作为 Phase 0：

- `memory_candidate`
- `memory`
- `skill`
- `conversation_summary`
- `resident_snapshot`
- `memory_access_log`

新增知识平台表：

- `kp_document`
- `kp_section`
- `kp_evidence`
- `kp_entity`
- `kp_fact`
- `kp_relation`
- `kp_candidate_link`
- `kp_review_queue`
- `kp_context_bundle`

命名上加 `kp_` 前缀，避免与现有 memory 表混淆，也便于后续逐步整合。

## 4. 通用字段约定

所有新表建议统一包含：

- `id uuid primary key`
- `tenant_id text not null`
- `scope text not null`
- `status text not null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

如对象有治理语义，再统一补：

- `lifecycle_state text not null`
- `review_state text not null`
- `valid_from timestamptz null`
- `valid_to timestamptz null`
- `last_verified_at timestamptz null`
- `review_at timestamptz null`
- `staleness_score numeric(5,4) null`

## 5. 长期记忆域与对象类型

### 5.1 `memory_domain`

第一版枚举值：

- `profile`
- `knowledge`
- `rule`
- `skill`

### 5.2 `object_type`

第一版枚举值：

- `fact`
- `entity`
- `relation`
- `document`
- `section`
- `evidence`
- `procedure`

### 5.3 `lifecycle_state`

第一版枚举值：

- `inbox`
- `candidate`
- `curated`
- `deprecated`
- `archived`

### 5.4 `review_state`

第一版枚举值：

- `unreviewed`
- `auto_accepted`
- `human_approved`
- `human_rejected`
- `conflict_pending`

## 6. 文档与证据载体表

### 6.1 `kp_document`

用于保存人可读内容载体。

核心字段：

- `id`
- `tenant_id`
- `scope`
- `memory_domain`
- `object_type` 固定为 `document`
- `title`
- `source_type`
- `source_uri`
- `source_hash`
- `author`
- `language`
- `status`
- `lifecycle_state`
- `review_state`
- `captured_at`
- `published_at`
- `valid_from`
- `valid_to`
- `metadata jsonb`

约束与索引：

- 唯一建议：`(tenant_id, scope, source_uri, source_hash)`
- 索引：`(tenant_id, scope, lifecycle_state)`
- 索引：`(tenant_id, scope, memory_domain)`

### 6.2 `kp_section`

用于保存主检索内容单元。

核心字段：

- `id`
- `document_id`
- `tenant_id`
- `scope`
- `memory_domain`
- `object_type` 固定为 `section`
- `heading_path text[]`
- `section_key`
- `ordinal`
- `title`
- `summary`
- `content text`
- `content_hash`
- `token_count`
- `status`
- `lifecycle_state`
- `review_state`
- `metadata jsonb`

约束与索引：

- 唯一建议：`(document_id, section_key)`
- GIN 索引：`to_tsvector('simple', content)`
- 索引：`(tenant_id, scope, lifecycle_state)`
- 索引：`(document_id, ordinal)`

### 6.3 `kp_evidence`

用于保存最小证据对象，回答“凭什么这么说”。

核心字段：

- `id`
- `tenant_id`
- `scope`
- `memory_domain`
- `object_type` 固定为 `evidence`
- `evidence_type`
- `source_type`
- `source_uri`
- `raw_ref`
- `content_excerpt`
- `content_hash`
- `trust_level`
- `captured_at`
- `status`
- `lifecycle_state`
- `review_state`
- `metadata jsonb`

约束与索引：

- 唯一建议：`(tenant_id, scope, source_uri, raw_ref, content_hash)`
- 索引：`(tenant_id, scope, evidence_type)`
- 索引：`(tenant_id, scope, lifecycle_state)`

## 7. 图谱骨架表

### 7.1 `kp_entity`

用于保存长期存在的主体、概念、系统、模块等。

核心字段：

- `id`
- `tenant_id`
- `scope`
- `memory_domain`
- `object_type` 固定为 `entity`
- `entity_type`
- `canonical_name`
- `aliases text[]`
- `slug`
- `summary`
- `status`
- `lifecycle_state`
- `review_state`
- `valid_from`
- `valid_to`
- `last_verified_at`
- `review_at`
- `staleness_score`
- `metadata jsonb`

约束与索引：

- 唯一建议：`(tenant_id, scope, entity_type, slug)`
- GIN 索引：`aliases`
- 索引：`(tenant_id, scope, canonical_name)`
- 索引：`(tenant_id, scope, lifecycle_state)`

### 7.2 `kp_fact`

统一承载 `memory_fact` 和 `knowledge_fact`。

核心字段：

- `id`
- `tenant_id`
- `scope`
- `memory_domain`
- `object_type` 固定为 `fact`
- `fact_kind`
- `fact_subtype`
- `subject_entity_id null`
- `title`
- `statement`
- `normalized_statement`
- `confidence_score numeric(5,4)`
- `importance integer`
- `status`
- `lifecycle_state`
- `review_state`
- `verification_status`
- `valid_from`
- `valid_to`
- `last_verified_at`
- `review_at`
- `staleness_score`
- `supersedes_fact_id null`
- `metadata jsonb`

约束与索引：

- 索引：`(tenant_id, scope, memory_domain, fact_kind)`
- 索引：`(tenant_id, scope, lifecycle_state, review_state)`
- 索引：`(subject_entity_id)`
- GIN 或全文索引：`normalized_statement`

建议 `fact_kind` 第一版至少支持：

- `memory_fact`
- `knowledge_fact`
- `rule_fact`
- `skill_fact`

### 7.3 `kp_relation`

统一承载图谱边。

核心字段：

- `id`
- `tenant_id`
- `scope`
- `memory_domain`
- `object_type` 固定为 `relation`
- `relation_type`
- `from_object_type`
- `from_object_id`
- `to_object_type`
- `to_object_id`
- `statement`
- `confidence_score numeric(5,4)`
- `status`
- `lifecycle_state`
- `review_state`
- `valid_from`
- `valid_to`
- `last_verified_at`
- `review_at`
- `staleness_score`
- `metadata jsonb`

约束与索引：

- 唯一建议：`(tenant_id, scope, relation_type, from_object_type, from_object_id, to_object_type, to_object_id)`
- 索引：`(tenant_id, scope, relation_type)`
- 索引：`(from_object_id)`
- 索引：`(to_object_id)`
- 索引：`(tenant_id, scope, lifecycle_state, review_state)`

建议 `relation_type` 第一版至少支持：

- `about`
- `mentions`
- `belongs_to`
- `derived_from`
- `evidenced_by`
- `depends_on`
- `related_to`
- `conflicts_with`
- `updated_by`
- `supersedes`

## 8. 与现有 memory 的桥接表

### 8.1 `kp_candidate_link`

用于把当前 `memory_candidate` 与新对象关联，便于追溯治理来源。

核心字段：

- `id`
- `tenant_id`
- `scope`
- `candidate_id`
- `target_object_type`
- `target_object_id`
- `link_role`
- `metadata jsonb`
- `created_at`

建议 `link_role` 支持：

- `derived_from_candidate`
- `supports_candidate`
- `conflicts_candidate`
- `supersedes_candidate`

### 8.2 `kp_fact` 与 `memory`

第一阶段不要求把当前 `memory` 直接物理拆掉。

桥接策略：

- 当前 `memory.memory_type = factual` 可逐步映射为 `kp_fact.fact_kind in ('memory_fact', 'knowledge_fact', 'rule_fact')`
- 当前 `skill` 可逐步映射为 `skill_memory` / `procedure`
- 当前 `memory_candidate` 继续作为候选池入口

## 9. 审查与运维表

### 9.1 `kp_review_queue`

用于承载人工审查或高风险自动审查任务。

核心字段：

- `id`
- `tenant_id`
- `scope`
- `target_object_type`
- `target_object_id`
- `review_reason`
- `priority`
- `assigned_to null`
- `status`
- `payload jsonb`
- `created_at`
- `updated_at`
- `resolved_at null`

建议 `review_reason` 支持：

- `conflict_detected`
- `staleness_review`
- `high_impact_rule`
- `low_confidence_merge`
- `manual_hold`

### 9.2 `kp_context_bundle`

用于保存结构化上下文装配结果和 trace，便于调试与 Ops 查看。

核心字段：

- `id`
- `tenant_id`
- `scope`
- `request_ref`
- `bundle_type`
- `facts jsonb`
- `entities jsonb`
- `relations jsonb`
- `evidence_refs jsonb`
- `section_refs jsonb`
- `warnings jsonb`
- `assembly_trace jsonb`
- `created_at`

## 10. 第一版索引策略

优先保证这几类查询：

- 按 domain/type/state 查询对象
- 按 canonical name / alias 查 entity
- 按 fact statement 查事实
- 按 section 内容做 BM25 词法召回
- 按 relation 两端对象做图扩展
- 按 review state / staleness 拉审查队列

第一版优先索引：

- B-Tree：租户、scope、domain、state、type
- GIN：`aliases`、`jsonb metadata`
- BM25：`kp_section.content`、`kp_fact.normalized_statement`

## 11. 数据迁移策略

### 11.1 第一阶段

- 不迁移历史数据
- 仅对新治理结果写入新表
- 保留现有 retrieval 走旧 memory 表

### 11.2 第二阶段

- 将高价值 factual memory 回填到 `kp_fact`
- 将 `skill` 回填成 `skill_memory / procedure`
- 将外部资料导入 `kp_document / kp_section / kp_evidence`

### 11.3 第三阶段

- 新检索逐步优先消费 `kp_*` 对象
- 旧 memory retrieval 成为兼容层或基础层

## 12. 验收标准

第一版 schema 设计完成后，应能回答：

- 长期记忆 4 大域如何落表
- 图谱节点和边如何落表
- 文档与证据如何回链
- 当前 memory 如何继续承接
- 时效、状态机和审查如何落字段
- 后续检索与治理如何直接消费这些表

如果上述问题都能直接从 schema 回答，则该设计可进入 migration 和服务实现阶段。
