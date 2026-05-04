# 自然语料池与多跳评测设计

## 1. 设计原则

本测试集不为了建立关系而反向挑选文档。真实用户不会主动喂入一批结构漂亮、关系完整的资料；用户只会把搜索到的网页、官方文档、GitHub README、论文、中文文章、项目记录和对话沉淀自然放进系统。

因此评测要分成两层：

- 自然语料池：模拟真实用户积累知识的混杂输入，不预先保证文档之间存在关系。
- 标注评测层：在自然语料池之上标注哪些文档事实上相关、冲突、互补、过时或无关，用来评测治理层能否自己发现。

目标不是验证“我们手工构造的图谱是否能被系统复现”，而是验证：

- 系统面对自然积累的知识库能否稳定导入。
- 普通召回能否在混杂资料中找到相关证据。
- 多跳问题能否召回足够证据角色。
- 治理层能否发现该连的关系。
- 治理层能否拒绝不该连的关系。
- 中文 query 能否召回英文证据，英文 query 能否召回中文资料。

## 2. 数据规模

当前 8 篇文档 / 10 条 query 只能作为 smoke test。下一阶段 Dev Eval 目标：

| 类型 | 数量 |
| --- | ---: |
| 文档 | 250-300 |
| 单跳 query | 300-450 |
| 多跳 query | 150-250 |
| 时间敏感 / 冲突 query | 50-80 |
| no-answer / 负例 query | 50-80 |
| 总 query | 700-1000 |

语言比例：

| 语言 | 比例 |
| --- | ---: |
| 英文 | 65%-75% |
| 中文 | 25%-35% |

中文资料不能只使用英文翻译稿，要包含中文原创工程文章、中文项目文档、中文实践总结和中文报告。

## 3. 自然语料来源

采集时只记录自然属性，不预先写关系。

推荐来源：

- 官方文档：OpenAI、LangGraph、MCP、LlamaIndex、Haystack、RAGAS、DeepEval、Inspect AI。
- GitHub 项目：README、examples、docs、changelog、issue 中的设计讨论。
- 论文：arXiv survey、方法论文、评测论文、memory / RAG / tool use / context engineering。
- 产品博客：GitHub Copilot Memory、OpenAI Agents SDK、LangChain / LangGraph 发布文章。
- 中文文章：中文技术博客、开发者社区、中文报告、中文实践总结。
- 本项目文档：SPEC、设计决策、测试报告、问题复盘。
- 对话沉淀：设计偏好、失败案例、环境约束、稳定工程规则。

采集关键词应模拟真实用户搜索，而不是为了拼关系：

```text
agent memory best practices
long-term memory AI agent
LangGraph memory
RAG evaluation framework
agentic RAG survey
MCP tool security
tool calling prompt injection
context engineering agent memory
AI Agent 长期记忆
RAG 评估 框架
MCP 协议 工具调用 安全
Agentic RAG 中文
```

## 4. 候选文档字段

`ai-dev-source-candidates.v1.json` 只做自然语料候选，不做关系标注。

字段：

```json
{
  "id": "source-agent-memory-en-001",
  "title": "LangGraph Memory Overview",
  "url": "https://docs.langchain.com/oss/javascript/langgraph/memory",
  "language": "en",
  "source_type": "official_doc",
  "topic_hint": "agent_memory",
  "quality_hint": "high",
  "freshness_hint": "current",
  "collection_method": "search",
  "collected_reason": "真实用户调研 agent memory 时可能会打开",
  "ingest_priority": "p0"
}
```

约束：

- 不允许在候选文档里写 `related_to`、`same_as`、`supports` 等关系字段。
- 可记录 `topic_hint`，但它只是采集时的粗分类，不是图谱关系。
- 完全重复 URL 不保留。
- 高相似但不同视角的文档可以保留。
- 低质量文档可以保留一部分，用于测试治理层是否降权。

## 5. 标注层设计

标注层独立于语料池，分三个文件：

```text
ai-dev-retrieval-benchmark.v1.json
ai-dev-multihop-benchmark.v1.json
ai-dev-governance-benchmark.v1.json
```

### 5.1 普通召回标注

用于测试单跳事实、定义、时间敏感信息、负例。

```json
{
  "id": "dev-query-001",
  "query": "LangGraph 如何区分短期记忆和长期记忆？",
  "language": "zh-CN",
  "intent_type": "definition_lookup",
  "expected_document_titles": ["LangGraph Memory Overview"],
  "acceptable_document_titles": ["LangGraph Memory Overview", "LangGraph Long-Term Memory Blog"],
  "must_have_terms": ["short-term", "long-term", "thread", "namespace"],
  "forbidden_document_titles": [],
  "difficulty": "easy"
}
```

### 5.2 多跳召回标注

多跳 query 不要求命中唯一文档，而要求命中必要证据角色。

```json
{
  "id": "dev-multihop-001",
  "query": "为什么长期知识系统不能只依赖向量检索，还需要治理和 evidence grounding？",
  "language": "zh-CN",
  "intent_type": "multi_hop_reasoning",
  "required_evidence_roles": [
    {
      "role": "retrieval_limitation",
      "acceptable_document_titles": ["RAGAS", "RAGVUE", "RAG Evaluation Survey"],
      "must_have_terms": ["retrieval", "context", "evaluation"]
    },
    {
      "role": "memory_governance",
      "acceptable_document_titles": ["OpenAI Memory FAQ", "LangGraph Memory Overview", "GitHub Copilot Memory System"],
      "must_have_terms": ["memory", "scope", "manage"]
    },
    {
      "role": "evidence_grounding",
      "acceptable_document_titles": ["MCP Specification", "RAGAS", "DeepEval"],
      "must_have_terms": ["evidence", "grounding", "faithfulness"]
    }
  ],
  "min_required_roles": 2,
  "forbidden_document_titles": ["Vector Database Intro"],
  "difficulty": "hard"
}
```

### 5.3 治理评测标注

治理评测不是问“能否召回”，而是问“系统是否发现正确关系，是否拒绝错误关系”。

```json
{
  "id": "dev-governance-001",
  "description": "LangGraph memory 文档与中文长期记忆实践文章应建立 same_concept_as 或 implements 关系，但不应合并为同一 document。",
  "expected_relations": [
    {
      "source_match": "LangGraph Memory Overview",
      "target_match": "Agent 记忆系统设计：从会话到长期记忆",
      "relation_type": "same_concept_as",
      "required_evidence_terms": ["long-term memory", "长期记忆"]
    }
  ],
  "forbidden_relations": [
    {
      "source_match": "LangGraph Memory Overview",
      "target_match": "GitHub Copilot Memory Public Preview",
      "relation_type": "same_document_as"
    }
  ]
}
```

## 6. 多跳指标

普通 Hit@K 不足以衡量多跳。

需要新增指标：

| 指标 | 含义 |
| --- | --- |
| Hop Recall@K | 每个必要证据角色是否被召回 |
| Path Recall@K | 是否召回了完整证据路径 |
| Role Coverage | 返回结果覆盖了多少证据角色 |
| Bridge Accuracy | 系统是否识别了 A 与 B 的真实联系 |
| Distractor Resistance | 相似但不应命中的资料是否被压下去 |
| No-answer Precision | 无答案问题是否能拒答或低置信返回 |
| Cross-lingual Recall | 中文问题召回英文证据 / 英文问题召回中文证据的能力 |
| Evidence Grounding Rate | 返回上下文是否能落到原文证据 |

## 7. 知识治理接入后应解决的问题

治理层不负责“让所有文档都有关系”，而负责在自然积累的知识库里发现关系与边界。

应解决：

- 去重：同一事实多次出现时合并 fact，保留多份 evidence。
- 区分相似概念：memory framework、product memory、conversation history、knowledge base 不能混成一个概念。
- 跨语言对齐：长期记忆、long-term memory、persistent memory 建 alias 或 equivalent concept。
- 冲突检测：旧文档与新文档在状态、版本、弃用信息上冲突。
- 时效治理：preview、deprecated、maintenance mode、migration 信息需要标记时间。
- 关系发现：supports、contradicts、extends、implements、evaluates、risk_of、supersedes、same_concept_as。
- 证据绑定：每条 fact/relation 都必须回到 document/section/snippet 原文。
- 拒绝错误关系：没有足够证据时不建立关系。

## 8. 当前知识库为了后续治理要保留的能力

即使当前只跑 BM25 + Milvus + RRF，也必须保留未来治理需要的数据：

- 原文完整保存。
- Markdown 正文保存。
- section 作为主要可读单元。
- snippet 作为辅助召回单元。
- document 级元数据：language、source_type、published_at、updated_at、source_reliability、content_hash。
- evidence 可追溯：fact/relation 必须可回到 section/snippet/document。
- query trace 保存：每次召回用了哪些 document、section、fact、relation。
- 关系表先保留，不因当前治理弱而删除。
- gold label 支持多 hop、多 role、多 acceptable document。

## 9. 下一步落地

1. 扩展 `ai-dev-source-candidates.v1.json` 到 250-300 篇。
2. 建 `ai-dev-ingest-cases.v1.json`，只从候选清单中筛入库项。
3. 建 `ai-dev-retrieval-benchmark.v1.json`，覆盖单跳、定义、时间敏感和负例。
4. 建 `ai-dev-multihop-benchmark.v1.json`，使用 evidence role 标注。
5. 建 `ai-dev-governance-benchmark.v1.json`，评测关系发现和错误关系拒绝。
6. 新增 `npm run eval:knowledge:dev`。
7. 报告中分开展示普通召回、多跳召回、治理关系、性能和边界。
