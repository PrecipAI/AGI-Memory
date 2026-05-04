export declare function queryResidentSnapshot(input: {
    tenantId: string;
    scope: string;
    limit?: number;
}): Promise<Record<string, unknown>[]>;
export declare function queryFactualMemory(input: {
    tenantId: string;
    scope: string;
    limit?: number;
}): Promise<Record<string, unknown>[]>;
export declare function queryProceduralMemory(input: {
    tenantId: string;
    scope: string;
    fingerprint?: string | null;
    limit?: number;
}): Promise<Record<string, unknown>[]>;
