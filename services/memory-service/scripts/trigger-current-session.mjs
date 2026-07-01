// 用当前对话内容触发抽取和治理（host_model 模式，数据真正写入 active）
// host_model 模式要求每个候选都带：candidate_type / source_kind / source_timestamp / source_excerpt / reason
// memory_candidate 里不能有过程性描述（looksLikeProcedure）
// knowledge_candidate 不能含项目内部信号（127.0.0.1 / npm run build / .env 等）
// skill_proposal_candidate 的 promotion_status 必须是 needs_review
const base = 'http://127.0.0.1:3101';

const SOURCE_KIND = "commentary";
const SOURCE_TIMESTAMP = new Date().toISOString();

// ============================================================
// memory_candidates：项目级开发经验 + 系统行为 + 调试方法论
// 每条都是 { symptom → root_cause → fix_action } 形式，避免过程性描述
// ============================================================
const memoryCandidates = [
  {
    memory_type: "project_memory",
    title: "宿主挂载 UPSERT 必须显式设 origin_scope/availability_scope",
    content: "症状：宿主挂载注册后仪表盘看不到数据。根因：upsertHostSkill/upsertHostMemory/upsertHostRule 的 INSERT 缺少 origin_scope/availability_scope 字段，走 schema 默认值 session/session_only，被 listActiveSkills 的 WHERE availability_scope IN (...) 过滤。修正：INSERT 显式设置 origin_scope='global', availability_scope='global_reusable'。这是代码实现层约束，靠硬编码保证。",
    importance: 85,
    confidence: "high",
    tags: ["code-constraint", "host-mount", "scope", "upsert"],
    source_excerpt: "upsertHostSkill INSERT 缺少字段，走默认 session_only 被过滤",
    reason: "该经验防止未来在 hostBootstrap 类似场景下重复踩坑"
  },
  {
    memory_type: "project_memory",
    title: "前端 source_kind 映射必须包含 host_mounted 分支",
    content: "症状：宿主挂载的 skill 被误标为 L1抽取。根因：前端 getSkillCategory 只认 host_builtin 不认 host_mounted，fallback 到 origin_scope 推断。修正：source_kind 映射添加 host_mounted 分支。这是前端函数实现约束，靠代码 review 保证。",
    importance: 80,
    confidence: "high",
    tags: ["code-constraint", "frontend", "source-kind"],
    source_excerpt: "前端只认 host_builtin，不认 host_mounted，fallback 误标",
    reason: "该经验防止前端 source_kind 映射遗漏新枚举值"
  },
  {
    memory_type: "project_memory",
    title: "queryMemoryByKind 必须支持 kind=all",
    content: "症状：前端切换'全部'tab 返回空。根因：queryMemoryByKind 默认走 factual 分支只返回事实记忆，不支持 kind=all。修正：新增 kind='all' 分支跳过 memory_type 过滤；支持 memoryType 参数透传让前端按 tab 精确过滤。",
    importance: 85,
    confidence: "high",
    tags: ["bugfix", "query", "memory"],
    source_excerpt: "queryMemoryByKind 不支持 kind=all",
    reason: "该经验提醒 query 接口必须覆盖所有 kind 枚举值"
  },
  {
    memory_type: "project_memory",
    title: "去重 SQL 不能写死 memory_type",
    content: "症状：治理运行去重逻辑失效，重复写入。根因：filterExistingFactualMemoryCandidates 的去重 SQL 写死 memory_type='factual'，而 factual 不是合法枚举值（合法值是 user_memory/project_memory/workspace_memory/team_memory/session_memory/design_decision/integration_context）。写死导致永远查不到已存在记录。修正：改为 memory_type = $3 参数化，值取自 candidate.memory_type。",
    importance: 80,
    confidence: "high",
    tags: ["bugfix", "governance", "sql"],
    source_excerpt: "去重 SQL 写死 memory_type='factual' 导致查不到",
    reason: "该经验防止 SQL 写死枚举值导致查询失效"
  },
  {
    memory_type: "project_memory",
    title: "宿主挂载注册机制设计",
    content: "宿主挂载注册通过 hostBootstrap.ts 内置完整清单（42 skill + 7 memory + 5 rule），在 Fastify onReady 钩子异步调用 registerHostBootstrap 自动注册。幂等设计：按业务键查找 active 记录，内容未变跳过，内容变化 supersede 旧版本 + INSERT 新版本。source_kind='host_mounted' 标记宿主来源。",
    importance: 90,
    confidence: "high",
    tags: ["feature", "host-mount", "bootstrap"],
    source_excerpt: "hostBootstrap.ts 内置 42+7+5，onReady 自动注册",
    reason: "该架构知识帮助理解宿主挂载注册的整体设计"
  },
  {
    memory_type: "project_memory",
    title: "Fastify onReady 钩子的异步注册时序",
    content: "hostBootstrap 在 Fastify onReady 钩子异步调用，服务 listen 端口可访问时数据已注册完成。但 onReady 与 listen 之间有时间差，客户端在 onReady 完成前查询会拿不到宿主数据。Bootstrap 内置幂等检查，重复启动安全。",
    importance: 70,
    confidence: "medium",
    tags: ["architecture", "fastify", "timing"],
    source_excerpt: "onReady 钩子与 listen 时序差",
    reason: "该时序知识帮助排查启动初期数据缺失问题"
  },
  {
    memory_type: "project_memory",
    title: "治理运行三种持久化路径",
    content: "hostCaptureGovernanceRun.ts 有两个入口：runCodexHostGovernance（codex 会话路径，从 previewHostCapture 起步）、runGovernanceFromExtraction（通用抽取路径，直接用传入的 extraction_preview）。两者持久化逻辑相同（rule/memory/skill_proposal/knowledge 各自的 INSERT），但起点不同。run-from-extraction 路径还会跑 L2/L3/L4 治理流水线和 resident/index 重建。",
    importance: 75,
    confidence: "high",
    tags: ["architecture", "governance", "persistence"],
    source_excerpt: "两个入口函数持久化逻辑相同但起点不同",
    reason: "该架构知识帮助选择正确的治理运行入口"
  },
  {
    memory_type: "project_memory",
    title: "upsertHostMemory 的 source_ref NOT NULL 约束",
    content: "症状：宿主注册报 NOT NULL 错误。根因：memory 表的 source_ref 字段 NOT NULL，INSERT 缺少该字段。修复：宿主注册 INSERT 显式填 source_ref='host_mounted'。",
    importance: 70,
    confidence: "medium",
    tags: ["bugfix", "constraint", "memory"],
    source_excerpt: "INSERT 缺 source_ref 报 NOT NULL",
    reason: "该经验提醒 NOT NULL 字段必须显式赋值"
  },
  {
    memory_type: "project_memory",
    title: "upsertHostRule 的 priority smallint 类型",
    content: "症状：宿主注册报类型错误。根因：rule 表 priority 是 smallint（0-100），不是字符串。直接传字符串会报类型错误。修复：接口层做 P0→10/P1→20/P2→50/P3→75 映射。",
    importance: 70,
    confidence: "medium",
    tags: ["bugfix", "constraint", "rule"],
    source_excerpt: "priority 传 P0 字符串报类型错误",
    reason: "该经验提醒字段类型必须匹配 schema 定义"
  },
  {
    memory_type: "project_memory",
    title: "candidateIngress 必填字段清单",
    content: "症状：推送候选报 NOT NULL 错误。根因：POST /internal/memory/candidates 接口的 MemoryCandidateRequest 缺少必填字段。必填清单：task_request_id、task_step_id、candidate_type、source_type（NOT NULL）、source_ref、artifact_tag、verification_status、fingerprint_status、side_effect_class（task_step 表 NOT NULL，合法值 none/read_only/external_resource/state_change/approval）、candidate_payload。candidate_hash 由 extractor 自动算。",
    importance: 85,
    confidence: "high",
    tags: ["api-contract", "candidate-ingress", "not-null"],
    source_excerpt: "缺 side_effect_class / source_type 都会报 NOT NULL",
    reason: "该清单防止推送候选时遗漏必填字段"
  },
  {
    memory_type: "project_memory",
    title: "rules_fallback 模式的强制隔离行为",
    content: "症状：治理运行跑通但前端看不到数据。根因：governance_mode='rules_fallback' 时，forceFallbackQuarantine 把所有候选 promotion_status 强制改为 needs_review；持久化后 quarantineFallbackOutputs 再硬更新 DB 行为 parked 状态。rules_fallback 跑出来的数据不会进入 active 召回，只用于测试治理流程。要真正写入 active 必须用 host_model 模式并传 host_model_result.extraction_preview。",
    importance: 90,
    confidence: "high",
    tags: ["system-behavior", "governance", "fallback"],
    source_excerpt: "rules_fallback 强制 needs_review + parked",
    reason: "该经验防止误用 rules_fallback 模式导致数据不可见"
  },
  {
    memory_type: "project_memory",
    title: "L2 冲突检测器跨 memory_type 误杀坑",
    content: "症状：新候选全被 L2 判 DUPLICATE 跳过。根因：L2 detectConflicts 查 memory 表时 WHERE 条件不带 memory_type 过滤，只按 content ILIKE 关键词。上次跑测试残留的 memory_type='factual' 旧记录与新候选（memory_type='project_memory'）内容相似时，Jaccard 100% 被判 DUPLICATE 全部 SKIP。跨业务类型的相似内容会互相误杀。规避：跑治理前必须清理 parked 残留；或 L2 查询应区分 memory_type。",
    importance: 90,
    confidence: "high",
    tags: ["bug", "l2", "governance", "dedup"],
    source_excerpt: "残留 factual 记录把新 project_memory 候选全判 DUPLICATE",
    reason: "该经验提醒 L2 判重前必须清理跨类型残留"
  },
  {
    memory_type: "project_memory",
    title: "L2 Jaccard 降级模式阈值",
    content: "L2 detectConflicts 优先用 embedding HTTP 服务算余弦相似度（DUPLICATE 阈值 0.96）。服务不可用时降级为 token-level Jaccard（DUPLICATE 阈值 0.80）。完全相同内容 Jaccard=1.0 必然判 DUPLICATE。similarity_trigger 默认 0.50，低于此值不算冲突。",
    importance: 75,
    confidence: "high",
    tags: ["system-behavior", "l2", "threshold"],
    source_excerpt: "embedding 阈值 0.96 / Jaccard 阈值 0.80",
    reason: "该阈值知识帮助预判 L2 判重行为"
  },
  {
    memory_type: "project_memory",
    title: "buildStableKey 的 parts.join 永远是 string",
    content: "buildStableKey(prefix, ...parts) 内部用 parts.join('\\n') 拼接后传给 sha256。即使某个 part 是 undefined，join 也会转成字符串 'undefined'，不会抛错。所以排查 sha256(undefined) 错误时，不要盯 buildStableKey，要找其他直接调用 sha256() 的地方（如 knowledge_candidate 持久化的 contentHash: sha256(candidate.source_excerpt)）。",
    importance: 75,
    confidence: "high",
    tags: ["debugging", "sha256", "false-alarm"],
    source_excerpt: "buildStableKey 内部 join 永远安全，错的是直接调 sha256",
    reason: "该经验防止误归因到 buildStableKey 浪费时间"
  },
  {
    memory_type: "design_decision",
    title: "sha256(undefined) 错误归因方法论",
    content: "错误堆栈 'The data argument must be of type string... Received undefined' 提到 sha256 函数时，排查步骤：(1) 不要假设就是堆栈提到函数的内部问题；(2) 全局搜索所有 createHash/sha256 直接调用点；(3) 重点检查直接调用 sha256 而非通过 buildStableKey 包装的地方；(4) buildStableKey 内部 parts.join 永远返回 string 不会炸，真正炸的是直接调用 sha256(candidate.xxx) 的地方。",
    importance: 85,
    confidence: "high",
    tags: ["debugging", "methodology", "sha256", "attribution"],
    source_excerpt: "错误堆栈误导，真凶在直接调用点",
    reason: "该方法论帮助快速定位 sha256 类型错误真凶"
  },
  {
    memory_type: "design_decision",
    title: "数据残留是 L2 误杀的常见根因",
    content: "症状：治理运行新候选全被 L2 判 DUPLICATE 跳过。根因：跨治理运行的 parked/active 残留数据会被 L2 当成'已存在'判重。规避：跑治理前必须清残留——memory WHERE status='parked'、governance_change_proposal 全部、kp_synthesized_knowledge 测试标题、memory_candidate by source_ref、task_step by trace_id。保留宿主 bootstrap 注册的 active 记录（rule 5 条 + memory 7 条）不能误删。",
    importance: 88,
    confidence: "high",
    tags: ["sop", "debugging", "residue", "l2"],
    source_excerpt: "12 条 parked memory 把新候选全判 DUPLICATE",
    reason: "该 SOP 防止 L2 误杀导致数据丢失"
  },
  {
    memory_type: "design_decision",
    title: "rule vs project_memory 分类边界",
    content: "rule_candidates 和 memory_candidates 的分类边界：运行时门控规则（宿主执行操作时要拦截/确认的，如'prod 禁删用户'、'高敏感操作必须用户确认'）→ rule_candidates，走 rule 审批流程；代码实现约束（程序员写代码时要遵守的，如'INSERT 要设 global_reusable'、'前端要加 host_mounted 分支'）→ memory_candidates（memory_type=project_memory），归到开发规范类，靠代码 review / 类型系统 / AGENTS.md 保证。不能混淆——把代码规范塞进 rule 系统只会污染审批队列。",
    importance: 92,
    confidence: "high",
    tags: ["classification", "rule", "memory", "boundary"],
    source_excerpt: "误把代码约束推成 create_rule，污染审批队列",
    reason: "该边界知识防止候选类型误分类"
  },
  {
    memory_type: "design_decision",
    title: "TS 类型兜底字段必须是类型上存在的字段",
    content: "症状：TS 编译报错 'Property statement does not exist on type'。根因：兜底表达式 a ?? b ?? c 中 b/c 不在类型定义里。修复：兜底字段必须是类型定义中已存在的可选字段，或直接用 ?? '' 空字符串。运行时 JS 不会报错，但 TS 编译会挂。",
    importance: 78,
    confidence: "high",
    tags: ["typescript", "type-safety", "fallback"],
    source_excerpt: "加了 ?? candidate.statement 导致 TS 编译失败",
    reason: "该经验防止 TS 兜底字段误用类型外字段"
  },
  {
    memory_type: "integration_context",
    title: "PowerShell vs Bash 环境差异",
    content: "症状：命令在 PowerShell 下报错。根因：Windows PowerShell 与 Bash 有关键差异：(1) PowerShell 不支持 && 作为命令分隔符，要用 ;；(2) PowerShell 下 Node.js node -e 内联脚本引号嵌套极易失败，写临时 .mjs 脚本更可靠；(3) PowerShell 中文字符串编码可能被破坏，优先用 Node.js 脚本而非 .ps1；(4) npm script 在 PowerShell 下 && 也会失败。",
    importance: 80,
    confidence: "high",
    tags: ["environment", "powershell", "bash", "windows"],
    source_excerpt: "&& 在 PowerShell 报 InvalidEndOfLine 错误",
    reason: "该经验帮助在 Windows 环境下选择正确的命令形式"
  },
  {
    memory_type: "integration_context",
    title: "GitHub Pages 静态部署方案",
    content: "demo 部署用 GitHub Pages，无需后端/数据库/Docker。通过 .github/workflows/deploy-pages.yml 自动部署 public/ 目录。workflow 关键配置：permissions: pages: write + id-token: write（必需，否则部署失败）；concurrency: group=pages, cancel-in-progress: true（防并发部署冲突）；environment: name=github-pages, url=step.outputs.page_url。前端探测 /healthz 失败时自动跳转 ?demo=1 使用 mock 数据。GitHub Pages 完全免费，Render 免费账号需绑信用卡。",
    importance: 75,
    confidence: "high",
    tags: ["deployment", "github-pages", "static", "ci-cd"],
    source_excerpt: "GitHub Actions workflow 自动部署 public/",
    reason: "该方案提供免信用卡的静态 demo 部署路径"
  },
];

// ============================================================
// skill_proposal_candidates
// host_model 要求 promotion_status='needs_review'（skill 必须人工审批）
// ============================================================
const skillProposalCandidates = [
  {
    skill_key: "host-bootstrap-registration",
    title: "宿主挂载自动注册 Skill",
    description: "在服务启动时自动注册宿主自带的 skill/memory/rule 清单。在服务初始化或宿主挂载时调用。幂等设计，重复启动不会产生重复数据。",
    content: "服务启动时自动注册宿主自带的 skill/memory/rule 清单。幂等设计，重复启动不会产生重复数据。",
    target_skill: "host-bootstrap-registration",
    proposed_text: "在 Fastify onReady 钩子调用 registerHostBootstrap，内置 42 skill + 7 memory + 5 rule 清单，按业务键幂等 UPSERT。",
    current_gap: "当前服务启动时没有自动注册宿主自带清单，导致仪表盘数据缺失",
    change_type: "add",
    validation_method: "启动后调用 GET /internal/skills 验证 42 条宿主 skill 已注册",
    proposal_quality: "actionable",
    skill_type: "procedural",
    risk_level: "low",
    applicable_scenarios: ["服务启动时", "宿主挂载时"],
    non_applicable_scenarios: ["运行时查询", "用户交互"],
    execution_steps: ["读取内置清单", "按业务键查找 active 记录", "内容未变跳过", "内容变化标记旧版本 superseded 并写入新版本"],
    promotion_status: "needs_review",
    source_excerpt: "hostBootstrap.ts + onReady 钩子",
    reason: "该技能提议帮助标准化宿主挂载注册流程"
  },
];

// ============================================================
// knowledge_candidates：抽象方法论（不含项目内部信号）
// 不能含：127.0.0.1 / postgresql:// / npm run build / .env / 本项目 等
// ============================================================
const knowledgeCandidates = [
  {
    title: "UPSERT 幂等模式",
    content: "按业务键查找已存在记录：内容未变 → skip；内容变化 → 标记旧记录 superseded + 写入新版本。适用于宿主挂载注册、配置同步等需要幂等更新的场景。比 ON CONFLICT 更灵活，可处理内容版本变更。",
    knowledge_type: "pattern",
    tags: ["pattern", "upsert", "idempotent"],
    source_excerpt: "幂等 UPSERT 设计模式",
    reason: "该模式帮助设计需要幂等更新的数据写入逻辑"
  },
  {
    title: "错误堆栈归因方法论",
    content: "错误堆栈提到函数 X 时，不要假设就是 X 内部的问题。可能的情况：(1) X 内部确实有 bug；(2) 其他直接调用 X 的地方传了非法参数。排查步骤：先全局搜索所有调用 X 的点，区分包装调用（有兜底逻辑）和直接调用（往往没有兜底），直接调用层往往是真凶。",
    knowledge_type: "principle",
    tags: ["debugging", "methodology", "stack-trace"],
    source_excerpt: "错误堆栈归因方法论",
    reason: "该方法论帮助快速定位类型错误真凶"
  },
  {
    title: "相似度判重系统的数据残留陷阱",
    content: "基于相似度的去重/冲突检测系统会把跨运行的数据残留误判为重复。设计原则：(1) 测试环境跑治理前必须清理上次残留；(2) 判重查询应区分业务维度，避免跨类型误杀；(3) 完全相同内容相似度=1.0 必然判重，无法绕过；(4) 软删除状态的记录也会被当成'已存在'，不能用作软删除。",
    knowledge_type: "principle",
    tags: ["dedup", "similarity", "residue"],
    source_excerpt: "相似度判重系统的数据残留陷阱",
    reason: "该原则帮助设计相似度判重系统时避免残留误判"
  },
  {
    title: "TS 类型兜底安全模式",
    content: "TypeScript 兜底表达式的字段必须是类型上已存在的字段。a ?? b ?? c 中如果 b/c 不在类型定义里，TS 编译会失败（即使运行时 JS 不报错）。安全兜底模式：(1) 优先用类型上的可选字段；(2) 没有合适的可选字段时直接用 ?? ''；(3) 不要为了兜底加类型上不存在的字段。",
    knowledge_type: "principle",
    tags: ["typescript", "type-safety", "fallback"],
    source_excerpt: "TS 类型兜底安全模式",
    reason: "该原则帮助编写类型安全的兜底表达式"
  },
  {
    title: "候选类型分类决策树",
    content: "治理候选类型选择决策树：(1) 宿主运行时要拦截/确认的行为？→ rule_candidates（如'prod 禁删用户'）；(2) 程序员写代码时要遵守的实现约束？→ memory_candidates（project_memory，如'INSERT 要设 X'）；(3) 抽象的方法论/模式/原理？→ knowledge_candidates；(4) 对宿主 skill 清单的增删改提议？→ skill_proposal_candidates。误分类会污染对应的审批/召回队列。",
    knowledge_type: "principle",
    tags: ["classification", "governance", "decision-tree"],
    source_excerpt: "候选类型分类决策树",
    reason: "该决策树帮助正确分类治理候选"
  },
];

// host_model 模式要求每个候选带完整元数据
// governance_level 合法值：session / shared（不是 governance）
const enrichCandidate = (c, candidateType) => ({
  ...c,
  candidate_type: candidateType,
  origin_scope: "global",
  availability_scope: "global_reusable",
  governance_level: "shared",
  promotion_status: c.promotion_status ?? "active",
  source_kind: SOURCE_KIND,
  source_timestamp: SOURCE_TIMESTAMP,
});

const extractionPreview = {
  rule_candidates: [],
  memory_candidates: memoryCandidates.map((c) => enrichCandidate(c, "memory_candidate")),
  skill_proposal_candidates: skillProposalCandidates.map((c) => enrichCandidate(c, "skill_proposal_candidate")),
  knowledge_candidates: knowledgeCandidates.map((c) => enrichCandidate(c, "knowledge_candidate")),
  governance_evidence_candidates: []
};

console.log('=== 推送当前对话的抽取候选 ===');
console.log(`候选统计: memory=${extractionPreview.memory_candidates.length} skill=${extractionPreview.skill_proposal_candidates.length} knowledge=${extractionPreview.knowledge_candidates.length}`);

const taskId = crypto.randomUUID();
const stepId = crypto.randomUUID();

const candidateBody = {
  task_request_id: taskId,
  task_step_id: stepId,
  candidate_type: "conversation_summary",
  source_type: "conversation",
  source_ref: "trae-ide-current-session",
  artifact_tag: "conversation_summary",
  verification_status: "verified",
  fingerprint_status: "unknown",
  side_effect_class: "none",
  routing_reason: "user_requested_governance",
  candidate_payload: {
    conversation_topic: "AGI-Memory 治理运行调试 + 概念纠正 + memory 总结补全",
    key_decisions: [
      "sha256(undefined) 修复（行 676/1399 直接调用兜底）",
      "L2 跨 memory_type 误杀坑定位",
      "candidateIngress 必填字段补全",
      "rule vs project_memory 分类边界纠正",
      "PowerShell 环境差异应对",
      "TS 类型兜底安全模式",
      "数据残留清理 SOP",
    ],
    extraction_preview: extractionPreview
  }
};

const candidateRes = await fetch(`${base}/internal/memory/candidates`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(candidateBody),
});
const candidateResult = await candidateRes.json();
console.log('候选推送结果:', candidateResult);

console.log('\n=== 触发治理运行（host_model 模式，数据写入 active）===');
const govRes = await fetch(`${base}/internal/governance/run-from-extraction`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    extraction_preview: extractionPreview,
    host: 'trae-ide',
    governance_mode: 'host_model',
    host_model_result: {
      model_ref: 'trae-ide-current-session',
      generated_at: new Date().toISOString(),
      extraction_preview: extractionPreview,
    },
    refresh_memory: true,
    rebuild_resident: true,
    sync_index: true,
    run_lifecycle: true,
  }),
});
const govResult = await govRes.json();

if (!govRes.ok) {
  console.log('治理运行失败:', govResult);
} else {
  const p = govResult.persisted || {};
  console.log(`task_request_id: ${govResult.task_request_id ?? 'N/A'}`);
  console.log(`\n持久化结果:`);
  console.log(`  rule_ids: ${p.rule_ids?.length ?? 0} 条`);
  console.log(`  memory_ids: ${p.memory_ids?.length ?? 0} 条`);
  console.log(`  skill_proposal_ids: ${p.skill_proposal_ids?.length ?? 0} 条`);
  console.log(`  knowledge_ids: ${p.knowledge_ids?.length ?? 0} 条`);
  console.log(`  evidence_ids: ${p.evidence_ids?.length ?? 0} 条`);

  const a = govResult.acceptance_report?.governance_candidates || {};
  console.log(`\n治理候选统计:`);
  console.log(`  rule_count: ${a.rule_count}`);
  console.log(`  memory_count: ${a.memory_count}`);
  console.log(`  skill_proposal_count: ${a.skill_proposal_count}`);
  console.log(`  knowledge_count: ${a.knowledge_count}`);

  const inc = govResult.acceptance_report?.incremental || {};
  console.log(`\n增量统计:`);
  console.log(`  new_candidate_count: ${inc.new_candidate_count}`);
  console.log(`  skipped_previously_governed_count: ${inc.skipped_previously_governed_count}`);

  const prom = govResult.acceptance_report?.promoted_outputs || {};
  console.log(`\n已晋升输出:`);
  console.log(`  rule_count: ${prom.rule_count}`);
  console.log(`  long_term_memory_count: ${prom.long_term_memory_count}`);
  console.log(`  skill_proposal_count: ${prom.skill_proposal_count}`);
  console.log(`  synthesized_knowledge_count: ${prom.synthesized_knowledge_count}`);

  if (govResult.warnings?.length) {
    console.log(`\n警告:`);
    for (const w of govResult.warnings) console.log(`  - ${w}`);
  }
}
