# 统一长期知识系统子设计 04：Knowledge Ops Console 页面结构

## 1. 设计目标

Knowledge Ops Console 是统一长期知识系统的人类审查与运维层，不是附属组件。

它必须回答 5 个问题：

- 最近 ingest 了什么
- 抽出了什么实体、事实、关系
- 哪些对象待确认、冲突或过期
- 某次 Agent 回答到底用了哪些知识
- 哪些知识正在被频繁使用或反复纠正

## 1.1 与当前 Memory 模块的关系

当前 memory 模块已经有可复用数据来源：

- `memory_candidate`
- `conversation_summary`
- `resident_snapshot`
- `memory_access_log`
- governance 返回结果

第一版 Ops Console 不应等待完整图谱落地后才开始做，可以先直接消费当前模块产物：

- Inbox：先看 `memory_candidate`
- Usage：先看 `memory_access_log`
- Governance：先看当前 run 输出

图谱、证据和关系视图在后续阶段逐步补齐。

## 2. 页面结构

第一版建议 6 个主视图。

### 2.1 Inbox

目标：

- 查看新捕获内容
- 处理待整理候选
- 快速确认或驳回

核心列表：

- 新 evidence
- 新 document
- 新 candidate fact
- 新 candidate relation

关键操作：

- `approve`
- `reject`
- `merge`
- `escalate_to_review`
- `mark_as_noise`

### 2.2 Graph

目标：

- 查看实体、事实、关系的连接结构
- 快速理解知识骨架

核心能力：

- 以 entity 为中心查看一跳/两跳关系
- 过滤 relation type
- 查看 conflict 边
- 查看 supersedes 链

### 2.3 Evidence

目标：

- 查看知识背后的原始证据
- 检查 grounding 是否可靠

核心能力：

- evidence 原文/摘录
- section 定位
- document 来源
- trust level
- capture metadata

### 2.4 Conflicts & Staleness

目标：

- 集中处理冲突和过期问题

核心列表：

- 冲突事实对
- 冲突关系对
- 疑似重复实体
- 过期 section
- 过期 knowledge fact

关键操作：

- `keep_both`
- `supersede_old`
- `downgrade`
- `archive`
- `request_human_review`

### 2.5 Usage & Trace

目标：

- 回答“这次 Agent 为什么会这么答”

核心能力：

- 某次检索的命中对象
- 扩边路径
- 最终装配对象
- 被实际消费的 fact / evidence
- 被用户纠正或驳回的结果

### 2.6 Governance Runs

目标：

- 查看整理与治理任务是否正常运行

核心字段：

- run id
- run type
- trigger source
- duration
- changed objects
- conflict count
- deprecated count
- errors

## 3. 页面间导航关系

推荐主导航：

- Inbox
- Graph
- Evidence
- Conflicts
- Usage
- Governance

对象详情页应支持相互跳转：

- `fact -> evidence`
- `fact -> entity`
- `entity -> relation`
- `relation -> evidence`
- `usage_trace -> assembled facts`

## 4. 关键对象详情页

### 4.1 Entity Detail

显示：

- 主名与别名
- 类型
- 摘要
- 相关 facts
- 相关 relations
- 相关 sections

### 4.2 Fact Detail

显示：

- statement
- fact kind
- confidence
- review state
- evidence chain
- related entity
- conflicts
- supersedes links
- recent usage

### 4.3 Evidence Detail

显示：

- 原始来源
- 原文摘录
- 捕获时间
- trust level
- 派生出的事实和关系

## 5. 关键运维指标

首页建议展示：

- inbox count
- conflict count
- stale object count
- curated fact count
- active entity count
- last 24h ingest count
- last 24h retrieval count
- top used facts
- top corrected facts

## 6. 权限与角色

第一版建议至少区分：

- `reviewer`
- `operator`
- `admin`

说明：

- `reviewer`：处理候选与冲突
- `operator`：查看运行状态与追踪
- `admin`：调整规则、执行治理操作

## 7. 与 Obsidian 的关系

Obsidian 可以作为可选内容适配前端，但不是默认依赖。

建议定位：

- 内容浏览器
- 手工笔记入口
- 人类友好的外部视图

不建议定位：

- 唯一审查控制台
- 唯一图谱维护入口
- 唯一系统真相源
