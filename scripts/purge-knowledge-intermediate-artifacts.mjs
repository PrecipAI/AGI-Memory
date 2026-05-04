import pg from "pg";

const { Pool } = pg;

const tenantId = process.env.KNOWLEDGE_TENANT_ID || process.env.DEFAULT_TENANT_ID || "tenant-local";
const scope = process.env.KNOWLEDGE_SCOPE || process.env.DEFAULT_SCOPE || "memory.validation";

const pool = new Pool({
  connectionString:
    process.env.DB_URL ||
    `postgresql://${encodeURIComponent(process.env.PGUSER || "postgres")}${
      process.env.PGPASSWORD ? `:${encodeURIComponent(process.env.PGPASSWORD)}` : ""
    }@${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "55432"}/${process.env.PGDATABASE || "super_agent_system"}`
});

async function countByStatus(client, table) {
  const result = await client.query(
    `
    SELECT status::text, COUNT(*)::int AS count
    FROM ${table}
    WHERE tenant_id = $1 AND scope = $2
    GROUP BY status
    ORDER BY status
    `,
    [tenantId, scope]
  );
  return Object.fromEntries(result.rows.map((row) => [row.status, row.count]));
}

async function countAll(client, table) {
  const result = await client.query(
    `
    SELECT COUNT(*)::int AS count
    FROM ${table}
    WHERE tenant_id = $1 AND scope = $2
    `,
    [tenantId, scope]
  );
  return result.rows[0].count;
}

async function main() {
  const client = await pool.connect();
  try {
    const before = {
      synthesized_knowledge: await countByStatus(client, "kp_synthesized_knowledge"),
      synthesized_knowledge_evidence: await countByStatus(client, "kp_synthesized_knowledge_evidence"),
      evidence: await countByStatus(client, "kp_evidence"),
      documents: await countByStatus(client, "kp_document"),
      sections: await countByStatus(client, "kp_section"),
      facts: await countByStatus(client, "kp_fact"),
      entities: await countByStatus(client, "kp_entity"),
      relations: await countByStatus(client, "kp_relation"),
      recall_surface_state: await countAll(client, "kp_recall_surface_state")
    };

    await client.query("BEGIN");

    const relinkEvidence = await client.query(
      `
      UPDATE kp_synthesized_knowledge_evidence
      SET source_object_type = 'evidence',
          source_object_id = evidence_id
      WHERE tenant_id = $1
        AND scope = $2
        AND source_object_type IN ('fact', 'entity', 'relation')
      `,
      [tenantId, scope]
    );

    const rewriteSynthesizedSources = await client.query(
      `
      UPDATE kp_synthesized_knowledge
      SET source_object_ids = evidence_ids,
          metadata = metadata
            || jsonb_build_object(
              'source_object_type', 'evidence',
              'intermediate_artifacts_purged', true,
              'intermediate_artifacts_purged_at', now()
            ),
          updated_at = now()
      WHERE tenant_id = $1
        AND scope = $2
        AND status = 'active'
      `,
      [tenantId, scope]
    );

    const deleteRecallSurface = await client.query(
      `
      DELETE FROM kp_recall_surface_state
      WHERE tenant_id = $1
        AND scope = $2
        AND object_type IN ('fact', 'entity', 'relation')
      `,
      [tenantId, scope]
    );

    const deleteRelations = await client.query(
      `
      DELETE FROM kp_relation
      WHERE tenant_id = $1
        AND scope = $2
      `,
      [tenantId, scope]
    );

    const deleteFacts = await client.query(
      `
      DELETE FROM kp_fact
      WHERE tenant_id = $1
        AND scope = $2
      `,
      [tenantId, scope]
    );

    const deleteEntities = await client.query(
      `
      DELETE FROM kp_entity
      WHERE tenant_id = $1
        AND scope = $2
      `,
      [tenantId, scope]
    );

    await client.query("COMMIT");

    const after = {
      synthesized_knowledge: await countByStatus(client, "kp_synthesized_knowledge"),
      synthesized_knowledge_evidence: await countByStatus(client, "kp_synthesized_knowledge_evidence"),
      evidence: await countByStatus(client, "kp_evidence"),
      documents: await countByStatus(client, "kp_document"),
      sections: await countByStatus(client, "kp_section"),
      facts: await countByStatus(client, "kp_fact"),
      entities: await countByStatus(client, "kp_entity"),
      relations: await countByStatus(client, "kp_relation"),
      recall_surface_state: await countAll(client, "kp_recall_surface_state")
    };

    console.log(JSON.stringify({
      tenant_id: tenantId,
      scope,
      contract: "long_term_store_keeps_derived_knowledge_and_sources_only",
      before,
      changed: {
        relinked_synthesized_evidence_rows: relinkEvidence.rowCount,
        rewritten_synthesized_knowledge_rows: rewriteSynthesizedSources.rowCount,
        deleted_recall_surface_rows: deleteRecallSurface.rowCount,
        deleted_relation_rows: deleteRelations.rowCount,
        deleted_fact_rows: deleteFacts.rowCount,
        deleted_entity_rows: deleteEntities.rowCount
      },
      after
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
