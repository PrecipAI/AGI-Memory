import Fastify from "fastify";
import type { VerifyRequest, VerifyResponse } from "@super-agent/contracts";
import { createArtifact, createFailureEvent, createVerificationResult } from "@super-agent/db";
import { getCircuitState, recordCircuitFailure, recordCircuitSuccess } from "./circuitBreaker.js";

function getHeader(headers: Record<string, unknown>, name: string, fallback: string): string {
  const value = headers[name.toLowerCase()] ?? headers[name] ?? fallback;
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function getDefaultTenantId(): string {
  return process.env.DEFAULT_TENANT_ID || "tenant-local";
}

function getDefaultScope(): string {
  return process.env.DEFAULT_SCOPE || "memory.validation";
}

function shouldFailVerification(body: VerifyRequest): boolean {
  return Boolean(
    (body.observed_state as Record<string, unknown>)?.fail === true ||
      (body.observed_state as Record<string, unknown>)?.breaker_open === true
  );
}

function buildMemoryCandidatePreview(body: VerifyRequest, verdict: "passed" | "failed") {
  const observedState = (body.observed_state as Record<string, unknown>) ?? {};
  const explicitTag = typeof observedState.artifact_tag === "string" ? observedState.artifact_tag : null;
  const explicitErrorCode = typeof observedState.error_code === "string" ? observedState.error_code : undefined;
  const fingerprint = typeof observedState.fingerprint === "string" ? observedState.fingerprint : undefined;
  const fingerprintStatus: "matched" | "matched_or_na" | "mismatch" | "unknown" =
    typeof observedState.fingerprint_status === "string"
      ? (String(observedState.fingerprint_status) as "matched" | "matched_or_na" | "mismatch" | "unknown")
      : fingerprint
        ? "matched"
        : "matched_or_na";

  const artifactTag =
    explicitTag ??
    (verdict === "failed"
      ? "summary_only"
      : body.verification_phase === "postcheck"
        ? "workflow_tag=standard_path"
        : "environment_fact");

  return {
    source_type: "verification_result",
    source_ref: `verification://${body.task_request_id}/${body.task_step_id ?? "task"}/${body.verification_phase}`,
    artifact_tag: artifactTag,
    error_code: explicitErrorCode,
    verification_status: verdict === "failed" ? "unverified" : explicitErrorCode ? "verified_fix" : "verified",
    side_effect_class:
      typeof observedState.side_effect_class === "string" ? String(observedState.side_effect_class) : "none",
    fingerprint,
    fingerprint_status: fingerprintStatus,
    candidate_payload: {
      verification_phase: body.verification_phase,
      expected_state: body.expected_state,
      observed_state: body.observed_state,
      verdict
    }
  };
}

export function buildVerificationServiceApp() {
  const app = Fastify({ logger: false });

  app.get("/healthz", async () => ({
    service: "verification-service",
    ok: true,
    default_tenant_id: getDefaultTenantId(),
    default_scope: getDefaultScope()
  }));

  app.post("/internal/verifier/check", async (request) => {
    const body = request.body as VerifyRequest;
    const tenantId = getHeader(request.headers as Record<string, unknown>, "x-tenant-id", getDefaultTenantId());
    const scope = getHeader(request.headers as Record<string, unknown>, "x-scope", getDefaultScope());
    const traceId = getHeader(request.headers as Record<string, unknown>, "x-trace-id", `trace-${body.task_request_id}`);
    const breakerKey = `${tenantId}:${scope}:${body.task_request_id}`;

    if (shouldFailVerification(body)) {
      const breaker = recordCircuitFailure(breakerKey);
      const failureEventId = await createFailureEvent({
        tenantId,
        scope,
        taskRequestId: body.task_request_id,
        taskPlanId: body.task_plan_id,
        taskStepId: body.task_step_id ?? null,
        failureCode: "VERIFICATION_FAILED",
        failureClass: "validation",
        errorSignature: `verification.${body.verification_phase}.failed`,
        dependencyId: null,
        retryable: false,
        severity: 2,
        verifierPhase: body.verification_phase,
        detailPayload: {
          expected_state: body.expected_state,
          observed_state: body.observed_state,
          circuit_state: breaker.state
        },
        traceId
      });
      const verificationResultId = await createVerificationResult({
        tenantId,
        scope,
        taskRequestId: body.task_request_id,
        taskPlanId: body.task_plan_id,
        taskStepId: body.task_step_id ?? null,
        verificationPhase: body.verification_phase,
        verdict: "failed",
        verifierId: "verification-service",
        evidencePayload: {
          circuit_state: breaker.state,
          failure_count: breaker.failureCount
        },
        failureEventId,
        traceId
      });
      const preview = buildMemoryCandidatePreview(body, "failed");
      await createArtifact({
        tenantId,
        scope,
        taskRequestId: body.task_request_id,
        taskStepId: body.task_step_id ?? null,
        artifactType: "verification_failure",
        artifactTag: preview.artifact_tag,
        content: `Verification ${body.verification_phase} failed.`,
        structuredPayload: preview.candidate_payload,
        verificationStatus: preview.verification_status,
        sideEffectClass: preview.side_effect_class,
        sourceRef: preview.source_ref,
        traceId
      });

      const response: VerifyResponse = {
        verification_result_id: verificationResultId,
        verdict: "failed",
        failure_event_id: failureEventId,
        evidence_payload: {
          circuit_state: breaker.state,
          failure_count: breaker.failureCount
        },
        breaker_state: breaker.state,
        memory_candidate_preview: preview
      };

      return response;
    }

    const breaker = recordCircuitSuccess(breakerKey);
    const verificationResultId = await createVerificationResult({
      tenantId,
      scope,
      taskRequestId: body.task_request_id,
      taskPlanId: body.task_plan_id,
      taskStepId: body.task_step_id ?? null,
      verificationPhase: body.verification_phase,
      verdict: "passed",
      verifierId: "verification-service",
      evidencePayload: {
        expected_state: body.expected_state,
        observed_state: body.observed_state,
        circuit_state: breaker.state
      },
      traceId
    });
    const preview = buildMemoryCandidatePreview(body, "passed");
    await createArtifact({
      tenantId,
      scope,
      taskRequestId: body.task_request_id,
      taskStepId: body.task_step_id ?? null,
      artifactType: "verification_result",
      artifactTag: preview.artifact_tag,
      content: `Verification ${body.verification_phase} passed.`,
      structuredPayload: preview.candidate_payload,
      verificationStatus: preview.verification_status,
      sideEffectClass: preview.side_effect_class,
      sourceRef: preview.source_ref,
      traceId
    });

    const response: VerifyResponse = {
      verification_result_id: verificationResultId,
      verdict: "passed",
      evidence_payload: {
        circuit_state: breaker.state,
        phase: body.verification_phase
      },
      precheck_token: body.verification_phase === "precheck" ? `precheck-passed:${verificationResultId}` : undefined,
      breaker_state: getCircuitState(breakerKey).state,
      memory_candidate_preview: preview
    };

    return response;
  });

  return app;
}
