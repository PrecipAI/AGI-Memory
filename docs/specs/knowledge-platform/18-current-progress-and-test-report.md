# 当前进度与真实测试报告

对应项目 SPEC：
- `D:\workspace\projects\SuperAgentSystem-main\SPEC-SuperAgentSystem-knowledge-platform.md`

报告时间：
- 2026-04-28

## 1. 当前已完成

### 1.1 数据与对象模型

已落地第一版统一长期知识系统的核心表：
- `kp_document`
- `kp_section`
- `kp_evidence`
- `kp_entity`
- `kp_fact`
- `kp_relation`
- `kp_candidate_link`
- `kp_review_queue`
- `kp_context_bundle`
- `kp_governance_job`

已新增 Markdown 原文层：
- `kp_document.markdown_content`
- `kp_document.markdown_content_hash`
- `kp_document.markdown_content_ref`
- `kp_document.markdown_converted_at`
- `kp_document.markdown_converter`

结论：
- 数据库里保存完整 Markdown 原文。
- 同时在 `D:\workspace\outputs\knowledge-sources` 落盘 `source.md`，方便人工检查和回放。

### 1.2 导入链路

已支持：
- `inline_text`
- `markdown_text`
- `markdown_file`
- `local_file`
- `markitdown_file`
- `markitdown_url`

已接入：
- Web HTML 到 Markdown 的轻量转换链路。
- arXiv 论文元数据整理链路 `arxiv-paper-organizer-v1`。
- Microsoft MarkItDown 文件 / URL adapter。
- 导入后生成 document、section、evidence、candidate。
- 可选触发 knowledge governance。

当前限制：
- HTML 清洗仍是轻量版本，不是最终 crawler/readability 链路。
- 复杂论文 PDF 的 Marker / MinerU / Docling 兜底评测还没有做。
- MarkItDown 已接入，但正式批量导入策略还需要和论文整理器融合优化。

### 1.3 治理链路

已支持：
- rule-based candidate governance。
- 从 candidate 生成 fact、entity、relation。
- evidence / section 回链。
- review queue。
- context bundle。

当前限制：
- 治理层还没有正式接入模型 worker。
- 还没有实现用户要求的跨来源主动图谱治理。
- 当前 relation 主要是来源、证据、派生关系，不是最终知识图谱关系。

### 1.4 召回链路

已支持：
- `POST /internal/knowledge/retrieve`
- facts / entities / sections 查询。
- BM25 + vector + RRF 普通召回 baseline。
- PostgreSQL text ranking 作为 BM25 的内部实现。
- 应用层 `hashing_vector_v1` 向量 baseline。
- fastembed + Milvus 正式向量路径。
- Milvus 不可达时自动降级到 hashing vector baseline。
- context bundle 结构化输出。

当前限制：
- 当前机器没有可连接 Milvus，所以真实评测仍走 fallback。
- 当前没有图搜索召回。
- 当前没有结构化导航召回。
- 当前还没有三路横向对比报告。

### 1.5 Ops Console

已支持：
- Overview。
- Documents。
- Document detail。
- Review Queue。
- Governance Runs。
- Graph list。
- 点击文档进入详情。
- document detail 返回 sections、facts、relations、evidence。

当前限制：
- 仍偏工程调试台，不是最终审查产品。
- 中文审查视图还没有做。
- fact / relation / evidence / chunk 还没有独立详情页。

## 2. 本次正式测试

执行命令：

```powershell
$env:PGPASSWORD='postgres'
$env:MARKITDOWN_BIN='C:\Users\Administrator\AppData\Local\Programs\Python\Python311\Scripts\markitdown.exe'
npm run verify:knowledge
npm run eval:knowledge:real
```

验证通过：
- `npm run verify:knowledge`
- `npm run eval:knowledge:real`

测试集：
- `D:\workspace\projects\SuperAgentSystem-main\tests\knowledge-benchmark\ai-real-ingest-cases.v1.json`
- `D:\workspace\projects\SuperAgentSystem-main\tests\knowledge-benchmark\ai-real-retrieval-benchmark.v1.json`

测试结果：
- `D:\workspace\projects\SuperAgentSystem-main\tests\knowledge-benchmark\reports\ai-real-eval-report.json`
- `D:\workspace\projects\SuperAgentSystem-main\tests\knowledge-benchmark\reports\ai-real-eval-report.md`

Milvus 接入说明：
- `D:\workspace\projects\SuperAgentSystem-main\docs\specs\knowledge-platform\19-formal-embedding-milvus-integration.md`

源码缓存：
- `D:\workspace\projects\SuperAgentSystem-main\tests\knowledge-benchmark\source-cache`

## 3. 测试集内容

导入语料共 8 份，覆盖：
- agent memory。
- agent framework。
- agentic RAG。
- eval harness。

召回问题共 10 条，覆盖：
- 精确事实查询。
- 边界 / 风险查询。
- 定义查询。
- 架构关系查询。
- 跨主题总结查询。

## 4. 最新测试结果

核心指标：

```text
ingest_success_rate = 1.0
Hit@1 = 0.6
Hit@3 = 0.8
Hit@5 = 1.0
must_have_pass_rate = 0.8
ingest P50 = 75.415 ms
ingest P95 = 108.462 ms
retrieve P50 = 34.782 ms
retrieve P95 = 113.703 ms
vector_engine = hashing_vector_v1_fallback_after_milvus_error
```

数据库验证：

```text
benchmark_documents = 8
benchmark_facts = 118
```

边界检查：
- 重复导入同一 `source_uri`：通过，返回同一个 document id。
- MarkItDown 文件 adapter：通过，返回 `markdown_converter = markitdown-v0.1.5`。
- 空 inline content：通过，返回 400 `BAD_REQUEST`。
- Milvus backend 验证：未通过，原因是 `127.0.0.1:19530` 没有可连接 Milvus。

## 5. 当前暴露的问题

### 5.1 普通召回仍不是最终召回

现象：
- Hit@5 已达到 100%。
- Hit@1 只有 60%。
- 必要术语通过率 80%。

判断：
- 普通召回 baseline 已经可用。
- 排序质量还不够稳定。
- 需要正式 embedding、rerank、图搜索和结构化导航对比。

### 5.2 向量后端仍是 baseline

代码已接入：
- `fastembed:fast-bge-small-en-v1.5`
- Milvus collection：`super_agent_knowledge_sections`
- Milvus index：HNSW + COSINE

当前机器实际运行是：
- `hashing_vector_v1_fallback_after_milvus_error`

原因：
- 当前 Windows 机器没有 Docker。
- WSL 未安装可用发行版。
- `127.0.0.1:19530` 没有 Milvus 服务。
- `pymilvus` 已安装，但 Milvus Lite 本地文件模式在当前 Windows 环境不可用。

后续只要提供可连接 Milvus endpoint，再运行：

```powershell
npm run verify:knowledge:milvus
npm run eval:knowledge:real
```

报告里的 `vector_engine` 应变为：

```text
milvus:super_agent_knowledge_sections:fastembed:fast-bge-small-en-v1.5
```

### 5.3 治理层还没有模型接入

当前治理是 rule-based。

后续需要：
- 接入小模型 / 大模型 worker。
- 做准入、冲突、去重、时效、关系发现。
- 专门做跨来源主动图谱治理。

### 5.4 中文审查层还没完成

当前保留英文原文和英文 evidence。

后续需要：
- 生成中文摘要。
- 生成中文 fact。
- 生成中文 relation reasoning。
- 英文原文保留为 evidence。

### 5.5 single-tenant 限制影响测试隔离

当前系统仍限制：

```text
tenant-local / memory.validation
```

所以真实评测不能通过换 scope 隔离，只能在默认 scope 内清理 benchmark trace 后重跑。

## 6. 当前结论

当前可以定义为：

```text
第一版知识平台工程骨架、真实资料导入、Markdown 原文保存、
MarkItDown adapter、BM25 + vector + RRF 普通召回 baseline 已经打通。
fastembed + Milvus 正式向量代码路径已接入，但当前机器缺 Milvus 服务。
```

但还不能定义为：

```text
最终长期知识系统已经完成。
```

未打通的关键能力：
- 可运行 Milvus endpoint 下的正式 embedding 真实评测。
- 跨来源图谱治理。
- 图搜索召回。
- 结构化导航召回。
- 中文 Knowledge Ops 审查层。
- 普通召回、图搜索、结构化导航三路横向对比。
