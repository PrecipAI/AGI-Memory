import { getPool } from "../pool.js";
export async function createCleanupDlqItem(input) {
    const pool = getPool();
    const result = await pool.query(`
    INSERT INTO cleanup_dlq (
      tenant_id, scope, status, version, task_request_id, task_plan_id, task_step_id,
      dependency_id, error_signature, compensator_id, fingerprint, failure_window_start,
      failure_window_end, retry_count, frozen_scope, last_failure_payload, trace_id
    )
    VALUES (
      $1, $2, 'parked', 1, $3, $4, $5,
      $6, $7, $8, $9, now(), now(), 1, true, '{}'::jsonb, $10
    )
    RETURNING id
    `, [
        input.tenantId,
        input.scope,
        input.taskRequestId,
        input.taskPlanId,
        input.taskStepId ?? null,
        input.dependencyId,
        input.errorSignature,
        input.compensatorId,
        input.fingerprint,
        input.traceId
    ]);
    return result.rows[0].id;
}
export async function listCleanupDlqItems(dependencyId) {
    const pool = getPool();
    const result = await pool.query("SELECT * FROM cleanup_dlq WHERE dependency_id = $1 AND status = 'parked' ORDER BY created_at", [dependencyId]);
    return result.rows;
}
export async function ensureIncidentCluster(input) {
    const pool = getPool();
    const result = await pool.query(`
    INSERT INTO cleanup_incident_cluster (
      tenant_id, scope, status, version, dependency_id, error_signature, compensator_id,
      fingerprint, failure_window_start, failure_window_end, affected_item_count,
      dependency_state_snapshot, thaw_eligible, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, $3, $4, $5,
      $6, now(), now(), 1, $7, false, $8
    )
    ON CONFLICT (tenant_id, scope, dependency_id, error_signature, compensator_id, fingerprint, failure_window_start)
    DO NOTHING
    RETURNING id
    `, [
        input.tenantId,
        input.scope,
        input.dependencyId,
        input.errorSignature,
        input.compensatorId,
        input.fingerprint,
        input.dependencyStateSnapshot,
        input.traceId
    ]);
    return result.rows[0]?.id ?? "";
}
//# sourceMappingURL=cleanup.js.map