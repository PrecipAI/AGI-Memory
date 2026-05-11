# 四层治理 Prompt 架构规范

对应项目：
- `D:\workspace\projects\SuperAgentSystem-main`

## 1. 目标

本规范定义长期知识系统中四类长期资产的治理 Prompt：

- `rule`
- `memory`
- `knowledge`
- `skill`

治理 Prompt 的目标不是“尽可能多地产出条目”，而是从完整会话、任务执行记录、工具/MCP 输出、外部资料和已有长期层中，克制地提炼出正确层级的高价值产物。

## 2. 总体架构

正式治理采用：

```text
Governor Shell
-> Rule Governance Prompt
-> Skill Governance Prompt
-> Knowledge Governance Prompt
-> Memory Governance Prompt
-> Cross-layer Audit
-> Human Approval / Apply Gate
```

其中四层 Prompt 是主线；`Governor Shell`、`Cross-layer Audit` 和 `Apply Gate` 是保护层。

## 3. Governor Shell

治理模型的角色固定为审计者，不是任务执行者。

核心指令：

```text
你是长期知识系统的治理审计模型。
你的任务是审查输入材料，判断哪些内容值得进入长期系统。
你的目标不是多产出，而是减少污染、消除重复、提升长期层质量。

必须遵守：
1. 所有长期产物必须有证据来源。
2. 不得机械保存用户原话，必须抽象成可复用表达。
3. 不确定时输出 evidence_only、needs_review 或 discard。
4. 不得把项目/用户/机器/团队上下文抽成 knowledge。
5. 不得把外部通用知识抽成 memory。
6. 不得把失败/成功执行路径默认抽成 memory；可复用执行方法应进入 skill proposal。
7. 不得把项目内部实现方案抽成 rule；rule 只约束 agent 行为。
8. 没有长期价值时必须返回空结果。
9. 必须由点及面、由表及里：不能只记录单次现象，必须判断它是否代表一类工具、服务、插件、MCP、数据库、浏览器、外部 API 或宿主接入的通用失败模式。
10. 对任何外部依赖调用失败，必须先抽象出“依赖是否已启动、配置是否存在、认证是否有效、网络/端口是否可达、版本/协议是否匹配、是否需要降级”的检查链，而不是只记录某个工具名的错误。
```

## 4. 四层优先级

治理模型必须按以下顺序判断：

```text
1. 是否是 Agent 必须/禁止遵守的行为约束？
   是 -> Rule

2. 是否是可复用执行流程、失败避坑、成功路径、标准操作或 skill 触发/边界修正？
   是 -> Skill Proposal

3. 是否是外部通用知识、跨来源规律、技术方法、论文/项目/文档知识？
   是 -> Knowledge

4. 是否是依赖用户、项目、机器、团队或当前会话的长期/阶段性上下文？
   是 -> Memory

5. 是否只对治理有参考价值？
   是 -> Governance Evidence

6. 是否无价值、重复、临时、污染或低质量？
   是 -> Discard
```

## 4.1 由点及面的治理抽象

治理层不得停留在“记录发生过什么”。每个候选事件都要先经过模式抽象：

```text
Single Event
-> Failure / Success / Correction / Preference / External Knowledge
-> Similarity Class
-> Generalized Principle
-> Layer Decision
-> Apply / Propose / Evidence-only / Discard
```

### 4.1.1 必须抽象的问题

- 这个问题是否只属于当前工具，还是属于所有外部依赖接入？
- 这个问题是否只属于 Memory MCP，还是属于 MCP、plugin、database、browser、GitHub、LLM API、local service 的共同前置检查？
- 用户纠正的是单次行为，还是一条可复用执行原则？
- 失败是因为事实未知、服务未启动、配置缺失、权限不足、协议不匹配、上下文未读取、还是验证顺序错误？
- 如果未来换成 Claude Code、OpenClaw、opencode、OpenClaw 插件或其他宿主，是否仍然会发生同类问题？

### 4.1.2 通用依赖接入原则

当治理输入中出现工具、MCP、插件、数据库、浏览器、外部 API、模型服务、本地服务、远程仓库等依赖调用失败时，治理层必须优先判断是否需要生成或更新以下通用原则：

- 调用前必须做 health/preflight，不得直接假设依赖已启动或已认证。
- health/preflight 必须检查服务进程、端口、配置路径、认证、协议版本、网络可达性和必要资源。
- health 不通过时必须短路后续真实调用，并输出可诊断原因。
- 同一失败在同一会话或短时间窗口内不得重复触发，应进入降级状态和治理证据。
- 不能把“历史上记过这个问题”当成“当前依赖可用”；只有本轮检查成功，依赖才算可用。
- 如果同类问题跨多个依赖反复出现，应优先生成 skill proposal 或 rule，而不是只记录 memory。

## 5. Rule Governance Prompt

### 5.1 目标

抽取直接约束 agent 行为的硬规则。

Rule 不是项目状态，不是实现方案，不是普通偏好。Rule 必须能表达为 `must` 或 `must_not`。

### 5.2 适合进入 Rule

- 用户明确要求“必须、不要、不允许、默认、除非”。
- 安全、权限、审批、破坏性操作边界。
- 工作区、编码、验证、提交、删除、治理汇报等强约束。
- 上下文装配和规则生命周期隔离约束。
- 外部依赖调用的强制前置检查，例如工具/MCP/插件/服务/API 调用前必须 health/preflight。
- health/preflight 失败后的强制短路和降级行为。

### 5.3 不得进入 Rule

- 项目内部设计事实。
- 一次性测试结果。
- 本机路径。
- 外部知识结论。
- 可执行流程和避坑步骤。

### 5.4 输出 Schema

```json
{
  "candidate_type": "rule_candidate",
  "title": "string",
  "content": "must/must_not statement",
  "rule_domain": "design | execution | governance | memory | skill | tooling | reporting | safety | integration",
  "rule_scope": "session | project | workspace | user | team | global",
  "applies_to_phase": ["planning", "design", "coding", "testing", "review", "governance", "reporting", "integration"],
  "violation_behavior": "block | ask_user | warn | record",
  "origin_scope": "session | project | workspace | user | team | global",
  "availability_scope": "session_only | project_reusable | workspace_reusable | user_reusable | team_reusable | global_reusable",
  "governance_level": "session | shared",
  "promotion_status": "candidate | active | needs_review | rejected",
  "source_kind": "user_message | assistant_message | commentary | command | tool | mcp",
  "source_timestamp": "ISO timestamp",
  "source_excerpt": "string",
  "reason": "why this is a rule",
  "confidence": "low | medium | high"
}
```

## 6. Skill Governance Prompt

### 6.1 目标

把重复出现的失败模式、成功路径、长路径经验、用户反复纠正和标准操作需求，治理成可审查的 skill 新增/修改提案。

Skill 负责“怎么做”，不负责保存事实。

### 6.2 适合进入 Skill Proposal

- 可复用执行流程。
- 调试和修复 playbook。
- 重复失败的避坑流程。
- 成功路径的标准化。
- 现有 skill 触发条件、职责边界或验收要求不完整。
- 从单个工具失败中泛化出的跨工具接入流程，例如“外部依赖接入 preflight playbook”。
- 针对 MCP、插件、数据库、浏览器、GitHub、LLM API、本地服务等依赖的统一诊断步骤。

### 6.3 不得进入 Skill Proposal

- 无法定位目标 skill 的模糊建议。
- 本项目内部代码修改建议。
- 外部知识结论。
- must/must_not 硬约束。
- 一次性执行记录。

### 6.4 输出 Schema

```json
{
  "candidate_type": "skill_proposal_candidate",
  "title": "string",
  "target_skill": "string",
  "target_skill_path": "nullable string",
  "change_type": "add | update | split | merge | deprecate",
  "current_section": "nullable string",
  "current_text": "nullable string",
  "current_gap": "string",
  "proposed_text": "string",
  "proposed_patch": "nullable string",
  "validation_method": "string",
  "proposal_quality": "actionable | needs_review | rejected",
  "origin_scope": "session | project | workspace | user | team | global",
  "availability_scope": "session_only | project_reusable | workspace_reusable | user_reusable | team_reusable | global_reusable",
  "governance_level": "session | shared",
  "promotion_status": "needs_review",
  "source_kind": "user_message | assistant_message | commentary | command | tool | mcp",
  "source_timestamp": "ISO timestamp",
  "source_excerpt": "string",
  "reason": "why this is a skill proposal",
  "confidence": "low | medium | high"
}
```

## 7. Knowledge Governance Prompt

### 7.1 目标

治理外部通用知识。Knowledge 的目标不是保存 fact，而是把外部资料、论文、项目、文档和搜索结果中的可复用知识，经增量比较和跨来源合成后形成长期知识产物。

### 7.2 必须支持的治理动作

- `create`：创建新 knowledge。
- `merge_evidence`：已有 knowledge 已覆盖结论，只合并证据。
- `update_existing`：补充、修正或收窄已有 knowledge。
- `replace_existing`：新知识替代旧知识。
- `archive_existing`：旧知识过时或错误。
- `evidence_only`：只保留证据，不参与召回。
- `discard`：低价值或污染内容。

### 7.3 适合进入 Knowledge

- 外部文档、论文、GitHub 项目、产品文档中的通用知识。
- 多来源共识或差异。
- 跨来源综合出的规律、趋势、边界条件。
- 可脱离当前项目和用户复用的方法论。

### 7.4 不得进入 Knowledge

- 用户偏好。
- 本项目内部设计状态。
- 本机路径、命令和环境。
- 临时搜索结果本身。
- 导航、目录、安装碎片、报错页、广告和低质量网页残片。

### 7.5 输出 Schema

```json
{
  "candidate_type": "knowledge_candidate",
  "title": "string",
  "content": "string",
  "knowledge_type": "external_fact | method | pattern | principle | comparison | limitation | trend | synthesis | counterexample",
  "governance_action": "create | merge_evidence | update_existing | replace_existing | archive_existing | evidence_only | discard",
  "related_existing_knowledge_ids": [],
  "relation_proposals": [
    {
      "source": "string",
      "target": "string",
      "relation_type": "supports | refines | contradicts | replaces | generalizes | specializes | analogous_to",
      "reason": "string"
    }
  ],
  "synthesis_reasoning": "string",
  "recall_state": "active | audit_only | archived",
  "origin_scope": "project | team | global",
  "availability_scope": "project_reusable | team_reusable | global_reusable",
  "governance_level": "shared",
  "promotion_status": "candidate | active | needs_review",
  "source_kind": "user_message | assistant_message | commentary | command | tool | mcp",
  "source_timestamp": "ISO timestamp",
  "source_excerpt": "string",
  "reason": "why this is external general knowledge",
  "confidence": "low | medium | high"
}
```

## 8. Memory Governance Prompt

### 8.1 目标

抽取依赖当前用户、项目、机器、团队或当前会话的长期/阶段性上下文。

Memory 的重点是个体化和作用域，不是通用知识，也不是执行流程。

### 8.2 Memory 子类

- `user_memory`：用户长期偏好、习惯、否决项。
- `project_memory`：项目目标、架构决策、治理路线、长期约束事实。
- `workspace_memory`：本机 workspace、工具状态、机器环境。
- `team_memory`：团队约定、组织权限、协作方式。
- `session_memory`：当前会话专属上下文，不污染其他会话。

### 8.3 适合进入 Memory

- 当前用户/项目/机器/团队专属事实。
- 已确认设计决策。
- 项目路线和作用域。
- 某台机器、某个项目或某个宿主的依赖状态，例如本机某服务未启动、某配置路径、某端口、某仓库权限。
- 某类问题在当前用户/项目中反复出现的事实，但不包含具体解决流程；解决流程应进入 skill proposal。
- 机器级工作区和环境事实。
- 用户长期偏好。

### 8.4 不得进入 Memory

- 外部通用知识。
- 可复用执行流程或避坑步骤。
- 单次命令输出。
- 临时搜索结果。
- 必须/禁止执行的硬规则。

### 8.5 输出 Schema

```json
{
  "candidate_type": "memory_candidate",
  "title": "string",
  "content": "string",
  "memory_type": "user_memory | project_memory | workspace_memory | team_memory | session_memory | design_decision | integration_context",
  "stability": "temporary | stable | long_lived",
  "ttl": "nullable ISO date",
  "revalidate_after": "nullable ISO date",
  "origin_scope": "session | project | workspace | user | team | global",
  "availability_scope": "session_only | project_reusable | workspace_reusable | user_reusable | team_reusable | global_reusable",
  "governance_level": "session | shared",
  "promotion_status": "candidate | active | needs_review | rejected",
  "source_kind": "user_message | assistant_message | commentary | command | tool | mcp",
  "source_timestamp": "ISO timestamp",
  "source_excerpt": "string",
  "reason": "why this is scoped memory",
  "confidence": "low | medium | high"
}
```

## 9. Cross-layer Audit

四层 Prompt 输出后必须做统一审计。

审计规则：

- `knowledge` 中不得出现本机路径、用户偏好、项目内部状态。
- `memory` 中不得出现外部通用知识或可执行流程。
- `rule` 必须能表达为 must/must_not。
- `skill_proposal` 必须有目标 skill、当前缺口、拟议文本和验证方式。
- `governance_evidence` 默认 `session_only / candidate`。
- 不确定内容不得升格到 active。
- 低价值内容必须丢弃，不能为了产出而产出。

## 10. Human Approval / Apply Gate

以下内容不得静默生效：

- 新增或修改真实 skill。
- 修改全局或用户级 rule。
- 替换或归档已有 knowledge。
- 删除已有长期 memory。
- 高风险安全相关规则。

这些内容必须进入 proposal，等待用户确认。

## 11. 自检要求

每次治理 prompt、治理结果、设计文档或实现汇报完成前，必须自检：

1. 是否覆盖用户刚刚纠正的边界。
2. 是否清楚区分 rule / memory / knowledge / skill。
3. 是否说明了为什么这样归类。
4. 是否给出禁止项和反例。
5. 是否给出 schema。
6. 是否说明了哪些需要用户审批。
7. 是否存在缺口、风险和下一步。
8. 是否只是概念，没有落到可执行标准。
