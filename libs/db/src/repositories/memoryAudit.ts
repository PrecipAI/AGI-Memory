import { getPool } from "../pool.js";

function toJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

export async function createMemoryAccessLog(input: {
  tenantId: string;
  scope: string;
  memoryId?: string | null;
  queryKind: string;
  queryPayload?: Record<string, unknown>;
  decisionPayload?: Record<string, unknown>;
  objectType?: string;
  objectRef?: string | null;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO memory_access_log (
      tenant_id, scope, status, version, memory_id, query_kind, query_payload,
      decision_payload, object_type, object_ref, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, $3, $4, $5::jsonb,
      $6::jsonb, $7, $8, $9
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.memoryId ?? null,
      input.queryKind,
      toJson(input.queryPayload),
      toJson(input.decisionPayload),
      input.objectType ?? "memory",
      input.objectRef ?? null,
      input.traceId
    ]
  );
  return result.rows[0].id;
}

export async function listMemoryAccessLogs(input: {
  tenantId: string;
  scope: string;
  queryKind?: string | null;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM memory_access_log
    WHERE tenant_id = $1
      AND scope = $2
      AND ($3::text IS NULL OR query_kind = $3)
    ORDER BY created_at DESC
    LIMIT $4
    `,
    [input.tenantId, input.scope, input.queryKind ?? null, input.limit ?? 50]
  );
  return result.rows;
}

export async function countMemoryAccessLogs(input: {
  tenantId: string;
  scope: string;
  queryKind?: string | null;
}): Promise<number> {
  const pool = getPool();
  const result = await pool.query<{ count: string }>(
    `
    SELECT COUNT(*)::text AS count
    FROM memory_access_log
    WHERE tenant_id = $1
      AND scope = $2
      AND ($3::text IS NULL OR query_kind = $3)
    `,
    [input.tenantId, input.scope, input.queryKind ?? null]
  );
  return Number(result.rows[0]?.count ?? 0);
}
