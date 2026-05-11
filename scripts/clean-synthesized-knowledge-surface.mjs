import pg from "pg";

const { Pool } = pg;

const tenantId = process.env.DEFAULT_TENANT_ID || "tenant-local";
const scope = process.env.DEFAULT_SCOPE || "memory.validation";
const apply = process.env.APPLY === "1";

const invalidInternalKnowledgeTitles = new Set([
  "治理输入必须覆盖未治理会话与执行记录",
  "Memory MCP 接入应通过真实链路验证而不是仅做最小 smoke"
]);

const duplicateRetirementPolicies = [
  {
    keepTitle: "长期记忆必须在使用时验证有效性，而不是只做相似召回",
    retireTitles: ["长期记忆召回不能只做相似检索，必须在使用时验证有效性"],
    reason: "semantic_duplicate_keep_stronger_long_term_memory_validation_rule"
  },
  {
    keepTitle: "Agent 可靠性来自 harness 闭环，而不是单次提示词或单模型能力",
    retireTitles: ["Agent 可靠性主要由 harness 决定，不应只依赖模型和长提示词"],
    reason: "semantic_duplicate_keep_stronger_harness_reliability_pattern"
  }
];

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

function titleToPolicyMap() {
  const map = new Map();
  for (const title of invalidInternalKnowledgeTitles) {
    map.set(title, {
      action: "retire",
      reason: "internal_or_session_specific_not_external_knowledge",
      keeperTitle: null
    });
  }
  for (const policy of duplicateRetirementPolicies) {
    for (const title of policy.retireTitles) {
      map.set(title, {
        action: "retire",
        reason: policy.reason,
        keeperTitle: policy.keepTitle
      });
    }
  }
  return map;
}

async function loadActiveKnowledge(client) {
  const result = await client.query(
    `
    SELECT id, knowledge_type, title, confidence_score, status, review_state, recall_state, metadata
    FROM kp_synthesized_knowledge
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
    ORDER BY updated_at DESC, created_at DESC
    `,
    [tenantId, scope]
  );
  return result.rows;
}

async function retireKnowledge(client, plans) {
  const ids = plans.map((item) => item.id);
  if (ids.length === 0) {
    return {
      knowledgeCount: 0,
      evidenceLinkCount: 0,
      recallSurfaceCount: 0
    };
  }

  const metadataById = Object.fromEntries(
    plans.map((item) => [
      item.id,
      {
        governance_cleanup: {
          action: "retire_invalid_or_duplicate_synthesized_knowledge",
          reason: item.reason,
          keeper_title: item.keeperTitle,
          retired_by: "clean-synthesized-knowledge-surface"
        }
      }
    ])
  );

  const knowledgeResult = await client.query(
    `
    UPDATE kp_synthesized_knowledge
    SET status = 'retired',
        lifecycle_state = 'archived',
        review_state = 'model_accepted',
        recall_state = 'retired',
        metadata = metadata || cleanup.metadata_patch,
        updated_at = now()
    FROM (
      SELECT *
      FROM jsonb_to_recordset($3::jsonb) AS x(id uuid, metadata_patch jsonb)
    ) AS cleanup
    WHERE kp_synthesized_knowledge.id = cleanup.id
      AND kp_synthesized_knowledge.tenant_id = $1
      AND kp_synthesized_knowledge.scope = $2
      AND kp_synthesized_knowledge.status = 'active'
    RETURNING kp_synthesized_knowledge.id
    `,
    [tenantId, scope, json(Object.entries(metadataById).map(([id, metadata_patch]) => ({ id, metadata_patch })))]
  );

  const evidenceLinkResult = await client.query(
    `
    UPDATE kp_synthesized_knowledge_evidence
    SET status = 'retired'
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
      AND synthesized_knowledge_id = ANY($3::uuid[])
    RETURNING id
    `,
    [tenantId, scope, ids]
  );

  const recallSurfaceResult = await client.query(
    `
    UPDATE kp_recall_surface_state
    SET status = 'retired',
        metadata = metadata || $4::jsonb,
        updated_at = now()
    WHERE tenant_id = $1
      AND scope = $2
      AND object_type = 'synthesized_knowledge'
      AND object_id = ANY($3::uuid[])
      AND status = 'active'
    RETURNING object_id
    `,
    [
      tenantId,
      scope,
      ids,
      json({
        governance_cleanup: {
          action: "retire_invalid_or_duplicate_synthesized_knowledge",
          retired_by: "clean-synthesized-knowledge-surface"
        }
      })
    ]
  );

  return {
    knowledgeCount: knowledgeResult.rowCount ?? 0,
    evidenceLinkCount: evidenceLinkResult.rowCount ?? 0,
    recallSurfaceCount: recallSurfaceResult.rowCount ?? 0
  };
}

async function main() {
  const client = await pool.connect();
  try {
    const before = await loadActiveKnowledge(client);
    const policyByTitle = titleToPolicyMap();
    const plannedRetirements = before
      .map((item) => {
        const policy = policyByTitle.get(item.title);
        if (!policy) {
          return null;
        }
        return {
          id: item.id,
          title: item.title,
          knowledgeType: item.knowledge_type,
          confidenceScore: Number(item.confidence_score ?? 0),
          reason: policy.reason,
          keeperTitle: policy.keeperTitle
        };
      })
      .filter(Boolean);

    let applied = {
      knowledgeCount: 0,
      evidenceLinkCount: 0,
      recallSurfaceCount: 0
    };

    if (apply && plannedRetirements.length > 0) {
      await client.query("BEGIN");
      try {
        applied = await retireKnowledge(client, plannedRetirements);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    const after = await loadActiveKnowledge(client);
    console.log(
      JSON.stringify(
        {
          tenant_id: tenantId,
          scope,
          apply,
          before_active_count: before.length,
          planned_retirements: plannedRetirements,
          applied,
          after_active_count: after.length,
          remaining_titles: after.map((item) => item.title)
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
