# 治理层实施规格

对应项目级 SPEC：

- `D:\workspace\projects\SuperAgentSystem-main\SPEC-SuperAgentSystem-knowledge-platform.md`
- `D:\workspace\projects\SuperAgentSystem-main\docs\specs\knowledge-platform\16-knowledge-graph-governance-and-testing-revision.md`

## 1. 定位

治理层不是“给文档补关系”的附属模块，也不是“把知识库越堆越大”的批处理脚本。治理层负责把长期记忆、知识文档、事实、实体、规则、skill、任务经验和外部资料持续整理成更可信、更干净、更可召回的长期知识系统。

核心目标：

- 清理无关、低质、过时和重复内容。
- 归并同义、近重复和版本替代对象。
- 在不同来源之间建立可证据化关系。
- 生成更高阶的综合知识对象。
- 让治理后的有效知识直接进入正常召回和上下文装配。

## 2. 设计原则

- 治理必须手动触发，不做自动定时治理，避免无谓 token 消耗。
- 治理以模型为主，规则为前置筛分和显著问题处理。
- 高风险使用“关系类型 + 置信度 + 影响范围”共同判断。
- 模型可以裁决低风险和中风险项；高风险或模型不确定项进入人工复核。
- 正式知识层只保留 canonical Markdown，不把原始 HTML/PDF 作为常驻知识对象。
- 被治理掉的旧知识先逻辑归档，不进召回，但保留审计记录；后续稳定后再评估物理删除策略。
- 治理完成后的已确认结果直接影响正常召回面。

## 3. 治理对象

V1 将知识对象、memory 对象和 skill 经验纳入同一套治理流程，但不能混成同一种最终产物。治理层负责判断出口，只有真正的知识结论进入 `synthesized_knowledge` / `derived_knowledge`。

- `document`
- `section`
- `fact`
- `entity`
- `relation`
- `memory_object`
- `synthesized_knowledge`

对象边界：

- `document` / `canonical markdown`：原始资料标准化后的证据载体，不是最终知识。
- `section`：原文定位和审查单位，不是知识语义单位；不要按 section 建知识。
- `fact`：从原文 evidence 中抽取出的原子知识，必须可验证、可追溯，默认用于治理和溯源，不直接作为默认召回产物。
- `entity` / `relation_candidate`：用于识别同实体、同 claim、支持、冲突、修正、替代等治理关系；弱关联不能硬连。
- `synthesized_knowledge` / `derived_knowledge`：治理后形成的事实、概念、原则、关系、边界、冲突摘要或替代结论，才允许进入默认召回面。

`memory_object` 至少覆盖：

- `profile_memory`
- `knowledge_memory`
- `rule_memory`
- `skill_memory`
- `task_experience_memory`

## 3.1 治理出口分流

治理不是把所有高阶总结都写成知识。每次治理必须先判断输出类型：

- `derived_knowledge`：事实、概念、设计原则、关系、边界、冲突、版本替代和综合结论。
- `skill_candidate`：可复用执行流程、排错步骤、编码规范、工具操作方法、测试/验证流程。
- `memory_candidate`：用户偏好、项目长期约束、机器环境事实、稳定决策。
- `audit_only`：弱关联、不确定、证据不足、低置信、需要人工或模型复核的候选。
- `archive`：低质、无关、过时、重复、被替代或无治理价值的内容。

分流规则：

- 能回答“是什么、为什么、边界是什么、和其他知识是什么关系”的，进入 `derived_knowledge`。
- 能回答“以后遇到这类任务怎么做”的，进入 `skill_candidate`。
- 能回答“这个用户、项目、机器长期是什么情况”的，进入 `memory_candidate`。
- 关联性不足时允许孤岛，不能为了图谱完整性硬建立关系。
- 明确会支持、修正、冲突、替代、扩展已有结论时，不允许漏连，必须进入治理动作。

## 4. 新增综合知识对象

需要新增 `synthesized_knowledge`，用于表达治理后形成的稳定综合结论，而不是只靠 relation 串联原始对象。

建议类型：

- `consolidated_fact`：多个来源归并后的稳定事实，仅用于去重和压缩，价值较低。
- `derived_relation`：从多个来源归纳出的跨对象关系。
- `cross_source_pattern`：多篇资料或多条经验反复出现的模式。
- `design_principle`：可指导设计决策的更高层原则。
- `derived_rule`：可应用到新场景的判断规则。
- `boundary_condition`：规则、模式或原则的适用条件、反例和不适用边界。
- `application_result`：把抽象规则应用到当前项目或当前问题后的结论。
- `memory_revision`：对旧记忆的取代、修正或补充。
- `conflict_summary`：对冲突证据的结构化摘要。

每个综合知识对象必须包含：

- `title`
- `knowledge_type`
- `content`
- `source_object_ids`
- `evidence_ids`
- `reasoning_summary`
- `confidence`
- `risk_level`
- `governance_job_id`
- `lifecycle_state`
- `review_state`

## 5. 数据合成

数据合成可以纳入治理层，但不能变成无证据生成。它的用途是把多个已验证对象压缩、归并、改写成更可用的知识，而不是凭空扩写。

核心定位：

- `document`、`section`、`canonical markdown` 是证据载体，不是最终长期知识产物；其中 `section` 只做原文定位和审查，不参与知识本体建模。
- `fact` 是 evidence-backed atomic fact，默认用于溯源、审计和治理，不作为默认召回内容。
- `synthesized_knowledge` / `derived_knowledge` 才是默认长期召回产物。
- 默认召回应优先匹配 `derived_rule`、`design_principle`、`cross_source_pattern`、`boundary_condition`、`application_result`。
- 只有当用户要求追溯、模型不确定、规则冲突或需要审计时，才展开对应 facts、sections 和 source markdown path。

允许的数据合成：

- 从多篇资料中合成一个 `design_principle`。
- 从多个事实中合成一个 `consolidated_fact`。
- 从多个事实和关系中归纳一个 `cross_source_pattern`。
- 从多个模式中归纳一个 `derived_rule`。
- 为规则补充 `boundary_condition`。
- 将规则应用到当前项目形成 `application_result`。
- 从旧记忆和新证据中合成一个 `memory_revision`。
- 从冲突材料中合成一个 `conflict_summary`。
- 为中文审查生成中文摘要，但保留英文原文 evidence。

禁止的数据合成：

- 没有 evidence 的知识扩写。
- 用翻译文本替代原文证据。
- 把模型推测写成事实。
- 把低置信关系直接合成为高置信知识。
- 用合成内容覆盖审计链路。
- 把典型执行经验、排错步骤、操作流程写成 `derived_knowledge`；这类内容应进入 `skill_candidate`。
- 把用户偏好、项目路径、机器环境、长期约束写成 `derived_knowledge`；这类内容应进入 `memory_candidate`。

## 6. 分层治理流程

治理不是单次平铺处理，而是分层手动执行：

```text
manual governance trigger
-> scope selection
-> source_cleaning_governance
-> object_quality_governance
-> dedup_merge_governance
-> staleness_supersession_governance
-> cross_source_synthesis_governance
-> governance_output_routing
-> recall_surface_governance
-> report / review queue / audit log
```

### 6.1 source_cleaning_governance

处理 canonical Markdown 的正文净化。

负责：

- 删除导航、页脚、广告、目录污染、无意义推荐内容。
- 删除明显不属于知识范畴的段落。
- 删除网页抓取残留和重复 boilerplate。
- 保留标题、摘要、正文、关键列表、代码片段、表格、引用和必要链接。
- 为删除动作记录 cleaning reason。

输出：

- 更新后的 canonical Markdown。
- `cleaning_log`
- `removed_sections_summary`
- `markdown_hash`

### 6.2 object_quality_governance

处理对象质量。

负责：

- 正文过短。
- 乱码。
- 证据缺失。
- Markdown 缺失。
- 摘要与正文不一致。
- 事实缺少来源。
- 机器翻译质量可疑。

输出：

- `quality_gate`
- `governance_flags`
- `quarantined` / `curated` / `archived`

### 6.3 dedup_merge_governance

处理重复和归并。

负责：

- 文档 hash 重复。
- 同一 URL 不同版本。
- 事实近重复。
- 实体别名。
- 记忆重复。
- skill / rule 重复或冲突。

输出：

- `same_as`
- `alias_of`
- `merged_into`
- `supersedes`
- `archived`

### 6.4 staleness_supersession_governance

处理过时知识和旧记忆。

负责：

- 新资料取代旧资料。
- 新规则取代旧规则。
- 新任务经验修正旧经验。
- 用户偏好发生更新。
- API、模型、框架、版本信息过时。

输出：

- `supersedes`
- `superseded_by`
- `memory_revision`
- 旧对象逻辑归档并退出召回。

### 6.5 cross_source_synthesis_governance

处理跨来源关系和综合知识。

负责：

- 判断不同来源是否支持、冲突、细化、继承、约束或表达相同原则。
- 从多来源中生成综合知识对象。
- 为关系和综合知识绑定 evidence。

关系类型建议：

- `supports`
- `refines`
- `contradicts`
- `supersedes`
- `constrains`
- `shares_principle_with`
- `derived_from`
- `evidenced_by`
- `merged_into`

输出：

- `relation`
- `relation_proposal`
- `synthesized_knowledge`
- `conflict_summary`

### 6.6 governance_output_routing

处理治理结果的出口分流。

负责：

- 判断治理结果是 `derived_knowledge`、`skill_candidate`、`memory_candidate`、`audit_only` 还是 `archive`。
- 只允许 `derived_knowledge` 写入 `synthesized_knowledge` 并参与默认知识召回。
- 将 `skill_candidate` 保留为 skill 草案/skill 更新建议，不写入知识召回面。
- 将 `memory_candidate` 转交 Memory 写入流程或 memory 审查队列，不写入知识召回面。
- 将弱关联、不确定关系和低置信结果保持 `audit_only`，允许孤岛存在。
- 将低质、过时、重复或被替代内容归档。

输出：

- `governance_output_type`
- `skill_candidate`
- `memory_candidate`
- `audit_only`
- `archive`
- `routing_decision`

### 6.7 recall_surface_governance

处理治理结果对召回面的生效。

负责：

- 将已确认的 `derived_knowledge` 纳入正常召回。
- atomic `fact`、`section`、`evidence` 默认只保留为 provenance，不进入默认召回。
- 将 archived、rejected、superseded 对象移出正常召回。
- 保留审计可见，但不进入默认上下文装配。
- 更新图召回可用边。

输出：

- `recall_state`
- `context_assembly_state`
- `active_graph_edges`
- `inactive_graph_edges`

## 7. 手动触发范围

治理触发必须是显式操作。V1 支持以下手动范围：

- `batch_governance`：先治理本批新增对象。
- `library_alignment_governance`：将本批结果与已有库对齐。
- `global_governance`：对全库做整理、归并、替代和综合。
- `object_pair_governance`：用户指定两个或多个对象比较。
- `topic_governance`：围绕一个主题做局部全库治理。

默认执行顺序：

```text
batch_governance
-> library_alignment_governance
-> optional global_governance
```

这样既能先处理新增资料，又能周期性整理整个库，符合“知识库越来越聪明，而不是越来越大”的目标。

## 8. 模型裁决策略

治理层模型负责大部分语义判断。

规则优先处理：

- hash 重复。
- Markdown 缺失。
- 正文过短。
- 明显乱码。
- 空 evidence。
- 明显 boilerplate。

模型处理：

- 近重复。
- 主题相关性。
- 跨源关系。
- 冲突识别。
- 过时判断。
- 综合知识生成。
- 记忆修订建议。
- 中文审查摘要。

人工复核只处理：

- 影响用户长期偏好的治理。
- 影响 `rule_memory` 的治理。
- `contradicts` / `supersedes` / `constrains` 且影响范围较大的治理。
- 模型置信度不足。
- evidence 不完整但影响较大的治理。

## 9. 风险分级

高风险不是只看关系类型，也不是只看置信度，而是组合判断。

高风险条件：

- relation type 属于 `contradicts` / `supersedes` / `constrains`。
- 涉及 `rule_memory`、用户长期偏好或系统行为规则。
- 会让已有高频知识退出召回。
- 会修改或替代旧记忆。
- confidence 低于阈值。
- evidence 数量不足或证据互相冲突。

建议阈值：

- `confidence >= 0.85` 且低风险：模型可自动确认。
- `0.65 <= confidence < 0.85`：进入待复核或保守生效。
- `confidence < 0.65`：不生效，只保留 proposal。
- 高风险项即使高置信，也进入人工复核。

## 10. 状态模型

治理对象状态：

- `curated`
- `quarantined`
- `archived`
- `superseded`
- `merged`
- `rejected`

审查状态：

- `model_accepted`
- `model_rejected`
- `needs_human_review`
- `human_accepted`
- `human_rejected`

召回状态：

- `active`
- `inactive`
- `audit_only`

原则：

- `active` 才进入正常召回。
- `inactive` 不进入正常召回，但可以被治理任务读取。
- `audit_only` 只用于审计和回溯。

## 11. 写回语义

治理通过后要回写：

- 当前对象状态。
- 关联对象状态。
- relation / relation proposal 状态。
- synthesized knowledge。
- governance job result。
- cleaning log。
- recall state。
- context assembly state。

归并写回：

- canonical 对象保留 `active`。
- 被归并对象标记 `merged` 或 `archived`。
- relation 指向 canonical 对象。
- 召回默认只返回 canonical 对象。

替代写回：

- 新对象标记 `active`。
- 旧对象标记 `superseded` 或 `archived`。
- 建立 `supersedes` / `superseded_by`。
- 旧对象退出正常召回。

## 12. 幂等与重入

治理任务必须可重复执行。

幂等键建议：

- `governance_type`
- `scope_hash`
- `input_object_ids`
- `model_config_hash`
- `prompt_version`
- `ruleset_version`

重复执行时：

- 已存在相同 relation 不重复创建。
- 已存在相同 synthesized knowledge 不重复创建。
- 若 evidence 或模型版本变化，则创建新 revision。
- 保留 job history，不覆盖审计链。

## 13. Console 要求

继续扩展当前 Ops Console，不另起重前端应用。

必须能看：

- Governance Jobs。
- 本次治理范围。
- 清洗掉了哪些内容。
- 哪些对象被归并、替代、归档。
- 哪些对象退出召回。
- 新增了哪些 relation。
- 新增了哪些 synthesized knowledge。
- 哪些项需要人工复核。
- 每个模型裁决的 evidence path、reason、confidence、risk level。

必须能操作：

- 手动触发 batch governance。
- 手动触发 library alignment governance。
- 手动触发 global governance。
- 接受 / 拒绝 / 归档 / 合并 / 替代 / 标记待复核。
- 打开 canonical Markdown。
- 查看审计记录。

## 14. 数据模型建议

新增或扩展：

- `governance_job`
- `governance_decision`
- `governance_review_item`
- `governance_cleaning_log`
- `governance_relation_proposal`
- `synthesized_knowledge`
- `synthesized_knowledge_evidence`
- `object_revision`
- `recall_surface_state`

关键字段：

- `tenant_id`
- `namespace`
- `governance_type`
- `scope_type`
- `scope_ref`
- `status`
- `model_name`
- `model_config_hash`
- `prompt_version`
- `ruleset_version`
- `decision`
- `confidence`
- `risk_level`
- `evidence_refs`
- `reasoning_summary`
- `before_state`
- `after_state`

## 15. 验收标准

- 可以手动触发一批新增文档治理。
- 可以手动触发本批与已有库对齐。
- 可以手动触发全库治理。
- Markdown 清洗能删除明显非知识内容，并保留 cleaning log。
- 重复或近重复对象能归并到 canonical 对象。
- 过时对象能被替代并退出正常召回。
- 至少能生成一种 `synthesized_knowledge`。
- 已确认治理结果能直接进入正常召回面。
- 高风险或不确定项进入人工复核，不直接进入高置信图。
- Console 能展示治理任务、裁决理由、证据、状态变化和召回影响。

## 16. V1 实施顺序

1. 落库 `governance_job`、`governance_decision`、`synthesized_knowledge`、`recall_surface_state`。
2. 实现手动 `batch_governance`。
3. 实现 Markdown cleaning 和 quality governance。
4. 实现 dedup / merge / supersession 的规则层。
5. 接入模型治理裁决接口。
6. 实现 `cross_source_synthesis_governance`。
7. 将治理结果写入正常召回面。
8. 扩展 Ops Console 治理视图。
9. 做一批真实文档治理测试，输出治理前后对比。
