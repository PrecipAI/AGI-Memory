import pg from "pg";

const { Client } = pg;
const client = new Client(process.env.DB_URL || "postgresql://postgres:postgres@127.0.0.1:15432/super_agent_system");

await client.connect();

const result1 = await client.query(
  "DELETE FROM governance_change_proposal WHERE proposed_payload->>'title' LIKE '%测试规则%' OR reason LIKE '%测试%' OR proposed_action LIKE '%conflict%'"
);
console.log(`cleaned proposals: ${result1.rowCount}`);

const result2 = await client.query("DELETE FROM rule WHERE title LIKE '%测试规则%'");
console.log(`cleaned rules: ${result2.rowCount}`);

await client.end();
console.log("done");
