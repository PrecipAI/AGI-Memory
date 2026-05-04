# 长期知识/记忆系统能力边界评测报告

生成时间：2026-04-30T10:07:12.213Z

## 1. 当前语料状态

- Active documents：121
- Active sections：2401
- Active evidence：2401
- Active synthesized knowledge：16
- Intermediate facts/entities/relations：0/0/0
- Intermediate recall surface：0

## 2. 总体指标

| 指标 | 结果 |
| --- | ---: |
| 总 case | 48 |
| 通过 case | 48 |
| 总通过率 | 100% |
| 正向能力通过率 | 100% |
| 边界拒召回通过率 | 100% |
| 平均延迟 | 265.026 ms |
| P50 延迟 | 274.225 ms |
| P95 延迟 | 509.135 ms |
| 最大延迟 | 549.287 ms |
| 平均 derived 命中 | 3.292 |
| 平均 evidence trace | 17.563 |
| 平均唯一 evidence source | 17.104 |

## 3. 分类指标

| 类别 | Case | 通过 | 通过率 | 平均延迟 | 平均 Derived | 平均 Evidence Source |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| agent_harness | 4 | 4 | 100% | 229.417 ms | 3.5 | 17.75 |
| cross_lingual | 3 | 3 | 100% | 482.561 ms | 5 | 23 |
| cross_source_synthesis | 3 | 3 | 100% | 358.611 ms | 4 | 21.667 |
| graph_boundary_non_search | 3 | 3 | 100% | 325.034 ms | 5 | 24.333 |
| intermediate_purge_contract | 2 | 2 | 100% | 367.92 ms | 3.5 | 15 |
| irrelevant_boundary | 5 | 5 | 100% | 0.979 ms | 0 | 0 |
| knowledge_platform | 3 | 3 | 100% | 385.757 ms | 3.667 | 21 |
| memory_governance | 4 | 4 | 100% | 182.392 ms | 3.75 | 17 |
| observability | 3 | 3 | 100% | 230.919 ms | 5 | 26.333 |
| rag_evaluation | 3 | 3 | 100% | 387.842 ms | 4.667 | 25.667 |
| rag_retrieval | 4 | 4 | 100% | 360.367 ms | 4.5 | 25.75 |
| retrieval_backend | 3 | 3 | 100% | 380.986 ms | 2.333 | 13.667 |
| security_and_mcp | 3 | 3 | 100% | 222.923 ms | 3.333 | 17 |
| specificity | 2 | 2 | 100% | 282.361 ms | 2.5 | 15.5 |
| ungoverned_document_boundary | 3 | 3 | 100% | 1.057 ms | 0 | 0 |

## 4. Case 结果

| ID | 类别 | 语言 | 结果 | 延迟 | Derived | Evidence | Sources | Facts | Warning | 首条知识 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| full-001 | memory_governance | zh-CN | 通过 | 217.901 ms | 4 | 20 | 19 | 0 | section_retrieval_empty | 长期记忆必须在使用时验证有效性，而不是只做相似召回 |
| full-002 | memory_governance | zh-CN | 通过 | 178.102 ms | 3 | 12 | 11 | 0 | section_retrieval_empty | 长期记忆必须在使用时验证有效性，而不是只做相似召回 |
| full-003 | memory_governance | zh-CN | 通过 | 161.468 ms | 4 | 20 | 19 | 0 | section_retrieval_empty | 长期记忆不能退化成向量片段库，必须显式建模结构、时间和治理 |
| full-004 | memory_governance | zh-CN | 通过 | 172.095 ms | 4 | 20 | 19 | 0 | section_retrieval_empty | 长期记忆不能退化成向量片段库，必须显式建模结构、时间和治理 |
| full-005 | security_and_mcp | zh-CN | 通过 | 201.296 ms | 2 | 12 | 11 | 0 |  | Agent 工具和 MCP 接入必须有结构化授权、沙箱和审计，而不能只靠提示词约束 |
| full-006 | security_and_mcp | zh-CN | 通过 | 217.747 ms | 4 | 21 | 19 | 0 |  | Agent 工具和 MCP 接入必须有结构化授权、沙箱和审计，而不能只靠提示词约束 |
| full-007 | security_and_mcp | en | 通过 | 249.727 ms | 4 | 23 | 21 | 0 |  | Agent 工具和 MCP 接入必须有结构化授权、沙箱和审计，而不能只靠提示词约束 |
| full-008 | agent_harness | zh-CN | 通过 | 211.528 ms | 4 | 21 | 19 | 0 |  | Agent 可靠性主要由 harness 决定，不应只依赖模型和长提示词 |
| full-009 | agent_harness | zh-CN | 通过 | 206.704 ms | 4 | 21 | 19 | 0 |  | Agent 可靠性来自 harness 闭环，而不是单次提示词或单模型能力 |
| full-010 | agent_harness | zh-CN | 通过 | 215.301 ms | 1 | 8 | 8 | 0 |  | Agent 框架正在收敛到工具、记忆、工作流、多智能体和评估的一体化运行时 |
| full-011 | agent_harness | en | 通过 | 284.134 ms | 5 | 27 | 25 | 0 |  | Agent 可靠性主要由 harness 决定，不应只依赖模型和长提示词 |
| full-012 | observability | zh-CN | 通过 | 211.919 ms | 5 | 26 | 23 | 0 |  | Agent 观测必须记录轨迹、工具调用、上下文和成本，否则无法治理失败 |
| full-013 | observability | zh-CN | 通过 | 199.938 ms | 5 | 32 | 31 | 0 |  | Agent 观测必须记录轨迹、工具调用、上下文和成本，否则无法治理失败 |
| full-014 | observability | en | 通过 | 280.899 ms | 5 | 25 | 25 | 0 |  | 成熟 RAG 系统会把检索、证据装配和可观测性拆成独立环节 |
| full-015 | rag_retrieval | zh-CN | 通过 | 369.29 ms | 5 | 27 | 27 | 0 |  | 生产级检索默认应采用多信号候选、重排和证据边界，而不是单一路径 |
| full-016 | rag_retrieval | zh-CN | 通过 | 344.166 ms | 5 | 28 | 28 | 0 |  | 生产级检索默认应采用多信号候选、重排和证据边界，而不是单一路径 |
| full-017 | rag_retrieval | zh-CN | 通过 | 323.326 ms | 3 | 19 | 19 | 0 |  | 生产级检索默认应采用多信号候选、重排和证据边界，而不是单一路径 |
| full-018 | rag_retrieval | en | 通过 | 404.685 ms | 5 | 29 | 29 | 0 |  | RAG 评估必须拆开检索质量、生成忠实度和多轮行为 |
| full-019 | rag_evaluation | zh-CN | 通过 | 351.339 ms | 5 | 25 | 25 | 0 |  | RAG 评估必须拆开检索质量、生成忠实度和多轮行为 |
| full-020 | rag_evaluation | zh-CN | 通过 | 359.151 ms | 4 | 24 | 24 | 0 |  | 生产级 RAG 应拆成检索、重排、证据校验、观测和安全治理的闭环 |
| full-021 | rag_evaluation | en | 通过 | 453.036 ms | 5 | 28 | 28 | 0 |  | RAG 评估必须拆开检索质量、生成忠实度和多轮行为 |
| full-022 | retrieval_backend | zh-CN | 通过 | 233.523 ms | 1 | 7 | 7 | 0 | section_retrieval_empty | 检索基础设施应抽象为可替换后端，核心契约是混合召回、过滤、融合和重排 |
| full-023 | retrieval_backend | zh-CN | 通过 | 360.149 ms | 1 | 7 | 7 | 0 |  | 检索基础设施应抽象为可替换后端，核心契约是混合召回、过滤、融合和重排 |
| full-024 | retrieval_backend | en | 通过 | 549.287 ms | 5 | 27 | 27 | 0 |  | 检索基础设施应抽象为可替换后端，核心契约是混合召回、过滤、融合和重排 |
| full-025 | knowledge_platform | zh-CN | 通过 | 343.534 ms | 1 | 6 | 6 | 0 |  | 成熟知识平台正在收敛为知识库、工作流、Agent 和多源数据的一体化系统 |
| full-026 | knowledge_platform | zh-CN | 通过 | 340.468 ms | 5 | 27 | 27 | 0 |  | 成熟知识平台正在收敛为知识库、工作流、Agent 和多源数据的一体化系统 |
| full-027 | knowledge_platform | en | 通过 | 473.269 ms | 5 | 31 | 30 | 0 |  | 成熟知识平台正在收敛为知识库、工作流、Agent 和多源数据的一体化系统 |
| full-028 | graph_boundary_non_search | zh-CN | 通过 | 277.536 ms | 5 | 25 | 25 | 0 | section_retrieval_empty | 图谱召回适合关系型问题，但不能替代证据治理和事实有效性判断 |
| full-029 | graph_boundary_non_search | zh-CN | 通过 | 250.897 ms | 5 | 25 | 25 | 0 | section_retrieval_empty | 图谱抽取不等于知识治理，chunk 内路径只能作为图谱候选 |
| full-030 | graph_boundary_non_search | en | 通过 | 446.668 ms | 5 | 23 | 23 | 0 |  | 检索基础设施应抽象为可替换后端，核心契约是混合召回、过滤、融合和重排 |
| full-031 | cross_source_synthesis | zh-CN | 通过 | 408.35 ms | 2 | 12 | 12 | 0 |  | 生产级检索默认应采用多信号候选、重排和证据边界，而不是单一路径 |
| full-032 | cross_source_synthesis | zh-CN | 通过 | 393.259 ms | 5 | 28 | 28 | 0 |  | Agent 工具和 MCP 接入必须有结构化授权、沙箱和审计，而不能只靠提示词约束 |
| full-033 | cross_source_synthesis | zh-CN | 通过 | 274.225 ms | 5 | 25 | 25 | 0 | section_retrieval_empty | 成熟 RAG 系统会把检索、证据装配和可观测性拆成独立环节 |
| full-034 | cross_lingual | en | 通过 | 424.318 ms | 5 | 21 | 20 | 0 |  | 长期记忆必须在使用时验证有效性，而不是只做相似召回 |
| full-035 | cross_lingual | en | 通过 | 509.135 ms | 5 | 27 | 27 | 0 |  | 检索基础设施应抽象为可替换后端，核心契约是混合召回、过滤、融合和重排 |
| full-036 | cross_lingual | en | 通过 | 514.231 ms | 5 | 23 | 22 | 0 |  | 长期记忆召回不能只做相似检索，必须在使用时验证有效性 |
| full-037 | intermediate_purge_contract | zh-CN | 通过 | 372.011 ms | 2 | 6 | 6 | 0 |  | 图谱召回适合关系型问题，但不能替代证据治理和事实有效性判断 |
| full-038 | intermediate_purge_contract | zh-CN | 通过 | 363.829 ms | 5 | 24 | 24 | 0 |  | 检索基础设施应抽象为可替换后端，核心契约是混合召回、过滤、融合和重排 |
| full-039 | specificity | zh-CN | 通过 | 317.431 ms | 4 | 24 | 24 | 0 |  | 生产级 RAG 应拆成检索、重排、证据校验、观测和安全治理的闭环 |
| full-040 | specificity | zh-CN | 通过 | 247.291 ms | 1 | 7 | 7 | 0 | section_retrieval_empty | 检索基础设施应抽象为可替换后端，核心契约是混合召回、过滤、融合和重排 |
| full-041 | ungoverned_document_boundary | zh-CN | 通过 | 1.08 ms | 0 | 0 | 0 | 0 | unsupported_dynamic_query | N/A |
| full-042 | ungoverned_document_boundary | zh-CN | 通过 | 1.29 ms | 0 | 0 | 0 | 0 | unsupported_dynamic_query | N/A |
| full-043 | ungoverned_document_boundary | en | 通过 | 0.8 ms | 0 | 0 | 0 | 0 | unsupported_dynamic_query | N/A |
| full-044 | irrelevant_boundary | zh-CN | 通过 | 0.745 ms | 0 | 0 | 0 | 0 | unsupported_dynamic_query | N/A |
| full-045 | irrelevant_boundary | en | 通过 | 0.88 ms | 0 | 0 | 0 | 0 | unsupported_dynamic_query | N/A |
| full-046 | irrelevant_boundary | zh-CN | 通过 | 1.586 ms | 0 | 0 | 0 | 0 | unsupported_dynamic_query | N/A |
| full-047 | irrelevant_boundary | zh-CN | 通过 | 0.949 ms | 0 | 0 | 0 | 0 | unsupported_dynamic_query | N/A |
| full-048 | irrelevant_boundary | en | 通过 | 0.736 ms | 0 | 0 | 0 | 0 | unsupported_dynamic_query | N/A |

## 5. 失败与边界

- 本轮没有失败 case。

## 6. 当前能力判断

- 已具备：治理产物优先召回、证据链返回、中文查询、英文 evidence 回跳、facts/entities/relations 不作为长期召回对象。
- 边界：排序仍是确定性规则，不是模型 rerank；泛化知识可能抢占具体 query；无关 query 需要持续监控误召回。
- 下一步：扩大 case 到 50-100 条，加入期望 top1、跨宿主 MCP/HTTP 一致性、性能分布和人工审查列。
