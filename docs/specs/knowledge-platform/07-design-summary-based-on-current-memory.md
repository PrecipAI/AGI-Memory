# 基于当前 Memory 模块的统一长期知识系统设计收敛版

## 1. 当前判断

我们现在并不是从零开始做一个“记忆功能”，而是在现有 memory 模块基础上，升级为一个统一的长期知识系统。

当前已经具备的基础包括：

- `memory_candidate`
- `memory`
- `skill`
- `conversation_summary`
- `resident_snapshot`
- `environment_fingerprint`
- `memory_access_log`
- `memory_retrieve_context`
- `memory_run_governance`

因此，后续设计不应是推倒重来，而应是：

- 复用现有 memory 基础
- 补全长期知识系统缺失层
- 逐步引入图谱、证据、治理和装配能力

## 2. OpenAI Memory 对我们的启发与边界

OpenAI 的 Memory 方案可借鉴的点主要是：

- 长期记忆与聊天历史分层
- 用户可控、可问、可删、可关闭
- 自动做优先级管理
- 支持临时模式

但它更偏：

- 个性化产品记忆
- 黑盒式引用
- 弱证据、弱图谱

不适合作为我们的完整实现蓝本。

我们的目标更高，必须强调：

- 可解释
- 可回溯
- 可治理
- 可审查
- 可图谱化
- 可工程化

## 3. 当前 Memory 模块是否已有“基础能力”

答案是有，而且很多已经不算缺失项。

我们已经具备：

- 对话历史和长期记忆的基本分层雏形
- factual / procedural 的基本分层
- candidate -> memory / skill / drop / block 的准入路由
- governance 入口
- fingerprint gate
- access log

因此，现在缺的不是“再做一个记忆功能”，而是把现有能力系统化。

## 4. 当前记忆是否有有效期

### 4.1 当前现状

当前系统还没有一套完整、显式、统一的对象级有效期模型。

现在并不是每条 memory 都自带清晰的：

- `valid_from`
- `valid_to`
- `review_at`
- `last_verified_at`

### 4.2 当前已有的“类时效”能力

当前更接近于生命周期治理，而不是完整的时效语义治理。

已经存在的治理行为包括：

- `conversation_summary` 被新版本替代
- `resident_snapshot` 被重建和退休
- `skill` 因 fingerprint drift 被降级
- stale index 被清理
- governance 负责 lifecycle 处理

### 4.3 结论

当前系统不是没有时效治理，而是：

- 有 lifecycle 治理
- 但还没有完整的对象级时效模型

未来需要升级成双层机制：

1. 对象字段层
- `valid_from`
- `valid_to`
- `review_at`
- `last_verified_at`
- `staleness_score`

2. 治理执行层
- 降权
- 标记 `deprecated`
- 触发复核
- 建立 `supersedes`
- 归档

## 5. 我们真正要做的设计

### 5.1 目标不是做一个记忆模块

我们的目标是：

- 一个统一长期知识系统

它内部需要显式区分：

- `memory_fact`
- `knowledge_fact`
- `entity`
- `relation`
- `document`
- `section`
- `evidence`

### 5.2 当前 memory 是 Phase 0

当前 memory 模块负责：

- 候选写入
- 准入与路由
- factual / procedural 检索
- summary / resident / index / lifecycle 治理
- fingerprint 门控
- 使用追踪基础

它应被视为统一长期知识系统的 Phase 0 基础层。

### 5.3 后续必须补的系统层

#### A. 知识骨架层

新增一等对象：

- `entity`
- `relation`
- `document`
- `section`
- `evidence`
- `knowledge_fact`

#### B. 正式治理层

治理层必须升级为：

- 准入规则
- 模型抽取
- 实体合并
- 事实冲突检测
- 关系冲突检测
- 时效治理
- review queue
- summary / snapshot rebuild

#### C. 结构化上下文装配层

必须从“召回文本拼 prompt”升级为结构化装配。

输出对象应至少包含：

- `facts`
- `entities`
- `relations`
- `evidence_refs`
- `section_refs`
- `warnings`
- `assembly_trace`

#### D. 图谱增强检索层

图谱不是一开始就进在线主链路，而是：

- 先进入治理层
- 先产出图谱骨架
- 后续再接入 retrieval

#### E. 人类审查 / 运维层

必须有独立 `Knowledge Ops Console`。

至少包括：

- Inbox
- Graph
- Evidence
- Conflicts / Staleness
- Usage / Trace
- Governance Runs

## 6. 状态机是否有必要

结论：有必要，而且必须做。

但不应该做成一个覆盖全系统的巨型全局状态机，而应该分对象分层设计。

### 6.1 内容层状态机

给：

- `document`
- `section`
- `evidence`

建议状态：

- `captured`
- `normalized`
- `linked`
- `archived`

### 6.2 认知层状态机

给：

- `entity`
- `memory_fact`
- `knowledge_fact`
- `relation`

建议状态：

- `inbox`
- `candidate`
- `curated`
- `deprecated`
- `archived`

### 6.3 审查状态机

给 review 流程：

- `unreviewed`
- `auto_accepted`
- `human_approved`
- `human_rejected`
- `conflict_pending`

### 6.4 为什么必须做

如果没有状态机，后面会出现：

- 候选和正式知识边界不清
- 冲突对象和过期对象混在一起
- 模型抽取结果和人工确认结果没有清楚区分
- Ops Console 无法稳定展示治理过程

## 7. 模型在系统中的位置

你已经明确：治理必须接模型。

这个判断是对的。

### 7.1 模型职责

模型应负责：

- 实体抽取
- 事实抽取
- 关系抽取
- 归一化候选
- 冲突解释
- 合并建议
- review 建议
- summary / snapshot 生成

### 7.2 规则职责

规则应负责：

- 基础准入
- contract 校验
- 明确禁止条件
- 指纹与作用域门控
- 生命周期调度

### 7.3 人类职责

人类应负责：

- 最终冲突裁决
- 高价值对象确认
- 规则修正
- 例外处理

### 7.4 结论

治理层必须是三方协同：

- 规则系统
- 模型系统
- 人类审查

不是单靠某一方。

## 8. 热插拔设计原则

我们这个系统需要热插拔，但热插拔不应理解成“整个系统一键全开/全关”。

更合理的是能力级热插拔：

### 8.1 读取热插拔

- 本次任务是否读取长期知识
- 本次任务是否只读 factual
- 是否允许 procedural
- 是否引用 resident / summary

### 8.2 写入热插拔

- 本次任务是否允许沉淀长期知识
- 是否只进 candidate
- 是否允许自动晋升正式知识

### 8.3 治理热插拔

- 是否启用规则治理
- 是否启用模型治理
- 是否启用人工审查队列

### 8.4 图谱热插拔

- 是否构建 graph 骨架
- 是否允许 graph 参与检索

### 8.5 装配热插拔

- 是否启用结构化 context assembly
- 是否只走当前 memory bundle

## 9. 检索系统的正确演进顺序

不能直接从当前 memory 跳到图搜索。

正确顺序应为：

1. 保留当前 `memory_retrieve_context` 作为基线
2. 增加 `entity / relation / evidence / section`
3. 让 governance 产出图谱骨架
4. 再把 graph expansion 接入 retrieval
5. 最后用 benchmark 比较收益

目标检索链路是：

- `entity/fact lookup`
- `graph expansion`
- `evidence grounding`
- `hybrid ranking`
- `context assembly`

## 10. 图谱与向量的定位

### 10.1 图谱定位

图谱是：

- 长期知识骨架
- 关系组织层
- 推理扩边层

图谱不是：

- 一开始就替代当前 memory 主链路

### 10.2 向量定位

HNSW / ANN 只做辅助召回：

- `section`
- `snippet`
- `fact`

向量不是知识本体，不负责：

- 真相判定
- 冲突裁决
- 最终上下文可信度判定

## 11. 当前最该做的 7 件事

1. 明确统一长期知识系统建立在当前 memory 模块上演进，不重写一套新系统。
2. 新增一等对象：`entity / relation / document / section / evidence / knowledge_fact`。
3. 把治理层升级成“规则 + 模型 + 人工审查”的正式体系。
4. 给对象补上状态机和时效语义，不再只靠模糊 lifecycle。
5. 把图谱先放进治理产物，再逐步进入检索，不先上实时图搜索。
6. 独立设计结构化 context assembly，彻底避免文本注入式 recall。
7. 建立 Knowledge Ops Console，让人类能看、能审、能追踪。

## 12. 建议实施顺序

### 第一步

定义第一版物理 schema：

- `entity`
- `relation`
- `document`
- `section`
- `evidence`
- 时效字段
- 状态字段

### 第二步

定义治理任务协议：

- 模型抽取输入输出
- review queue
- conflict job
- staleness job

### 第三步

扩 benchmark：

- `entity_lookup`
- `relation_expansion`
- `evidence_grounding`
- `multi-hop`

### 第四步

最后再做图搜索接入设计。

## 13. 最终结论

我们现在不是缺“记忆功能”，而是要把现有 memory 模块升级成一个：

- 有对象模型
- 有治理状态机
- 有模型治理
- 有证据回溯
- 有结构化装配
- 有人工审查

的统一长期知识系统。
