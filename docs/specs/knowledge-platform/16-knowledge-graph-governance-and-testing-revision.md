# 知识图谱治理与测试修订设计

对应项目级 SPEC：
- `D:\workspace\projects\SuperAgentSystem-main\SPEC-SuperAgentSystem-knowledge-platform.md`

如果后续实现思路与用户表达不一致，必须先补充 interview、更新 SPEC，再继续设计或实现。

## 1. 当前定位

本系统不是普通笔记库、不是单独向量库，也不是只存 agent memory 的模块，而是统一长期知识系统。

当前长期知识系统包含：
- 历史对话层
- agent 任务运行层
- skill 抽取层
- 长期记忆层
- 知识库层
- 治理层
- Ops Console 审查层

其中长期记忆可继续细分为：
- 用户画像类记忆
- 知识类记忆
- 规则类记忆
- skill/经验类记忆

## 2. 已确认原则

知识和记忆可以统一在一个长期知识系统里，但不应该无差别混在一起。产品统一，工程分层。

Markdown 是系统标准原文层。外部 HTML、PDF、网页和仓库 README 只是来源，不作为后续常规读取对象。数据库必须保存完整 Markdown 正文，同时保存落盘 Markdown 路径、hash、converter 和 source URI。

主题相关性不作为硬门禁。遇到新知识时先记录 `expected_signals`、`relevance_matched_signals` 和 `governance_flags`，交给治理层后置处理。只有正文过短、乱码、导航噪声等明确不可用内容才隔离。

当前关系图只代表显式证据内部关系，不等于最终知识图谱。真正的知识图谱治理目标是跨来源比较不同知识、记忆、规则、skill 和任务经验，判断是否存在可证明关系。

## 3. 当前实现状态

已完成：
- Markdown-first 入库。
- 数据库保存完整 Markdown 正文和 `markdown_content_ref`。
- Ops Console 可查看文档详情和完整 Markdown。
- 向量召回默认关闭。
- 每篇文档生成 section、evidence、fact、relation。
- 基础显式关系包括 `document -> has_section -> section`、`section -> states -> fact`、`section -> mentions -> entity`、`fact -> derived_from -> section`、`fact -> evidenced_by -> evidence`。
- 低质文档隔离脚本会级联停用相关 section、evidence、fact、relation。
- 新增主题相关性标记，不再把主题错配作为硬拒绝。

本轮 200 个 AI 方向候选资料测试结果：
- 候选总数：200
- Markdown 物化成功：106
- 物化失败：94
- 入库验证成功：106
- Console 当前可见文档：161
- 当前 active section：2548
- 当前 active fact：2547
- 当前 active evidence：2551
- 当前 active relation：14475
- 主题相关性待治理标记：5
- 历史隔离文档：8

失败主要类型：
- 403 或 fetch failed。
- 正文过短。
- PDF/网页转 Markdown 后出现乱码。
- 只有摘要或页面骨架，实质正文不足。

## 4. 三层披露设计

系统采用渐进式披露：

```text
L0: summary / overview / candidate signal
L1: semantic chunk / fact / evidence excerpt
L2: full Markdown source
```

原则：
- 默认先看 L0。
- 需要判断时展开 L1。
- 需要审查、引用或最终确认时落到 L2 完整 Markdown。
- L2 不回到原始 HTML/PDF，除非需要重新采集或人工核对来源。

## 5. 治理层目标

治理层需要主动处理：
- 主题错配。
- 重复文档。
- 低质量资料。
- 过时资料。
- 冲突事实。
- 跨来源关系。
- 用户规则对 skill/agent 行为的约束。
- 任务成功/失败经验对后续设计的支持或修正。

跨来源关系示例：
- `OpenViking` 与 `LLM Wiki` 是否共享渐进式披露原则。
- `Harness Engineering` 与某个 agent benchmark 是否都服务于 agent reliability。
- 外部 RAG 论文是否支持、修正或反驳当前 retrieval 设计。
- 用户规则是否约束某个 skill 或 agent 行为。

没有明确证据时不强行建边。

## 6. 第一版关系类型

第一版建议支持：
- `same_as`
- `alias_of`
- `similar_to`
- `shares_principle_with`
- `supports`
- `contradicts`
- `refines`
- `supersedes`
- `complements`
- `applies_to`
- `evaluates`
- `constrains`
- `derived_from`
- `evidenced_by`
- `related_to`

其中 `contradicts`、`supersedes`、`constrains`、涉及规则记忆或用户画像核心偏好的关系必须进入人工审查。

## 7. 下一步

下一阶段不继续做普通向量召回，先做治理层：
- 建立 governance job / review queue 的可见页面。
- 把 `governance_flags` 展示到 Console。
- 支持按主题错配、低质、冲突、候选跨源关系过滤。
- 实现第一版跨来源关系治理任务。
- 让治理输出关系 reason、evidence path、confidence 和 review_state。
- 再基于治理后的关系图设计图谱召回和测试集。
