# 检索与上下文装配契约设计

## 1. 目标

定义统一长期知识系统的检索与上下文装配契约，确保：

- 检索结果可解释
- 检索不直接退化成 prompt 文本拼接
- 图谱增强与当前 memory retrieval 可以并存
- Agent 消费的是结构化上下文包，而不是无边界文本注入

## 2. 设计原则

- 当前 `memory_retrieve_context` 继续保留为 baseline
- 图谱增强逐步引入，不直接替换当前 retrieval
- 检索与装配分离
- 证据必须可回链
- 结构化上下文必须有 trace

## 3. 检索分层

### 3.1 Phase 0

使用当前：

- `conversation_summary`
- `resident_snapshot`
- `factual_memory`
- `procedural_memory`

### 3.2 Phase 1

在 Phase 0 基础上加入：

- `entity lookup`
- `fact lookup`
- `section retrieval`

### 3.3 Phase 2

再加入：

- `graph expansion`
- `evidence grounding`
- `hybrid ranking`

## 4. 统一检索入口

建议新增统一检索接口概念：

- `knowledge_retrieve_context`

第一版不强制替换现有 `memory_retrieve_context`，而是作为新编排层。

## 5. 检索请求契约

### 5.1 输入字段

- `query`
- `tenant_id`
- `scope`
- `intent_type`
- `fingerprint_status`
- `fingerprint`
- `read_domains[]`
- `read_object_types[]`
- `top_k`
- `latency_budget_ms`
- `require_evidence boolean`
- `include_trace boolean`

### 5.2 `intent_type`

建议第一版支持：

- `profile_lookup`
- `fact_lookup`
- `rule_lookup`
- `skill_lookup`
- `entity_lookup`
- `relation_lookup`
- `multi_hop_lookup`
- `context_assembly`

## 6. 检索执行链路

建议链路固定为：

1. query normalization
2. baseline memory retrieval
3. entity / fact lookup
4. graph expansion
5. section / evidence grounding
6. hybrid ranking
7. context assembly

## 7. baseline memory retrieval

职责：

- 维持当前 contract 稳定
- 保持 `fingerprint_status` 语义稳定
- 提供 summary / resident / factual / procedural 基础结果

说明：

在图谱检索成熟前，baseline 是最终兜底结果源。

## 8. entity / fact lookup

职责：

- 命中 query 中的主体、概念、项目、规则、技能关键词
- 直接召回相关 `kp_entity / kp_fact`

输出：

- `entity_hits[]`
- `fact_hits[]`

## 9. graph expansion

职责：

- 对已命中的 entity / fact 做一跳或两跳扩展
- 引入 `relation` 和相邻对象

约束：

- 默认只扩一跳
- 两跳必须受限于 query intent、latency budget 和 confidence
- 不允许无边界图游走

输出：

- `expanded_relations[]`
- `expanded_entities[]`
- `expanded_facts[]`

## 10. evidence grounding

职责：

- 为关键事实和关系补 evidence / section 回链

目标：

- 每条高权重结论都能回答“凭什么”

输出：

- `evidence_refs[]`
- `section_refs[]`

## 11. hybrid ranking

排序信号建议来自：

- keyword / lexical match
- entity precision
- fact confidence
- review_state
- lifecycle_state
- staleness_score
- evidence strength
- relation path length
- recency

第一版不要求复杂学习排序，规则加权即可。

## 12. 上下文装配契约

装配层输出结构化 `context_package`。

### 12.1 输出字段

- `bundle_id`
- `query`
- `summary`
- `facts[]`
- `rules[]`
- `skills[]`
- `entities[]`
- `relations[]`
- `evidence_refs[]`
- `section_refs[]`
- `warnings[]`
- `assembly_trace`

### 12.2 `facts[]`

每条建议最少包含：

- `id`
- `fact_kind`
- `statement`
- `confidence_score`
- `source`

### 12.3 `rules[]`

用于单独表达约束，不与普通事实混在一起。

### 12.4 `warnings[]`

建议第一版支持：

- `conflict_detected`
- `stale_possible`
- `insufficient_evidence`
- `fingerprint_mismatch`
- `partial_context_only`

### 12.5 `assembly_trace`

至少包含：

- baseline 命中情况
- entity 命中情况
- graph 扩展步数
- ranking 主要信号
- evidence 选取原因

## 13. Agent 消费规则

Agent 不应直接消费原始 retrieval dump。

Agent 应消费：

- `summary`
- 高权重 `facts / rules / skills`
- 必要 `entities / relations`
- 引用型 `evidence_refs`
- `warnings`

这样可以避免系统把检索层退化成“把所有内容塞给模型”。

## 14. 与当前 memory 的兼容策略

第一阶段：

- `memory_retrieve_context` 不动
- 新编排层在上面包一层

第二阶段：

- 对新 query type 优先查 `kp_*`
- 对旧 factual / procedural 继续回退到旧 retrieval

第三阶段：

- 统一接口稳定后，再评估是否替换外部主调用口

## 15. 评测要求

图谱增强上线前后，必须继续跑 benchmark：

- Hit@1 / @3 / @5
- MRR
- P50 / P95 latency
- query type 分桶对比
- 合同错误路径稳定性

重点关注：

- 多跳 query 是否明显提升
- 简单 factual query 是否没有被图谱拖慢或误召回污染

## 16. 验收标准

该契约设计完成后，应能回答：

- 检索链路有哪些阶段
- 图谱怎样受控进入检索
- 结果如何回链证据
- Agent 实际收到什么结构
- 当前 memory retrieval 如何继续兼容

如果这些问题都有明确答案，则可进入 retrieval orchestrator 实现阶段。
