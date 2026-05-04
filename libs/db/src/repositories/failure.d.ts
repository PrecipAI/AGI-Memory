export declare function createFailureEvent(input: {
    tenantId: string;
    scope: string;
    taskRequestId: string;
    taskPlanId: string;
    taskStepId?: string | null;
    failureCode: string;
    failureClass: string;
    errorSignature: string;
    dependencyId?: string | null;
    retryable: boolean;
    severity: number;
    verifierPhase?: string | null;
    detailPayload: Record<string, unknown>;
    traceId: string;
}): Promise<string>;
