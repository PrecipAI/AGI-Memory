import pg from "pg";

const { Pool } = pg;

const tenantId = process.env.DEFAULT_TENANT_ID || "tenant-local";
const scope = process.env.DEFAULT_SCOPE || "memory.validation";
const apply = process.env.APPLY === "1";

const pool = new Pool({
  connectionString:
    process.env.DB_URL ||
    `postgresql://${encodeURIComponent(process.env.PGUSER || "postgres")}:${
      encodeURIComponent(process.env.PGPASSWORD || "postgres")
    }@${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "55432"}/${process.env.PGDATABASE || "super_agent_system"}`
});

function json(value) {
  return JSON.stringify(value ?? {});
}

async function loadSurface(client) {
  const memoryRows = await client.query(
    `
    SELECT id, title, source_kind, source_ref
    FROM memory
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
    ORDER BY updated_at DESC
    `,
    [tenantId, scope]
  );
  const ruleRows = await client.query(
    `
    SELECT id, rule_key, title
    FROM rule
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
    ORDER BY updated_at DESC
    `,
    [tenantId, scope]
  );
  const skillRows = await client.query(
    `
    SELECT id, skill_key, title
    FROM skill
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
    ORDER BY updated_at DESC
    `,
    [tenantId, scope]
  );

  return {
    memory: memoryRows.rows,
    rule: ruleRows.rows,
    skill: skillRows.rows
  };
}

function planCleanup(surface) {
  return {
    memory: surface.memory
      .filter((item) => item.source_kind === "seed")
      .map((item) => ({
        id: item.id,
        title: item.title,
        reason: "validation_seed_memory_not_part_of_final_governed_surface"
      })),
    rule: surface.rule
      .filter((item) => item.rule_key === "console-proposal-smoke-rule")
      .map((item) => ({
        id: item.id,
        title: item.title,
        reason: "validation_smoke_rule_not_part_of_final_governed_surface"
      })),
    skill: surface.skill
      .filter((item) => item.skill_key === "triage-ticket-v1")
      .map((item) => ({
        id: item.id,
        title: item.title,
        reason: "validation_demo_skill_not_part_of_final_governed_surface"
      }))
  };
}

async function retireRows(client, input) {
  const { table, idField, ids, metadataPatch, hasMetadata } = input;
  if (ids.length === 0) {
    return 0;
  }
  const parameters = hasMetadata ? [tenantId, scope, ids, json(metadataPatch)] : [tenantId, scope, ids];
  const result = await client.query(
    `
    UPDATE ${input.table}
    SET status = 'retired',
        ${hasMetadata ? "metadata = metadata || $4::jsonb," : ""}
        updated_at = now()
    WHERE tenant_id = $1
      AND scope = $2
      AND ${input.idField} = ANY($3::uuid[])
      AND status = 'active'
    RETURNING ${input.idField}
    `,
    parameters
  );
  return result.rowCount ?? 0;
}

async function main() {
  const client = await pool.connect();
  try {
    const before = await loadSurface(client);
    const plan = planCleanup(before);
    const summary = {
      memory: plan.memory,
      rule: plan.rule,
      skill: plan.skill
    };

    let applied = {
      memory_retired: 0,
      rule_retired: 0,
      skill_retired: 0
    };

    if (apply) {
      await client.query("BEGIN");
      try {
        applied.memory_retired = await retireRows(
          client,
          {
            table: "memory",
            idField: "id",
            ids: plan.memory.map((item) => item.id),
            hasMetadata: true,
            metadataPatch: {
              governance_cleanup: {
                action: "retire_validation_surface_artifact",
                retired_by: "clean-validation-memory-surface"
              }
            }
          }
        );
        applied.rule_retired = await retireRows(
          client,
          {
            table: "rule",
            idField: "id",
            ids: plan.rule.map((item) => item.id),
            hasMetadata: true,
            metadataPatch: {
              governance_cleanup: {
                action: "retire_validation_surface_artifact",
                retired_by: "clean-validation-memory-surface"
              }
            }
          }
        );
        applied.skill_retired = await retireRows(
          client,
          {
            table: "skill",
            idField: "id",
            ids: plan.skill.map((item) => item.id),
            hasMetadata: false,
            metadataPatch: {}
          }
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    const after = await loadSurface(client);
    console.log(
      JSON.stringify(
        {
          tenant_id: tenantId,
          scope,
          apply,
          planned_cleanup: summary,
          applied,
          after
        },
        null,
        2
      )
    );
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
