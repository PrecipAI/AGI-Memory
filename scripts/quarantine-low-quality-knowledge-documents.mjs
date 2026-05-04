import pg from "pg";
import { readFile } from "node:fs/promises";
import path from "node:path";

const { Pool } = pg;
const rootDir = process.cwd();
const tenantId = process.env.DEFAULT_TENANT_ID || "tenant-local";
const scope = process.env.DEFAULT_SCOPE || "memory.validation";
const ingestCasesPath = path.join(rootDir, "tests", "knowledge-benchmark", "ai-dev-ingest-cases.v1.json");
const pool = new Pool({
  connectionString:
    process.env.DB_URL ||
    `postgresql://${encodeURIComponent(process.env.PGUSER || "postgres")}:${
      encodeURIComponent(process.env.PGPASSWORD || "postgres")
    }@${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "55432"}/${process.env.PGDATABASE || "super_agent_system"}`
});

async function cascadeQuarantine(documentIds) {
  if (documentIds.length === 0) {
    return {
      section_count: 0,
      evidence_count: 0,
      fact_count: 0,
      relation_count: 0
    };
  }
  const sectionResult = await pool.query(
    `
    UPDATE kp_section
    SET status = 'parked',
        lifecycle_state = 'quarantined',
        review_state = 'needs_review',
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
    SET status = 'parked',
        lifecycle_state = 'quarantined',
        review_state = 'needs_review',
        updated_at = now()
    WHERE tenant_id = $1
      AND scope = $2
      AND (
        metadata->>'document_id' = ANY($3::text[])
        OR raw_ref = ANY($4::text[])
      )
      AND status = 'active'
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
      SET status = 'parked',
          lifecycle_state = 'quarantined',
          review_state = 'needs_review',
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
      SET status = 'parked',
          lifecycle_state = 'quarantined',
          review_state = 'needs_review',
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
    section_count: sectionResult.rowCount ?? 0,
    evidence_count: evidenceResult.rowCount ?? 0,
    fact_count: factCount,
    relation_count: relationCount
  };
}

const TOPIC_RELEVANCE_PATTERNS = {
  agent_memory: [
    /\b(agentic\s+memory|agent\s+memory|memory\s+system|long[-\s]?term\s+memory|persistent\s+memory)\b/i,
    /\bmem0\b|\bzep\b|\blangmem\b|\bletta\b/i,
    /智能体记忆|长期记忆|记忆系统|记忆管理|记忆治理/
  ],
  agent_framework: [
    /\b(agent|agents|multi-agent|agentic|workflow|tool\s+calling|function\s+calling)\b/i,
    /\bautogen\b|\bcrewai\b|\bpydantic\s+ai\b|\bagno\b|\bsemantic\s+kernel\b|\bqwen-agent\b|\bagentscope\b/i,
    /智能体|多智能体|工作流|工具调用|函数调用|应用构建/
  ],
  rag: [
    /\b(retrieval[-\s]?augmented\s+generation|rag|retriever|retrieval|rerank|reranker|hybrid\s+search|bm25|rrf|embedding|vector\s+search|query\s+engine|graphrag|node\s+parser|chunk|chunking|splitter)\b/i,
    /检索增强|检索增强生成|向量检索|混合检索|召回|重排|知识库问答|知识库|嵌入|切分|分块|图检索|切块/
  ],
  eval_harness: [
    /\b(eval|evaluation|benchmark|bench|harness|swe-bench|gaia|inspect\s+ai|promptfoo|deepeval|ragas)\b/i,
    /评测|评价|基准|测试集|测试框架|验证集/
  ],
  harness_engineering: [
    /\b(harness\s+engineering|agent\s+harness|ai\s+engineering\s+harness|swe-bench|benchmark|reliability)\b/i,
    /harness|测试脚手架|工程验证|可靠性|基准测试/
  ],
  mcp_tool_use: [
    /\b(model\s+context\s+protocol|mcp|tool\s+use|tools|resources|prompts|json-rpc)\b/i,
    /模型上下文协议|工具|资源|提示词|协议|客户端|服务器/
  ],
  knowledge_graph: [
    /\b(knowledge\s+graph|graph\s+rag|graphrag|ontology|entity|relation|graph\s+search|persistence|checkpoint|thread|stateful)\b/i,
    /知识图谱|图谱|实体|关系|本体|图检索|持久化|检查点|状态/
  ],
  observability: [
    /\b(observability|trace|tracing|telemetry|otel|opentelemetry|langfuse|phoenix|monitoring)\b/i,
    /可观测|追踪|监控|遥测|日志|指标/
  ],
  security: [
    /\b(security|prompt\s+injection|red\s+team|owasp|llm\s+risk|jailbreak|guardrail)\b/i,
    /安全|提示注入|红队|越狱|风险|防护/
  ],
  tool_use: [
    /\b(tool\s+use|tool\s+calling|function\s+calling|function-call|tools|agent\s+tool)\b/i,
    /工具调用|函数调用|工具使用|外部工具/
  ],
  vector_database: [
    /\b(vector\s+database|vector\s+search|hybrid\s+search|dense\s+vector|sparse\s+vector|weaviate|pinecone|qdrant|milvus|embedding)\b/i,
    /向量数据库|向量检索|混合检索|稠密向量|稀疏向量|嵌入/
  ],
  lexical_retrieval: [
    /\b(bm25|lexical\s+retrieval|similarity|elasticsearch|inverted\s+index|term\s+frequency)\b/i,
    /词法检索|倒排索引|相似度|词频/
  ],
  hybrid_retrieval: [
    /\b(hybrid\s+search|reciprocal\s+rank\s+fusion|rrf|bm25|vector\s+search|rank\s+fusion)\b/i,
    /混合检索|融合排序|向量检索|召回融合/
  ]
};

async function loadExpectedSignalByUrl() {
  try {
    const ingestCases = JSON.parse(await readFile(ingestCasesPath, "utf8"));
    return new Map(
      ingestCases
        .filter((item) => item.url)
        .map((item) => [
          item.url,
          [...new Set([item.theme, ...(item.expected_signals ?? [])].filter(Boolean))]
        ])
    );
  } catch {
    return new Map();
  }
}

function analyzeRelevance(markdown, signals) {
  const matched = [...new Set(signals)].filter((signal) => {
    const patterns = TOPIC_RELEVANCE_PATTERNS[signal] ?? [];
    return patterns.some((pattern) => pattern.test(markdown));
  });
  return {
    relevance_signal_count: matched.length,
    relevance_matched_signals: matched
  };
}

function analyzeQuality(markdown, sections, signals = []) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const contentLines = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^#{1,6}\s+/.test(line))
    .filter((line) => !/^source url:/i.test(line))
    .filter((line) => !/^[-*]\s*(source|url|authors?|published|doi|arxiv):/i.test(line));
  const usefulBodyCharCount = contentLines.join("\n").length;
  const substantiveLineCount = contentLines.filter((line) => line.length >= 80).length;
  const shortSectionCount = sections.filter((section) => String(section.content ?? "").trim().length < 120).length;
  const relevance = analyzeRelevance(markdown, signals);
  const reason =
    usefulBodyCharCount < 900
      ? `useful_body_too_short:${usefulBodyCharCount}`
      : substantiveLineCount < 3
        ? `too_few_substantive_lines:${substantiveLineCount}`
        : null;
  return {
    accepted: reason === null,
    reason,
    useful_body_char_count: usefulBodyCharCount,
    substantive_line_count: substantiveLineCount,
    short_section_count: shortSectionCount,
    section_count: sections.length,
    governance_flags: signals.length > 0 && relevance.relevance_signal_count === 0
      ? [`topic_relevance_missing:${signals.join(",")}`]
      : [],
    ...relevance
  };
}

try {
  const expectedSignalByUrl = await loadExpectedSignalByUrl();
  const documents = await pool.query(
    `
    SELECT id, title, source_type, source_uri, markdown_content, metadata
    FROM kp_document
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
      AND lifecycle_state <> 'quarantined'
      AND source_type IN ('markdown_file', 'markitdown_file', 'markitdown_url')
      AND markdown_content IS NOT NULL
    ORDER BY updated_at DESC
    `,
    [tenantId, scope]
  );

  const quarantined = [];
  for (const document of documents.rows) {
    const sections = await pool.query(
      `
      SELECT id, content
      FROM kp_section
      WHERE tenant_id = $1
        AND scope = $2
        AND document_id = $3::uuid
        AND status = 'active'
      `,
      [tenantId, scope, document.id]
    );
    const metadataSignals = [
      document.metadata?.theme,
      ...(
        Array.isArray(document.metadata?.expected_signals)
          ? document.metadata.expected_signals
          : []
      )
    ].filter(Boolean);
    const signals = metadataSignals.length > 0 ? metadataSignals : expectedSignalByUrl.get(document.source_uri) ?? [];
    const quality = analyzeQuality(document.markdown_content, sections.rows, [...new Set(signals)]);
    if (quality.accepted) {
      if (quality.governance_flags.length > 0) {
        await pool.query(
          `
          UPDATE kp_document
          SET metadata = metadata || $4::jsonb,
              updated_at = now()
          WHERE tenant_id = $1
            AND scope = $2
            AND id = $3::uuid
          `,
          [
            tenantId,
            scope,
            document.id,
            JSON.stringify({
              quality_gate: {
                accepted: true,
                reason: null,
                governance_flags: quality.governance_flags,
                relevance_signal_count: quality.relevance_signal_count,
                relevance_matched_signals: quality.relevance_matched_signals,
                checked_by: "quarantine-low-quality-knowledge-documents"
              }
            })
          ]
        );
      }
      continue;
    }
    await pool.query(
      `
      UPDATE kp_document
      SET lifecycle_state = 'quarantined',
          review_state = 'needs_review',
          metadata = metadata || $4::jsonb,
          updated_at = now()
      WHERE tenant_id = $1
        AND scope = $2
        AND id = $3::uuid
      `,
      [
        tenantId,
        scope,
        document.id,
        JSON.stringify({
          quality_gate: {
            accepted: false,
            reason: quality.reason,
            useful_body_char_count: quality.useful_body_char_count,
            substantive_line_count: quality.substantive_line_count,
            short_section_count: quality.short_section_count,
            section_count: quality.section_count,
            quarantined_by: "quarantine-low-quality-knowledge-documents"
          }
        })
      ]
    );
    quarantined.push({
      document_id: document.id,
      title: document.title,
      source_uri: document.source_uri,
      ...quality
    });
  }
  const existingQuarantined = await pool.query(
    `
    SELECT id
    FROM kp_document
    WHERE tenant_id = $1
      AND scope = $2
      AND lifecycle_state = 'quarantined'
    `,
    [tenantId, scope]
  );
  const cascade = await cascadeQuarantine(existingQuarantined.rows.map((row) => row.id));

  console.log(
    JSON.stringify(
      {
        ok: true,
        scanned_count: documents.rows.length,
        quarantined_count: quarantined.length,
        quarantined,
        cascade
      },
      null,
      2
    )
  );
} finally {
  await pool.end();
}
