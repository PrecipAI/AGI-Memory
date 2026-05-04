import Fastify from "fastify";
import { listCleanupDlqItems } from "@super-agent/db";
import { buildReplayPlan } from "./replayPlanner.js";

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

export function buildDlqReplayControllerApp() {
  const app = Fastify({ logger: false });

  app.get("/healthz", async () => ({
    service: "dlq-replay-controller",
    ok: true,
    default_tenant_id: getDefaultTenantId(),
    default_scope: getDefaultScope()
  }));

  app.post("/internal/replay/plan", async (request) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const tenantId = getHeader(request.headers as Record<string, unknown>, "x-tenant-id", getDefaultTenantId());
    const scope = getHeader(request.headers as Record<string, unknown>, "x-scope", getDefaultScope());
    const dependencyId = typeof body.dependency_id === "string" ? body.dependency_id : "mock-ticket-api";
    const dependencyState =
      body.dependency_state === "DOWN" || body.dependency_state === "HALF-OPEN" || body.dependency_state === "UP"
        ? body.dependency_state
        : "DOWN";
    const items = await listCleanupDlqItems({
      tenantId,
      scope,
      dependencyId
    });
    const replayPlan = buildReplayPlan({
      dependencyId,
      dependencyState,
      itemCount: items.length
    });

    return {
      dependency_id: dependencyId,
      dependency_state: dependencyState,
      tenant_id: tenantId,
      scope,
      replay_plan: replayPlan,
      queued_items: items
    };
  });

  return app;
}
