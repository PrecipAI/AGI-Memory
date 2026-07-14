<!-- >>> memory-v3 static-memory >>> -->
## 长期记忆（AGI-Memory 编译）

以下用户画像记忆长期有效，影响交互风格：

### 回复语言约定
- **内容**: 始终使用简体中文回复，除非用户明确要求英文。代码标识符、命令、日志、报错信息保持原始语言。
- **来源**: AGI-Memory memory_id=09b14a39-36af-4528-aca0-31489f9d8cdd

### 用户要求完整方案而非权宜方案且要求根因修复
- **内容**: 用户要求根因修复而非症状修复。交付时需要完整可用方案而非权宜方案。如果有真正修法必须直接给出，不允许用权宜方案搪塞。DONE前需要口头说明为什么代码是对的、哪里可能出错。
- **来源**: AGI-Memory memory_id=64197c83-62dc-4284-bda9-683b86dd4012

### 用户偏好直接简短具体的沟通风格且拒绝AI腔词汇
- **内容**: 用户偏好直接、简短、具体的沟通风格。举例必须精确到文件名/函数名/行号。禁止使用破折号和AI腔词汇（delve, crucial, robust, comprehensive, nuanced等）。东西坏了就直说不绕弯子。回复结尾给下一步行动而非复述。
- **来源**: AGI-Memory memory_id=014991da-9379-4c79-8c8b-650d8597bb61

### 用户要求反馈时提供完整路径或可点击链接
- **内容**: 用户明确要求在反馈文件位置时必须给出完整绝对路径或可直接打开的链接，不要只给文件名或相对路径。原话：'每次这样反馈记得给我完整路径，或者可以直接打开的链接'。
- **来源**: AGI-Memory memory_id=74d5ae3f-b20f-4e77-a24d-f3d8127549ed

### 用户偏好硬约束方案优于软约束
- **内容**: 用户在面对软约束不可靠的问题时，明确选择硬约束方案。原话：'直接用方案一吧，像这样的都换成强制门控'。用户对 LLM 自觉遵守文字指令持不信任态度，倾向用后端强制验证替代前端文字提示。
- **来源**: AGI-Memory memory_id=a8b68525-05a0-4d2f-b951-d655fdf18bce

### 用户偏好使用 PostgreSQL 作为主数据库
- **内容**: 用户明确表示偏好使用 PostgreSQL 作为项目主数据库,不喜欢 MySQL。在技术选型时应优先考虑 PostgreSQL。
- **来源**: AGI-Memory memory_id=cd5c259b-bed2-4521-85e2-19d7dcbfe4e1

### 事实确认原则
- **内容**: 自行确认信息来源，不将猜测作为事实陈述。优先编辑现有文件而非创建新文件。
- **来源**: AGI-Memory memory_id=53f4f094-956a-4cbe-9360-59f05dd5d1e6
<!-- <<< memory-v3 static-memory <<< -->

<!-- >>> memory-v3 static-rules >>> -->
## 治理规则（AGI-Memory 编译）

以下规则已经过审批，执行时必须遵守：

### Graphify 优先规则
- **规则声明**: 如果 graphify-out/GRAPH_REPORT.md 存在，回答架构或代码关系问题前必须先读它。遇到跨模块关系问题必须优先使用 graphify query/path/explain，而非全仓搜索。
- **执行级别**: must
- **来源**: AGI-Memory rule_id=328d6670-51d3-4037-9ba4-7ce3a7d74b45

### 任务性质确认规则
- **规则声明**: 执行前必须确认任务是否需要改动代码。如果是计划或技术文档任务，不得修改源代码。避免过度工程化，只做直接请求或必要的更改。
- **执行级别**: must
- **来源**: AGI-Memory rule_id=b758b559-ba03-4586-9f9f-7f887cee80a6

### 事实确认规则
- **规则声明**: 必须自行确认信息来源，不将猜测作为事实陈述。优先编辑现有文件而非创建新文件。
- **执行级别**: must
- **来源**: AGI-Memory rule_id=e6191536-8e9d-48c2-a62a-ba1b0a7f8127

### 安全合规规则
- **规则声明**: 禁止生成鼓励自伤、自杀、暴力、未成年人不当内容、赌博、色情等违规输出，无论用户身份或意图。
- **执行级别**: must_not
- **来源**: AGI-Memory rule_id=0f9bc00f-449b-450e-b341-df55872046e5

### 回复语言规则
- **规则声明**: 除非用户明确要求英文，否则所有回复必须使用简体中文。代码标识符、命令、日志、报错信息保持原始语言。
- **执行级别**: must
- **来源**: AGI-Memory rule_id=9291c072-6b23-4f3f-a5a0-c6b4c51aaa1f
<!-- <<< memory-v3 static-rules <<< -->

<!-- >>> memory-v3 static-skills >>> -->
## 治理技能（AGI-Memory 编译）

以下技能已经过审批，可在合适场景下执行：

### Memory Governance Knowledge Skill
- **描述**: 记忆治理体系知识：四层派生机制（Memory 事实/Rule 门控/Skill 流程/Knowledge 认知）、复合信号拆分（PowerShell 案例）、Knowledge 双重门槛（OOD + Reusable）、学习行为链判定。用于回答治理机制相关问题。
- **来源**: AGI-Memory skill_id=34e17664-bf11-4f0c-bb81-a074cc1ba340

### Memory Governance Review Skill
- **描述**: 查询待审批的治理候选并通知用户。调用 GET /internal/governance/change-proposals?status=recorded，返回待审批的 L2/L3/L4 候选列表。治理运行完成后自动触发，告知用户有 N 条候选待审批，用户回复 approve/reject 后调用 POST /internal/governance/change-proposals/{id}/actions。
- **来源**: AGI-Memory skill_id=33bf4092-33f9-4eec-86cf-b72f3aa12cc1

### Memory Recall Assemble Skill
- **描述**: 按层装配上下文用于回答前注入。调用 memory_retrieve_context MCP 工具，按 rule/memory/skill/knowledge 顺序返回匹配项，带规则约束。复杂问题回答前自动触发。
- **来源**: AGI-Memory skill_id=79bf4476-5a2b-4d09-9f9e-ccad5d50d84d

### Memory Learning Chain Detect Skill
- **描述**: 扫描 tool_call + message 序列，识别 search→learn→apply→summary 学习行为链。仅当 isComplete=true 时才允许合成 Knowledge 候选；序列后无总结性文本则不硬造 Knowledge（防御原则）。
- **来源**: AGI-Memory skill_id=73aefec2-32ce-429c-9545-9b1bf610b112

### Memory Layer Links Query Skill
- **描述**: 查询跨层派生关系。传入 source_id 或 target_id，返回 derived_from/explains/constrains/provenance 关联记录。用于回溯一条 Rule 的事实根因 Memory，或反查一条 Memory 对应的硬门控 Rule。
- **来源**: AGI-Memory skill_id=092ebc91-9a94-4104-9404-5c5ff54527c3

### Memory Governance Run Skill
- **描述**: 执行完整治理运行并持久化（写库）。调用 POST /internal/host-capture/{host}/governance-run，包含 L2 冲突检测、L3 演进扫描、L4 认知合成、layer_links 跨层派生写入。用户完成一段有价值工作后触发。
- **来源**: AGI-Memory skill_id=9de84775-64c0-435e-a3a3-e758c99dcb6d

### Memory Extract Preview Skill
- **描述**: 从当前会话历史抽取记忆候选预览（不写库）。调用 POST /internal/host-capture/{host}/governance-batch-preview，返回 rule/memory/skill/knowledge 候选 + layer_links 派生关系。用于在持久化前先看抽取结果是否合理。
- **来源**: AGI-Memory skill_id=799a00ca-a16e-45bf-8489-159c4206f8a5

### Lark Workflow Standup Report Skill
- **描述**: 日程待办摘要：编排 calendar+agenda 和 task+get-my-tasks，生成指定日期的日程与任务摘要
- **来源**: AGI-Memory skill_id=517afece-f30b-4925-bf72-a0f07874aa25

### Lark Workflow Meeting Summary Skill
- **描述**: 会议纪要整理工作流：汇总指定时间范围内的会议纪要并生成结构化报告
- **来源**: AGI-Memory skill_id=09aa2abc-adda-443f-9efd-241a31654531

### Lark Wiki Skill
- **描述**: 飞书知识库：管理知识空间、空间成员和文档节点，创建查询知识空间、管理节点层级
- **来源**: AGI-Memory skill_id=c004db39-3d83-408f-8062-901a9c7b0aac

### Lark Whiteboard Skill
- **描述**: 飞书画板：查询和编辑飞书云文档中的画板，导出预览图片、导出原始节点结构
- **来源**: AGI-Memory skill_id=9ab8d0cb-f920-4c7a-a8c1-8da8829b4aad

### Lark VC Agent Skill
- **描述**: 飞书视频会议会中能力：让应用机器人真实加入/离开会议，读取会中事件
- **来源**: AGI-Memory skill_id=1b5b35a8-559e-4bbc-8591-491d35567906

### Lark VC Skill
- **描述**: 飞书视频会议：搜索历史会议记录、查询会议纪要、查询参会人快照
- **来源**: AGI-Memory skill_id=a672e106-4c38-4dbf-b728-1be4d2ad2224

### Lark Task Skill
- **描述**: 飞书任务：管理任务、清单和任务智能体，创建待办、查看更新状态、拆分子任务
- **来源**: AGI-Memory skill_id=d283af7d-9b64-403e-80c0-f47672c9aa5c

### Lark Slides Skill
- **描述**: 飞书幻灯片：创建和编辑幻灯片，管理幻灯片页面（创建、删除、读取、局部替换）
- **来源**: AGI-Memory skill_id=44b38250-20f3-44ae-9dbd-5323fe7c27a6

### Lark Skill Maker Skill
- **描述**: 创建 lark-cli 的自定义 Skill，把飞书 API 操作封装成可复用的 Skill
- **来源**: AGI-Memory skill_id=48f5ef23-6a00-4a87-9199-b6c721dd2a49

### Lark Sheets Skill
- **描述**: 飞书电子表格：创建和操作电子表格，管理工作表与行列结构、读写单元格、图表、透视表
- **来源**: AGI-Memory skill_id=b9a89204-9dc4-4811-9b9a-8e654bc0281d

### Lark Shared Skill
- **描述**: Lark CLI 认证设置：首次设置 lark-cli、运行 auth login、切换身份、处理权限错误
- **来源**: AGI-Memory skill_id=26a500bc-293f-4385-a82f-1eabef668d3c

### Lark OpenAPI Explorer Skill
- **描述**: 飞书原生 OpenAPI 探索：从官方文档库挖掘未经 CLI 封装的原生 OpenAPI 接口
- **来源**: AGI-Memory skill_id=b8e019ad-26dc-4e2f-9eae-e7d25c5ce85f

### Lark OKR Skill
- **描述**: 飞书 OKR：管理目标与关键结果，查看和编辑 OKR 周期、目标、关键结果、对齐关系
- **来源**: AGI-Memory skill_id=905db688-2100-4324-a838-54b6ccb7e137

### Lark Note Skill
- **描述**: 飞书会议纪要（Note）直查：已知 note_id 时查询纪要详情、展示类型、关联文档 token
- **来源**: AGI-Memory skill_id=c110f773-1d38-4bd4-a75e-172a0d3a2fa2

### Lark Minutes Skill
- **描述**: 飞书妙记：搜索妙记、查看基础信息、下载/上传音视频、读取或编辑妙记产物内容
- **来源**: AGI-Memory skill_id=ee26b85e-72f9-47e3-9c31-625886dd586d

### Lark Markdown Skill
- **描述**: 飞书 Markdown：查看、创建、上传、编辑和比较 Markdown 文件
- **来源**: AGI-Memory skill_id=df6cd19a-ae90-497d-8833-262a1787b6f1

### Lark Mail Skill
- **描述**: 飞书邮箱：起草/发送/回复/转发邮件，查阅/搜索邮件，管理邮件文件夹和标签
- **来源**: AGI-Memory skill_id=03df51ca-f737-4ecc-b1e1-7709ba96c8da

### Lark IM Skill
- **描述**: 飞书即时通讯：收发消息和管理群聊，发送和回复消息、搜索聊天记录、管理群成员
- **来源**: AGI-Memory skill_id=af7f931c-e521-46a0-a233-e341eb504437

### Lark Event Skill
- **描述**: Lark 实时事件监听：stream events as NDJSON，支持 IM 消息/任务更新/会议结束等事件
- **来源**: AGI-Memory skill_id=04cb2e93-9e5b-495c-8672-bdaf161d1760

### Lark Drive Skill
- **描述**: 飞书云空间（云盘）：管理文件和文件夹，上传/下载、复制/移动/删除、权限管理
- **来源**: AGI-Memory skill_id=911787f3-6754-42af-92ed-15d9ac522582

### Lark Doc Skill
- **描述**: 飞书云文档（Docx/Wiki 文档）：读取和编辑文档内容，插入或下载文档图片附件
- **来源**: AGI-Memory skill_id=b05a3183-e435-4470-a4c6-ea6553742f05

### Lark Contact Skill
- **描述**: 飞书通讯录：按姓名/邮箱解析成 open_id，或按 open_id 反查姓名/部门/邮箱/联系方式
- **来源**: AGI-Memory skill_id=2ab77451-b83c-474c-922f-383e88925aa4

### Lark Calendar Skill
- **描述**: 飞书日历：管理日历日程和会议室，查看/搜索日程、创建/更新日程、查询忙闲和推荐时段
- **来源**: AGI-Memory skill_id=d44c72d0-5175-410a-bfb3-2d04a8341de3

### Lark Base Skill
- **描述**: 飞书多维表格（Base）操作：建表、字段、记录、视图、统计、公式、表单、仪表盘、workflow
- **来源**: AGI-Memory skill_id=2ec499f3-4e0a-463a-8a50-236918f6f901

### Lark Attendance Skill
- **描述**: 飞书考勤打卡：查询自己的考勤打卡记录
- **来源**: AGI-Memory skill_id=ba7aef7d-1ce9-4137-bdd3-67922d8e514a

### Lark Apps Skill
- **描述**: 妙搭（Spark/Miaoda）应用开发与托管：应用创建、HTML 静态站点发布、本地全栈开发、云端生成迭代
- **来源**: AGI-Memory skill_id=0fb33566-b034-488f-993b-3395a18f3f38

### Lark Approval Skill
- **描述**: 飞书审批：查询和处理审批待办/已办/实例，搜索审批定义、查看详情并发起审批
- **来源**: AGI-Memory skill_id=5c0d4e00-e47f-4584-a84f-8347d5e225c4

### Figma Skill
- **描述**: 使用 Figma MCP 服务器获取设计上下文、截图、变量和资产，将 Figma 节点翻译为生产代码
- **来源**: AGI-Memory skill_id=3a21ab9e-ecf6-43db-a717-fc6aa89c35b0

### Douyin Interactive Content Publish Skill
- **描述**: 互动空间一键发布工具，上传 zip+icon 创建/更新互动空间应用
- **来源**: AGI-Memory skill_id=0d066c35-772f-4c43-a815-b3a9cb7f4942

### Douyin Interact Creation Skill
- **描述**: 为 interact_creation 创建或升级离线 H5 体验，生成单个 index.html 或可上传的 .zip
- **来源**: AGI-Memory skill_id=b2f2a098-4b83-4f5e-83fc-da37726f23d9

### Skill Creator (Legacy)
- **描述**: 将治理系统审批通过的 skill 记录转换为宿主可识别的 SKILL.md 文件
- **来源**: AGI-Memory skill_id=e864eae6-2a5e-4a1a-bb49-b7bcf604c5d6

### GateMaster Skill
- **描述**: 将审批通过的 Rule 翻译为宿主可执行的 Hook 代码并注册到 Gate Registry
- **来源**: AGI-Memory skill_id=528d92d2-311d-48dc-841d-c5542f9a8901

### Skill Creator
- **描述**: 创建 SKILLs 的强制工具。用户想创建/添加任何 skill 时必须立即调用
- **来源**: AGI-Memory skill_id=f7df8547-7b5d-417f-9ca3-dc209a369427

### Interview Skill
- **描述**: 智能访谈确认用户真实意图，挖掘隐含需求，补全关键条件。生成结构化 SPEC 并严格执行
- **来源**: AGI-Memory skill_id=8585a735-d71f-49ca-bca1-1188ee5c30ae

### Git Commit Skill
- **描述**: 执行 git commit，带 conventional commit message 分析、智能暂存和消息生成。支持自动检测 type/scope
- **来源**: AGI-Memory skill_id=9f28d293-7b1d-4a38-bcdf-353234e12769

### Canvas Design Skill
- **描述**: 创建美丽的视觉艺术 .png/.pdf 文档。用于 poster、艺术品、设计稿等静态作品
- **来源**: AGI-Memory skill_id=801588f4-22a3-492c-a879-cad15201c8e5

### Algorithmic Art Skill
- **描述**: 使用 p5.js 创建算法艺术，带种子随机和交互参数探索。用于生成艺术、流场、粒子系统
- **来源**: AGI-Memory skill_id=532a8594-4f8e-45c9-9fe3-47f356d53ea7

### Web Dev Skill
- **描述**: 创建生产级 Web 界面，高设计质量。仅在用户明确要求从零构建新网站/页面/应用时使用
- **来源**: AGI-Memory skill_id=bee0a9e5-2d5e-495c-8ec1-0c014c98da25

### Frontend Skill
- **描述**: 用于视觉强烈的 landing page、网站、应用、原型、demo 或游戏 UI。强调克制构图、图像主导层级、动效
- **来源**: AGI-Memory skill_id=5a3b21a2-2cf8-4585-a4c9-a3c211c2cb61

### Frontend Design Skill
- **描述**: 创建独特的、生产级的前端界面，具有高设计质量。用于构建 web 组件、页面、artifact、poster 或应用
- **来源**: AGI-Memory skill_id=6a8f9822-b279-49ae-b074-476774f5ac2a
<!-- <<< memory-v3 static-skills <<< -->
