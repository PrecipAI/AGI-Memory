# 统一长期知识系统与当前 Memory 模块承接说明

## 1. 目标

本说明用于明确：

- 当前 `memory-service + memory-mcp` 不是废弃资产
- 未来统一长期知识系统应直接建立在当前 memory 模块之上
- 哪些能力复用，哪些能力扩展，哪些能力后移到图谱与 Ops 层

## 2. 当前 Memory 模块已经具备的基础

当前模块已经具备以下可复用能力：

- 单一检索入口：`memory_retrieve_context`
- 分层读取：`conversation_summary / resident_snapshot / factual_memory / procedural_memory`
- 写入候选：`memory_ingest_candidate`
- 路由和准入：`memory_candidate -> memory / skill / drop / block`
- 治理入口：`memory_run_governance`
- 指纹门控：`fingerprint + fingerprint_status`
- 使用追踪基础：`memory_access_log`

这些能力意味着当前系统已经具备统一长期知识系统的“第一层骨架”，不是从零开始。

## 3. 当前对象到未来对象的映射

### 3.1 可直接承接

- `memory_candidate`
  - 承接为未来 `inbox/candidate` 队列基础
- `memory`
  - 承接为未来 `memory_fact`，其中一部分后续可升级为 `knowledge_fact`
- `skill`
  - 承接为未来的过程型知识对象，当前仍保留 procedural memory 角色
- `resident_snapshot`
  - 承接为阶段性上下文快照能力
- `conversation_summary`
  - 承接为历史总结层
- `environment_fingerprint`
  - 承接为环境约束与过程知识门控层
- `memory_access_log`
  - 承接为 Usage / Trace 的基础日志

### 3.2 需要扩展

- `entity`
  - 当前模块没有独立实体层，需要新增
- `relation`
  - 当前模块没有显式图边层，需要新增
- `document / section / evidence`
  - 当前模块只有 `source_ref`，缺少文档和证据的一等对象，需要新增
- `context assembly`
  - 当前模块能返回 bundle，但尚未上升为统一长期知识系统的结构化装配协议

## 4. 推荐演进路径

### Phase 0

保留现有 memory 模块作为基线系统：

- 继续提供 factual/procedural retrieval
- 继续提供 governance
- 继续作为 benchmark 对照组

### Phase 1

在 memory 模块旁边新增知识骨架对象：

- `entity`
- `relation`
- `document`
- `section`
- `evidence`

此阶段不强行替换现有 retrieval。

### Phase 2

让 governance 同时整理：

- 现有 memory objects
- 新增 graph objects

图谱先属于治理产物，不先进入写入主链路。

### Phase 3

新增统一检索编排层：

- 保留原 `memory_retrieve_context`
- 新增统一长期知识系统检索协议
- 在内部调用当前 memory 层 + graph 扩展层

### Phase 4

引入独立 Knowledge Ops Console：

- 使用 `memory_access_log`
- 使用 governance 结果
- 使用 graph objects

## 5. 结论

未来统一长期知识系统应被视为：

- 当前 Memory 模块的上层演进
- 图谱骨架、文档对象、证据对象、Ops Console 对当前模块的系统性扩展

而不是“推翻 memory，重做一套新系统”。
