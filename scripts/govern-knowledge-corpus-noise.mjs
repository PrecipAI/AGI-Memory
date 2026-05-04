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

function canonicalSourceUri(uri) {
  return String(uri ?? "")
    .trim()
    .replace(/#.*$/, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

function isTempTestDocument(document) {
  const source = String(document.source_uri ?? "").toLowerCase();
  const title = String(document.title ?? "").toLowerCase();
  return (
    source.includes("/appdata/local/temp/basic-graph-contract-") ||
    source.includes("/appdata/local/temp/knowledge-debug-") ||
    title === "debug doc" ||
    (title === "basic graph contract" && source.includes("/appdata/local/temp/"))
  );
}

function documentScore(document) {
  const source = String(document.source_uri ?? "").toLowerCase();
  const title = String(document.title ?? "").toLowerCase();
  let score = 0;
  score += Number(document.markdown_length ?? 0) / 1000;
  score += Number(document.section_count ?? 0) * 2;
  if (!source.includes("/appdata/local/temp/")) score += 50;
  if (!source.includes("#")) score += 10;
  if (!title.includes("duplicate check")) score += 10;
  return score;
}

function chooseKeeper(group) {
  return [...group].sort((left, right) => {
    const scoreDiff = documentScore(right) - documentScore(left);
    if (scoreDiff !== 0) return scoreDiff;
    return String(left.created_at).localeCompare(String(right.created_at));
  })[0];
}

async function loadActiveDocuments() {
  const result = await pool.query(
    `
    SELECT
      d.id,
      d.title,
      d.source_uri,
      d.markdown_content_hash,
      d.created_at,
      length(coalesce(d.markdown_content, '')) AS markdown_length,
      (SELECT count(*)::int FROM kp_section s WHERE s.document_id = d.id AND s.status = 'active') AS section_count
    FROM kp_document d
    WHERE d.tenant_id = $1
      AND d.scope = $2
      AND d.status = 'active'
    ORDER BY d.created_at ASC
    `,
    [tenantId, scope]
  );
  return result.rows;
}

function collectDuplicateRetirements(documents) {
  const retire = new Map();
  const add = (document, reason, keeper = null) => {
    if (!retire.has(document.id)) {
      retire.set(document.id, {
        document_id: document.id,
        title: document.title,
        source_uri: document.source_uri,
        reason,
        keeper_id: keeper?.id ?? null,
        keeper_title: keeper?.title ?? null,
        keeper_source_uri: keeper?.source_uri ?? null
      });
    }
  };

  for (const document of documents) {
    if (isTempTestDocument(document)) {
      add(document, "test_or_temp_document");
    }
  }

  const byHash = new Map();
  for (const document of documents) {
    if (!document.markdown_content_hash) continue;
    byHash.set(document.markdown_content_hash, [...(byHash.get(document.markdown_content_hash) ?? []), document]);
  }
  for (const group of byHash.values()) {
    if (group.length < 2) continue;
    const keeper = chooseKeeper(group);
    for (const document of group) {
      if (document.id !== keeper.id) add(document, "duplicate_markdown_hash", keeper);
    }
  }

  const byCanonicalSource = new Map();
  for (const document of documents) {
    const key = canonicalSourceUri(document.source_uri);
    if (!key) continue;
    byCanonicalSource.set(key, [...(byCanonicalSource.get(key) ?? []), document]);
  }
  for (const group of byCanonicalSource.values()) {
    if (group.length < 2) continue;
    const keeper = chooseKeeper(group);
    for (const document of group) {
      if (document.id !== keeper.id) add(document, "duplicate_canonical_source_uri", keeper);
    }
  }

  return [...retire.values()];
}

async function cascadeRetire(documentIds, retirementsById) {
  if (documentIds.length === 0) {
    return { document_count: 0, section_count: 0, evidence_count: 0, fact_count: 0, relation_count: 0 };
  }

  const documentResult = await pool.query(
    `
    UPDATE kp_document
    SET status = 'retired',
        lifecycle_state = 'archived',
        review_state = 'model_accepted',
        metadata = metadata || $4::jsonb,
        updated_at = now()
    WHERE tenant_id = $1
      AND scope = $2
      AND id = ANY($3::uuid[])
      AND status = 'active'
    RETURNING id
    `,
    [
      tenantId,
      scope,
      documentIds,
      JSON.stringify({
        corpus_governance: {
          action: "retire_noise_or_duplicate",
          retired_by: "govern-knowledge-corpus-noise",
          retirements: retirementsById
        }
      })
    ]
  );

  const sectionResult = await pool.query(
    `
    UPDATE kp_section
    SET status = 'retired',
        lifecycle_state = 'archived',
        review_state = 'model_accepted',
        updated_at = now()
    WHERE tenant_id = $1
      AND scope = $2
      AND document_id = ANY($3::uuid[])
      AND status = 'active'
    RETURNING id
    `,
    [tenantId, scope, documentIds]
  );
  const sectionIds = sectionResult.rows.map((row) => row.id);

  const evidenceResult = await pool.query(
    `
    UPDATE kp_evidence
    SET status = 'retired',
        lifecycle_state = 'archived',
        review_state = 'model_accepted',
        updated_at = now()
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
      AND (
        metadata->>'document_id' = ANY($3::text[])
        OR raw_ref = ANY($4::text[])
      )
    RETURNING id
    `,
    [tenantId, scope, documentIds, sectionIds]
  );
  const evidenceIds = evidenceResult.rows.map((row) => row.id);

  const factLookup = await pool.query(
    `
    SELECT DISTINCT from_object_id AS id
    FROM kp_relation
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
      AND relation_type = 'derived_from'
      AND from_object_type = 'fact'
      AND to_object_type = 'section'
      AND to_object_id = ANY($3::uuid[])
    `,
    [tenantId, scope, sectionIds]
  );
  const factIds = factLookup.rows.map((row) => row.id);
  let factCount = 0;
  if (factIds.length > 0) {
    const factResult = await pool.query(
      `
      UPDATE kp_fact
      SET status = 'retired',
          lifecycle_state = 'archived',
          review_state = 'model_accepted',
          updated_at = now()
      WHERE tenant_id = $1
        AND scope = $2
        AND id = ANY($3::uuid[])
        AND status = 'active'
      RETURNING id
      `,
      [tenantId, scope, factIds]
    );
    factCount = factResult.rowCount ?? 0;
  }

  const relationObjectIds = [...documentIds, ...sectionIds, ...evidenceIds, ...factIds];
  let relationCount = 0;
  if (relationObjectIds.length > 0) {
    const relationResult = await pool.query(
      `
      UPDATE kp_relation
      SET status = 'retired',
          lifecycle_state = 'archived',
          review_state = 'model_accepted',
          updated_at = now()
      WHERE tenant_id = $1
        AND scope = $2
        AND status = 'active'
        AND (
          from_object_id = ANY($3::uuid[])
          OR to_object_id = ANY($3::uuid[])
        )
      RETURNING id
      `,
      [tenantId, scope, relationObjectIds]
    );
    relationCount = relationResult.rowCount ?? 0;
  }

  return {
    document_count: documentResult.rowCount ?? 0,
    section_count: sectionResult.rowCount ?? 0,
    evidence_count: evidenceResult.rowCount ?? 0,
    fact_count: factCount,
    relation_count: relationCount
  };
}

try {
  const documents = await loadActiveDocuments();
  const retirements = collectDuplicateRetirements(documents);
  const retirementsById = Object.fromEntries(retirements.map((item) => [item.document_id, item]));

  let cascade = { document_count: 0, section_count: 0, evidence_count: 0, fact_count: 0, relation_count: 0 };
  if (apply && retirements.length > 0) {
    cascade = await cascadeRetire(retirements.map((item) => item.document_id), retirementsById);
  }

  console.log(JSON.stringify({
    ok: true,
    mode: apply ? "apply" : "dry-run",
    tenant_id: tenantId,
    scope,
    scanned_active_documents: documents.length,
    retirement_candidate_count: retirements.length,
    retirements,
    cascade
  }, null, 2));
} finally {
  await pool.end();
}
