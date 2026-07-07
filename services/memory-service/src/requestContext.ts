import {
  assertSingleTenantBoundary,
  getDefaultScope,
  getDefaultTenantId,
} from "./memoryPolicyEngine.js";

function getHeader(
  headers: Record<string, unknown>,
  name: string,
  fallback: string,
): string {
  const value = headers[name.toLowerCase()] ?? headers[name] ?? fallback;
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function getTraceId(
  headers: Record<string, unknown>,
  fallback: string,
): string {
  return getHeader(headers, "x-trace-id", fallback);
}

export function resolveRequestContext(
  headers: Record<string, unknown>,
  label: string,
): {
  tenantId: string;
  scope: string;
  traceId: string;
  idempotencyKey: string;
} {
  const tenantId = getHeader(headers, "x-tenant-id", getDefaultTenantId());
  const scope = getHeader(headers, "x-scope", getDefaultScope());
  const traceId = getTraceId(headers, `trace-${label}-${Date.now()}`);
  const idempotencyKey = getHeader(
    headers,
    "idempotency-key",
    `idem-${label}-${Date.now()}`,
  );

  assertSingleTenantBoundary(tenantId, scope);

  return {
    tenantId,
    scope,
    traceId,
    idempotencyKey,
  };
}

/**
 * 解析 scope:query 参数优先,header 兜底,默认值最后。
 * 用于 graph/* 等接口的前端可筛选场景(会话/项目/全局)。
 */
export function resolveScopeFromQueryOrHeader(
  query: Record<string, unknown>,
  headers: Record<string, unknown>,
): string {
  const queryScope = typeof query.scope === "string" ? query.scope.trim() : "";
  if (queryScope.length > 0) return queryScope;
  return getHeader(headers, "x-scope", getDefaultScope());
}
