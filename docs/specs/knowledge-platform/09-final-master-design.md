# 统一长期知识系统总设计

## 1. 系统定位

本系统不是：

- 单独记忆模块
- 普通知识库
- 单纯向量库
- 笔记系统

本系统是一个统一的长期知识系统，用于把以下内容纳入同一工程体系：

- 历史对话
- Agent 任务运行事实
- 工作记忆中的高价值中间结论
- 用户画像
- 项目知识
- 规则约束
- 技能与流程经验
- 外部文档与证据

统一的含义是产品统一，不是对象混杂。工程上仍然必须分层、分对象、分生命周期治理。

## 2. 设计目标

核心目标：

- 建立在当前 `memory-service + memory-mcp` 基础上演进，不推倒重来
- 支持长期沉淀、治理、检索、审查、追踪和后续图谱增强
- 保证对 Agent 可用，同时对人类可见、可审、可控
- 避免把召回结果直接伪装成自然语言注入上下文
- 允许后续把召回逐步升级为知识图谱图搜索

非目标：

- 不做只靠向量召回的 RAG
- 不做只靠大模型黑盒维护的记忆系统
- 不做无边界的文档堆积系统
- 不在第一阶段把图谱直接接入在线写入主链路

## 3. 核心原则

### 3.1 产品统一，工程分层

对外是一个长期知识系统，对内必须分层，不允许把所有对象无差别塞进一个大 `memory` 表或一个大 prompt。

### 3.2 当前 memory 模块是 Phase 0 基础

当前已有能力包括：

- `memory_candidate`
- `memory`
- `skill`
- `conversation_summary`
- `resident_snapshot`
- `environment_fingerprint`
- `memory_access_log`
- `memory_retrieve_context`
- `memory_run_governance`

这些不是临时产物，而是统一长期知识系统的基础层。

### 3.3 图谱是骨架，文档和证据是载体

长期知识系统的知识本体不应是文档堆积，也不应是向量堆积，而应是：

- 图谱骨架
- 文档载体
- 证据回链

### 3.4 写入规则优先，模型主要用于治理

写入入口尽量规则化、确定化、结构化。

模型资源主要投入治理层，负责：

- 抽取
- 归并
- 冲突解释
- 时效判断建议
- 审查建议
- 摘要与快照生成

### 3.5 上下文装配必须独立

检索和装配必须分开。

系统不能把召回结果直接拼成自然语言假装上下文，而应输出结构化 context package。

### 3.6 能力级热插拔

系统需要支持按能力启停，而不是只有全开或全关。

至少应支持：

- 是否读取长期知识
- 是否写入候选记忆
- 是否运行治理
- 是否启用图谱增强
- 是否启用人工审查

### 3.7 人类审查不是附属功能

必须有独立的人类审查与运维层，用于：

- 看见系统沉淀了什么
- 审核候选对象
- 处理冲突与过期
- 查看某次回答到底用了哪些知识

## 4. 总体分层

建议系统拆成 6 层。

### 4.1 历史对话层

负责保存：

- 原始对话
- 原始消息
- 原始片段

用途：

- 回溯
- 抽取来源
- 证据来源

这一层不是正式长期记忆层。

### 4.2 Agent 任务运行层

负责保存：

- task request
- task plan
- task step
- tool call
- artifact
- verification result
- success / failure

用途：

- 运行事实来源
- 技能抽取来源
- 工程证据来源

### 4.3 工作记忆层

这是短期记忆能力层，更准确地说是：

- `working memory`
- `runtime memory`
- `task memory`

负责保存：

- 当前任务目标
- 当前步骤状态
- 临时结论
- 临时假设
- 已尝试路径
- 待验证项
- 当前上下文包

特点：

- 生命周期短
- 默认不沉淀
- 可覆盖、可丢弃
- 只在必要时提升为长期候选

### 4.4 抽取与候选层

负责把历史对话、运行事实和工作记忆中的高价值内容转成候选对象。

主要对象：

- candidate fact
- candidate rule
- candidate skill
- candidate entity
- candidate relation

这一层是长期沉淀前的缓冲层。

### 4.5 长期记忆层

这是正式沉淀层。

长期记忆不应只有一个宽泛的 `memory_type`，而应至少分域管理。

### 4.6 治理与审查层

负责：

- 准入
- 抽取
- 合并
- 冲突处理
- 时效治理
- 摘要重建
- 索引整理
- 审查与回退

图谱的建立、清洗、归并和冲突处理也归这一层。

## 5. 长期记忆分域

长期记忆层建议至少分成 4 个主域。

### 5.1 `profile_memory`

保存长期稳定的主体画像和环境偏好，例如：

- 用户偏好
- 工作习惯
- 语言偏好
- 常用目录
- 长期环境约束
- 当前主线项目

### 5.2 `knowledge_memory`

保存长期可复用的知识事实，例如：

- 项目知识
- 架构知识
- 设计决策
- 技术事实
- 外部资料结论
- 失败经验中的客观结论

### 5.3 `rule_memory`

保存系统后续执行必须遵守的规则，例如：

- 用户明确拒绝项
- 工程规范
- 安全边界
- 工作流约束
- 执行禁令

### 5.4 `skill_memory`

保存可复用的过程型经验，例如：

- 成功修复路径
- 操作流程
- 调试套路
- 带 fingerprint 的 procedural 经验

## 6. 对象维度设计

不建议只靠一个 `memory_type` 管所有对象。

建议至少同时保留三个维度：

- `memory_domain`
- `object_type`
- `lifecycle_state`

### 6.1 `memory_domain`

建议第一版取值：

- `profile`
- `knowledge`
- `rule`
- `skill`

### 6.2 `object_type`

建议第一版至少支持：

- `fact`
- `entity`
- `relation`
- `document`
- `section`
- `evidence`
- `procedure`

### 6.3 `lifecycle_state`

建议第一版至少支持：

- `inbox`
- `candidate`
- `curated`
- `deprecated`
- `archived`

## 7. 当前 memory 的承接关系

当前系统中的对象可映射为：

- `memory_candidate` -> 候选层主对象
- `memory` -> 当前长期事实层基础对象
- `skill` -> 当前 `skill_memory` 基础对象
- `conversation_summary` -> 历史压缩视图
- `resident_snapshot` -> 常驻上下文压缩视图
- `memory_access_log` -> 使用追踪基础对象
- `environment_fingerprint` -> 环境约束与 procedural gate 基础对象

因此，新系统不是替换旧系统，而是在旧系统上增加：

- `entity`
- `relation`
- `document`
- `section`
- `evidence`
- 更正式的治理和审查机制

## 8. 状态机设计

状态机是必要设计，但不应做成一套全局巨型状态机。

建议拆成 3 套。

### 8.1 内容层状态机

适用于：

- `document`
- `section`
- `evidence`

建议状态：

- `captured`
- `normalized`
- `linked`
- `archived`

### 8.2 认知对象状态机

适用于：

- `memory_fact`
- `knowledge_fact`
- `entity`
- `relation`

建议状态：

- `inbox`
- `candidate`
- `curated`
- `deprecated`
- `archived`

### 8.3 审查状态机

适用于需要治理判定或人工介入的对象。

建议状态：

- `unreviewed`
- `auto_accepted`
- `human_approved`
- `human_rejected`
- `conflict_pending`

## 9. 时效与有效期设计

当前系统并非完全没有时效治理，但现状主要是 lifecycle 治理，不是完整对象级时效模型。

后续应补成“两层机制”。

### 9.1 对象字段层

建议补充字段：

- `valid_from`
- `valid_to`
- `last_verified_at`
- `review_at`
- `staleness_score`

### 9.2 治理动作层

治理负责执行：

- 降权
- 标记 `deprecated`
- 进入复核队列
- 建立 `supersedes`
- 归档

### 9.3 两类时效要区分

需要区分：

- `profile_memory` 的时效
- `knowledge_memory` 的时效

不能用同一套规则统一处理所有对象。

## 10. 写入与治理边界

### 10.1 写入入口

写入入口应尽量规则优先，而不是模型优先。

适合入口处理的内容：

- 显式“记住这个”
- 明确用户偏好
- 明确规则项
- 结构化成功/失败结果
- 显式技能沉淀

入口主要依赖：

- 正则
- 关键词
- 显式命令
- 固定 schema
- 路由规则

### 10.2 候选层

入口写入默认进入 candidate/inbox，而不是直接进入正式长期记忆。

这一层负责：

- 基础归类
- 去重键生成
- 来源绑定
- domain/type 初判

### 10.3 治理层

正式长期知识的形成主要发生在治理层。

治理层负责：

- entity 抽取
- fact 抽取
- relation 抽取
- 语义归并
- 冲突解释
- merge 建议
- 时效建议
- 审查建议
- summary / snapshot 重建

## 11. 模型在治理中的角色

治理层必须接模型，但模型不拥有唯一裁决权。

治理应由三类能力共同组成：

- 规则系统
- 模型系统
- 人类审查

模型的职责：

- 抽取
- 归一化
- 归并建议
- 冲突说明
- 时效判断建议
- 摘要生成

规则的职责：

- 准入约束
- 格式校验
- 低风险状态迁移
- 低成本过滤和预筛

人工的职责：

- 高风险对象确认
- 高价值冲突裁决
- 治理质量监督

## 12. 图谱在系统中的位置

图谱应被定义为治理产物与知识骨架，而不是第一阶段的写入主链路。

当前阶段边界：

- 不在写入入口直接建图
- 不要求当前检索依赖图谱
- 图谱整理、归并、冲突处理归治理层

后续演进：

1. 先通过治理产出图谱骨架
2. 再让图谱参与检索增强
3. 最后再评估是否默认使用图搜索

## 13. 检索与上下文装配

目标检索链路：

1. `entity / fact lookup`
2. `graph expansion`
3. `evidence grounding`
4. `hybrid ranking`
5. `context assembly`

### 13.1 当前阶段

当前基线继续使用 `memory_retrieve_context`。

### 13.2 后续阶段

在引入 `entity / relation / evidence / section` 后，逐步增加：

- 图谱扩展
- 证据回链
- 混合排序
- 结构化装配

### 13.3 上下文装配输出

装配层不输出一段伪自然语言，而应输出结构化 context package，例如：

- `facts`
- `entities`
- `relations`
- `evidence_refs`
- `section_refs`
- `warnings`
- `assembly_trace`

## 14. Knowledge Ops Console

必须有独立的人类侧运维与审查界面，至少支持：

- 最近 ingest 了什么
- 抽出了哪些实体、事实、关系
- 哪些对象待确认
- 哪些对象冲突或过期
- 某次回答使用了哪些知识
- 治理任务最近跑了什么

## 15. 热插拔设计

系统应支持能力级热插拔。

建议最少支持以下开关：

- 是否读取长期知识
- 是否写入候选记忆
- 是否运行治理
- 是否启用图谱增强
- 是否启用人工审查流程

这类开关应是策略配置，而不是散落在业务代码中的临时判断。

## 16. 基线评测与图搜索评测

图搜索接入前必须先有基线。

当前已建立的 baseline 方向是正确的：

- 使用当前 `memory_retrieve_context`
- 建标准化 benchmark case
- 记录召回质量与延迟

重点指标至少包括：

- `Hit@1`
- `Hit@3`
- `Hit@5`
- `MRR`
- `P50 latency`
- `P95 latency`

图谱接入后必须跑同题 AB 对比：

- 当前 memory retrieval
- memory + graph retrieval

关注：

- 召回提升多少
- 排序提升多少
- 延迟增加多少
- 哪类问题提升最明显
- 是否引入新的误召回

## 17. 第一阶段实施边界

第一阶段建议明确做这些，不再继续发散：

1. 保留当前 `memory-service + memory-mcp` 为基础
2. 明确 6 层架构
3. 明确长期记忆 4 大域
4. 增加 `memory_domain / object_type / lifecycle_state` 设计
5. 建立对象状态机与时效字段
6. 把图谱放入治理层
7. 把模型主要集中到治理层
8. 保留当前检索作为 baseline
9. 保证后续图搜索必须基于基线评测推进

## 18. 后续设计任务

在这份总设计基础上，下一步应继续落 4 类实现级设计：

1. 第一版物理 schema
   - `entity`
   - `relation`
   - `document`
   - `section`
   - `evidence`
   - 时效字段
   - 状态字段

2. 治理任务协议
   - 模型抽取任务
   - 冲突任务
   - 时效任务
   - review queue

3. 检索与装配协议
   - graph expansion
   - evidence grounding
   - assembly contract

4. Ops Console 页面和运维动作
   - inbox
   - conflicts
   - staleness
   - trace
   - governance runs

## 19. 总结

这套系统的本质，不是把 memory 做大，也不是把知识库、图谱、向量和文档硬拼起来。

它的本质是：

- 以当前 memory 模块为基础层
- 以长期知识系统为产品形态
- 以治理为核心秩序
- 以图谱为知识骨架
- 以证据和文档为承载
- 以结构化上下文装配为 Agent 使用入口
- 以人类审查与运维为最终兜底

当前阶段的正确策略不是直接追求图搜索上线，而是先把：

- 分层
- 对象模型
- 状态机
- 时效
- 治理
- 基线评测

这几件事定稳。
