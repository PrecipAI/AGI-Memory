# 第一版数据库 Migration 与落库方案

## 1. 目标

在不破坏当前 `memory-service` 可用性的前提下，为统一长期知识系统引入第一版数据库对象，并给出可执行的 migration 落地顺序。

## 2. 总体策略

采用“三阶段并行承接”：

1. 先新增 `kp_*` 表，不改旧表
2. 让治理层开始向 `kp_*` 写新对象
3. 待检索和运维层稳定后，再逐步消费 `kp_*`

这意味着第一阶段是扩展式 migration，不是替换式 migration。

## 3. Migration 原则

- 不删除现有 `memory / memory_candidate / skill` 表
- 不在第一批 migration 中改动旧 retrieval 依赖字段
- 所有新表先允许空数据启动
- 新表写入失败不能阻塞当前 memory 主链路
- migration 必须可重复执行、可回滚、可灰度

## 4. 建议 Migration 批次

### 4.1 `001_create_kp_core_tables`

创建：

- `kp_document`
- `kp_section`
- `kp_evidence`
- `kp_entity`
- `kp_fact`
- `kp_relation`

说明：

- 只建主表和基础索引
- 先不建重型全文或复杂 GIN 索引

### 4.2 `002_create_kp_bridge_and_ops_tables`

创建：

- `kp_candidate_link`
- `kp_review_queue`
- `kp_context_bundle`

说明：

- 这批表服务治理桥接、人工审查和检索 trace

### 4.3 `003_add_secondary_indexes`

补充：

- 文本检索索引
- alias GIN 索引
- relation 扩展索引
- 审查队列状态索引

说明：

- 将较重索引后置，避免初次 migration 过重

### 4.4 `004_seed_kp_system_config`

初始化：

- 默认 domain/type 枚举配置
- 默认 review reason 配置
- 默认治理开关配置

说明：

- 如果当前项目没有配置表，可先以内置枚举为准，此 migration 可推迟

## 5. 表创建顺序

建议顺序：

1. `kp_document`
2. `kp_section`
3. `kp_evidence`
4. `kp_entity`
5. `kp_fact`
6. `kp_relation`
7. `kp_candidate_link`
8. `kp_review_queue`
9. `kp_context_bundle`

原因：

- 先建载体层
- 再建图谱层
- 最后建桥接和运维表

## 6. 外键策略

第一版建议采用“核心外键保留，弱连接对象柔性引用”。

### 6.1 强外键

建议保留：

- `kp_section.document_id -> kp_document.id`
- `kp_fact.subject_entity_id -> kp_entity.id`

### 6.2 柔性引用

以下字段建议先不用数据库级多态外键，改为应用层保证：

- `kp_relation.from_object_type + from_object_id`
- `kp_relation.to_object_type + to_object_id`
- `kp_candidate_link.target_object_type + target_object_id`
- `kp_review_queue.target_object_type + target_object_id`

原因：

- 多态外键在 PostgreSQL 层复杂且不利于迭代
- 第一版更适合应用层校验

## 7. 索引落地顺序

### 7.1 第一批必要索引

- `kp_entity (tenant_id, scope, canonical_name)`
- `kp_entity (tenant_id, scope, lifecycle_state)`
- `kp_fact (tenant_id, scope, memory_domain, fact_kind)`
- `kp_fact (tenant_id, scope, lifecycle_state, review_state)`
- `kp_relation (tenant_id, scope, relation_type)`
- `kp_review_queue (tenant_id, scope, status, priority)`
- `kp_section (document_id, ordinal)`

### 7.2 第二批增强索引

- `kp_entity aliases GIN`
- `kp_section content tsvector`
- `kp_fact normalized_statement` 全文索引
- `kp_relation (from_object_id)`
- `kp_relation (to_object_id)`

## 8. 数据兼容策略

### 8.1 与 `memory_candidate`

当前候选仍写入 `memory_candidate`。

治理成功后：

- 产出 `kp_*` 对象
- 写 `kp_candidate_link`

### 8.2 与 `memory`

当前 factual memory 继续保留。

第一阶段不要求回填历史所有 `memory`。

建议只回填：

- 当前高价值设计约束
- 规则记忆
- 已验证的重要 factual memory

### 8.3 与 `skill`

当前 `skill` 继续服务 procedural retrieval。

后续在治理层逐步映射为：

- `memory_domain = skill`
- `object_type = procedure`

## 9. 回填策略

### 9.1 第一阶段

不做全量历史回填。

只允许：

- 新治理结果直接写新表
- 针对少量高价值对象做人工回填

### 9.2 第二阶段

补做定向回填任务：

- `backfill_memory_to_kp_fact`
- `backfill_skill_to_kp_fact_or_procedure`
- `backfill_docs_to_kp_document_section_evidence`

### 9.3 第三阶段

评估是否需要全面回填与统一检索。

## 10. 发布顺序

建议按这个顺序上线：

1. migration 建表
2. 应用启动兼容新表为空
3. 治理层写新表开关默认关闭
4. 在开发环境打开治理写新表
5. 验证 Ops 和检索 trace
6. 再逐步开放更多治理任务

## 11. 回滚策略

如果新 schema 导致问题：

- 先关闭治理写入开关
- 停止消费 `kp_*`
- 保留表结构，不急于删表

第一版不建议立即 drop 新表回滚，因为：

- 当前是扩展型接入
- 停止写入已足够隔离影响

## 12. 实施前检查清单

- PostgreSQL 版本是否满足 JSONB / GIN / tsvector 需求
- 当前 migration 框架是否支持分批上线
- 是否有统一枚举管理方式
- 是否有开发环境样本数据用于验证
- 当前服务是否能在新表为空时稳定启动

## 13. 验收标准

该方案完成后，应能保证：

- 新表可无损加入现有数据库
- 当前 memory 链路不受阻断
- 治理层可逐步开始写 `kp_*`
- 后续检索和 Ops 可消费 `kp_*`

如果这四点成立，就可以进入 migration 文件和 DAO 层实现。
