import {
  queryActiveRules,
  queryConversationSummary,
  queryFactualMemory,
  queryMemoryCandidates,
  queryProceduralMemory,
  queryResidentSnapshot
} from "@super-agent/db";

export async function queryMemoryByKind(input: {
  tenantId: string;
  scope: string;
  kind: string;
  /** 业务层记忆类型（user_memory/project_memory 等），仅 kind="all"|"factual" 时生效 */
  memoryType?: string | null;
  taskRequestId?: string | null;
  fingerprint?: string | null;
  limit?: number;
}) {
  const memoryType = typeof input.memoryType === "string" && input.memoryType ? input.memoryType : null;
  switch (input.kind) {
    case "resident":
      return queryResidentSnapshot({
        tenantId: input.tenantId,
        scope: input.scope,
        limit: input.limit
      });
    case "procedural":
      return queryProceduralMemory({
        tenantId: input.tenantId,
        scope: input.scope,
        fingerprint: input.fingerprint,
        limit: input.limit
      });
    case "rule":
    case "rules":
      return queryActiveRules({
        tenantId: input.tenantId,
        scope: input.scope,
        limit: input.limit
      });
    case "summary":
      return queryConversationSummary({
        tenantId: input.tenantId,
        scope: input.scope,
        taskRequestId: input.taskRequestId ?? null,
        limit: input.limit
      });
    case "candidate":
      return queryMemoryCandidates({
        tenantId: input.tenantId,
        scope: input.scope,
        taskRequestId: input.taskRequestId ?? null,
        limit: input.limit
      });
    case "all":
    case "factual":
    default:
      // kind="all" 返回全部业务类型；kind="factual" 也走这里，但若指定 memoryType 则按业务类型过滤
      // 历史遗留：原 factual 分支 SQL 写死 memory_type='factual'，但 DB 里 memory_type 字段存的是业务类型
      // （user_memory/project_memory 等），factual 从未真正命中过。
      // 现在统一走 queryFactualMemory + memoryType 过滤，与前端筛选 tab 对齐。
      return queryFactualMemory({
        tenantId: input.tenantId,
        scope: input.scope,
        memoryType,
        limit: input.limit
      });
  }
}
