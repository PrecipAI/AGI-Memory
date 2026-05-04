export function getDbConfig() {
    return {
        connectionString: process.env.DB_URL || "postgresql://postgres@127.0.0.1:55432/super_agent_system"
    };
}
//# sourceMappingURL=config.js.map