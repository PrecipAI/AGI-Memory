# 治理抽取偏差修正规格

对应项目：
- `D:\workspace\projects\SuperAgentSystem-main`

对应上位 SPEC：
- `D:\workspace\projects\SuperAgentSystem-main\SPEC-SuperAgentSystem-knowledge-platform.md`

本文档用于修正本轮治理中暴露出的核心问题：
- `rule` 被低价值接入事实污染
- `memory` 基本没有抽到真正长期有效的内容
- `skill` 没有走 proposal 机制
- `knowledge` 没有真正并入总治理结果

## 1. 本轮确认结论

以下结论已经由用户确认，后续实现必须严格遵守：

1. `rule` 的 active enforcement 只保留两档：
   - `must`
   - `must_not`

2. 长期暴露给后续 agent 的知识对象只保留治理后的 `knowledge`：
   - `fact`
   - `section`
   - `evidence`
   - `relation`
   
   以上对象默认只作为内部中间层和溯源层，不直接作为最终长期召回对象。

3. `skill` 治理只能生成 proposal：
   - 系统可以发现哪些 skill 需要新增、拆分、合并、补规则、修触发条件
   - 但没有用户确认，不允许直接改任何真实 `SKILL.md`

## 2. 问题定性

这次问题不是治理器没跑通，而是：

1. 写入源不对。
   当前进入治理层的主要是接入、安装、发布、验证类 candidate。
   所以治理后 resident 里保留下来的也是这些低价值运维项。

2. 分层准入不严。
   `constraint_fact`、`project_constraint`、`integration_fact` 一类对象没有被严格区分。

3. knowledge 治理与 memory 治理没有完成总装。
   当前 `memory_run_governance` 可以整理 candidate / resident / summary，
   但知识治理产物没有进入统一的长期暴露层。

4. skill 治理没有进入 proposal 流。
   当前系统可以沉淀一些 procedural 痕迹，但没有形成“发现问题 -> 生成 skill 变更提案 -> 人工确认”的闭环。

## 3. 修正后的四层定义

### 3.1 Rule

`rule` 只保存会直接约束后续 agent 行为的硬规则。

必须满足：

1. 能指导执行，而不是只描述状态。
2. 跨会话有效，而不是一次性记录。
3. 对后续 planner / router / executor / context assembly 有真实约束。
4. enforcement 只能是：
   - `must`
   - `must_not`

适合进入 `rule` 的内容：

1. 必须先读取 memory / knowledge / rules 的触发规则。
2. 什么时候必须过 `rule_gate_check`。
3. 什么变更必须先汇报用户。
4. 上下文装配顺序和压缩原则中的强约束。
5. 用户明确表达的拒绝偏好。
6. 工程边界和安全边界。

不适合进入 `rule` 的内容：

1. “某次接入已经成功”
2. “某个 host config 已被写入”
3. “某个安装器会备份配置”
4. 一次性调试事实
5. 普通环境状态说明

### 3.2 Memory

`memory` 只保存长期稳定事实，不表达强执行约束。

适合进入 `memory` 的内容：

1. 用户长期偏好事实。
2. 项目长期背景事实。
3. 已确认的架构决策。
4. 长期有效的环境事实。
5. 已验证的失败模式摘要。
6. 长期有效但不构成强规则的工作习惯。

不适合进入 `memory` 的内容：

1. 必须或禁止类约束。
2. 可执行步骤。
3. 外部知识治理后的抽象结论。
4. 中间结构化对象。

### 3.3 Skill

`skill` 保存“怎么做”的可复用执行知识。

适合进入 `skill` 的内容：

1. 可重复执行的流程。
2. 修复路径和调试路径。
3. 工具使用规范。
4. 编码设计和编码执行规范。
5. interview 何时触发、何时补访谈、何时更新 SPEC 的可执行流程。

但 `skill` 的修改流程必须是：

1. 先发现问题。
2. 形成 skill 变更 proposal。
3. 说明为什么要改、改什么、影响什么。
4. 等用户确认。
5. 再改真实 `SKILL.md`。

### 3.4 Knowledge

`knowledge` 是知识治理后的长期产物，是后续领域知识召回的主对象。

适合进入 `knowledge` 的内容：

1. 跨来源归纳出的稳定结论。
2. 领域原则。
3. 设计判断。
4. 技术规律。
5. 可溯源的综合知识对象。

必须带：

1. `source_refs`
2. `evidence_refs`
3. `governance_trace`
4. `confidence`
5. 必要的冲突/适用边界说明

默认不直接暴露的对象：

1. `document`
2. `section`
3. `fact`
4. `relation`
5. `evidence`

这些对象只作为：

1. 中间抽取层
2. 治理层输入
3. 溯源层
4. 审查层

## 4. 修正后的治理总链路

```text
source markdown / external material
-> parse / clean / normalize
-> intermediate objects
   - document
   - section
   - fact
   - relation
   - evidence
-> governance
   - dedupe
   - conflict detect
   - cross-source compare
   - synthesize
   - memory extract
   - rule extract
   - skill change proposal detect
-> long-term outputs
   - knowledge
   - memory
   - active rules
   - skill proposals
-> context assembly
```

关键要求：

1. `knowledge` 必须进入总治理结果，不能继续缺席。
2. `rule`、`memory`、`knowledge`、`skill proposal` 必须分别产出。
3. resident 不能再只显示 memory 路径结果。

## 5. resident 修正要求

当前 resident 的问题是：
- 低价值接入事实占位
- 没有真正知识层产物
- skill 只有痕迹，没有提案

修正后 resident 必须显式分层：

```json
{
  "rules": [],
  "memory": [],
  "skills": [],
  "knowledge": []
}
```

要求：

1. `rules` 只放 active `must` / `must_not`。
2. `memory` 只放长期稳定事实。
3. `skills` 只放当前已确认可复用的 procedural 能力，不放未确认变更建议。
4. `knowledge` 放治理后的综合知识对象，而不是 fact / relation。

## 6. 路由修正

### 6.1 Candidate -> Rule

下列内容进入 `rule_candidate` 或等价 persist target，而不是 `memory`：

1. `constraint_fact`
2. `project_constraint`
3. `rejection_preference`
4. `policy_constraint`
5. `quality_gate`
6. 检索触发规则
7. 治理触发规则
8. 上下文装配强约束

### 6.2 Candidate -> Memory

只保留：

1. `environment_fact`
2. `profile_fact`
3. `architecture_decision`
4. `project_state`
5. 长期稳定的 verified failure summary

### 6.3 Intermediate -> Knowledge

治理后输出的综合知识对象直接进入 `knowledge` 层，而不是停留在：

1. `fact`
2. `relation`
3. `evidence`

### 6.4 Skill detection -> Skill proposal

检测到 skill 问题时：

1. 不直接改 skill
2. 不直接落 active procedural skill
3. 先输出 proposal

## 7. 这次需要新增的治理结果类型

至少新增以下产物类型：

1. `knowledge_object`
2. `knowledge_revision`
3. `rule_candidate`
4. `rule_change_proposal`
5. `skill_change_proposal`
6. `memory_revision`

## 8. 需要修的实现点

### 8.1 Memory Router

文件：
[memoryRouter.ts](D:/workspace/projects/SuperAgentSystem-main/services/memory-service/src/memoryRouter.ts)

需要修：

1. 把 `constraint_fact` / `project_constraint` 从 factual memory 路由中移除。
2. 增加 `rule` persist target。
3. 为 `knowledge` 治理结果预留正式入层路径。

### 8.2 Governance Builder

需要修：

1. governance 不能只重建 `memory + skill` resident。
2. governance 要显式输出：
   - `rules`
   - `memory`
   - `knowledge`
   - `skill proposals`

### 8.3 Resident Snapshot

需要修：

1. resident payload 增加 `knowledge` 区域。
2. resident 构建时过滤低价值接入事实。
3. rule 只保留 `must` / `must_not`。

### 8.4 Ops Console

需要修：

1. 能看到治理后的 `knowledge`，而不是只看到 fact / relation。
2. 能看到 `skill change proposal`。
3. 能区分：
   - active rule
   - memory
   - knowledge
   - skill proposal

## 9. 本轮发现的 skill 修改提案

以下是基于整个会话发现的 skill 问题。这里只提案，不直接修改。

### 9.1 interview

问题：

1. 当前触发边界不够刚性，导致已经出现理解偏差时，没有被立即重新拉起。
2. 缺少“阶段性校准”在真实执行中的强提醒。
3. 没有把“发现 spec 与用户意图不对齐时必须停下补访谈”做成更显式的执行检查点。

建议修改：

1. 强化触发条件：
   - 用户说“理解错了”
   - 出现新治理层/新架构层/新分层边界
   - 发现当前结果和用户目标明显错位
   - 任何会导致 resident / rule / knowledge 分层变化的阶段切换
2. 加入阶段性 checkpoint 清单。
3. 增加“先复述当前理解，再问 1-3 个决定路径的问题”的固定格式。

### 9.2 memory-governance-guidelines

问题：

1. 当前更偏“跑治理动作”，没有强制先检查治理对象是否完整。
2. 没有先区分这次治理是 `memory-only` 还是 `unified governance`。
3. 没有把“治理结果质量低于阈值时不应当汇报成成功沉淀”写死。

建议修改：

1. 增加治理前检查：
   - 这次是否包含 knowledge 层
   - 当前 resident 是否有低价值接入事实污染
   - 当前抽取对象是否只停留在中间层
2. 输出必须区分：
   - 机制成功
   - 内容合格
3. 如果只有低价值运维项进入 resident，要明确判定为“治理内容不合格”。

### 9.3 memory-ingestion-guidelines

问题：

1. 现在更容易把“接入事实”“一次性状态”写进 memory candidate。
2. 没有把 rule / memory / skill / knowledge 的写入边界前置卡住。

建议修改：

1. ingestion 前先判断四层归属。
2. 不允许把接入成功、安装成功、临时动作说明默认写成长期 memory。
3. 对 constraint 类对象优先导向 `rule_candidate`。

### 9.4 memory-retrieval-guidelines

问题：

1. 当前 retrieval 关注 memory 契约本身，但没有把 unified layers 作为目标模型。
2. 没明确“最终面向 agent 暴露的是 knowledge，不是 fact/relation/evidence”。

建议修改：

1. retrieval 文档中明确分层：
   - rules
   - memory
   - skills
   - knowledge
2. 中间层对象默认不直接作为最终召回结果。

## 10. 实施顺序

### Phase 1

1. 修正文档和规格。
2. 固化四层准入标准。
3. 固化 skill proposal 机制。

### Phase 2

1. 修 `memoryRouter.ts` 的路由。
2. 给 governance 增加 `knowledge` 输出路径。
3. 给 resident 增加 `knowledge` 区域。

### Phase 3

1. 加 `rule_candidate` / `rule proposal` 路径。
2. 加 `skill proposal` 路径。
3. 清洗现有 resident。

### Phase 4

1. 补 Console 展示。
2. 重新跑治理。
3. 输出新的治理结果对照报告。

## 11. 验收标准

1. resident 中不再出现“Codex 已接通”“install-host 会写 config”这类低价值 rule。
2. active `rule` 只包含 `must` / `must_not`。
3. `memory` 中只出现长期稳定事实。
4. `knowledge` 在治理结果中正式出现，且是治理后的长期对象。
5. `fact / relation / evidence / section` 不再被当成最终长期暴露对象。
6. `skill` 变更只生成 proposal，不自动改真实 skill。
7. 新一轮治理报告能区分：
   - 规则
   - 记忆
   - 技能提案
   - 知识产物
8. 如果治理只整理出低价值运维项，报告必须明确判定“机制通过，内容不合格”。
