# 统一长期知识系统完整设计

## 1. 设计目标

设计一套统一的长期知识系统，服务人类与 Agent 的长期知识积累、治理、检索和上下文装配。

该系统不是：

- 笔记库
- 纯向量库
- 单独记忆模块
- 文档切块检索器

该系统应是：

- 统一长期知识产品
- 分层工程系统
- 以图谱为骨架
- 以文档与证据为承载
- 以治理和审查为保障
- 以结构化上下文装配为输出

## 2. 总体结论

### 2.1 产品结论

知识库与记忆适合统一成一个长期知识系统。

### 2.2 工程结论

统一不等于混合。系统内部必须显式区分：

- `memory_fact`
- `knowledge_fact`
- `entity`
- `relation`
- `document`
- `section`
- `evidence`

### 2.3 当前系统结论

当前 `memory-service + memory-mcp` 已经是 Phase 0 基础，不应推倒重来。

应复用：

- `memory_candidate`
- `memory`
- `skill`
- `conversation_summary`
- `resident_snapshot`
- `environment_fingerprint`
- `memory_access_log`
- `memory_run_governance`

后续是在此基础上扩展图谱层、证据层、装配层和 Ops 层。

## 3. 目标与非目标

### 3.1 目标

- 建立统一长期知识系统
- 兼容当前 memory 模块
- 支持事实、关系、证据、文档、章节、实体的统一治理
- 支持图谱增强检索
- 支持结构化上下文装配
- 支持人类审查与运维
- 为未来图搜索召回建立可量化评测基线

### 3.2 非目标

- 本轮不直接实现完整后端与前端
- 本轮不绑定具体图数据库品牌
- 本轮不替换现有 Agent runtime
- 本轮不做云化与多租户产品化

## 4. 当前 Memory 模块承接方案

### 4.1 当前能力定位

当前 memory 模块负责：

- 候选写入
- 准入与路由
- factual/procedural 检索
- summary/resident/index/lifecycle 治理
- fingerprint 门控
- 使用追踪基础

### 4.2 未来映射

- `memory` -> `memory_fact`
- `skill` -> `procedural knowledge`
- `memory_candidate` -> `candidate/inbox`
- `conversation_summary` -> `summary layer`
- `resident_snapshot` -> `context snapshot layer`
- `memory_access_log` -> `usage/trace layer`

### 4.3 新增层

当前缺失、未来必须新增：

- `entity`
- `relation`
- `document`
- `section`
- `evidence`
- `knowledge ops console`
- `structured context assembly`

## 5. 总体架构

系统分为 6 层。

### 5.1 Ingest Layer

负责采集输入：

- 用户显式提交
- 项目扫描
- 网页/文档导入
- 对话与执行结果沉淀

### 5.2 Content & Evidence Layer

负责保存：

- `document`
- `section`
- `evidence`

这是内容与证据层，不直接等于正式知识层。

### 5.3 Cognition Graph Layer

负责保存系统认可的长期认知对象：

- `entity`
- `memory_fact`
- `knowledge_fact`
- `relation`

这是知识骨架层。

### 5.4 Governance Layer

负责：

- 准入
- 抽取
- 合并
- 冲突检测
- 时效治理
- review workflow
- index/snapshot rebuild

治理层必须接模型，不是可选增强。

### 5.5 Retrieval & Reasoning Layer

负责：

- entity/fact lookup
- graph expansion
- evidence grounding
- hybrid ranking

### 5.6 Context Assembly & Ops Layer

负责：

- 结构化上下文装配
- Knowledge Ops Console
- 使用追踪与解释

## 6. 核心数据模型

### 6.1 entity

表示长期存在的主体、系统、模块、概念。

关键字段：

- `id`
- `entity_type`
- `canonical_name`
- `aliases`
- `summary`
- `status`
- `confidence`

### 6.2 document

表示内容容器。

关键字段：

- `id`
- `document_type`
- `title`
- `source_uri`
- `source_type`
- `status`

### 6.3 section

表示语义章节单元，是主检索内容单元。

关键字段：

- `id`
- `document_id`
- `heading_path`
- `summary`
- `text`
- `embedding_ref`

### 6.4 evidence

表示原始证据。

关键字段：

- `id`
- `evidence_type`
- `source_uri`
- `raw_ref`
- `trust_level`
- `captured_at`

### 6.5 fact

分为：

- `memory_fact`
- `knowledge_fact`

关键字段：

- `id`
- `fact_kind`
- `statement`
- `subject_entity_id`
- `confidence`
- `review_state`
- `valid_from`
- `valid_to`

### 6.6 relation

关键关系类型建议支持：

- `mentions`
- `about`
- `belongs_to`
- `derived_from`
- `evidenced_by`
- `depends_on`
- `related_to`
- `conflicts_with`
- `supersedes`
- `used_in_answer`

## 7. 治理层设计

### 7.1 为什么治理必须接模型

规则足够做基础过滤，但不够完成以下任务：

- 从文档/section/evidence 中抽实体、事实、关系
- 判断多个候选是否语义重复
- 判断冲突属于真实冲突还是表述差异
- 生成 review 建议
- 生成阶段性 summary 和 resident snapshot

所以治理层必须是：

- 规则系统
- 模型系统
- 人类审查系统

三者协同，不是单纯规则或单纯模型。

### 7.2 治理任务类型

治理层建议拆成 7 类任务：

1. `normalize_job`
2. `extract_job`
3. `entity_merge_job`
4. `fact_conflict_job`
5. `relation_conflict_job`
6. `staleness_review_job`
7. `snapshot_and_summary_job`

### 7.3 模型在治理中的角色

模型不直接拥有最终裁决权，除非命中高置信规则或显式用户确认。

模型职责：

- extraction
- normalization
- conflict explanation
- merge suggestion
- review proposal
- summary generation

规则职责：

- 基础准入
- contract 校验
- 明确禁止条件
- 指纹与作用域门控
- 生命周期调度

人类职责：

- 最终冲突裁决
- 高价值对象确认
- 规则修正
- 例外处理

### 7.4 状态机

原始对象状态：

- `captured`
- `normalized`
- `linked`
- `archived`

认知对象状态：

- `inbox`
- `candidate`
- `curated`
- `deprecated`
- `archived`

审查状态：

- `unreviewed`
- `auto_accepted`
- `human_approved`
- `human_rejected`
- `conflict_pending`

### 7.5 当前 memory governance 如何扩展

当前已有：

- `summary`
- `resident`
- `index`
- `lifecycle`

未来扩展为：

- `summary`
- `resident`
- `index`
- `lifecycle`
- `entity governance`
- `relation governance`
- `document/section/evidence governance`
- `review task generation`

## 8. 检索与上下文装配设计

### 8.1 统一检索入口

统一入口：

- `retrieve_context`

内部链路：

1. `entity/fact lookup`
2. `graph expansion`
3. `evidence grounding`
4. `hybrid ranking`
5. `context assembly`

### 8.2 当前 memory retrieval 的承接

当前 `memory_retrieve_context` 继续保留，作为：

- factual/procedural 基线
- benchmark A 组
- 未来统一检索层的底层输入之一

### 8.3 图搜索接入顺序

先治理产出图谱，再让图谱参与 retrieval。

顺序必须是：

1. 先建对象层
2. 先建治理层
3. 再引入 graph expansion
4. 最后比较召回收益

### 8.4 上下文装配协议

禁止把召回结果伪装成自然对话文本。

装配输出必须结构化：

- `context_summary`
- `facts`
- `entities`
- `relations`
- `evidence_refs`
- `section_refs`
- `open_questions`
- `warnings`
- `assembly_trace`

### 8.5 向量与 HNSW 的角色

HNSW 只做辅助 ANN 召回：

- `section`
- `snippet`
- `fact`

HNSW 不承担：

- 真相判定
- 冲突裁决
- 最终上下文可信度判定

## 9. Knowledge Ops Console 设计

至少包含 6 个主视图：

1. `Inbox`
2. `Graph`
3. `Evidence`
4. `Conflicts & Staleness`
5. `Usage & Trace`
6. `Governance Runs`

### 9.1 第一阶段可直接复用当前 memory 数据

- Inbox：先看 `memory_candidate`
- Usage：先看 `memory_access_log`
- Governance：先看当前 governance 返回结果

### 9.2 后续逐步扩展

- Graph：消费 `entity/relation`
- Evidence：消费 `document/section/evidence`
- Trace：消费统一装配链路记录

## 10. 评测与测试设计

### 10.1 测试目标

在图搜索上线前后，比较：

- `Hit@1`
- `Hit@3`
- `Hit@5`
- `MRR`
- `P50 latency`
- `P95 latency`
- contract stability

### 10.2 当前基线

当前基线已建立在现有 memory 模块上。

首轮结果：

- `Hit@1 = 0.4`
- `Hit@3 = 0.8`
- `Hit@5 = 1.0`
- `MRR = 0.6167`
- `P50 latency = 5.878 ms`
- `P95 latency = 44.576 ms`

### 10.3 图搜索上线门槛

未来图搜索至少应满足：

- 在 `relation_expansion / evidence_grounding / cross_object` 类 query 上显著优于当前基线
- `P95 latency` 维持在可接受预算内
- `fingerprint_status` 契约不退化
- grounding 不下降

### 10.4 用例扩展方向

下一轮 benchmark 必须补充：

- `entity_lookup`
- `relation_expansion`
- `evidence_grounding`
- `multi-hop`
- `conflict_resolution`

## 11. 物理模块规划

建议模块：

- `lts-ingest`
- `lts-content-store`
- `lts-graph-model`
- `lts-govern`
- `lts-index`
- `lts-retrieve`
- `lts-grounding`
- `lts-assemble`
- `lts-ops-console`

与当前模块关系：

- `memory-service` 继续存在
- 新模块围绕其演进
- 非必要不做大迁移

## 12. 分阶段实施计划

### Phase 0：当前 memory 稳定化

目标：

- 稳定当前 MCP / memory-service
- 固化 benchmark
- 维持 governance 与 retrieval 合同

### Phase 1：对象模型扩展

目标：

- 新增 `entity / relation / document / section / evidence`
- 明确 schema 和状态机

### Phase 2：治理模型接入

目标：

- 在 governance 中接入模型抽取、合并建议、冲突分析
- 输出 review queue

### Phase 3：图谱整理产物落地

目标：

- entity/relation/evidence 可以稳定治理
- 形成图谱骨架

### Phase 4：统一检索编排

目标：

- memory retrieval + graph expansion + grounding + assembly

### Phase 5：Ops Console

目标：

- 审查、追踪、冲突处理、运行观测

### Phase 6：图搜索 A/B 评测

目标：

- 对比当前 memory 基线
- 决定是否默认启用图搜索

## 13. 风险

### 13.1 对象边界混乱

如果 `fact / section / evidence / entity` 边界不清，会很快退化成垃圾系统。

### 13.2 模型治理过度自动化

如果模型直接自动覆盖知识，会导致长期污染。

### 13.3 图搜索过早接入

如果治理未稳就接图搜索，召回质量会不可控。

### 13.4 双系统漂移

如果未来新增知识系统但不和当前 memory 模块统一，最终会形成两套真相源。

## 14. 关键设计决策

1. 统一长期知识系统建立在当前 memory 模块上演进，不推倒重来。
2. 图谱先作为治理产物，不先进入在线写入主链路。
3. 治理必须接模型，但模型不直接拥有最终裁决权。
4. HNSW 仅做辅助召回，不作为知识本体。
5. 上下文装配必须独立，并输出结构化上下文包。
6. 图搜索上线必须以当前 memory benchmark 为对照。

## 15. 当前建议

下一步优先顺序：

1. 定义第一版 `entity / relation / document / section / evidence` 物理 schema
2. 扩 benchmark cases，覆盖图搜索真正可能提升的 query 类型
3. 设计治理模型任务协议与审查队列
4. 再进入实现阶段

