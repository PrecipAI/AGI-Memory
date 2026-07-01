# AGI-Memory · AI Agent 的四层派生长期记忆系统

> 给 AI Agent 装一套会「派生」的记忆系统：从「分类」升级到「派生」，一条复合信号同时分裂成 Memory 事实 + Rule 门控 + Skill 流程 + Knowledge 认知，互相用 `derived_from` 关系勾连，让 agent 真正「学得会、用得上、查得到」。

[![License](https://img.shields.io/badge/license-private-orange)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-43853d)](#环境准备)
[![MCP](https://img.shields.io/badge/protocol-MCP-111111)](#mcp-工具一览)
[![Demo](https://img.shields.io/badge/demo-GitHub%20Pages-blue)](https://precipai.github.io/AGI-Memory/)

## 这是什么

AGI-Memory 把「长期记忆 + 知识治理 + 跨层派生 + MCP 协议接入 + 规则门禁 + 同心圆洋葱可视化」做成一个工程系统：

- 通过 **MCP 协议** 给 Codex / Claude Code / Trae / 任意 agent 注入长期记忆
- 用一套**派生（derivation）机制**让一条复合信号同时分裂成多个层的候选
- 治理流水线 L2→L3→L4 让知识越用越干净，垃圾自动隔离归档
- 前端洋葱图把整个认知架构可视化，节点可点击回溯跨层派生关系

**在线 Demo**（GitHub Pages，免部署）：<https://precipai.github.io/AGI-Memory/>

## 解决什么痛点

用过 Codex / Claude Code / Cursor 的开发者都遇到过这三个问题：

| 痛点 | 表现 | AGI-Memory 怎么解 |
|------|------|-------------------|
| **健忘** | 换会话就忘光，上次踩的坑这次还要踩一遍 | 长期记忆 + MCP 注入，跨会话复用 |
| **记忆污染** | 什么都往记忆里塞，越用越乱 | 四层派生 + 治理流水线，垃圾自动隔离 |
| **黑盒不学** | agent 记了啥、为啥这么决策全不可观测 | 洋葱图可视化 + layer_links 跨层可追溯 |

## 核心创新：四层派生认知架构

绝大多数 agent 记忆系统都把数据按「类型」分桶（事实/规则/技能/知识），互不关联。我们做的是从「**分类（classification）**」升级到「**派生（derivation）**」——同一条复合信号允许同时派生多个层的候选，用 `derived_from` 关系勾连。

### 四层职能重新定义

| 层 | 职能 | 判定核心（自我测试） |
|----|------|----------|
| **Memory** | 事实根因 | 一月后回头看还值得知道的事实 |
| **Rule** | 硬门控 | 抹掉项目名词仍然成立的运行时拦截 |
| **Skill** | 操作流程 | 换通用词后依然可执行的步骤 |
| **Knowledge** | 模型盲区认知 | 同时满足「模型不会（OOD）」+「会复用」 |

### 复合信号拆分（PowerShell 案例）

一个真实的复合信号——「PowerShell + UTF-8 乱码」——会同时派生：

- **Memory（事实根因）**：PowerShell 5.x 默认编码不是 UTF-8，导致中文输出乱码
- **Rule（硬门控）**：在 Windows 环境输出非 ASCII 内容前，必须显式设置 `[Console]::OutputEncoding`

两条记录通过 `layer_links` 表的 `derived_from` 关系勾连——查 Memory 时能反查到 Rule，查 Rule 时能找到根因 Memory。这样 agent 既知道「为什么」（事实），也知道「怎么办」（门控）。

### Knowledge 双来源 + 双重门槛

Knowledge 不是「啥都往里塞」的垃圾桶。我们设了双重门槛：

- **来源**：检索型（acquired，从外部 web 检索学到）+ 归纳型（synthesized，L4 认知引擎跨事实合成）
- **门槛**：模型本身不会（OOD，超出训练分布）+ 实际场景会复用（Reusable）

满足双重门槛才允许进 Knowledge 层，否则降级到 Memory 或 Evidence。

### 学习行为链识别（P3）

agent 不会自己说「我学会了」——我们通过扫描 `tool_call` 序列识别学习行为：

- **三段式**：search → learn → apply，外加**终点总结性文本**
- **防御核心**：序列后无总结性文本则 `isComplete=false`，**不硬造 Knowledge**
- 防止 agent 偶然查一次资料就被误判成「学会了」

### 统一抽取决策树

抽取器不再做单选题，而是 6 个问题依次扫描，**允许多条同时命中**：

1. 是否是 IF/THEN 拦截？→ Rule
2. 是否是一月后还有价值的事实？→ Memory
3. 是否是可重复操作流程？→ Skill
4. 是否模型 OOD + 会复用？→ Knowledge
5. 是否是同源复合信号？→ 同时派生多候选 + derived_from
6. 是否是单次执行证据？→ Governance Evidence

### layer_links 跨层关系表

新增 `layer_links` 表存储跨层派生关系：

- 4 种关系：`derived_from` / `explains` / `constrains` / `provenance`
- **单向存储原则**：`constrains` 只存 `source→target` 一条，查询时反查，避免双向冗余
- `UNIQUE(source_id, target_id, link_type)` 防重，支持幂等

## 同心圆洋葱图可视化

把整个知识架构可视化成同心圆洋葱模型：

![洋葱图总览](docs/screenshots/1da45ca6-a683-4bef-ad43-ffb4c7d71102.png)

- **外圈（感知层）**：事实 / 证据 / 实体——最外层，数量最多，像星尘环绕
- **中圈（知识层）**：合成知识——从感知层提炼的结论
- **内圈（记忆层）**：稳定化的经验快照
- **核心圈（规则层）**：治理约束
- **最内核（技能层）**：可执行操作，绝对中心

隐喻：**外部感知流入内化为核心能力**，像一个认知旋涡。

技术实现：D3.js v7 力导向 + 自定义径向力算法；Canvas 2D 四层径向渐变模拟 glow，无需 WebGL；治理关系边带流动粒子动画，冲突关系红色高亮。

## 仪表盘与治理控制台

### 主仪表盘

![仪表盘](docs/screenshots/2a4f1daf-bef8-4f43-9574-77995c337fc7.png)

展示宿主自带 42+ 个 skill 的分类雷达图、记忆治理统计、最近治理批次概览。访问路径：`/dashboard`。

### 治理流水线可视化

![治理流水线](docs/screenshots/2f0eed4a-1e47-40c6-ae96-94be8d0530b9.png)

知识从候选 → 合成 → 归档的全流程，能看到 L2 冲突检测、L3 演进扫描、L4 认知合成每一层的中间产物。

### 候选预览与跨层关系

![候选预览](docs/screenshots/49d6e68c-c509-4f43-9588-8248b58f1c61.png)

抽取预览面板展示 rule/memory/skill/knowledge 候选 + layer_links 派生关系图。

### 知识图谱关系网

![知识图谱](docs/screenshots/4a4717b2-c320-4862-b518-0683325defff.png)

节点点击高亮关联边，搜索匹配脉冲，滚轮缩放 / 拖拽平移。

### MCP 工具调用展示

![MCP工具](docs/screenshots/6b03ac6e-3f2e-410c-8bf9-19fae69298fa.png)

6 个核心 MCP 工具的请求 / 响应结构，可在控制台直接试调用。

### 技能雷达图

![技能雷达](docs/screenshots/9ce65b8b-e760-4edc-b3fb-bfb4d3c2d503.png)

integration / generative / procedural / knowledge / publishing 五类技能分布。

### 治理批次详情

![治理批次](docs/screenshots/b956204c-05d6-4a77-895b-4a8cc87d28af.png)

每个治理批次的输入信号、候选列表、L2-L4 处理结果、最终持久化产物。

## 架构总览

四个平面：

1. **摄入平面**：外部知识、任务产物、规则、技能通过受控写入路径进入
2. **治理平面**：去重、对齐、升级、拒绝或合成知识（L2→L3→L4）
3. **检索装配平面**：按层装配上下文，带规则约束
4. **宿主集成平面**：MCP 适配器，不耦合任何具体 agent

技术栈：

- **后端**：Node.js 20+ / Fastify / TypeScript
- **数据库**：PostgreSQL（知识图谱、治理记录、规则、技能、layer_links 跨层关系）
- **向量**：Milvus / Qdrant 可选（混合检索）
- **协议**：MCP (Model Context Protocol)
- **前端**：Canvas 2D + D3.js（洋葱图）/ ECharts（2D 图表）
- **部署**：Docker / Render / GitHub Pages（静态 Demo）

## 仓库结构

```text
.
├── db/                              # 数据库 schema 和 migrations
│   └── migrations/                  # 0029_layer_links.sql 等表结构
├── docs/
│   ├── specs/                       # 设计规格文档（00-39 编号）
│   └── screenshots/                 # README 用的截图
├── libs/                            # 共享契约、仓库、db 客户端
├── scripts/                         # 验证、打包、评估、运维脚本
├── services/
│   ├── memory-service/              # 后端 API + 治理核心
│   │   ├── src/
│   │   │   ├── governance/           # L2ConflictDetector / L3EvolutionScanner / L4CognitiveEngine / learningChainDetector
│   │   │   ├── hostBootstrap.ts      # 宿主挂载时自动注册的 47+ skill / 8 memory / 5 rule
│   │   │   ├── hostCaptureGovernanceBatch.ts   # 派生决策树
│   │   │   ├── hostCaptureGovernanceRun.ts     # 治理运行 + layer_links 持久化
│   │   │   ├── hostModelGovernanceAdapter.ts    # host_model / rules_fallback 模式适配
│   │   │   └── governancePromptBuilder.ts       # 抽取 Prompt + 每层自我测试
│   │   └── public/                  # 仪表盘静态资源（GitHub Pages 部署根）
│   ├── memory-mcp-server/           # MCP server 和宿主集成流程
│   ├── knowledge-ops-console/        # 审查 UI
│   └── embedding-service/           # 向量后端集成入口
├── tests/                           # 集成与基准测试
└── SPEC-SuperAgentSystem-knowledge-platform.md
```

## 环境准备

- **Node.js** ≥ 20
- **PostgreSQL** ≥ 14（推荐 16）
- npm 依赖

## 快速开始

### 1. 安装依赖

```powershell
npm install
```

### 2. 配置数据库

复制 `.env.example` 为 `.env`，填入 PostgreSQL 连接信息：

```powershell
Copy-Item .env.example .env
# 编辑 .env，设置 DB_URL
```

### 3. 跑数据库 migration

```powershell
$env:DB_URL="postgresql://postgres:postgres@127.0.0.1:5432/super_agent_system"
npm run db:migrate
```

### 4. 启动主服务

```powershell
npm run start:memory-service
```

启动后访问：

- 仪表盘：<http://127.0.0.1:3101/dashboard>
- 治理控制台：<http://127.0.0.1:3101/governance-console>
- 健康检查：<http://127.0.0.1:3101/healthz>

服务启动时会自动注册宿主自带的 **47 个 skill + 8 条 memory + 5 条 rule**（幂等，重启不会重复写）。

### 5. 启动 MCP server（可选，给 agent 接入用）

```powershell
npm run memory-mcp:init       # 初始化 MCP 配置
npm run memory-mcp:doctor     # 健康检查
npm run memory-mcp:start      # 启动 MCP server
```

生成的 `.memory-mcp/clients` 目录包含各宿主的配置模板：Codex / Claude Code / Claude Desktop / OpenCode / OpenClaw / 通用 MCP 客户端。

## MCP 工具一览

memory-service 通过 MCP 暴露 6 个核心工具：

| 工具 | 用途 |
|------|------|
| `memory_health` | 检查 memory-service 是否可用 |
| `memory_retrieve_context` | 按层装配上下文，带规则约束 |
| `memory_ingest_candidate` | 写入验证后的设计决策、修复经验等 |
| `memory_query_layer` | 按 memory_type / kind 过滤查询 |
| `memory_run_governance` | 触发治理流水线（L2→L3→L4） |
| `rule_gate_check` | 高风险操作前的规则门禁检查 |

## 记忆治理 Skill（宿主侧触发）

为了让宿主在合适场景下能手动或自动触发记忆治理流程，hostBootstrap 注册了 5 个 procedural skill + 1 个 knowledge skill：

| Skill Key | 触发时机 | 调用端点 |
|-----------|---------|---------|
| `memory-extract-preview` | 用户问「你学到了什么/总结一下」时 | `POST /internal/host-capture/{host}/governance-batch-preview` |
| `memory-governance-run` | 用户完成一段有价值工作后（修复 bug、新功能上线） | `POST /internal/host-capture/{host}/governance-run` |
| `memory-layer-links-query` | 用户问「为什么这条规则存在/这条记忆的根因」时 | `GET /internal/layer-links?source_id=...` |
| `memory-learning-chain-detect` | 用户跨多工具检索后应用结论时 | 调用 `learningChainDetector` 模块 |
| `memory-recall-assemble` | 复杂问题回答前自动触发 | MCP `memory_retrieve_context` |
| `memory-governance-knowledge` | 用户问治理机制相关问题时（知识型 skill） | 知识问答，无端点调用 |

宿主侧配置触发条件后，agent 会在合适时机自动调用，不需要用户手动发命令。

## 部署

### 方式一：本地开发

见上文「快速开始」。

### 方式二：Docker

```powershell
docker build -t agi-memory .
docker run -p 3101:3101 -e DB_URL=... agi-memory
```

### 方式三：Render（云端后端 + 数据库）

仓库自带 `render.yaml`，支持 Blueprint 部署。fork 后在 Render 控制台 New → Blueprint 选择本仓库即可。

### 方式四：GitHub Pages（静态 Demo）

仓库自带 `.github/workflows/deploy-pages.yml`，把 `services/memory-service/public/` 部署为 GitHub Pages 静态站点。

启用步骤：

1. 仓库 **Settings → Pages → Source** 选择「GitHub Actions」
2. 推送代码到 `main` 分支会自动触发部署
3. 部署完成后访问 `https://<你的用户名>.github.io/<仓库名>/`

静态 Demo 使用 mock 数据（47 个宿主 skill、8 条 memory、5 条 rule），当 `/healthz` 不可达时自动进入 `?demo=1` 模式。

## 验证

```powershell
npm run verify:mcp-cli              # MCP CLI 验证
npm run verify:mcp-client-smoke    # MCP 客户端冒烟
npm run verify:mcp                  # MCP 全链路
npm run verify:memory               # memory 路径
npm run verify:knowledge            # knowledge 路径
npm run verify:governance-complete  # 治理完整流程
```

P0.5 验证锚点脚本：

```powershell
node scripts/verify-layer-links.mjs       # layer_links 表结构验证
node scripts/verify-p05-powershell.mjs    # PowerShell 复合信号全链路
```

## 设计原则

- **从分类到派生**：一条复合信号允许同时派生多候选，跨层用 `derived_from` 勾连
- **Knowledge 双重门槛**：模型不会（OOD）+ 会复用（Reusable）才允许进 Knowledge 层
- **无总结则不造**：学习行为链必须出现终点总结性文本，否则不硬造 Knowledge
- **单向存储**：`constrains` 只存 `source→target` 一条，查询时反查
- **高风险必门禁**：改配置、改治理规则前必须 `rule_gate_check`
- **治理替代堆积**：知识会被降级、隔离、归档，而不是永久占据检索结果

## 文档

- 主规格：[SPEC-SuperAgentSystem-knowledge-platform.md](SPEC-SuperAgentSystem-knowledge-platform.md)
- 知识平台规格：[docs/specs/knowledge-platform](docs/specs/knowledge-platform)
- 启动与契约冻结：[docs/specs/launch-v1](docs/specs/launch-v1)
- MCP 包快速开始：[services/memory-mcp-server/README.md](services/memory-mcp-server/README.md)
- 大赛初赛帖子：[DEMO-POST.md](DEMO-POST.md)

## 后续规划

- 接入更多 agent 宿主（Cursor / Windsurf / Continue.dev）
- 知识图谱 3D 体素城市视图（按 utility 高度建楼）
- 多智能体共享记忆协作（layer_links 跨 agent 派生）
- 知识质量自动评测 + 自动归档
- L4 认知引擎回看全批次 synthesized knowledge 增强

## License

私有内部使用许可，详见 [LICENSE](LICENSE)。
