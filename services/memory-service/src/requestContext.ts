import { assertSingleTenantBoundary, getDefaultScope, getDefaultTenantId } from "./memoryPolicyEngine.js";

function getHeader(headers: Record<string, unknown>, name: string, fallback: string): string {
  const value = headers[name.toLowerCase()] ?? headers[name] ?? fallback;
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function getTraceId(headers: Record<string, unknown>, fallback: string): string {
  return getHeader(headers, "x-trace-id", fallback);
}

export function resolveRequestContext(
  headers: Record<string, unknown>,
  label: string
): {
  tenantId: string;
  scope: string;
  traceId: string;
  idempotencyKey: string;
} {
  const tenantId = getHeader(headers, "x-tenant-id", getDefaultTenantId());
  const scope = getHeader(headers, "x-scope", getDefaultScope());
  const traceId = getTraceId(headers, `trace-${label}-${Date.now()}`);
  const idempotencyKey = getHeader(headers, "idempotency-key", `idem-${label}-${Date.now()}`);

  assertSingleTenantBoundary(tenantId, scope);

  return {
    tenantId,
    scope,
    traceId,
    idempotencyKey
  };
}
