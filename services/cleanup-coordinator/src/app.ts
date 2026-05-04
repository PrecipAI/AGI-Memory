import Fastify from "fastify";
import type { CleanupRequest, CleanupResponse } from "@super-agent/contracts";
import {
  createCleanupDlqItem,
  ensureIncidentCluster,
  getCompensationCapsule,
  getJournalEntries
} from "@super-agent/db";

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

export function buildCleanupCoordinatorApp() {
  const app = Fastify({ logger: false });

  app.get("/healthz", async () => ({
    service: "cleanup-coordinator",
    ok: true,
    default_tenant_id: getDefaultTenantId(),
    default_scope: getDefaultScope()
  }));

  app.post("/internal/cleanup/dispatch", async (request) => {
    const body = request.body as CleanupRequest;
    const tenantId = getHeader(request.headers as Record<string, unknown>, "x-tenant-id", getDefaultTenantId());
    const scope = getHeader(request.headers as Record<string, unknown>, "x-scope", getDefaultScope());
    const traceId = getHeader(request.headers as Record<string, unknown>, "x-trace-id", `trace-${body.task_step_id}`);

    const capsule = await getCompensationCapsule(body.capsule_id);
    const journal = await getJournalEntries(body.task_step_id, body.journal_cursor);
    const fingerprint = String(capsule?.fingerprint_at_execution ?? "unknown-fingerprint");
    const dependencyId = String(capsule?.target_dependency ?? "mock-ticket-api");
    const compensatorId = String(capsule?.compensator_id ?? "mock.ticket.delete");
    const capsulePayload = (capsule?.capsule_payload ?? {}) as Record<string, unknown>;
    const forcedDrift = capsulePayload.force_drift === true || body.cleanup_status === "quarantined_drifted";

    if (!capsule || journal.length === 0 || body.dependency_state === "DOWN") {
      const dlqItemId = await createCleanupDlqItem({
        tenantId,
        scope,
        taskRequestId: body.task_request_id,
        taskPlanId: body.task_plan_id,
        taskStepId: body.task_step_id,
        dependencyId,
        errorSignature: "cleanup.dependency.down",
        compensatorId,
        fingerprint,
        traceId
      });
      await ensureIncidentCluster({
        tenantId,
        scope,
        dependencyId,
        errorSignature: "cleanup.dependency.down",
        compensatorId,
        fingerprint,
        dependencyStateSnapshot: body.dependency_state,
        traceId
      });

      const response: CleanupResponse = {
        cleanup_status: "dlq_parked",
        drift_detected: false,
        dlq_item_id: dlqItemId,
        scope_frozen: true,
        reconciliation_required: false
      };
      return response;
    }

    if (forcedDrift) {
      const response: CleanupResponse = {
        cleanup_status: "quarantined_drifted",
        drift_detected: true,
        scope_frozen: true,
        reconciliation_required: true
      };
      return response;
    }

    const response: CleanupResponse = {
      cleanup_status: "closed_clean",
      drift_detected: false,
      scope_frozen: false,
      reconciliation_required: false
    };

    return response;
  });

  return app;
}
