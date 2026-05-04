export type DbConfig = {
  connectionString: string;
};

export function getDbConfig(): DbConfig {
  return {
    connectionString: process.env.DB_URL || "postgresql://postgres:postgres@127.0.0.1:55432/super_agent_system"
  };
}
