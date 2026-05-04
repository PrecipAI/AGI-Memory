export declare function createVerificationResult(input: {
    tenantId: string;
    scope: string;
    taskRequestId: string;
    taskPlanId: string;
    taskStepId?: string | null;
    verificationPhase: string;
    verdict: string;
    verifierId: string;
    evidencePayload: Record<string, unknown>;
    failureEventId?: string | null;
    traceId: string;
}): Promise<string>;
