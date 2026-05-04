import { getPool } from "../pool.js";
export async function createVerificationResult(input) {
    const pool = getPool();
    const result = await pool.query(`
    INSERT INTO verification_result (
      tenant_id, scope, status, version, task_request_id, task_plan_id, task_step_id,
      verification_phase, verdict, verifier_id, evidence_payload, failure_event_id, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, $3, $4, $5,
      $6::verification_phase, $7::verification_verdict, $8, $9::jsonb, $10, $11
    )
    RETURNING id
    `, [
        input.tenantId,
        input.scope,
        input.taskRequestId,
        input.taskPlanId,
        input.taskStepId ?? null,
        input.verificationPhase,
        input.verdict,
        input.verifierId,
        JSON.stringify(input.evidencePayload),
        input.failureEventId ?? null,
        input.traceId
    ]);
    return result.rows[0].id;
}
//# sourceMappingURL=verification.js.map