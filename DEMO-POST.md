# AGI-Memory：给 AI Agent 装一套会"派生"的长期记忆系统

> 让 AI 不再健忘、不再瞎记、不再黑盒——四层派生认知架构 + MCP 协议接入 + 治理流水线 + 同心圆洋葱可视化，知识越用越干净。

## 一句话介绍

AGI-Memory 把"长期记忆 + 知识治理 + 跨层派生 + MCP 协议接入 + 规则门禁"做成一个工程系统：通过 MCP 给 Codex / Claude Code / Trae 等 agent 注入长期记忆，并用一套**派生（derivation）机制**让一条复合信号同时分裂成 Memory 事实 + Rule 门控 + Skill 流程 + Knowledge 认知，互相用 `derived_from` 关系勾连，让 agent 真正"学得会、用得上、查得到"。

## 在线体验

- **在线 Demo（GitHub Pages，免部署）**：<https://precipai.github.io/AGI-Memory/>
- **开源仓库**：<https://github.com/PrecipAI/AGI-Memory>

打开 Demo 后会自动进入 `?demo=1` 模式，使用 mock 数据展示完整功能；想接真实后端的话，把 URL 里的 `?demo=1` 去掉即可走 `/internal/*` 真实 API。

## 解决什么问题

用过 Codex / Claude Code / Cursor 的开发者都遇到过这三个痛点：

1. **健忘**：换个会话就忘光，上次踩的坑这次还要踩一遍
2. **记忆污染**：什么都往记忆里塞，越用越乱，检索出来全是噪音
3. **黑盒 + 不会学**：agent 记了啥、为啥这么决策、规则怎么生效，全不可观测；同一类错误换个会话照样犯，根本没有"认知沉淀"

AGI-Memory 的目标不是堆一个更大的文档库，而是建一个**越积累越干净、越可复用、越能跨会话复用**的认知系统。

## 核心创新：四层派生认知架构

这是本次大赛的最核心创新点。绝大多数 agent 记忆系统都把数据按"类型"分桶（事实/规则/技能/知识），互不关联。我们做的是从"分类（classification）"升级到"**派生（derivation）**"——同一条复合信号允许同时派生多个层的候选，并用 `derived_from` 关系勾连起来。

### 四层职能重新定义

| 层 | 职能 | 判定核心 |
|----|------|----------|
| **Memory** | 事实根因 | 一月后回头看还值得知道的事实 |
| **Rule** | 硬门控 | 抹掉项目名词仍然成立的运行时拦截 |
| **Skill** | 操作流程 | 换通用词后依然可执行的步骤 |
| **Knowledge** | 模型盲区认知 | 同时满足"模型不会（OOD）"+"会复用" |

### 复合信号拆分（PowerShell 案例）

一个真实的复合信号——「PowerShell + UTF-8 乱码」——会同时派生：

- **Memory（事实根因）**：PowerShell 5.x 默认编码不是 UTF-8，导致中文输出乱码
- **Rule（硬门控）**：在 Windows 环境输出非 ASCII 内容前，必须显式设置 `[Console]::OutputEncoding`

两条记录通过 `layer_links` 表的 `derived_from` 关系勾连，查 Memory 时能反查到 Rule，查 Rule 时能找到根因 Memory。这样 agent 既知道"为什么"（事实），也知道"怎么办"（门控），而不是只塞一条记忆了事。

### Knowledge 双来源 + 双重门槛

Knowledge 不能是"啥都往里塞"的垃圾桶。我们设了双重门槛：

- **来源**：检索型（acquired，从外部 web 检索学到的）+ 归纳型（synthesized，L4 认知引擎跨事实合成的）
- **门槛**：模型本身不会（OOD，超出训练分布）+ 实际场景会复用（Reusable）

满足双重门槛才允许进 Knowledge 层，否则降级到 Memory 或 Evidence。

### 学习行为链识别

agent 不会自己说"我学会了"——我们通过扫描 `tool_call` 序列识别学习行为：

- 检索 → 阅读 → 应用（search-learn-apply 三段式）才判定为"习得认知"
- 序列后必须出现总结性文本才合成 Knowledge，**没有总结则不硬造**

防止 agent 偶然查一次资料就被误判成"学会了"。

### 统一抽取决策树

抽取器不再做单选题，而是 6 个问题依次扫描，**允许多条同时命中**：

1. 是否是 IF/THEN 拦截？→ Rule
2. 是否是一月后还有价值的事实？→ Memory
3. 是否是可重复操作流程？→ Skill
4. 是否模型 OOD + 会复用？→ Knowledge
5. 是否是同源复合信号？→ 同时派生多候选 + derived_from
6. 是否是单次执行证据？→ Governance Evidence

### layer_links 跨层关系表（P0 基础设施）

新增的 `layer_links` 表存储跨层派生关系：

- 4 种关系类型：`derived_from` / `explains` / `constrains` / `provenance`
- **单向存储原则**：`constrains` 只存 `source→target` 一条，查询时反查 `target→source`，避免双向冗余
- `UNIQUE(source_id, target_id, link_type)` 防重复写入，支持幂等
- 复合信号验证锚点（PowerShell 案例）已跑通正查 / 反查 / 幂等全链路

## 其他亮点

### 治理导向的知识演进（不是 append-only）

知识走一套治理流水线：

- **L2 冲突检测** → 发现矛盾知识（按 memory_type 过滤，避免跨类型误判）
- **L3 演进管理** → 旧知识被新知识 supersede
- **L4 认知合成** → 从事实 + 证据合成出更高级的"合成知识"

垃圾知识会被降级、隔离、归档，而不是永久占据检索结果。`rules_fallback` 模式下所有候选强制 `parked` 状态，不进 active 召回——保证 fallback 永不污染主记忆。

### MCP 协议接入，宿主无关

通过 MCP（Model Context Protocol）把记忆能力暴露给任意 agent 宿主：

- Codex / Claude Code / OpenCode / OpenClaw / Trae / 自研 agent 都能接
- 6 个核心 MCP 工具：`memory_health` / `memory_retrieve_context` / `memory_ingest_candidate` / `memory_query_layer` / `memory_run_governance` / `rule_gate_check`
- 高风险操作（改配置、改治理规则）走 `rule_gate_check` 门禁，有审计记录

### 同心圆洋葱图可视化

把整个知识架构可视化成**同心圆洋葱模型**：

- **外圈（感知层）**：事实 / 证据 / 实体——最外层，数量最多，像星尘环绕
- **中圈（知识层）**：合成知识——从感知层提炼的结论
- **内圈（记忆层）**：稳定化的经验快照
- **核心圈（规则层）**：治理约束
- **最内核（技能层）**：可执行操作，绝对中心

隐喻：**外部感知流入内化为核心能力**，像一个认知旋涡。

技术实现：

- D3.js v7 力导向 + 自定义径向力算法，节点牢牢约束在所属环上
- Canvas 2D 四层径向渐变模拟 glow（环境光晕 + 中层辉光 + 实色核心 + 白热中心），无需 WebGL
- 治理关系边带流动粒子动画，冲突关系红色高亮
- 节点呼吸动画 + 选中放射光线效果 + 搜索匹配脉冲

### 两步式 MCP 治理流程

memory-service 是 MCP 插件后端，不自己调 LLM——所有 LLM 调用都在宿主侧：

1. 宿主调 `governance-batch-preview` → memory-service 返回 `mission_brief`
2. 宿主自己跑 LLM 评估
3. 宿主调 `governance-run` 传 `host_model_result`

LLM 成本和算力留在宿主侧，memory-service 保持轻量，只做数据治理和检索。

## 技术架构

四个平面：

1. **摄入平面**：外部知识、任务产物、规则、技能通过受控写入路径进入
2. **治理平面**：去重、对齐、升级、拒绝或合成知识
3. **检索装配平面**：按层装配上下文，带规则约束
4. **宿主集成平面**：MCP 适配器，不耦合任何具体 agent

技术栈：

- **后端**：Node.js 20+ / Fastify / TypeScript
- **数据库**：PostgreSQL（知识图谱、治理记录、规则、技能、layer_links 跨层关系）
- **向量**：Milvus / Qdrant 可选（混合检索）
- **协议**：MCP (Model Context Protocol)
- **前端**：Canvas 2D + D3.js（洋葱图）/ ECharts（2D 图）
- **部署**：Docker / Render / GitHub Pages（静态 Demo）

## Demo 功能演示

打开 <https://precipai.github.io/AGI-Memory/> 后可以体验：

- **洋葱图交互**：悬停看节点详情、点击高亮关联边、搜索匹配脉冲、滚轮缩放 / 拖拽平移
- **5 类技能雷达图**：integration / generative / procedural / knowledge / publishing 五类技能分布
- **治理流水线可视化**：知识从候选到合成到归档的全流程
- **MCP 工具调用展示**：6 个核心工具的请求 / 响应结构

## 适合谁用

- 想给 Codex / Claude Code / Trae 加长期记忆的开发者
- 想建私有知识平台并通过 MCP 接入 agent 的团队
- 对 agent 记忆治理、规则门禁、知识图谱可视化、跨层派生认知架构感兴趣的研究者
- 想做"会沉淀认知的 AI agent"的产品经理

## 后续规划

- 接入更多 agent 宿主（Cursor / Windsurf / Continue.dev）
- 知识图谱 3D 体素城市视图（按 utility 高度建楼）
- 多智能体共享记忆协作（layer_links 跨 agent 派生）
- 知识质量自动评测 + 自动归档
- L4 认知引擎回看全批次 synthesized knowledge 增强

---

**用 MCP + 四层派生机制，给 AI 一个能治理、能进化、能审计、能跨会话复用的长期记忆。**
