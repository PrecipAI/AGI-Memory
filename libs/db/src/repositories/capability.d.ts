export declare function queryCapabilities(input: {
    tenantId: string;
    scope: string;
    taskType?: string;
    riskLevel: string;
}): Promise<Record<string, unknown>[]>;
