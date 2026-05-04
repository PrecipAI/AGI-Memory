import pg from "pg";
import { getDbConfig } from "./config.js";
const { Pool } = pg;
let pool;
export function getPool() {
    if (!pool) {
        pool = new Pool(getDbConfig());
    }
    return pool;
}
export async function closePool() {
    if (pool) {
        await pool.end();
        pool = undefined;
    }
}
//# sourceMappingURL=pool.js.map