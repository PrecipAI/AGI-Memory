export const EVENT_NAMES = [
  "task.requested",
  "task.planned",
  "task.step.dispatched",
  "task.step.succeeded",
  "task.step.failed",
  "verification.failed",
  "feedback.committed",
  "memory.candidate.created",
  "memory.persisted",
  "memory.access.logged",
  "resident.snapshot.rebuilt",
  "memory.governance.swept",
  "memory.index.synced",
  "memory.drift.checked",
  "memory.reconciliation.recorded",
  "memory.zombie.detected",
  "task.attempt.recorded",
  "debt.detected",
  "task.aborted",
  "cleanup.started",
  "cleanup.parked",
  "scope.frozen",
  "runtime.pruned",
  "dependency.recovered",
  "cleanup.replay.started",
  "scope.thawed",
  "drift.detected",
  "dependency.half-opened"
] as const;

export type EventName = typeof EVENT_NAMES[number];

export type EventEnvelope = {
  event_id: string;
  event_name: EventName;
  event_version: "v1";
  occurred_at: string;
  trace_id: string;
  tenant_id: string;
  scope: string;
  task_request_id?: string;
  task_plan_id?: string;
  task_step_id?: string;
  idempotency_key: string;
  producer: string;
  payload: Record<string, unknown>;
};

export function buildEventEnvelope(input: Omit<EventEnvelope, "event_version" | "occurred_at">): EventEnvelope {
  return {
    ...input,
    event_version: "v1",
    occurred_at: new Date().toISOString()
  };
}
