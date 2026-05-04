# 长期记忆分层设计

## 1. 设计目标

本设计用于明确统一长期知识系统中的“记忆”部分到底如何分层、分类和流转。

核心目标不是再做一个泛化的 `memory_type` 字段，而是建立一套可长期演进的记忆分层模型，使系统能稳定区分：

- 原始对话
- Agent 运行事实
- 可抽取候选
- 正式长期记忆
- 治理与审查

并在长期记忆内部继续区分：

- 用户画像类长期记忆
- 知识事实类长期记忆
- 规则约束类长期记忆
- 过程技能类长期记忆

## 2. 总体结论

### 2.1 不建议只靠一个 `memory_type`

如果只用一个一维 `memory_type` 承载所有长期对象，后面会出现这些问题：

- 用户偏好和项目知识混在一起
- 规则和客观知识混在一起
- 技能流程和事实结论混在一起
- 证据、文档、事实边界不清

因此，不应只做“单字段分类”。

### 2.2 建议采用三维表达

至少应同时区分：

1. `system_layer`
2. `memory_domain`
3. `object_type`

必要时再补：

- `lifecycle_state`
- `review_state`
- `validity fields`

## 3. 系统分层

建议统一长期知识系统中的记忆相关部分拆成 5 层。

### 3.1 历史对话层

用于保存原始对话和原始消息片段。

这一层的职责不是直接当长期记忆，而是：

- 保存原始上下文
- 提供回溯依据
- 作为记忆抽取的语料来源
- 作为证据来源之一

典型对象：

- conversation
- message
- message fragment
- local thread summary input

这一层的特点：

- 原始
- 高噪声
- 不能直接等同于正式知识

### 3.2 Agent 任务运行层

用于保存系统“做过什么”的运行事实。

这一层承载：

- task request
- task plan
- task step
- tool call
- dispatch
- artifact
- success / failure
- verification result

这一层的职责：

- 记录真实执行轨迹
- 提供成功/失败经验来源
- 提供运行证据
- 为 skill 抽取与规则沉淀提供基础

这一层的特点：

- 比历史对话更结构化
- 是工程级高价值证据来源
- 与长期记忆不同，但强相关

### 3.3 抽取与沉淀层

用于把历史对话层和运行层中的高价值信息转成候选对象。

这一层负责：

- 抽取 candidate fact
- 抽取 candidate rule
- 抽取 candidate skill
- 抽取 entity / relation
- 初步归一化
- 初步打标签

这一层产物不是正式长期记忆，而是：

- inbox
- candidate

这一层是“长期记忆形成前的缓冲层”。

### 3.4 长期记忆层

这是正式沉淀层，用于保存系统认可的长期对象。

这里不是单一对象池，而是内部继续分类。

长期记忆层应至少包含 4 个主类：

- `profile_memory`
- `knowledge_memory`
- `rule_memory`
- `skill_memory`

### 3.5 治理与审查层

这一层负责：

- 准入
- 审查
- 冲突治理
- 时效治理
- 合并
- 降级
- 归档

治理层不产生业务知识本体，但决定哪些候选能进入长期层、哪些长期对象仍然有效。

## 4. 长期记忆层内部分类

长期记忆层建议至少分成 4 大类。

### 4.1 Profile Memory

即用户画像类长期记忆。

它表达的是：

- 这个用户/团队/环境长期是什么样

典型内容：

- 用户偏好
- 表达语言偏好
- 目录偏好
- 工作方式偏好
- 长期环境约束
- 当前长期主线项目

典型例子：

- 默认工作区根目录为 `D:\workspace`
- 默认希望设计先行，不先做 MVP
- 默认编码与文本统一使用 UTF-8

特点：

- 主体性强
- 持续时间较长
- 时效可能变化
- 需要可更新、可废弃

### 4.2 Knowledge Memory

即知识事实类长期记忆。

它表达的是：

- 系统当前认可的长期知识结论

典型内容：

- 项目结构知识
- 架构知识
- 外部资料结论
- 技术事实
- 设计决策
- 失败经验

典型例子：

- 当前 Memory MCP retrieval 必须显式传 `fingerprint_status`
- 图谱应先作为治理产物，而不是先进入在线写入主链路
- 当前统一长期知识系统建立在现有 memory 模块上演进

特点：

- 更偏客观
- 更强调证据支持
- 更适合复用和引用

### 4.3 Rule Memory

即规则约束类长期记忆。

它表达的是：

- 以后执行时必须遵守什么

典型内容：

- 用户明确拒绝项
- 工程规范
- 安全边界
- 工作流规则
- 触发规则
- 审查规则

典型例子：

- 不允许默认按 MVP 方式收缩任务
- 共享仓库路径不要写死具体机器路径
- recall 结果不能伪装成普通 prompt 文本注入

特点：

- 不等于客观知识
- 不等于用户画像
- 是执行层的重要约束来源

### 4.4 Skill Memory

即过程技能类长期记忆。

它表达的是：

- 某类任务应该怎么做
- 哪条成功路径可复用

典型内容：

- 修复流程
- 操作流程
- 工具使用路径
- 过程型经验
- 带 fingerprint 的 procedural memory

典型例子：

- 某个环境下的稳定修复路径
- 某个 MCP 接入的正确执行顺序
- support triage 的 verified skill

特点：

- 过程导向
- 与 `fact` 不同
- 常常与 fingerprint / environment 强绑定

## 5. 为什么这 4 类必须分开

### 5.1 Profile 与 Knowledge 不能混

因为：

- 一个是“对谁/环境长期成立”
- 一个是“系统当前认可的知识结论”

### 5.2 Rule 与 Knowledge 不能混

因为：

- 一个回答“是什么”
- 一个回答“必须怎么做”

### 5.3 Skill 与 Fact 不能混

因为：

- 一个是过程
- 一个是结论

### 5.4 结论

这 4 类不是可选美化，而是长期系统最小必要拆分。

## 6. 仅靠 `memory_domain` 还不够

长期记忆层除了 `memory_domain`，还必须补 `object_type`。

建议结构：

- `memory_domain`
  - `profile`
  - `knowledge`
  - `rule`
  - `skill`

- `object_type`
  - `fact`
  - `entity`
  - `relation`
  - `document`
  - `section`
  - `evidence`
  - `procedure`

也就是说：

- `knowledge_memory` 不是只有 fact
- `rule_memory` 也可能需要 evidence 支撑
- `skill_memory` 本体可能是 procedure，但也可能关联 fact / evidence

## 7. 建议对象表达方式

推荐最少字段：

- `id`
- `system_layer`
- `memory_domain`
- `object_type`
- `title`
- `content`
- `source_ref`
- `status`
- `confidence`
- `review_state`
- `valid_from`
- `valid_to`
- `last_verified_at`
- `metadata`

## 8. 生命周期与状态机

长期记忆层必须有独立状态机。

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

### 8.2 认知层状态机

适用于：

- `entity`
- `profile_memory`
- `knowledge_memory`
- `rule_memory`
- `skill_memory`
- `relation`

建议状态：

- `inbox`
- `candidate`
- `curated`
- `deprecated`
- `archived`

### 8.3 审查状态机

适用于治理流程：

- `unreviewed`
- `auto_accepted`
- `human_approved`
- `human_rejected`
- `conflict_pending`

## 9. 时效设计

### 9.1 当前现状

当前 memory 模块已有 lifecycle 治理，但还没有完整对象级时效语义模型。

现在已有的时效/生命周期特征包括：

- summary 被替代
- resident snapshot 被重建
- skill 因 fingerprint drift 被降级
- stale index 被清理

### 9.2 未来必须补的对象字段

建议长期对象补：

- `valid_from`
- `valid_to`
- `review_at`
- `last_verified_at`
- `staleness_score`

### 9.3 不同记忆类的时效差异

#### Profile Memory

要关注：

- 用户偏好是否还成立
- 默认目录、默认语言、工作流偏好是否变化
- 当前主线项目是否切换

#### Knowledge Memory

要关注：

- 技术资料是否过时
- 项目结构结论是否被新实现推翻
- 外部行为是否变化

#### Rule Memory

要关注：

- 规则是否仍为最新表达
- 是否被新规则 supersede

#### Skill Memory

要关注：

- 是否受 fingerprint / environment 变化影响
- 是否仍可复现

### 9.4 结论

时效不应只存在于模糊 governance 逻辑中，而应是：

- 对象字段层
- 治理执行层

双层协同。

## 10. 模型在治理中的位置

治理必须接模型。

### 10.1 模型职责

- 实体抽取
- 事实抽取
- 关系抽取
- 候选归一化
- 合并建议
- 冲突解释
- review 建议
- summary / snapshot 生成

### 10.2 规则职责

- 基础准入
- contract 校验
- 明确禁止条件
- fingerprint / scope gate
- 生命周期调度

### 10.3 人类职责

- 最终冲突裁决
- 高价值对象确认
- 规则修正
- 例外处理

### 10.4 结论

治理层不是：

- 纯规则
- 纯模型
- 纯人工

而是三方协同。

## 11. 热插拔设计

该系统应支持能力级热插拔，而不是只有全开/全关。

### 11.1 读取热插拔

- 是否读取长期记忆
- 是否只读 factual
- 是否允许 procedural
- 是否启用 resident / summary

### 11.2 写入热插拔

- 是否允许沉淀长期记忆
- 是否只进入 candidate
- 是否允许自动晋升

### 11.3 治理热插拔

- 是否启用规则治理
- 是否启用模型治理
- 是否启用人工审查

### 11.4 图谱热插拔

- 是否构建 graph
- 是否允许 graph 参与 retrieval

### 11.5 装配热插拔

- 是否启用结构化 context assembly
- 是否只走当前 memory bundle

## 12. 与当前 Memory 模块的承接关系

未来统一长期知识系统应建立在当前 memory 模块之上。

### 12.1 当前模块承接为 Phase 0

保留：

- `memory_candidate`
- `memory`
- `skill`
- `conversation_summary`
- `resident_snapshot`
- `environment_fingerprint`
- `memory_access_log`
- `memory_retrieve_context`
- `memory_run_governance`

### 12.2 后续新增

- `entity`
- `relation`
- `document`
- `section`
- `evidence`
- `knowledge ops console`
- `structured context assembly`

### 12.3 结论

不是重做一个新 memory，而是让当前 memory 模块成为长期知识系统底座。

## 13. 统一设计结论

我们最终要做的不是“再加一些记忆条目类型”，而是把现有 memory 模块升级成一个：

- 有系统分层
- 有长期记忆分类
- 有对象类型维度
- 有生命周期状态机
- 有时效治理
- 有模型治理
- 有图谱骨架
- 有结构化装配
- 有人类审查

的统一长期知识系统。

## 14. 建议后续设计顺序

1. 先定义第一版物理 schema
- `entity`
- `relation`
- `document`
- `section`
- `evidence`
- `memory_domain`
- `object_type`
- `status`
- `validity fields`

2. 再定义治理任务协议
- 模型抽取输入输出
- review queue
- conflict job
- staleness job

3. 再定义统一检索与装配协议

4. 最后再推进图搜索和 Ops Console
