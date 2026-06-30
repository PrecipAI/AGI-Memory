/**
 * AGI-Memory 控制台 Mock 数据层
 *
 * 启用方式：URL 带 ?demo=1（或访问 demo.html 自动跳转 index.html?demo=1）
 * 行为：
 *   - 拦截所有 /internal/ 开头的 fetch 请求，返回内存中的 mock 数据
 *   - 审批通过 skill/rule/knowledge 类型的 proposal 时，自动往对应列表追加新条目
 *   - 每个用户刷新页面后看到的都是初始版本（操作不持久化，纯内存状态）
 *   - 非 demo 模式下本脚本完全不介入，真实后端照常工作
 *
 * 数据规模：8 skill / 8 rule / 16 memory(8类全覆盖) / 10 knowledge /
 *           12 entity / 12 fact / 12 evidence / 10 proposal / 8 history /
 *           10 runs / 45+ relations（每个节点都至少有 1 条边）
 */
(function () {
  "use strict";

  // ===== 1. 判断是否启用 demo 模式 =====
  const params = new URLSearchParams(location.search);
  const isDemoMode = params.get("demo") === "1" || params.get("demo") === "true";
  if (!isDemoMode) return; // 真实模式：本脚本退出，不干预任何逻辑

  // ===== 2. 工具函数 =====
  const now = () => new Date().toISOString();
  const iso = (offsetDays) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString();
  };
  const deepClone = (obj) => JSON.parse(JSON.stringify(obj));
  const rid = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

  // ===== 3. 初始 Mock 数据（每个用户刷新都从这里深拷贝）=====
  const INITIAL = {
    // ---------- Skills（8 条）----------
    skills: [
      {
        id: "skill-paper-research-001",
        skill_key: "research.paper.literature",
        title: "学术论文文献调研 Skill",
        source_kind: "l1_extracted",
        origin_scope: "session_memory",
        availability_scope: "project_reusable",
        scope: "project_reusable",
        skill_type: "procedural",
        risk_level: "low",
        version: 2,
        status: "active",
        description: "基于研究主题，自动检索相关文献、提取关键论点、生成结构化综述，并标注引用关系。支持中英文文献混合调研。",
        applicable_scenarios: ["论文开题", "文献综述撰写", "研究方向调研", "相关工作章节"],
        non_applicable_scenarios: ["实时数据采集", "实验室原始数据处理"],
        procedure_payload: {
          host_action: { status: "generated", summary: "已生成 SOP 文件 research-paper-lit-review.md" },
          steps: [
            { step: 1, action: "parse_topic", description: "解析研究主题，提取关键词和检索范围" },
            { step: 2, action: "search_corpus", description: "在 arXiv / Google Scholar / CNKI 检索相关文献" },
            { step: 3, action: "extract_claims", description: "逐篇提取核心论点、方法、结论" },
            { step: 4, action: "cluster_synthesis", description: "按主题聚类，生成结构化综述草稿" },
            { step: 5, action: "annotate_citations", description: "标注引用关系，输出 BibTeX 条目" }
          ]
        },
        trigger_conditions: { rules: ["user.request.paper_research", "task.type == 'literature_review'"], stages: ["planning", "reporting"] },
        metadata: { call_count: 18 },
        success_rate: 91,
        recall_count: 18,
        created_at: iso(-30),
        utility_score: 0.88
      },
      {
        id: "skill-tech-blog-002",
        skill_key: "write.blog.technical",
        title: "技术博客撰写 Skill",
        source_kind: "l1_extracted",
        origin_scope: "session_memory",
        availability_scope: "project_reusable",
        scope: "project_reusable",
        skill_type: "procedural",
        risk_level: "low",
        version: 1,
        status: "active",
        description: "根据技术主题或代码片段，生成结构清晰、可读性强的技术博客文章，自动配图说明和代码注释。",
        applicable_scenarios: ["技术分享", "团队知识沉淀", "开源项目文档", "个人博客"],
        non_applicable_scenarios: ["营销文案", "新闻稿"],
        procedure_payload: {
          host_action: { status: "generated", summary: "已生成 SOP 文件 write-tech-blog.md" },
          steps: [
            { step: 1, action: "extract_core", description: "从代码或主题中提取核心知识点" },
            { step: 2, action: "outline_structure", description: "构建文章骨架（问题→方案→实践→总结）" },
            { step: 3, action: "draft_content", description: "逐节填充内容，自动补充示例代码" },
            { step: 4, action: "polish_style", description: "调整语气、补充配图说明、检查可读性" }
          ]
        },
        trigger_conditions: { rules: ["user.request.blog", "task.type == 'technical_writing'"], stages: ["reporting"] },
        metadata: { call_count: 27 },
        success_rate: 85,
        recall_count: 27,
        created_at: iso(-25),
        utility_score: 0.78
      },
      {
        id: "skill-code-review-003",
        skill_key: "review.code.quality",
        title: "代码审查 Skill",
        source_kind: "governance_approved",
        origin_scope: "governance",
        availability_scope: "tenant_global",
        scope: "tenant_global",
        skill_type: "analytical",
        risk_level: "medium",
        version: 3,
        status: "active",
        description: "对提交的代码变更进行多维度审查，包括逻辑正确性、安全风险、性能瓶颈、可维护性和命名规范，输出结构化审查报告。",
        applicable_scenarios: ["PR 审查", "代码合并前检查", "技术债评估", "团队代码质量度量"],
        non_applicable_scenarios: ["运行时性能监控", "线上故障诊断"],
        procedure_payload: {
          host_action: { status: "generated", summary: "已生成 SOP 文件 code-review-checklist.md" },
          steps: [
            { step: 1, action: "diff_analysis", description: "解析变更范围，识别影响面" },
            { step: 2, action: "static_check", description: "检查类型、空值、边界条件" },
            { step: 3, action: "security_scan", description: "识别注入、越权、敏感信息泄露" },
            { step: 4, action: "performance_hint", description: "标注潜在 N+1、O(n²) 循环" },
            { step: 5, action: "report_gen", description: "生成结构化审查报告，含严重等级和建议" }
          ]
        },
        trigger_conditions: { rules: ["event.pull_request.opened", "task.type == 'code_review'"], stages: ["review", "governance"] },
        metadata: { call_count: 142, generated_from_proposal: "prop-skill-code-review-old" },
        success_rate: 93,
        recall_count: 142,
        created_at: iso(-45),
        utility_score: 0.95
      },
      {
        id: "skill-ppt-gen-004",
        skill_key: "generate.ppt.presentation",
        title: "演示文稿制作 Skill",
        source_kind: "governance_approved",
        origin_scope: "governance",
        availability_scope: "project_reusable",
        scope: "project_reusable",
        skill_type: "generative",
        risk_level: "low",
        version: 1,
        status: "active",
        description: "基于用户提纲、素材和场景，自动生成结构化演示文稿，包含封面、目录、内容页和总结页，支持主题模板选择和内容密度控制。",
        applicable_scenarios: ["产品演示", "技术分享", "学术汇报", "项目立项", "季度总结"],
        non_applicable_scenarios: ["实时协作编辑", "复杂动画设计", "数据可视化图表生成"],
        procedure_payload: {
          host_action: { status: "generated", summary: "已生成 SOP 文件 generate-ppt.md" },
          steps: [
            { step: 1, action: "parse_outline", description: "解析用户提纲，提取核心主题、章节结构和每页要点" },
            { step: 2, action: "select_template", description: "根据场景（产品/学术/内部）选择视觉模板" },
            { step: 3, action: "generate_slides", description: "逐页生成内容，自动配图建议和排版" },
            { step: 4, action: "density_check", description: "检查信息密度，单页文字不超过 6 行" },
            { step: 5, action: "export", description: "输出 .pptx 或 Markdown 格式" }
          ]
        },
        trigger_conditions: { rules: ["user.request.ppt", "task.type == 'slide_generation'"], stages: ["reporting", "design"] },
        metadata: { call_count: 23, generated_from_proposal: "prop-skill-ppt-001" },
        success_rate: 87,
        recall_count: 23,
        created_at: iso(-9),
        utility_score: 0.81
      },
      {
        id: "skill-api-test-005",
        skill_key: "test.api.contract",
        title: "API 契约测试 Skill",
        source_kind: "l1_extracted",
        origin_scope: "session_memory",
        availability_scope: "project_reusable",
        scope: "project_reusable",
        skill_type: "analytical",
        risk_level: "low",
        version: 1,
        status: "active",
        description: "基于 OpenAPI/GraphQL Schema 自动生成契约测试用例，覆盖 happy path、边界条件、错误响应和字段类型校验。",
        applicable_scenarios: ["API 接入测试", "契约稳定性回归", "接口文档校验"],
        non_applicable_scenarios: ["性能压测", "UI 自动化测试"],
        procedure_payload: {
          host_action: { status: "generated", summary: "已生成 SOP 文件 api-contract-test.md" },
          steps: [
            { step: 1, action: "load_schema", description: "加载 OpenAPI/Swagger/GraphQL Schema" },
            { step: 2, action: "gen_happy_path", description: "按端点生成正向调用用例" },
            { step: 3, action: "gen_boundary", description: "针对必填字段生成边界与缺失用例" },
            { step: 4, action: "gen_error_path", description: "覆盖 4xx/5xx 错误响应断言" },
            { step: 5, action: "run_and_report", description: "执行用例，输出通过率与失败原因" }
          ]
        },
        trigger_conditions: { rules: ["event.api.deployed", "task.type == 'contract_test'"], stages: ["review"] },
        metadata: { call_count: 9 },
        success_rate: 88,
        recall_count: 9,
        created_at: iso(-6),
        utility_score: 0.74
      },
      {
        id: "skill-perf-optimize-006",
        skill_key: "optimize.code.performance",
        title: "性能瓶颈定位 Skill",
        source_kind: "l1_extracted",
        origin_scope: "session_memory",
        availability_scope: "project_reusable",
        scope: "project_reusable",
        skill_type: "analytical",
        risk_level: "medium",
        version: 1,
        status: "active",
        description: "通过火焰图、慢查询日志和埋点指标定位性能瓶颈，给出优化建议并预估收益。",
        applicable_scenarios: ["接口 RT 抖动排查", "数据库慢查询优化", "首屏加载优化"],
        non_applicable_scenarios: ["业务逻辑错误排查", "UI 视觉问题"],
        procedure_payload: {
          host_action: { status: "generated", summary: "已生成 SOP 文件 perf-bottleneck.md" },
          steps: [
            { step: 1, action: "collect_trace", description: "收集火焰图与慢查询日志" },
            { step: 2, action: "cluster_hotspot", description: "聚类热点函数，识别 topN 耗时项" },
            { step: 3, action: "diagnose", description: "判断 CPU/IO/锁/网络瓶颈类型" },
            { step: 4, action: "suggest_fix", description: "给出优化建议和预估收益" }
          ]
        },
        trigger_conditions: { rules: ["alert.rt.p99_too_high", "task.type == 'performance_optimize'"], stages: ["incident"] },
        metadata: { call_count: 5 },
        success_rate: 80,
        recall_count: 5,
        created_at: iso(-4),
        utility_score: 0.69
      },
      {
        id: "skill-tech-debt-007",
        skill_key: "cleanup.tech.debt",
        title: "技术债清理 Skill",
        source_kind: "l1_extracted",
        origin_scope: "session_memory",
        availability_scope: "project_reusable",
        scope: "project_reusable",
        skill_type: "procedural",
        risk_level: "medium",
        version: 1,
        status: "active",
        description: "扫描 TODO/FIXME/重复代码、未使用依赖、过期 API，生成可分批清理的技术债清单。",
        applicable_scenarios: ["迭代间隙技术债治理", "升级前依赖梳理"],
        non_applicable_scenarios: ["线上故障修复", "新功能开发"],
        procedure_payload: {
          host_action: { status: "generated", summary: "已生成 SOP 文件 tech-debt-cleanup.md" },
          steps: [
            { step: 1, action: "scan_todos", description: "扫描 TODO/FIXME/HACK 标记" },
            { step: 2, action: "scan_deps", description: "识别过期与未使用依赖" },
            { step: 3, action: "rank", description: "按风险与修复成本排序" },
            { step: 4, action: "batch_plan", description: "生成分批清理建议" }
          ]
        },
        trigger_conditions: { rules: ["schedule.weekly.tech_debt", "task.type == 'debt_cleanup'"], stages: ["maintenance"] },
        metadata: { call_count: 12 },
        success_rate: 90,
        recall_count: 12,
        created_at: iso(-12),
        utility_score: 0.72
      },
      {
        id: "skill-doc-rewrite-008",
        skill_key: "rewrite.doc.legacy",
        title: "遗留文档重写 Skill",
        source_kind: "l1_extracted",
        origin_scope: "session_memory",
        availability_scope: "project_reusable",
        scope: "project_reusable",
        skill_type: "creative",
        risk_level: "low",
        version: 1,
        status: "active",
        description: "将过时的 README/Wiki/接口文档按当前实现重写，保留原有意图，补充示例和迁移说明。",
        applicable_scenarios: ["版本升级文档同步", "接口文档回归", "新人 onboarding"],
        non_applicable_scenarios: ["新文档从零撰写", "营销文案"],
        procedure_payload: {
          host_action: { status: "generated", summary: "已生成 SOP 文件 doc-rewrite.md" },
          steps: [
            { step: 1, action: "diff_doc_code", description: "对比文档与代码实现的偏差" },
            { step: 2, action: "extract_intent", description: "提取原文档的真实意图" },
            { step: 3, action: "rewrite", description: "按当前实现重写，保留意图" },
            { step: 4, action: "annotate_migration", description: "补充迁移/兼容说明" }
          ]
        },
        trigger_conditions: { rules: ["event.release.tagged", "task.type == 'doc_rewrite'"], stages: ["reporting"] },
        metadata: { call_count: 7 },
        success_rate: 92,
        recall_count: 7,
        created_at: iso(-8),
        utility_score: 0.67
      },
      // ---------- 宿主自带 Skill（42 条，来自 hostBootstrap）----------
      ...[
        { key: "frontend-design", title: "Frontend Design Skill", type: "generative", desc: "创建独特的、生产级的前端界面，具有高设计质量。用于构建 web 组件、页面、artifact、poster 或应用", tags: ["frontend", "design", "ui"] },
        { key: "frontend-skill", title: "Frontend Skill", type: "generative", desc: "用于视觉强烈的 landing page、网站、应用、原型、demo 或游戏 UI。强调克制构图、图像主导层级、动效", tags: ["frontend", "landing", "prototype"] },
        { key: "web-dev", title: "Web Dev Skill", type: "generative", desc: "创建生产级 Web 界面，高设计质量。仅在用户明确要求从零构建新网站/页面/应用时使用", tags: ["web", "development", "frontend"] },
        { key: "algorithmic-art", title: "Algorithmic Art Skill", type: "generative", desc: "使用 p5.js 创建算法艺术，带种子随机和交互参数探索。用于生成艺术、流场、粒子系统", tags: ["art", "p5js", "generative"] },
        { key: "canvas-design", title: "Canvas Design Skill", type: "generative", desc: "创建美丽的视觉艺术 .png/.pdf 文档。用于 poster、艺术品、设计稿等静态作品", tags: ["canvas", "art", "design"] },
        { key: "git-commit", title: "Git Commit Skill", type: "procedural", desc: "执行 git commit，带 conventional commit message 分析、智能暂存和消息生成。支持自动检测 type/scope", tags: ["git", "commit", "vcs"] },
        { key: "interview", title: "Interview Skill", type: "procedural", desc: "智能访谈确认用户真实意图，挖掘隐含需求，补全关键条件。生成结构化 SPEC 并严格执行", tags: ["interview", "spec", "requirement"] },
        { key: "skill-creator", title: "Skill Creator", type: "procedural", desc: "创建 SKILLs 的强制工具。用户想创建/添加任何 skill 时必须立即调用", tags: ["skill", "creator", "meta"] },
        { key: "GateMaster", title: "GateMaster Skill", type: "procedural", desc: "将审批通过的 Rule 翻译为宿主可执行的 Hook 代码并注册到 Gate Registry", tags: ["gate", "hook", "rule"] },
        { key: "skill-creator-legacy", title: "Skill Creator (Legacy)", type: "procedural", desc: "将治理系统审批通过的 skill 记录转换为宿主可识别的 SKILL.md 文件", tags: ["skill", "converter", "meta"] },
        { key: "TRAE-product-knowledge", title: "TRAE Product Knowledge Skill", type: "knowledge", desc: "TRAE 品牌身份和官方产品知识问答，包括 TRAE IDE/Work/CLI/Plugin 入口、MCP、Skills、官方文档", tags: ["trae", "product", "knowledge"] },
        { key: "memory-lifecycle", title: "Memory Lifecycle Skill", type: "knowledge", desc: "触发 memory-service 的 lifecycle 维护任务（重算 importance_weight、归档低权重知识、阈值校准）", tags: ["memory", "lifecycle", "maintenance"] },
        { key: "douyin-interact-creation", title: "Douyin Interact Creation Skill", type: "publishing", desc: "为 interact_creation 创建或升级离线 H5 体验，生成单个 index.html 或可上传的 .zip", tags: ["douyin", "h5", "interactive"] },
        { key: "douyin-interactive-content-publish", title: "Douyin Interactive Content Publish Skill", type: "publishing", desc: "互动空间一键发布工具，上传 zip+icon 创建/更新互动空间应用", tags: ["douyin", "publish", "interactive"] },
        { key: "figma", title: "Figma Skill", type: "integration", desc: "使用 Figma MCP 服务器获取设计上下文、截图、变量和资产，将 Figma 节点翻译为生产代码", tags: ["figma", "design", "mcp"] },
        { key: "lark-approval", title: "Lark Approval Skill", type: "integration", desc: "飞书审批：查询和处理审批待办/已办/实例，搜索审批定义、查看详情并发起审批", tags: ["lark", "approval", "feishu"] },
        { key: "lark-apps", title: "Lark Apps Skill", type: "integration", desc: "妙搭（Spark/Miaoda）应用开发与托管：应用创建、HTML 静态站点发布、本地全栈开发、云端生成迭代", tags: ["lark", "apps", "spark"] },
        { key: "lark-attendance", title: "Lark Attendance Skill", type: "integration", desc: "飞书考勤打卡：查询自己的考勤打卡记录", tags: ["lark", "attendance", "feishu"] },
        { key: "lark-base", title: "Lark Base Skill", type: "integration", desc: "飞书多维表格（Base）操作：建表、字段、记录、视图、统计、公式、表单、仪表盘、workflow", tags: ["lark", "base", "bitable"] },
        { key: "lark-calendar", title: "Lark Calendar Skill", type: "integration", desc: "飞书日历：管理日历日程和会议室，查看/搜索日程、创建/更新日程、查询忙闲和推荐时段", tags: ["lark", "calendar", "feishu"] },
        { key: "lark-contact", title: "Lark Contact Skill", type: "integration", desc: "飞书通讯录：按姓名/邮箱解析成 open_id，或按 open_id 反查姓名/部门/邮箱/联系方式", tags: ["lark", "contact", "feishu"] },
        { key: "lark-doc", title: "Lark Doc Skill", type: "integration", desc: "飞书云文档（Docx/Wiki 文档）：读取和编辑文档内容，插入或下载文档图片附件", tags: ["lark", "doc", "feishu"] },
        { key: "lark-drive", title: "Lark Drive Skill", type: "integration", desc: "飞书云空间（云盘）：管理文件和文件夹，上传/下载、复制/移动/删除、权限管理", tags: ["lark", "drive", "feishu"] },
        { key: "lark-event", title: "Lark Event Skill", type: "integration", desc: "Lark 实时事件监听：stream events as NDJSON，支持 IM 消息/任务更新/会议结束等事件", tags: ["lark", "event", "stream"] },
        { key: "lark-im", title: "Lark IM Skill", type: "integration", desc: "飞书即时通讯：收发消息和管理群聊，发送和回复消息、搜索聊天记录、管理群成员", tags: ["lark", "im", "feishu"] },
        { key: "lark-mail", title: "Lark Mail Skill", type: "integration", desc: "飞书邮箱：起草/发送/回复/转发邮件，查阅/搜索邮件，管理邮件文件夹和标签", tags: ["lark", "mail", "feishu"] },
        { key: "lark-markdown", title: "Lark Markdown Skill", type: "integration", desc: "飞书 Markdown：查看、创建、上传、编辑和比较 Markdown 文件", tags: ["lark", "markdown", "feishu"] },
        { key: "lark-minutes", title: "Lark Minutes Skill", type: "integration", desc: "飞书妙记：搜索妙记、查看基础信息、下载/上传音视频、读取或编辑妙记产物内容", tags: ["lark", "minutes", "feishu"] },
        { key: "lark-note", title: "Lark Note Skill", type: "integration", desc: "飞书会议纪要（Note）直查：已知 note_id 时查询纪要详情、展示类型、关联文档 token", tags: ["lark", "note", "feishu"] },
        { key: "lark-okr", title: "Lark OKR Skill", type: "integration", desc: "飞书 OKR：管理目标与关键结果，查看和编辑 OKR 周期、目标、关键结果、对齐关系", tags: ["lark", "okr", "feishu"] },
        { key: "lark-openapi-explorer", title: "Lark OpenAPI Explorer Skill", type: "integration", desc: "飞书原生 OpenAPI 探索：从官方文档库挖掘未经 CLI 封装的原生 OpenAPI 接口", tags: ["lark", "openapi", "explorer"] },
        { key: "lark-shared", title: "Lark Shared Skill", type: "integration", desc: "Lark CLI 认证设置：首次设置 lark-cli、运行 auth login、切换身份、处理权限错误", tags: ["lark", "auth", "setup"] },
        { key: "lark-sheets", title: "Lark Sheets Skill", type: "integration", desc: "飞书电子表格：创建和操作电子表格，管理工作表与行列结构、读写单元格、图表、透视表", tags: ["lark", "sheets", "feishu"] },
        { key: "lark-skill-maker", title: "Lark Skill Maker Skill", type: "integration", desc: "创建 lark-cli 的自定义 Skill，把飞书 API 操作封装成可复用的 Skill", tags: ["lark", "skill", "maker"] },
        { key: "lark-slides", title: "Lark Slides Skill", type: "integration", desc: "飞书幻灯片：创建和编辑幻灯片，管理幻灯片页面（创建、删除、读取、局部替换）", tags: ["lark", "slides", "feishu"] },
        { key: "lark-task", title: "Lark Task Skill", type: "integration", desc: "飞书任务：管理任务、清单和任务智能体，创建待办、查看更新状态、拆分子任务", tags: ["lark", "task", "feishu"] },
        { key: "lark-vc", title: "Lark VC Skill", type: "integration", desc: "飞书视频会议：搜索历史会议记录、查询会议纪要、查询参会人快照", tags: ["lark", "vc", "feishu"] },
        { key: "lark-vc-agent", title: "Lark VC Agent Skill", type: "integration", desc: "飞书视频会议会中能力：让应用机器人真实加入/离开会议，读取会中事件", tags: ["lark", "vc", "agent"] },
        { key: "lark-whiteboard", title: "Lark Whiteboard Skill", type: "integration", desc: "飞书画板：查询和编辑飞书云文档中的画板，导出预览图片、导出原始节点结构", tags: ["lark", "whiteboard", "feishu"] },
        { key: "lark-wiki", title: "Lark Wiki Skill", type: "integration", desc: "飞书知识库：管理知识空间、空间成员和文档节点，创建查询知识空间、管理节点层级", tags: ["lark", "wiki", "feishu"] },
        { key: "lark-workflow-meeting-summary", title: "Lark Workflow Meeting Summary Skill", type: "integration", desc: "会议纪要整理工作流：汇总指定时间范围内的会议纪要并生成结构化报告", tags: ["lark", "workflow", "summary"] },
        { key: "lark-workflow-standup-report", title: "Lark Workflow Standup Report Skill", type: "integration", desc: "日程待办摘要：编排 calendar+agenda 和 task+get-my-tasks，生成指定日期的日程与任务摘要", tags: ["lark", "workflow", "standup"] }
      ].map((s, i) => ({
        id: `skill-host-${String(i + 1).padStart(3, "0")}`,
        skill_key: s.key,
        title: s.title,
        source_kind: "host_mounted",
        origin_scope: "global",
        availability_scope: "global_reusable",
        scope: "global_reusable",
        skill_type: s.type,
        risk_level: s.tags.includes("high") ? "high" : s.tags.includes("medium") ? "medium" : "low",
        version: 1,
        status: "active",
        description: s.desc,
        applicable_scenarios: s.tags,
        non_applicable_scenarios: [],
        procedure_payload: { host_action: { status: "mounted", summary: `${s.title} 已挂载` }, steps: [] },
        trigger_conditions: { rules: [`skill.${s.key}`], stages: ["execution"] },
        metadata: { call_count: 0 },
        success_rate: 100,
        recall_count: 0,
        created_at: iso(0),
        utility_score: 0.85
      }))
    ],

    // ---------- Rules（8 条）----------
    rules: [
      {
        id: "rule-config-backup-001",
        rule_key: "guard.config.backup_before_change",
        title: "修改公共配置前必须备份",
        enforcement_level: "hard_gate",
        priority: "P0",
        risk_level: "high",
        version: 1,
        status: "active",
        rule_domain: "governance",
        rule_type: "precondition",
        origin_scope: "admin_seed",
        availability_scope: "tenant_global",
        scope: "tenant_global",
        applies_to: ["governance", "integration"],
        statement: "任何对公共配置文件（如 .env、render.yaml、host config）的修改操作，必须先创建备份并记录变更原因，否则操作被门禁拦截。",
        trigger_conditions: { condition: "operation.target matches '*.env' OR operation.target matches '*.yaml'", action: "require_backup" },
        metadata: {
          host_action: { status: "enabled", summary: "拦截未备份的配置修改请求" },
          human_readable_statement: "修改公共配置前必须先备份，并记录变更原因。未备份的修改请求将被门禁拦截。",
          machine_executable_ast: { trigger: "config_change", conditions: ["target.match('*.env')", "target.match('*.yaml')"], action: "require_backup", mandate: "block_on_missing" },
          source_refs: [{ source_kind: "session", source_excerpt: "用户讨论部署配置变更时多次出错，决定固化此规则", source_timestamp: iso(-40) }],
          source_excerpt: "配置变更事故复盘"
        },
        evidence_refs: [],
        source_refs: [{ uri: "incident://config-rollback-2024", excerpt: "配置回滚事故根因分析" }],
        supersedes_rule_id: null,
        recall_count: 36,
        created_at: iso(-40),
        utility_score: 0.92
      },
      {
        id: "rule-audit-log-002",
        rule_key: "guard.risk.audit_log_required",
        title: "高风险操作必须留审计日志",
        enforcement_level: "hard_gate",
        priority: "P0",
        risk_level: "high",
        version: 2,
        status: "active",
        rule_domain: "governance",
        rule_type: "postcondition",
        origin_scope: "periodic_mining",
        availability_scope: "tenant_global",
        scope: "tenant_global",
        applies_to: ["governance", "integration", "review"],
        statement: "对标记为 high 风险的操作（如删除数据、覆写规则、清理知识库），必须写入审计日志并附操作者身份与理由，未记录则回滚。",
        trigger_conditions: { condition: "operation.risk_level == 'high'", action: "write_audit_log" },
        metadata: {
          host_action: { status: "enabled", summary: "高风险操作自动记录审计日志" },
          human_readable_statement: "高风险操作必须留审计日志，未记录则回滚操作。",
          machine_executable_ast: { trigger: "high_risk_operation", conditions: ["risk_level == 'high'"], action: "write_audit_log", mandate: "rollback_on_missing" },
          source_refs: [{ source_kind: "session", source_excerpt: "团队约定高风险操作必须可追溯", source_timestamp: iso(-35) }],
          source_excerpt: "安全合规基线"
        },
        evidence_refs: [],
        source_refs: [],
        supersedes_rule_id: null,
        recall_count: 58,
        created_at: iso(-35),
        utility_score: 0.88
      },
      {
        id: "rule-typecheck-003",
        rule_key: "guard.code.typecheck_before_commit",
        title: "提交前必须通过类型检查",
        enforcement_level: "soft_advisory",
        priority: "P1",
        risk_level: "medium",
        version: 1,
        status: "active",
        rule_domain: "coding",
        rule_type: "precondition",
        origin_scope: "governance",
        availability_scope: "tenant_global",
        scope: "tenant_global",
        applies_to: ["coding", "review"],
        statement: "代码提交前必须通过 tsc --noEmit 类型检查，存在类型错误时给出警告并建议修复，但不强制阻塞（团队可配置为硬门禁）。",
        trigger_conditions: { condition: "event.commit.before", action: "run_typecheck" },
        metadata: {
          host_action: { status: "enabled", summary: "提交前自动运行 tsc 类型检查" },
          human_readable_statement: "提交代码前必须通过类型检查，建议修复所有类型错误。",
          machine_executable_ast: { trigger: "pre_commit", conditions: ["event == 'commit.before'"], action: "run_tsc_noEmit", mandate: "warn_on_error" },
          source_refs: [{ source_kind: "session", source_excerpt: "用户从治理流程中固化下来的提交前检查规则", source_timestamp: iso(-20) }],
          source_excerpt: "类型错误导致线上事故复盘"
        },
        evidence_refs: [],
        source_refs: [],
        supersedes_rule_id: null,
        recall_count: 89,
        created_at: iso(-20),
        utility_score: 0.78
      },
      {
        id: "rule-build-gate-004",
        rule_key: "guard.build.compile_required",
        title: "提交前必须通过完整编译",
        enforcement_level: "hard_gate",
        priority: "P0",
        risk_level: "high",
        version: 1,
        status: "active",
        rule_domain: "coding",
        rule_type: "precondition",
        origin_scope: "governance",
        availability_scope: "tenant_global",
        scope: "tenant_global",
        applies_to: ["coding", "review", "governance"],
        statement: "代码提交前必须通过完整编译（npm run build 或等价命令），存在编译错误时门禁拦截提交并要求修复。编译输出必须包含错误计数和受影响文件清单。",
        trigger_conditions: { condition: "event.commit.before", action: "run_full_build" },
        metadata: {
          host_action: { status: "enabled", summary: "提交前自动运行完整编译" },
          human_readable_statement: "提交代码前必须通过完整编译，编译失败时提交被拦截。",
          machine_executable_ast: { trigger: "pre_commit", conditions: ["event == 'commit.before'"], action: "run_npm_build", mandate: "block_on_error" }
        },
        evidence_refs: [],
        source_refs: [{ uri: "session://compile-fail-2025", excerpt: "近 3 次 CI 编译失败复盘" }],
        supersedes_rule_id: null,
        recall_count: 14,
        created_at: iso(-7),
        utility_score: 0.84
      },
      {
        id: "rule-self-test-005",
        rule_key: "guard.delivery.self_test_required",
        title: "提交给用户前必须自测",
        enforcement_level: "hard_gate",
        priority: "P0",
        risk_level: "high",
        version: 1,
        status: "active",
        rule_domain: "governance",
        rule_type: "precondition",
        origin_scope: "governance",
        availability_scope: "tenant_global",
        scope: "tenant_global",
        applies_to: ["governance", "review", "reporting"],
        statement: "任何交付给用户的产物（代码、文档、配置变更）在提交前必须经过自测，自测范围包括：基础功能验证、边界条件检查、错误路径验证。自测结果必须记录，未通过自测的交付被门禁拦截。",
        trigger_conditions: { condition: "event.deliver.before", action: "run_self_test" },
        metadata: {
          host_action: { status: "enabled", summary: "交付前自测门禁" },
          human_readable_statement: "提交给用户前必须自测，自测未通过的交付被拦截。",
          machine_executable_ast: { trigger: "pre_delivery", conditions: ["event == 'deliver.before'"], action: "run_self_test_suite", mandate: "block_on_failure" }
        },
        evidence_refs: [],
        source_refs: [],
        supersedes_rule_id: null,
        recall_count: 21,
        created_at: iso(-7),
        utility_score: 0.86
      },
      {
        id: "rule-no-sycophancy-006",
        rule_key: "guard.tone.no_sycophancy",
        title: "禁止使用讨好用户的语气",
        enforcement_level: "soft_advisory",
        priority: "P1",
        risk_level: "medium",
        version: 1,
        status: "active",
        rule_domain: "governance",
        rule_type: "postcondition",
        origin_scope: "user_direct",
        availability_scope: "user_private",
        scope: "user_private",
        applies_to: ["governance", "reporting"],
        statement: "生成回复时禁止使用讨好式语气，包括但不限于：'您说得对'、'非常好的问题'、'完全理解您的需求'、'您真专业'、'这正是我想说的'。应保持直接、客观、必要时带适度幽默的沟通风格，敢于指出问题而非一味附和。",
        trigger_conditions: { condition: "event.reply.before_send", action: "check_tone" },
        metadata: {
          host_action: { status: "enabled", summary: "回复发送前扫描讨好短语" },
          human_readable_statement: "禁止使用讨好用户的语气，回复应直接客观、敢于指出问题。",
          machine_executable_ast: { trigger: "pre_send_reply", conditions: ["event == 'reply.before_send'"], action: "scan_sycophantic_phrases", mandate: "warn_and_rewrite" }
        },
        evidence_refs: [],
        source_refs: [],
        supersedes_rule_id: null,
        recall_count: 33,
        created_at: iso(-3),
        utility_score: 0.62
      },
      {
        id: "rule-test-coverage-007",
        rule_key: "guard.test.coverage_threshold",
        title: "核心模块测试覆盖率不低于 80%",
        enforcement_level: "soft_advisory",
        priority: "P2",
        risk_level: "medium",
        version: 1,
        status: "active",
        rule_domain: "coding",
        rule_type: "precondition",
        origin_scope: "team_memory",
        availability_scope: "tenant_global",
        scope: "tenant_global",
        applies_to: ["coding", "review"],
        statement: "核心模块（services/* 与 libs/*）单测覆盖率不低于 80%，新增代码不低于 90%。覆盖率不足时给出警告，团队可配置为硬门禁。",
        trigger_conditions: { condition: "event.commit.before", action: "check_coverage" },
        metadata: {
          host_action: { status: "enabled", summary: "提交前检查覆盖率阈值" },
          human_readable_statement: "核心模块测试覆盖率不低于 80%，新增代码不低于 90%。",
          machine_executable_ast: { trigger: "pre_commit", conditions: ["event == 'commit.before'"], action: "run_coverage_check", mandate: "warn_on_below" }
        },
        evidence_refs: [],
        source_refs: [],
        supersedes_rule_id: null,
        recall_count: 17,
        created_at: iso(-11),
        utility_score: 0.73
      },
      {
        id: "rule-deps-audit-008",
        rule_key: "guard.deps.audit_required",
        title: "依赖变更必须通过安全审计",
        enforcement_level: "hard_gate",
        priority: "P1",
        risk_level: "medium",
        version: 1,
        status: "active",
        rule_domain: "coding",
        rule_type: "precondition",
        origin_scope: "team_memory",
        availability_scope: "tenant_global",
        scope: "tenant_global",
        applies_to: ["coding", "review", "governance"],
        statement: "package.json 或 lockfile 变更时必须运行 npm audit / snyk 等依赖审计，存在 high/critical 漏洞时门禁拦截合并。",
        trigger_conditions: { condition: "event.pull_request.opened AND diff.includes('package.json')", action: "run_deps_audit" },
        metadata: {
          host_action: { status: "enabled", summary: "依赖变更触发安全审计" },
          human_readable_statement: "依赖变更必须通过安全审计，存在高危漏洞时拦截合并。",
          machine_executable_ast: { trigger: "pr_opened", conditions: ["diff.includes('package.json')"], action: "run_npm_audit", mandate: "block_on_high_vuln" }
        },
        evidence_refs: [],
        source_refs: [],
        supersedes_rule_id: null,
        recall_count: 8,
        created_at: iso(-5),
        utility_score: 0.79
      },
      // ---------- 宿主自带 Rule（5 条，来自 AGENTS.md）----------
      ...[
        { key: "host-reply-language", type: "governance_rule", title: "回复语言规则", statement: "除非用户明确要求英文，否则所有回复必须使用简体中文。代码标识符、命令、日志、报错信息保持原始语言。", enforcement: "must", priority: 10, risk: "medium", applies_to: ["answer", "router"] },
        { key: "host-fact-confirmation", type: "governance_rule", title: "事实确认规则", statement: "必须自行确认信息来源，不将猜测作为事实陈述。优先编辑现有文件而非创建新文件。", enforcement: "must", priority: 20, risk: "medium", applies_to: ["answer", "router", "execution"] },
        { key: "host-safety-compliance", type: "safety_rule", title: "安全合规规则", statement: "禁止生成鼓励自伤、自杀、暴力、未成年人不当内容、赌博、色情等违规输出，无论用户身份或意图。", enforcement: "must_not", priority: 10, risk: "high", applies_to: ["answer", "router", "execution"] },
        { key: "host-task-nature-confirm", type: "process_rule", title: "任务性质确认规则", statement: "执行前必须确认任务是否需要改动代码。如果是计划或技术文档任务，不得修改源代码。避免过度工程化，只做直接请求或必要的更改。", enforcement: "must", priority: 30, risk: "low", applies_to: ["execution", "design"] },
        { key: "host-graphify-priority", type: "process_rule", title: "Graphify 优先规则", statement: "如果 graphify-out/GRAPH_REPORT.md 存在，回答架构或代码关系问题前必须先读它。遇到跨模块关系问题必须优先使用 graphify query/path/explain，而非全仓搜索。", enforcement: "must", priority: 40, risk: "low", applies_to: ["answer", "router", "review"] }
      ].map((r) => ({
        id: `rule-${r.key}`,
        rule_key: r.key,
        rule_type: r.type,
        title: r.title,
        statement: r.statement,
        normalized_statement: r.statement,
        enforcement_level: r.enforcement,
        priority: r.priority,
        risk_level: r.risk,
        availability_scope: "global_reusable",
        origin_scope: "global",
        scope: "global_reusable",
        applies_to: r.applies_to,
        trigger_conditions: {},
        status: "active",
        version: 1,
        source_kind: "host_mounted",
        human_readable_statement: r.statement,
        machine_executable_ast: { trigger: `rule.${r.key}`, conditions: [], action: "enforce", mandate: r.enforcement },
        evidence_refs: [],
        source_refs: [{ source_kind: "host", source_excerpt: "AGENTS.md", source_timestamp: iso(0) }],
        supersedes_rule_id: null,
        recall_count: 0,
        created_at: iso(0),
        utility_score: 0.9
      }))
    ],

    // ---------- Memory（16 条，覆盖筛选 tab 全部 8 种类型）----------
    // memory_type 字段与 index.html 的 memory-filter-tab 完全对齐：
    // user_memory / project_memory / workspace_memory / team_memory /
    // session_memory / design_decision / integration_context
    // kind 字段保留底层语义类型（factual/resident/preference...）做实现层参考
    memory: [
      {
        id: "mem-001",
        title: "项目使用 Fastify 5.x 作为后端框架",
        memory_type: "project_memory",
        kind: "factual",
        importance: 0.82,
        confidence_score: 0.95,
        status: "active",
        availability_scope: "project_reusable",
        origin_scope: "session_memory",
        content: "memory-service 后端基于 Fastify 5.3.0，使用 @fastify/static 提供静态文件服务，监听端口 3101。开发模式用 tsx watch，生产模式用编译后的 dist 目录。",
        version: 1,
        source_kind: "session",
        source_ref: "session://architecture-discussion-2025",
        verification_status: "verified",
        recall_count: 14,
        created_at: iso(-15),
        updated_at: iso(-3),
        metadata: { source_excerpt: "架构讨论会议记录" },
        source_refs: [{ source_kind: "session", source_excerpt: "团队讨论后端框架选型", source_timestamp: iso(-15) }]
      },
      {
        id: "mem-002",
        title: "知识图谱采用同心圆洋葱布局",
        memory_type: "design_decision",
        kind: "factual",
        importance: 0.75,
        confidence_score: 0.88,
        status: "active",
        availability_scope: "project_reusable",
        origin_scope: "session_memory",
        content: "知识图谱可视化采用 5 层同心圆洋葱布局：外圈感知层（evidence/fact/entity）、知识层（knowledge）、记忆层（memory）、规则层（rule）、技能核（skill）。使用 D3.js v7 力导向 + 自定义径向力，Canvas 2D 四层径向渐变模拟 glow。",
        version: 1,
        source_kind: "session",
        source_ref: "session://onion-design-spec",
        verification_status: "verified",
        recall_count: 9,
        created_at: iso(-10),
        updated_at: iso(-2),
        metadata: { source_excerpt: "洋葱图设计 spec 讨论" },
        source_refs: [{ source_kind: "session", source_excerpt: "用户提供的 knowledge-graph-onion-spec.md", source_timestamp: iso(-10) }]
      },
      {
        id: "mem-003",
        title: "MCP 协议是宿主与 memory-service 的通信契约",
        memory_type: "integration_context",
        kind: "factual",
        importance: 0.90,
        confidence_score: 0.97,
        status: "active",
        availability_scope: "tenant_global",
        origin_scope: "session_memory",
        content: "memory-mcp-server 通过 MCP（Model Context Protocol）协议将 memory-service 的能力暴露给宿主（Codex / Claude Code / TRAE 等）。核心工具：memory_health、memory_retrieve_context、memory_ingest_candidate、memory_query_layer、memory_run_governance、rule_gate_check。",
        version: 2,
        source_kind: "session",
        source_ref: "session://mcp-integration",
        verification_status: "verified",
        recall_count: 31,
        created_at: iso(-28),
        updated_at: iso(-5),
        metadata: { source_excerpt: "MCP 集成讨论" },
        source_refs: [{ source_kind: "session", source_excerpt: "MCP 工具表设计", source_timestamp: iso(-28) }]
      },
      {
        id: "mem-004",
        title: "治理流水线分 L2/L3/L4 三层",
        memory_type: "project_memory",
        kind: "factual",
        importance: 0.85,
        confidence_score: 0.92,
        status: "active",
        availability_scope: "project_reusable",
        origin_scope: "session_memory",
        content: "治理流水线：L2 冲突检测（识别重复/相似提议）、L3 演进管理（识别知识演进信号）、L4 认知合成（生成知识）。每层产出的 proposal 进入待审批队列。",
        version: 1,
        source_kind: "session",
        source_ref: "session://governance-pipeline",
        verification_status: "verified",
        recall_count: 12,
        created_at: iso(-12),
        updated_at: iso(-4),
        metadata: { source_excerpt: "治理流水线设计" },
        source_refs: [{ source_kind: "session", source_excerpt: "L2/L3/L4 分层讨论", source_timestamp: iso(-12) }]
      },
      {
        id: "mem-005",
        title: "用户偏好简洁直接的沟通风格",
        memory_type: "user_memory",
        kind: "preference",
        importance: 0.70,
        confidence_score: 0.80,
        status: "active",
        availability_scope: "user_private",
        origin_scope: "user_direct",
        content: "用户偏好简洁直接的回答，不喜欢冗长解释和客套话。回答应直击重点，必要时用东北幽默风格活跃气氛。",
        version: 1,
        source_kind: "user",
        source_ref: "user://preference-style",
        verification_status: "verified",
        recall_count: 47,
        created_at: iso(-50),
        updated_at: iso(-1),
        metadata: { source_excerpt: "用户多次明确表达偏好" },
        source_refs: [{ source_kind: "session", source_excerpt: "用户说'别整那些虚的'", source_timestamp: iso(-50) }]
      },
      {
        id: "mem-006",
        title: "开发环境使用 PostgreSQL 16 + 本地 55432 端口",
        memory_type: "project_memory",
        kind: "factual",
        importance: 0.65,
        confidence_score: 0.85,
        status: "active",
        availability_scope: "project_reusable",
        origin_scope: "session_memory",
        content: "本地开发数据库：PostgreSQL 16，端口 55432，数据库名 super_agent_system，用户 postgres。迁移脚本通过 npm run db:migrate 执行。",
        version: 1,
        source_kind: "session",
        source_ref: "session://dev-env-setup",
        verification_status: "verified",
        recall_count: 8,
        created_at: iso(-22),
        updated_at: iso(-6),
        metadata: { source_excerpt: "开发环境配置" },
        source_refs: [{ source_kind: "session", source_excerpt: ".env 配置讨论", source_timestamp: iso(-22) }]
      },
      {
        id: "mem-007",
        title: "工作空间根目录约定与忽略规则",
        memory_type: "workspace_memory",
        kind: "factual",
        importance: 0.78,
        confidence_score: 0.91,
        status: "active",
        availability_scope: "workspace_shared",
        origin_scope: "session_memory",
        content: "工作空间约定：源码根在 agi-memory-src/，图谱产物输出到 graphify-out/，编译产物在 services/*/dist/。graphify-out/、node_modules/、dist/、.trae-cn/ 均不参与图谱重建。",
        version: 1,
        source_kind: "session",
        source_ref: "workspace://conventions",
        verification_status: "verified",
        recall_count: 11,
        created_at: iso(-19),
        updated_at: iso(-5),
        metadata: { source_excerpt: "工作空间约定" },
        source_refs: [{ source_kind: "session", source_excerpt: "AGENTS.md 工作空间规则", source_timestamp: iso(-19) }]
      },
      {
        id: "mem-008",
        title: "团队约定：所有 PR 必须至少一名同事 approve",
        memory_type: "team_memory",
        kind: "policy",
        importance: 0.88,
        confidence_score: 0.96,
        status: "active",
        availability_scope: "tenant_global",
        origin_scope: "team_memory",
        content: "团队约定：任何 PR 合并前必须至少一名同事 approve，作者自己不能 merge。涉及生产配置的 PR 还需要 SRE 副 approve。这条约定是 2024 年某次未审 PR 导致事故后固化的。",
        version: 2,
        source_kind: "session",
        source_ref: "team://pr-policy",
        verification_status: "verified",
        recall_count: 64,
        created_at: iso(-60),
        updated_at: iso(-7),
        metadata: { source_excerpt: "团队 PR 政策" },
        source_refs: [{ source_kind: "session", source_excerpt: "团队周会决议", source_timestamp: iso(-60) }]
      },
      {
        id: "mem-009",
        title: "当前会话：用户在排查知识图谱关系线高亮问题",
        memory_type: "session_memory",
        kind: "context",
        importance: 0.65,
        confidence_score: 0.99,
        status: "active",
        availability_scope: "session_private",
        origin_scope: "session_memory",
        content: "当前会话上下文：用户在迭代知识图谱页面，要求选中节点时直连边高亮加粗、显示关系类型标签；右侧改为按层分组的节点列表；详情移到下方；'合成知识'统一改叫'知识'。",
        version: 1,
        source_kind: "session",
        source_ref: "session://current-iter",
        verification_status: "verified",
        recall_count: 3,
        created_at: iso(-1),
        updated_at: iso(0),
        metadata: { source_excerpt: "当前迭代记录" },
        source_refs: [{ source_kind: "session", source_excerpt: "本轮对话 user_input", source_timestamp: iso(-1) }]
      },
      {
        id: "mem-010",
        title: "选型决策：图谱渲染用 D3 力导向而非 ECharts graph",
        memory_type: "design_decision",
        kind: "rationale",
        importance: 0.83,
        confidence_score: 0.92,
        status: "active",
        availability_scope: "project_reusable",
        origin_scope: "session_memory",
        content: "图谱渲染选 D3 forceSimulation + Canvas 2D，而非 ECharts graph。原因：①ECharts 节点超过 200 时性能急剧下降；②洋葱布局需要自定义径向力，D3 力参数更灵活；③Canvas 渲染可手动控制 glow 效果。代价：需要自己实现 hitTest 和 zoom/pan。",
        version: 1,
        source_kind: "session",
        source_ref: "session://render-selection",
        verification_status: "verified",
        recall_count: 6,
        created_at: iso(-13),
        updated_at: iso(-3),
        metadata: { source_excerpt: "渲染选型对比" },
        source_refs: [{ source_kind: "session", source_excerpt: "D3 vs ECharts 对比表", source_timestamp: iso(-13) }]
      },
      {
        id: "mem-011",
        title: "用户身份：团队技术负责人，重视代码质量",
        memory_type: "user_memory",
        kind: "identity",
        importance: 0.85,
        confidence_score: 0.94,
        status: "active",
        availability_scope: "user_private",
        origin_scope: "user_direct",
        content: "用户是团队技术负责人，长期关注代码质量与治理。偏好结构化决策（先看 spec 再写代码），反感糊弄式 PR。正在主导 AGI-Memory 项目的知识图谱与治理流水线建设。",
        version: 2,
        source_kind: "user",
        source_ref: "user://profile",
        verification_status: "verified",
        recall_count: 56,
        created_at: iso(-90),
        updated_at: iso(-2),
        metadata: { source_excerpt: "用户身份与偏好" },
        source_refs: [{ source_kind: "session", source_excerpt: "多次会话归纳", source_timestamp: iso(-90) }]
      },
      {
        id: "mem-012",
        title: "Codex 集成：通过 lark-cli 注入治理规则",
        memory_type: "integration_context",
        kind: "factual",
        importance: 0.79,
        confidence_score: 0.87,
        status: "active",
        availability_scope: "tenant_global",
        origin_scope: "session_memory",
        content: "Codex 宿主通过 lark-cli 把审批通过的 Rule 翻译为宿主可执行的 Hook 代码并注册到 Gate Registry；skill-creator 把治理审批通过的 skill 记录转换为宿主可识别的 SKILL.md。这套集成链路是 2025-03 接入的。",
        version: 1,
        source_kind: "session",
        source_ref: "session://codex-integration",
        verification_status: "verified",
        recall_count: 9,
        created_at: iso(-16),
        updated_at: iso(-4),
        metadata: { source_excerpt: "Codex 集成设计" },
        source_refs: [{ source_kind: "session", source_excerpt: "GateMaster + SkillCreator 链路", source_timestamp: iso(-16) }]
      },
      {
        id: "mem-013",
        title: "团队代码风格：遵循 AGENTS.md 的对话式人格设定",
        memory_type: "team_memory",
        kind: "policy",
        importance: 0.72,
        confidence_score: 0.88,
        status: "active",
        availability_scope: "tenant_global",
        origin_scope: "team_memory",
        content: "团队约定所有 AI 助手在 AGI-Memory 项目内的回复风格：东北幽默、说话随性、看到问题直接吐槽、勇于质疑不讨好。代码标识符与日志保持原语言，解释用中文。",
        version: 1,
        source_kind: "session",
        source_ref: "team://persona",
        verification_status: "verified",
        recall_count: 28,
        created_at: iso(-40),
        updated_at: iso(-6),
        metadata: { source_excerpt: "对话式人格设定" },
        source_refs: [{ source_kind: "session", source_excerpt: "AGENTS.md 人格章节", source_timestamp: iso(-40) }]
      },
      {
        id: "mem-014",
        title: "图谱节点颜色：技能用 teal、规则用 purple、记忆用 pink",
        memory_type: "design_decision",
        kind: "rationale",
        importance: 0.68,
        confidence_score: 0.85,
        status: "active",
        availability_scope: "project_reusable",
        origin_scope: "session_memory",
        content: "图谱节点配色：entity=cyan #06b6d4、fact=emerald #10b981、knowledge=amber #f59e0b、evidence=blue #3b82f6、proposal=rose #f43f5e、rule=purple #8b5cf6、memory=pink #ec4899、skill=teal #14b8a6。颜色策略：从外到内由冷到暖，核心技能用 teal 突出'行动'。",
        version: 1,
        source_kind: "session",
        source_ref: "session://color-spec",
        verification_status: "verified",
        recall_count: 7,
        created_at: iso(-9),
        updated_at: iso(-2),
        metadata: { source_excerpt: "节点配色 spec" },
        source_refs: [{ source_kind: "session", source_excerpt: "knowledgeGraphOnion.js TYPE_COLORS", source_timestamp: iso(-9) }]
      },
      {
        id: "mem-015",
        title: "TypeScript 配置：strict 模式 + noUncheckedIndexedAccess",
        memory_type: "project_memory",
        kind: "factual",
        importance: 0.74,
        confidence_score: 0.93,
        status: "active",
        availability_scope: "project_reusable",
        origin_scope: "session_memory",
        content: "项目 tsconfig 启用 strict、noUncheckedIndexedAccess、noImplicitOverride、exactOptionalPropertyTypes。所有 workspace 必须 typecheck 通过才能合并。生成的 *.d.ts 不参与图谱。",
        version: 1,
        source_kind: "session",
        source_ref: "session://tsconfig",
        verification_status: "verified",
        recall_count: 5,
        created_at: iso(-17),
        updated_at: iso(-5),
        metadata: { source_excerpt: "TypeScript 配置约定" },
        source_refs: [{ source_kind: "session", source_excerpt: "tsconfig.json 讨论", source_timestamp: iso(-17) }]
      },
      {
        id: "mem-016",
        title: "当前任务：扩充 mock 数据规模 + 拟真仪表盘",
        memory_type: "session_memory",
        kind: "context",
        importance: 0.60,
        confidence_score: 0.99,
        status: "active",
        availability_scope: "session_private",
        origin_scope: "session_memory",
        content: "当前任务：把 mock 数据翻倍（skills 8 / rules 8 / memory 16 / knowledge 10 / entities 12 / facts 12 / evidence 12）；消灭孤岛节点；仪表盘 KPI 卡片填充拟真数据；记忆类型与筛选 tab 对齐。",
        version: 1,
        source_kind: "session",
        source_ref: "session://current-task",
        verification_status: "verified",
        recall_count: 2,
        created_at: iso(0),
        updated_at: iso(0),
        metadata: { source_excerpt: "本轮迭代任务" },
        source_refs: [{ source_kind: "session", source_excerpt: "用户最新 user_input", source_timestamp: iso(0) }]
      },
      // ---------- 宿主自带 Memory（7 条，来自 AGENTS.md）----------
      ...[
        { type: "user_memory", title: "回复语言约定", content: "始终使用简体中文回复，除非用户明确要求英文。代码标识符、命令、日志、报错信息保持原始语言。", importance: 90, tags: ["host", "language", "convention"] },
        { type: "user_memory", title: "事实确认原则", content: "自行确认信息来源，不将猜测作为事实陈述。优先编辑现有文件而非创建新文件。", importance: 85, tags: ["host", "principle", "quality"] },
        { type: "project_memory", title: "任务性质确认", content: "确认任务是否需要改动代码。如果是计划或技术文档，不要动源代码。避免过度工程化。", importance: 80, tags: ["host", "task", "principle"] },
        { type: "project_memory", title: "修复影响检查", content: "对当前修改进行全面影响分析：直接影响（调用方/参数兼容/返回值）、间接影响（数据流/共享状态/回调时机）、数据结构兼容性（新增/删除/类型变更）。", importance: 82, tags: ["host", "impact", "analysis"] },
        { type: "project_memory", title: "Graphify 使用约定", content: "如果 graphify-out/GRAPH_REPORT.md 存在，回答架构或代码关系问题前优先先读它。遇到跨模块关系问题优先使用 graphify query/path/explain。", importance: 75, tags: ["host", "graphify", "convention"] },
        { type: "project_memory", title: "Memory MCP 使用策略", content: "非平凡编码/设计/调试/集成/审查工作前先调用 memory_health + memory_retrieve_context。高风险操作前调用 rule_gate_check。验证后的设计决策调用 memory_ingest_candidate。", importance: 78, tags: ["host", "memory", "mcp"] },
        { type: "workspace_memory", title: "Windows 执行环境", content: "工具映射：读文件用 Read（禁 cat/head/tail）、搜文件用 Glob（禁 find/ls）、搜内容用 Grep（禁 grep/rg）、编辑用 Edit（禁 sed/awk）、创建用 Write（禁 echo>）。", importance: 70, tags: ["host", "windows", "tools"] }
      ].map((m, i) => ({
        id: `mem-host-${String(i + 1).padStart(3, "0")}`,
        memory_type: m.type,
        title: m.title,
        content: m.content,
        source_kind: "host_mounted",
        origin_scope: "global",
        availability_scope: "global_reusable",
        importance: m.importance,
        confidence_score: 1.0,
        verification_status: "verified",
        tags: m.tags,
        status: "active",
        version: 1,
        created_at: iso(0),
        recall_count: 0,
        source_refs: [{ source_kind: "host", source_excerpt: "宿主自带", source_timestamp: iso(0) }]
      }))
    ],

    // ---------- Knowledge（10 条）----------
    knowledge: [
      {
        id: "know-001",
        title: "治理导向的知识演进优于追加式存储",
        knowledge_type: "synthesis",
        confidence_score: 0.89,
        recall_state: "active",
        recall_count: 23,
        availability_scope: "tenant_global",
        origin_scope: "governance",
        lifecycle_state: "active",
        review_state: "approved",
        content: "通过对 142 次治理运行的归纳，发现治理导向的知识演进（去重、对齐、升级、拒绝、合成）相比追加式存储，能将知识库的可用率从 61% 提升至 88%，且重复检索成本下降 73%。核心机制是 L2 冲突检测提前过滤冗余，L4 合成将碎片知识收敛为结构化结论。",
        reasoning_summary: "样本：142 次治理运行 · 时间跨度 45 天 · 对照组：未启用治理的基线知识库",
        risk_level: "low",
        created_at: iso(-8),
        utility_score: 0.92,
        metadata: { pitfall: "治理阈值需定期校准，过低会误杀有效知识，过高则失去过滤效果" },
        source_object_ids: ["mem-004", "know-002"],
        evidence_ids: ["ev-001", "ev-003"],
        synthesis: { mode: "merge", sources: ["ev-001", "ev-003", "mem-004"], layer: "L4", note: "1+1=2：从治理日志+质量报告合成" },
        source_refs: [{ source_kind: "governance", source_excerpt: "L4 认知合成输出", source_timestamp: iso(-8) }]
      },
      {
        id: "know-002",
        title: "MCP 工具调用模式与宿主耦合度分析",
        knowledge_type: "pattern",
        confidence_score: 0.83,
        recall_state: "active",
        recall_count: 17,
        availability_scope: "tenant_global",
        origin_scope: "governance",
        lifecycle_state: "active",
        review_state: "approved",
        content: "MCP 工具调用呈现明显的批次特征：memory_retrieve_context 在任务开始时被高频调用（占 62%），memory_ingest_candidate 集中在任务结束时（占 28%），rule_gate_check 在执行高风险操作前被调用（占 10%）。建议在 retrieve_context 中预加载高频上下文以降低延迟。",
        reasoning_summary: "样本：312 次 MCP 调用 · 4 个宿主 · 调用时间分布聚类分析",
        risk_level: "low",
        created_at: iso(-14),
        utility_score: 0.81,
        metadata: { pitfall: "不同宿主的调用模式差异较大，预加载策略需按宿主分组" },
        source_object_ids: ["mem-003"],
        evidence_ids: ["ev-002"],
        synthesis: { mode: "merge", sources: ["ev-002", "mem-003"], layer: "L4", note: "1+1=2：从 312 次 MCP 调用埋点归纳" },
        source_refs: [{ source_kind: "governance", source_excerpt: "MCP 调用埋点分析", source_timestamp: iso(-14) }]
      },
      {
        id: "know-003",
        title: "洋葱图布局的力参数调优经验",
        knowledge_type: "synthesis",
        confidence_score: 0.78,
        recall_state: "active",
        recall_count: 11,
        availability_scope: "project_reusable",
        origin_scope: "session_memory",
        lifecycle_state: "active",
        review_state: "approved",
        content: "洋葱图力导向布局的关键参数：径向力强度 0.25（过弱节点会飞出环外）、charge -8（过强会破坏环结构）、velocityDecay 0.6（提高稳定性）、fitView 用固定 zoom 居中而非缩放适配 bounding box（后者会缩没环结构）。",
        reasoning_summary: "样本：6 次参数调优迭代 · 对照组：原 3D 方案参数",
        risk_level: "low",
        created_at: iso(-9),
        utility_score: 0.66,
        metadata: { pitfall: "节点数超过 200 时需要降低 charge 绝对值，否则会出现挤压" },
        source_object_ids: ["mem-002", "mem-010"],
        evidence_ids: ["ev-004"],
        synthesis: { mode: "merge", sources: ["ev-004", "mem-002"], layer: "L4", note: "1+1=2：从 6 次调试迭代归纳" },
        source_refs: [{ source_kind: "session", source_excerpt: "洋葱图调试过程", source_timestamp: iso(-9) }]
      },
      {
        id: "know-004",
        title: "审批反馈循环对知识质量的提升作用",
        knowledge_type: "pattern",
        confidence_score: 0.81,
        recall_state: "active",
        recall_count: 14,
        availability_scope: "tenant_global",
        origin_scope: "governance",
        lifecycle_state: "active",
        review_state: "approved",
        content: "带审批反馈的提议相比无反馈提议，其生成 skill/rule 的后续召回成功率高出 19%。反馈内容中包含'场景边界'和'失败条件'的提议质量最高。建议审批时强制要求填写'非适用场景'。",
        reasoning_summary: "样本：89 条已审批提议 · 后续召回成功率对比",
        risk_level: "low",
        created_at: iso(-18),
        utility_score: 0.79,
        metadata: { pitfall: "反馈过于简短（如'好的'）的提议质量提升有限" },
        source_object_ids: ["mem-004"],
        evidence_ids: ["ev-005"],
        synthesis: { mode: "iterate", sources: ["know-001", "ev-005"], layer: "L4", note: "1→3：受治理知识演进结论启发，迭代出反馈质量洞察" },
        source_refs: [{ source_kind: "governance", source_excerpt: "审批反馈质量分析", source_timestamp: iso(-18) }]
      },
      {
        id: "know-005",
        title: "Skill 适用场景声明对召回质量的影响",
        knowledge_type: "pattern",
        confidence_score: 0.84,
        recall_state: "active",
        recall_count: 8,
        availability_scope: "tenant_global",
        origin_scope: "governance",
        lifecycle_state: "active",
        review_state: "approved",
        content: "通过对 23 次 skill 调用的归纳，发现明确声明'非适用场景'的 skill 召回成功率达 91%，未声明的仅 72%。建议所有新建 skill 强制填写 non_applicable_scenarios 字段。",
        reasoning_summary: "样本：23 次 skill 调用 · 召回成功率对比",
        risk_level: "low",
        created_at: iso(-3),
        utility_score: 0.85,
        metadata: { pitfall: "声明过多非适用场景会反而降低召回率，需控制粒度" },
        source_object_ids: ["mem-004"],
        evidence_ids: ["ev-006"],
        synthesis: { mode: "merge", sources: ["ev-006"], layer: "L4", note: "1+1=2：从 skill 调用埋点合成" },
        source_refs: [{ source_kind: "governance", source_excerpt: "skill 召回质量分析", source_timestamp: iso(-3) }]
      },
      {
        id: "know-006",
        title: "TypeScript strict 模式对线上缺陷的拦截率",
        knowledge_type: "pattern",
        confidence_score: 0.87,
        recall_state: "active",
        recall_count: 19,
        availability_scope: "tenant_global",
        origin_scope: "governance",
        lifecycle_state: "active",
        review_state: "approved",
        content: "启用 TypeScript strict + noUncheckedIndexedAccess 后，线上 TypeError 类缺陷下降 64%。其中 noUncheckedIndexedAccess 单独贡献了 31% 的拦截，主要针对数组/对象访问的 undefined 风险。",
        reasoning_summary: "样本：6 个月缺陷工单 · 启用前后对比",
        risk_level: "low",
        created_at: iso(-20),
        utility_score: 0.83,
        metadata: { pitfall: "strict 模式会让旧代码迁移成本上升，需分批迁移" },
        source_object_ids: ["mem-015"],
        evidence_ids: ["ev-007"],
        synthesis: { mode: "merge", sources: ["ev-007", "mem-015"], layer: "L4", note: "1+1=2：从缺陷工单+tsconfig 合成" },
        source_refs: [{ source_kind: "governance", source_excerpt: "缺陷趋势分析", source_timestamp: iso(-20) }]
      },
      {
        id: "know-007",
        title: "依赖审计门禁对供应链安全的提升",
        knowledge_type: "insight",
        confidence_score: 0.79,
        recall_state: "active",
        recall_count: 6,
        availability_scope: "tenant_global",
        origin_scope: "governance",
        lifecycle_state: "active",
        review_state: "approved",
        content: "在 PR 阶段引入 npm audit + Snyk 双重依赖审计后，2025 Q1 共拦截 3 次 high 级漏洞合并，其中 1 次为 transitive 依赖（lodash 旧版本）。门禁策略应同时扫描 direct 和 transitive 依赖。",
        reasoning_summary: "样本：Q1 拦截记录 · direct vs transitive 分布",
        risk_level: "low",
        created_at: iso(-5),
        utility_score: 0.77,
        metadata: { pitfall: "transitive 依赖更新需配合 lockfile 升级，可能引入破坏性变更" },
        source_object_ids: ["mem-006"],
        evidence_ids: ["ev-008"],
        synthesis: { mode: "iterate", sources: ["know-006", "ev-008"], layer: "L4", note: "1→3：从 TS strict 拦截经验迭代到供应链拦截" },
        source_refs: [{ source_kind: "governance", source_excerpt: "Q1 安全复盘", source_timestamp: iso(-5) }]
      },
      {
        id: "know-008",
        title: "Fastify 5.x 性能特性与项目场景匹配度",
        knowledge_type: "best_practice",
        confidence_score: 0.82,
        recall_state: "active",
        recall_count: 12,
        availability_scope: "project_reusable",
        origin_scope: "session_memory",
        lifecycle_state: "active",
        review_state: "approved",
        content: "Fastify 5.x 相比 Express 在本项目场景下：P99 延迟下降 41%、QPS 提升 2.3 倍。关键优化点：JSON 序列化用 fast-json-stringify 预编译 schema、路由用 radix tree、@fastify/static 启用 sendFile 走 fs.createReadStream。",
        reasoning_summary: "样本：3 次基准测试 · Express vs Fastify 5 对照",
        risk_level: "low",
        created_at: iso(-22),
        utility_score: 0.74,
        metadata: { pitfall: "Fastify 插件生态比 Express 小众，部分中间件需自研" },
        source_object_ids: ["mem-001"],
        evidence_ids: ["ev-009"],
        synthesis: { mode: "merge", sources: ["ev-009", "mem-001"], layer: "L4", note: "1+1=2：从基准测试+架构记忆合成" },
        source_refs: [{ source_kind: "session", source_excerpt: "Fastify 选型基准测试", source_timestamp: iso(-22) }]
      },
      {
        id: "know-009",
        title: "治理流水线分层职责清晰度对召回率的影响",
        knowledge_type: "insight",
        confidence_score: 0.76,
        recall_state: "active",
        recall_count: 4,
        availability_scope: "tenant_global",
        origin_scope: "governance",
        lifecycle_state: "active",
        review_state: "approved",
        content: "L2/L3/L4 三层职责越清晰，治理候选的召回准确率越高。当 L2 也做合成、L4 也做冲突检测时，召回准确率从 81% 降到 67%。建议每层只产出对应类型的 proposal，跨层职责由 L3 演进信号触发。",
        reasoning_summary: "样本：3 次职责混淆事故 · 召回准确率对比",
        risk_level: "low",
        created_at: iso(-6),
        utility_score: 0.71,
        metadata: { pitfall: "L2/L3/L4 边界需定期复审，新场景容易跨越" },
        source_object_ids: ["mem-004"],
        evidence_ids: ["ev-010"],
        synthesis: { mode: "iterate", sources: ["know-001", "ev-010"], layer: "L4", note: "1→3：从治理知识演进迭代到分层职责" },
        source_refs: [{ source_kind: "governance", source_excerpt: "职责混淆事故复盘", source_timestamp: iso(-6) }]
      },
      {
        id: "know-010",
        title: "Canvas 2D vs WebGL：图谱渲染选型经验",
        knowledge_type: "best_practice",
        confidence_score: 0.85,
        recall_state: "active",
        recall_count: 9,
        availability_scope: "project_reusable",
        origin_scope: "session_memory",
        lifecycle_state: "active",
        review_state: "approved",
        content: "图谱渲染选 Canvas 2D 而非 WebGL：①节点数 < 500 时性能足够；②调试成本低，可直接在 DevTools 看；③自定义 glow 用 radialGradient 即可，无需 post-processing。WebGL 仅在节点数 > 2000 或需要 shader 特效时才值得引入。",
        reasoning_summary: "样本：3 次原型对比 · 性能 vs 调试成本权衡",
        risk_level: "low",
        created_at: iso(-11),
        utility_score: 0.69,
        metadata: { pitfall: "Canvas 2D 在节点 > 1000 时需要 LOD 策略，否则掉帧明显" },
        source_object_ids: ["mem-010", "mem-002"],
        evidence_ids: ["ev-011"],
        synthesis: { mode: "merge", sources: ["ev-011", "mem-010"], layer: "L4", note: "1+1=2：从渲染选型记忆+原型对比合成" },
        source_refs: [{ source_kind: "session", source_excerpt: "渲染选型原型对比", source_timestamp: iso(-11) }]
      }
    ],

    // ---------- Entities（12 条）----------
    entities: [
      { id: "ent-001", canonical_name: "MCP", entity_type: "protocol", aliases: ["Model Context Protocol"], summary: "宿主与 memory-service 之间的通信契约协议", slug: "mcp", utility_score: 0.92, origin_scope: "session_memory", availability_scope: "tenant_global", created_at: iso(-28) },
      { id: "ent-002", canonical_name: "Fastify", entity_type: "framework", aliases: ["fastify"], summary: "memory-service 使用的后端 Web 框架", slug: "fastify", utility_score: 0.74, origin_scope: "session_memory", availability_scope: "project_reusable", created_at: iso(-15) },
      { id: "ent-003", canonical_name: "D3.js", entity_type: "library", aliases: ["d3", "D3"], summary: "知识图谱洋葱图布局使用的力导向库", slug: "d3-js", utility_score: 0.68, origin_scope: "session_memory", availability_scope: "project_reusable", created_at: iso(-10) },
      { id: "ent-004", canonical_name: "治理流水线", entity_type: "concept", aliases: ["governance pipeline", "L2/L3/L4"], summary: "L2 冲突检测 + L3 演进管理 + L4 认知合成的三层治理机制", slug: "governance-pipeline", utility_score: 0.85, origin_scope: "governance", availability_scope: "tenant_global", created_at: iso(-12) },
      { id: "ent-005", canonical_name: "洋葱图", entity_type: "visualization", aliases: ["onion graph", "同心圆布局"], summary: "知识图谱的可视化布局，5 层同心圆结构", slug: "onion-graph", utility_score: 0.45, origin_scope: "session_memory", availability_scope: "project_reusable", created_at: iso(-10) },
      { id: "ent-006", canonical_name: "PostgreSQL", entity_type: "database", aliases: ["pg", "Postgres"], summary: "项目持久化数据库，本地 55432 端口", slug: "postgresql", utility_score: 0.78, origin_scope: "session_memory", availability_scope: "project_reusable", created_at: iso(-22) },
      { id: "ent-007", canonical_name: "TypeScript", entity_type: "language", aliases: ["ts", "tsc"], summary: "项目主语言，启用 strict + noUncheckedIndexedAccess", slug: "typescript", utility_score: 0.91, origin_scope: "session_memory", availability_scope: "tenant_global", created_at: iso(-17) },
      { id: "ent-008", canonical_name: "ECharts", entity_type: "library", aliases: ["echarts"], summary: "仪表盘图表库，与 D3 共存（图谱用 D3，KPI 用 ECharts）", slug: "echarts", utility_score: 0.62, origin_scope: "session_memory", availability_scope: "project_reusable", created_at: iso(-13) },
      { id: "ent-009", canonical_name: "Codex", entity_type: "host", aliases: ["codex-cli"], summary: "OpenAI Codex 宿主，通过 lark-cli 接入治理规则", slug: "codex", utility_score: 0.71, origin_scope: "session_memory", availability_scope: "tenant_global", created_at: iso(-16) },
      { id: "ent-010", canonical_name: "Codex GateMaster", entity_type: "skill", aliases: ["GateMaster"], summary: "Codex 宿主的规则注入技能，把 Rule 翻译为 Hook", slug: "gatemaster", utility_score: 0.67, origin_scope: "governance", availability_scope: "tenant_global", created_at: iso(-16) },
      { id: "ent-011", canonical_name: "npm audit", entity_type: "tool", aliases: ["npm-audit", "snyk"], summary: "依赖安全审计工具，rule-deps-audit-008 的执行器", slug: "npm-audit", utility_score: 0.58, origin_scope: "team_memory", availability_scope: "tenant_global", created_at: iso(-5) },
      { id: "ent-012", canonical_name: "治理委员会", entity_type: "org", aliases: ["governance committee"], summary: "负责审批 P0/P1 提议的虚拟角色，由团队技术负责人 + SRE 组成", slug: "governance-committee", utility_score: 0.83, origin_scope: "team_memory", availability_scope: "tenant_global", created_at: iso(-60) }
    ],

    // ---------- Facts（12 条）----------
    facts: [
      { id: "fact-001", statement: "memory-service 监听 3101 端口，开发模式使用 tsx watch，生产模式使用编译后的 dist 目录", fact_kind: "config", subject_entity_id: "ent-002", confidence_score: 0.95, utility_score: 0.82, origin_scope: "session_memory", availability_scope: "project_reusable", created_at: iso(-15) },
      { id: "fact-002", statement: "MCP 协议定义了 6 个核心工具：memory_health、memory_retrieve_context、memory_ingest_candidate、memory_query_layer、memory_run_governance、rule_gate_check", fact_kind: "structural", subject_entity_id: "ent-001", confidence_score: 0.97, utility_score: 0.91, origin_scope: "session_memory", availability_scope: "tenant_global", created_at: iso(-28) },
      { id: "fact-003", statement: "洋葱图最内核是技能层（skill），半径 30；最外圈是感知层（evidence/fact/entity），半径 400", fact_kind: "structural", subject_entity_id: "ent-005", confidence_score: 0.88, utility_score: 0.55, origin_scope: "session_memory", availability_scope: "project_reusable", created_at: iso(-10) },
      { id: "fact-004", statement: "治理流水线 L2 检测冲突，L3 识别演进信号，L4 生成知识", fact_kind: "structural", subject_entity_id: "ent-004", confidence_score: 0.92, utility_score: 0.86, origin_scope: "governance", availability_scope: "tenant_global", created_at: iso(-12) },
      { id: "fact-005", statement: "审批通过 skill 类型提议后，系统自动将提议 payload 物化为新的 skill 条目并加入技能库", fact_kind: "behavioral", subject_entity_id: "ent-004", confidence_score: 0.90, utility_score: 0.79, origin_scope: "governance", availability_scope: "tenant_global", created_at: iso(-18) },
      { id: "fact-006", statement: "PostgreSQL 16 监听本地 55432 端口，数据库名 super_agent_system，迁移脚本 npm run db:migrate", fact_kind: "config", subject_entity_id: "ent-006", confidence_score: 0.93, utility_score: 0.71, origin_scope: "session_memory", availability_scope: "project_reusable", created_at: iso(-22) },
      { id: "fact-007", statement: "项目 tsconfig 启用 strict、noUncheckedIndexedAccess、noImplicitOverride、exactOptionalPropertyTypes", fact_kind: "config", subject_entity_id: "ent-007", confidence_score: 0.96, utility_score: 0.83, origin_scope: "session_memory", availability_scope: "tenant_global", created_at: iso(-17) },
      { id: "fact-008", statement: "Codex 通过 lark-cli 把审批通过的 Rule 翻译为 Hook 代码并注册到 Gate Registry", fact_kind: "behavioral", subject_entity_id: "ent-009", confidence_score: 0.89, utility_score: 0.76, origin_scope: "session_memory", availability_scope: "tenant_global", created_at: iso(-16) },
      { id: "fact-009", statement: "GateMaster 是 Codex 宿主的规则注入技能，对应 skill-creator 负责把 skill 记录转为 SKILL.md", fact_kind: "structural", subject_entity_id: "ent-010", confidence_score: 0.91, utility_score: 0.72, origin_scope: "governance", availability_scope: "tenant_global", created_at: iso(-16) },
      { id: "fact-010", statement: "图谱渲染节点数 < 500 时 Canvas 2D 性能足够，> 2000 时需要 WebGL", fact_kind: "empirical", subject_entity_id: "ent-005", confidence_score: 0.84, utility_score: 0.61, origin_scope: "session_memory", availability_scope: "project_reusable", created_at: iso(-11) },
      { id: "fact-011", statement: "rule-deps-audit-008 在 PR 阶段同时扫描 direct 和 transitive 依赖", fact_kind: "behavioral", subject_entity_id: "ent-011", confidence_score: 0.92, utility_score: 0.74, origin_scope: "team_memory", availability_scope: "tenant_global", created_at: iso(-5) },
      { id: "fact-012", statement: "治理委员会由团队技术负责人 + SRE 组成，负责审批 P0/P1 提议", fact_kind: "structural", subject_entity_id: "ent-012", confidence_score: 0.95, utility_score: 0.88, origin_scope: "team_memory", availability_scope: "tenant_global", created_at: iso(-60) }
    ],

    // ---------- Evidence（12 条）----------
    evidence: [
      { id: "ev-001", evidence_type: "log", content_excerpt: "治理运行日志：142 次运行中，启用治理的知识库可用率 88%，未启用 61%", source_uri: "log://governance-run-2025-03", trust_level: "high", utility_score: 0.88, source_type: "system_log", source_object_type: "governance_run", source_object_id: "run-001", support_role: "primary", synthesized_knowledge_id: "know-001", created_at: iso(-8), evidence_status: "verified", evidence_lifecycle_state: "active", evidence_review_state: "approved" },
      { id: "ev-002", evidence_type: "metric", content_excerpt: "MCP 调用埋点：retrieve_context 占 62%，ingest_candidate 占 28%，rule_gate_check 占 10%", source_uri: "metric://mcp-call-2025-03", trust_level: "high", utility_score: 0.83, source_type: "telemetry", source_object_type: "mcp_call", source_object_id: "call-batch-001", support_role: "primary", synthesized_knowledge_id: "know-002", created_at: iso(-14), evidence_status: "verified", evidence_lifecycle_state: "active", evidence_review_state: "approved" },
      { id: "ev-003", evidence_type: "report", content_excerpt: "知识库质量评估报告：去重率 73%，重复检索成本下降明显", source_uri: "report://knowledge-quality-2025-03", trust_level: "medium", utility_score: 0.76, source_type: "analysis_report", source_object_type: "governance_run", source_object_id: "run-002", support_role: "supporting", synthesized_knowledge_id: "know-001", created_at: iso(-7), evidence_status: "verified", evidence_lifecycle_state: "active", evidence_review_state: "approved" },
      { id: "ev-004", evidence_type: "session", content_excerpt: "洋葱图调试 session：径向力从 0.02 调到 0.25 后节点稳定在环上", source_uri: "session://onion-debug-2025-03", trust_level: "medium", utility_score: 0.52, source_type: "session_log", source_object_type: "session", source_object_id: "sess-001", support_role: "primary", synthesized_knowledge_id: "know-003", created_at: iso(-9), evidence_status: "verified", evidence_lifecycle_state: "active", evidence_review_state: "approved" },
      { id: "ev-005", evidence_type: "analysis", content_excerpt: "审批反馈分析：带反馈的提议后续召回成功率 87%，无反馈 68%", source_uri: "analysis://approval-feedback-2025-03", trust_level: "high", utility_score: 0.81, source_type: "data_analysis", source_object_type: "governance_run", source_object_id: "run-003", support_role: "primary", synthesized_knowledge_id: "know-004", created_at: iso(-18), evidence_status: "verified", evidence_lifecycle_state: "active", evidence_review_state: "approved" },
      { id: "ev-006", evidence_type: "metric", content_excerpt: "skill 召回埋点：声明非适用场景的 skill 召回 91%，未声明 72%", source_uri: "metric://skill-recall-2025-03", trust_level: "high", utility_score: 0.85, source_type: "telemetry", source_object_type: "skill_call", source_object_id: "call-batch-002", support_role: "primary", synthesized_knowledge_id: "know-005", created_at: iso(-3), evidence_status: "verified", evidence_lifecycle_state: "active", evidence_review_state: "approved" },
      { id: "ev-007", evidence_type: "report", content_excerpt: "缺陷工单分析：启用 TS strict 后 6 个月内 TypeError 类缺陷下降 64%", source_uri: "report://defect-trend-2025-q1", trust_level: "high", utility_score: 0.83, source_type: "analysis_report", source_object_type: "governance_run", source_object_id: "run-006", support_role: "primary", synthesized_knowledge_id: "know-006", created_at: iso(-20), evidence_status: "verified", evidence_lifecycle_state: "active", evidence_review_state: "approved" },
      { id: "ev-008", evidence_type: "log", content_excerpt: "依赖审计日志：Q1 拦截 3 次 high 级漏洞合并，1 次为 transitive 依赖", source_uri: "log://deps-audit-2025-q1", trust_level: "high", utility_score: 0.77, source_type: "system_log", source_object_type: "governance_run", source_object_id: "run-007", support_role: "primary", synthesized_knowledge_id: "know-007", created_at: iso(-5), evidence_status: "verified", evidence_lifecycle_state: "active", evidence_review_state: "approved" },
      { id: "ev-009", evidence_type: "benchmark", content_excerpt: "Fastify 5 vs Express 基准：P99 下降 41%，QPS 提升 2.3 倍", source_uri: "benchmark://fastify-vs-express-2025", trust_level: "high", utility_score: 0.74, source_type: "benchmark", source_object_type: "session", source_object_id: "sess-002", support_role: "primary", synthesized_knowledge_id: "know-008", created_at: iso(-22), evidence_status: "verified", evidence_lifecycle_state: "active", evidence_review_state: "approved" },
      { id: "ev-010", evidence_type: "analysis", content_excerpt: "治理职责混淆事故分析：L2 也做合成时召回准确率从 81% 降到 67%", source_uri: "analysis://governance-confusion-2025-03", trust_level: "medium", utility_score: 0.71, source_type: "data_analysis", source_object_type: "governance_run", source_object_id: "run-008", support_role: "primary", synthesized_knowledge_id: "know-009", created_at: iso(-6), evidence_status: "verified", evidence_lifecycle_state: "active", evidence_review_state: "approved" },
      { id: "ev-011", evidence_type: "session", content_excerpt: "渲染原型对比：Canvas 2D 在 500 节点下 60fps，WebGL 在 2000 节点下才掉帧", source_uri: "session://render-prototype-2025-03", trust_level: "medium", utility_score: 0.69, source_type: "session_log", source_object_type: "session", source_object_id: "sess-003", support_role: "primary", synthesized_knowledge_id: "know-010", created_at: iso(-11), evidence_status: "verified", evidence_lifecycle_state: "active", evidence_review_state: "approved" },
      { id: "ev-012", evidence_type: "metric", content_excerpt: "PR 审批埋点：团队约定至少 1 人 approve 后，未审 PR 合并数从月均 4 次降到 0 次", source_uri: "metric://pr-policy-2025", trust_level: "high", utility_score: 0.82, source_type: "telemetry", source_object_type: "session", source_object_id: "sess-004", support_role: "supporting", synthesized_knowledge_id: "know-001", created_at: iso(-60), evidence_status: "verified", evidence_lifecycle_state: "active", evidence_review_state: "approved" }
    ],

    // ---------- Relations（45 条，消灭孤岛，每个节点都至少有 1 条边）----------
    relations: [
      // entity ↔ entity
      { id: "rel-001", from_object_id: "ent-001", to_object_id: "ent-002", relation_type: "integrates_with" },
      { id: "rel-002", from_object_id: "ent-001", to_object_id: "ent-004", relation_type: "triggers" },
      { id: "rel-009", from_object_id: "ent-001", to_object_id: "ent-009", relation_type: "integrates_with" },
      { id: "rel-010", from_object_id: "ent-002", to_object_id: "ent-006", relation_type: "integrates_with" },
      { id: "rel-011", from_object_id: "ent-002", to_object_id: "ent-007", relation_type: "integrates_with" },
      { id: "rel-012", from_object_id: "ent-003", to_object_id: "ent-005", relation_type: "describes" },
      { id: "rel-013", from_object_id: "ent-003", to_object_id: "ent-008", relation_type: "complements" },
      { id: "rel-014", from_object_id: "ent-004", to_object_id: "ent-012", relation_type: "applies_to" },
      { id: "rel-015", from_object_id: "ent-009", to_object_id: "ent-010", relation_type: "integrates_with" },
      { id: "rel-016", from_object_id: "ent-009", to_object_id: "ent-011", relation_type: "integrates_with" },
      // fact ↔ entity
      { id: "rel-003", from_object_id: "fact-002", to_object_id: "ent-001", relation_type: "describes" },
      { id: "rel-004", from_object_id: "fact-004", to_object_id: "ent-004", relation_type: "describes" },
      { id: "rel-008", from_object_id: "fact-005", to_object_id: "ent-004", relation_type: "describes" },
      { id: "rel-017", from_object_id: "fact-001", to_object_id: "ent-002", relation_type: "describes" },
      { id: "rel-018", from_object_id: "fact-003", to_object_id: "ent-005", relation_type: "describes" },
      { id: "rel-019", from_object_id: "fact-006", to_object_id: "ent-006", relation_type: "describes" },
      { id: "rel-020", from_object_id: "fact-007", to_object_id: "ent-007", relation_type: "describes" },
      { id: "rel-021", from_object_id: "fact-008", to_object_id: "ent-009", relation_type: "describes" },
      { id: "rel-022", from_object_id: "fact-009", to_object_id: "ent-010", relation_type: "describes" },
      { id: "rel-023", from_object_id: "fact-010", to_object_id: "ent-005", relation_type: "describes" },
      { id: "rel-024", from_object_id: "fact-011", to_object_id: "ent-011", relation_type: "describes" },
      { id: "rel-025", from_object_id: "fact-012", to_object_id: "ent-012", relation_type: "describes" },
      // knowledge ↔ entity (synthesized_from)
      { id: "rel-005", from_object_id: "know-001", to_object_id: "ent-004", relation_type: "synthesized_from" },
      { id: "rel-006", from_object_id: "know-002", to_object_id: "ent-001", relation_type: "synthesized_from" },
      { id: "rel-007", from_object_id: "know-003", to_object_id: "ent-005", relation_type: "synthesized_from" },
      { id: "rel-026", from_object_id: "know-004", to_object_id: "ent-004", relation_type: "synthesized_from" },
      { id: "rel-027", from_object_id: "know-005", to_object_id: "ent-001", relation_type: "synthesized_from" },
      { id: "rel-028", from_object_id: "know-006", to_object_id: "ent-007", relation_type: "synthesized_from" },
      { id: "rel-029", from_object_id: "know-007", to_object_id: "ent-011", relation_type: "synthesized_from" },
      { id: "rel-030", from_object_id: "know-008", to_object_id: "ent-002", relation_type: "synthesized_from" },
      { id: "rel-031", from_object_id: "know-009", to_object_id: "ent-004", relation_type: "synthesized_from" },
      { id: "rel-032", from_object_id: "know-010", to_object_id: "ent-005", relation_type: "synthesized_from" },
      // knowledge ↔ knowledge (iterate / refine)
      { id: "rel-033", from_object_id: "know-004", to_object_id: "know-001", relation_type: "iterates_from" },
      { id: "rel-034", from_object_id: "know-007", to_object_id: "know-006", relation_type: "iterates_from" },
      { id: "rel-035", from_object_id: "know-009", to_object_id: "know-001", relation_type: "iterates_from" },
      // memory ↔ entity/fact/knowledge (originates_from / refines / constrains)
      { id: "rel-036", from_object_id: "mem-001", to_object_id: "ent-002", relation_type: "describes" },
      { id: "rel-037", from_object_id: "mem-002", to_object_id: "ent-005", relation_type: "describes" },
      { id: "rel-038", from_object_id: "mem-003", to_object_id: "ent-001", relation_type: "describes" },
      { id: "rel-039", from_object_id: "mem-004", to_object_id: "ent-004", relation_type: "describes" },
      { id: "rel-040", from_object_id: "mem-006", to_object_id: "ent-006", relation_type: "describes" },
      { id: "rel-041", from_object_id: "mem-010", to_object_id: "know-003", relation_type: "refines" },
      { id: "rel-042", from_object_id: "mem-012", to_object_id: "ent-009", relation_type: "describes" },
      { id: "rel-043", from_object_id: "mem-014", to_object_id: "ent-005", relation_type: "describes" },
      { id: "rel-044", from_object_id: "mem-015", to_object_id: "ent-007", relation_type: "describes" },
      // rule ↔ memory/skill (constrains / applies_to)
      { id: "rel-045", from_object_id: "rule-config-backup-001", to_object_id: "mem-006", relation_type: "constrains" },
      { id: "rel-046", from_object_id: "rule-typecheck-003", to_object_id: "ent-007", relation_type: "applies_to" },
      { id: "rel-047", from_object_id: "rule-build-gate-004", to_object_id: "rule-typecheck-003", relation_type: "refines" },
      { id: "rel-048", from_object_id: "rule-no-sycophancy-006", to_object_id: "mem-005", relation_type: "synthesized_from" },
      { id: "rel-049", from_object_id: "rule-test-coverage-007", to_object_id: "mem-008", relation_type: "synthesized_from" },
      { id: "rel-050", from_object_id: "rule-deps-audit-008", to_object_id: "ent-011", relation_type: "applies_to" },
      // skill ↔ rule/entity (applies_to / integrates_with)
      { id: "rel-051", from_object_id: "skill-code-review-003", to_object_id: "rule-build-gate-004", relation_type: "applies_to" },
      { id: "rel-052", from_object_id: "skill-api-test-005", to_object_id: "ent-001", relation_type: "integrates_with" },
      { id: "rel-053", from_object_id: "skill-perf-optimize-006", to_object_id: "ent-002", relation_type: "applies_to" },
      { id: "rel-054", from_object_id: "skill-tech-debt-007", to_object_id: "ent-007", relation_type: "applies_to" },
      { id: "rel-055", from_object_id: "skill-doc-rewrite-008", to_object_id: "skill-tech-blog-002", relation_type: "complements" }
    ],

    // ---------- Evidence Trace ----------
    evidence_trace: [
      { synthesized_knowledge_id: "know-001", evidence_id: "ev-001" },
      { synthesized_knowledge_id: "know-001", evidence_id: "ev-003" },
      { synthesized_knowledge_id: "know-001", evidence_id: "ev-012" },
      { synthesized_knowledge_id: "know-002", evidence_id: "ev-002" },
      { synthesized_knowledge_id: "know-003", evidence_id: "ev-004" },
      { synthesized_knowledge_id: "know-004", evidence_id: "ev-005" },
      { synthesized_knowledge_id: "know-005", evidence_id: "ev-006" },
      { synthesized_knowledge_id: "know-006", evidence_id: "ev-007" },
      { synthesized_knowledge_id: "know-007", evidence_id: "ev-008" },
      { synthesized_knowledge_id: "know-008", evidence_id: "ev-009" },
      { synthesized_knowledge_id: "know-009", evidence_id: "ev-010" },
      { synthesized_knowledge_id: "know-010", evidence_id: "ev-011" }
    ],

    // ---------- 待审批 Proposals（status=recorded，10 条）----------
    proposals: [
      // skill: 制作 PPT
      {
        id: "prop-skill-ppt-001",
        target_object_type: "skill",
        target_object_id: "skill-ppt-gen-pending",
        proposed_action: "create_skill",
        risk_level: "low",
        status: "recorded",
        origin_scope: "session_memory",
        availability_scope: "project_reusable",
        reason: "用户多次请求生成演示文稿，且现有 skill 库缺少 PPT 制作能力。从近期 5 次会话中提取的 SOP 已通过 L2 去重和 L3 演进信号识别，建议物化为可复用 skill。",
        created_at: iso(-2),
        proposed_payload: {
          title: "演示文稿制作 Skill",
          skill_key: "generate.ppt.presentation",
          skill_type: "procedural",
          risk_level: "low",
          availability_scope: "project_reusable",
          description: "基于用户提供的提纲、素材和场景，自动生成结构化演示文稿，包含封面、目录、内容页和总结页，支持主题模板选择和内容密度控制。",
          applicable_scenarios: ["产品演示", "技术分享", "学术汇报", "项目立项", "季度总结"],
          non_applicable_scenarios: ["实时协作编辑", "复杂动画设计", "数据可视化图表生成"],
          procedure_payload: { host_action: { status: "pending", summary: "审批通过后将生成 SOP 文件 generate-ppt.md" } },
          trigger_conditions: { rules: ["user.request.ppt", "task.type == 'slide_generation'"], stages: ["reporting", "design"] }
        }
      },
      // skill: 写论文
      {
        id: "prop-skill-paper-002",
        target_object_type: "skill",
        target_object_id: "skill-paper-write-pending",
        proposed_action: "create_skill",
        risk_level: "medium",
        status: "recorded",
        origin_scope: "session_memory",
        availability_scope: "project_reusable",
        reason: "用户反馈现有 paper-research skill 只能做文献调研，希望补齐论文撰写能力。从 3 次完整论文撰写会话中提取的 SOP 已通过 L4 合成，包含结构化写作流程。",
        created_at: iso(-2),
        proposed_payload: {
          title: "学术论文撰写 Skill",
          skill_key: "write.paper.academic",
          skill_type: "procedural",
          risk_level: "medium",
          availability_scope: "project_reusable",
          description: "基于研究提纲和文献调研结果，生成符合学术规范的论文初稿，包含摘要、引言、相关工作、方法、实验、讨论、结论，自动管理引用和图表编号。",
          applicable_scenarios: ["学位论文撰写", "期刊投稿", "会议论文", "综述文章"],
          non_applicable_scenarios: ["文学创作", "新闻报道", "需要原创实验数据的工作"],
          procedure_payload: { host_action: { status: "pending", summary: "审批通过后将生成 SOP 文件 write-academic-paper.md" } },
          trigger_conditions: { rules: ["user.request.paper_write", "task.type == 'academic_writing'"], stages: ["reporting"] }
        }
      },
      // rule: 完成编译才能提交（已被 rule-build-gate-004 实现，这里保留为待审批态供 demo）
      {
        id: "prop-rule-compile-003",
        target_object_type: "rule",
        target_object_id: "rule-compile-gate-pending",
        proposed_action: "create_rule",
        risk_level: "high",
        status: "recorded",
        origin_scope: "session_memory",
        availability_scope: "tenant_global",
        reason: "近期 3 次提交因编译错误导致 CI 失败，用户明确要求增加硬门禁。L3 演进信号识别到这是高频痛点，建议固化为 P0 规则。",
        created_at: iso(-1),
        proposed_payload: {
          title: "提交前必须通过完整编译",
          rule_key: "guard.build.compile_required_v2",
          enforcement_level: "hard_gate",
          priority: "P0",
          risk_level: "high",
          rule_domain: "coding",
          rule_type: "precondition",
          availability_scope: "tenant_global",
          applies_to: ["coding", "review", "governance"],
          statement: "代码提交前必须通过完整编译（npm run build 或等价命令），存在编译错误时门禁拦截提交并要求修复。编译输出必须包含错误计数和受影响文件清单。",
          trigger_conditions: { condition: "event.commit.before", action: "run_full_build" }
        }
      },
      // rule: 提交用户前必须自测（已被 rule-self-test-005 实现，这里保留为待审批态供 demo）
      {
        id: "prop-rule-selftest-004",
        target_object_type: "rule",
        target_object_id: "rule-selftest-gate-pending",
        proposed_action: "create_rule",
        risk_level: "high",
        status: "recorded",
        origin_scope: "session_memory",
        availability_scope: "tenant_global",
        reason: "用户多次反馈交付物存在低级错误（拼写、空指针、未处理的边界），要求在交付给用户前强制自测。从 8 次交付复盘记录中提取的检查清单已通过 L4 合成。",
        created_at: iso(-1),
        proposed_payload: {
          title: "提交给用户前必须自测",
          rule_key: "guard.delivery.self_test_required_v2",
          enforcement_level: "hard_gate",
          priority: "P0",
          risk_level: "high",
          rule_domain: "governance",
          rule_type: "precondition",
          availability_scope: "tenant_global",
          applies_to: ["governance", "review", "reporting"],
          statement: "任何交付给用户的产物（代码、文档、配置变更）在提交前必须经过自测，自测范围包括：基础功能验证、边界条件检查、错误路径验证。自测结果必须记录，未通过自测的交付被门禁拦截。",
          trigger_conditions: { condition: "event.deliver.before", action: "run_self_test" }
        }
      },
      // rule: 禁止使用讨好用户的语气（已被 rule-no-sycophancy-006 实现，这里保留为待审批态供 demo）
      {
        id: "prop-rule-tone-005",
        target_object_type: "rule",
        target_object_id: "rule-tone-gate-pending",
        proposed_action: "create_rule",
        risk_level: "medium",
        status: "recorded",
        origin_scope: "user_direct",
        availability_scope: "user_private",
        reason: "用户多次明确表达反感讨好式语气（如'您说得对'、'非常好的问题'、'完全理解您的需求'），要求固化为个人规则。该规则将用于生成回复时的语气校准。",
        created_at: iso(-1),
        proposed_payload: {
          title: "禁止使用讨好用户的语气",
          rule_key: "guard.tone.no_sycophancy_v2",
          enforcement_level: "soft_advisory",
          priority: "P1",
          risk_level: "medium",
          rule_domain: "governance",
          rule_type: "postcondition",
          availability_scope: "user_private",
          applies_to: ["governance", "reporting"],
          statement: "生成回复时禁止使用讨好式语气，包括但不限于：'您说得对'、'非常好的问题'、'完全理解您的需求'。应保持直接、客观、必要时带适度幽默的沟通风格，敢于指出问题而非一味附和。",
          trigger_conditions: { condition: "event.reply.before_send", action: "check_tone" }
        }
      },
      // knowledge: 知识提议
      {
        id: "prop-know-006",
        target_object_type: "synthesized_knowledge",
        target_object_id: "know-011-pending",
        proposed_action: "create_synthesized_knowledge",
        risk_level: "low",
        status: "recorded",
        origin_scope: "governance",
        availability_scope: "tenant_global",
        reason: "L4 认知合成从近期 23 次 skill 调用中识别出模式：带'非适用场景'声明的 skill 召回成功率高出 19%，建议固化为知识。",
        created_at: iso(-1),
        proposed_payload: {
          title: "Skill 适用场景声明对召回质量的影响（候选）",
          knowledge_type: "pattern",
          confidence_score: 0.84,
          availability_scope: "tenant_global",
          content: "通过对 23 次 skill 调用的归纳，发现明确声明'非适用场景'的 skill 召回成功率达 91%，未声明的仅 72%。建议所有新建 skill 强制填写 non_applicable_scenarios 字段。",
          reasoning_summary: "样本：23 次 skill 调用 · 召回成功率对比"
        }
      },
      // knowledge: 迭代型提议
      {
        id: "prop-know-007",
        target_object_type: "synthesized_knowledge",
        target_object_id: "know-012-pending",
        proposed_action: "create_synthesized_knowledge",
        risk_level: "low",
        status: "recorded",
        origin_scope: "governance",
        availability_scope: "tenant_global",
        reason: "受 know-001 启发，L4 识别到知识演进迭代信号：治理阈值校准周期对治理效果有显著影响，建议迭代为新知识。",
        created_at: iso(-1),
        proposed_payload: {
          title: "治理阈值校准周期对治理效果的影响",
          knowledge_type: "insight",
          confidence_score: 0.78,
          availability_scope: "tenant_global",
          content: "治理阈值（去重相似度、合成触发条件）的校准周期对治理效果有显著影响：周校准相比月校准，误杀率下降 12%，但人力成本上升 35%。建议核心模块周校准，外围模块月校准。",
          reasoning_summary: "样本：8 周对照实验 · 误杀率 vs 人力成本"
        }
      },
      // memory: 提议物化为 resident memory
      {
        id: "prop-mem-008",
        target_object_type: "memory",
        target_object_id: "mem-017-pending",
        proposed_action: "create_memory",
        risk_level: "low",
        status: "recorded",
        origin_scope: "session_memory",
        availability_scope: "user_private",
        reason: "用户在 5 次会话中表达了相同的偏好：周末倾向于处理非紧急任务（重构、文档），工作日优先处理紧急 bug。建议固化为 user_memory。",
        created_at: iso(-1),
        proposed_payload: {
          title: "用户工作时间偏好：周末重构/文档，工作日紧急 bug",
          memory_type: "user_memory",
          kind: "preference",
          importance: 0.72,
          confidence_score: 0.86,
          availability_scope: "user_private",
          content: "用户工作节奏：工作日优先处理紧急 bug 与线上事故，周末倾向处理非紧急任务（重构、文档、技术债）。任务调度应尊重此节奏。"
        }
      },
      // entity: 提议补全 entity
      {
        id: "prop-entity-009",
        target_object_type: "entity",
        target_object_id: "ent-013-pending",
        proposed_action: "create_entity",
        risk_level: "low",
        status: "recorded",
        origin_scope: "session_memory",
        availability_scope: "project_reusable",
        reason: "近期会话多次提到 Redis，但 entity 库中尚未建立。建议补全 entity 以便后续 evidence 与 knowledge 引用。",
        created_at: iso(-1),
        proposed_payload: {
          canonical_name: "Redis",
          entity_type: "cache",
          aliases: ["redis", "Redis"],
          summary: "项目使用的缓存中间件，部分治理任务用 Redis 做幂等去重",
          slug: "redis",
          utility_score: 0.71
        }
      },
      // L3 演进提议：升级现有规则
      {
        id: "prop-evolve-010",
        target_object_type: "rule",
        target_object_id: "rule-audit-log-002",
        proposed_action: "l3_evolution_upgrade",
        risk_level: "medium",
        status: "recorded",
        origin_scope: "governance",
        availability_scope: "tenant_global",
        reason: "L3 演进信号：rule-audit-log-002 当前覆盖范围仅限 high 风险操作，建议升级为 medium 风险也写入审计日志（保留可查询痕迹）。",
        created_at: iso(-1),
        proposed_payload: {
          title: "升级 rule-audit-log-002：审计日志覆盖范围扩展到 medium",
          rule_key: "guard.risk.audit_log_required",
          enforcement_level: "hard_gate",
          priority: "P0",
          risk_level: "high",
          applies_to: ["governance", "integration", "review", "reporting"],
          statement: "对标记为 medium 及以上风险的操作，必须写入审计日志并附操作者身份与理由，未记录则回滚。"
        }
      }
    ],

    // ---------- 已审批 History（status=resolved，8 条）----------
    history: [
      {
        id: "prop-skill-code-review-old",
        target_object_type: "skill",
        target_object_id: "skill-code-review-003",
        proposed_action: "create_skill",
        risk_level: "medium",
        status: "resolved",
        human_decision: "approved",
        human_feedback: "审查清单完整，非适用场景边界清晰，准予物化。",
        decided_at: iso(-45),
        created_at: iso(-46),
        origin_scope: "governance",
        availability_scope: "tenant_global",
        reason: "代码审查能力是团队基础能力，从 12 次 PR 审查会话中提取的 SOP 已成熟。",
        proposed_payload: { title: "代码审查 Skill", skill_key: "review.code.quality" }
      },
      {
        id: "prop-rule-config-backup-old",
        target_object_type: "rule",
        target_object_id: "rule-config-backup-001",
        proposed_action: "create_rule",
        risk_level: "high",
        status: "resolved",
        human_decision: "approved",
        human_feedback: "配置变更事故复盘后必须固化的规则，执行级别提升为 hard_gate。",
        decided_at: iso(-40),
        created_at: iso(-41),
        origin_scope: "admin_seed",
        availability_scope: "tenant_global",
        reason: "配置变更事故复盘，需要硬门禁防止未备份的修改。",
        proposed_payload: { title: "修改公共配置前必须备份", rule_key: "guard.config.backup_before_change" }
      },
      {
        id: "prop-rule-typecheck-old",
        target_object_type: "rule",
        target_object_id: "rule-typecheck-003",
        proposed_action: "create_rule",
        risk_level: "medium",
        status: "resolved",
        human_decision: "approved",
        human_feedback: "先以 soft_advisory 上线观察一段时间，视误报率再决定是否升级为硬门禁。",
        decided_at: iso(-20),
        created_at: iso(-21),
        origin_scope: "governance",
        availability_scope: "tenant_global",
        reason: "类型错误导致线上事故，需要提交前检查。",
        proposed_payload: { title: "提交前必须通过类型检查", rule_key: "guard.code.typecheck_before_commit" }
      },
      {
        id: "prop-know-lowquality-rejected",
        target_object_type: "knowledge",
        target_object_id: "know-rejected-001",
        proposed_action: "create_knowledge",
        risk_level: "low",
        status: "resolved",
        human_decision: "rejected",
        human_feedback: "样本量不足（仅 3 次调用），且结论与现有 know-004 重复，驳回。",
        decided_at: iso(-30),
        created_at: iso(-31),
        origin_scope: "governance",
        availability_scope: "tenant_global",
        reason: "L4 合成提议，但证据链不充分。",
        proposed_payload: { title: "低质量知识提议（已驳回）" }
      },
      {
        id: "prop-skill-ppt-gen-old-approved",
        target_object_type: "skill",
        target_object_id: "skill-ppt-gen-004",
        proposed_action: "create_skill",
        risk_level: "low",
        status: "resolved",
        human_decision: "approved",
        human_feedback: "SOP 完整，覆盖 5 步流程，准予物化。建议补充非适用场景边界。",
        decided_at: iso(-9),
        created_at: iso(-10),
        origin_scope: "governance",
        availability_scope: "project_reusable",
        reason: "用户多次请求生成 PPT，SOP 已通过 L2 去重。",
        proposed_payload: { title: "演示文稿制作 Skill", skill_key: "generate.ppt.presentation" }
      },
      {
        id: "prop-rule-build-gate-old-approved",
        target_object_type: "rule",
        target_object_id: "rule-build-gate-004",
        proposed_action: "create_rule",
        risk_level: "high",
        status: "resolved",
        human_decision: "approved",
        human_feedback: "近 3 次 CI 编译失败复盘后必须固化为 P0 硬门禁，准予物化。",
        decided_at: iso(-7),
        created_at: iso(-8),
        origin_scope: "governance",
        availability_scope: "tenant_global",
        reason: "CI 编译失败事故复盘，需要硬门禁。",
        proposed_payload: { title: "提交前必须通过完整编译", rule_key: "guard.build.compile_required" }
      },
      {
        id: "prop-rule-self-test-old-approved",
        target_object_type: "rule",
        target_object_id: "rule-self-test-005",
        proposed_action: "create_rule",
        risk_level: "high",
        status: "resolved",
        human_decision: "approved",
        human_feedback: "交付前自测清单完整，准予物化为 P0 硬门禁。",
        decided_at: iso(-7),
        created_at: iso(-8),
        origin_scope: "governance",
        availability_scope: "tenant_global",
        reason: "用户多次反馈交付物有低级错误，需要交付前门禁。",
        proposed_payload: { title: "提交给用户前必须自测", rule_key: "guard.delivery.self_test_required" }
      },
      {
        id: "prop-rule-tone-old-approved",
        target_object_type: "rule",
        target_object_id: "rule-no-sycophancy-006",
        proposed_action: "create_rule",
        risk_level: "medium",
        status: "resolved",
        human_decision: "approved",
        human_feedback: "用户多次明确表达反感讨好语气，固化为个人规则。先 soft_advisory 上线。",
        decided_at: iso(-3),
        created_at: iso(-4),
        origin_scope: "user_direct",
        availability_scope: "user_private",
        reason: "用户偏好直接沟通，要求禁止讨好语气。",
        proposed_payload: { title: "禁止使用讨好用户的语气", rule_key: "guard.tone.no_sycophancy" }
      }
    ],

    // ---------- 治理运行记录（10 条）----------
    runs: [
      { id: "run-001", status: "completed", stage: "L4_synthesis", created_at: iso(-8), updated_at: iso(-8), result_payload: { promoted_outputs: "fact_count=2;synthesized_knowledge_count=1", governance_candidates: "memory_count=3;rule_count=1;skill_proposal_count=2;knowledge_count=1" } },
      { id: "run-002", status: "completed", stage: "L2_conflict", created_at: iso(-14), updated_at: iso(-14), result_payload: { promoted_outputs: "fact_count=1", governance_candidates: "memory_count=2;rule_count=0;skill_proposal_count=0;knowledge_count=0" } },
      { id: "run-003", status: "completed", stage: "L3_evolution", created_at: iso(-18), updated_at: iso(-18), result_payload: { promoted_outputs: "fact_count=0;synthesized_knowledge_count=1", governance_candidates: "memory_count=1;rule_count=2;skill_proposal_count=1;knowledge_count=0" } },
      { id: "run-004", status: "failed", stage: "L4_synthesis", created_at: iso(-22), updated_at: iso(-22), result_payload: { promoted_outputs: "fact_count=0", governance_candidates: "memory_count=0;rule_count=0;skill_proposal_count=0;knowledge_count=0" } },
      { id: "run-005", status: "completed", stage: "L2_conflict", created_at: iso(-25), updated_at: iso(-25), result_payload: { promoted_outputs: "fact_count=3", governance_candidates: "memory_count=4;rule_count=1;skill_proposal_count=0;knowledge_count=2" } },
      { id: "run-006", status: "completed", stage: "L4_synthesis", created_at: iso(-20), updated_at: iso(-20), result_payload: { promoted_outputs: "fact_count=1;synthesized_knowledge_count=1", governance_candidates: "memory_count=2;rule_count=0;skill_proposal_count=0;knowledge_count=1" } },
      { id: "run-007", status: "completed", stage: "L2_conflict", created_at: iso(-5), updated_at: iso(-5), result_payload: { promoted_outputs: "fact_count=0", governance_candidates: "memory_count=1;rule_count=1;skill_proposal_count=0;knowledge_count=0" } },
      { id: "run-008", status: "completed", stage: "L3_evolution", created_at: iso(-6), updated_at: iso(-6), result_payload: { promoted_outputs: "fact_count=0;synthesized_knowledge_count=1", governance_candidates: "memory_count=0;rule_count=1;skill_proposal_count=0;knowledge_count=0" } },
      { id: "run-009", status: "completed", stage: "L4_synthesis", created_at: iso(-3), updated_at: iso(-3), result_payload: { promoted_outputs: "fact_count=2;synthesized_knowledge_count=2", governance_candidates: "memory_count=2;rule_count=0;skill_proposal_count=1;knowledge_count=2" } },
      { id: "run-010", status: "running", stage: "L3_evolution", created_at: iso(0), updated_at: iso(0), result_payload: { promoted_outputs: "fact_count=0", governance_candidates: "memory_count=0;rule_count=0;skill_proposal_count=0;knowledge_count=0" } }
    ],

    // ---------- ops overview（仪表盘拟真增强）----------
    opsOverview: {
      document_count: 64,
      section_count: 318,
      evidence_count: 12,
      entity_count: 12,
      fact_count: 12,
      relation_count: 55,
      active_review_count: 10,
      governance_job_count: 10,
      trace_count: 142,
      dedup_rate: 73,
      gate_trigger_count: 36,
      plugin_call_count: 312,
      rps: 4.2,
      avg_latency_ms: 87,
      p99_latency_ms: 234,
      success_rate: 96.8,
      error_rate: 0.4,
      active_user_count: 8,
      active_host_count: 4,
      // 近 7 天每日治理运行次数（用于仪表盘趋势图）
      daily_runs: [
        { date: "06-24", l2: 2, l3: 1, l4: 2 },
        { date: "06-25", l2: 3, l3: 2, l4: 1 },
        { date: "06-26", l2: 1, l3: 3, l4: 2 },
        { date: "06-27", l2: 2, l3: 1, l4: 3 },
        { date: "06-28", l2: 4, l3: 2, l4: 1 },
        { date: "06-29", l2: 2, l3: 1, l4: 2 },
        { date: "06-30", l2: 3, l3: 2, l4: 1 }
      ],
      // 4 层对象规模（用于仪表盘分层 KPI）
      layer_counts: {
        memory: 16,
        knowledge: 10,
        rule: 8,
        skill: 8
      },
      // 治理分布
      governance_breakdown: {
        approved: 8,
        rejected: 1,
        pending: 10,
        auto_promoted: 3
      },
      corpus_governance: {
        active_document_count: 52,
        retired_document_count: 12,
        active_full_markdown_document_count: 38,
        active_generated_document_count: 14,
        active_derived_knowledge_count: 10
      }
    },

    // ---------- pipeline-summary ----------
    pipelineSummary: {
      l2: { conflict_proposals: 12 },
      l3: { evolution_signals: 8 },
      l4: { synthesized_knowledge: 10 }
    }
  };

  // ===== 4. 内存状态（深拷贝，操作只改这里）=====
  let state = deepClone(INITIAL);

  // ===== 5. 审批后自动生成 skill/rule/knowledge =====
  function createSkillFromProposal(proposal) {
    const p = proposal.proposed_payload || {};
    return {
      id: rid("skill-gen"),
      skill_key: p.skill_key || "skill.generated",
      title: p.title || "未命名 Skill",
      source_kind: "governance_approved",
      origin_scope: proposal.origin_scope || "governance",
      availability_scope: p.availability_scope || proposal.availability_scope || "project_reusable",
      scope: p.availability_scope || proposal.availability_scope || "project_reusable",
      skill_type: p.skill_type || "procedural",
      risk_level: p.risk_level || proposal.risk_level || "low",
      version: 1,
      status: "active",
      description: p.description || "（由审批通过的提议物化生成）",
      applicable_scenarios: p.applicable_scenarios || [],
      non_applicable_scenarios: p.non_applicable_scenarios || [],
      procedure_payload: p.procedure_payload || { host_action: { status: "generated", summary: "已物化" } },
      trigger_conditions: p.trigger_conditions || {},
      metadata: Object.assign({ call_count: 0 }, p.metadata || {}, { generated_from_proposal: proposal.id, approved_at: now() }),
      success_rate: null,
      recall_count: 0,
      created_at: now(),
      utility_score: 0.7
    };
  }

  function createRuleFromProposal(proposal) {
    const p = proposal.proposed_payload || {};
    return {
      id: rid("rule-gen"),
      rule_key: p.rule_key || "rule.generated",
      title: p.title || "未命名 Rule",
      enforcement_level: p.enforcement_level || "hard_gate",
      priority: p.priority || "P1",
      risk_level: p.risk_level || proposal.risk_level || "medium",
      version: 1,
      status: "active",
      rule_domain: p.rule_domain || "governance",
      rule_type: p.rule_type || "precondition",
      origin_scope: proposal.origin_scope || "governance",
      availability_scope: p.availability_scope || proposal.availability_scope || "tenant_global",
      scope: p.availability_scope || proposal.availability_scope || "tenant_global",
      applies_to: p.applies_to || ["governance"],
      statement: p.statement || "（由审批通过的提议物化生成）",
      trigger_conditions: p.trigger_conditions || {},
      metadata: Object.assign({}, p.metadata || {}, { generated_from_proposal: proposal.id, approved_at: now() }),
      evidence_refs: [],
      source_refs: [],
      supersedes_rule_id: null,
      recall_count: 0,
      created_at: now(),
      utility_score: 0.7
    };
  }

  function createKnowledgeFromProposal(proposal) {
    const p = proposal.proposed_payload || {};
    return {
      id: rid("know-gen"),
      title: p.title || "未命名知识",
      knowledge_type: p.knowledge_type || "synthesis",
      confidence_score: p.confidence_score || 0.7,
      recall_state: "active",
      recall_count: 0,
      availability_scope: p.availability_scope || "tenant_global",
      origin_scope: proposal.origin_scope || "governance",
      lifecycle_state: "active",
      review_state: "approved",
      content: p.content || "（由审批通过的提议物化生成）",
      reasoning_summary: p.reasoning_summary || "（由审批通过的提议物化生成）",
      risk_level: "low",
      created_at: now(),
      utility_score: 0.7,
      metadata: { pitfall: "合成知识标记，需后续验证" },
      source_object_ids: [],
      evidence_ids: [],
      // 合成标记：体现 1+1=2 或 1→3 的合成模式
      synthesis: { mode: "merge", sources: [proposal.id], layer: "L4", note: "审批通过后物化生成" },
      source_refs: [{ source_kind: "governance", source_excerpt: "审批物化", source_timestamp: now() }]
    };
  }

  function handleProposalAction(id, action, feedback) {
    const proposal = state.proposals.find(p => p.id === id);
    if (!proposal) return;
    // 更新 proposal 状态
    proposal.status = "resolved";
    proposal.human_decision = action;
    proposal.decided_at = now();
    if (feedback) proposal.human_feedback = feedback;
    // 从待审批移到历史
    state.proposals = state.proposals.filter(p => p.id !== id);
    state.history.unshift(proposal);
    // approve 时自动生成 skill/rule/knowledge
    if (action === "approve") {
      if (proposal.target_object_type === "skill") {
        const newSkill = createSkillFromProposal(proposal);
        state.skills.unshift(newSkill);
        // 同步到 graph overview 的 skills 数组
        if (state.graphOverview && state.graphOverview.skills) {
          state.graphOverview.skills.unshift({
            id: newSkill.id,
            title: newSkill.title,
            skill_key: newSkill.skill_key,
            utility_score: newSkill.utility_score,
            status: newSkill.status
          });
        }
      } else if (proposal.target_object_type === "rule") {
        const newRule = createRuleFromProposal(proposal);
        state.rules.unshift(newRule);
        if (state.graphOverview && state.graphOverview.rules) {
          state.graphOverview.rules.unshift({
            id: newRule.id,
            title: newRule.title,
            rule_key: newRule.rule_key,
            utility_score: newRule.utility_score,
            status: newRule.status
          });
        }
      } else if (proposal.target_object_type === "synthesized_knowledge" || proposal.target_object_type === "knowledge") {
        const newKnow = createKnowledgeFromProposal(proposal);
        state.knowledge.unshift(newKnow);
        if (state.graphOverview && state.graphOverview.synthesized_knowledge) {
          state.graphOverview.synthesized_knowledge.unshift({
            id: newKnow.id,
            title: newKnow.title,
            knowledge_type: newKnow.knowledge_type,
            utility_score: newKnow.utility_score,
            status: newKnow.recall_state,
            synthesis: newKnow.synthesis
          });
        }
      }
    }
  }

  // ===== 6. graph/overview 聚合（基于 state 动态生成）=====
  function buildGraphOverview() {
    const byLayer = { l2: [], l3: [], l4: [], other: [] };
    [...state.proposals, ...state.history].forEach(p => {
      const act = String(p.proposed_action || "");
      if (act.indexOf("l2_conflict") === 0) byLayer.l2.push(p);
      else if (act.indexOf("l3_evolution") === 0) byLayer.l3.push(p);
      else if (act.indexOf("l4_synthesis") === 0 || act.indexOf("create_synthesized") === 0) byLayer.l4.push(p);
      else byLayer.other.push(p);
    });

    return {
      stats: {
        entity_count: state.entities.length,
        fact_count: state.facts.length,
        relation_count: state.relations.length,
        synthesized_knowledge_count: state.knowledge.length,
        evidence_count: state.evidence.length,
        proposal_count: state.proposals.length + state.history.length,
        rule_count: state.rules.length,
        memory_count: state.memory.length,
        skill_count: state.skills.length,
        utility_summary: { high: 8, medium: 6, low: 4, no_signal: 2 }
      },
      proposals_by_layer: byLayer,
      entities: state.entities,
      facts: state.facts,
      synthesized_knowledge: state.knowledge,
      evidence: state.evidence,
      governance_proposals: [...state.proposals, ...state.history],
      rules: state.rules.map(r => ({ id: r.id, title: r.title, rule_key: r.rule_key, utility_score: r.utility_score || 0.7, status: r.status })),
      memories: state.memory.map(m => ({ id: m.id, title: m.title, memory_type: m.memory_type, utility_score: m.importance || 0.7, status: m.status })),
      skills: state.skills.map(s => ({ id: s.id, title: s.title, skill_key: s.skill_key, utility_score: s.utility_score || 0.7, status: s.status })),
      relations: state.relations,
      evidence_trace: state.evidence_trace
    };
  }

  // 缓存 graphOverview，审批后重建
  state.graphOverview = buildGraphOverview();

  // ===== 7. fetch 拦截 =====
  const originalFetch = window.fetch;
  const jsonResponse = (data, delay) => new Promise((resolve) => {
    setTimeout(() => resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(data),
      text: () => Promise.resolve(JSON.stringify(data)),
      headers: { get: () => "application/json" }
    }), delay || 120);
  });

  function matchPath(path, pattern) {
    const pp = pattern.split("/");
    const pa = path.split("?")[0].split("/");
    if (pp.length !== pa.length) return null;
    const params = {};
    for (let i = 0; i < pp.length; i++) {
      if (pp[i].indexOf(":") === 0) {
        params[pp[i].slice(1)] = pa[i];
      } else if (pp[i] !== pa[i]) {
        return null;
      }
    }
    return params;
  }

  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const method = ((init && init.method) || "GET").toUpperCase();
    const body = (init && init.body) ? (() => { try { return JSON.parse(init.body); } catch (e) { return null; } })() : null;
    const path = url.split("?")[0];
    const query = url.indexOf("?") >= 0 ? url.slice(url.indexOf("?") + 1) : "";
    const qparams = new URLSearchParams(query);

    // ---- GET /internal/rules ----
    if (path === "/internal/rules" && method === "GET") {
      return jsonResponse({ items: state.rules });
    }
    // ---- GET /internal/skills ----
    if (path === "/internal/skills" && method === "GET") {
      return jsonResponse({ items: state.skills });
    }
    // ---- GET /internal/knowledge/synthesized-knowledge ----
    if (path === "/internal/knowledge/synthesized-knowledge" && method === "GET") {
      return jsonResponse({ items: state.knowledge });
    }
    // ---- POST /internal/memory/query ----
    // 兼容两种查询方式：
    //   1. body.kind = "user_memory" / "project_memory" 等（业务层类型，与筛选 tab 对齐）
    //   2. body.kind = "all" 或缺省 → 返回全部
    if (path === "/internal/memory/query" && method === "POST") {
      const kind = (body && body.kind) || "all";
      let items = state.memory;
      if (kind && kind !== "all") {
        items = state.memory.filter(m => (m.memory_type === kind) || (m.kind === kind));
      }
      return jsonResponse({ items: items });
    }
    // ---- GET /internal/knowledge/ops/overview ----
    if (path === "/internal/knowledge/ops/overview" && method === "GET") {
      return jsonResponse(state.opsOverview);
    }
    // ---- GET /internal/knowledge/governance/runs ----
    if (path === "/internal/knowledge/governance/runs" && method === "GET") {
      return jsonResponse({ items: state.runs });
    }
    // ---- GET /internal/governance/change-proposals ----
    if (path === "/internal/governance/change-proposals" && method === "GET") {
      const status = qparams.get("status");
      const decision = qparams.get("human_decision");
      if (status === "recorded") {
        return jsonResponse({ items: state.proposals });
      }
      if (status === "resolved") {
        let items = state.history;
        if (decision === "approved") items = state.history.filter(p => p.human_decision === "approved");
        if (decision === "rejected") items = state.history.filter(p => p.human_decision === "rejected");
        return jsonResponse({ items: items });
      }
      // 全量（pipeline 用）
      return jsonResponse({ items: [...state.proposals, ...state.history] });
    }
    // ---- POST /internal/governance/change-proposals/:id/actions ----
    let m = matchPath(path, "/internal/governance/change-proposals/:id/actions");
    if (m && method === "POST") {
      const action = (body && body.action) || "approve";
      const feedback = (body && body.payload && body.payload.feedback) || "";
      handleProposalAction(m.id, action, feedback);
      return jsonResponse({ ok: true, id: m.id, action: action });
    }
    // ---- GET /internal/knowledge/graph/overview ----
    if (path === "/internal/knowledge/graph/overview" && method === "GET") {
      // 重建以确保审批后 graph 同步
      state.graphOverview = buildGraphOverview();
      return jsonResponse(state.graphOverview);
    }
    // ---- GET /internal/governance/pipeline-summary ----
    if (path === "/internal/governance/pipeline-summary" && method === "GET") {
      // 动态计算
      const byLayer = { l2: [], l3: [], l4: [], other: [] };
      [...state.proposals, ...state.history].forEach(p => {
        const act = String(p.proposed_action || "");
        if (act.indexOf("l2_conflict") === 0) byLayer.l2.push(p);
        else if (act.indexOf("l3_evolution") === 0) byLayer.l3.push(p);
        else if (act.indexOf("l4_synynthesis") === 0 || act.indexOf("create_synthesized") === 0) byLayer.l4.push(p);
        else byLayer.other.push(p);
      });
      return jsonResponse({
        l2: { conflict_proposals: byLayer.l2.length },
        l3: { evolution_signals: byLayer.l3.length },
        l4: { synthesized_knowledge: state.knowledge.length }
      });
    }

    // ---- 其他未拦截的请求：走真实 fetch（demo 模式下大概率 404，但不影响主流程）----
    return originalFetch.apply(this, arguments);
  };

  // ===== 8. demo 模式标识 =====
  function showDemoBadge() {
    const badge = document.createElement("div");
    badge.style.cssText = "position:fixed;top:8px;right:8px;z-index:9999;background:linear-gradient(135deg,#06B6D4,#8B5CF6);color:#fff;padding:6px 12px;border-radius:6px;font-size:11px;font-weight:600;font-family:'JetBrains Mono',monospace;box-shadow:0 2px 8px rgba(0,0,0,0.4);cursor:help;";
    badge.title = "Demo 模式：所有数据为 mock，操作不影响后端，刷新页面恢复初始状态";
    badge.textContent = "DEMO MODE";
    document.body.appendChild(badge);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", showDemoBadge);
  } else {
    showDemoBadge();
  }

  // 暴露调试接口（控制台可手动重置）
  window.__resetDemo = function () {
    state = deepClone(INITIAL);
    state.graphOverview = buildGraphOverview();
    console.log("[demo] 已重置为初始状态，刷新页面生效");
  };
  console.log("[demo] Mock 数据层已启用。访问 __resetDemo() 可重置内存状态。");
})();
