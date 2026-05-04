type BreakerCounter = {
  failureCount: number;
  lastFailureAt: string | null;
  state: "closed" | "open";
};

const counters = new Map<string, BreakerCounter>();

function getThreshold(): number {
  const raw = Number(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || "3");
  return Number.isFinite(raw) && raw > 0 ? raw : 3;
}

export function recordCircuitSuccess(key: string): BreakerCounter {
  const next: BreakerCounter = {
    failureCount: 0,
    lastFailureAt: null,
    state: "closed"
  };
  counters.set(key, next);
  return next;
}

export function recordCircuitFailure(key: string): BreakerCounter {
  const current = counters.get(key) ?? {
    failureCount: 0,
    lastFailureAt: null,
    state: "closed" as const
  };
  const nextCount = current.failureCount + 1;
  const next: BreakerCounter = {
    failureCount: nextCount,
    lastFailureAt: new Date().toISOString(),
    state: nextCount >= getThreshold() ? "open" : "closed"
  };
  counters.set(key, next);
  return next;
}

export function getCircuitState(key: string): BreakerCounter {
  return (
    counters.get(key) ?? {
      failureCount: 0,
      lastFailureAt: null,
      state: "closed"
    }
  );
}
