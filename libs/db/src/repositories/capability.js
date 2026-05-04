import { getPool } from "../pool.js";
export async function queryCapabilities(input) {
    const pool = getPool();
    const result = await pool.query(`
    SELECT *
    FROM capability_registry
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
      AND ($4::text IS NULL OR task_types @> ARRAY[$4::text])
      AND (
        CASE
          WHEN $3::text IN ('high', 'critical') THEN fingerprint_requirement IS NOT NULL
          ELSE true
        END
      )
    ORDER BY risk_level, capability_key
    `, [input.tenantId, input.scope, input.riskLevel, input.taskType ?? null]);
    return result.rows;
}
//# sourceMappingURL=capability.js.map