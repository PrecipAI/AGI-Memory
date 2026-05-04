export type FrozenErrorCode =
  | "SINGLE_TENANT_ONLY"
  | "FINGERPRINT_REQUIRED"
  | "FINGERPRINT_STATUS_REQUIRED"
  | "FINGERPRINT_MISMATCH"
  | "BAD_REQUEST"
  | "POLICY_BLOCKED"
  | "DEPENDENCY_DOWN"
  | "INTERNAL_ERROR";

export function createFrozenHttpError(statusCode: number, message: string, errorCode: FrozenErrorCode) {
  return Object.assign(new Error(message), {
    statusCode,
    errorCode
  });
}

export function formatFrozenErrorResponse(input: {
  error: unknown;
  traceId: string;
}) {
  const normalizedError = input.error as {
    statusCode?: number;
    errorCode?: FrozenErrorCode;
    message?: string;
  };
  const statusCode = typeof normalizedError.statusCode === "number" ? normalizedError.statusCode : 500;
  const errorCode = typeof normalizedError.errorCode === "string" ? normalizedError.errorCode : "INTERNAL_ERROR";
  const message =
    typeof normalizedError.message === "string" && normalizedError.message.length > 0
      ? normalizedError.message
      : "Unhandled memory-service error.";

  return {
    statusCode,
    body: {
      error_code: errorCode,
      message,
      trace_id: input.traceId,
      retryable: statusCode >= 500 || errorCode === "DEPENDENCY_DOWN",
      details: {}
    }
  };
}
