export type TaskRequestRecord = {
    id: string;
    task_type: string;
    goal: string;
    normalized_envelope: Record<string, unknown>;
    trace_id: string;
    tenant_id: string;
    scope: string;
};
export declare function ensureTaskRequest(record: TaskRequestRecord): Promise<void>;
export declare function createTaskPlan(input: {
    taskRequestId: string;
    tenantId: string;
    scope: string;
    goal: string;
    riskLevel: string;
    acceptanceCriteria: unknown[];
    planPayload: Record<string, unknown>;
    traceId: string;
}): Promise<{
    planId: string;
    version: number;
}>;
export declare function createTaskStep(input: {
    taskPlanId: string;
    tenantId: string;
    scope: string;
    stepKey: string;
    stepOrder: number;
    title: string;
    stepType: string;
    dependencyKeys: string[];
    inputPayload: Record<string, unknown>;
    expectedOutput: Record<string, unknown>;
    acceptanceCriteria: unknown[];
    riskLevel: string;
    sideEffectClass: string;
    capabilityHint?: string;
    compensationHint?: Record<string, unknown>;
    traceId: string;
}): Promise<string>;
export declare function createTaskResult(input: {
    tenantId: string;
    scope: string;
    taskRequestId: string;
    taskPlanId: string;
    userSummary: string;
    systemResult: Record<string, unknown>;
    traceId: string;
}): Promise<void>;
export declare function getTaskStepById(stepId: string): Promise<Record<string, unknown> | null>;
export declare function updateTaskStepStatus(input: {
    taskStepId: string;
    status: string;
    assignedCapabilityId?: string | null;
}): Promise<void>;
export declare function updateTaskResultState(input: {
    taskPlanId: string;
    outputState: string;
    status?: string;
    finalStepId?: string | null;
    systemResult?: Record<string, unknown>;
}): Promise<void>;
