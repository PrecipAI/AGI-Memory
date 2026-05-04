# 统一长期知识系统子设计 03：检索与上下文装配协议

## 1. 设计目标

本设计定义统一长期知识系统的检索入口、图谱扩展、证据回落、排序和上下文装配协议，核心目标是：

- 统一检索入口
- 结构化返回，而不是拼接文本
- 支持图扩展和证据 grounding
- 避免重演 OpenViking 那种把召回结果伪装成普通 prompt 文本的注入式装配

## 1.1 与当前 Memory Retrieval 的关系

当前 `memory_retrieve_context` 已经具备：

- 分层返回
- factual/procedural gate
- fingerprint contract
- access log

因此未来统一检索协议不应推翻它，而应分阶段演进：

- Phase 0：保留当前 `retrieve bundle`
- Phase 1：在 bundle 外增加 `entity/relation/evidence` 对象
- Phase 2：新增 graph expansion 和 structured assembly

当前 `runtime_summary + summary/resident/factual/procedural + gates` 可以视为未来统一装配协议的最小前身。

## 2. 统一检索入口

对外只暴露一个统一检索入口：

- `retrieve_context`

内部根据目标自动选择对象层：

- `entity`
- `memory_fact`
- `knowledge_fact`
- `document`
- `section`
- `evidence`
- `relation`

不再区分“先搜记忆”还是“先搜知识库”两个孤岛入口。

## 3. 内部检索链路

建议固定为 5 段：

1. `entity/fact lookup`
2. `graph expansion`
3. `evidence grounding`
4. `hybrid ranking`
5. `context assembly`

### 3.1 entity/fact lookup

作用：

- 先命中显式实体
- 命中高置信事实
- 命中直接相关的 section

优先命中类型：

- 主体明确的 query
- 已知术语、项目名、模块名
- 高置信长期事实

### 3.2 graph expansion

从初始命中的对象向外扩一跳或两跳。

典型扩边：

- `fact -> evidence`
- `entity -> fact`
- `entity -> relation -> entity`
- `section -> mentioned entity`
- `fact -> conflicts_with -> fact`

限制：

- 默认 1 跳
- 高风险模式下禁止无限扩张
- 必须记录每一步扩边路径

### 3.3 evidence grounding

每个拟返回结论都要能回落到：

- `evidence`
- `section`
- `document`

目标不是堆全文，而是给出：

- 证据引用
- 证据摘要
- 必要摘录

### 3.4 hybrid ranking

排序不能只看向量相似度。

第一版建议综合：

- 结构命中分
- 图距离分
- 证据强度分
- 时效分
- 审查状态分
- 使用历史分
- 向量相似度分

其中 HNSW/ANN 只贡献辅助召回和相似度信号，不决定最终真相。

## 4. 上下文装配协议

### 4.1 返回对象

装配层返回结构化上下文包，而不是“替用户发一段召回文本”。

建议字段：

- `context_summary`
- `facts[]`
- `entities[]`
- `relations[]`
- `evidence_refs[]`
- `section_refs[]`
- `open_questions[]`
- `warnings[]`
- `assembly_trace`

### 4.2 facts

每个 `fact` 至少包含：

- `id`
- `fact_kind`
- `statement`
- `confidence`
- `source_refs[]`

### 4.3 entities

每个 `entity` 至少包含：

- `id`
- `type`
- `canonical_name`
- `summary`

### 4.4 relations

每个 `relation` 至少包含：

- `from`
- `type`
- `to`
- `confidence`

### 4.5 evidence_refs

每个证据引用至少包含：

- `evidence_id`
- `source_uri`
- `trust_level`
- `excerpt`

## 5. 装配安全约束

### 5.1 禁止行为

- 禁止把召回文本直接伪装成普通 `user` 消息
- 禁止把未经分层的 raw recall 拼成一个大 prompt
- 禁止丢失来源和证据链

### 5.2 必须行为

- 每条结论必须可解释
- 每次装配必须有 trace
- 每个对象必须保留 object type
- 每次装配必须可区分事实、猜测、待确认项

## 6. HNSW 的角色

HNSW 用于：

- `section` ANN 检索
- `snippet` 辅助召回
- `fact` 的短文本语义近邻搜索

HNSW 不负责：

- 决定知识本体
- 解决冲突
- 决定最终上下文可用性

## 7. 第一版 API 契约建议

请求体建议：

- `query`
- `task_request_id`
- `task_step_id`
- `retrieval_mode`
- `include_memory`
- `include_knowledge`
- `include_evidence`
- `fingerprint`
- `fingerprint_status`
- `limit`
- `trace_level`

响应体建议：

- `context_summary`
- `facts`
- `entities`
- `relations`
- `evidence_refs`
- `section_refs`
- `open_questions`
- `warnings`
- `gates`
- `assembly_trace`

## 8. 为什么这能避免旧式文本注入

原因不在于“检索更强”，而在于协议变了：

- 检索结果不再伪装成自然对话
- 装配层输出结构化对象集合
- 上层 Agent 明确知道哪些是事实、证据、关系和待确认项
- 每条知识都带来源和 trace

也就是说，系统把“召回内容”从文本拼接材料升级成了“可解释的认知对象集合”。
