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
  taskRequestId?: string | null;
  fingerprint?: string | null;
  limit?: number;
}) {
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
    case "factual":
    default:
      return queryFactualMemory({
        tenantId: input.tenantId,
        scope: input.scope,
        limit: input.limit
      });
  }
}
