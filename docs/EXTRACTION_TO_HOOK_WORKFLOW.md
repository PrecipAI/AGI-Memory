# AGI-Memory 完整使用姿势：从抽取到硬编码落地

本文档描述 AGI-Memory 系统的完整工作链路：**触发抽取 → Two-Step Dance → 治理运行 → 审批 → 落地为 Hook/Skill**。面向想把 AGI-Memory 接入自己 agent 的开发者。

---

## 全链路总览

```
用户对话（含显式/隐式记忆信号）
  │
  ▼
① 触发抽取 — memory-extract-preview skill
  │  调 POST /internal/host-capture/{host}/governance-batch-preview
  │  返回 mission_brief + preview_token + 规则引擎兜底预览
  │
  ▼
② 宿主模型自己抽取 — 读 mission_brief，按 Four-Layer Protocol 产出候选
  │  宿主是抽取引擎，不是规则引擎
  │
  ▼
③ 治理运行 — memory-governance-run skill
  │  带 preview_token + host_model_result 调 governance-run
  │  服务端硬校验 token → L2 冲突检测 → L3 演进扫描 → L4 认知合成 → 写库
  │
  ▼
④ 审批通知 — memory-governance-review skill
  │  查 governance_change_proposal 表，展示待审批候选
  │  用户 approve / reject
  │
  ▼
⑤ 落地执行 — memory-host-action-execute skill
  │  审批通过的 Rule → 生成 .trae/gates/{rule_key}.hook.ts（GateMaster）
  │  审批通过的 Skill → 生成 .trae/skills/{skill_key}/SKILL.md（Skill Creator）
  │
  ▼
宿主加载 Hook/Skill，下次会话生效
```

---

## ① 触发抽取：memory-extract-preview

### 什么时候触发

| 信号类型 | 示例 | 是否必须触发 |
|----------|------|-------------|
| **显式记忆信号** | "记住 XX" / "请记住" / "必须记住" / "记下来" / "以后别再犯" / "不准再犯" / "这个要存" / "给我记住" | **必须** |
| **隐式记忆信号** | 完成 bug 修复、新功能上线、解决棘手问题后 | 建议触发 |
| **用户主动询问** | "你学到了什么" / "总结一下" / "这次有啥收获" | 建议触发 |

普通对话**不触发**，避免误抽取。

### Step 1：调 preview 端点

```
POST /internal/host-capture/{host}/governance-batch-preview

Headers:
  x-tenant-id: {tenant}
  x-scope: {scope}
  x-trace-id: {trace-id}

Body:
  { "messages": [...] }   # 会话历史（可选，codex/qoder 路由会自动从本地读取）
```

`{host}` 取值：`codex` / `qoder` / `trae` / `unknown`（通用路由）。

### 返回结构（关键字段）

```json
{
  "mission_brief": {
    "text": "...",              // Four-Layer Extraction Protocol 指令（见下文）
    "governance_mode": "host_model"
  },
  "preview_token": {
    "token_id": "uuid",         // ← 必须在 Step 2 原样带回
    "expires_at": "ISO-8601",   // 10 分钟后过期
    "session_fingerprint": "sha256-hex",
    "message_count": 42
  },
  "extraction_preview": {       // 规则引擎兜底预览，仅参考
    "rule_candidates": [],
    "memory_candidates": [],
    "skill_proposal_candidates": [],
    "knowledge_candidates": [],
    "governance_evidence_candidates": [],
    "layer_links": []
  }
}
```

**关键提醒**：
- `preview_token` **10 分钟过期**，过期需重新调 Step 1
- `preview_token` **一次性**，同一个 token 只能用于一次 governance-run
- `extraction_preview` 是规则引擎兜底产物，**质量有限**。真正的抽取由你（宿主模型）根据 `mission_brief` 自己完成

---

## ② 宿主模型自己抽取

### mission_brief.text 里有什么

`mission_brief.text` 由 4 个 section 拼接：

1. **session.mission_brief** — 当前会话的统计摘要（用户指令数、失败事件数、突破点数等）
2. **FOUR_LAYER_PROTOCOL** — 四层提取防坍塌协议（核心指令）
3. **HOST_MODEL_RESULT_SCHEMA** — 你必须输出的 JSON Schema
4. **buildDirective** — 必须执行的下一步动作指令

### 四层分类决策树

对每一条候选，依次问自己：

1. 它描述的是**用户是谁**（背景、偏好、风格、习惯）？ → **Memory**（用户画像）
2. 它教会 AI 某个**让它更聪明的洞察**？ → **Knowledge**（认知进化）
3. 它封装了一个**经验证可复用的多步骤流程**？ → **Skill**（流程封装）
4. 它表达了一条**AI 必须遵守的行为边界**？ → **Rule**（行为约束）
5. 它只是原始执行数据、工具输出或事实观察？ → **Evidence**（证据层）

不属于任何层 → 直接丢弃。宁可空数组，不要强行归类。

### 各层质量门控（关键约束）

#### Memory（用户画像）
- **必须是关于人的**，不是关于代码的
- **一月后还值得知道** — 临时实现细节不算
- 字段：`strictness`（`hard_rule` 用户明确表达 / `soft_preference` 推断倾向）

GOOD: `{ "title": "用户沟通风格偏好", "content": "用户偏好简洁直接的回答，讨厌废话", "strictness": "hard_rule" }`
BAD: `{ "title": "端口改成 8080", "content": "..." }`（实现细节 → Evidence）

#### Knowledge（认知进化）
- **双重门槛**：①模型 OOD（超出训练分布）②会复用（未来真用得上）
- **来源隔离**：禁止把对话内部讨论/决策直接抽成 Knowledge
- **有效半径**：换一个项目这条还成立吗？包含项目特定名词的不算

GOOD: `{ "title": "Zod catchall 静默数据丢失陷阱", "content": "Zod catchall schemas 在 JSON-RPC 序列化时静默剥离嵌套字段", "avoid_pitfall": "IF 定义 MCP tool schema THEN 必须使用 strict typed Zod schema" }`
BAD: `{ "title": "我们决定改数据库连接字符串", "content": "..." }`（项目内部决策 → Memory）

#### Skill（流程封装）
- **必须 ≥ 2 个原子动作**，单步命令不是 Skill
- **换通用词可执行**（全局级必须剥离项目名词）
- 字段：`execution_steps`（String[]，每个元素不可再分的原子动作）

GOOD: `{ "execution_steps": ["检查 Node 版本", "生成 PM2 ecosystem.config.cjs", "验证 /healthz 端点"] }`
BAD: `{ "execution_steps": ["运行 npm install"] }`（单步命令 → 不是 Skill）

#### Rule（行为约束）
- **抹掉项目名词还成立** — 代码硬编码约束不算 Rule（降级到 Memory）
- **宿主层应该拦截的，不是代码层硬编码的**
- `content` 必须能翻译为 IF-THEN 伪代码

GOOD: `{ "content": "IF [用户说 '不要废话'] THEN MUST [给出简洁直接的回答]; MUST NOT [使用列表或过度格式化]" }`
BAD: `{ "content": "INSERT 必须设 origin_scope='global'" }`（代码硬编码 → Memory）

### 作用域感知协议

| origin_scope | 具体性要求 | 示例 |
|--------------|-----------|------|
| `project` | 保留具体变量名、文件名、路径、端口号 | "修改 D-404次列车设定.txt 时核对反噬来源" |
| `global` | 剥离所有领域特定名词，纯逻辑骨架 | "将悬置状态物化为持久化追踪对象" |
| `user` / `workspace` / `team` | 介于两者之间 | — |
| `session` | 保留所有原始信息 | — |

**安全审计**：所有作用域都必须剥离 token/key → `[SECRET]`。

### 你必须输出的 JSON

```json
{
  "extraction_preview": {
    "rule_candidates": [{
      "candidate_type": "rule_candidate",
      "title": "IF [触发条件] THEN MUST/MUST NOT [行为约束]",
      "content": "完整的 IF-THEN 规则",
      "rule_id": "UPPER_SNAKE_CASE 唯一标识",
      "source_excerpt": "触发该规则的用户原话",
      "source_kind": "user_message | assistant_message | command | tool | mcp",
      "source_timestamp": "ISO-8601",
      "origin_scope": "session | project | workspace | user | team | global",
      "availability_scope": "session_only | project_reusable | workspace_reusable | user_reusable | team_reusable | global_reusable",
      "governance_level": "session | shared",
      "reason": "为什么需要这条规则（中文）",
      "confidence": "high | medium | low"
    }],
    "memory_candidates": [{
      "candidate_type": "memory_candidate",
      "title": "用户画像事实",
      "content": "用户偏好/背景/工作习惯描述",
      "strictness": "hard_rule | soft_preference",
      "source_excerpt": "...",
      "source_kind": "...",
      "source_timestamp": "...",
      "origin_scope": "...",
      "availability_scope": "...",
      "governance_level": "...",
      "reason": "...",
      "confidence": "..."
    }],
    "knowledge_candidates": [{
      "candidate_type": "knowledge_candidate",
      "title": "认知洞察标题",
      "content": "使 AI 更聪明的综合洞察（含因果推理）",
      "avoid_pitfall": "IF [条件] THEN [后果] — 必须避免的具体错误",
      "synthesis_reasoning": "如何从原始观察中提炼出该洞察",
      "knowledge_type": "external_fact | method | pattern | principle | comparison | limitation | trend | synthesis | counterexample",
      "source_excerpt": "...",
      "source_kind": "...",
      "source_timestamp": "...",
      "origin_scope": "project | team | global",
      "availability_scope": "project_reusable | team_reusable | global_reusable",
      "governance_level": "shared",
      "reason": "...",
      "confidence": "..."
    }],
    "skill_proposal_candidates": [{
      "candidate_type": "skill_proposal_candidate",
      "title": "流程名称（动宾短语）",
      "content": "触发条件和使用场景描述",
      "description": "技能描述：做什么 + 何时触发",
      "applicable_scenarios": ["场景一", "场景二"],
      "non_applicable_scenarios": ["非适用场景一"],
      "execution_steps": ["1. 原子动作一", "2. 原子动作二", "3. 原子动作三"],
      "validation_method": "如何验证此技能正确执行",
      "source_excerpt": "...",
      "source_kind": "...",
      "source_timestamp": "...",
      "origin_scope": "...",
      "availability_scope": "...",
      "governance_level": "...",
      "reason": "...",
      "confidence": "..."
    }],
    "governance_evidence_candidates": [{
      "candidate_type": "governance_evidence_candidate",
      "title": "证据标题",
      "content": "原始事实或观察",
      "source_excerpt": "...",
      "source_kind": "...",
      "source_timestamp": "...",
      "origin_scope": "session | project",
      "availability_scope": "session_only | project_reusable",
      "governance_level": "session",
      "reason": "该证据支撑了哪些上层候选",
      "confidence": "..."
    }]
  }
}
```

**语言要求**：所有字段必须用中文（技术术语如库名、协议名可保留英文）。

---

## ③ 治理运行：memory-governance-run

### Step 2：带 token + host_model_result 调 governance-run

```
POST /internal/host-capture/{host}/governance-run

Headers:
  x-tenant-id: {tenant}
  x-scope: {scope}
  x-trace-id: {trace-id}

Body:
{
  "governance_mode": "host_model",
  "preview_token": "{Step 1 返回的 token_id}",       // ← 必填
  "host_model_result": {                              // ← 必填
    "model_ref": "claude-sonnet-4.5",
    "extraction_preview": {
      "rule_candidates": [...],
      "memory_candidates": [...],
      "skill_proposal_candidates": [...],
      "knowledge_candidates": [...],
      "governance_evidence_candidates": [...],
      "layer_links": [...]
    }
  }
}
```

### Token 硬校验（服务端）

服务端会校验 preview_token，失败直接拒绝（不进 quarantine）：

| 错误码 | 含义 | 处理 |
|--------|------|------|
| `PREVIEW_TOKEN_MISSING` | 没传 preview_token | 重新调 Step 1 |
| `PREVIEW_TOKEN_NOT_FOUND` | token 不存在或已被消费 | 重新调 Step 1（token 一次性） |
| `PREVIEW_TOKEN_EXPIRED` | token 超过 10 分钟 | 重新调 Step 1 |
| `PREVIEW_TOKEN_CONTEXT_MISMATCH` | token 的 session 上下文对不上 | 重新调 Step 1，确保两步同 session |
| `PREVIEW_TOKEN_PREFIX_VIOLATION` | Step 2 会话内容不是 Step 1 的超集 | 重新调 Step 1，不要在两步间替换/删除消息 |
| `HOST_MODEL_RESULT_MISSING` | 没传 host_model_result.extraction_preview | 填上你的抽取结果再调 |

### 治理管线（服务端自动执行）

```
你的 host_model_result
  │
  ▼
L2 冲突检测 — similarity ≥ 0.96 丢弃重复；0.50-0.96 合并
  │
  ▼
L3 演进扫描 — 检测 UNUSED / CONFLICT / DRIFT 等演进信号
  │
  ▼
L4 认知合成 — 跨事实归纳推理，合成新 Knowledge（需通过 OOD + 可复用门槛）
  │
  ▼
layer_links 写入 — 跨层派生关系（derived_from / explains / constrains / provenance）
  │
  ▼
持久化到 rule / memory / skill / knowledge / governance_evidence 表
  │
  ▼
生成 governance_change_proposal（status='recorded'，等待审批）
```

### 返回结构

```json
{
  "pipeline": {
    "l2": { "skipped_count": 2, "merged_count": 1, "conflict_proposal_count": 0 },
    "l3": { "signals_count": 3, "relations_count": 1 },
    "l4": { "hypotheses_count": 1, "synthesized_knowledge_ids": ["..."] }
  },
  "persisted": {
    "rule_ids": ["..."],
    "memory_ids": ["..."],
    "skill_ids": ["..."],
    "knowledge_ids": ["..."]
  }
}
```

**关键提醒**：
- **不要传 `governance_mode: "rules_fallback"`** — 那是调试模式，产出的候选全部进 quarantine（`recall_state='audit_only'`），永远不会被召回
- **不要直接拿 Step 1 的 `extraction_preview` 当 `host_model_result`** — 那是规则引擎兜底产物，你应该根据 `mission_brief` 自己抽取

---

## ④ 审批：memory-governance-review

### 治理运行完成后自动触发

### 查询待审批候选

```
GET /internal/governance/change-proposals?status=recorded&limit=50

Headers:
  x-tenant-id: {tenant}
  x-scope: {scope}
```

### 返回结构

```json
{
  "items": [
    {
      "id": "proposal-uuid",
      "target_object_type": "rule",
      "proposed_action": "create_rule",
      "proposed_payload": { "rule_key": "host-rule-xxx", "title": "...", "statement": "..." },
      "reason": "用户明确要求记住 XX",
      "risk_level": "medium"
    }
  ]
}
```

### 审批操作

```
POST /internal/governance/change-proposals/{proposalId}/actions

Body:
  { "action": "approve", "payload": { "feedback": "同意" } }
  # 或
  { "action": "reject", "payload": { "feedback": "不需要" } }
```

### proposed_action 类型对照表

| proposed_action | 用途 | 审批通过后是否进入 host-actions 队列 |
|-----------------|------|-------------------------------------|
| `create_rule` | 新建 Rule | ✅ → 生成 `.hook.ts` |
| `replace_rule` | 替换/升级 Rule 版本 | ✅ → 生成 `.hook.ts` |
| `create_conflicting_rule` | 创建冲突 Rule | ✅ → 生成 `.hook.ts` |
| `skill_update_proposal` | 增量更新 Skill | ✅ → 生成 `SKILL.md` |
| `replace_skill` | 替换 Skill 版本 | ⚠️ **当前代码未写入 host_action**（可能是 bug） |
| `replace_memory` | 替换 Memory | ❌ Memory 不需要落地为文件 |
| `drop_duplicate_memory` | 丢弃重复 Memory | ❌ |
| `mark_rule_dirty_for_conflict` | 标记 Rule 为 dirty | ❌ |
| `mark_skill_dirty_for_fingerprint_drift` | 标记 Skill 为 dirty | ❌ |
| `l2_conflict_*` | L2 冲突检测产物 | ❌（更新冲突状态） |
| `l3_evolution_*` | L3 演进信号 | ❌（记录信号） |

### 审批通过后发生什么

1. `governance_change_proposal.status` 从 `recorded` → `resolved`
2. `governance_change_proposal.human_decision` 设为 `approved`
3. 对应的 rule/skill 记录写入 DB
4. **rule 类**：`rule.metadata.host_action` 设为 `{ skill: "gate-master", status: "pending" }`
5. **skill 类**（仅 `skill_update_proposal`）：`skill.procedure_payload.host_action` 设为 `{ skill: "skill-creator", status: "pending" }`
6. 重建 resident_snapshot + 同步索引
7. 返回 `post_approval_action`（建议宿主调用 memory-host-action-execute）

---

## ⑤ 落地执行：memory-host-action-execute

### 审批通过后自动触发（或用户说"生成硬编码""执行落地"）

### 执行落地

```
POST /internal/host-actions/execute

Headers:
  x-tenant-id: {tenant}
  x-scope: {scope}

Body:
  { "limit": 100 }
```

### 服务端执行逻辑

服务端拉取所有 `host_action.status='pending'` 的 rule/skill，逐条处理：

**Rule 类**（GateMaster 逻辑）：
1. 从 `rule.metadata.host_action` 读取 pending 状态
2. 生成 `.trae/gates/{rule_key}.hook.ts`（实现 RuleHook 接口）
3. 确保 `.trae/gates/types.ts` 存在（首次自动创建）
4. 更新 `.trae/gates/registry.json`（按 rule_key 去重，upsert）
5. `host_action.status` → `generated`

**Skill 类**（Skill Creator 逻辑）：
1. 从 `skill.procedure_payload.host_action` 读取 pending 状态
2. 判断作用域：
   - 全局技能（`origin_scope=global/team` + `availability_scope=global_reusable/team_reusable`）→ `~/.trae-cn/skills/{skill_key}/SKILL.md`
   - 项目技能 → `.trae/skills/{skill_key}/SKILL.md`
3. 生成 SKILL.md（frontmatter + 描述 + 使用场景 + 执行步骤 + 触发条件 + 作用域）
4. `host_action.status` → `generated`

### 返回结构

```json
{
  "total": 3,
  "succeeded": 3,
  "failed": 0,
  "items": [
    {
      "object_type": "rule",
      "id": "rule-uuid",
      "key": "host-rule-559acdf65961",
      "status": "generated",
      "output_path": "/path/to/.trae/gates/host-rule-559acdf65961.hook.ts"
    },
    {
      "object_type": "skill",
      "id": "skill-uuid",
      "key": "memory-lifecycle",
      "status": "generated",
      "output_path": "/path/to/.trae/skills/memory-lifecycle/SKILL.md"
    }
  ]
}
```

### 生成产物

| 类型 | 产物路径 | 说明 |
|------|----------|------|
| Rule | `.trae/gates/{rule_key}.hook.ts` | Hook 文件，实现 RuleHook 接口 |
| Rule | `.trae/gates/types.ts` | 共享类型定义（首次自动创建） |
| Rule | `.trae/gates/registry.json` | Hook 注册表（按 rule_key 去重） |
| Skill（全局） | `~/.trae-cn/skills/{skill_key}/SKILL.md` | 全局技能文件 |
| Skill（项目） | `.trae/skills/{skill_key}/SKILL.md` | 项目技能文件 |

**关键提醒**：
- `.trae/` 目录是**运行时产物**，已被 `.gitignore` 忽略
- 生成的 hook 是**模板代码**，`run()` 函数中的检查逻辑需要宿主侧 agent 根据 `statement` 语义补充
- 重复 execute **幂等**，不会重复生成

---

## Hook 文件结构（GateMaster 生成示例）

```typescript
// AUTO-GENERATED by GateMaster — DO NOT EDIT MANUALLY
// Rule: 禁止提交未格式化代码
// Rule Key: host-rule-559acdf65961
// Enforcement: must
// Scope: project / project_reusable

import type { GateContext, HookResult, RuleHook } from "./types";

export const hook: RuleHook = {
  id: "hook_host_rule_559acdf65961",
  rule_id: "59c29a28-f92a-4643-a17c-bd913fb2fea2",
  rule_key: "host-rule-559acdf65961",
  mount_points: ["before_task_complete"],

  shouldRun(context: GateContext): boolean {
    const triggerConditions = { /* 规则的 trigger_conditions */ };
    const appliesTo = ["coding"];
    if (Array.isArray(appliesTo) && appliesTo.length > 0) {
      return appliesTo.includes(context.taskType) || appliesTo.includes(context.operation);
    }
    return true;
  },

  async run(context: GateContext): Promise<HookResult> {
    // Rule statement: IF 提交代码 THEN 必须先运行 formatter
    // TODO: 根据 statement 翻译为具体的检查逻辑
    return { action: "PASS" };
  }
};
```

### Hook 挂载点

| 挂载点 | 触发时机 |
|--------|----------|
| `before_tool_call` | 模型调用任何工具之前 |
| `after_tool_call` | 模型调用工具之后 |
| `before_generation` | 模型生成输出之前 |
| `after_generation` | 模型生成输出之后 |
| `before_task_complete` | 任务标记完成之前（最常用） |
| `before_file_write` | 文件写入之前 |
| `after_file_write` | 文件写入之后 |
| `before_command_exec` | 命令执行之前 |
| `after_command_exec` | 命令执行之后 |
| `pre_commit` | git commit 之前 |

### HookResult.action 取值

| action | 含义 |
|--------|------|
| `PASS` | 检查通过，继续执行 |
| `REJECT` | 检查失败，阻止当前操作 |
| `RETRY` | 检查失败，要求重试 |
| `INJECT` | 注入额外上下文后继续 |

### registry.json 格式

```json
{
  "gates": [
    {
      "id": "hook_host_rule_559acdf65961",
      "rule_id": "59c29a28-f92a-4643-a17c-bd913fb2fea2",
      "rule_key": "host-rule-559acdf65961",
      "file": "host-rule-559acdf65961.hook.ts",
      "mount_points": ["before_task_complete"]
    }
  ]
}
```

---

## SKILL.md 文件结构（Skill Creator 生成示例）

```markdown
---
name: Node 服务部署流程
description: 当用户要求部署 Node.js 服务到服务器时执行的标准化流程
---

# Node 服务部署流程

## 描述

当用户要求部署 Node.js 服务到服务器时执行的标准化流程

## 使用场景

- 用户要求部署 Node.js 服务
- 需要配置 PM2 + systemd 自动重启

## 不适用场景

- 静态网站部署（用 nginx 即可）

## 指令

1. 检查目标主机的 Node 版本兼容性
2. 生成 PM2 ecosystem.config.cjs
3. 写入 systemd service 配置实现自动重启
4. 验证 /healthz 端点返回 200

## 触发条件

```json
{
  "task_types": ["deployment"],
  "applies_to_phase": ["integration"]
}
```

## 作用域

- Origin scope: global
- Availability scope: global_reusable
- 全局技能 — 严禁引用项目特定名称、角色名、文件路径
```

---

## host_action 状态机

```
pending  ──── executeHostActions 成功 ────→  generated
   │
   └──── executeHostActions 失败 ────→  failed
```

| 状态 | 含义 |
|------|------|
| `pending` | 审批已通过，等待宿主执行落地 |
| `generated` | `.hook.ts` 或 `SKILL.md` 已成功生成 |
| `failed` | 执行落地失败（error 字段记录原因） |
| `done` | 预留终态（当前代码无显式写入路径） |

**注意**：`approved`/`rejected` 不是 host_action 的状态，是 `governance_change_proposal.human_decision` 的取值。

---

## 完整 API 路径汇总

### 抽取与治理

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/internal/host-capture/{host}/governance-batch-preview` | Step 1：拿 mission_brief + preview_token |
| POST | `/internal/host-capture/{host}/governance-run` | Step 2：带 token + host_model_result 写库 |
| POST | `/internal/host-capture/codex/governance-batch-preview` | codex 专用 Step 1 |
| POST | `/internal/host-capture/codex/governance-run` | codex 专用 Step 2 |

### 审批

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/internal/governance/change-proposals?status=recorded` | 查询待审批候选 |
| POST | `/internal/governance/change-proposals/{id}/actions` | approve / reject |
| POST | `/internal/governance/change-proposals/{id}/regenerate` | 反馈后重新生成 |
| GET | `/internal/governance/pipeline-summary` | L2/L3/L4 治理管线汇总 |

### Host Actions 队列

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/internal/host-actions/pending` | 查询待执行的 host-action |
| POST | `/internal/host-actions/execute` | 批量消费队列，生成 .hook.ts / SKILL.md |
| POST | `/internal/host-actions/{objectType}/{id}/status` | 更新 host-action 状态 |

---

## 目录结构

```
项目根/
├── skills/                              # Skill 源码定义（提交到 Git）
│   ├── memory-extract-preview/SKILL.md
│   ├── memory-governance-run/SKILL.md
│   ├── memory-governance-review/SKILL.md
│   ├── memory-host-action-execute/SKILL.md
│   ├── GateMaster/SKILL.md
│   ├── skill-creator/SKILL.md
│   └── ...
├── .trae/                               # 运行时产物（.gitignore 忽略）
│   ├── gates/                           # GateMaster 生成
│   │   ├── registry.json
│   │   ├── types.ts
│   │   └── {rule_key}.hook.ts
│   └── skills/                          # Skill Creator 生成（项目级）
│       └── {skill_key}/SKILL.md
└── ~/.trae-cn/skills/                   # Skill Creator 生成（全局级）
    └── {skill_key}/SKILL.md
```

**源码定义 vs 运行时产物**：
- `skills/` 是源码定义，是 AGI-Memory 项目自身 11 个 skill 的完整定义
- `.trae/skills/` 是运行时产物，由 `host-actions/execute` 根据审批通过的 skill 候选自动生成
- 两者关系：源码定义是"模板"，运行时产物是"实例化后的结果"

---

## 常见坑

### 1. 走了 rules_fallback 模式，候选全部进 quarantine

**症状**：治理运行返回成功，但 `memory_retrieve_context` 召回不到任何东西。

**根因**：没传 `governance_mode='host_model'` 或没传 `host_model_result`，服务端默认 host_model 但走 fallback 分支，所有候选 `recall_state='audit_only'`，永远不进召回。

**修复**：严格走 Two-Step Dance，Step 1 拿 token，Step 2 带 token + host_model_result。

### 2. preview_token 过期或被消费

**症状**：Step 2 报 `PREVIEW_TOKEN_NOT_FOUND` 或 `PREVIEW_TOKEN_EXPIRED`。

**根因**：token 10 分钟过期，且一次性消费。

**修复**：重新调 Step 1 拿新 token。

### 3. replace_skill 审批通过后没生成 SKILL.md

**症状**：`replace_skill` 类型的候选审批通过，但 host-actions 队列里没有。

**根因**：当前代码 `replace_skill` 分支未写入 `host_action`（可能是 bug，只有 `skill_update_proposal` 才会写入）。

**修复**：手动触发或确认 proposed_action 是 `skill_update_proposal`。

### 4. 生成的 hook 是模板，run() 直接返回 PASS

**症状**：审批通过的 Rule 生成了 `.hook.ts`，但实际执行时没拦截任何东西。

**根因**：GateMaster 生成的 hook 是模板代码，`run()` 函数只有 TODO 注释，需要宿主侧 agent 根据 `statement` 语义补充检查逻辑。

**修复**：宿主侧 agent 读取生成的 hook 文件，根据 `statement` 翻译为具体的检查代码。

### 5. 全局技能生成到了项目目录

**症状**：`origin_scope=global` 的 skill 生成到了 `.trae/skills/` 而不是 `~/.trae-cn/skills/`。

**根因**：判断逻辑要求 `origin_scope` 是 `global`/`team` **且** `availability_scope` 是 `global_reusable`/`team_reusable`，两个条件都要满足。

**修复**：抽取时确保两个字段都正确设置。
