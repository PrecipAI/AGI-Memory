import { createFrozenHttpError } from "./errors.js";

export function getDefaultTenantId(): string {
  return process.env.DEFAULT_TENANT_ID || "tenant-local";
}

export function getDefaultScope(): string {
  return process.env.DEFAULT_SCOPE || "memory.validation";
}

export function isSingleTenantMode(): boolean {
  return (process.env.MEMORY_SINGLE_TENANT_MODE || "true").toLowerCase() !== "false";
}

export function assertSingleTenantBoundary(tenantId: string, scope: string): void {
  if (!isSingleTenantMode()) {
    return;
  }
  if (tenantId !== getDefaultTenantId() || scope !== getDefaultScope()) {
    throw createFrozenHttpError(400, "Single-tenant validation mode rejects non-default tenant/scope.", "SINGLE_TENANT_ONLY");
  }
}

export function normalizeFingerprintStatus(input: string | undefined, fingerprint?: string | null) {
  if (input === "matched" || input === "matched_or_na" || input === "mismatch" || input === "unknown") {
    return input;
  }
  return fingerprint ? "matched" : "matched_or_na";
}

export function isHighRiskCandidate(sideEffectClass: string, verificationStatus: string): boolean {
  return ["external_resource", "state_change", "approval"].includes(sideEffectClass) && !verificationStatus.startsWith("verified");
}

export function isAllowlistErrorCode(errorCode?: string | null): boolean {
  return ["FIX_TIMEOUT_503", "FIX_RETRYABLE_TIMEOUT", "FIX_TRANSIENT_503", "INJECTED_BREAKER"].includes(errorCode ?? "");
}
