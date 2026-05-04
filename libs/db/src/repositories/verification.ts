import { getPool } from "../pool.js";

export async function createVerificationResult(input: {
  tenantId: string;
  scope: string;
  taskRequestId: string;
  taskPlanId: string;
  taskStepId?: string | null;
  verificationPhase: string;
  verdict: string;
  verifierId: string;
  evidencePayload: Record<string, unknown>;
  failureEventId?: string | null;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO verification_result (
      tenant_id, scope, status, version, task_request_id, task_plan_id, task_step_id,
      verification_phase, verdict, verifier_id, evidence_payload, failure_event_id, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, $3, $4, $5,
      $6::verification_phase, $7::verification_verdict, $8, $9::jsonb, $10, $11
    )
    RETURNING id
    `,
    [
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
    ]
  );

  return result.rows[0].id;
}

