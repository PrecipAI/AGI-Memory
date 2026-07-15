/**
 * 41. 静态记忆编译器 - 定时兜底重编译
 *
 * 职责：每天 03:00 全量重编译静态记忆文件，防止：
 *   - 用户手动删除 marker 区域
 *   - 用户手动改坏文件内容
 *   - 即时编译因临时故障失败
 *   - DB 中 Rule 被 L3 演进标记 SUPERSEDED 后未从静态文件移除
 *
 * 设计决策：
 *   - 不引入 cron 库（避免新增依赖），用原生 setTimeout 循环
 *   - 单租户模式：用 getDefaultTenantId() + getDefaultScope()
 *   - 多租户模式：不启动 scheduler（spec §10 明确排除多租户静态文件）
 *   - 通过环境变量控制：默认开启，可禁用；间隔可覆盖（测试用）
 *   - 失败不退出循环，只记录日志，下次定时再试
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { compileStaticMemory, type CompileResult } from "./compiler.js";
import {
  getDefaultScope,
  getDefaultTenantId,
  isSingleTenantMode,
} from "../memoryPolicyEngine.js";

/** 默认每天 03:00 触发 */
const DEFAULT_CRON_HOUR = 3;
const DEFAULT_CRON_MINUTE = 0;

export interface SchedulerStatus {
  running: boolean;
  lastRunAt: string | null;
  lastResult: Pick<
    CompileResult,
    "ruleCount" | "skillCount" | "memoryCount" | "knowledgeCount" | "trigger"
  > | null;
  lastError: string | null;
  nextRunAt: string | null;
  /** 已完成的重编译次数 */
  runCount: number;
}

interface SchedulerState {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  lastRunAt: Date | null;
  lastResult: SchedulerStatus["lastResult"];
  lastError: string | null;
  nextRunAt: Date | null;
  runCount: number;
  /** 测试用：自定义间隔（毫秒），不传则按 03:00 定时 */
  intervalMs: number | null;
  /** 停止标志 */
  stopped: boolean;
}

const state: SchedulerState = {
  timer: null,
  running: false,
  lastRunAt: null,
  lastResult: null,
  lastError: null,
  nextRunAt: null,
  runCount: 0,
  intervalMs: null,
  stopped: true,
};

/**
 * 计算到下次 03:00 的毫秒数。
 * 如果当前时间已过 03:00，则计算到明天的 03:00。
 */
function msUntilNextRun(hour: number, minute: number, now: Date = new Date()): number {
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

/**
 * 定位仓库根目录（复用 hostActionExecutor.findRepoRoot 逻辑）。
 */
function findRepoRoot(): string {
  const envRoot = process.env.REPO_ROOT;
  if (envRoot) return path.resolve(envRoot);

  let current = path.resolve(import.meta.dirname ?? process.cwd());
  while (current !== path.dirname(current)) {
    if (
      existsSync(path.join(current, "package.json")) &&
      existsSync(path.join(current, ".git"))
    ) {
      return current;
    }
    current = path.dirname(current);
  }
  return process.cwd();
}

/**
 * 执行一次全量重编译。
 */
async function runOnce(): Promise<void> {
  if (state.running) {
    console.warn("[static-memory-scheduler] 上次运行尚未结束，跳过本次触发");
    return;
  }

  state.running = true;
  state.lastRunAt = new Date();
  state.lastError = null;

  const tenantId = getDefaultTenantId();
  const scope = getDefaultScope();
  const repoRoot = findRepoRoot();
  const traceId = `scheduler-${Date.now()}`;

  console.log(
    `[static-memory-scheduler] scheduled recompile started tenantId=${tenantId} scope=${scope} traceId=${traceId}`,
  );

  try {
    const result = await compileStaticMemory({
      tenantId,
      scope,
      repoRoot,
      trigger: "scheduled",
    });

    state.lastResult = {
      ruleCount: result.ruleCount,
      skillCount: result.skillCount,
      memoryCount: result.memoryCount,
      knowledgeCount: result.knowledgeCount,
      trigger: result.trigger,
    };
    state.runCount += 1;

    const changedFiles = result.files
      .filter((f) => f.status !== "unchanged")
      .map((f) => `${f.host}:${f.status}`);

    console.log(
      `[static-memory-scheduler] scheduled recompile done: ${result.ruleCount} rules + ${result.skillCount} skills + ${result.memoryCount} memories + ${result.knowledgeCount} knowledge, changed=${changedFiles.length ? changedFiles.join(",") : "none"}, skipped=${result.skipped.length} traceId=${traceId}`,
    );
  } catch (e) {
    state.lastError = e instanceof Error ? e.message : String(e);
    state.lastResult = null;
    console.warn(
      `[static-memory-scheduler] scheduled recompile failed: ${state.lastError} traceId=${traceId}`,
    );
    // 失败不退出循环，下次定时再试
  } finally {
    state.running = false;
  }
}

/**
 * 调度下一次运行。
 */
function scheduleNext(): void {
  if (state.stopped) return;

  const delay = state.intervalMs ?? msUntilNextRun(DEFAULT_CRON_HOUR, DEFAULT_CRON_MINUTE);
  state.nextRunAt = new Date(Date.now() + delay);

  state.timer = setTimeout(async () => {
    if (state.stopped) return;
    await runOnce();
    scheduleNext();
  }, delay);
}

export interface StartSchedulerOptions {
  /** 测试用：覆盖间隔（毫秒）。不传则按 03:00 定时。 */
  intervalMs?: number;
  /** 测试用：启动后立即跑一次 */
  runImmediately?: boolean;
}

/**
 * 启动定时兜底重编译。
 *
 * 启动条件（必须全部满足）：
 *   - 单租户模式（多租户模式 spec 明确排除）
 *   - 环境变量 STATIC_MEMORY_SCHEDULER_ENABLED 不为 "false"
 *
 * 启动后：
 *   - 计算到下次 03:00 的毫秒数，setTimeout 等待
 *   - 触发时调 compileStaticMemory({ trigger: "scheduled" })
 *   - 失败只记录日志，不退出循环
 *   - 下次定时再试
 */
export function startStaticMemoryScheduler(
  options: StartSchedulerOptions = {},
): SchedulerStatus {
  if (!isSingleTenantMode()) {
    console.log(
      "[static-memory-scheduler] 多租户模式，跳过启动（spec §10 明确排除多租户静态文件）",
    );
    return getStaticMemorySchedulerStatus();
  }

  const envEnabled = process.env.STATIC_MEMORY_SCHEDULER_ENABLED;
  if (envEnabled !== undefined && envEnabled.toLowerCase() === "false") {
    console.log(
      "[static-memory-scheduler] 环境变量 STATIC_MEMORY_SCHEDULER_ENABLED=false，跳过启动",
    );
    return getStaticMemorySchedulerStatus();
  }

  if (!state.stopped && state.timer) {
    console.log("[static-memory-scheduler] 已在运行，不重复启动");
    return getStaticMemorySchedulerStatus();
  }

  state.stopped = false;
  state.intervalMs = options.intervalMs ?? null;

  if (options.runImmediately) {
    // 异步触发，不阻塞调用方
    runOnce().finally(() => scheduleNext());
  } else {
    scheduleNext();
  }

  console.log(
    `[static-memory-scheduler] 已启动，下次运行时间: ${state.nextRunAt?.toISOString() ?? "计算中"}`,
  );
  return getStaticMemorySchedulerStatus();
}

/**
 * 停止定时兜底重编译。
 */
export function stopStaticMemoryScheduler(): void {
  state.stopped = true;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.nextRunAt = null;
  console.log("[static-memory-scheduler] 已停止");
}

/**
 * 手动触发一次重编译（不等定时）。
 * 用于 API 触发或测试。
 *
 * 与定时触发的区别：
 *   - 不等 nextRunAt，立即执行
 *   - 共用 scheduler 状态机（更新 lastRunAt/lastResult/lastError/runCount）
 *   - 如果定时任务正在跑（state.running=true），会跳过避免并发写冲突
 *
 * 返回 CompileResult；如果因并发被跳过则抛错。
 */
export async function triggerStaticMemoryRecompileNow(): Promise<CompileResult> {
  if (state.running) {
    throw new Error(
      "[static-memory-scheduler] 定时任务正在运行，手动触发被跳过，请稍后重试",
    );
  }

  state.running = true;
  state.lastRunAt = new Date();
  state.lastError = null;

  const tenantId = getDefaultTenantId();
  const scope = getDefaultScope();
  const repoRoot = findRepoRoot();
  const traceId = `manual-${Date.now()}`;

  console.log(
    `[static-memory-scheduler] manual recompile started tenantId=${tenantId} scope=${scope} traceId=${traceId}`,
  );

  try {
    const result = await compileStaticMemory({
      tenantId,
      scope,
      repoRoot,
      trigger: "scheduled",
    });

    state.lastResult = {
      ruleCount: result.ruleCount,
      skillCount: result.skillCount,
      memoryCount: result.memoryCount,
      knowledgeCount: result.knowledgeCount,
      trigger: result.trigger,
    };
    state.runCount += 1;

    const changedFiles = result.files
      .filter((f) => f.status !== "unchanged")
      .map((f) => `${f.host}:${f.status}`);

    console.log(
      `[static-memory-scheduler] manual recompile done: ${result.ruleCount} rules + ${result.skillCount} skills + ${result.memoryCount} memories + ${result.knowledgeCount} knowledge, changed=${changedFiles.length ? changedFiles.join(",") : "none"}, skipped=${result.skipped.length} traceId=${traceId}`,
    );

    return result;
  } catch (e) {
    state.lastError = e instanceof Error ? e.message : String(e);
    state.lastResult = null;
    console.warn(
      `[static-memory-scheduler] manual recompile failed: ${state.lastError} traceId=${traceId}`,
    );
    throw e;
  } finally {
    state.running = false;
  }
}

/**
 * 查询当前 scheduler 状态。
 */
export function getStaticMemorySchedulerStatus(): SchedulerStatus {
  return {
    running: state.running,
    lastRunAt: state.lastRunAt?.toISOString() ?? null,
    lastResult: state.lastResult,
    lastError: state.lastError,
    nextRunAt: state.nextRunAt?.toISOString() ?? null,
    runCount: state.runCount,
  };
}

/**
 * 计算到下次 03:00 的毫秒数（导出给测试用）。
 */
export function _msUntilNextRun(hour: number, minute: number, now: Date = new Date()): number {
  return msUntilNextRun(hour, minute, now);
}
