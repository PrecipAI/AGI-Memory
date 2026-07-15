/**
 * 41. 静态记忆编译器 - 核心编排
 *
 * 职责：把 DB 中审批通过的 Rule/Skill/Memory 反向编译成宿主原生静态记忆文件
 * （CLAUDE.md / AGENTS.md / .trae/instructions.md）。
 *
 * 设计原则（互补而非替代）：
 *   - 宿主原生能力管"会话内压缩/临时记忆"
 *   - AGI-Memory 管"跨会话持久化/治理产出"
 *   - 本模块只把高置信度、长期稳定的治理产出编译进宿主原生格式
 *   - 用 marker 注入不全量覆盖，保护用户手写内容
 *
 * 编译流水线：
 *   1. 并行查询 DB（listActiveRules + listActiveSkills + listActiveFactualMemory）
 *   2. 类型适配为 FilterableItem
 *   3. filterCompilableItems 按层筛选（高置信度 + 长期稳定 + 非会话级 + 非时间敏感）
 *   4. formatRules/formatSkills/formatMemories 格式化成 markdown
 *   5. 三宿主并行写入三个 marker 区域（rules + skills + memory）
 *   6. 返回 CompileResult（含成功/跳过统计）
 */

import {
  listActiveRules,
  listActiveSkills,
  queryFactualMemory,
  querySynthesizedKnowledge,
} from "@super-agent/db";

import {
  filterCompilableItems,
  type FilterableItem,
} from "./contentFilter.js";
import {
  detectHosts,
  formatKnowledge,
  formatMemories,
  formatRules,
  formatSkills,
  HOST_CONFIGS,
  type HostType,
} from "./hostFormatter.js";
import {
  upsertMarkedBlock,
  validateMarkerIntegrity,
  type MarkerKey,
  type UpsertResult,
} from "./markerManager.js";
import {
  formatTraeProjectConstraints,
  formatTraeProjectConventions,
  formatTraeUserPreferences,
  getDefaultTraeMemoryRoot,
  splitMemoriesByType,
  writeTraeMemoryFiles,
} from "./traeMemoryAdapter.js";

export interface CompileInput {
  tenantId: string;
  scope: string;
  /** 仓库根目录（用于定位宿主原生文件） */
  repoRoot: string;
  /** 指定目标宿主；不传则自动检测，检测不到则三宿主全写 */
  targetHosts?: HostType[];
  /** 触发方式：immediate（审批通过即时编译）| scheduled（定时兜底全量重编译） */
  trigger: "immediate" | "scheduled";
  /**
   * TRAE memory 根目录（可选）。
   * 不传则用 getDefaultTraeMemoryRoot() 自动推导。
   * 测试时可指定临时目录避免污染真实文件。
   */
  traeMemoryRoot?: string;
  /**
   * 是否跳过 TRAE memory 文件写入（可选）。
   * 默认 false。测试 mock 场景可设为 true 避免写真实文件。
   */
  skipTraeMemory?: boolean;
}

/** 编译产物写入的宿主类型，包含宿主原生文件和 TRAE memory 系统文件 */
export type CompileFileHost =
  | HostType
  | "trae_memory_user"
  | "trae_memory_project";

export interface CompileFileResult {
  path: string;
  host: CompileFileHost;
  status: "created" | "updated" | "unchanged";
  backupPath?: string;
}

export interface CompileResult {
  ruleCount: number;
  skillCount: number;
  memoryCount: number;
  knowledgeCount: number;
  files: CompileFileResult[];
  skipped: Array<{ id: string; title: string; reason: string }>;
  /** 触发方式，便于审计 */
  trigger: CompileInput["trigger"];
  /**
   * 编译后 marker 完整性验证结果。
   * 写入完成后对每个文件调 validateMarkerIntegrity，记录 marker 配对问题。
   * 不阻塞编译完成（warn only），但调用方可以据此判断是否需要修复。
   */
  validationIssues: Array<{
    host: CompileFileHost;
    path: string;
    issues: Array<{ markerKey: string; issue: string }>;
  }>;
}

/**
 * 编译静态记忆到宿主原生文件。
 *
 * 使用方式：
 *   - 即时触发：审批通过后调用 compileStaticMemory({ trigger: "immediate", ... })
 *   - 定时兜底：每天 03:00 调用 compileStaticMemory({ trigger: "scheduled", ... })
 */
export async function compileStaticMemory(
  input: CompileInput,
): Promise<CompileResult> {
  // ── 1. 并行查询 DB ──
  // queryFactualMemory 不传 memoryType → 返回全部业务类型（user_memory/project_memory 等）
  // 比 listActiveFactualMemory 更合适，后者写死 memory_type='factual' 从未命中过
  const [ruleRows, skillRows, memoryRows, knowledgeRows] = await Promise.all([
    listActiveRules({ tenantId: input.tenantId, scope: input.scope }),
    listActiveSkills({
      tenantId: input.tenantId,
      scope: input.scope,
      fingerprint: null,
    }),
    queryFactualMemory({ tenantId: input.tenantId, scope: input.scope }),
    querySynthesizedKnowledge({ tenantId: input.tenantId, scope: input.scope }),
  ]);

  // ── 2. 类型适配 ──
  const ruleItems: FilterableItem[] = ruleRows.map(adaptRuleRow);
  const skillItems: FilterableItem[] = skillRows.map(adaptSkillRow);
  const memoryItems: FilterableItem[] = memoryRows.map(adaptMemoryRow);
  const knowledgeItems: FilterableItem[] = knowledgeRows.map(adaptKnowledgeRow);

  // ── 3. 按层筛选 ──
  const ruleFiltered = filterCompilableItems("rule", ruleItems);
  const skillFiltered = filterCompilableItems("skill", skillItems);
  const memoryFiltered = filterCompilableItems("memory", memoryItems);
  const knowledgeFiltered = filterCompilableItems("knowledge", knowledgeItems);

  // ── 4. 格式化 ──
  const rulesBlock = formatRules(ruleFiltered.passed);
  const skillsBlock = formatSkills(skillFiltered.passed);
  const memoryBlock = formatMemories(memoryFiltered.passed);
  const knowledgeBlock = formatKnowledge(knowledgeFiltered.passed);

  // ── 5. 确定目标宿主 ──
  // 显式指定 > 自动检测 > 三宿主全写（兜底，避免漏写）
  let hosts: HostType[];
  if (input.targetHosts && input.targetHosts.length > 0) {
    hosts = input.targetHosts;
  } else {
    const detected = detectHosts(input.repoRoot);
    hosts = detected.length > 0
      ? detected
      : (Object.keys(HOST_CONFIGS) as HostType[]);
  }

  // ── 6. 三宿主并行写入 ──
  // 宿主之间相互独立，可并行；同一宿主文件内四个 marker 区域串行写（避免并发写冲突）。
  const fileResults = await Promise.all(
    hosts.map((host) => writeHostFile(host, input.repoRoot, {
      rules: rulesBlock,
      skills: skillsBlock,
      memory: memoryBlock,
      knowledge: knowledgeBlock,
    })),
  );

  // ── 6.5 TRAE memory 系统文件写入 ──
  // 按 memory_type 分流：user_memory → user_profile.md，project_memory → project_memory.md
  // rule → project_memory.md 的 constraints 区域
  // 与宿主原生文件互补：宿主原生文件写全量，TRAE memory 按类型精准投放
  // skipTraeMemory=true 时跳过（测试 mock 场景避免污染真实文件）
  const traeFileResults: CompileFileResult[] = [];
  if (!input.skipTraeMemory) {
    const { userMemories, projectMemories } = splitMemoriesByType(
      memoryFiltered.passed,
    );
    const traeUserPrefsBlock = formatTraeUserPreferences(userMemories);
    const traeProjectConstraintsBlock = formatTraeProjectConstraints(
      ruleFiltered.passed,
    );
    const traeProjectConventionsBlock = formatTraeProjectConventions(
      projectMemories,
    );

    const traeMemoryRoot = input.traeMemoryRoot ?? getDefaultTraeMemoryRoot();
    const traeResult = await writeTraeMemoryFiles(
      { memoryRoot: traeMemoryRoot, projectPath: input.repoRoot },
      {
        userPreferences: traeUserPrefsBlock,
        projectConstraints: traeProjectConstraintsBlock,
        projectConventions: traeProjectConventionsBlock,
      },
    );

    if (traeResult.userProfile) {
      traeFileResults.push({
        path: traeResult.userProfile.filePath,
        host: "trae_memory_user",
        status: traeResult.userProfile.status,
        backupPath: traeResult.userProfile.backupPath,
      });
    }
    if (traeResult.projectMemory) {
      traeFileResults.push({
        path: traeResult.projectMemory.filePath,
        host: "trae_memory_project",
        status: traeResult.projectMemory.status,
        backupPath: traeResult.projectMemory.backupPath,
      });
    }
  }

  // ── 7. 编译后 marker 完整性验证 ──
  // 对每个写入的文件调 validateMarkerIntegrity，发现 marker 配对问题就记录。
  // 不阻塞返回（warn only），但调用方可以据此判断是否需要修复。
  const allFileResults = [
    ...fileResults.filter((r): r is CompileFileResult => r !== null),
    ...traeFileResults,
  ];
  const validationIssues: CompileResult["validationIssues"] = [];
  for (const fileResult of allFileResults) {
    try {
      const issues = await validateMarkerIntegrity(fileResult.path);
      if (issues.length > 0) {
        validationIssues.push({
          host: fileResult.host,
          path: fileResult.path,
          issues: issues.map((i) => ({
            markerKey: String(i.markerKey),
            issue: i.issue,
          })),
        });
      }
    } catch {
      // 验证失败不阻塞编译完成
    }
  }

  if (validationIssues.length > 0) {
    console.warn(
      `[static-memory-compiler] marker validation issues: ${JSON.stringify(validationIssues)}`,
    );
  }

  return {
    ruleCount: ruleFiltered.passed.length,
    skillCount: skillFiltered.passed.length,
    memoryCount: memoryFiltered.passed.length,
    knowledgeCount: knowledgeFiltered.passed.length,
    files: allFileResults,
    skipped: [
      ...ruleFiltered.skipped,
      ...skillFiltered.skipped,
      ...memoryFiltered.skipped,
      ...knowledgeFiltered.skipped,
    ],
    trigger: input.trigger,
    validationIssues,
  };
}

/**
 * 写入单个宿主文件的三个 marker 区域。
 * 三个区域串行写同一文件，返回最后一次写入的结果（用于状态汇总）。
 */
async function writeHostFile(
  host: HostType,
  repoRoot: string,
  blocks: { rules: string; skills: string; memory: string; knowledge?: string },
): Promise<CompileFileResult | null> {
  const config = HOST_CONFIGS[host];
  if (!config) return null;

  const filePath = config.getFilePath(repoRoot);

  // 串行写四个 marker 区域，合并状态
  const writes: Array<{ markerKey: MarkerKey; block: string }> = [];
  if (blocks.rules) writes.push({ markerKey: "rules", block: blocks.rules });
  if (blocks.skills) writes.push({ markerKey: "skills", block: blocks.skills });
  if (blocks.memory) writes.push({ markerKey: "memory", block: blocks.memory });
  if (blocks.knowledge) writes.push({ markerKey: "knowledge", block: blocks.knowledge });

  if (writes.length === 0) return null;

  let lastResult: UpsertResult | null = null;
  let anyChanged = false;
  let anyCreated = false;

  for (const write of writes) {
    const result = await upsertMarkedBlock({
      filePath,
      markerKey: write.markerKey,
      block: write.block,
    });
    lastResult = result;
    if (result.status === "created") anyCreated = true;
    if (result.status === "updated") anyChanged = true;
  }

  // 合并状态：只要有 created 就是 created，否则只要有 updated 就是 updated，否则 unchanged
  const mergedStatus: CompileFileResult["status"] = anyCreated
    ? "created"
    : anyChanged
      ? "updated"
      : "unchanged";

  return {
    path: filePath,
    host,
    status: mergedStatus,
    backupPath: lastResult?.backupPath,
  };
}

// ─── DB 行 → FilterableItem 适配器 ────────────────────────────────────

function adaptRuleRow(row: Record<string, unknown>): FilterableItem {
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? row.rule_key ?? ""),
    statement: typeof row.statement === "string" ? row.statement : undefined,
    content: typeof row.content === "string" ? row.content : undefined,
    promotion_status: String(row.promotion_status ?? "active"),
    enforcement_level:
      typeof row.enforcement_level === "string"
        ? row.enforcement_level
        : undefined,
    origin_scope: String(row.origin_scope ?? "session"),
    availability_scope: String(row.availability_scope ?? "session_only"),
    metadata:
      (row.metadata as Record<string, unknown> | null) ?? null,
  };
}

function adaptSkillRow(row: Record<string, unknown>): FilterableItem {
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? row.skill_key ?? ""),
    content:
      typeof row.description === "string" ? row.description : undefined,
    promotion_status: String(row.promotion_status ?? "active"),
    origin_scope: String(row.origin_scope ?? "session"),
    availability_scope: String(row.availability_scope ?? "session_only"),
    governance_level:
      typeof row.governance_level === "string"
        ? row.governance_level
        : undefined,
    self_test:
      (row.self_test as Record<string, unknown> | null) ?? null,
  };
}

function adaptMemoryRow(row: Record<string, unknown>): FilterableItem {
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? ""),
    content: typeof row.content === "string" ? row.content : undefined,
    promotion_status: String(row.promotion_status ?? "active"),
    origin_scope: String(row.origin_scope ?? "session"),
    availability_scope: String(row.availability_scope ?? "session_only"),
    importance: typeof row.importance === "number" ? row.importance : undefined,
    memory_type: typeof row.memory_type === "string" ? row.memory_type : undefined,
    self_test:
      (row.self_test as Record<string, unknown> | null) ?? null,
  };
}

/**
 * synthesized_knowledge 行 → FilterableItem 适配器。
 * kp_synthesized_knowledge 表的字段映射到 FilterableItem：
 *   - status → promotion_status（active/needs_review 等）
 *   - lifecycle_state → lifecycle_state（curated/candidate）
 *   - review_state → review_state（model_accepted/needs_human_review）
 *   - recall_state → recall_state（active/audit_only）
 *   - knowledge_type → knowledge_type
 *   - confidence_score → confidence_score
 */
function adaptKnowledgeRow(row: Record<string, unknown>): FilterableItem {
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? ""),
    content: typeof row.content === "string" ? row.content : undefined,
    promotion_status: String(row.status ?? "active"),
    origin_scope: String(row.origin_scope ?? "project"),
    availability_scope: String(row.availability_scope ?? "project_reusable"),
    knowledge_type: typeof row.knowledge_type === "string" ? row.knowledge_type : undefined,
    confidence_score: typeof row.confidence_score === "number" ? row.confidence_score : undefined,
    lifecycle_state: typeof row.lifecycle_state === "string" ? row.lifecycle_state : undefined,
    review_state: typeof row.review_state === "string" ? row.review_state : undefined,
    recall_state: typeof row.recall_state === "string" ? row.recall_state : undefined,
  };
}
