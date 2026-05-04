import { getPool } from "../pool.js";
async function queryMemory(input) {
    const pool = getPool();
    const result = await pool.query(`
    SELECT *
    FROM memory
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
      AND memory_type = $3
      AND (
        $3 <> 'procedural'
        OR fingerprint_requirement IS NULL
        OR fingerprint_requirement = $4
      )
    ORDER BY importance DESC, confidence_score DESC
    LIMIT $5
    `, [input.tenantId, input.scope, input.type, input.fingerprint ?? null, input.limit ?? 10]);
    return result.rows;
}
export async function queryResidentSnapshot(input) {
    const pool = getPool();
    const result = await pool.query(`
    SELECT *
    FROM resident_snapshot
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
    ORDER BY generated_at DESC
    LIMIT $3
    `, [input.tenantId, input.scope, input.limit ?? 5]);
    return result.rows;
}
export async function queryFactualMemory(input) {
    return queryMemory({ tenantId: input.tenantId, scope: input.scope, type: "factual", limit: input.limit });
}
export async function queryProceduralMemory(input) {
    return queryMemory({
        tenantId: input.tenantId,
        scope: input.scope,
        type: "procedural",
        fingerprint: input.fingerprint,
        limit: input.limit
    });
}
//# sourceMappingURL=memory.js.map