# 2026-04-29 路线修订：暂停向量召回主线

## 结论

当前阶段不再把 `BM25 + Vector + RRF` 作为知识平台产品主线推进。

系统路线调整为：

```text
Markdown 入库
-> section / evidence
-> 基础图谱抽取
-> 证据内明确关系
-> 图谱召回
-> 后续治理层做跨文档关系
```

## 2026-04-29 Graph-first retrieve 修订

当前 `/internal/knowledge/retrieve` 已改为图谱优先：

1. query 先命中 `entity` / `fact`。
2. 根据命中的 `entity` / `fact` 查询 `kp_relation`。
3. 从关系中收集 `evidence` 和 `section`。
4. 如果存在 graph-grounded section，优先返回图谱 section。
5. 只有图谱没有 section grounding 时，才 fallback 到 BM25 / lexical section 检索。

当前 trace 示例：

```json
{
  "retrieval": {
    "method": "graph_first",
    "mode": "graph_grounded",
    "fallback_method": "bm25_lexical_rrf"
  }
}
```

这表示普通召回不再是主路线，只是图谱未命中时的兜底。

## 原因

- 最终目标已调整为图谱优先的长期知识系统。
- 向量召回只能作为普通文本相似检索，不能替代实体、事实、关系和证据链。
- 继续打磨普通向量召回会形成一套后续可能废弃的并行系统。
- 当前真正关键路径是基础图谱链路，而不是向量召回准确率。

## 当前执行口径

- Markdown 入库继续保留。
- section / evidence 继续保留。
- 基础图谱抽取继续推进。
- 第一阶段只建立证据内明确关系。
- 第一阶段不做跨文档推理关系。
- 向量索引和向量检索默认关闭。
- bge-m3 / Milvus 相关代码保留为可选能力，但不在当前主链路启用。

## 运行开关

默认关闭：

```env
KNOWLEDGE_VECTOR_INDEX_ENABLED=0
KNOWLEDGE_VECTOR_RETRIEVAL_ENABLED=0
```

如需后续做对照实验，可显式打开：

```env
KNOWLEDGE_VECTOR_INDEX_ENABLED=1
KNOWLEDGE_VECTOR_RETRIEVAL_ENABLED=1
```

## 已完成代码调整

- 入库时默认不再调用 bge-m3 embedding。
- 入库时默认不再 upsert Milvus。
- 检索时默认不再 search Milvus。
- 检索时默认不再使用 hash vector fallback。
- 检索 trace 默认从 `bm25_vector_rrf` 调整为 `graph_first`。
- 图谱未命中 section 时，才 fallback 到 `bm25_lexical_rrf`。

## 验证结果

已验证：

```powershell
npm run build
```

已验证向量关闭时知识平台仍可运行：

```powershell
$env:DB_URL='postgresql://postgres:postgres@127.0.0.1:55432/super_agent_system'
$env:KNOWLEDGE_VECTOR_INDEX_ENABLED='0'
$env:KNOWLEDGE_VECTOR_RETRIEVAL_ENABLED='0'
node .\scripts\verify-knowledge-platform.mjs
```

结果：

```text
knowledge platform verification passed
```

## 后续重点

下一步不继续扩展普通向量召回 benchmark。

后续优先级：

1. 确认 Markdown 入库质量。
2. 确认 section / evidence 作为证据锚点稳定。
3. 补齐基础图谱抽取。
4. 只建立证据内明确关系。
5. 做图谱召回测试。
6. 图谱基础链路稳定后，再设计跨文档治理层。

## 2026-04-29 基础图谱契约补充

当前基础图谱阶段已经补齐以下证据内明确关系：

- `document -> has_section -> section`
- `section -> mentions -> entity`
- `section -> states -> fact`
- `fact -> about -> entity`
- `fact -> derived_from -> section`
- `fact -> evidenced_by -> evidence`

这些关系只表达当前文档/section 内部的明确结构，不表达跨文档推理关系。

已新增验证脚本：

```powershell
npm run verify:knowledge:basic-graph
```

验证结果示例：

```json
{
  "ok": true,
  "relation_contracts": [
    "about:fact->entity",
    "derived_from:fact->section",
    "evidenced_by:fact->evidence",
    "has_section:document->section",
    "mentions:section->entity",
    "states:section->fact"
  ],
  "retrieval_method": "graph_first",
  "retrieval_mode": "graph_grounded",
  "fallback_method": "bm25_lexical_rrf"
}
```
