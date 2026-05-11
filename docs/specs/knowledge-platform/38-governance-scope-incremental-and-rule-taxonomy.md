# 治理作用域、增量记录与 Rule 分类补充规范

对应项目：
- `D:\workspace\projects\SuperAgentSystem-main`

## 1. 背景

治理层不能只处理“某个会话里抽出了什么”，还必须判断这些治理产物是否应该跨会话可用。

否则会出现两类问题：

- 本来只属于当前会话的临时信息，被写成全局长期层，污染后续会话。
- 本来应该跨会话继承的规则、记忆、skill 提案没有升格，新开会话读不到。

## 2. 作用域字段

所有治理候选与长期产物至少带以下字段：

```ts
origin_scope: "session" | "project" | "workspace" | "user" | "team" | "global"
governance_level: "session" | "shared"
availability_scope:
  | "session_only"
  | "project_reusable"
  | "workspace_reusable"
  | "user_reusable"
  | "team_reusable"
  | "global_reusable"
promotion_status: "candidate" | "active" | "needs_review" | "rejected"
source_thread_id: string
source_session_file: string
```

语义：

- `origin_scope`：这条内容最初从哪个范围产生。
- `governance_level`：二分读取层级。`session` 表示只属于当前会话；`shared` 表示整体级，所有符合范围的会话都能读取或检索。
- `availability_scope`：后续上下文装配能在哪个范围读取它。
- `promotion_status`：它当前是否已经生效，还是只作为候选/待审查。

## 3. 默认升格规则

- `governance_evidence` 默认 `session_only / candidate`，只在治理时读取。
- `governance_evidence` 默认 `governance_level = session`。
- 工作区路径、机器环境、项目路径默认 `governance_level = shared / workspace_reusable / active`。
- 项目架构、项目治理设计默认 `governance_level = shared / project_reusable / active`。
- 用户对 agent 的长期偏好和硬约束默认 `governance_level = shared / user_reusable / active`。
- `skill_proposal` 默认 `governance_level = shared / needs_review`，即使跨会话可见，也不能直接修改真实 skill。
- `knowledge` 只能来自外部通用知识；内部项目/用户/机器上下文不得进入 knowledge。

## 4. 增量治理

治理输入来自：

- 会话记录
- 任务执行全记录
- 已有长期层

增量比较不得只依赖会话文件修改时间，而应以候选事件哈希为准：

```text
host + thread_id + session_file + candidate_type + source_kind + source_timestamp + title + content/proposed_text + source_excerpt
-> event_hash
```

每次治理：

1. 读取完整会话和执行记录。
2. 构造候选事件。
3. 写入 `host_governance_event`。
4. 如果 `event_hash` 已存在，说明该候选已经治理过，本轮跳过。
5. 如果同一会话追加了新消息或新执行记录，只治理新增候选。

这样既支持单会话增量，也支持未来“扫描全部会话”的批处理。

## 5. Rule 分类

`rule` 不应是平铺列表，必须带分类字段：

```ts
rule_domain:
  | "design"
  | "execution"
  | "governance"
  | "memory"
  | "skill"
  | "tooling"
  | "reporting"
  | "safety"
  | "integration"
rule_scope: "session" | "project" | "workspace" | "user" | "team" | "global"
```

用途：

- 抽取时减少误分类。
- 召回时按任务类型读取相关规则。
- 执行时让 rule gate 能只检查当前阶段相关规则。

## 6. 新会话读取原则

新会话只能读取：

- 当前会话自己的工作上下文。
- `availability_scope` 覆盖当前上下文的长期层。
- `promotion_status = active` 的 rule/memory/knowledge。
- `promotion_status = needs_review` 的 skill proposal 只用于审查，不直接执行。

新会话不能读取：

- 其他会话的 `session_only` 治理证据。
- 未升格的 session 候选。
- 已拒绝或已废弃内容。

## 7. 宿主模型治理接入

接入 Codex、Claude Code、OpenClaw、opencode 等宿主时，治理层不直接绑定服务端大模型。

正式链路：

```text
Host Agent Model
-> 读取宿主会话记录、任务执行全记录、工具/MCP 结果、已有长期层
-> 生成 host_model_result.extraction_preview
-> memory-service 校验 schema
-> 按 event_hash 增量去重
-> 按 normalized_content 过滤已有长期事实
-> 写入 rule / memory / skill_proposal / knowledge / governance_evidence
-> Console 回显和人工审查
```

服务端规则 fallback 的定位：

- 无模型环境下的兜底。
- 测试链路和 schema 验证。
- 不作为最终治理质量上限。

host model 输出 contract：

```ts
governance_mode: "host_model"
host_model_result: {
  model_ref: string
  generated_at?: string
  extraction_preview: {
    rule_candidates: GovernanceCandidate[]
    memory_candidates: GovernanceCandidate[]
    skill_proposal_candidates: GovernanceCandidate[]
    knowledge_candidates: GovernanceCandidate[]
    governance_evidence_candidates: GovernanceCandidate[]
  }
}
```

约束：

- `skill_proposal` 必须有 `target_skill / current_gap / proposed_text`，否则拒绝。
- 所有 candidate 必须带 `origin_scope / governance_level / availability_scope / promotion_status`。
- 内部项目、用户、机器、会话信息不能进入 `knowledge`。
- `governance_evidence` 默认 `session / session_only / candidate`。
- 宿主模型可以提升治理质量，但最终写入仍由服务端 contract 和去重策略约束。

## 8. 当前实现状态

已落地：

- `host_governance_event` 增量事件表。
- `rule / memory / governance_change_proposal` 作用域字段。
- `rule_domain / rule_scope` 分类字段。
- host capture governance run 按事件哈希跳过已治理候选。
- acceptance report 返回新增候选数和跳过候选数。
- `governance_mode=host_model` 接收宿主模型治理结果。
- `host_model_result.extraction_preview` schema 校验。
- 缺失关键字段的 skill proposal 会被拒绝。
- 已有长期 factual memory 会按 `normalized_content` 跳过，避免重复 promoted。
- 统一 host capture 入口：
  - `GET /internal/host-capture/:host/sessions`
  - `POST /internal/host-capture/:host/preview`
  - `POST /internal/host-capture/:host/governance-batch-preview`
  - `POST /internal/host-capture/:host/governance-run`
- 已支持宿主标识：`codex / claude-code / openclaw / opencode`。
- `claude-code / openclaw / opencode` 当前走通用 JSONL/JSON 记录读取器，可通过 `host_home` 指向真实宿主记录目录。
- 已有 fixture 验证覆盖 `claude-code / openclaw / opencode` 的会话读取、命令证据读取、host model 治理结果落库。

仍需后续扩展：

- 多宿主统一批处理入口。
- Claude Code / OpenClaw / opencode 的官方原生记录格式专项适配；当前通用 JSONL/JSON 读取器可用于已暴露记录文件或 wrapper 导出的记录。
- 根据 `availability_scope` 的上下文装配 API 细化。
