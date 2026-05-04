import { createHash } from "node:crypto";
import Fastify from "fastify";
import type { DispatchRequest, DispatchResponse, PlanRequest, PlanResponse, ResolveRequest, ResolveResponse } from "@super-agent/contracts";
import {
  appendJournal,
  beginTaskAttempt,
  completeTaskAttempt,
  createArtifact,
  createCompensationCapsule,
  createFailureEvent,
  createMessage,
  createTaskPlan,
  createTaskResult,
  createTaskStep,
  ensureTaskRequest,
  ensureTaskRun,
  getTaskStepById,
  queryCapabilities,
  updateTaskResultState,
  updateTaskStepStatus
} from "@super-agent/db";
import { buildFakePlan } from "./planner/fakePlanner.js";
import { createMockExternalResource } from "./mock/mockExternalResource.js";

function getHeader(headers: Record<string, unknown>, name: string, fallback: string): string {
  const value = headers[name.toLowerCase()] ?? headers[name] ?? fallback;
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function createHttpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

function getDefaultTenantId(): string {
  return process.env.DEFAULT_TENANT_ID || "tenant-local";
}

function getDefaultScope(): string {
  return process.env.DEFAULT_SCOPE || "memory.validation";
}

export function buildTaskOrchestratorApp() {
  const app = Fastify({ logger: false });

  app.get("/healthz", async () => ({
    service: "task-orchestrator",
    ok: true,
    default_tenant_id: getDefaultTenantId(),
    default_scope: getDefaultScope()
  }));

  app.post("/internal/planner/plan", async (request) => {
    const body = request.body as PlanRequest;
    const tenantId = getHeader(request.headers as Record<string, unknown>, "x-tenant-id", getDefaultTenantId());
    const scope = getHeader(request.headers as Record<string, unknown>, "x-scope", getDefaultScope());
    const traceId = getHeader(request.headers as Record<string, unknown>, "x-trace-id", `trace-${body.task_request_id}`);

    await ensureTaskRequest({
      id: body.task_request_id,
      task_type: body.task_type,
      goal: body.goal,
      normalized_envelope: body.normalized_envelope,
      trace_id: traceId,
      tenant_id: tenantId,
      scope
    });
    await ensureTaskRun({
      tenantId,
      scope,
      taskRequestId: body.task_request_id,
      goal: body.goal,
      runStatus: "running",
      recoveryState: {
        phase: "planner"
      },
      traceId
    });
    await createMessage({
      tenantId,
      scope,
      taskRequestId: body.task_request_id,
      role: "user",
      content: body.goal,
      normalizedContent: body.goal.toLowerCase(),
      messageType: "planner_goal",
      metadata: {
        task_type: body.task_type,
        normalized_envelope: body.normalized_envelope
      },
      traceId
    });

    const plan = buildFakePlan(body);
    const { planId, version } = await createTaskPlan({
      taskRequestId: body.task_request_id,
      tenantId,
      scope,
      goal: body.goal,
      riskLevel: plan.risk_level,
      acceptanceCriteria: plan.acceptance_criteria,
      planPayload: {
        resident_context: body.resident_context,
        retrieval_budget: body.retrieval_budget,
        generated_by: "fake-planner"
      },
      traceId
    });

    for (const step of plan.steps) {
      await createTaskStep({
        taskPlanId: planId,
        tenantId,
        scope,
        stepKey: step.step_key,
        stepOrder: step.step_order,
        title: step.title,
        stepType: step.step_type,
        dependencyKeys: step.dependency_keys,
        inputPayload: step.input_payload,
        expectedOutput: step.expected_output,
        acceptanceCriteria: step.acceptance_criteria,
        riskLevel: step.risk_level,
        sideEffectClass: step.side_effect_class,
        capabilityHint: step.capability_hint,
        compensationHint: step.compensation_hint,
        traceId
      });
    }

    await createTaskResult({
      tenantId,
      scope,
      taskRequestId: body.task_request_id,
      taskPlanId: planId,
      userSummary: `P1 provisional plan created for goal: ${body.goal}`,
      systemResult: {
        phase: "planned",
        stream_state: "provisional"
      },
      traceId
    });
    await createArtifact({
      tenantId,
      scope,
      taskRequestId: body.task_request_id,
      artifactType: "planner_plan",
      artifactTag: "plan_generated",
      content: `Generated ${plan.steps.length} steps for ${body.task_type}`,
      structuredPayload: {
        task_plan_id: planId,
        step_count: plan.steps.length,
        risk_level: plan.risk_level
      },
      verificationStatus: "verified",
      sideEffectClass: "none",
      sourceRef: `task-plan://${planId}`,
      traceId
    });

    const response: PlanResponse = {
      task_plan_id: planId,
      plan_version: version,
      risk_level: plan.risk_level,
      acceptance_criteria: plan.acceptance_criteria,
      steps: plan.steps
    };

    return response;
  });

  app.post("/internal/resolver/resolve", async (request) => {
    const body = request.body as ResolveRequest;
    const tenantId = getHeader(request.headers as Record<string, unknown>, "x-tenant-id", getDefaultTenantId());
    const scope = getHeader(request.headers as Record<string, unknown>, "x-scope", getDefaultScope());

    const taskType =
      typeof body.fingerprint_context?.task_type === "string" ? String(body.fingerprint_context.task_type) : body.step_type;
    const capabilities = await queryCapabilities({
      tenantId,
      scope,
      taskType,
      riskLevel: body.risk_level
    });

    if (capabilities.length === 0) {
      throw createHttpError(400, "No registered capability satisfies the step contract.");
    }

    const resolvedCapability = capabilities[0];
    await updateTaskStepStatus({
      taskStepId: body.task_step_id,
      status: "ready",
      assignedCapabilityId: String(resolvedCapability.id)
    });

    const response: ResolveResponse = {
      resolved_capability_id: String(resolvedCapability.id),
      candidate_capabilities: capabilities,
      approval_required: Boolean(resolvedCapability.approval_mode && resolvedCapability.approval_mode !== "none"),
      resolution_reason: `Resolved by registry on scope=${scope}, risk=${body.risk_level}`
    };

    return response;
  });

  app.post("/internal/router/dispatch", async (request) => {
    const body = request.body as DispatchRequest;
    const tenantId = getHeader(request.headers as Record<string, unknown>, "x-tenant-id", getDefaultTenantId());
    const scope = getHeader(request.headers as Record<string, unknown>, "x-scope", getDefaultScope());
    const traceId = getHeader(request.headers as Record<string, unknown>, "x-trace-id", `trace-${body.task_step_id}`);
    const idempotencyKey = getHeader(
      request.headers as Record<string, unknown>,
      "idempotency-key",
      `${body.task_step_id}:dispatch`
    );

    if (!body.precheck_token.startsWith("precheck-passed")) {
      throw createHttpError(409, "Precheck token is required before dispatch.");
    }

    const taskStep = await getTaskStepById(body.task_step_id);
    if (!taskStep) {
      throw createHttpError(404, "Task step not found.");
    }

    const taskAttempt = await beginTaskAttempt({
      tenantId,
      scope,
      taskRequestId: body.task_request_id,
      taskPlanId: body.task_plan_id,
      taskStepId: body.task_step_id,
      dispatchPayload: body.dispatch_payload,
      traceId
    });

    try {
      await updateTaskStepStatus({
        taskStepId: body.task_step_id,
        status: "running",
        assignedCapabilityId: body.resolved_capability_id
      });

      const payloadHash = createHash("sha256").update(JSON.stringify(body.dispatch_payload)).digest("hex");
      await appendJournal({
        tenantId,
        scope,
        taskRequestId: body.task_request_id,
        taskPlanId: body.task_plan_id,
        taskStepId: body.task_step_id,
        checkpoint: "intent_written",
        effectPhase: "before_dispatch",
        dependencyId: "mock-ticket-api",
        resourceLocator: {
          stage: "intent",
          capability_id: body.resolved_capability_id
        },
        payloadHash,
        journalPayload: body.dispatch_payload,
        idempotencyKey,
        traceId
      });
      await createArtifact({
        tenantId,
        scope,
        taskRequestId: body.task_request_id,
        taskStepId: body.task_step_id,
        artifactType: "dispatch_intent",
        artifactTag: "intent_written",
        content: "Dispatch intent persisted before effectful execution.",
        structuredPayload: {
          resolved_capability_id: body.resolved_capability_id,
          dispatch_payload: body.dispatch_payload
        },
        verificationStatus: "pending",
        sideEffectClass: "external_resource",
        sourceRef: `dispatch://${body.task_step_id}/intent`,
        traceId
      });

      const mockResource = createMockExternalResource(body.dispatch_payload);
      const capsuleId = await createCompensationCapsule({
        tenantId,
        scope,
        taskRequestId: body.task_request_id,
        taskPlanId: body.task_plan_id,
        taskStepId: body.task_step_id,
        sideEffectClass: "external_resource",
        idempotencyKey: `${idempotencyKey}:capsule`,
        targetDependency: "mock-ticket-api",
        compensatorId: "mock.ticket.delete",
        compensatorVersion: "v1",
        resourceLocator: {
          resource_id: mockResource.resourceId,
          endpoint: "mock://ticket/delete"
        },
        requestPayloadHash: payloadHash,
        preconditionSnapshot: {
          status: "active"
        },
        fingerprintAtExecution: process.env.DEFAULT_MEMORY_FINGERPRINT || "local-dev-v1",
        committedResourceId: mockResource.resourceId,
        responseHandle: `mock://${mockResource.resourceId}`,
        revision: "rev-1",
        capsulePayload: {
          created_at: mockResource.createdAt,
          payload: mockResource.payload
        },
        traceId
      });

      const injectFailureStage =
        typeof body.dispatch_payload?.inject_failure_stage === "string"
          ? String(body.dispatch_payload.inject_failure_stage)
          : null;

      if (injectFailureStage === "after_commit") {
        await appendJournal({
          tenantId,
          scope,
          taskRequestId: body.task_request_id,
          taskPlanId: body.task_plan_id,
          taskStepId: body.task_step_id,
          checkpoint: "effect_failed",
          effectPhase: "after_commit",
          dependencyId: "mock-ticket-api",
          resourceLocator: {
            resource_id: mockResource.resourceId
          },
          journalPayload: {
            reason: "failure injection",
            capsule_id: capsuleId
          },
          idempotencyKey: `${idempotencyKey}:failed`,
          traceId
        });

        const failureEventId = await createFailureEvent({
          tenantId,
          scope,
          taskRequestId: body.task_request_id,
          taskPlanId: body.task_plan_id,
          taskStepId: body.task_step_id,
          failureCode: "INJECTED_BREAKER",
          failureClass: "synthetic",
          errorSignature: "dispatch.injected.after_commit",
          dependencyId: "mock-ticket-api",
          retryable: false,
          severity: 2,
          verifierPhase: "postcheck",
          detailPayload: {
            capsule_id: capsuleId,
            resource_id: mockResource.resourceId
          },
          traceId
        });
        await createArtifact({
          tenantId,
          scope,
          taskRequestId: body.task_request_id,
          taskStepId: body.task_step_id,
          artifactType: "dispatch_failure",
          artifactTag: "verified_fix",
          content: "Injected failure after commit for cleanup validation.",
          structuredPayload: {
            capsule_id: capsuleId,
            resource_id: mockResource.resourceId,
            inject_failure_stage: injectFailureStage,
            failure_event_id: failureEventId
          },
          verificationStatus: "unverified",
          sideEffectClass: "external_resource",
          sourceRef: `dispatch://${body.task_step_id}/failure`,
          traceId
        });

        await updateTaskStepStatus({
          taskStepId: body.task_step_id,
          status: "failed",
          assignedCapabilityId: body.resolved_capability_id
        });
        await updateTaskResultState({
          taskPlanId: body.task_plan_id,
          outputState: "blocked",
          status: "blocked",
          finalStepId: body.task_step_id,
          systemResult: {
            phase: "dispatch_failed",
            failure_event_id: failureEventId,
            capsule_id: capsuleId
          }
        });
        await completeTaskAttempt({
          attemptId: taskAttempt.attemptId,
          outcomeCode: "effect_failed",
          outcomePayload: {
            failure_event_id: failureEventId,
            capsule_id: capsuleId,
            resource_id: mockResource.resourceId
          },
          traceId
        });

        const failedResponse: DispatchResponse = {
          dispatch_status: "failed",
          attempt_no: taskAttempt.attemptNo,
          execution_reference: {
            resource_id: mockResource.resourceId,
            capsule_id: capsuleId,
            failure_event_id: failureEventId
          },
          journal_checkpoint: "effect_failed",
          stream_state: "blocked"
        };

        return failedResponse;
      }

      await appendJournal({
        tenantId,
        scope,
        taskRequestId: body.task_request_id,
        taskPlanId: body.task_plan_id,
        taskStepId: body.task_step_id,
        checkpoint: "effect_committed",
        effectPhase: "after_commit",
        dependencyId: "mock-ticket-api",
        resourceLocator: {
          resource_id: mockResource.resourceId
        },
        journalPayload: {
          capsule_id: capsuleId
        },
        idempotencyKey: `${idempotencyKey}:committed`,
        traceId
      });
      await createArtifact({
        tenantId,
        scope,
        taskRequestId: body.task_request_id,
        taskStepId: body.task_step_id,
        artifactType: "dispatch_result",
        artifactTag: "environment_fact",
        content: `Mock external resource committed: ${mockResource.resourceId}`,
        structuredPayload: {
          capsule_id: capsuleId,
          resource_id: mockResource.resourceId,
          capability_id: body.resolved_capability_id
        },
        verificationStatus: "verified",
        sideEffectClass: "external_resource",
        sourceRef: `dispatch://${body.task_step_id}/committed`,
        traceId
      });

      await updateTaskStepStatus({
        taskStepId: body.task_step_id,
        status: "succeeded",
        assignedCapabilityId: body.resolved_capability_id
      });
      await updateTaskResultState({
        taskPlanId: body.task_plan_id,
        outputState: "provisional",
        status: "open",
        finalStepId: body.task_step_id,
        systemResult: {
          phase: "dispatch_committed",
          capsule_id: capsuleId,
          resource_id: mockResource.resourceId
        }
      });
      await completeTaskAttempt({
        attemptId: taskAttempt.attemptId,
        outcomeCode: "effect_committed",
        outcomePayload: {
          capsule_id: capsuleId,
          resource_id: mockResource.resourceId
        },
        traceId
      });

      const response: DispatchResponse = {
        dispatch_status: "committed",
        attempt_no: taskAttempt.attemptNo,
        execution_reference: {
          resource_id: mockResource.resourceId,
          capsule_id: capsuleId
        },
        journal_checkpoint: "effect_committed",
        stream_state: "provisional"
      };

      return response;
    } catch (error) {
      await completeTaskAttempt({
        attemptId: taskAttempt.attemptId,
        outcomeCode: "dispatch_error",
        outcomePayload: {
          message: error instanceof Error ? error.message : "unknown dispatch error"
        },
        traceId
      });
      throw error;
    }
  });

  return app;
}
