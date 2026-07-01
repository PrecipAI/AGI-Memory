# AGI-Memory 使用说明书

> 给想把 AGI-Memory 接进自己 agent 的开发者看的。README 是项目门面，这份是操作手册——讲清楚两种数据的区别、用户怎么接入自己的宿主、全链路怎么走通、哪些能用哪些是壳子、怎么避坑。

## 0. 最重要：演示数据 vs 用户数据（先看这个）

**这是整份说明书最容易踩的坑，必须先讲清楚。**

AGI-Memory 里的数据分两种来源，性质完全不同：

| 数据类型 | 来源 | 作用 | 能不能改 |
|---------|------|------|---------|
| **演示数据（hostBootstrap）** | 我们 TRAE 宿主硬编码在 [hostBootstrap.ts](services/memory-service/src/hostBootstrap.ts) | 服务启动时自动注册，**让仪表盘一打开就有东西看**，证明系统能跑 | 不能，这是我们的演示用例 |
| **用户数据（host/mount）** | 用户自己的宿主程序通过 `POST /internal/host/mount` 推送 | 用户把自己宿主的 skill/memory/rule 注册进来，**这才是真实业务数据** | 能，用户自己控制 |

### 演示数据长啥样

服务启动时 `onReady` 钩子调 `registerHostBootstrap()`，幂等写入：

- **50 个 skill**：TRAE 自带的能力（飞书全家桶、memory 治理流程、TRAE 产品知识等）
- **8 条 memory**：TRAE 工作空间约定（简体中文、Windows 工具映射、修复影响检查等）
- **5 条 rule**：TRAE 强制规则（语言/安全/任务性质/Graphify 优先）

**这些是 TRAE 宿主的演示数据，不是用户的。** 用户接入时，这些演示数据可以留着参考，也可以清掉只用自己的。

### 用户数据怎么进来

用户通过 `POST /internal/host/mount` 推送自己宿主的数据：

```http
POST /internal/host/mount
Content-Type: application/json
x-tenant-id: tenant-用户的租户
x-scope: 用户的scope

{
  "skills": [
    {
      "skill_key": "my-custom-skill",
      "title": "我的自定义技能",
      "description": "在 XXX 场景下做 YYY",
      "skill_type": "procedural",
      "trigger_conditions": { ... },
      "procedure_payload": { ... },
      "risk_level": "low",
      "tags": ["custom"]
    }
  ],
  "memories": [
    {
      "memory_type": "project_memory",
      "title": "我的项目约定",
      "content": "在这个项目里我们用 XXX 框架，禁止 YYY",
      "importance": 80,
      "tags": ["convention"]
    }
  ],
  "rules": [
    {
      "rule_key": "my-project-no-force-push",
      "title": "禁止 force push 到 main",
      "statement": "IF 目标分支是 main THEN MUST NOT 执行 git push --force",
      "enforcement_level": "must",
      "priority": "P0",
      "risk_level": "high",
      "applies_to": ["coding", "git"]
    }
  ]
}
```

**幂等**：重复推送不会产生重复数据，内容变化会版本递增。

### 两种数据的隔离

| 维度 | 演示数据 | 用户数据 |
|------|---------|---------|
| tenant_id | `default` | 用户自己的 tenant_id |
| scope | `host-bootstrap` | 用户自己的 scope |
| 可见性 | 所有租户都能看到（演示用） | 只在用户自己的 tenant/scope 可见 |
| 清理 | 重启会重新注册（幂等） | 用户自己控制生命周期 |

**用户接入时建议**：用自己的 tenant_id + scope，跟演示数据隔离开。想清掉演示数据可以删 `tenant_id='default' AND scope='host-bootstrap'` 的记录。

---

## 1. 这份说明书给谁看

| 角色 | 看哪几节 |
|------|---------|
| 想体验下架构的访客 | 第 2 节 + 第 3 节「模式 A：纯前端 Demo」 |
| 想本地跑后端的开发者 | 第 3 节「模式 B」+ 第 11 节部署 |
| **想把记忆系统接进自己 agent 的集成方** | **第 0 节 + 第 4 节宿主接入 + 第 5 节 MCP 工具 + 第 7 节全链路** |
| 想做二次开发的贡献者 | 第 6 节资产清单 + 第 10 节端点 + 第 12 节验证 |

## 2. 能力地图（一张表看完）

| 维度 | 数量 | 说明 |
|------|------|------|
| **MCP 工具** | 8 个 | 通过 memory-mcp-server (stdio) 暴露给宿主 agent |
| **MCP 资源** | 2 个 | `memory://health`、`memory://defaults` |
| **HTTP 端点** | 57 个 | memory-service 内部 API + 静态资源（含 3 个新端点） |
| **演示 skill（TRAE 自带）** | 50 个 | hostBootstrap 启动时注册，**演示用，非用户数据** |
| **演示 memory（TRAE 自带）** | 8 条 | 同上 |
| **演示 rule（TRAE 自带）** | 5 条 | 同上 |
| **用户数据入口** | 1 个 | `POST /internal/host/mount`，用户推送自己的 skill/memory/rule |
| **数据库表** | 29 套 migration | 含 `layer_links` 跨层关系表 |
| **治理流水线** | L2 → L3 → L4 | 冲突检测 → 演进扫描 → 认知合成 |
| **治理模式** | 2 种 | `rules_fallback`（无 LLM）/ `host_model`（宿主 LLM 抽取） |
| **落地执行器** | 1 个 | hostActionExecutor：审批后自动生成 .hook.ts / SKILL.md |

## 3. 三种使用模式

### 模式 A：纯前端 Demo（5 秒上手）

直接打开 <https://agi-memory.netlify.app/?demo=1>，URL 上的 `?demo=1` 会拦截所有 `/internal/*` 请求返回 mock 数据。**不需要后端、不需要数据库、不需要 MCP**——纯看洋葱图、仪表盘、治理流水线长啥样。

适合：评审、demo、截图发朋友圈。

### 模式 B：本地后端服务（开发调试）

跑真实的 memory-service + PostgreSQL，能调所有 57 个 HTTP 端点，但**不接 MCP**。前端访问 `http://127.0.0.1:3101/dashboard`。

```powershell
npm install
Copy-Item .env.example .env   # 编辑 .env 设置 DB_URL
$env:DB_URL="postgresql://postgres:postgres@127.0.0.1:5432/super_agent_system"
npm run db:migrate
npm run start:memory-service
```

服务启动会自动幂等注册 50 个演示 skill / 8 条演示 memory / 5 条演示 rule（TRAE 宿主数据，详见第 0 节）。

适合：调试治理流程、看真实数据流、二次开发。

### 模式 C：宿主接入 MCP（真正用起来）

在模式 B 基础上再启动 MCP server，把记忆能力注入 Codex / Claude Code / 任意 MCP 客户端。**用户还需要通过 `POST /internal/host/mount` 推送自己宿主的数据**（详见第 0 节）。这是项目的**主要使用方式**，下面的章节都围绕这个。

## 4. 宿主接入流程（核心章节）

五步走，缺一步都不行。

### Step 1：启动后端服务

见模式 B。验证：

```powershell
curl http://127.0.0.1:3101/healthz
# 期望：{"status":"ok",...}
```

### Step 2：推送用户宿主数据（★ 关键 ★）

**这一步很多集成方会漏掉**。你要把自己宿主的 skill/memory/rule 推送进来，否则系统里只有 TRAE 的演示数据。

```powershell
# 示例：推送用户宿主自己的数据
curl -X POST http://127.0.0.1:3101/internal/host/mount `
  -H "Content-Type: application/json" `
  -H "x-tenant-id: my-tenant" `
  -H "x-scope: my-project" `
  -d '{
    "skills": [...],
    "memories": [...],
    "rules": [...]
  }'
```

字段格式详见第 0 节。幂等：重复推送不会产生重复数据。

### Step 3：初始化 MCP 配置

```powershell
npm run memory-mcp:init
```

生成 `.memory-mcp/config.json` + `.memory-mcp/clients/` 模板目录。模板覆盖：Codex / Claude Code / Claude Desktop / OpenCode / OpenClaw / 通用 MCP 客户端。

### Step 4：健康检查（先别急着装）

```powershell
npm run memory-mcp:doctor
```

doctor 会检查：
- `.memory-mcp/config.json` 是否存在且合法
- `memory-service-url` 是否可达
- node 版本是否 ≥ 20

**doctor 不通过别往下走**，否则装到宿主里也连不上。

### Step 5：安装到具体宿主

目前 `install-host` 只支持两个宿主：

```powershell
# Codex (OpenAI Codex CLI)
npm run memory-mcp:install-host -- --host codex --yes

# Claude Code
npm run memory-mcp:install-host -- --host claude-code --yes
```

`--yes` 是必须的，否则只返回 `NEEDS_APPROVAL` 不写文件。安装会做：

| 宿主 | 写入文件 | 内容 |
|------|---------|------|
| Codex | `~/.codex/config.toml` | `[mcp_servers.memory-v3]` 段（带 `# >>> memory-v3 mcp >>>` 标记） |
| Codex | `./AGENTS.md` | memory-v3 policy 指令块 |
| Claude Code | `./.mcp.json` | `mcpServers.memory-v3` 配置 |
| Claude Code | `./CLAUDE.md` | memory-v3 policy 指令块 |

所有写入都带标记 + 自动备份到 `.memory-mcp-backups/`，可幂等重跑。

### Step 6：手动启动 MCP server（调试用）

```powershell
npm run memory-mcp:start
```

用 stdio transport 启动，挂在当前进程。生产场景下宿主会自己拉起这个进程，不用手动跑。

## 5. MCP 工具速查（8 个工具什么时候用）

| 工具 | 用途 | 何时调用 |
|------|------|---------|
| `memory_health` | 检查 memory-service 是否可达 | 接入前冒烟、排错第一步 |
| `memory_retrieve_context` | 按层装配上下文（rule/memory/skill/knowledge） | **复杂问题回答前自动触发**，必传 `fingerprint_status` |
| `memory_ingest_candidate` | 单条写入验证后的设计决策/修复经验 | 临时塞一条记忆时用，**不要用于批量治理** |
| `memory_query_layer` | 按 `kind` 过滤查单层（resident/factual/procedural/summary/candidate） | 调试、验证写入是否成功 |
| `memory_run_governance` | 跑会话摘要 / resident 重建 / index 同步 / lifecycle | 任务结束后的清理动作 |
| `memory_preview_host_governance` | **Two-Step Dance Step 1**，返回 mission_brief | 用户问「你学到了什么/总结一下」时 |
| `memory_run_full_governance` | **Two-Step Dance Step 2**，提交 extraction_preview 持久化 | Step 1 之后，宿主 LLM 抽取完候选 |
| `rule_gate_check` | 高风险操作前的规则门禁 | 改配置、改治理规则、删数据前**必须**调 |

**关键约束**：
- `memory_retrieve_context` 必传 `fingerprint_status`，procedural memory 需要 `matched` 才返回；不确定时用 `matched_or_na`
- `memory_run_full_governance` **不能跳过 Step 1** 直接调，会缺 mission_brief
- `rule_gate_check` 返回 `block` 或 `ask_user` 时**禁止继续**，必须先解决规则冲突

## 6. 演示数据速查（TRAE 自带，非用户数据）

> ⚠️ **再次强调**：本节列的是 TRAE 宿主的演示数据，**不是用户的**。用户数据通过 `POST /internal/host/mount` 推送，格式见第 0 节。演示数据的作用是让仪表盘开箱即有内容，不表示用户接入后也会有这些。

服务启动时幂等注册，重启不会重复写。所有演示资产挂在 `tenantId=default` + `scope=host-bootstrap`。

### 6.1 演示 Skill 清单（50 个）

| 类型 | 数量 | skill_key 列表 |
|------|------|---------------|
| **generative** | 5 | `frontend-design` / `frontend-skill` / `web-dev` / `algorithmic-art` / `canvas-design` |
| **procedural（基础）** | 5 | `git-commit` / `interview` / `skill-creator` / `GateMaster` / `Skill Creator`(legacy) |
| **procedural（memory 治理）** | 7 | `memory-extract-preview` / `memory-governance-run` / `memory-layer-links-query` / `memory-learning-chain-detect` / `memory-recall-assemble` / `memory-governance-review` / `memory-host-action-execute` |
| **knowledge** | 3 | `TRAE-product-knowledge` / `memory-lifecycle` / `memory-governance-knowledge` |
| **publishing** | 2 | `douyin-interact-creation` / `douyin-interactive-content-publish` |
| **integration** | 28 | `figma` + 27 个 `lark-*`（飞书全家桶） |

**注意**：其中 7 个 `memory-*` procedural skill 是**治理流程触发器**，这些是系统内置的，用户不需要自己写。用户推送的是自己业务相关的 skill（比如"代码审查流程"、"部署流程"等）。

### 6.2 演示 Memory 清单（8 条）

| memory_type | title | 作用 |
|------------|-------|------|
| user_memory | 回复语言约定 | 强制简体中文 |
| user_memory | 事实确认原则 | 不将猜测作为事实 |
| project_memory | 任务性质确认 | 文档任务不动源代码 |
| project_memory | 修复影响检查 | 改动前做三维度影响分析 |
| project_memory | Graphify 使用约定 | 优先读 GRAPH_REPORT.md |
| project_memory | Memory MCP 使用策略 | 何时调 health/retrieve/gate |
| project_memory | Memory 治理触发时机 | 9 种触发场景判定（核心，详见第 7.3 节） |
| workspace_memory | Windows 执行环境 | 工具映射表（Read/Glob/Grep/Edit/Write） |

### 6.3 演示 Rule 清单（5 条）

| rule_key | statement 摘要 | enforcement_level |
|----------|---------------|-------------------|
| `host-reply-language` | 强制简体中文回复 | must |
| `host-fact-confirmation` | 不将猜测作为事实 | must |
| `host-safety-compliance` | 禁止违规输出 | must_not |
| `host-task-nature-confirm` | 文档任务不动源代码 | must |
| `host-graphify-priority` | 优先用 graphify 而非全仓搜索 | must |

## 7. 全链路流程（从对话到落地闭环）

这是本说明书的核心章节。整个记忆系统从用户对话到最终落地为硬编码 rule / 实际 skill 文件，共 10 个环节，分 4 个阶段。

### 7.1 全链路流程图

```
┌─────────────────────────────────────────────────────────────────┐
│ 阶段 0：宿主挂载                                                  │
│   0a. 系统自动注册演示数据（50 skill / 8 memory / 5 rule）        │
│       → tenant=default, scope=host-bootstrap                     │
│   0b. 用户调 POST /internal/host/mount 推送自己的数据             │
│       → tenant=用户自己的, scope=用户自己的                       │
│   → 两套数据隔离共存                                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 阶段 1：日常对话（全自动）                                        │
│   用户问问题                                                     │
│   → agent 自动调 memory_retrieve_context 装配上下文              │
│     （从用户自己的 tenant/scope 取数据，不取演示数据）           │
│   → agent 自动调 rule_gate_check（高风险操作前）                 │
│   → agent 回答                                                   │
│   → 用户无感                                                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 阶段 2：抽取（★ 需要用户介入 ★）                                 │
│                                                                  │
│ 触发条件（满足任一即触发 memory-extract-preview）：               │
│   A. 显式记忆信号：用户说"记住 XX"/"记下来"/"以后别再犯"/         │
│      "这个经验要存"/"记一下这个坑"                               │
│   B. 隐式记忆信号：用户完成一段有价值工作后（修 bug、新功能上线、  │
│      解决棘手问题），或长对话末尾自然总结点                       │
│   C. 用户主动问"你学到了什么 / 总结一下 / 这次有啥收获"           │
│                                                                  │
│   → agent 调 memory_preview_host_governance (Step 1)             │
│   → 返回 mission_brief，agent 抽取候选                            │
│   → 【不写库】只给用户看候选                                      │
│                                                                  │
│ 用户确认后说"存下来 / 治理一下 / 持久化"：                        │
│   → agent 调 memory_run_full_governance (Step 2)                 │
│   → 【写库】候选进 governance_change_proposal 表                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 阶段 3：治理 + 审批 + 落地                                        │
│                                                                  │
│ 3a. L2/L3/L4 流水线（自动，Step 2 内部）                         │
│   → rule_gate_check 门禁                                         │
│   → applyHostModelGovernanceResult 校验候选                      │
│   → filterNew / filterExisting 去重                              │
│   → 持久化 candidate + persistLayerLinks 写跨层关系              │
│   → createKnowledgeContextBundle 生成知识包                      │
│                                                                  │
│ 3b. 审批通知（自动触发 memory-governance-review）                │
│   → agent 调 GET /internal/governance/change-proposals           │
│   → 告知用户"N 条候选待审批"                                     │
│   → 用户回复 approve/reject                                      │
│   → agent 调 POST /internal/governance/change-proposals/{id}/actions │
│                                                                  │
│ 3c. 落地执行（自动触发 memory-host-action-execute）              │
│   → agent 调 POST /internal/host-actions/execute                 │
│   → hostActionExecutor 消费队列：                                │
│     - Rule → 生成 .trae/gates/{rule_key}.hook.ts                │
│     - Skill → 生成 .trae/skills/{skill_key}/SKILL.md            │
│   → 更新 host-actions 状态为 generated                           │
│   → 用户无感                                                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 阶段 4：下次对话（全自动）                                        │
│   用户再问问题                                                   │
│   → agent 调 memory_retrieve_context                             │
│   → 自动看到阶段 2/3 写入的新记忆/规则/知识                      │
│   → rule_gate_check 会查到新生成的 .hook.ts 门控                 │
│   → 用这些信息回答                                               │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 环节级触发方式一览表

| 环节 | 触发方式 | 谁触发 | 写不写库 | 调什么 |
|------|---------|--------|---------|--------|
| 0a. 演示数据注册 | 服务启动 | 系统自动 | 写（50/8/5） | `registerHostBootstrap()` |
| 0b. 用户数据推送 | **用户调 API** | **用户** | 写 | `POST /internal/host/mount` |
| 1. 上下文装配 | 回答前 | agent 自动 | 不写 | MCP `memory_retrieve_context` |
| 1. 规则门禁 | 高风险操作前 | agent 自动 | 写审计 | MCP `rule_gate_check` |
| 2a. 抽取预览 | **用户说"记住/总结/学到了什么"** | **用户** | 不写 | MCP `memory_preview_host_governance` |
| 2b. 治理运行 | **用户说"存下来/治理一下"** | **用户** | 写候选 | MCP `memory_run_full_governance` |
| 3a. L2/L3/L4 流水线 | Step 2 内部 | 系统自动 | 写候选+layer_links | 自动 |
| 3b. 审批通知 | 治理运行后自动 | agent 自动 | 不写 | `memory-governance-review` skill → GET change-proposals |
| 3b. 审批决策 | **用户 approve/reject** | **用户** | 写状态 | `memory-governance-review` skill → POST actions |
| 3c. 落地执行 | 审批通过后自动 | agent 自动 | 写状态+文件 | `memory-host-action-execute` skill → POST host-actions/execute |
| 4. 下次 recall | 回答前 | agent 自动 | 不写 | MCP `memory_retrieve_context` |

### 7.3 抽取触发的完整判定逻辑

**不是只有"总结一下"才触发抽取**。以下是 hostBootstrap 里注册的完整触发条件（9 种场景）：

| # | 场景类型 | 触发信号 | 调用什么 | 写库吗 |
|---|---------|---------|---------|--------|
| 1 | 显式记忆 | 用户说"记住 XX"/"记下来"/"以后别再犯"/"这个经验要存"/"记一下这个坑" | `memory-extract-preview` | 不写 |
| 2 | 隐式记忆 | 用户完成一段有价值工作后（修 bug、新功能上线、解决棘手问题），或长对话末尾自然总结点 | `memory-extract-preview` | 不写 |
| 3 | 主动总结 | 用户问"你学到了什么 / 总结一下 / 这次有啥收获" | `memory-extract-preview` | 不写 |
| 4 | 确认存储 | 用户确认候选后说"存下来 / 治理一下 / 持久化" | `memory-governance-run` | **写** |
| 5 | 审批通知 | 治理运行完成后 | `memory-governance-review` | 不写（查询） |
| 6 | 根因查询 | 用户问"为什么这条规则存在 / 这条记忆的根因" | `memory-layer-links-query` | 不写 |
| 7 | 学习链检测 | 用户跨多工具检索后应用结论 | `memory-learning-chain-detect` | 不写 |
| 8 | 上下文装配 | 复杂问题回答前 | `memory-recall-assemble` | 不写 |
| 9 | 落地执行 | 审批通过后 | `memory-host-action-execute` | **写文件+状态** |

**普通对话不触发任何治理流程**，避免误抽取。

### 7.4 治理 vs 抽取的区别

用户问得最多的一个问题：**抽取和治理到底有啥区别？**

| 维度 | 抽取（Extraction） | 治理（Governance） |
|------|-------------------|-------------------|
| 干啥 | 从对话里提取记忆候选 | 对候选做冲突检测、合并、合成 |
| 触发 | 用户说"记住/总结" | 用户说"存下来/治理一下" |
| 阶段 | Step 1（preview） | Step 2（run）+ L2/L3/L4 |
| 写库 | 不写 | 写 |
| 输出 | 候选列表给用户看 | 持久化到 DB + layer_links |
| 后续 | 用户确认后进治理 | 治理完进审批 → 落地 |

**一句话**：抽取是"看见"，治理是"落地"。

## 8. 两种治理模式对比

| 维度 | `rules_fallback` | `host_model` |
|------|------------------|--------------|
| 适用场景 | 宿主没接 LLM，或不想让宿主抽取 | 宿主有 LLM，自己跑抽取 |
| 抽取方 | 后端用规则启发式抽 | 宿主 LLM 按 Four-Layer Protocol 抽 |
| 提交字段 | 不传 `host_model_result` | 必传 `host_model_result.extraction_preview` |
| candidate 状态 | 强制 `promotion_status='needs_review'` | 通过校验后可进 `active` |
| 数据隔离 | 进 `rules_fallback` 隔离区，**不进 active recall** | 进正常 active recall |
| 推荐用法 | 调试、看流程 | 生产 |

**关键坑**：`rules_fallback` 模式的数据是隔离的，不会出现在 `memory_retrieve_context` 的结果里。如果你跑了治理但 recall 没看到，先检查模式。

## 9. Two-Step MCP Dance 详解

这是 `host_model` 模式的核心流程，**不能跳步**。

### Step 1：`memory_preview_host_governance`

```text
输入：codex_home / thread_id / max_items / task_request_id / fingerprint / governance_mode
输出：mission_brief（压缩的会话证据 + Four-Layer Extraction Protocol 指令）
```

这一步**不写库**，只返回 mission_brief。宿主 LLM 拿到 brief 后按 Four-Layer Protocol 抽取候选，填进 `extraction_preview` 的 5 个数组：
- `rule_candidates`（IF/THEN 硬约束）
- `memory_candidates`（symptom/root_cause/fix_action/future_trigger）
- `skill_proposal_candidates`（参数化技能，必带 `parameters_list`）
- `knowledge_candidates`（Entity-Attribute 客观事实）
- `governance_evidence_candidates`（执行证据）

### Step 2：`memory_run_full_governance`

```text
输入：Step 1 的参数 + governance_mode='host_model' + host_model_result.extraction_preview
输出：rule_gate + host_governance + memory_refresh
```

这一步**写库**。后端会：
1. `rule_gate_check` 门禁（block/ask_user 则中止）
2. `applyHostModelGovernanceResult` 校验候选 schema
3. `filterNew` / `filterExisting` 去重
4. 持久化 candidate
5. `persistLayerLinks` 写跨层关系（`derived_from` / `explains` / `constrains` / `provenance`）
6. `createKnowledgeContextBundle` 生成知识上下文包
7. 可选：`refresh_memory` / `rebuild_resident` / `sync_index` / `run_lifecycle`

**校验失败怎么办**：错误信息里带 `Fix` 和 `Example` 提示，按提示修候选后重试 Step 2，**不用重跑 Step 1**。

## 10. 已补齐的端点（原壳子）

之前的版本有 2 个 skill 是壳子（注册了但底层端点不存在），现已全部补齐。

### 10.1 `memory-layer-links-query`（已补齐）

| 项 | 状态 |
|----|------|
| skill 描述 | 调 `GET /internal/layer-links?source_id=...` 查询跨层派生关系 |
| 端点 | ✅ 已实现：`GET /internal/layer-links` |
| 支持过滤 | source_id / target_id / source_layer / target_layer / link_type / limit |
| 数据来源 | `layer_links` 表（`persistLayerLinks` 写入，本端点读取） |
| 调用示例 | `curl "http://127.0.0.1:3101/internal/layer-links?source_id=xxx&link_type=derived_from"` |

### 10.2 `memory-learning-chain-detect`（已补齐）

| 项 | 状态 |
|----|------|
| skill 描述 | 调 `learningChainDetector` 模块检测学习行为链 |
| 端点 | ✅ 已实现：`POST /internal/learning-chain/detect` |
| 输入 | `{ events: [{ timestamp, kind, payload, status? }] }` |
| 输出 | `{ total_chains, complete_chains, incomplete_chains, chains: [...] }` |
| 检测逻辑 | 30 分钟 search 窗 + 60 分钟 apply 窗 + 终点总结性文本判定，`isComplete=false` 时不硬造 Knowledge |
| 调用示例 | `curl -X POST http://127.0.0.1:3101/internal/learning-chain/detect -d '{"events":[...]}'` |

### 10.3 新增端点：`POST /internal/host-actions/execute`

这是配套新增的落地执行端点，由 `memory-host-action-execute` skill 触发。

| 项 | 状态 |
|----|------|
| 端点 | ✅ 已实现：`POST /internal/host-actions/execute` |
| 作用 | 消费 host-actions 队列，把审批通过的 Rule/Skill 落地为实际文件 |
| Rule 落地 | 生成 `.trae/gates/{rule_key}.hook.ts`（GateMaster 逻辑） |
| Skill 落地 | 生成 `.trae/skills/{skill_key}/SKILL.md`（Skill Creator 逻辑） |
| 执行器 | [hostActionExecutor.ts](services/memory-service/src/hostActionExecutor.ts) |
| 可选参数 | gates_dir / global_skills_dir / project_skills_dir / project_id / limit |

### 10.4 触发硬编码的四种使用方式

审批通过后，系统会把 Rule / Skill 候选放进 `host-actions/pending` 队列。真正生成文件需要调用 `POST /internal/host-actions/execute`。下面给出四种符合用户习惯的触发路径，全部已在 `scripts/test-host-action-approval-flow.mjs` 中跑通。

#### 方式 1：Governance Console 视觉流程

适合想点按钮的用户。

```text
1. 打开 http://127.0.0.1:3101/（Governance Console）
2. 在 Pending 列表看到 create_rule 提案
3. 点击 Approve
4. 切到 History 确认已审批、无重复
5. 点“生成硬编码”或手动调 POST /internal/host-actions/execute
6. 检查 .trae/gates/{rule_key}.hook.ts 与 registry.json
```

#### 方式 2：API 直接审批流程

适合想把治理集成到自己工作流的用户。

```powershell
# 1. 创建 rule candidate（host_model 模式会生成 pending proposal）
curl -X POST http://127.0.0.1:3101/internal/governance/run-from-extraction `
  -H "Content-Type: application/json" `
  -H "x-tenant-id: tenant-local" `
  -H "x-scope: memory.validation" `
  -d '{"extraction_preview":{"rule_candidates":[{"candidate_type":"rule_candidate","title":"禁止日志打印敏感信息","statement":"禁止在日志中打印用户密码或 token，必须对敏感字段脱敏，违反将被阻断提交","rule_key":"host-rule-direct-1","rule_domain":"execution","rule_scope":"project","enforcement_level":"must","violation_behavior":"block","applies_to_phase":["coding"],"risk_level":"medium","promotion_status":"needs_review","origin_scope":"project","availability_scope":"project_reusable","governance_level":"shared","source_kind":"host_capture","source_timestamp":"'$(Get-Date -Format o)'","metadata":{"human_readable_statement":"日志中禁止打印用户密码或 token","classification_rationale":"约束性规则：IF 输出日志 THEN 必须脱敏"}}]},"governance_mode":"host_model","host":"codex"}'

# 2. 查 pending proposal 拿到 id
$pending = (curl http://127.0.0.1:3101/internal/governance/change-proposals?status=recorded).Content | ConvertFrom-Json
$id = $pending.items[0].id

# 3. Approve
curl -X POST http://127.0.0.1:3101/internal/governance/change-proposals/$id/actions `
  -H "Content-Type: application/json" `
  -H "x-tenant-id: tenant-local" `
  -H "x-scope: memory.validation" `
  -d '{"action":"approve"}'

# 4. 执行落地
curl -X POST http://127.0.0.1:3101/internal/host-actions/execute `
  -H "Content-Type: application/json" `
  -H "x-tenant-id: tenant-local" `
  -H "x-scope: memory.validation" `
  -d '{"limit":100}'
```

#### 方式 3：自动 skill 触发

适合宿主 agent 已经接入了 memory-host-action-execute skill 的场景。

```text
1. 用户对话触发 memory-governance-run → 生成 change proposal
2. 用户在 Governance Console 点 Approve（或 API approve）
3. 宿主 agent 检测到 memory-host-action-execute skill 触发条件（审批通过且 host-actions 队列非空）
4. skill 自动调 POST /internal/host-actions/execute
5. 生成 .hook.ts / SKILL.md
```

#### 方式 4：批量审批后单次 execute

适合一次性审多条规则再统一生成的用户。

```powershell
# 依次 approve N 条 rule proposal
$ids = @("id-1", "id-2")
foreach ($id in $ids) {
  curl -X POST http://127.0.0.1:3101/internal/governance/change-proposals/$id/actions `
    -H "Content-Type: application/json" `
    -H "x-tenant-id: tenant-local" `
    -H "x-scope: memory.validation" `
    -d '{"action":"approve"}'
}

# 单次 execute 全部落地
curl -X POST http://127.0.0.1:3101/internal/host-actions/execute `
  -H "Content-Type: application/json" `
  -H "x-tenant-id: tenant-local" `
  -H "x-scope: memory.validation" `
  -d '{"limit":100}'
```

#### 验证是否生成

```powershell
# 查看生成的 hook 文件
Get-ChildItem .trae/gates/*.hook.ts

# 查看 registry.json
cat .trae/gates/registry.json | ConvertFrom-Json

# 跑完整链路测试
node scripts/test-host-action-approval-flow.mjs
```

## 11. 部署方式选择

| 方式 | 适用 | 数据库 | 难度 |
|------|------|--------|------|
| 本地开发（npm run start） | 开发调试 | 本地 PostgreSQL | ★ |
| Docker | 隔离环境 | 容器内/外部 PG | ★★ |
| Render Blueprint | 云端后端 + DB | Render Postgres | ★★ |
| GitHub Pages | 静态 Demo（mock 数据） | 无 | ★ |
| Netlify | 静态 Demo（mock 数据） | 无 | ★ |

**国内访问**：用 Netlify（`https://agi-memory.netlify.app/?demo=1`），GitHub Pages 国内不稳。

**生产部署**：Render Blueprint（`render.yaml` 自带），fork 仓库后 New → Blueprint 选本仓库即可。

## 12. 验证脚本速查

```powershell
# MCP 链路
npm run verify:mcp-cli              # CLI 验证
npm run verify:mcp-client-smoke     # 客户端冒烟
npm run verify:mcp                  # 全链路

# 单层路径
npm run verify:memory               # memory 路径
npm run verify:knowledge            # knowledge 路径

# 治理完整流程
npm run verify:governance-complete  # 治理完整流程

# P0.5 锚点
node scripts/verify-layer-links.mjs       # layer_links 表结构验证
node scripts/verify-p05-powershell.mjs    # PowerShell 复合信号全链路
```

## 13. 常见误区 & 排错

### 误区 1：跑了治理但 recall 看不到

**原因**：用了 `rules_fallback` 模式，数据进隔离区不进 active recall。
**解法**：改用 `host_model` 模式，或手动把 candidate 的 `promotion_status` 从 `needs_review` 改成 `active`。

### 误区 2：`memory_retrieve_context` 报 `FINGERPRINT_STATUS_REQUIRED`

**原因**：必传参数没传。
**解法**：传 `fingerprint_status`，不确定时用 `matched_or_na`，确定环境匹配时用 `matched`。

### 误区 3：`memory_run_full_governance` 直接报错

**原因**：跳过了 Step 1。
**解法**：先调 `memory_preview_host_governance` 拿 mission_brief，宿主 LLM 抽取后再调 Step 2。

### 误区 4：skill 注册重复

**原因**：不会重复，`upsertHostSkill` 是幂等的。
**解法**：如果真看到重复，检查 `tenantId` + `scope` + `skillKey` 是否一致。

### 误区 5：PowerShell 跑脚本中文乱码

**原因**：PowerShell 5.x 默认编码不是 UTF-8。
**解法**：执行前 `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`。这条已经写进 hostBootstrap 的 workspace_memory。

### 误区 6：审批通过后没看到 .hook.ts / SKILL.md 文件

**原因**：审批通过后只是把候选推进 `host-actions/pending` 队列，需要调 `POST /internal/host-actions/execute` 才会生成文件。
**解法**：参考第 10.4 节的四种触发方式（Governance Console、API、skill 自动、批量审批），选一种适合你的流程。

### 误区 7：doctor 报 memory-service 不可达

**原因**：后端没启动，或 `.memory-mcp/config.json` 里 `memory-service-url` 写错。
**解法**：先 `curl http://127.0.0.1:3101/healthz` 确认后端活着，再检查 config.json。

### 误区 8：把演示数据当成用户数据

**原因**：没区分 `host-bootstrap` 演示数据和用户 `host/mount` 推送的数据。
**解法**：看第 0 节。演示数据在 `tenant=default + scope=host-bootstrap`，用户数据在用户自己的 tenant/scope。recall 时按自己的 tenant/scope 取，不会取到演示数据。

### 误区 9：没推自己的宿主数据就开始用

**原因**：只启动了服务 + 装 MCP，漏了 `POST /internal/host/mount`。
**解法**：先调 `POST /internal/host/mount` 推送自己宿主的 skill/memory/rule（第 0 节有格式），再开始用 MCP。

## 14. 下一步该做什么

如果看完想干活，按优先级：

1. ~~补齐壳子~~：✅ 已完成（layer-links / learning-chain / host-actions/execute 三个端点已补齐）
2. **接入自己的宿主**：参考 `services/memory-mcp-server/src/hostInstall.ts` 写一个 `install-host --host your-host`
3. **跑 P0.5 验证**：`node scripts/verify-p05-powershell.mjs`，看复合信号全链路是否通
4. **写自己的 memory 治理 skill**：参考 `memory-extract-preview` 的写法，封装你自己的治理端点
5. **完善 host-action 自动轮询**：当前 `memory-host-action-execute` skill 需要宿主侧 agent 触发，可考虑加常驻轮询器实现真正无感落地

---

**问题反馈**：<https://github.com/PrecipAI/AGI-Memory/issues>
**初赛帖子**：<https://forum.trae.cn/t/topic/51738>
