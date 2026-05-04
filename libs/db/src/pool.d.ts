import pg from "pg";
export declare function getPool(): pg.Pool;
export declare function closePool(): Promise<void>;
