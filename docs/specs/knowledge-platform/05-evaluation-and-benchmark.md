# 统一长期知识系统评测设计：当前 Memory 基线与未来图搜索对比

## 1. 目标

在图搜索接入前，先建立当前 Memory 检索基线；图搜索接入后，使用同一套数据进行 A/B 对比。

核心回答：

- 当前 memory 召回率是多少
- 图搜索接入后提升了多少
- 哪类 query 提升明显
- 延迟代价是多少
- 是否引入新的误召回

## 2. 评测对象

### 2.1 A 组

当前 `memory_retrieve_context`

更具体地说，就是当前这套 memory 模块：

- `conversation_summary`
- `resident_snapshot`
- `factual_memory`
- `procedural_memory`
- `fingerprint/fingerprint_status gates`

### 2.2 B 组

未来统一长期知识系统的图搜索链路：

- entity/fact lookup
- graph expansion
- evidence grounding
- hybrid ranking
- context assembly

## 3. 指标

第一版至少记录：

- `Hit@1`
- `Hit@3`
- `Hit@5`
- `MRR`
- `P50 latency`
- `P95 latency`
- `error rate`

对于结构化上下文，额外记录：

- `evidence_coverage`
- `grounding_presence`
- `trace_completeness`

## 4. 用例分类

每条 case 必须带分类，避免只看平均值。

建议分类：

- `factual_exact`
- `factual_paraphrase`
- `procedural_exact`
- `procedural_with_fingerprint`
- `entity_lookup`
- `relation_expansion`
- `evidence_grounding`
- `cross_object`

## 5. Case Schema

建议字段：

- `id`
- `scene`
- `query`
- `fingerprint`
- `fingerprint_status`
- `include_factual`
- `include_procedural`
- `expected_bucket`
- `expected_titles[]`
- `must_have_terms[]`
- `notes`

## 6. 当前阶段测试边界

当前阶段只跑 A 组基线：

- 用现有 Memory MCP / memory-service
- 不接图搜索
- 不比较图数据库实现
- 不评价最终生成回答质量

也就是说，本轮 benchmark 不是测试“未来系统想象中会怎样”，而是测试“当前 memory 模块今天到底是什么水平”。

目标是先把“检索基线、评测协议、报告格式”定住。

## 7. 结果判定

### 7.1 当前基线

要得到：

- 当前 factual recall 水平
- 当前 procedural gate 行为
- 当前 latency 基线

### 7.2 未来图搜索上线门槛

建议成功判据：

- `Hit@3` 或 `MRR` 有显著提升
- `relation_expansion` 类 query 提升明显
- `P95 latency` 不超过既定预算
- grounding 不下降
- 合同错误路径稳定不回归

## 8. 产出物

本轮至少产出：

- benchmark cases
- benchmark runner
- baseline report
- future A/B report schema

## 9. 与当前记忆系统的关系

当前 Memory MCP 仍是基线系统，不因未来统一长期知识系统设计而被替换。

评测策略是：

1. 先测当前系统
2. 再接图谱治理产物
3. 后接统一图搜索
4. 同题重跑，比较收益与代价
