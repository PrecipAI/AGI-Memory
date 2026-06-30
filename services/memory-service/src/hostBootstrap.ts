/**
 * 宿主挂载 bootstrap 数据：内置宿主自带的完整 skill/memory/rule 清单。
 *
 * 在 memory-service 启动时（onReady 钩子）自动注册，确保仪表盘一打开就能看到宿主全部能力，
 * 不需要宿主主动推送。幂等：重复注册不会产生重复数据。
 *
 * 数据来源：宿主（TRAE）系统提示中的 available_skills + AGENTS.md 工作空间规则。
 */

// ============================================================================
// Skills：宿主自带的 42 个 skill
// 按 skill_type 分组：generative / procedural / integration / knowledge / publishing
// ============================================================================

export const HOST_BOOTSTRAP_SKILLS = [
  // ── 生成式：前端设计与艺术 ──────────────────────────────────────────
  { skill_key: "frontend-design", title: "Frontend Design Skill", description: "创建独特的、生产级的前端界面，具有高设计质量。用于构建 web 组件、页面、artifact、poster 或应用", skill_type: "generative", risk_level: "low", tags: ["frontend", "design", "ui"] },
  { skill_key: "frontend-skill", title: "Frontend Skill", description: "用于视觉强烈的 landing page、网站、应用、原型、demo 或游戏 UI。强调克制构图、图像主导层级、动效", skill_type: "generative", risk_level: "low", tags: ["frontend", "landing", "prototype"] },
  { skill_key: "web-dev", title: "Web Dev Skill", description: "创建生产级 Web 界面，高设计质量。仅在用户明确要求从零构建新网站/页面/应用时使用", skill_type: "generative", risk_level: "low", tags: ["web", "development", "frontend"] },
  { skill_key: "algorithmic-art", title: "Algorithmic Art Skill", description: "使用 p5.js 创建算法艺术，带种子随机和交互参数探索。用于生成艺术、流场、粒子系统", skill_type: "generative", risk_level: "low", tags: ["art", "p5js", "generative"] },
  { skill_key: "canvas-design", title: "Canvas Design Skill", description: "创建美丽的视觉艺术 .png/.pdf 文档。用于 poster、艺术品、设计稿等静态作品", skill_type: "generative", risk_level: "low", tags: ["canvas", "art", "design"] },

  // ── 流程式：开发流程工具 ────────────────────────────────────────────
  { skill_key: "git-commit", title: "Git Commit Skill", description: "执行 git commit，带 conventional commit message 分析、智能暂存和消息生成。支持自动检测 type/scope", skill_type: "procedural", risk_level: "low", tags: ["git", "commit", "vcs"] },
  { skill_key: "interview", title: "Interview Skill", description: "智能访谈确认用户真实意图，挖掘隐含需求，补全关键条件。生成结构化 SPEC 并严格执行", skill_type: "procedural", risk_level: "low", tags: ["interview", "spec", "requirement"] },
  { skill_key: "skill-creator", title: "Skill Creator", description: "创建 SKILLs 的强制工具。用户想创建/添加任何 skill 时必须立即调用", skill_type: "procedural", risk_level: "medium", tags: ["skill", "creator", "meta"] },
  { skill_key: "GateMaster", title: "GateMaster Skill", description: "将审批通过的 Rule 翻译为宿主可执行的 Hook 代码并注册到 Gate Registry", skill_type: "procedural", risk_level: "medium", tags: ["gate", "hook", "rule"] },
  { skill_key: "Skill Creator", title: "Skill Creator (Legacy)", description: "将治理系统审批通过的 skill 记录转换为宿主可识别的 SKILL.md 文件", skill_type: "procedural", risk_level: "medium", tags: ["skill", "converter", "meta"] },

  // ── 知识型：产品知识与维护 ──────────────────────────────────────────
  { skill_key: "TRAE-product-knowledge", title: "TRAE Product Knowledge Skill", description: "TRAE 品牌身份和官方产品知识问答，包括 TRAE IDE/Work/CLI/Plugin 入口、MCP、Skills、官方文档", skill_type: "knowledge", risk_level: "low", tags: ["trae", "product", "knowledge"] },
  { skill_key: "memory-lifecycle", title: "Memory Lifecycle Skill", description: "触发 memory-service 的 lifecycle 维护任务（重算 importance_weight、归档低权重知识、阈值校准）", skill_type: "knowledge", risk_level: "medium", tags: ["memory", "lifecycle", "maintenance"] },

  // ── 发布式：内容发布 ────────────────────────────────────────────────
  { skill_key: "douyin-interact-creation", title: "Douyin Interact Creation Skill", description: "为 interact_creation 创建或升级离线 H5 体验，生成单个 index.html 或可上传的 .zip", skill_type: "publishing", risk_level: "medium", tags: ["douyin", "h5", "interactive"] },
  { skill_key: "douyin-interactive-content-publish", title: "Douyin Interactive Content Publish Skill", description: "互动空间一键发布工具，上传 zip+icon 创建/更新互动空间应用", skill_type: "publishing", risk_level: "high", tags: ["douyin", "publish", "interactive"] },

  // ── 集成型：第三方工具集成 ──────────────────────────────────────────
  { skill_key: "figma", title: "Figma Skill", description: "使用 Figma MCP 服务器获取设计上下文、截图、变量和资产，将 Figma 节点翻译为生产代码", skill_type: "integration", risk_level: "low", tags: ["figma", "design", "mcp"] },

  // ── 集成型：飞书系列 skill ──────────────────────────────────────────
  { skill_key: "lark-approval", title: "Lark Approval Skill", description: "飞书审批：查询和处理审批待办/已办/实例，搜索审批定义、查看详情并发起审批", skill_type: "integration", risk_level: "medium", tags: ["lark", "approval", "feishu"] },
  { skill_key: "lark-apps", title: "Lark Apps Skill", description: "妙搭（Spark/Miaoda）应用开发与托管：应用创建、HTML 静态站点发布、本地全栈开发、云端生成迭代", skill_type: "integration", risk_level: "medium", tags: ["lark", "apps", "spark"] },
  { skill_key: "lark-attendance", title: "Lark Attendance Skill", description: "飞书考勤打卡：查询自己的考勤打卡记录", skill_type: "integration", risk_level: "low", tags: ["lark", "attendance", "feishu"] },
  { skill_key: "lark-base", title: "Lark Base Skill", description: "飞书多维表格（Base）操作：建表、字段、记录、视图、统计、公式、表单、仪表盘、workflow", skill_type: "integration", risk_level: "medium", tags: ["lark", "base", "bitable"] },
  { skill_key: "lark-calendar", title: "Lark Calendar Skill", description: "飞书日历：管理日历日程和会议室，查看/搜索日程、创建/更新日程、查询忙闲和推荐时段", skill_type: "integration", risk_level: "medium", tags: ["lark", "calendar", "feishu"] },
  { skill_key: "lark-contact", title: "Lark Contact Skill", description: "飞书通讯录：按姓名/邮箱解析成 open_id，或按 open_id 反查姓名/部门/邮箱/联系方式", skill_type: "integration", risk_level: "low", tags: ["lark", "contact", "feishu"] },
  { skill_key: "lark-doc", title: "Lark Doc Skill", description: "飞书云文档（Docx/Wiki 文档）：读取和编辑文档内容，插入或下载文档图片附件", skill_type: "integration", risk_level: "medium", tags: ["lark", "doc", "feishu"] },
  { skill_key: "lark-drive", title: "Lark Drive Skill", description: "飞书云空间（云盘）：管理文件和文件夹，上传/下载、复制/移动/删除、权限管理", skill_type: "integration", risk_level: "medium", tags: ["lark", "drive", "feishu"] },
  { skill_key: "lark-event", title: "Lark Event Skill", description: "Lark 实时事件监听：stream events as NDJSON，支持 IM 消息/任务更新/会议结束等事件", skill_type: "integration", risk_level: "low", tags: ["lark", "event", "stream"] },
  { skill_key: "lark-im", title: "Lark IM Skill", description: "飞书即时通讯：收发消息和管理群聊，发送和回复消息、搜索聊天记录、管理群成员", skill_type: "integration", risk_level: "medium", tags: ["lark", "im", "feishu"] },
  { skill_key: "lark-mail", title: "Lark Mail Skill", description: "飞书邮箱：起草/发送/回复/转发邮件，查阅/搜索邮件，管理邮件文件夹和标签", skill_type: "integration", risk_level: "medium", tags: ["lark", "mail", "feishu"] },
  { skill_key: "lark-markdown", title: "Lark Markdown Skill", description: "飞书 Markdown：查看、创建、上传、编辑和比较 Markdown 文件", skill_type: "integration", risk_level: "low", tags: ["lark", "markdown", "feishu"] },
  { skill_key: "lark-minutes", title: "Lark Minutes Skill", description: "飞书妙记：搜索妙记、查看基础信息、下载/上传音视频、读取或编辑妙记产物内容", skill_type: "integration", risk_level: "low", tags: ["lark", "minutes", "feishu"] },
  { skill_key: "lark-note", title: "Lark Note Skill", description: "飞书会议纪要（Note）直查：已知 note_id 时查询纪要详情、展示类型、关联文档 token", skill_type: "integration", risk_level: "low", tags: ["lark", "note", "feishu"] },
  { skill_key: "lark-okr", title: "Lark OKR Skill", description: "飞书 OKR：管理目标与关键结果，查看和编辑 OKR 周期、目标、关键结果、对齐关系", skill_type: "integration", risk_level: "low", tags: ["lark", "okr", "feishu"] },
  { skill_key: "lark-openapi-explorer", title: "Lark OpenAPI Explorer Skill", description: "飞书原生 OpenAPI 探索：从官方文档库挖掘未经 CLI 封装的原生 OpenAPI 接口", skill_type: "integration", risk_level: "low", tags: ["lark", "openapi", "explorer"] },
  { skill_key: "lark-shared", title: "Lark Shared Skill", description: "Lark CLI 认证设置：首次设置 lark-cli、运行 auth login、切换身份、处理权限错误", skill_type: "integration", risk_level: "low", tags: ["lark", "auth", "setup"] },
  { skill_key: "lark-sheets", title: "Lark Sheets Skill", description: "飞书电子表格：创建和操作电子表格，管理工作表与行列结构、读写单元格、图表、透视表", skill_type: "integration", risk_level: "medium", tags: ["lark", "sheets", "feishu"] },
  { skill_key: "lark-skill-maker", title: "Lark Skill Maker Skill", description: "创建 lark-cli 的自定义 Skill，把飞书 API 操作封装成可复用的 Skill", skill_type: "integration", risk_level: "medium", tags: ["lark", "skill", "maker"] },
  { skill_key: "lark-slides", title: "Lark Slides Skill", description: "飞书幻灯片：创建和编辑幻灯片，管理幻灯片页面（创建、删除、读取、局部替换）", skill_type: "integration", risk_level: "medium", tags: ["lark", "slides", "feishu"] },
  { skill_key: "lark-task", title: "Lark Task Skill", description: "飞书任务：管理任务、清单和任务智能体，创建待办、查看更新状态、拆分子任务", skill_type: "integration", risk_level: "medium", tags: ["lark", "task", "feishu"] },
  { skill_key: "lark-vc", title: "Lark VC Skill", description: "飞书视频会议：搜索历史会议记录、查询会议纪要、查询参会人快照", skill_type: "integration", risk_level: "low", tags: ["lark", "vc", "feishu"] },
  { skill_key: "lark-vc-agent", title: "Lark VC Agent Skill", description: "飞书视频会议会中能力：让应用机器人真实加入/离开会议，读取会中事件", skill_type: "integration", risk_level: "medium", tags: ["lark", "vc", "agent"] },
  { skill_key: "lark-whiteboard", title: "Lark Whiteboard Skill", description: "飞书画板：查询和编辑飞书云文档中的画板，导出预览图片、导出原始节点结构", skill_type: "integration", risk_level: "low", tags: ["lark", "whiteboard", "feishu"] },
  { skill_key: "lark-wiki", title: "Lark Wiki Skill", description: "飞书知识库：管理知识空间、空间成员和文档节点，创建查询知识空间、管理节点层级", skill_type: "integration", risk_level: "low", tags: ["lark", "wiki", "feishu"] },
  { skill_key: "lark-workflow-meeting-summary", title: "Lark Workflow Meeting Summary Skill", description: "会议纪要整理工作流：汇总指定时间范围内的会议纪要并生成结构化报告", skill_type: "integration", risk_level: "low", tags: ["lark", "workflow", "summary"] },
  { skill_key: "lark-workflow-standup-report", title: "Lark Workflow Standup Report Skill", description: "日程待办摘要：编排 calendar+agenda 和 task+get-my-tasks，生成指定日期的日程与任务摘要", skill_type: "integration", risk_level: "low", tags: ["lark", "workflow", "standup"] },
] as const;

// ============================================================================
// Memories：宿主自带的工作空间约定（来自 AGENTS.md）
// ============================================================================

export const HOST_BOOTSTRAP_MEMORIES = [
  { memory_type: "user_memory", title: "回复语言约定", content: "始终使用简体中文回复，除非用户明确要求英文。代码标识符、命令、日志、报错信息保持原始语言。", importance: 90, tags: ["host", "language", "convention"] },
  { memory_type: "user_memory", title: "事实确认原则", content: "自行确认信息来源，不将猜测作为事实陈述。优先编辑现有文件而非创建新文件。", importance: 85, tags: ["host", "principle", "quality"] },
  { memory_type: "project_memory", title: "任务性质确认", content: "确认任务是否需要改动代码。如果是计划或技术文档，不要动源代码。避免过度工程化。", importance: 80, tags: ["host", "task", "principle"] },
  { memory_type: "project_memory", title: "修复影响检查", content: "对当前修改进行全面影响分析：直接影响（调用方/参数兼容/返回值）、间接影响（数据流/共享状态/回调时机）、数据结构兼容性（新增/删除/类型变更）。", importance: 82, tags: ["host", "impact", "analysis"] },
  { memory_type: "project_memory", title: "Graphify 使用约定", content: "如果 graphify-out/GRAPH_REPORT.md 存在，回答架构或代码关系问题前优先先读它。遇到跨模块关系问题优先使用 graphify query/path/explain。", importance: 75, tags: ["host", "graphify", "convention"] },
  { memory_type: "project_memory", title: "Memory MCP 使用策略", content: "非平凡编码/设计/调试/集成/审查工作前先调用 memory_health + memory_retrieve_context。高风险操作前调用 rule_gate_check。验证后的设计决策调用 memory_ingest_candidate。", importance: 78, tags: ["host", "memory", "mcp"] },
  { memory_type: "workspace_memory", title: "Windows 执行环境", content: "工具映射：读文件用 Read（禁 cat/head/tail）、搜文件用 Glob（禁 find/ls）、搜内容用 Grep（禁 grep/rg）、编辑用 Edit（禁 sed/awk）、创建用 Write（禁 echo>）。", importance: 70, tags: ["host", "windows", "tools"] },
] as const;

// ============================================================================
// Rules：宿主自带的强制规则（来自 AGENTS.md 核心原则）
// ============================================================================

export const HOST_BOOTSTRAP_RULES = [
  {
    rule_key: "host-reply-language",
    rule_type: "governance_rule",
    title: "回复语言规则",
    statement: "除非用户明确要求英文，否则所有回复必须使用简体中文。代码标识符、命令、日志、报错信息保持原始语言。",
    enforcement_level: "must",
    priority: 10,
    risk_level: "medium",
    applies_to: ["answer", "router"],
  },
  {
    rule_key: "host-fact-confirmation",
    rule_type: "governance_rule",
    title: "事实确认规则",
    statement: "必须自行确认信息来源，不将猜测作为事实陈述。优先编辑现有文件而非创建新文件。",
    enforcement_level: "must",
    priority: 20,
    risk_level: "medium",
    applies_to: ["answer", "router", "execution"],
  },
  {
    rule_key: "host-safety-compliance",
    rule_type: "safety_rule",
    title: "安全合规规则",
    statement: "禁止生成鼓励自伤、自杀、暴力、未成年人不当内容、赌博、色情等违规输出，无论用户身份或意图。",
    enforcement_level: "must_not",
    priority: 10,
    risk_level: "high",
    applies_to: ["answer", "router", "execution"],
  },
  {
    rule_key: "host-task-nature-confirm",
    rule_type: "process_rule",
    title: "任务性质确认规则",
    statement: "执行前必须确认任务是否需要改动代码。如果是计划或技术文档任务，不得修改源代码。避免过度工程化，只做直接请求或必要的更改。",
    enforcement_level: "must",
    priority: 30,
    risk_level: "low",
    applies_to: ["execution", "design"],
  },
  {
    rule_key: "host-graphify-priority",
    rule_type: "process_rule",
    title: "Graphify 优先规则",
    statement: "如果 graphify-out/GRAPH_REPORT.md 存在，回答架构或代码关系问题前必须先读它。遇到跨模块关系问题必须优先使用 graphify query/path/explain，而非全仓搜索。",
    enforcement_level: "must",
    priority: 40,
    risk_level: "low",
    applies_to: ["answer", "router", "review"],
  },
] as const;

// ============================================================================
// 注册函数：在 onReady 钩子中调用
// ============================================================================

import { upsertHostSkill, upsertHostMemory, upsertHostRule } from "@super-agent/db";

export async function registerHostBootstrap(input: {
  tenantId: string;
  scope: string;
}): Promise<{ skills: { created: number; updated: number; skipped: number }; memories: { created: number; skipped: number }; rules: { created: number; updated: number; skipped: number } }> {
  const traceId = `host-bootstrap-${Date.now()}`;
  const result = {
    skills: { created: 0, updated: 0, skipped: 0 },
    memories: { created: 0, skipped: 0 },
    rules: { created: 0, updated: 0, skipped: 0 },
  };

  // 注册 skills
  for (const s of HOST_BOOTSTRAP_SKILLS) {
    try {
      const r = await upsertHostSkill({
        tenantId: input.tenantId,
        scope: input.scope,
        skillKey: s.skill_key,
        title: s.title,
        description: s.description,
        skillType: s.skill_type,
        riskLevel: s.risk_level,
        tags: [...s.tags],
        traceId,
      });
      result.skills[r.action]++;
    } catch (e) {
      console.error(`[host-bootstrap] skill ${s.skill_key} 注册失败:`, (e as Error).message);
    }
  }

  // 注册 memories
  for (const m of HOST_BOOTSTRAP_MEMORIES) {
    try {
      const r = await upsertHostMemory({
        tenantId: input.tenantId,
        scope: input.scope,
        memoryType: m.memory_type,
        title: m.title,
        content: m.content,
        importance: m.importance,
        tags: [...m.tags],
        traceId,
      });
      result.memories[r.action === "created" ? "created" : "skipped"]++;
    } catch (e) {
      console.error(`[host-bootstrap] memory ${m.title} 注册失败:`, (e as Error).message);
    }
  }

  // 注册 rules
  for (const r of HOST_BOOTSTRAP_RULES) {
    try {
      const rr = await upsertHostRule({
        tenantId: input.tenantId,
        scope: input.scope,
        ruleKey: r.rule_key,
        ruleType: r.rule_type,
        title: r.title,
        statement: r.statement,
        enforcementLevel: r.enforcement_level,
        priority: r.priority,
        riskLevel: r.risk_level,
        appliesTo: [...r.applies_to],
        traceId,
      });
      result.rules[rr.action]++;
    } catch (e) {
      console.error(`[host-bootstrap] rule ${r.rule_key} 注册失败:`, (e as Error).message);
    }
  }

  return result;
}
