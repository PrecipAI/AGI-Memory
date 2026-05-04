import Fastify from "fastify";
import { queryCapabilities } from "@super-agent/db";

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

export function buildRegistryServiceApp() {
  const app = Fastify({ logger: false });

  app.get("/healthz", async () => ({
    service: "registry-service",
    ok: true,
    default_tenant_id: getDefaultTenantId(),
    default_scope: getDefaultScope()
  }));

  app.post("/internal/registry/capabilities", async (request) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const tenantId = getHeader(request.headers as Record<string, unknown>, "x-tenant-id", getDefaultTenantId());
    const scope = getHeader(request.headers as Record<string, unknown>, "x-scope", getDefaultScope());
    const taskType = typeof body.task_type === "string" ? body.task_type : "effectful_demo";
    const riskLevel = typeof body.risk_level === "string" ? body.risk_level : "low";
    const capabilities = await queryCapabilities({
      tenantId,
      scope,
      taskType,
      riskLevel
    });

    return {
      total: capabilities.length,
      tenant_id: tenantId,
      scope,
      task_type: taskType,
      items: capabilities
    };
  });

  return app;
}
