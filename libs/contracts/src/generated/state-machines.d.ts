export declare const eventNaming: "dot-case";
export declare const stateMachineEnums: {
    readonly task_request_status: readonly ["requested", "planned", "running", "blocked", "succeeded", "failed", "aborting", "closed_clean", "closed_partial", "dlq_parked", "quarantined_drifted", "manual_recovery_required", "cancelled"];
    readonly task_plan_status: readonly ["draft", "resolved", "approved", "executing", "replanned", "finalized"];
    readonly task_step_status: readonly ["pending", "ready", "running", "blocked", "succeeded", "failed", "cancelled", "aborting"];
    readonly cleanup_status: readonly ["aborting", "compensating", "reconciling", "dlq_parked", "closed_clean", "closed_partial", "quarantined_drifted", "manual_recovery_required"];
    readonly dependency_status: readonly ["DOWN", "HALF-OPEN", "UP"];
    readonly stream_state: readonly ["provisional", "committed", "revoked", "replanned", "blocked"];
};
export declare const stateMachines: {
    readonly task_step: {
        readonly initial: "pending";
        readonly terminal: readonly ["succeeded", "failed", "cancelled"];
        readonly transitions: readonly [{
            readonly from: "pending";
            readonly event: "dependencies.resolved";
            readonly to: "ready";
        }, {
            readonly from: "ready";
            readonly event: "router.dispatched";
            readonly to: "running";
        }, {
            readonly from: "ready";
            readonly event: "policy.blocked";
            readonly to: "blocked";
        }, {
            readonly from: "blocked";
            readonly event: "blocker.cleared";
            readonly to: "ready";
        }, {
            readonly from: "running";
            readonly event: "step.succeeded";
            readonly to: "succeeded";
        }, {
            readonly from: "running";
            readonly event: "step.failed";
            readonly to: "failed";
        }, {
            readonly from: "running";
            readonly event: "task.cancelled";
            readonly to: "cancelled";
        }, {
            readonly from: "running";
            readonly event: "circuit_breaker.opened";
            readonly to: "aborting";
        }];
    };
    readonly cleanup: {
        readonly initial: "aborting";
        readonly terminal: readonly ["dlq_parked", "closed_clean", "closed_partial", "quarantined_drifted", "manual_recovery_required"];
        readonly transitions: readonly [{
            readonly from: "aborting";
            readonly event: "cleanup.inputs_ready";
            readonly to: "compensating";
        }, {
            readonly from: "compensating";
            readonly event: "drift.detected";
            readonly to: "quarantined_drifted";
        }, {
            readonly from: "compensating";
            readonly event: "compensation.succeeded";
            readonly to: "reconciling";
        }, {
            readonly from: "compensating";
            readonly event: "retry.exhausted";
            readonly to: "dlq_parked";
        }, {
            readonly from: "reconciling";
            readonly event: "cleanup.verified";
            readonly to: "closed_clean";
        }, {
            readonly from: "reconciling";
            readonly event: "cleanup.partial";
            readonly to: "closed_partial";
        }, {
            readonly from: "reconciling";
            readonly event: "cleanup.manual_handoff";
            readonly to: "manual_recovery_required";
        }];
    };
    readonly dependency: {
        readonly initial: "DOWN";
        readonly terminal: readonly [];
        readonly transitions: readonly [{
            readonly from: "DOWN";
            readonly event: "dependency.recovered";
            readonly to: "HALF-OPEN";
        }, {
            readonly from: "HALF-OPEN";
            readonly event: "canary.failed";
            readonly to: "DOWN";
        }, {
            readonly from: "HALF-OPEN";
            readonly event: "window.passed";
            readonly to: "UP";
        }, {
            readonly from: "UP";
            readonly event: "probe.failed";
            readonly to: "DOWN";
        }];
    };
    readonly stream: {
        readonly initial: "provisional";
        readonly terminal: readonly ["committed", "revoked", "replanned", "blocked"];
        readonly transitions: readonly [{
            readonly from: "provisional";
            readonly event: "cold_path.verified";
            readonly to: "committed";
        }, {
            readonly from: "provisional";
            readonly event: "conflict.detected";
            readonly to: "revoked";
        }, {
            readonly from: "provisional";
            readonly event: "planner.replanned";
            readonly to: "replanned";
        }, {
            readonly from: "provisional";
            readonly event: "policy.blocked";
            readonly to: "blocked";
        }];
    };
};
export type TaskRequestStatus = typeof stateMachineEnums.task_request_status[number];
export type TaskPlanStatus = typeof stateMachineEnums.task_plan_status[number];
export type TaskStepStatus = typeof stateMachineEnums.task_step_status[number];
export type CleanupStatus = typeof stateMachineEnums.cleanup_status[number];
export type DependencyStatus = typeof stateMachineEnums.dependency_status[number];
export type StreamState = typeof stateMachineEnums.stream_state[number];
