# 🧠 给 AI Agent 装一套会「派生」的长期记忆，我做了个 AGI-Memory

> 一条复合信号同时分裂成 Memory 事实 + Rule 门控 + Skill 流程 + Knowledge 认知，互相用 `derived_from` 关系勾连——让 agent 真正「学得会、用得上、查得到」。

## 🎯 解决什么痛点

用过 Codex / Claude Code / Cursor 的开发者都遇到过这三个问题：

| 痛点 | 表现 |
|------|------|
| **健忘** | 换会话就忘光，上次踩的坑这次还要踩一遍 |
| **记忆污染** | 什么都往记忆里塞，越用越乱 |
| **黑盒不学** | agent 记了啥、为啥这么决策全不可观测 |

AGI-Memory 把「长期记忆 + 知识治理 + 跨层派生 + MCP 协议接入 + 规则门禁 + 同心圆洋葱可视化」做成一个工程系统，通过 **MCP 协议** 给任意 agent 注入长期记忆。

## 🚀 核心创新：四层派生认知架构

绝大多数 agent 记忆系统都把数据按「类型」分桶（事实/规则/技能/知识），互不关联。AGI-Memory 做的是从「**分类（classification）**」升级到「**派生（derivation）**」——同一条复合信号允许同时派生多个层的候选，用 `derived_from` 关系勾连。

### 四层职能

| 层 | 职能 | 判定核心 |
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

### Knowledge 双重门槛

Knowledge 不是「啥都往里塞」的垃圾桶。我们设了双重门槛：

- **来源**：检索型（acquired，从外部 web 检索学到）+ 归纳型（synthesized，L4 认知引擎跨事实合成）
- **门槛**：模型本身不会（OOD，超出训练分布）+ 实际场景会复用（Reusable）

满足双重门槛才允许进 Knowledge 层，否则降级到 Memory 或 Evidence。

### 学习行为链识别

agent 不会自己说「我学会了」——我们通过扫描 `tool_call` 序列识别学习行为：

- **三段式**：search → learn → apply，外加**终点总结性文本**
- **防御核心**：序列后无总结性文本则 `isComplete=false`，**不硬造 Knowledge**
- 防止 agent 偶然查一次资料就被误判成「学会了」

## 🎨 同心圆洋葱图可视化

把整个知识架构可视化成同心圆洋葱模型：

- **外圈（感知层）**：事实 / 证据 / 实体——最外层，数量最多，像星尘环绕
- **中圈（知识层）**：合成知识——从感知层提炼的结论
- **内圈（记忆层）**：稳定化的经验快照
- **核心圈（规则层）**：治理约束
- **最内核（技能层）**：可执行操作，绝对中心

隐喻：**外部感知流入内化为核心能力**，像一个认知旋涡。

技术实现：D3.js v7 力导向 + 自定义径向力算法；Canvas 2D 四层径向渐变模拟 glow，无需 WebGL；治理关系边带流动粒子动画，冲突关系红色高亮。

## 🛠️ 技术栈

- **后端**：Node.js 20+ / Fastify / TypeScript
- **数据库**：PostgreSQL（知识图谱、治理记录、规则、技能、layer_links 跨层关系）
- **协议**：MCP (Model Context Protocol)
- **前端**：Canvas 2D + D3.js（洋葱图）/ ECharts（2D 图表）
- **部署**：Docker / Render / Netlify / GitHub Pages

## 📊 治理流水线

L2 → L3 → L4 三层治理让知识越用越干净：

- **L2 冲突检测**：检测重复 / 矛盾候选，跨层去重
- **L3 演进扫描**：识别知识演进趋势，自动归档过时内容
- **L4 认知合成**：回看全批次，合成更高阶的 `synthesized knowledge`

垃圾自动隔离归档，不会永久占据检索结果。

## 🤝 邀请你来测试

**我现在最需要大家帮忙测试的是「记忆抽取」能力**——

AGI-Memory 的核心是从会话历史里抽取四层候选（Memory / Rule / Skill / Knowledge）。我想看看在不同场景下抽取结果是否合理：

### 测试方式

1. 打开 **在线 Demo**：<https://agi-memory.netlify.app/?demo=1>
2. 浏览仪表盘，看 47 个宿主 skill 的雷达图、洋葱图可视化
3. 如果你装了 Trae / Codex / Claude Code 等 MCP 客户端，可以按 [项目仓库](https://github.com/PrecipAI/AGI-Memory) README 的「快速开始」接入真实记忆服务
4. 在你的实际工作场景里跑一段对话，触发 `memory-governance-run` skill，看看抽取出来的候选是否合理

### 我想收集的反馈

- ✅ 抽取出来的 Memory 是不是真的是「一月后还值得知道」的事实？
- ✅ Rule 是不是真的是「运行时硬门控」而不是「代码实现约束」？
- ✅ Skill 是不是真的是「可重复操作流程」而不是「单次修复记录」？
- ✅ Knowledge 是否满足「模型不会 + 会复用」双重门槛？
- ✅ 复合信号是否正确拆分成多候选 + `derived_from` 关系？
- ❌ 有没有误抽取？有没有漏抽取？有没有跨层重复？

把你的发现发到 [初赛帖子](https://forum.trae.cn/t/topic/51738) 下面，或者直接在 GitHub 提 issue。

## 🔗 链接

| 资源 | 链接 |
|------|------|
| 🌐 在线 Demo | <https://agi-memory.netlify.app/?demo=1> |
| 📦 项目仓库 | <https://github.com/PrecipAI/AGI-Memory> |
| 💬 初赛帖子 | <https://forum.trae.cn/t/topic/51738> |

## 🙏 为什么需要你的帮助

记忆抽取是个典型的「没有标准答案」的问题——什么算「一月后还值得知道」？什么算「模型不会」？这些判断需要真实场景验证。我自己跑的样本有限，希望大家一起帮测，让这套系统越用越准。

**每个 issue、每条反馈都是对项目的贡献。** 欢迎来撩。

---

*AGI-Memory · 给 AI Agent 一个会派生的长期记忆*
