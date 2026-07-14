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
} from "@super-agent/db";

import {
  filterCompilableItems,
  type FilterableItem,
} from "./contentFilter.js";
import {
  detectHosts,
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

export interface CompileInput {
  tenantId: string;
  scope: string;
  /** 仓库根目录（用于定位宿主原生文件） */
  repoRoot: string;
  /** 指定目标宿主；不传则自动检测，检测不到则三宿主全写 */
  targetHosts?: HostType[];
  /** 触发方式：immediate（审批通过即时编译）| scheduled（定时兜底全量重编译） */
  trigger: "immediate" | "scheduled";
}

export interface CompileFileResult {
  path: string;
  host: HostType;
  status: "created" | "updated" | "unchanged";
  backupPath?: string;
}

export interface CompileResult {
  ruleCount: number;
  skillCount: number;
  memoryCount: number;
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
    host: HostType;
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
  const [ruleRows, skillRows, memoryRows] = await Promise.all([
    listActiveRules({ tenantId: input.tenantId, scope: input.scope }),
    listActiveSkills({
      tenantId: input.tenantId,
      scope: input.scope,
      fingerprint: null,
    }),
    queryFactualMemory({ tenantId: input.tenantId, scope: input.scope }),
  ]);

  // ── 2. 类型适配 ──
  const ruleItems: FilterableItem[] = ruleRows.map(adaptRuleRow);
  const skillItems: FilterableItem[] = skillRows.map(adaptSkillRow);
  const memoryItems: FilterableItem[] = memoryRows.map(adaptMemoryRow);

  // ── 3. 按层筛选 ──
  const ruleFiltered = filterCompilableItems("rule", ruleItems);
  const skillFiltered = filterCompilableItems("skill", skillItems);
  const memoryFiltered = filterCompilableItems("memory", memoryItems);

  // ── 4. 格式化 ──
  const rulesBlock = formatRules(ruleFiltered.passed);
  const skillsBlock = formatSkills(skillFiltered.passed);
  const memoryBlock = formatMemories(memoryFiltered.passed);

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
  // 宿主之间相互独立，可并行；同一宿主文件内三个 marker 区域串行写（避免并发写冲突）。
  const fileResults = await Promise.all(
    hosts.map((host) => writeHostFile(host, input.repoRoot, {
      rules: rulesBlock,
      skills: skillsBlock,
      memory: memoryBlock,
    })),
  );

  // ── 7. 编译后 marker 完整性验证 ──
  // 对每个写入的文件调 validateMarkerIntegrity，发现 marker 配对问题就记录。
  // 不阻塞返回（warn only），但调用方可以据此判断是否需要修复。
  const validationIssues: CompileResult["validationIssues"] = [];
  for (const fileResult of fileResults) {
    if (!fileResult) continue;
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
    files: fileResults.filter((r): r is CompileFileResult => r !== null),
    skipped: [
      ...ruleFiltered.skipped,
      ...skillFiltered.skipped,
      ...memoryFiltered.skipped,
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
  blocks: { rules: string; skills: string; memory: string },
): Promise<CompileFileResult | null> {
  const config = HOST_CONFIGS[host];
  if (!config) return null;

  const filePath = config.getFilePath(repoRoot);

  // 串行写三个 marker 区域，合并状态
  const writes: Array<{ markerKey: MarkerKey; block: string }> = [];
  if (blocks.rules) writes.push({ markerKey: "rules", block: blocks.rules });
  if (blocks.skills) writes.push({ markerKey: "skills", block: blocks.skills });
  if (blocks.memory) writes.push({ markerKey: "memory", block: blocks.memory });

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
    stability: typeof row.stability === "string" ? row.stability : undefined,
    memory_type: typeof row.memory_type === "string" ? row.memory_type : undefined,
    self_test:
      (row.self_test as Record<string, unknown> | null) ?? null,
  };
}
