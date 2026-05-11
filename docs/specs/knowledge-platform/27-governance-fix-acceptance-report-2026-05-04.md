# 治理修正验收报告 2026-05-04

对应项目：
- `D:\workspace\projects\SuperAgentSystem-main`

对应修正规格：
- `D:\workspace\projects\SuperAgentSystem-main\docs\specs\knowledge-platform\26-governance-extraction-fix-spec.md`

## 1. 本轮验收结构

本轮验收按四个面检查：

1. 路由面
   - `rule` 是否只走 `must / must_not`
   - 低价值约束是否不再进入 active rule surface

2. resident 面
   - resident 是否显式包含：
     - `rules`
     - `memory`
     - `skills`
     - `knowledge`
     - `rule_proposals`
     - `skill_proposals`

3. knowledge 面
   - 最终长期暴露对象是否已经出现治理后的 `knowledge`
   - `fact / section / evidence / relation` 是否不再充当最终 resident 主体

4. 接入与回归面
   - 构建是否通过
   - `verify:memory` 是否通过
   - `verify:knowledge-ops-console` 是否通过
   - `verify:mcp`
   - `verify:mcp-client-smoke`

## 2. 本轮代码修正

已完成：

1. `ruleBuilder.ts`
   - enforcement 归一化为：
     - `must`
     - `must_not`
   - 旧值如 `must_follow / hard_block / should_follow` 不再作为 active rule surface 目标语义

2. `memory.ts`
   - `queryActiveRules`
   - `listActiveRules`
   - `queryRuleCheckpoints`
   - `queryRuleGateCheckpoints`
   
   以上 active rule surface 统一只暴露：
   - `must`
   - `must_not`

3. `residentMemoryBuilder.ts`
   - resident snapshot 新增：
     - `knowledge`
     - `knowledge_highlights`
     - `rule_proposals`
     - `skill_proposals`

4. 验证脚本修正：
   - `verify-memory-system.mjs`
   - `verify-knowledge-ops-console.mjs`
   
   已同步到新的 enforcement 口径。

## 3. 验证结果

### 3.1 构建

- `npm run build`：通过

### 3.2 Memory 验证

- `npm run verify:memory`：通过

关键结果：

- `constraint_candidate_persists_to_rule = true`
- `procedural_candidate_persists_to_skill = true`
- `governance_rebuilds_summary_and_snapshot = true`
- `rule_checklist_returns_checkpoints = true`
- `rule_gate_blocks_missing_evidence = true`
- `rule_gate_allows_with_evidence = true`
- `rule_hotplug_disable_removes_gate = true`

### 3.3 Knowledge Ops Console 验证

- `npm run verify:knowledge-ops-console`：通过

### 3.4 MCP 验证

- `npm run verify:mcp`：通过
- `npm run verify:mcp-client-smoke`：通过

关键结果：

- tools 列表正常
- resources 列表正常
- `memory_health` 正常
- `memory_query_layer` 正常
- `memory_retrieve_context` 正常
- `rule_gate_check` 正常

## 4. 重跑治理后的 resident 结果

真实治理重跑后：

- `rebuilt_snapshot_id = 6679d1e8-dfca-42e3-9ea0-136b95e80807`

当前 active resident snapshot 已包含：

### 4.1 rules

只保留了 active `must` 规则：

1. `verify-workspace-constraint`
2. `console-proposal-smoke-rule`

说明：

- 之前那批 `must_follow / should_follow` 口径的低价值 active rule，已经不会再进入 active rule surface。
- 当前 resident 中已经看不到“Codex 已接通 memory-v3”“install-host 会写 host config”这类接入事实规则。

### 4.2 memory

当前 resident memory 里保留的仍是稳定 factual memory：

1. `Support SLA`
2. `Escalation policy`
3. `Support environment endpoint`

### 4.3 skills

当前 resident skill 里保留 1 条 procedural skill：

1. `workflow-tag-standard-path-916679ac`

### 4.4 knowledge

resident 已正式纳入治理后的长期知识对象，当前前 5 条包括：

1. `长期记忆必须在使用时验证有效性，而不是只做相似召回`
2. `Agent 工具和 MCP 接入必须有结构化授权、沙箱和审计，而不能只靠提示词约束`
3. `长期记忆召回不能只做相似检索，必须在使用时验证有效性`
4. `Agent 观测必须记录轨迹、工具调用、上下文和成本，否则无法治理失败`
5. `Agent 可靠性来自 harness 闭环，而不是单次提示词或单模型能力`

这说明：

- `knowledge` 已经不再缺席
- resident 不再只是一份 memory/small rule 视图

### 4.5 rule_proposals

当前 resident 里已能看到待人工确认的 rule proposal：

1. `create_conflicting_rule`
   - `rule_key = verify-workspace-conflicting-constraint`
   - `enforcement_level = must_not`
   - reason:
     - `rule_candidate_declares_conflict`

### 4.6 skill_proposals

当前 resident 里已能看到待人工确认的 skill proposal：

1. `mark_skill_dirty_for_fingerprint_drift`
   - `skill_key = workflow-tag-standard-path-916679ac`
   - reason:
     - `skill_fingerprint_drift_requires_human_approval`

## 5. 当前整理结果的结论

### 5.1 已修正到位的部分

1. `rule` 的 active surface 已经收口到 `must / must_not`
2. resident 已纳入治理后的 `knowledge`
3. resident 已区分 active content 和 proposal
4. `fact / relation / evidence / section` 没有再作为 resident 主体暴露
5. console / memory / mcp 主链路回归通过

### 5.2 仍然存在的问题

1. `memory` 层内容质量仍然偏弱
   - 当前 active factual memory 里仍有：
     - `Detached governance candidate envelope`
     - `Knowledge governance routing decision`
   - 这两条虽然没有进入 resident 前 3，但还在 active memory 表里

2. `skill` 目前还是 procedural memory 一条，真实“skill 文件治理 proposal -> 用户确认 -> 修改真实 SKILL.md”这条外层闭环还没有接上本地 skill 仓库

3. `rule` 当前 active 里还有 1 条 console smoke rule
   - 它是测试产物，不是长期正式规则
   - 当前只是因为它满足 `must` 过滤条件，所以仍可见

## 6. 验收判定

### 6.1 通过项

1. 机制层：通过
2. 路由层：通过
3. resident 分层：通过
4. knowledge 并入长期暴露层：通过
5. proposal 分层：通过
6. MCP / Console / Memory 回归：通过

### 6.2 未完全通过项

1. `memory` 内容质量：部分通过
2. 测试/烟雾数据清理：未完成
3. 真实本地 `SKILL.md` 外层治理闭环：未完成

## 7. 最终判断

这轮修正之后，系统已经从“治理机制能跑，但结果没意义”，提升到：

1. resident 结构基本正确
2. `knowledge` 已进入长期结果面
3. `rule` 不再被低价值接入事实污染
4. `skill` 和 `rule` proposal 已有清晰分层

但如果按“内容质量完全收口”的标准看，还差最后一步：

1. 清理测试/烟雾遗留的 active memory / active rule
2. 把真正高价值项目 memory 补进来
3. 把真实 skill 文件治理闭环接上
