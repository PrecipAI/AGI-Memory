/**
 * 检索 Hook：在检索结果返回给调用方之前，按作用域（Scope）进行动态过滤。
 *
 * 核心规则：
 * - 全局级（global_reusable / team_reusable）：始终允许召回
 * - 用户级（user_reusable）：始终允许召回（同一 tenant 内）
 * - 工作空间级（workspace_reusable）：始终允许召回（同一 tenant 内）
 * - 项目级（project_reusable）：只有当 origin_scope=project 且 scope 与当前 project_id 匹配时才召回
 * - 会话级（session_only）：只有当 scope 与当前 session scope 完全匹配时才召回
 *
 * 优先级排序：项目级 > 工作空间级 > 用户级 > 团队级 > 全局级
 */

export type GovernanceScope = "global" | "team" | "user" | "workspace" | "project" | "session";
export type GovernanceAvailabilityScope =
  | "global_reusable"
  | "team_reusable"
  | "user_reusable"
  | "workspace_reusable"
  | "project_reusable"
  | "session_only";

export interface RetrievalHookContext {
  /** 当前会话的 scope（即 project_id 或 session 标识） */
  scope: string;
  /** 当前租户 */
  tenantId: string;
  /** 可选：显式传入的 project_id，优先于 scope */
  projectId?: string | null;
  /** 可选：workspace_id */
  workspaceId?: string | null;
  /** 可选：session_id */
  sessionId?: string | null;
  /** 可选：user_id */
  userId?: string | null;
}

interface ScopeAwareArtifact {
  origin_scope?: string;
  availability_scope?: string;
  scope?: string;
  [key: string]: unknown;
}

/**
 * 判断单条产物是否应该被当前上下文召回
 */
function shouldRecall(
  artifact: ScopeAwareArtifact,
  context: RetrievalHookContext
): boolean {
  const availability = (artifact.availability_scope ?? artifact.origin_scope ?? "") as string;
  const originScope = (artifact.origin_scope ?? "") as string;
  const artifactScope = (artifact.scope ?? "") as string;
  const projectId = context.projectId ?? context.scope;

  // 全局级：始终允许
  if (
    availability === "global_reusable" ||
    originScope === "global" ||
    availability === "team_reusable" ||
    originScope === "team"
  ) {
    return true;
  }

  // 用户级：同一 tenant 内始终允许
  if (
    availability === "user_reusable" ||
    originScope === "user"
  ) {
    return true;
  }

  // 工作空间级：同一 tenant 内始终允许（更细粒度可由宿主二次过滤）
  if (
    availability === "workspace_reusable" ||
    originScope === "workspace"
  ) {
    return true;
  }

  // 项目级：必须匹配 project_id
  if (
    availability === "project_reusable" ||
    originScope === "project"
  ) {
    return artifactScope === projectId || artifactScope === context.scope;
  }

  // 会话级：必须完全匹配 scope
  if (
    availability === "session_only" ||
    originScope === "session"
  ) {
    return artifactScope === context.scope;
  }

  // 未知 scope：保守策略，不召回
  return false;
}

/**
 * 按作用域优先级排序：项目级 > 工作空间级 > 用户级 > 团队级 > 全局级
 */
function scopePriority(artifact: ScopeAwareArtifact): number {
  const availability = (artifact.availability_scope ?? "") as string;
  const priorityMap: Record<string, number> = {
    session_only: 0,
    project_reusable: 1,
    workspace_reusable: 2,
    user_reusable: 3,
    team_reusable: 4,
    global_reusable: 5,
  };
  return priorityMap[availability] ?? 99;
}

/**
 * 对检索结果列表执行作用域过滤 + 优先级排序
 */
export function applyScopeFilter<T extends ScopeAwareArtifact>(
  items: T[],
  context: RetrievalHookContext
): T[] {
  const filtered = items.filter((item) => shouldRecall(item, context));
  // 稳定排序：先按 scope 优先级，再保持原顺序
  return filtered.sort((a, b) => scopePriority(a) - scopePriority(b));
}

/**
 * 对完整的检索 response 执行作用域过滤
 * 在 return response 之前调用
 */
export function applyRetrievalHook(
  response: Record<string, unknown>,
  context: RetrievalHookContext
): Record<string, unknown> {
  const hookFields = [
    "rules",
    "factual_memory",
    "procedural_memory",
    "synthesized_knowledge",
    "evidence_index",
  ];

  const patched: Record<string, unknown> = { ...response };
  for (const field of hookFields) {
    const raw = patched[field];
    if (Array.isArray(raw)) {
      patched[field] = applyScopeFilter(
        raw as ScopeAwareArtifact[],
        context
      );
    }
  }
  return patched;
}
