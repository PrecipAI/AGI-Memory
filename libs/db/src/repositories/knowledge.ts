import { getPool } from "../pool.js";

function toJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function toJsonArray(value: unknown): string {
  return JSON.stringify(Array.isArray(value) ? value : []);
}

function estimateTokenCount(input: string): number {
  const latinWordCount = (input.match(/[A-Za-z0-9_]+(?:[-'][A-Za-z0-9_]+)*/g) ?? []).length;
  const cjkCharCount = (input.match(/[\u3400-\u9FFF]/g) ?? []).length;
  const symbolChunkCount = (input.match(/[^\sA-Za-z0-9_\u3400-\u9FFF]{2,}/g) ?? []).length;
  return Math.max(1, latinWordCount + Math.ceil(cjkCharCount / 2) + symbolChunkCount);
}

export function extractLooseSearchTerms(input?: string | null): string[] {
  const normalized = input?.trim().toLowerCase();
  if (!normalized) {
    return [];
  }
  const stopwords = new Set([
    "the",
    "and",
    "with",
    "about",
    "不能",
    "为什么",
    "怎么",
    "是否",
    "什么",
    "有什么",
    "区别"
  ]);
  const domainTerms = [
    "长期记忆",
    "记忆",
    "召回",
    "验证",
    "有效",
    "agent",
    "harness",
    "提示词",
    "模型",
    "rag",
    "graphrag",
    "检索",
    "证据",
    "装配",
    "上下文",
    "可观测性",
    "图谱",
    "抽取",
    "知识",
    "治理",
    "chunk",
    "关系",
    "规则",
    "评估",
    "评测",
    "端到端",
    "生成",
    "忠实度",
    "多轮",
    "观测",
    "轨迹",
    "工具调用",
    "成本",
    "权限",
    "授权",
    "沙箱",
    "审计",
    "生产级",
    "多信号",
    "重排",
    "混合召回",
    "bm25",
    "向量",
    "稀疏",
    "后端",
    "milvus",
    "qdrant",
    "pinecone",
    "weaviate",
    "elasticsearch",
    "知识平台",
    "工作流",
    "多源",
    "多智能体",
    "状态",
    "运行时",
    "时效",
    "过期",
    "替换",
    "用户画像",
    "结构",
    "时间",
    "重要性",
    "证据治理",
    "事实有效性"
  ];
  const terms = new Set<string>();
  for (const token of normalized.split(/\s+/)) {
    const trimmed = token.trim();
    if (trimmed.length >= 2 && !stopwords.has(trimmed)) {
      terms.add(trimmed);
    }
    for (const latin of trimmed.match(/[a-z][a-z0-9_-]{2,}/g) ?? []) {
      if (!stopwords.has(latin)) {
        terms.add(latin);
      }
      if (latin.length > 3 && latin.endsWith("s")) {
        const singular = latin.slice(0, -1);
        if (!stopwords.has(singular)) {
          terms.add(singular);
        }
      }
    }
    for (const cjk of trimmed.match(/[\u3400-\u9FFF]{2,}/g) ?? []) {
      if (cjk.length <= 4 && !stopwords.has(cjk)) {
        terms.add(cjk);
      }
      // 长中文串用 bigram 滑动窗口拆分，避免超过 4 字的整句被丢弃
      if (cjk.length > 4) {
        for (let i = 0; i < cjk.length - 1; i++) {
          const bigram = cjk.slice(i, i + 2);
          if (!stopwords.has(bigram)) {
            terms.add(bigram);
          }
        }
      }
    }
  }
  const synonymTerms: Array<[RegExp, string[]]> = [
    [/\bgraph\b|\bgraphrag\b/, ["图谱", "graphrag"]],
    [/\bretrieval\b|\bretrieve\b|\brecall\b/, ["检索", "召回"]],
    [/\bevidence\b|\bcitation\b|\bcitations\b|\bgrounding\b/, ["证据"]],
    [/\bvalidity\b|\bvalidate\b|\bvalidation\b/, ["有效性", "验证"]],
    [/\blong[- ]term\b/, ["长期记忆"]],
    [/\bmemory\b/, ["记忆"]],
    [/\bharness\b/, ["harness"]],
    [/\bauthorization\b|\bpermission\b|\bsandbox\b|\baudit\b/, ["授权", "权限", "沙箱", "审计"]],
    [/\bworkflow\b|\bruntime\b/, ["工作流", "运行时"]],
    [/\bevaluation\b|\bevaluate\b|\bfaithfulness\b/, ["评估", "忠实度"]],
    [/\bvector\b|\bbm25\b|\bsparse\b|\bbackend\b/, ["向量", "bm25", "稀疏", "后端"]]
  ];
  for (const [pattern, synonyms] of synonymTerms) {
    if (pattern.test(normalized)) {
      for (const synonym of synonyms) {
        terms.add(synonym);
      }
    }
  }
  if (normalized.includes("工程") && normalized.includes("rag")) {
    terms.add("生产级");
  }
  for (const term of domainTerms) {
    if (normalized.includes(term) && !stopwords.has(term)) {
      terms.add(term);
    }
  }
  return [...terms].slice(0, 16);
}

type ReviewableObjectType = "fact" | "entity" | "relation" | "document" | "section" | "evidence" | "synthesized_knowledge";

function resolveKnowledgeTable(objectType: ReviewableObjectType): string {
  switch (objectType) {
    case "fact":
      return "kp_fact";
    case "entity":
      return "kp_entity";
    case "relation":
      return "kp_relation";
    case "document":
      return "kp_document";
    case "section":
      return "kp_section";
    case "evidence":
      return "kp_evidence";
    case "synthesized_knowledge":
      return "kp_synthesized_knowledge";
    default:
      throw new Error(`unsupported knowledge object type: ${String(objectType)}`);
  }
}

export async function createKnowledgeGovernanceJob(input: {
  tenantId: string;
  scope: string;
  jobType: string;
  triggerType: string;
  triggerRef?: string | null;
  targetObjectType?: string | null;
  targetObjectIds?: string[];
  priority?: number;
  requestedBy?: string | null;
  payload?: Record<string, unknown>;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO kp_governance_job (
      tenant_id, scope, status, version, job_type, trigger_type, trigger_ref,
      target_object_type, target_object_ids, priority, run_status, requested_by, payload, trace_id
    )
    VALUES (
      $1, $2, 'recorded', 1, $3, $4, $5,
      $6, $7::jsonb, $8, 'pending', $9, $10::jsonb, $11
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.jobType,
      input.triggerType,
      input.triggerRef ?? null,
      input.targetObjectType ?? null,
      toJsonArray(input.targetObjectIds ?? []),
      input.priority ?? 50,
      input.requestedBy ?? null,
      toJson(input.payload),
      input.traceId
    ]
  );
  return result.rows[0].id;
}

export async function markKnowledgeGovernanceJobRunning(input: {
  jobId: string;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `
    UPDATE kp_governance_job
    SET run_status = 'running',
        started_at = COALESCE(started_at, now()),
        updated_at = now()
    WHERE id = $1
    `,
    [input.jobId]
  );
}

export async function finalizeKnowledgeGovernanceJob(input: {
  jobId: string;
  runStatus: "completed" | "failed" | "blocked";
  resultPayload?: Record<string, unknown>;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `
    UPDATE kp_governance_job
    SET run_status = $2,
        finished_at = now(),
        result_payload = $3::jsonb,
        updated_at = now()
    WHERE id = $1
    `,
    [input.jobId, input.runStatus, toJson(input.resultPayload)]
  );
}

export async function getKnowledgeGovernanceJobById(input: {
  jobId: string;
  tenantId: string;
  scope: string;
}): Promise<Record<string, unknown> | null> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM kp_governance_job
    WHERE id = $1
      AND tenant_id = $2
      AND scope = $3
    `,
    [input.jobId, input.tenantId, input.scope]
  );
  return result.rows[0] ?? null;
}

export async function createGovernanceDecision(input: {
  tenantId: string;
  scope: string;
  governanceJobId: string;
  governanceType: string;
  targetObjectType: string;
  targetObjectId?: string | null;
  decision: string;
  confidenceScore?: number;
  riskLevel?: string;
  evidenceRefs?: unknown[];
  reason: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  modelName?: string;
  promptVersion?: string;
  rulesetVersion?: string;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO kp_governance_decision (
      tenant_id, scope, status, version, governance_job_id, governance_type,
      target_object_type, target_object_id, decision, confidence_score, risk_level,
      evidence_refs, reason, before_state, after_state, model_name, prompt_version,
      ruleset_version, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, $3, $4,
      $5, $6, $7, $8, $9::risk_level,
      $10::jsonb, $11, $12::jsonb, $13::jsonb, $14, $15,
      $16, $17
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.governanceJobId,
      input.governanceType,
      input.targetObjectType,
      input.targetObjectId ?? null,
      input.decision,
      input.confidenceScore ?? 0.75,
      input.riskLevel ?? "low",
      toJsonArray(input.evidenceRefs ?? []),
      input.reason,
      toJson(input.beforeState),
      toJson(input.afterState),
      input.modelName ?? "rules-v1",
      input.promptVersion ?? "n/a",
      input.rulesetVersion ?? "governance-rules-v1",
      input.traceId
    ]
  );
  return result.rows[0].id;
}

export async function createGovernanceCleaningLog(input: {
  tenantId: string;
  scope: string;
  governanceJobId: string;
  documentId: string;
  cleaningType: string;
  beforeHash?: string | null;
  afterHash?: string | null;
  removedSectionsSummary?: unknown[];
  removedLineCount?: number;
  keptLineCount?: number;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO kp_governance_cleaning_log (
      tenant_id, scope, status, version, governance_job_id, document_id,
      cleaning_type, before_hash, after_hash, removed_sections_summary,
      removed_line_count, kept_line_count, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, $3, $4,
      $5, $6, $7, $8::jsonb,
      $9, $10, $11
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.governanceJobId,
      input.documentId,
      input.cleaningType,
      input.beforeHash ?? null,
      input.afterHash ?? null,
      toJsonArray(input.removedSectionsSummary ?? []),
      input.removedLineCount ?? 0,
      input.keptLineCount ?? 0,
      input.traceId
    ]
  );
  return result.rows[0].id;
}

export async function listGovernableMemoryCandidates(input: {
  tenantId: string;
  scope: string;
  candidateIds?: string[];
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT mc.*
    FROM memory_candidate mc
    WHERE mc.tenant_id = $1
      AND mc.scope = $2
      AND mc.verification_status IN ('verified', 'verified_fix')
      AND ($3::uuid[] IS NULL OR mc.id = ANY($3::uuid[]))
      AND NOT EXISTS (
        SELECT 1
        FROM kp_candidate_link kcl
        WHERE kcl.candidate_id = mc.id
      )
    ORDER BY mc.created_at ASC
    LIMIT $4
    `,
    [input.tenantId, input.scope, input.candidateIds?.length ? input.candidateIds : null, input.limit ?? 50]
  );
  return result.rows;
}

export async function listGovernableKnowledgeDocuments(input: {
  tenantId: string;
  scope: string;
  documentIds?: string[];
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT d.*
    FROM kp_document d
    WHERE d.tenant_id = $1
      AND d.scope = $2
      AND d.status = 'active'
      AND d.lifecycle_state NOT IN ('archived', 'quarantined', 'superseded', 'merged', 'rejected')
      AND ($3::uuid[] IS NULL OR d.id = ANY($3::uuid[]))
    ORDER BY d.updated_at DESC
    LIMIT $4
    `,
    [input.tenantId, input.scope, input.documentIds?.length ? input.documentIds : null, input.limit ?? 50]
  );
  return result.rows;
}

export async function updateKnowledgeDocumentMarkdownGovernance(input: {
  tenantId: string;
  scope: string;
  documentId: string;
  markdownContent?: string | null;
  markdownContentHash?: string | null;
  lifecycleState?: string | null;
  reviewState?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `
    UPDATE kp_document
    SET markdown_content = COALESCE($4, markdown_content),
        markdown_content_hash = COALESCE($5, markdown_content_hash),
        lifecycle_state = COALESCE($6, lifecycle_state),
        review_state = COALESCE($7, review_state),
        metadata = metadata || $8::jsonb,
        updated_at = now()
    WHERE tenant_id = $1
      AND scope = $2
      AND id = $3::uuid
    `,
    [
      input.tenantId,
      input.scope,
      input.documentId,
      input.markdownContent ?? null,
      input.markdownContentHash ?? null,
      input.lifecycleState ?? null,
      input.reviewState ?? null,
      toJson(input.metadata)
    ]
  );
}

export async function createKnowledgeEvidence(input: {
  tenantId: string;
  scope: string;
  memoryDomain: string;
  evidenceType: string;
  sourceType: string;
  sourceUri: string;
  rawRef?: string | null;
  contentExcerpt?: string | null;
  contentHash?: string | null;
  trustLevel?: string;
  capturedAt?: string | null;
  metadata?: Record<string, unknown>;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const existing = await pool.query<{ id: string }>(
    `
    SELECT id
    FROM kp_evidence
    WHERE tenant_id = $1
      AND scope = $2
      AND source_uri = $3
      AND COALESCE(raw_ref, '') = COALESCE($4, '')
      AND COALESCE(content_hash, '') = COALESCE($5, '')
    LIMIT 1
    `,
    [input.tenantId, input.scope, input.sourceUri, input.rawRef ?? null, input.contentHash ?? null]
  );
  if (existing.rowCount && existing.rows[0]) {
    return existing.rows[0].id;
  }

  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO kp_evidence (
      tenant_id, scope, status, version, memory_domain, object_type, lifecycle_state, review_state,
      evidence_type, source_type, source_uri, raw_ref, content_excerpt, content_hash, trust_level,
      captured_at, metadata, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, $3, 'evidence', 'candidate', 'unreviewed',
      $4, $5, $6, $7, $8, $9, $10,
      $11, $12::jsonb, $13
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.memoryDomain,
      input.evidenceType,
      input.sourceType,
      input.sourceUri,
      input.rawRef ?? null,
      input.contentExcerpt ?? null,
      input.contentHash ?? null,
      input.trustLevel ?? "internal_verified",
      input.capturedAt ?? null,
      toJson(input.metadata),
      input.traceId
    ]
  );
  return result.rows[0].id;
}

export async function createOrResolveKnowledgeDocument(input: {
  tenantId: string;
  scope: string;
  memoryDomain: string;
  title: string;
  sourceType: string;
  sourceUri: string;
  sourceHash?: string | null;
  markdownContent?: string | null;
  markdownContentHash?: string | null;
  markdownContentRef?: string | null;
  markdownConverter?: string | null;
  author?: string | null;
  language?: string | null;
  metadata?: Record<string, unknown>;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const existing = await pool.query<{ id: string }>(
    `
    SELECT id
    FROM kp_document
    WHERE tenant_id = $1
      AND scope = $2
      AND source_uri = $3
      AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT 1
    `,
    [input.tenantId, input.scope, input.sourceUri]
  );
  if (existing.rowCount && existing.rows[0]) {
    await pool.query(
      `
      UPDATE kp_document
      SET title = $2,
          source_hash = COALESCE($3, source_hash),
          markdown_content = COALESCE($4, markdown_content),
          markdown_content_hash = COALESCE($5, markdown_content_hash),
          markdown_content_ref = COALESCE($6, markdown_content_ref),
          markdown_converter = COALESCE($7, markdown_converter),
          markdown_converted_at = CASE WHEN $4::text IS NULL THEN markdown_converted_at ELSE now() END,
          metadata = metadata || $8::jsonb,
          updated_at = now()
      WHERE id = $1
      `,
      [
        existing.rows[0].id,
        input.title,
        input.sourceHash ?? null,
        input.markdownContent ?? null,
        input.markdownContentHash ?? null,
        input.markdownContentRef ?? null,
        input.markdownConverter ?? null,
        toJson(input.metadata)
      ]
    );
    return existing.rows[0].id;
  }

  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO kp_document (
      tenant_id, scope, status, version, memory_domain, object_type, lifecycle_state, review_state,
      title, source_type, source_uri, source_hash, markdown_content, markdown_content_hash,
      markdown_content_ref, markdown_converted_at, markdown_converter, author, language,
      captured_at, metadata, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, $3, 'document', 'curated', 'auto_accepted',
      $4, $5, $6, $7, $8, $9,
      $10, CASE WHEN $8::text IS NULL THEN NULL ELSE now() END, $11, $12, $13,
      now(), $14::jsonb, $15
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.memoryDomain,
      input.title,
      input.sourceType,
      input.sourceUri,
      input.sourceHash ?? null,
      input.markdownContent ?? null,
      input.markdownContentHash ?? null,
      input.markdownContentRef ?? null,
      input.markdownConverter ?? null,
      input.author ?? null,
      input.language ?? "en",
      toJson(input.metadata),
      input.traceId
    ]
  );
  return result.rows[0].id;
}

export async function updateKnowledgeDocumentReviewState(input: {
  tenantId: string;
  scope: string;
  documentId: string;
  lifecycleState: string;
  reviewState: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `
    UPDATE kp_document
    SET lifecycle_state = $4,
        review_state = $5,
        metadata = metadata || $6::jsonb,
        updated_at = now()
    WHERE tenant_id = $1
      AND scope = $2
      AND id = $3::uuid
    `,
    [input.tenantId, input.scope, input.documentId, input.lifecycleState, input.reviewState, toJson(input.metadata)]
  );
}

export async function updateSynthesizedKnowledgeRecord(input: {
  tenantId: string;
  scope: string;
  knowledgeId: string;
  patch: Record<string, unknown>;
  traceId: string;
}): Promise<Record<string, unknown> | null> {
  const pool = getPool();
  const allowed = [
    "title", "content", "normalized_content", "knowledge_type",
    "confidence_score", "risk_level", "lifecycle_state",
    "review_state", "recall_state", "reasoning_summary",
    "source_object_ids", "evidence_ids", "metadata"
  ];
  const sets: string[] = [];
  const vals: unknown[] = [input.knowledgeId, input.tenantId, input.scope];
  let idx = 4;
  for (const key of allowed) {
    if (key in input.patch) {
      const val = input.patch[key];
      if (key === "source_object_ids" || key === "evidence_ids" || key === "metadata") {
        sets.push(`${key} = $${idx}::jsonb`);
        vals.push(JSON.stringify(val ?? {}));
      } else if (key === "risk_level") {
        sets.push(`${key} = $${idx}::risk_level`);
        vals.push(val);
      } else {
        sets.push(`${key} = $${idx}`);
        vals.push(val);
      }
      idx++;
    }
  }
  if (sets.length === 0) return null;
  sets.push(`updated_at = now()`);
  const result = await pool.query(
    `UPDATE kp_synthesized_knowledge SET ${sets.join(", ")} WHERE id = $1::uuid AND tenant_id = $2 AND scope = $3 RETURNING *`,
    vals
  );
  return result.rows[0] ?? null;
}

export async function createOrResolveKnowledgeSection(input: {
  documentId: string;
  tenantId: string;
  scope: string;
  memoryDomain: string;
  sectionKey: string;
  ordinal?: number;
  title?: string | null;
  summary?: string | null;
  content: string;
  contentHash?: string | null;
  metadata?: Record<string, unknown>;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const existing = await pool.query<{ id: string }>(
    `
    SELECT id
    FROM kp_section
    WHERE document_id = $1
      AND section_key = $2
    LIMIT 1
    `,
    [input.documentId, input.sectionKey]
  );
  if (existing.rowCount && existing.rows[0]) {
    await pool.query(
      `
      UPDATE kp_section
      SET title = COALESCE($2, title),
          summary = COALESCE($3, summary),
          content = $4,
          content_hash = $5,
          token_count = $6,
          metadata = metadata || $7::jsonb,
          updated_at = now()
      WHERE id = $1
      `,
      [
        existing.rows[0].id,
        input.title ?? null,
        input.summary ?? null,
        input.content,
        input.contentHash ?? null,
        estimateTokenCount(input.content),
        toJson(input.metadata)
      ]
    );
    return existing.rows[0].id;
  }

  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO kp_section (
      document_id, tenant_id, scope, status, version, memory_domain, object_type, lifecycle_state, review_state,
      heading_path, section_key, ordinal, title, summary, content, content_hash, token_count, metadata, trace_id
    )
    VALUES (
      $1, $2, $3, 'active', 1, $4, 'section', 'curated', 'auto_accepted',
      ARRAY[]::text[], $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13
    )
    RETURNING id
    `,
    [
      input.documentId,
      input.tenantId,
      input.scope,
      input.memoryDomain,
      input.sectionKey,
      input.ordinal ?? 0,
      input.title ?? null,
      input.summary ?? null,
      input.content,
      input.contentHash ?? null,
      estimateTokenCount(input.content),
      toJson(input.metadata),
      input.traceId
    ]
  );
  return result.rows[0].id;
}

export async function createOrResolveKnowledgeEntity(input: {
  tenantId: string;
  scope: string;
  memoryDomain: string;
  entityType: string;
  canonicalName: string;
  aliases?: string[];
  summary?: string | null;
  metadata?: Record<string, unknown>;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const slug = input.canonicalName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "entity";
  // 实体决议只看 slug：同一 slug 不管被标成 framework / technology / tech_term，
  // 都认为是同一个实体，resolve 到首次写入的节点，entity_type 不覆盖（保留首次分类）。
  // 否则 LLM 返回 entity_type=technology 和 candidateProvenance 返回 entity_type=framework
  // 会把同一个 React 分裂成两个节点（这正是"React/React 18/react 18 是三个独立节点"的根因）。
  const existing = await pool.query<{ id: string }>(
    `
    SELECT id
    FROM kp_entity
    WHERE tenant_id = $1
      AND scope = $2
      AND slug = $3
    LIMIT 1
    `,
    [input.tenantId, input.scope, slug]
  );
  if (existing.rowCount && existing.rows[0]) {
    await pool.query(
      `
      UPDATE kp_entity
      SET aliases = (
            SELECT ARRAY(
              SELECT DISTINCT alias
              FROM unnest(array_cat(aliases, $2::text[])) AS alias
              WHERE alias IS NOT NULL AND alias <> ''
            )
          ),
          summary = COALESCE($3, summary),
          metadata = metadata || $4::jsonb,
          last_verified_at = now(),
          updated_at = now()
      WHERE id = $1
      `,
      [existing.rows[0].id, input.aliases ?? [], input.summary ?? null, toJson(input.metadata)]
    );
    return existing.rows[0].id;
  }

  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO kp_entity (
      tenant_id, scope, status, version, memory_domain, object_type, lifecycle_state, review_state,
      entity_type, canonical_name, aliases, slug, summary, last_verified_at, metadata, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, $3, 'entity', 'curated', 'auto_accepted',
      $4, $5, $6::text[], $7, $8, now(), $9::jsonb, $10
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.memoryDomain,
      input.entityType,
      input.canonicalName,
      input.aliases ?? [],
      slug,
      input.summary ?? null,
      toJson(input.metadata),
      input.traceId
    ]
  );
  return result.rows[0].id;
}

export async function createKnowledgeFact(input: {
  tenantId: string;
  scope: string;
  memoryDomain: string;
  factKind: string;
  factSubtype?: string | null;
  title: string;
  statement: string;
  normalizedStatement: string;
  verificationStatus: string;
  confidenceScore?: number;
  importance?: number;
  metadata?: Record<string, unknown>;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO kp_fact (
      tenant_id, scope, status, version, memory_domain, object_type, lifecycle_state, review_state,
      fact_kind, fact_subtype, title, statement, normalized_statement, confidence_score,
      importance, verification_status, last_verified_at, metadata, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, $3, 'fact', 'curated', 'auto_accepted',
      $4, $5, $6, $7, $8, $9,
      $10, $11, now(), $12::jsonb, $13
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.memoryDomain,
      input.factKind,
      input.factSubtype ?? null,
      input.title,
      input.statement,
      input.normalizedStatement,
      input.confidenceScore ?? 0.75,
      input.importance ?? 50,
      input.verificationStatus,
      toJson(input.metadata),
      input.traceId
    ]
  );
  return result.rows[0].id;
}

export async function createKnowledgeRelation(input: {
  tenantId: string;
  scope: string;
  memoryDomain: string;
  relationType: string;
  fromObjectType: string;
  fromObjectId: string;
  toObjectType: string;
  toObjectId: string;
  statement?: string | null;
  confidenceScore?: number;
  metadata?: Record<string, unknown>;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const existing = await pool.query<{ id: string }>(
    `
    SELECT id
    FROM kp_relation
    WHERE tenant_id = $1
      AND scope = $2
      AND relation_type = $3
      AND from_object_type = $4
      AND from_object_id = $5
      AND to_object_type = $6
      AND to_object_id = $7
    LIMIT 1
    `,
    [input.tenantId, input.scope, input.relationType, input.fromObjectType, input.fromObjectId, input.toObjectType, input.toObjectId]
  );
  if (existing.rowCount && existing.rows[0]) {
    return existing.rows[0].id;
  }

  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO kp_relation (
      tenant_id, scope, status, version, memory_domain, object_type, lifecycle_state, review_state,
      relation_type, from_object_type, from_object_id, to_object_type, to_object_id, statement,
      confidence_score, last_verified_at, metadata, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, $3, 'relation', 'curated', 'auto_accepted',
      $4, $5, $6, $7, $8, $9,
      $10, now(), $11::jsonb, $12
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.memoryDomain,
      input.relationType,
      input.fromObjectType,
      input.fromObjectId,
      input.toObjectType,
      input.toObjectId,
      input.statement ?? null,
      input.confidenceScore ?? 0.75,
      toJson(input.metadata),
      input.traceId
    ]
  );
  return result.rows[0].id;
}

export async function createKnowledgeCandidateLink(input: {
  tenantId: string;
  scope: string;
  candidateId: string;
  targetObjectType: string;
  targetObjectId: string;
  linkRole: string;
  metadata?: Record<string, unknown>;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const existing = await pool.query<{ id: string }>(
    `
    SELECT id
    FROM kp_candidate_link
    WHERE candidate_id = $1
      AND target_object_type = $2
      AND target_object_id = $3
      AND link_role = $4
    LIMIT 1
    `,
    [input.candidateId, input.targetObjectType, input.targetObjectId, input.linkRole]
  );
  if (existing.rowCount && existing.rows[0]) {
    return existing.rows[0].id;
  }

  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO kp_candidate_link (
      tenant_id, scope, status, version, candidate_id, target_object_type, target_object_id,
      link_role, metadata, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, $3, $4, $5,
      $6, $7::jsonb, $8
    )
    RETURNING id
    `,
    [input.tenantId, input.scope, input.candidateId, input.targetObjectType, input.targetObjectId, input.linkRole, toJson(input.metadata), input.traceId]
  );
  return result.rows[0].id;
}

export async function createSynthesizedKnowledge(input: {
  tenantId: string;
  scope: string;
  memoryDomain?: string;
  knowledgeType: string;
  title: string;
  content: string;
  normalizedContent: string;
  lifecycleState?: string;
  reviewState?: string;
  recallState?: string;
  sourceObjectIds?: unknown[];
  evidenceIds?: unknown[];
  reasoningSummary: string;
  confidenceScore?: number;
  riskLevel?: string;
  governanceJobId?: string | null;
  metadata?: Record<string, unknown>;
  originScope?: string;
  availabilityScope?: string;
  traceId: string;
}): Promise<{ id: string; existed: boolean }> {
  const pool = getPool();
  const existing = await pool.query<{ id: string }>(
    `
    SELECT id
    FROM kp_synthesized_knowledge
    WHERE tenant_id = $1
      AND scope = $2
      AND knowledge_type = $3
      AND normalized_content = $4
    LIMIT 1
    `,
    [input.tenantId, input.scope, input.knowledgeType, input.normalizedContent]
  );
  if (existing.rowCount && existing.rows[0]) {
    await pool.query(
      `
      UPDATE kp_synthesized_knowledge
      SET title = $2,
          content = $3,
          normalized_content = $4,
          source_object_ids = $5::jsonb,
          evidence_ids = $6::jsonb,
          reasoning_summary = $7,
          confidence_score = $8,
          risk_level = $9::risk_level,
          lifecycle_state = $10,
          review_state = $11,
          recall_state = $12,
          metadata = metadata || $13::jsonb,
          governance_job_id = COALESCE($14, governance_job_id),
          updated_at = now()
      WHERE id = $1
      `,
      [
        existing.rows[0].id,
        input.title,
        input.content,
        input.normalizedContent,
        toJsonArray(input.sourceObjectIds ?? []),
        toJsonArray(input.evidenceIds ?? []),
        input.reasoningSummary,
        input.confidenceScore ?? 0.82,
        input.riskLevel ?? "low",
        input.lifecycleState ?? "curated",
        input.reviewState ?? "model_accepted",
        input.recallState ?? "active",
        toJson(input.metadata),
        input.governanceJobId ?? null
      ]
    );
    return { id: existing.rows[0].id, existed: true };
  }

  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO kp_synthesized_knowledge (
      tenant_id, scope, status, version, memory_domain, lifecycle_state, review_state,
      recall_state, knowledge_type, title, content, normalized_content, source_object_ids,
      evidence_ids, reasoning_summary, confidence_score, risk_level, governance_job_id,
      metadata, trace_id, origin_scope, availability_scope
    )
    VALUES (
      $1, $2, 'active', 1, $3, $4, $5,
      $6, $7, $8, $9, $10, $11::jsonb,
      $12::jsonb, $13, $14, $15::risk_level, $16,
      $17::jsonb, $18, $19, $20
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.memoryDomain ?? "knowledge",
      input.lifecycleState ?? "curated",
      input.reviewState ?? "model_accepted",
      input.recallState ?? "active",
      input.knowledgeType,
      input.title,
      input.content,
      input.normalizedContent,
      toJsonArray(input.sourceObjectIds ?? []),
      toJsonArray(input.evidenceIds ?? []),
      input.reasoningSummary,
      input.confidenceScore ?? 0.82,
      input.riskLevel ?? "low",
      input.governanceJobId ?? null,
      toJson(input.metadata),
      input.traceId,
      input.originScope ?? "project",
      input.availabilityScope ?? "project_reusable"
    ]
  );
  return { id: result.rows[0].id, existed: false };
}

export async function linkSynthesizedKnowledgeEvidence(input: {
  tenantId: string;
  scope: string;
  synthesizedKnowledgeId: string;
  evidenceId: string;
  sourceObjectType: string;
  sourceObjectId: string;
  supportRole?: string;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const existing = await pool.query<{ id: string }>(
    `
    SELECT id
    FROM kp_synthesized_knowledge_evidence
    WHERE synthesized_knowledge_id = $1
      AND evidence_id = $2
      AND source_object_type = $3
      AND source_object_id = $4
    LIMIT 1
    `,
    [input.synthesizedKnowledgeId, input.evidenceId, input.sourceObjectType, input.sourceObjectId]
  );
  if (existing.rowCount && existing.rows[0]) {
    return existing.rows[0].id;
  }

  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO kp_synthesized_knowledge_evidence (
      tenant_id, scope, status, synthesized_knowledge_id, evidence_id,
      source_object_type, source_object_id, support_role, trace_id
    )
    VALUES (
      $1, $2, 'active', $3, $4,
      $5, $6, $7, $8
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.synthesizedKnowledgeId,
      input.evidenceId,
      input.sourceObjectType,
      input.sourceObjectId,
      input.supportRole ?? "supports",
      input.traceId
    ]
  );
  return result.rows[0].id;
}

/**
 * evidence 跨层关联：建立 evidence → rule/skill/memory/synthesis 的关联
 *
 * 与 linkSynthesizedKnowledgeEvidence 的区别：
 * 后者只关联 synthesized_knowledge ↔ evidence（表名写死了）；
 * 本函数通过 evidence_links 表支持 evidence 关联到任意层，link_type 区分语义。
 *
 * L1 candidateIngress 写入 rule/skill/memory 时调本函数建 source_of 关联，
 * 让图谱能展示"这条规则从哪轮对话的哪句话抽取的"。
 */
export async function createEvidenceLink(input: {
  tenantId: string;
  scope: string;
  evidenceId: string;
  targetId: string;
  targetLayer: "rule" | "skill" | "memory" | "knowledge" | "synthesis";
  linkType: "supports" | "explains" | "source_of" | "contradicts";
  confidence?: number;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const existing = await pool.query<{ id: string }>(
    `
    SELECT id
    FROM evidence_links
    WHERE tenant_id = $1
      AND scope = $2
      AND evidence_id = $3
      AND target_id = $4
      AND target_layer = $5
      AND link_type = $6
      AND status = 'active'
    LIMIT 1
    `,
    [input.tenantId, input.scope, input.evidenceId, input.targetId, input.targetLayer, input.linkType]
  );
  if (existing.rowCount && existing.rows[0]) {
    return existing.rows[0].id;
  }

  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO evidence_links (
      tenant_id, scope, status, evidence_id, target_id, target_layer, link_type, confidence, trace_id
    )
    VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $8)
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.evidenceId,
      input.targetId,
      input.targetLayer,
      input.linkType,
      input.confidence ?? 1.0,
      input.traceId
    ]
  );
  return result.rows[0].id;
}

/**
 * 查询某个 target（rule/skill/memory）的所有 evidence 关联
 * 用于图谱展示"这条规则从哪轮对话的哪句话抽取的"
 */
export async function queryEvidenceLinksByTarget(input: {
  tenantId: string;
  scope: string;
  targetId: string;
  targetLayer?: "rule" | "skill" | "memory" | "knowledge" | "synthesis";
  linkType?: "supports" | "explains" | "source_of" | "contradicts";
}): Promise<Array<{
  id: string;
  evidenceId: string;
  targetLayer: string;
  linkType: string;
  confidence: number;
  evidenceContentExcerpt: string | null;
  evidenceSourceUri: string;
  evidenceSourceType: string;
  evidenceType: string;
}>> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT el.id,
           el.evidence_id AS "evidenceId",
           el.target_layer AS "targetLayer",
           el.link_type AS "linkType",
           el.confidence,
           e.content_excerpt AS "evidenceContentExcerpt",
           e.source_uri AS "evidenceSourceUri",
           e.source_type AS "evidenceSourceType",
           e.evidence_type AS "evidenceType"
    FROM evidence_links el
    JOIN kp_evidence e ON e.id = el.evidence_id
    WHERE el.tenant_id = $1
      AND el.scope = $2
      AND el.target_id = $3
      AND el.status = 'active'
      ${input.targetLayer ? "AND el.target_layer = $4" : ""}
      ${input.linkType ? `AND el.link_type = $${input.targetLayer ? 5 : 4}` : ""}
    ORDER BY el.created_at DESC
    `,
    input.targetLayer || input.linkType
      ? [input.tenantId, input.scope, input.targetId, input.targetLayer, input.linkType].filter((x): x is string => Boolean(x))
      : [input.tenantId, input.scope, input.targetId]
  );
  return result.rows as Array<{
    id: string;
    evidenceId: string;
    targetLayer: string;
    linkType: string;
    confidence: number;
    evidenceContentExcerpt: string | null;
    evidenceSourceUri: string;
    evidenceSourceType: string;
    evidenceType: string;
  }>;
}

// ============ Outcome Tracker（P1-2）============
// 记录每次对话的 outcome + 这次 retrieve 用了哪些知识条目
// 这是"越用越聪明"的分水岭：从"只写不读反馈"到"知道知识有没有帮上忙"

export async function recordSessionOutcome(input: {
  tenantId: string;
  scope: string;
  sessionId: string;
  roundNumber?: number;
  taskDescription?: string;
  retrievedIds?: string[];
  usedIds?: string[];
  outcome: "success" | "failure" | "failure_recovered" | "knowledge_outdated" | "abandoned";
  toolSuccess?: boolean;
  failureReason?: string;
  scenarioType?: string;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO session_outcomes (
      tenant_id, scope, status, session_id, round_number, task_description,
      retrieved_ids, used_ids, outcome, tool_success, failure_reason,
      scenario_type, trace_id
    )
    VALUES (
      $1, $2, 'active', $3, $4, $5,
      $6::uuid[], $7::uuid[], $8, $9, $10,
      $11, $12
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.sessionId,
      input.roundNumber ?? null,
      input.taskDescription ?? null,
      input.retrievedIds ?? [],
      input.usedIds ?? [],
      input.outcome,
      input.toolSuccess ?? null,
      input.failureReason ?? null,
      input.scenarioType ?? null,
      input.traceId
    ]
  );
  return result.rows[0].id;
}

// 查询某条知识的 utility_score（成功率）
// 从 knowledge_utility 视图聚合，NULL 表示从未被用到（无信号）
export async function getKnowledgeUtility(input: {
  tenantId: string;
  scope: string;
  entryIds: string[];
}): Promise<Map<string, { utilityScore: number | null; totalRecalls: number; successCount: number; failureCount: number; outdatedCount: number }>> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT ku.entry_id::text AS entry_id,
           ku.total_recalls,
           ku.success_count,
           ku.failure_count,
           ku.outdated_count,
           ku.utility_score
    FROM knowledge_utility ku
    WHERE ku.entry_id::text = ANY($1::text[])
    `,
    [input.entryIds]
  );
  const map = new Map();
  for (const row of result.rows) {
    map.set(String(row.entry_id), {
      utilityScore: row.utility_score,
      totalRecalls: row.total_recalls,
      successCount: row.success_count,
      failureCount: row.failure_count,
      outdatedCount: row.outdated_count
    });
  }
  return map;
}

export async function upsertRecallSurfaceState(input: {
  tenantId: string;
  scope: string;
  objectType: string;
  objectId: string;
  recallState: string;
  contextAssemblyState: string;
  governanceJobId?: string | null;
  reason: string;
  metadata?: Record<string, unknown>;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO kp_recall_surface_state (
      tenant_id, scope, status, version, object_type, object_id, recall_state,
      context_assembly_state, governance_job_id, reason, metadata, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, $3, $4, $5,
      $6, $7, $8, $9::jsonb, $10
    )
    ON CONFLICT (tenant_id, scope, object_type, object_id) DO UPDATE
    SET recall_state = EXCLUDED.recall_state,
        context_assembly_state = EXCLUDED.context_assembly_state,
        governance_job_id = EXCLUDED.governance_job_id,
        reason = EXCLUDED.reason,
        metadata = kp_recall_surface_state.metadata || EXCLUDED.metadata,
        trace_id = EXCLUDED.trace_id,
        updated_at = now()
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.objectType,
      input.objectId,
      input.recallState,
      input.contextAssemblyState,
      input.governanceJobId ?? null,
      input.reason,
      toJson(input.metadata),
      input.traceId
    ]
  );
  return result.rows[0].id;
}

export async function createKnowledgeReviewQueueItem(input: {
  tenantId: string;
  scope: string;
  targetObjectType: ReviewableObjectType;
  targetObjectId: string;
  reviewReason: string;
  priority?: number;
  payload?: Record<string, unknown>;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO kp_review_queue (
      tenant_id, scope, status, version, target_object_type, target_object_id,
      review_reason, priority, payload, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, $3, $4,
      $5, $6, $7::jsonb, $8
    )
    RETURNING id
    `,
    [input.tenantId, input.scope, input.targetObjectType, input.targetObjectId, input.reviewReason, input.priority ?? 50, toJson(input.payload), input.traceId]
  );
  return result.rows[0].id;
}

export async function queryKnowledgeReviewQueue(input: {
  tenantId: string;
  scope: string;
  status?: string | null;
  reviewReason?: string | null;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM kp_review_queue
    WHERE tenant_id = $1
      AND scope = $2
      AND ($3::text IS NULL OR status = $3::record_status)
      AND ($4::text IS NULL OR review_reason = $4)
    ORDER BY priority DESC, created_at ASC
    LIMIT $5
    `,
    [input.tenantId, input.scope, input.status ?? null, input.reviewReason ?? null, input.limit ?? 50]
  );
  return result.rows;
}

export async function getKnowledgeReviewQueueItem(input: {
  tenantId: string;
  scope: string;
  reviewQueueId: string;
}): Promise<Record<string, unknown> | null> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM kp_review_queue
    WHERE id = $1
      AND tenant_id = $2
      AND scope = $3
    `,
    [input.reviewQueueId, input.tenantId, input.scope]
  );
  return result.rows[0] ?? null;
}

export async function applyKnowledgeReviewAction(input: {
  tenantId: string;
  scope: string;
  reviewQueueId: string;
  action: string;
  resolutionPayload?: Record<string, unknown>;
  traceId: string;
}): Promise<void> {
  const pool = getPool();
  const existing = await getKnowledgeReviewQueueItem({
    tenantId: input.tenantId,
    scope: input.scope,
    reviewQueueId: input.reviewQueueId
  });
  if (!existing) {
    throw new Error(`review queue item not found: ${input.reviewQueueId}`);
  }

  const targetObjectType = String(existing.target_object_type) as ReviewableObjectType;
  const targetObjectId = String(existing.target_object_id);
  const targetTable = resolveKnowledgeTable(targetObjectType);

  let reviewState = "human_approved";
  let lifecycleState: string | null = null;
  let status: string | null = null;
  let setRejectedAt = false;

  switch (input.action) {
    case "approve":
      reviewState = "human_approved";
      lifecycleState = "curated";
      break;
    case "reject":
      // 统一用 'rejected'，与 L4 loadRejectedHypothesisCombos 查询一致
      reviewState = "rejected";
      lifecycleState = "deprecated";
      setRejectedAt = true;
      break;
    case "deprecate":
      reviewState = "human_approved";
      lifecycleState = "deprecated";
      break;
    case "archive":
      reviewState = "human_approved";
      lifecycleState = "archived";
      status = "retired";
      break;
    case "request_more_evidence":
      reviewState = "conflict_pending";
      lifecycleState = null;
      break;
    default:
      reviewState = "human_approved";
      lifecycleState = null;
      break;
  }

  await pool.query(
    `
    UPDATE ${targetTable}
    SET review_state = $2,
        lifecycle_state = COALESCE($3, lifecycle_state),
        status = COALESCE($4::record_status, status),
        review_at = now(),
        rejected_at = CASE WHEN $5 THEN now() ELSE rejected_at END,
        updated_at = now()
    WHERE id = $1
    `,
    [targetObjectId, reviewState, lifecycleState, status, setRejectedAt]
  );

  await pool.query(
    `
    UPDATE kp_review_queue
    SET status = 'resolved',
        resolution_action = $2,
        resolution_payload = $3::jsonb,
        resolved_at = now(),
        trace_id = $4,
        updated_at = now()
    WHERE id = $1
    `,
    [input.reviewQueueId, input.action, toJson(input.resolutionPayload), input.traceId]
  );
}

export async function createKnowledgeContextBundle(input: {
  tenantId: string;
  scope: string;
  requestRef: string;
  bundleType: string;
  summary?: string | null;
  facts?: unknown[];
  entities?: unknown[];
  relations?: unknown[];
  evidenceRefs?: unknown[];
  sectionRefs?: unknown[];
  warnings?: unknown[];
  assemblyTrace?: Record<string, unknown>;
  traceId: string;
}): Promise<string> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO kp_context_bundle (
      tenant_id, scope, status, version, request_ref, bundle_type, summary, facts,
      entities, relations, evidence_refs, section_refs, warnings, assembly_trace, trace_id
    )
    VALUES (
      $1, $2, 'active', 1, $3, $4, $5, $6::jsonb,
      $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13
    )
    RETURNING id
    `,
    [
      input.tenantId,
      input.scope,
      input.requestRef,
      input.bundleType,
      input.summary ?? null,
      toJsonArray(input.facts ?? []),
      toJsonArray(input.entities ?? []),
      toJsonArray(input.relations ?? []),
      toJsonArray(input.evidenceRefs ?? []),
      toJsonArray(input.sectionRefs ?? []),
      toJsonArray(input.warnings ?? []),
      toJson(input.assemblyTrace),
      input.traceId
    ]
  );
  return result.rows[0].id;
}

export async function getKnowledgeContextBundleById(input: {
  tenantId: string;
  scope: string;
  bundleId: string;
}): Promise<Record<string, unknown> | null> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM kp_context_bundle
    WHERE id = $1
      AND tenant_id = $2
      AND scope = $3
    `,
    [input.bundleId, input.tenantId, input.scope]
  );
  return result.rows[0] ?? null;
}

export async function queryKnowledgeEntities(input: {
  tenantId: string;
  scope: string;
  query?: string | null;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const normalized = input.query?.trim().toLowerCase() ?? null;
  const result = await pool.query(
    `
    SELECT *
    FROM kp_entity
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
      AND lifecycle_state IN ('curated', 'candidate')
      AND (
        $3::text IS NULL
        OR canonical_name ILIKE '%' || $3 || '%'
        OR EXISTS (
          SELECT 1
          FROM unnest(aliases) AS alias
          WHERE alias ILIKE '%' || $3 || '%'
        )
      )
    ORDER BY review_state = 'human_approved' DESC, updated_at DESC
    LIMIT $4
    `,
    [input.tenantId, input.scope, normalized, input.limit ?? 10]
  );
  return result.rows;
}

export async function queryKnowledgeFacts(input: {
  tenantId: string;
  scope: string;
  query?: string | null;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const normalized = input.query?.trim().toLowerCase() ?? null;
  const result = await pool.query(
    `
    SELECT *
    FROM kp_fact
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
      AND lifecycle_state IN ('curated', 'candidate')
      AND (
        $3::text IS NULL
        OR normalized_statement ILIKE '%' || $3 || '%'
        OR title ILIKE '%' || $3 || '%'
      )
    ORDER BY importance DESC, confidence_score DESC, updated_at DESC
    LIMIT $4
    `,
    [input.tenantId, input.scope, normalized, input.limit ?? 10]
  );
  return result.rows;
}

export async function queryKnowledgeRelationsForObjects(input: {
  tenantId: string;
  scope: string;
  objectIds: string[];
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result =
    input.objectIds.length === 0
      ? await pool.query(
          `
          SELECT *
          FROM kp_relation
          WHERE tenant_id = $1
            AND scope = $2
            AND status = 'active'
            AND lifecycle_state IN ('curated', 'candidate')
          ORDER BY confidence_score DESC, updated_at DESC
          LIMIT $3
          `,
          [input.tenantId, input.scope, input.limit ?? 20]
        )
      : await pool.query(
          `
          SELECT *
          FROM kp_relation
          WHERE tenant_id = $1
            AND scope = $2
            AND status = 'active'
            AND lifecycle_state IN ('curated', 'candidate')
            AND (
              from_object_id = ANY($3::uuid[])
              OR to_object_id = ANY($3::uuid[])
            )
          ORDER BY confidence_score DESC, updated_at DESC
          LIMIT $4
          `,
          [input.tenantId, input.scope, input.objectIds, input.limit ?? 20]
        );
  return result.rows;
}

export async function queryKnowledgeEvidenceByIds(input: {
  tenantId: string;
  scope: string;
  evidenceIds: string[];
}): Promise<Record<string, unknown>[]> {
  if (input.evidenceIds.length === 0) {
    return [];
  }
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM kp_evidence
    WHERE tenant_id = $1
      AND scope = $2
      AND id = ANY($3::uuid[])
    `,
    [input.tenantId, input.scope, input.evidenceIds]
  );
  return result.rows;
}

export async function queryActiveDerivedKnowledge(input: {
  tenantId: string;
  scope: string;
  query?: string | null;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const terms = extractLooseSearchTerms(input.query);
  const minMatchCount = terms.length >= 5 ? 3 : terms.length >= 3 ? 2 : 1;
  const result = await pool.query(
    `
    SELECT *,
      CASE
        WHEN $3::text[] IS NULL THEN 0
        ELSE (
          SELECT COUNT(*)
          FROM unnest($3::text[]) AS term
          WHERE title ILIKE '%' || term || '%'
             OR content ILIKE '%' || term || '%'
             OR normalized_content ILIKE '%' || term || '%'
             OR EXISTS (
               SELECT 1
               FROM kp_synthesized_knowledge_evidence ske
               JOIN kp_evidence e
                 ON e.id = ske.evidence_id
                AND e.tenant_id = sk.tenant_id
                AND e.scope = sk.scope
                AND e.status = 'active'
               WHERE ske.tenant_id = sk.tenant_id
                 AND ske.scope = sk.scope
                 AND ske.status = 'active'
                 AND ske.synthesized_knowledge_id = sk.id
                 AND (
                   e.source_uri ILIKE '%' || term || '%'
                   OR e.content_excerpt ILIKE '%' || term || '%'
                 )
             )
        )
      END AS derived_match_count
    FROM kp_synthesized_knowledge sk
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
      AND lifecycle_state = 'curated'
      AND recall_state = 'active'
      AND review_state = 'human_approved'
      AND knowledge_type IN (
        'external_fact',
        'method',
        'pattern',
        'principle',
        'comparison',
        'limitation',
        'trend',
        'synthesis',
        'counterexample'
      )
      AND (
        $3::text[] IS NULL
        OR (
          SELECT COUNT(*)
          FROM unnest($3::text[]) AS term
          WHERE title ILIKE '%' || term || '%'
             OR content ILIKE '%' || term || '%'
             OR normalized_content ILIKE '%' || term || '%'
             OR EXISTS (
               SELECT 1
               FROM kp_synthesized_knowledge_evidence ske
               JOIN kp_evidence e
                 ON e.id = ske.evidence_id
                AND e.tenant_id = sk.tenant_id
                AND e.scope = sk.scope
                AND e.status = 'active'
               WHERE ske.tenant_id = sk.tenant_id
                 AND ske.scope = sk.scope
                 AND ske.status = 'active'
                 AND ske.synthesized_knowledge_id = sk.id
                 AND (
                   e.source_uri ILIKE '%' || term || '%'
                   OR e.content_excerpt ILIKE '%' || term || '%'
                 )
             )
        ) >= $5
      )
    ORDER BY derived_match_count DESC,
             importance_weight DESC NULLS LAST,
             confidence_score DESC,
             updated_at DESC
    LIMIT $4
    `,
    [input.tenantId, input.scope, terms.length > 0 ? terms : null, input.limit ?? 10, minMatchCount]
  );
  return result.rows;
}

// ─── 遗忘机制：更新召回时间戳 ───
// retrieve 召回 synthesized_knowledge 后调用，记录"这条知识上次被用到是什么时候"
// 90 天没召回的会被 archiveStaleSynthesizedKnowledge 归档
export async function updateSynthesizedKnowledgeRecallTimestamp(input: {
  tenantId: string;
  scope: string;
  knowledgeIds: string[];
}): Promise<void> {
  if (input.knowledgeIds.length === 0) return;
  const pool = getPool();
  await pool.query(
    `
    UPDATE kp_synthesized_knowledge
    SET last_recalled_at = now(),
        updated_at = now()
    WHERE tenant_id = $1
      AND scope = $2
      AND id = ANY($3::uuid[])
    `,
    [input.tenantId, input.scope, input.knowledgeIds]
  );
}

// ─── 遗忘机制：归档过期合成知识 ───
// 90 天没被召回的 lifecycle_state='archived'，不再参与 retrieve
// 这是 TTL 归档，不是删除——archived 的知识仍可查可恢复
// 返回归档数量
// fix-8-3 改造：从"90 天 last_recalled_at"改成"importance_weight < 0.2 持续 30 天"
// fix-8-3 归档保护：调用方传 retrieveQualityGate，<0.4 时跳过归档（retrieve 的锅，不是知识的锅）
export async function archiveStaleSynthesizedKnowledge(input: {
  tenantId: string;
  scope: string;
  weightThreshold?: number;       // 默认 0.2
  staleDays?: number;            // 默认 30（importance_weight_updated_at 老化窗口）
  retrieveQualityGate?: number;  // 默认 0.4，同 scope 平均 term_hit_ratio 低于此值时跳过归档
}): Promise<{ archivedCount: number; skippedCount: number; skippedReason: string | null }> {
  const pool = getPool();
  const weightThreshold = input.weightThreshold ?? 0.2;
  const staleDays = input.staleDays ?? 30;
  const qualityGate = input.retrieveQualityGate ?? 0.4;

  // ─── 归档保护：查最近 30 天同 scope 的平均 term_hit_ratio ───
  // 没有数据（null）时默认 retrieve 正常（new scope 冷启动保护）
  const qualityResult = await pool.query(
    `
    SELECT AVG(term_hit_ratio) AS avg_ratio, COUNT(*) AS sample_size
    FROM kp_retrieve_quality_log
    WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
      AND created_at >= now() - '30 days'::interval
    `,
    [input.tenantId, input.scope]
  );
  const qualityRow = qualityResult.rows[0];
  const avgRatio = qualityRow?.avg_ratio ? Number(qualityRow.avg_ratio) : null;
  const sampleSize = qualityRow?.sample_size ? Number(qualityRow.sample_size) : 0;

  // 样本不足 10 条时直接跳过归档（数据底子太薄，不可信）
  if (sampleSize < 10) {
    return { archivedCount: 0, skippedCount: 0, skippedReason: `retrieve_quality_sample_too_small:${sampleSize}` };
  }
  // retrieve 整体 poor 时跳过归档
  if (avgRatio !== null && avgRatio < qualityGate) {
    return { archivedCount: 0, skippedCount: 0, skippedReason: `retrieve_quality_poor:${avgRatio.toFixed(3)}` };
  }

  // ─── 归档候选：importance_weight < threshold AND updated_at 老化 ───
  const result = await pool.query(
    `
    UPDATE kp_synthesized_knowledge
    SET lifecycle_state = 'archived',
        updated_at = now()
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
      AND lifecycle_state = 'curated'
      AND importance_weight < $3
      AND importance_weight_updated_at < now() - ($4 || ' days')::interval
    RETURNING id
    `,
    [input.tenantId, input.scope, weightThreshold, String(staleDays)]
  );
  const archivedCount = result.rowCount ?? 0;
  return { archivedCount, skippedCount: 0, skippedReason: null };
}

// ─── fix-8-3: 重新计算 importance_weight ───
// importance_weight = 0.3×recency + 0.3×frequency + 0.4×utility
// recency = exp(-days_since_last_recall / 30)
// frequency = log(1+recall_count) / log(1+max_recall_count_in_scope)
// utility = knowledge_utility.utility_score ?? 0.5
//
// 数据不足降级：session_outcomes < 300 条时全写 0.5（不惩罚新知识）
// 返回重算的条数
export async function recomputeImportanceWeights(input: {
  tenantId: string;
  scope: string;
  minOutcomeSample?: number;  // 默认 300
}): Promise<{ reweightedCount: number; degraded: boolean; reason: string | null }> {
  const pool = getPool();
  const minSample = input.minOutcomeSample ?? 300;

  // ─── 数据不足降级检查 ───
  const sampleResult = await pool.query(
    `SELECT COUNT(*) AS n FROM session_outcomes WHERE tenant_id = $1 AND scope = $2`,
    [input.tenantId, input.scope]
  );
  const outcomeCount = Number(sampleResult.rows[0]?.n ?? 0);
  if (outcomeCount < minSample) {
    // 降级模式：全写 0.5，避免数据不足导致误判
    await pool.query(
      `UPDATE kp_synthesized_knowledge
       SET importance_weight = 0.5, importance_weight_updated_at = now()
       WHERE tenant_id = $1 AND scope = $2 AND status = 'active' AND lifecycle_state = 'curated'`,
      [input.tenantId, input.scope]
    );
    return { reweightedCount: 0, degraded: true, reason: `session_outcomes_insufficient:${outcomeCount}<${minSample}` };
  }

  // ─── 取 max_recall_count 用于 frequency 归一化 ───
  const maxResult = await pool.query(
    `SELECT COALESCE(MAX(recall_count), 1) AS max_recall
     FROM kp_synthesized_knowledge
     WHERE tenant_id = $1 AND scope = $2 AND status = 'active' AND lifecycle_state = 'curated'`,
    [input.tenantId, input.scope]
  );
  const maxRecall = Number(maxResult.rows[0]?.max_recall ?? 1);

  // ─── fix-9: utility 因子从 retrieve_quality_log 反推 ───
  // 同 scope 最近 30 天平均 term_hit_ratio → scope 级别 utility
  // 粗糙但简单：整个 scope 共用一个 utility 值
  // 后期可改成 per-knowledge utility（join memory_access_log 找该知识被召回的记录）
  const utilityResult = await pool.query(
    `SELECT AVG(term_hit_ratio) AS avg_ratio, COUNT(*) AS sample_n
     FROM kp_retrieve_quality_log
     WHERE tenant_id = $1 AND scope = $2
       AND created_at > now() - interval '30 days'`,
    [input.tenantId, input.scope]
  );
  const avgRatio = utilityResult.rows[0]?.avg_ratio;
  const sampleN = Number(utilityResult.rows[0]?.sample_n ?? 0);
  // 样本不足 10 条时用默认 0.5（冷启动不惩罚）
  const scopeUtility = sampleN >= 10 && typeof avgRatio === "number" ? avgRatio : 0.5;

  // ─── 批量重算：单条 UPDATE，循环 ───
  // 对于小规模知识库（<10000 条）可接受，超大规模需要改成单条 SQL 内联公式
  const candidates = await pool.query(
    `SELECT id,
            recall_count,
            last_recalled_at
     FROM kp_synthesized_knowledge
     WHERE tenant_id = $1 AND scope = $2 AND status = 'active' AND lifecycle_state = 'curated'`,
    [input.tenantId, input.scope]
  );

  let reweightedCount = 0;
  const DECAY_CONSTANT = 30;  // recency 衰减常数
  for (const row of candidates.rows) {
    const recallCount = Number(row.recall_count ?? 0);
    const lastRecalledAt = row.last_recalled_at ? new Date(row.last_recalled_at) : null;
    const utilityScore = scopeUtility;  // fix-9: scope 级别 utility

    // recency：没召回过的给 0（最衰减），刚召回过的给 1
    let recency: number;
    if (!lastRecalledAt) {
      recency = 0;
    } else {
      const daysSince = (Date.now() - lastRecalledAt.getTime()) / (1000 * 60 * 60 * 24);
      recency = Math.exp(-daysSince / DECAY_CONSTANT);
    }

    // frequency：log 归一化到 [0, 1]
    const frequency = maxRecall > 0 ? Math.log(1 + recallCount) / Math.log(1 + maxRecall) : 0;

    // 三因子加权
    const importance = 0.3 * recency + 0.3 * frequency + 0.4 * utilityScore;

    await pool.query(
      `UPDATE kp_synthesized_knowledge
       SET importance_weight = $3,
           importance_weight_updated_at = now(),
           utility_score = $4,
           utility_score_updated_at = now()
       WHERE id = $1 AND tenant_id = $2`,
      [row.id, input.tenantId, Math.max(0, Math.min(1, importance)), utilityScore]
    );
    reweightedCount++;
  }

  return { reweightedCount, degraded: false, reason: null };
}

// ─── 情景记忆：从 session_outcomes 提炼的结构化事件记忆 ───
// 把"什么时候、发生了什么、AI 知道什么、做了什么、结果怎样、因果链"结构化记录
// 这是从"语义记忆索引"到"情景记忆"的桥梁，让系统能"回忆"而非"检索"
export async function createEpisodicMemory(input: {
  tenantId: string;
  scope: string;
  sessionId: string;
  roundNumber?: number;
  taskDescription: string;
  scenarioType?: string;
  aiKnew?: unknown[];
  aiDid?: string;
  outcome: "success" | "failure" | "failure_recovered" | "knowledge_outdated" | "abandoned";
  toolSuccess?: boolean;
  causalChain?: unknown[];
  lessons?: string;
  sourceOutcomeId?: string;
  traceId: string;
}): Promise<string> {
  const pool = getPool();

  // lessons 根据 outcome 推导（规则提炼）
  const lessons = input.lessons ?? deriveLessonsFromOutcome(input.outcome, input.scenarioType);

  // causal_chain 默认：[task → retrieve → outcome] 简单链条
  const causalChain = input.causalChain ?? [
    { step: 1, action: "user_request", result: input.taskDescription.slice(0, 100) },
    { step: 2, action: "retrieve", result: `recalled ${Array.isArray(input.aiKnew) ? input.aiKnew.length : 0} items` },
    { step: 3, action: "outcome", result: input.outcome },
  ];

  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO episodic_memory (
      tenant_id, scope, status, version,
      event_time, session_id, round_number,
      task_description, scenario_type,
      ai_knew, ai_did, outcome, tool_success,
      causal_chain, lessons,
      source_outcome_id, trace_id
    ) VALUES (
      $1, $2, 'active', 1,
      now(), $3, $4,
      $5, $6,
      $7::jsonb, $8, $9, $10,
      $11::jsonb, $12,
      $13::uuid, $14
    ) RETURNING id
    `,
    [
      input.tenantId, input.scope,
      input.sessionId, input.roundNumber ?? null,
      input.taskDescription, input.scenarioType ?? null,
      JSON.stringify(input.aiKnew ?? []), input.aiDid ?? null,
      input.outcome, input.toolSuccess ?? null,
      JSON.stringify(causalChain), lessons,
      input.sourceOutcomeId ?? null, input.traceId,
    ]
  );
  return result.rows[0].id;
}

function deriveLessonsFromOutcome(
  outcome: string,
  scenarioType?: string
): string {
  switch (outcome) {
    case "success":
      return "知识有效，可复用";
    case "failure_recovered":
      if (scenarioType === "ai_corrected") return "AI 初次答错被纠正，知识需补充或更新";
      if (scenarioType === "tool_failure_recovered") return "工具失败后恢复，修复流程已验证";
      return "初次失败后恢复，知识需补充";
    case "knowledge_outdated":
      return "知识过时，需更新或替换";
    case "failure":
      return "失败，知识不足或错误";
    case "abandoned":
      return "用户放弃，需求可能不明确";
    default:
      return "未知结果";
  }
}

export async function queryEpisodicMemory(input: {
  tenantId: string;
  scope: string;
  sessionId?: string;
  outcome?: string;
  scenarioType?: string;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const conditions = ["tenant_id = $1", "scope = $2", "status = 'active'"];
  const params: unknown[] = [input.tenantId, input.scope];
  let paramIdx = 3;
  if (input.sessionId) {
    conditions.push(`session_id = $${paramIdx++}`);
    params.push(input.sessionId);
  }
  if (input.outcome) {
    conditions.push(`outcome = $${paramIdx++}`);
    params.push(input.outcome);
  }
  if (input.scenarioType) {
    conditions.push(`scenario_type = $${paramIdx++}`);
    params.push(input.scenarioType);
  }
  const result = await pool.query(
    `
    SELECT id, event_time, session_id, round_number,
           task_description, scenario_type,
           ai_knew, ai_did, outcome, tool_success,
           causal_chain, lessons, trace_id
    FROM episodic_memory
    WHERE ${conditions.join(" AND ")}
    ORDER BY event_time DESC
    LIMIT $${paramIdx}
    `,
    [...params, input.limit ?? 50]
  );
  return result.rows;
}

// ─── fix-7 阈值自适应：从 session_outcomes 反推 L2 阈值校准 ───
// 拉 outcome + retrieved_ids 对应的 content（跨 4 张表 LEFT JOIN）
// 供 L2ThresholdCalibrator 算 task_description vs content 的相似度分布
export async function queryOutcomeRetrievedContents(input: {
  tenantId: string;
  scope: string;
  limit?: number;
}): Promise<Array<{
  outcome_id: string;
  outcome: string;
  task_description: string;
  retrieved_id: string;
  content: string;
  layer: string;
}>> {
  const pool = getPool();
  const result = await pool.query(
    `
    WITH retrieved AS (
      SELECT
        so.id AS outcome_id,
        so.outcome,
        so.task_description,
        UNNEST(so.retrieved_ids) AS retrieved_id
      FROM session_outcomes so
      WHERE so.tenant_id = $1
        AND so.scope = $2
        AND so.status = 'active'
        AND array_length(so.retrieved_ids, 1) > 0
      ORDER BY so.created_at DESC
      LIMIT $3
    )
    SELECT
      r.outcome_id,
      r.outcome,
      r.task_description,
      r.retrieved_id::text AS retrieved_id,
      COALESCE(m.content, ru.statement, sk.content, s.description, '') AS content,
      CASE
        WHEN m.id IS NOT NULL THEN 'memory'
        WHEN ru.id IS NOT NULL THEN 'rule'
        WHEN s.id IS NOT NULL THEN 'skill'
        WHEN sk.id IS NOT NULL THEN 'synthesized_knowledge'
        ELSE 'unknown'
      END AS layer
    FROM retrieved r
    LEFT JOIN memory m ON m.id = r.retrieved_id
    LEFT JOIN rule ru ON ru.id = r.retrieved_id
    LEFT JOIN skill s ON s.id = r.retrieved_id
    LEFT JOIN kp_synthesized_knowledge sk ON sk.id = r.retrieved_id
    WHERE COALESCE(m.content, ru.statement, sk.content, s.description, '') <> ''
    `,
    [input.tenantId, input.scope, input.limit ?? 200]
  );
  return result.rows as Array<{
    outcome_id: string;
    outcome: string;
    task_description: string;
    retrieved_id: string;
    content: string;
    layer: string;
  }>;
}

// 写入校准结果（同一 threshold_name 的旧记录置 'superseded'）
export async function upsertThresholdCalibration(input: {
  tenantId: string;
  scope: string;
  thresholdName: string;
  recommendedValue: number;
  defaultValue: number;
  appliedValue: number;
  sampleSize: number;
  basisOutcome: string;
  distributionP25?: number | null;
  distributionP50?: number | null;
  distributionP95?: number | null;
  rationale: string;
}): Promise<string> {
  const pool = getPool();
  // 旧记录置 superseded
  await pool.query(
    `UPDATE kp_threshold_calibration
     SET status = 'superseded', updated_at = now()
     WHERE tenant_id = $1 AND scope = $2 AND threshold_name = $3 AND status = 'active'`,
    [input.tenantId, input.scope, input.thresholdName]
  );
  const result = await pool.query<{ id: string }>(
    `
    INSERT INTO kp_threshold_calibration (
      tenant_id, scope, status, threshold_name,
      recommended_value, default_value, applied_value,
      sample_size, basis_outcome,
      distribution_p25, distribution_p50, distribution_p95,
      rationale
    )
    VALUES (
      $1, $2, 'active', $3,
      $4, $5, $6,
      $7, $8,
      $9, $10, $11,
      $12
    )
    RETURNING id
    `,
    [
      input.tenantId, input.scope, input.thresholdName,
      input.recommendedValue, input.defaultValue, input.appliedValue,
      input.sampleSize, input.basisOutcome,
      input.distributionP25 ?? null, input.distributionP50 ?? null, input.distributionP95 ?? null,
      input.rationale
    ]
  );
  return result.rows[0].id;
}

// 读取最新校准值（L2ConflictDetector 用）
export async function getLatestThresholdCalibration(input: {
  tenantId: string;
  scope: string;
  thresholdName: string;
}): Promise<{
  recommended_value: number;
  applied_value: number;
  default_value: number;
  sample_size: number;
  basis_outcome: string;
  calibrated_at: Date;
} | null> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT recommended_value, applied_value, default_value,
           sample_size, basis_outcome, calibrated_at
    FROM kp_threshold_calibration
    WHERE tenant_id = $1 AND scope = $2 AND threshold_name = $3 AND status = 'active'
    ORDER BY calibrated_at DESC
    LIMIT 1
    `,
    [input.tenantId, input.scope, input.thresholdName]
  );
  return result.rows[0] ?? null;
}

// ─── fix-8 retrieve_quality 评估：记录每次 retrieve 的 term 命中率 ───
// 复用 buildMetacognitionAssessment 的 knowledge_gaps 信号，零额外成本
// 给归档保护做数据底子（避免 retrieve 失败导致误归档）
export async function logRetrieveQuality(input: {
  tenantId: string;
  scope: string;
  traceId: string;
  query: string;
  queryTerms: string[];
  hitTerms: string[];
  termHitRatio: number;
  retrieveQuality: "good" | "partial" | "poor";
}): Promise<void> {
  const pool = getPool();
  await pool.query(
    `
    INSERT INTO kp_retrieve_quality_log (
      tenant_id, scope, status, trace_id, query,
      query_terms, hit_terms, term_hit_ratio, retrieve_quality
    )
    VALUES (
      $1, $2, 'active', $3, $4,
      $5::jsonb, $6::jsonb, $7, $8
    )
    `,
    [
      input.tenantId, input.scope, input.traceId, input.query,
      toJsonArray(input.queryTerms), toJsonArray(input.hitTerms),
      input.termHitRatio, input.retrieveQuality
    ]
  );
}

// ─── fix-8 归档保护：查最近 N 天同 scope 的平均 term_hit_ratio ───
// 平均 < 0.4 → retrieve 整体 poor，归档跳过（retrieve 的锅，不是知识的锅）
export async function getAverageRetrieveQuality(input: {
  tenantId: string;
  scope: string;
  days?: number;
}): Promise<{
  averageTermHitRatio: number;
  sampleSize: number;
  retrieveQuality: "good" | "partial" | "poor";
} | null> {
  const pool = getPool();
  const days = input.days ?? 30;
  const result = await pool.query(
    `
    SELECT
      AVG(term_hit_ratio) AS avg_ratio,
      COUNT(*) AS sample_size
    FROM kp_retrieve_quality_log
    WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
      AND created_at >= now() - ($3 || ' days')::interval
    `,
    [input.tenantId, input.scope, String(days)]
  );
  const row = result.rows[0];
  if (!row || !row.avg_ratio || Number(row.sample_size) === 0) {
    return null;
  }
  const avg = Number(row.avg_ratio);
  let quality: "good" | "partial" | "poor";
  if (avg >= 0.6) quality = "good";
  else if (avg >= 0.3) quality = "partial";
  else quality = "poor";
  return {
    averageTermHitRatio: avg,
    sampleSize: Number(row.sample_size),
    retrieveQuality: quality
  };
}

export async function queryDerivedKnowledgeEvidence(input: {
  tenantId: string;
  scope: string;
  synthesizedKnowledgeIds: string[];
}): Promise<Record<string, unknown>[]> {
  if (input.synthesizedKnowledgeIds.length === 0) {
    return [];
  }
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT
      ske.synthesized_knowledge_id,
      ske.source_object_type,
      ske.source_object_id,
      ske.support_role,
      e.id AS evidence_id,
      e.source_uri,
      e.content_excerpt,
      e.evidence_type,
      e.source_type,
      e.trust_level,
      e.status AS evidence_status,
      e.lifecycle_state AS evidence_lifecycle_state,
      e.review_state AS evidence_review_state,
      e.created_at AS evidence_created_at,
      e.metadata AS evidence_metadata,
      f.id AS fact_id,
      COALESCE(f.title, e.source_uri, e.id::text) AS fact_title,
      COALESCE(f.statement, e.content_excerpt) AS fact_statement
    FROM kp_synthesized_knowledge_evidence ske
    JOIN kp_evidence e
      ON e.id = ske.evidence_id
     AND e.tenant_id = ske.tenant_id
     AND e.scope = ske.scope
     AND e.status = 'active'
    LEFT JOIN kp_fact f
      ON ske.source_object_type = 'fact'
     AND f.id = ske.source_object_id
     AND f.tenant_id = ske.tenant_id
     AND f.scope = ske.scope
     AND f.status = 'active'
    WHERE ske.tenant_id = $1
      AND ske.scope = $2
      AND ske.status = 'active'
      AND ske.synthesized_knowledge_id = ANY($3::uuid[])
    ORDER BY ske.created_at ASC
    `,
    [input.tenantId, input.scope, input.synthesizedKnowledgeIds]
  );
  return result.rows;
}

export async function queryKnowledgeSections(input: {
  tenantId: string;
  scope: string;
  query?: string | null;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const normalized = input.query?.trim().toLowerCase() ?? null;
  const result = await pool.query(
    `
    SELECT s.*, d.title AS document_title, d.source_uri AS document_source_uri
    FROM kp_section s
    JOIN kp_document d ON d.id = s.document_id
    WHERE s.tenant_id = $1
      AND s.scope = $2
      AND s.status = 'active'
      AND (
        $3::text IS NULL
        OR s.content ILIKE '%' || $3 || '%'
        OR COALESCE(s.title, '') ILIKE '%' || $3 || '%'
        OR d.title ILIKE '%' || $3 || '%'
      )
    ORDER BY s.updated_at DESC
    LIMIT $4
    `,
    [input.tenantId, input.scope, normalized, input.limit ?? 10]
  );
  return result.rows;
}

export async function queryKnowledgeSectionsBm25(input: {
  tenantId: string;
  scope: string;
  query: string;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    WITH query AS (
      SELECT websearch_to_tsquery('simple', $3) AS tsq
    )
    SELECT
      s.*,
      d.title AS document_title,
      d.source_uri AS document_source_uri,
      ts_rank_cd(
        setweight(to_tsvector('simple', COALESCE(d.title, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(s.title, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(s.summary, '')), 'B') ||
        setweight(to_tsvector('simple', COALESCE(s.content, '')), 'C'),
        query.tsq
      ) AS bm25_score
    FROM kp_section s
    JOIN kp_document d ON d.id = s.document_id
    CROSS JOIN query
    WHERE s.tenant_id = $1
      AND s.scope = $2
      AND s.status = 'active'
      AND query.tsq @@ (
        setweight(to_tsvector('simple', COALESCE(d.title, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(s.title, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(s.summary, '')), 'B') ||
        setweight(to_tsvector('simple', COALESCE(s.content, '')), 'C')
      )
    ORDER BY bm25_score DESC, s.updated_at DESC
    LIMIT $4
    `,
    [input.tenantId, input.scope, input.query, input.limit ?? 20]
  );
  return result.rows;
}

export async function queryKnowledgeSectionVectorCorpus(input: {
  tenantId: string;
  scope: string;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT
      s.*,
      d.title AS document_title,
      d.source_uri AS document_source_uri
    FROM kp_section s
    JOIN kp_document d ON d.id = s.document_id
    WHERE s.tenant_id = $1
      AND s.scope = $2
      AND s.status = 'active'
    ORDER BY s.updated_at DESC
    LIMIT $3
    `,
    [input.tenantId, input.scope, input.limit ?? 500]
  );
  return result.rows;
}

export async function queryKnowledgeSectionsByIds(input: {
  tenantId: string;
  scope: string;
  sectionIds: string[];
}): Promise<Record<string, unknown>[]> {
  if (input.sectionIds.length === 0) {
    return [];
  }
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT s.*, d.title AS document_title, d.source_uri AS document_source_uri
    FROM kp_section s
    JOIN kp_document d ON d.id = s.document_id
    WHERE s.tenant_id = $1
      AND s.scope = $2
      AND s.id = ANY($3::uuid[])
    ORDER BY s.updated_at DESC
    `,
    [input.tenantId, input.scope, input.sectionIds]
  );
  return result.rows;
}

export async function queryKnowledgeDocuments(input: {
  tenantId: string;
  scope: string;
  query?: string | null;
  limit?: number;
  offset?: number;
}): Promise<{ items: Record<string, unknown>[]; total: number; limit: number; offset: number }> {
  const pool = getPool();
  const normalized = input.query?.trim().toLowerCase() ?? null;
  const limit = Math.max(1, Math.min(input.limit ?? 20, 200));
  const offset = Math.max(0, input.offset ?? 0);
  const result = await pool.query(
    `
    SELECT
      d.*,
      COUNT(s.id)::int AS section_count,
      COUNT(*) OVER()::int AS total_count
    FROM kp_document d
    LEFT JOIN kp_section s ON s.document_id = d.id
    WHERE d.tenant_id = $1
      AND d.scope = $2
      AND d.status = 'active'
      AND d.lifecycle_state <> 'quarantined'
      AND (
        $3::text IS NULL
        OR d.title ILIKE '%' || $3 || '%'
        OR d.source_uri ILIKE '%' || $3 || '%'
      )
    GROUP BY d.id
    ORDER BY d.updated_at DESC
    LIMIT $4
    OFFSET $5
    `,
    [input.tenantId, input.scope, normalized, limit, offset]
  );
  const total = Number(result.rows[0]?.total_count ?? 0);
  return {
    items: result.rows.map(({ total_count: _totalCount, ...row }) => row),
    total,
    limit,
    offset
  };
}

export async function getKnowledgeDocumentById(input: {
  tenantId: string;
  scope: string;
  documentId: string;
}): Promise<Record<string, unknown> | null> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT
      d.*,
      COUNT(s.id)::int AS section_count
    FROM kp_document d
    LEFT JOIN kp_section s ON s.document_id = d.id
    WHERE d.tenant_id = $1
      AND d.scope = $2
      AND d.id = $3::uuid
    GROUP BY d.id
    `,
    [input.tenantId, input.scope, input.documentId]
  );
  return result.rows[0] ?? null;
}

export async function queryKnowledgeSectionsByDocumentId(input: {
  tenantId: string;
  scope: string;
  documentId: string;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM kp_section
    WHERE tenant_id = $1
      AND scope = $2
      AND document_id = $3::uuid
    ORDER BY ordinal ASC, created_at ASC
    LIMIT $4
    `,
    [input.tenantId, input.scope, input.documentId, input.limit ?? 100]
  );
  return result.rows;
}

export async function queryKnowledgeEvidenceByDocumentId(input: {
  tenantId: string;
  scope: string;
  documentId: string;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT e.*
    FROM kp_evidence e
    JOIN kp_section s ON s.id::text = COALESCE(e.raw_ref, '')
    WHERE e.tenant_id = $1
      AND e.scope = $2
      AND s.document_id = $3::uuid
    ORDER BY e.created_at DESC
    LIMIT $4
    `,
    [input.tenantId, input.scope, input.documentId, input.limit ?? 100]
  );
  return result.rows;
}

export async function queryKnowledgeFactsByDocumentId(input: {
  tenantId: string;
  scope: string;
  documentId: string;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    WITH doc_facts AS (
      SELECT DISTINCT f.id
      FROM kp_fact f
      JOIN kp_relation r
        ON r.from_object_type = 'fact'
       AND r.from_object_id = f.id
       AND r.to_object_type = 'section'
       AND r.relation_type = 'derived_from'
      JOIN kp_section s
        ON s.id = r.to_object_id
      WHERE f.tenant_id = $1
        AND f.scope = $2
        AND s.document_id = $3::uuid
      UNION
      SELECT DISTINCT f.id
      FROM kp_fact f
      JOIN kp_candidate_link cl
        ON cl.target_object_type = 'fact'
       AND cl.target_object_id = f.id
      JOIN memory_candidate mc
        ON mc.id = cl.candidate_id
      WHERE f.tenant_id = $1
        AND f.scope = $2
        AND mc.tenant_id = $1
        AND mc.scope = $2
        AND mc.candidate_payload ->> 'document_id' = $3::text
    )
    SELECT DISTINCT f.*
    FROM kp_fact f
    JOIN doc_facts df
      ON df.id = f.id
    WHERE f.tenant_id = $1
      AND f.scope = $2
    ORDER BY f.importance DESC, f.updated_at DESC
    LIMIT $4
    `,
    [input.tenantId, input.scope, input.documentId, input.limit ?? 100]
  );
  return result.rows;
}

export async function queryKnowledgeRelationsByDocumentId(input: {
  tenantId: string;
  scope: string;
  documentId: string;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    WITH doc_facts AS (
      SELECT DISTINCT f.id
      FROM kp_fact f
      JOIN kp_relation r
        ON r.from_object_type = 'fact'
       AND r.from_object_id = f.id
       AND r.to_object_type = 'section'
       AND r.relation_type = 'derived_from'
      JOIN kp_section s
        ON s.id = r.to_object_id
      WHERE f.tenant_id = $1
        AND f.scope = $2
        AND s.document_id = $3::uuid
      UNION
      SELECT DISTINCT f.id
      FROM kp_fact f
      JOIN kp_candidate_link cl
        ON cl.target_object_type = 'fact'
       AND cl.target_object_id = f.id
      JOIN memory_candidate mc
        ON mc.id = cl.candidate_id
      WHERE f.tenant_id = $1
        AND f.scope = $2
        AND mc.tenant_id = $1
        AND mc.scope = $2
        AND mc.candidate_payload ->> 'document_id' = $3::text
    )
    SELECT DISTINCT r.*
    FROM kp_relation r
    LEFT JOIN kp_section s_to
      ON r.to_object_type = 'section'
     AND s_to.id = r.to_object_id
    LEFT JOIN kp_section s_from
      ON r.from_object_type = 'section'
     AND s_from.id = r.from_object_id
    WHERE r.tenant_id = $1
      AND r.scope = $2
      AND (
        s_to.document_id = $3::uuid
        OR s_from.document_id = $3::uuid
        OR (r.from_object_type = 'fact' AND r.from_object_id IN (SELECT id FROM doc_facts))
        OR (r.to_object_type = 'fact' AND r.to_object_id IN (SELECT id FROM doc_facts))
      )
    ORDER BY r.updated_at DESC
    LIMIT $4
    `,
    [input.tenantId, input.scope, input.documentId, input.limit ?? 100]
  );
  return result.rows;
}

export async function querySynthesisFactEvidence(input: {
  tenantId: string;
  scope: string;
  documentIds?: string[];
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT
      f.id AS fact_id,
      f.title AS fact_title,
      f.statement AS fact_statement,
      f.memory_domain,
      f.importance,
      f.confidence_score,
      e.id AS evidence_id,
      e.source_uri AS evidence_source_uri,
      e.content_excerpt,
      COALESCE(d.id, candidate_doc.id) AS document_id,
      COALESCE(d.title, candidate_doc.title) AS document_title
    FROM kp_fact f
    JOIN kp_relation r
      ON r.tenant_id = f.tenant_id
     AND r.scope = f.scope
     AND r.from_object_type = 'fact'
     AND r.from_object_id = f.id
     AND r.to_object_type = 'evidence'
     AND r.relation_type = 'evidenced_by'
    JOIN kp_evidence e
      ON e.id = r.to_object_id
     AND e.status = 'active'
    LEFT JOIN kp_relation section_relation
      ON section_relation.tenant_id = f.tenant_id
     AND section_relation.scope = f.scope
     AND section_relation.from_object_type = 'fact'
     AND section_relation.from_object_id = f.id
     AND section_relation.to_object_type = 'section'
     AND section_relation.relation_type = 'derived_from'
     AND section_relation.status = 'active'
    LEFT JOIN kp_section s
      ON s.id = section_relation.to_object_id
     AND s.status = 'active'
    LEFT JOIN kp_document d
      ON d.id = s.document_id
     AND d.status = 'active'
    LEFT JOIN kp_candidate_link cl
      ON cl.target_object_type = 'fact'
     AND cl.target_object_id = f.id
    LEFT JOIN memory_candidate mc
      ON mc.id = cl.candidate_id
    LEFT JOIN kp_document candidate_doc
      ON candidate_doc.id = NULLIF(mc.candidate_payload ->> 'document_id', '')::uuid
     AND candidate_doc.status = 'active'
    WHERE f.tenant_id = $1
      AND f.scope = $2
      AND f.status = 'active'
      AND f.lifecycle_state IN ('curated', 'candidate')
      AND ($3::uuid[] IS NULL OR COALESCE(d.id, candidate_doc.id) = ANY($3::uuid[]))
    ORDER BY f.importance DESC, f.confidence_score DESC, f.updated_at DESC
    LIMIT $4
    `,
    [input.tenantId, input.scope, input.documentIds?.length ? input.documentIds : null, input.limit ?? 30]
  );
  return result.rows;
}

export async function listKnowledgeGovernanceJobs(input: {
  tenantId: string;
  scope: string;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM kp_governance_job
    WHERE tenant_id = $1
      AND scope = $2
      AND status <> 'retired'
    ORDER BY created_at DESC
    LIMIT $3
    `,
    [input.tenantId, input.scope, input.limit ?? 50]
  );
  return result.rows;
}

export async function queryKnowledgeGovernanceDecisions(input: {
  tenantId: string;
  scope: string;
  governanceJobId?: string | null;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM kp_governance_decision
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
      AND ($3::uuid IS NULL OR governance_job_id = $3::uuid)
    ORDER BY created_at DESC
    LIMIT $4
    `,
    [input.tenantId, input.scope, input.governanceJobId ?? null, input.limit ?? 100]
  );
  return result.rows;
}

export async function queryKnowledgeGovernanceCleaningLogs(input: {
  tenantId: string;
  scope: string;
  governanceJobId?: string | null;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT l.*, d.title AS document_title, d.source_uri AS document_source_uri
    FROM kp_governance_cleaning_log l
    JOIN kp_document d ON d.id = l.document_id
    WHERE l.tenant_id = $1
      AND l.scope = $2
      AND l.status = 'active'
      AND ($3::uuid IS NULL OR l.governance_job_id = $3::uuid)
    ORDER BY l.created_at DESC
    LIMIT $4
    `,
    [input.tenantId, input.scope, input.governanceJobId ?? null, input.limit ?? 100]
  );
  return result.rows;
}

export async function querySynthesizedKnowledge(input: {
  tenantId: string;
  scope: string;
  governanceJobId?: string | null;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM kp_synthesized_knowledge
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'active'
      AND ($3::uuid IS NULL OR governance_job_id = $3::uuid)
    ORDER BY confidence_score DESC, updated_at DESC
    LIMIT $4
    `,
    [input.tenantId, input.scope, input.governanceJobId ?? null, input.limit ?? 100]
  );
  return result.rows;
}

export async function getSynthesizedKnowledgeById(input: {
  tenantId: string;
  scope: string;
  synthesizedKnowledgeId: string;
}): Promise<Record<string, unknown> | null> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM kp_synthesized_knowledge
    WHERE tenant_id = $1
      AND scope = $2
      AND id = $3::uuid
      AND status = 'active'
    LIMIT 1
    `,
    [input.tenantId, input.scope, input.synthesizedKnowledgeId]
  );
  return result.rows[0] ?? null;
}

export async function queryRecallSurfaceStates(input: {
  tenantId: string;
  scope: string;
  governanceJobId?: string | null;
  objectType?: string | null;
  limit?: number;
}): Promise<Record<string, unknown>[]> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT *
    FROM kp_recall_surface_state
    WHERE tenant_id = $1
      AND scope = $2
      AND ($3::uuid IS NULL OR governance_job_id = $3::uuid)
      AND ($4::text IS NULL OR object_type = $4)
    ORDER BY updated_at DESC
    LIMIT $5
    `,
    [input.tenantId, input.scope, input.governanceJobId ?? null, input.objectType ?? null, input.limit ?? 100]
  );
  return result.rows;
}

export async function purgeKnowledgeIntermediateArtifacts(input: {
  tenantId: string;
  scope: string;
  traceId: string;
}): Promise<{
  relinkedSynthesizedEvidenceRows: number;
  rewrittenSynthesizedKnowledgeRows: number;
  deletedRecallSurfaceRows: number;
  deletedRelationRows: number;
  deletedFactRows: number;
  deletedEntityRows: number;
}> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const relinkEvidence = await client.query(
      `
      UPDATE kp_synthesized_knowledge_evidence
      SET source_object_type = 'evidence',
          source_object_id = evidence_id
      WHERE tenant_id = $1
        AND scope = $2
        AND status = 'active'
        AND source_object_type IN ('fact', 'entity', 'relation')
      `,
      [input.tenantId, input.scope]
    );

    const rewriteSynthesizedSources = await client.query(
      `
      UPDATE kp_synthesized_knowledge
      SET source_object_ids = evidence_ids,
          metadata = metadata
            || jsonb_build_object(
              'source_object_type', 'evidence',
              'intermediate_artifacts_purged', true,
              'intermediate_artifacts_purged_at', now(),
              'intermediate_artifacts_purge_trace_id', $3::text
            ),
          updated_at = now(),
          trace_id = $3::text
      WHERE tenant_id = $1
        AND scope = $2
        AND status = 'active'
      `,
      [input.tenantId, input.scope, input.traceId]
    );

    const deleteRecallSurface = await client.query(
      `
      DELETE FROM kp_recall_surface_state
      WHERE tenant_id = $1
        AND scope = $2
        AND object_type IN ('fact', 'entity', 'relation')
      `,
      [input.tenantId, input.scope]
    );

    const deleteRelations = await client.query(
      `
      DELETE FROM kp_relation
      WHERE tenant_id = $1
        AND scope = $2
      `,
      [input.tenantId, input.scope]
    );

    const deleteFacts = await client.query(
      `
      DELETE FROM kp_fact
      WHERE tenant_id = $1
        AND scope = $2
      `,
      [input.tenantId, input.scope]
    );

    const deleteEntities = await client.query(
      `
      DELETE FROM kp_entity
      WHERE tenant_id = $1
        AND scope = $2
      `,
      [input.tenantId, input.scope]
    );

    await client.query("COMMIT");
    return {
      relinkedSynthesizedEvidenceRows: relinkEvidence.rowCount ?? 0,
      rewrittenSynthesizedKnowledgeRows: rewriteSynthesizedSources.rowCount ?? 0,
      deletedRecallSurfaceRows: deleteRecallSurface.rowCount ?? 0,
      deletedRelationRows: deleteRelations.rowCount ?? 0,
      deletedFactRows: deleteFacts.rowCount ?? 0,
      deletedEntityRows: deleteEntities.rowCount ?? 0
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function getKnowledgeOpsOverview(input: {
  tenantId: string;
  scope: string;
}): Promise<Record<string, unknown>> {
  const pool = getPool();
  const result = await pool.query(
    `
    SELECT
      (SELECT COUNT(*)::int FROM kp_document WHERE tenant_id = $1 AND scope = $2 AND status = 'active') AS document_count,
      (SELECT COUNT(*)::int FROM kp_section WHERE tenant_id = $1 AND scope = $2 AND status = 'active') AS section_count,
      (SELECT COUNT(*)::int FROM kp_evidence WHERE tenant_id = $1 AND scope = $2 AND status = 'active') AS evidence_count,
      (SELECT COUNT(*)::int FROM kp_entity WHERE tenant_id = $1 AND scope = $2 AND status = 'active') AS entity_count,
      (SELECT COUNT(*)::int FROM kp_fact WHERE tenant_id = $1 AND scope = $2 AND status = 'active') AS fact_count,
      (SELECT COUNT(*)::int FROM kp_relation WHERE tenant_id = $1 AND scope = $2 AND status = 'active') AS relation_count,
      (SELECT COUNT(*)::int FROM kp_review_queue WHERE tenant_id = $1 AND scope = $2 AND status = 'active') AS active_review_count,
      (SELECT COUNT(*)::int FROM kp_governance_job WHERE tenant_id = $1 AND scope = $2) AS governance_job_count,
      (SELECT COUNT(*)::int FROM kp_document WHERE tenant_id = $1 AND scope = $2) AS total_document_count,
      (SELECT COUNT(*)::int FROM kp_document WHERE tenant_id = $1 AND scope = $2 AND status = 'retired') AS retired_document_count,
      (SELECT COUNT(*)::int FROM kp_section WHERE tenant_id = $1 AND scope = $2 AND status = 'retired') AS retired_section_count,
      (SELECT COUNT(*)::int FROM kp_evidence WHERE tenant_id = $1 AND scope = $2 AND status = 'retired') AS retired_evidence_count,
      (SELECT COUNT(*)::int FROM kp_fact WHERE tenant_id = $1 AND scope = $2 AND status = 'retired') AS retired_fact_count,
      (SELECT COUNT(*)::int FROM kp_relation WHERE tenant_id = $1 AND scope = $2 AND status = 'retired') AS retired_relation_count,
      (
        SELECT COUNT(*)::int
        FROM kp_document
        WHERE tenant_id = $1
          AND scope = $2
          AND status = 'active'
          AND markdown_content IS NOT NULL
          AND markdown_content <> ''
      ) AS active_full_markdown_document_count,
      (
        SELECT COUNT(*)::int
        FROM kp_document
        WHERE tenant_id = $1
          AND scope = $2
          AND status = 'active'
          AND (markdown_content IS NULL OR markdown_content = '')
      ) AS active_generated_document_count,
      (
        SELECT COALESCE(SUM(duplicate_count - 1), 0)::int
        FROM (
          SELECT markdown_content_hash, COUNT(*)::int AS duplicate_count
          FROM kp_document
          WHERE tenant_id = $1
            AND scope = $2
            AND status = 'active'
            AND markdown_content_hash IS NOT NULL
            AND markdown_content_hash <> ''
          GROUP BY markdown_content_hash
          HAVING COUNT(*) > 1
        ) duplicate_hashes
      ) AS active_duplicate_markdown_hash_count,
      (
        SELECT COALESCE(SUM(duplicate_count - 1), 0)::int
        FROM (
          SELECT
            lower(regexp_replace(regexp_replace(trim(source_uri), '#.*$', ''), '/$', '')) AS canonical_source_uri,
            COUNT(*)::int AS duplicate_count
          FROM kp_document
          WHERE tenant_id = $1
            AND scope = $2
            AND status = 'active'
            AND source_uri IS NOT NULL
            AND trim(source_uri) <> ''
          GROUP BY lower(regexp_replace(regexp_replace(trim(source_uri), '#.*$', ''), '/$', ''))
          HAVING COUNT(*) > 1
        ) duplicate_sources
      ) AS active_duplicate_canonical_source_uri_count,
      (
        SELECT COUNT(*)::int
        FROM kp_document
        WHERE tenant_id = $1
          AND scope = $2
          AND status = 'active'
          AND (
            lower(source_uri) LIKE '%/appdata/local/temp/basic-graph-contract-%'
            OR lower(source_uri) LIKE '%/appdata/local/temp/knowledge-debug-%'
            OR lower(title) = 'debug doc'
            OR (lower(title) = 'basic graph contract' AND lower(source_uri) LIKE '%/appdata/local/temp/%')
          )
      ) AS active_temp_test_document_count,
      (
        SELECT COUNT(*)::int
        FROM kp_synthesized_knowledge
        WHERE tenant_id = $1
          AND scope = $2
          AND status = 'active'
          AND lifecycle_state = 'curated'
          AND recall_state = 'active'
      ) AS active_derived_knowledge_count
    `,
    [input.tenantId, input.scope]
  );
  return result.rows[0] ?? {};
}
