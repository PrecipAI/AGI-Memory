# 长期知识/记忆系统能力边界评测报告

生成时间：2026-04-30T10:07:21.435Z

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
| 总 case | 10 |
| 通过 case | 10 |
| 总通过率 | 100% |
| 正向能力通过率 | 100% |
| 边界拒召回通过率 | 100% |
| 平均延迟 | 257.059 ms |
| P50 延迟 | 330.092 ms |
| P95 延迟 | 389.414 ms |
| 最大延迟 | 389.414 ms |
| 平均 derived 命中 | 3.5 |
| 平均 evidence trace | 19 |
| 平均唯一 evidence source | 18.3 |

## 3. 分类指标

| 类别 | Case | 通过 | 通过率 | 平均延迟 | 平均 Derived | 平均 Evidence Source |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| agent_observability | 1 | 1 | 100% | 343.859 ms | 5 | 29 |
| cross_lingual | 1 | 1 | 100% | 389.414 ms | 4 | 21 |
| graph_boundary | 1 | 1 | 100% | 266.445 ms | 5 | 25 |
| harness_reliability | 1 | 1 | 100% | 330.092 ms | 4 | 19 |
| irrelevant_boundary | 1 | 1 | 100% | 1.5 ms | 0 | 0 |
| mcp_security | 1 | 1 | 100% | 332.397 ms | 3 | 14 |
| memory_governance | 1 | 1 | 100% | 233.76 ms | 4 | 19 |
| rag_evidence | 1 | 1 | 100% | 340.872 ms | 5 | 29 |
| specificity_ranking | 1 | 1 | 100% | 330.518 ms | 5 | 27 |
| unsupported_domain | 1 | 1 | 100% | 1.738 ms | 0 | 0 |

## 4. Case 结果

| ID | 类别 | 语言 | 结果 | 延迟 | Derived | Evidence | Sources | Facts | Warning | 首条知识 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| cap-001 | memory_governance | zh-CN | 通过 | 233.76 ms | 4 | 20 | 19 | 0 | section_retrieval_empty | 长期记忆必须在使用时验证有效性，而不是只做相似召回 |
| cap-002 | mcp_security | zh-CN | 通过 | 332.397 ms | 3 | 15 | 14 | 0 |  | Agent 工具和 MCP 接入必须有结构化授权、沙箱和审计，而不能只靠提示词约束 |
| cap-003 | agent_observability | zh-CN | 通过 | 343.859 ms | 5 | 30 | 29 | 0 |  | Agent 观测必须记录轨迹、工具调用、上下文和成本，否则无法治理失败 |
| cap-004 | rag_evidence | zh-CN | 通过 | 340.872 ms | 5 | 29 | 29 | 0 |  | 生产级检索默认应采用多信号候选、重排和证据边界，而不是单一路径 |
| cap-005 | cross_lingual | en | 通过 | 389.414 ms | 4 | 23 | 21 | 0 |  | Agent 工具和 MCP 接入必须有结构化授权、沙箱和审计，而不能只靠提示词约束 |
| cap-006 | harness_reliability | zh-CN | 通过 | 330.092 ms | 4 | 21 | 19 | 0 |  | Agent 可靠性来自 harness 闭环，而不是单次提示词或单模型能力 |
| cap-007 | graph_boundary | zh-CN | 通过 | 266.445 ms | 5 | 25 | 25 | 0 | section_retrieval_empty | 图谱召回适合关系型问题，但不能替代证据治理和事实有效性判断 |
| cap-008 | irrelevant_boundary | zh-CN | 通过 | 1.5 ms | 0 | 0 | 0 | 0 | unsupported_dynamic_query | N/A |
| cap-009 | unsupported_domain | en | 通过 | 1.738 ms | 0 | 0 | 0 | 0 | unsupported_dynamic_query | N/A |
| cap-010 | specificity_ranking | zh-CN | 通过 | 330.518 ms | 5 | 27 | 27 | 0 |  | 生产级检索默认应采用多信号候选、重排和证据边界，而不是单一路径 |

## 5. 失败与边界

- 本轮没有失败 case。

## 6. 当前能力判断

- 已具备：治理产物优先召回、证据链返回、中文查询、英文 evidence 回跳、facts/entities/relations 不作为长期召回对象。
- 边界：排序仍是确定性规则，不是模型 rerank；泛化知识可能抢占具体 query；无关 query 需要持续监控误召回。
- 下一步：扩大 case 到 50-100 条，加入期望 top1、跨宿主 MCP/HTTP 一致性、性能分布和人工审查列。
