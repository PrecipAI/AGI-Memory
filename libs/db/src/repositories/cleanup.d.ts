export declare function createCleanupDlqItem(input: {
    tenantId: string;
    scope: string;
    taskRequestId: string;
    taskPlanId: string;
    taskStepId?: string | null;
    dependencyId: string;
    errorSignature: string;
    compensatorId: string;
    fingerprint: string;
    traceId: string;
}): Promise<string>;
export declare function listCleanupDlqItems(dependencyId: string): Promise<Record<string, unknown>[]>;
export declare function ensureIncidentCluster(input: {
    tenantId: string;
    scope: string;
    dependencyId: string;
    errorSignature: string;
    compensatorId: string;
    fingerprint: string;
    dependencyStateSnapshot: string;
    traceId: string;
}): Promise<string>;
