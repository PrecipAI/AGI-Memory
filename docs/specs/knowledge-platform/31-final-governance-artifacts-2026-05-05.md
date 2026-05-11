# 最终治理产物清单（2026-05-05）

## 1. 最终状态结论

本轮完整治理后的长期层已经收口到以下状态：

- `knowledge`：保留 14 条有效外部知识
- `memory`：0 条 active
- `rule`：0 条 active
- `skill`：0 条 active
- `governance evidence`：保留在非问答层，用于治理，不进入日常回答

这次额外完成了两类清理：

1. 清掉内部会话误产出的 `knowledge`
2. 清掉验证残留的 `memory / rule / skill`

因此当前长期层不再包含：

- 内部会话治理原则
- MCP 接入验证轨迹
- 验证 seed memory
- smoke rule
- demo skill

---

## 2. 当前库级总量

- Active documents: `121`
- Active markdown documents: `118`
- Active sections: `2401`
- Active evidence: `2416`
- Active synthesized knowledge: `14`
- Facts / Entities / Relations: `0 / 0 / 0`
- Intermediate recall surface: `0`
- Active review queue: `5`
- Pending change proposals: `0`

能力评测现状：

- Total cases: `10`
- Passed cases: `10`
- Pass rate: `100%`
- Avg latency: `257.059 ms`
- Avg derived count: `3.5`
- Avg evidence trace count: `19`

对应导出报告：

- [knowledge-current-system-report.json](D:/workspace/projects/SuperAgentSystem-main/tests/knowledge-benchmark/reports/knowledge-current-system-report.json)
- [knowledge-current-system-report.md](D:/workspace/projects/SuperAgentSystem-main/tests/knowledge-benchmark/reports/knowledge-current-system-report.md)

---

## 3. 最终保留的 Knowledge

以下 14 条是当前 active 的最终外部知识产物：

1. `derived_rule`
   `长期记忆必须在使用时验证有效性，而不是只做相似召回`

2. `design_principle`
   `Agent 工具和 MCP 接入必须有结构化授权、沙箱和审计，而不能只靠提示词约束`

3. `design_principle`
   `生产级检索默认应采用多信号候选、重排和证据边界，而不是单一路径`

4. `cross_source_pattern`
   `Agent 可靠性来自 harness 闭环，而不是单次提示词或单模型能力`

5. `derived_rule`
   `Agent 观测必须记录轨迹、工具调用、上下文和成本，否则无法治理失败`

6. `design_principle`
   `生产级 RAG 应拆成检索、重排、证据校验、观测和安全治理的闭环`

7. `design_principle`
   `检索基础设施应抽象为可替换后端，核心契约是混合召回、过滤、融合和重排`

8. `derived_rule`
   `长期记忆不能退化成向量片段库，必须显式建模结构、时间和治理`

9. `derived_rule`
   `RAG 评估必须拆开检索质量、生成忠实度和多轮行为`

10. `cross_source_pattern`
    `Agent 框架正在收敛到工具、记忆、工作流、多智能体和评估的一体化运行时`

11. `cross_source_pattern`
    `成熟 RAG 系统会把检索、证据装配和可观测性拆成独立环节`

12. `boundary_condition`
    `图谱召回适合关系型问题，但不能替代证据治理和事实有效性判断`

13. `boundary_condition`
    `图谱抽取不等于知识治理，chunk 内路径只能作为图谱候选`

14. `cross_source_pattern`
    `成熟知识平台正在收敛为知识库、工作流、Agent 和多源数据的一体化系统`

说明：

- 这些条目当前都来自外部资料治理后的抽象结论。
- 当前 `knowledge` 层已经不再包含内部线程规则、接入验证路径、项目局部偏好或机器上下文。

---

## 4. 本轮退掉的脏 Knowledge

本轮退役了 5 条不应保留在 `knowledge` 层的对象：

1. `Memory MCP 接入应通过真实链路验证而不是仅做最小 smoke`
   原因：`internal_or_session_specific_not_external_knowledge`

2. `Memory MCP 接入应通过真实链路验证而不是仅做最小 smoke`
   原因：`internal_or_session_specific_not_external_knowledge`

3. `治理输入必须覆盖未治理会话与执行记录`
   原因：`internal_or_session_specific_not_external_knowledge`

4. `长期记忆召回不能只做相似检索，必须在使用时验证有效性`
   原因：`semantic_duplicate_keep_stronger_long_term_memory_validation_rule`
   保留替代项：
   `长期记忆必须在使用时验证有效性，而不是只做相似召回`

5. `Agent 可靠性主要由 harness 决定，不应只依赖模型和长提示词`
   原因：`semantic_duplicate_keep_stronger_harness_reliability_pattern`
   保留替代项：
   `Agent 可靠性来自 harness 闭环，而不是单次提示词或单模型能力`

对应清理脚本：

- [clean-synthesized-knowledge-surface.mjs](D:/workspace/projects/SuperAgentSystem-main/scripts/clean-synthesized-knowledge-surface.mjs)

---

## 5. 本轮退掉的验证残留 Surface

以下对象被从长期层退役，因为它们只是验证或 demo 残留，不是最终治理产物：

### Retired Memory

1. `Support SLA`
2. `Escalation policy`

### Retired Rule

1. `Console proposal smoke rule`

### Retired Skill

1. `Ticket triage`

对应清理脚本：

- [clean-validation-memory-surface.mjs](D:/workspace/projects/SuperAgentSystem-main/scripts/clean-validation-memory-surface.mjs)

---

## 6. 最新 Host Governance 产物

最新一轮 `Codex host capture -> governance-run` 的输出结果如下：

- `rule_count = 2`
- `memory_count = 1`
- `skill_proposal_count = 1`
- `knowledge_count = 0`
- `governance_evidence_count = 4`

说明：

- 内部会话治理已经不再误产 `knowledge`
- 当前 live / host 侧内部信息会进入：
  - `rule`
  - `memory`
  - `skill proposal`
  - `governance evidence`
- 不会再污染 `knowledge`

本轮 retained 的治理证据包括：

1. `Execution step evidence`
   - category: `success_reason`
   - excerpt:
     `powershell.exe -Command Get-Content C:\Users\Administrator\.codex\config.toml cwd=D:\workspace\projects\SuperAgentSystem-main exit=0`

2. `Tool execution evidence`
   - category: `tool_execution`
   - excerpt:
     `shell_command {"command":"Get-Content C:\\Users\\Administrator\\.codex\\config.toml"}`

3. `MCP execution evidence`
   - category: `mcp_execution`
   - excerpt:
     `memory-v3/memory_health`

4. `MCP execution evidence`
   - category: `mcp_execution`
   - excerpt:
     `memory-v3/memory_retrieve_context`

非问答层 bundle：

- `governance_evidence_bundle_id = 7153c8b8-1f97-48ea-a380-1a0fd0f1baff`

验收脚本：

- [verify-codex-governance-run.mjs](D:/workspace/projects/SuperAgentSystem-main/scripts/verify-codex-governance-run.mjs)

---

## 7. 当前仍保留的边界

这轮之后，机制和结果已经比之前干净很多，但仍有几个边界：

1. 当前 active `knowledge` 已经收干净，但质量仍然偏“工程抽象结论集合”，还不是更高阶的深度综合版。
2. `working memory layer` 还没有完全独立成正式对象层，当前重点仍在治理正确性。
3. `governance evidence layer` 已经可用，但对失败原因、放弃路径、采用原因的抽取仍偏启发式。
4. 当前 live 会话本身还没有完全无缝并入同一条自动治理闭环，已落盘线程链路优先更稳。

---

## 8. 最终判断

截至这轮为止，治理层已经达成这几个关键目标：

1. `knowledge` 不再混入内部会话和接入验证痕迹。
2. 历史污染的 `knowledge` 已清退。
3. 长期层里的验证残留 `memory / rule / skill` 已清退。
4. `governance evidence layer` 已真实落地，且不参与日常问答读取。
5. 最终长期层现在主要保留的是治理后的外部知识，而不是过程噪声。
