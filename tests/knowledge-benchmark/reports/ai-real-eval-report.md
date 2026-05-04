# AI 知识库真实评测报告

生成时间：2026-04-29T02:39:14.902Z

## 1. 本次评测口径

- Benchmark：knowledge-ai-real-eval-v1
- Tenant：tenant-local
- Scope：memory.validation
- 语料数量：8
- 召回问题数量：10
- 测试目标：验证真实 AI 方向资料从导入、Markdown 标准化、原文保存、section/evidence 生成，到 BM25 + vector + RRF 普通召回链路是否可运行。
- 注意：当前 vector 后端已经使用 Milvus + HTTP embedding service；如果后续出现 fallback，需要先检查 embedding service、Milvus 服务和 `MILVUS_ADDRESS`。

## 2. 核心指标

| 指标 | 结果 | 含义 |
| --- | ---: | --- |
| 导入成功率 | 100% | 真实资料能否成功进入知识库 |
| Hit@1 | 50% | 第 1 条结果是否命中预期文档 |
| Hit@3 | 70% | 前 3 条是否命中预期文档 |
| Hit@5 | 90% | 前 5 条是否命中预期文档 |
| 必要术语通过率 | 70% | 返回 evidence/fact 是否包含 must-have 关键词 |
| 导入 P50 | 11033.265 ms | 单篇导入中位延迟 |
| 导入 P95 | 12562.117 ms | 单篇导入高位延迟 |
| 召回 P50 | 167.599 ms | 单次召回中位延迟 |
| 召回 P95 | 249.787 ms | 单次召回高位延迟 |
| 向量引擎 | milvus:super_agent_knowledge_sections_http_baai_bge_m3_1024:http:BAAI/bge-m3 | 本轮 retrieval trace 中实际使用的 vector backend |

## 3. 导入测试集与结果

| ID | 主题 | 标题 | 来源类型 | 导入状态 | Section | Candidate | Fact | Converter |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| ingest-ai-agent-memory-001 | agent_memory | GitHub Copilot Memory Public Preview | web_article | 200 | 4 | 4 | 4 | html-to-markdown-lite-v1 |
| ingest-ai-agent-memory-002 | agent_memory | Building an Agentic Memory System for GitHub Copilot | web_article | 200 | 18 | 18 | 18 | html-to-markdown-lite-v1 |
| ingest-ai-agent-framework-001 | agent_framework | LangGraph Memory Overview | web_article | 200 | 13 | 13 | 13 | html-to-markdown-lite-v1 |
| ingest-ai-agent-framework-002 | agent_framework | LangGraph Memory Agent | web_article | 200 | 20 | 20 | 20 | html-to-markdown-lite-v1 |
| ingest-ai-agent-framework-003 | agent_framework | Microsoft AutoGen Repository | web_article | 200 | 30 | 30 | 30 | html-to-markdown-lite-v1 |
| ingest-ai-agentic-rag-001 | agentic_rag | Haystack Repository | web_article | 200 | 25 | 25 | 25 | html-to-markdown-lite-v1 |
| ingest-ai-agentic-rag-002 | agentic_rag | SoK Agentic RAG | web_article | 200 | 4 | 4 | 4 | arxiv-paper-organizer-v1 |
| ingest-ai-eval-harness-001 | eval_harness | RAGalyst | web_article | 200 | 4 | 4 | 4 | arxiv-paper-organizer-v1 |

## 4. 召回测试集与结果

| ID | 主题 | 意图 | Hit@1 | Hit@3 | Hit@5 | 必要术语 | 延迟 | 向量引擎 | 首条返回 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| ai-query-001 | agent_memory | fact_lookup | 通过 | 通过 | 通过 | 通过 | 249.787 ms | milvus:super_agent_knowledge_sections_http_baai_bge_m3_1024:http:BAAI/bge-m3 | Building an Agentic Memory System for GitHub Copilot |
| ai-query-002 | agent_memory | boundary_or_risk | 未通过 | 通过 | 通过 | 未通过 | 159.481 ms | milvus:super_agent_knowledge_sections_http_baai_bge_m3_1024:http:BAAI/bge-m3 | Haystack Repository |
| ai-query-003 | agent_framework | definition_lookup | 未通过 | 未通过 | 未通过 | 通过 | 175.141 ms | milvus:super_agent_knowledge_sections_http_baai_bge_m3_1024:http:BAAI/bge-m3 | LangGraph Memory Agent |
| ai-query-004 | agent_framework | fact_lookup | 未通过 | 未通过 | 通过 | 未通过 | 165.316 ms | milvus:super_agent_knowledge_sections_http_baai_bge_m3_1024:http:BAAI/bge-m3 | LangGraph Memory Overview |
| ai-query-005 | agent_framework | time_sensitive_change | 通过 | 通过 | 通过 | 通过 | 166.131 ms | milvus:super_agent_knowledge_sections_http_baai_bge_m3_1024:http:BAAI/bge-m3 | Microsoft AutoGen Repository |
| ai-query-006 | agentic_rag | architecture_relation | 通过 | 通过 | 通过 | 通过 | 158.963 ms | milvus:super_agent_knowledge_sections_http_baai_bge_m3_1024:http:BAAI/bge-m3 | Haystack Repository |
| ai-query-007 | agentic_rag | boundary_or_risk | 未通过 | 通过 | 通过 | 通过 | 188.911 ms | milvus:super_agent_knowledge_sections_http_baai_bge_m3_1024:http:BAAI/bge-m3 | RAGalyst |
| ai-query-008 | eval_harness | evidence_grounding | 通过 | 通过 | 通过 | 通过 | 168.328 ms | milvus:super_agent_knowledge_sections_http_baai_bge_m3_1024:http:BAAI/bge-m3 | RAGalyst |
| ai-query-009 | cross_topic | cross_section_summary | 未通过 | 未通过 | 通过 | 未通过 | 178.98 ms | milvus:super_agent_knowledge_sections_http_baai_bge_m3_1024:http:BAAI/bge-m3 | LangGraph Memory Overview |
| ai-query-010 | cross_topic | cross_section_summary | 通过 | 通过 | 通过 | 通过 | 167.599 ms | milvus:super_agent_knowledge_sections_http_baai_bge_m3_1024:http:BAAI/bge-m3 | RAGalyst |

## 5. 失败与边界项

- ai-query-002：Hit@5=通过，必要术语=未通过。预期=Building an Agentic Memory System for GitHub Copilot；前 5 返回=Haystack Repository / Microsoft AutoGen Repository / Building an Agentic Memory System for GitHub Copilot / GitHub Copilot Memory Public Preview / GitHub Copilot Memory Public Preview。
- ai-query-003：Hit@5=未通过，必要术语=通过。预期=LangGraph Memory Overview；前 5 返回=LangGraph Memory Agent / LangGraph Memory Agent / LangGraph Memory Agent / LangGraph Memory Agent / LangGraph Memory Agent。
- ai-query-004：Hit@5=通过，必要术语=未通过。预期=LangGraph Memory Agent；前 5 返回=LangGraph Memory Overview / LangGraph Memory Overview / LangGraph Memory Overview / LangGraph Memory Agent / LangGraph Memory Agent。
- ai-query-009：Hit@5=通过，必要术语=未通过。预期=Building an Agentic Memory System for GitHub Copilot / SoK Agentic RAG / RAGalyst；前 5 返回=LangGraph Memory Overview / LangGraph Memory Overview / LangGraph Memory Overview / SoK Agentic RAG / LangGraph Memory Overview。

## 6. 边界检查

| 检查项 | 结果 | 说明 |
| --- | ---: | --- |
| duplicate_ingest_same_source_uri | 通过 | first=f54c55d3-e6bc-4b86-8b00-141a7d359c69; second=f54c55d3-e6bc-4b86-8b00-141a7d359c69 |
| markitdown_file_adapter | 通过 | converter=markitdown-v0.1.5; markdown_ref=D:\workspace\outputs\knowledge-sources\MarkItDown-Adapter-Smoke-ea6381ca-f93d-497c-b3d5-448c4c20fa18\source.md |
| empty_inline_content | 通过 | status=400 |

## 7. Console 检查

| 检查项 | 结果 | 说明 |
| --- | ---: | --- |
| overview API | 200 | Ops Console overview 接口状态 |
| documents API | 200 | Ops Console documents 接口状态 |
| graph facts API | 200 | Ops Console graph facts 接口状态 |
| scope document_count | 34 | 当前 single-tenant scope 的总文档数，不等于本轮 benchmark 文档数 |

## 8. 当前结论

- 已打通：真实资料导入、Markdown 标准化、原文入库和落盘、section/evidence 生成、MarkItDown 文件 adapter、BM25 + vector + RRF 普通召回、Ops Console smoke。
- Milvus 口径：本轮 retrieval trace 已确认使用 Milvus + HTTP embedding service，正式向量后端链路已打通。
- 未完成：跨来源图治理、中文审查层、图搜索召回、结构化导航召回、三路横向对比、Hit@1 优化。
- 当前普通召回可以作为第一版 baseline，但还不能宣称最终知识图谱召回已经打通。
