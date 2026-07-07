import {
  applyKnowledgeReviewAction,
  getKnowledgeDocumentById,
  getKnowledgeOpsOverview,
  getDailyGovernanceRuns,
  getKnowledgeContextBundleById,
  getSynthesizedKnowledgeById,
  listKnowledgeGovernanceJobs,
  listGovernanceChangeProposals,
  queryKnowledgeGovernanceCleaningLogs,
  queryKnowledgeGovernanceDecisions,
  queryDerivedKnowledgeEvidence,
  queryKnowledgeDocuments,
  queryKnowledgeEvidenceByDocumentId,
  queryKnowledgeEntities,
  queryKnowledgeFactsByDocumentId,
  queryKnowledgeFacts,
  queryKnowledgeRelationsByDocumentId,
  queryKnowledgeRelationsForObjects,
  queryKnowledgeReviewQueue,
  queryKnowledgeSectionsByDocumentId,
  queryRecallSurfaceStates,
  querySynthesizedKnowledge,
  getKnowledgeUtility,
} from "@super-agent/db";
import { getPool } from "@super-agent/db";

type ReviewQueueActionRequest = {
  action: string;
  payload?: Record<string, unknown>;
};

export async function listKnowledgeReviewQueueItems(input: {
  tenantId: string;
  scope: string;
  status?: string | null;
  reviewReason?: string | null;
  limit?: number;
}) {
  const items = await queryKnowledgeReviewQueue({
    tenantId: input.tenantId,
    scope: input.scope,
    status: input.status ?? null,
    reviewReason: input.reviewReason ?? null,
    limit: input.limit ?? 50,
  });

  return {
    tenant_id: input.tenantId,
    scope: input.scope,
    items,
  };
}

export async function handleKnowledgeReviewAction(input: {
  tenantId: string;
  scope: string;
  traceId: string;
  reviewQueueId: string;
  body: ReviewQueueActionRequest;
}) {
  await applyKnowledgeReviewAction({
    tenantId: input.tenantId,
    scope: input.scope,
    reviewQueueId: input.reviewQueueId,
    action: input.body.action,
    resolutionPayload: input.body.payload ?? {},
    traceId: input.traceId,
  });

  return {
    review_queue_id: input.reviewQueueId,
    action: input.body.action,
    status: "resolved",
    resolved_at: new Date().toISOString(),
  };
}

export async function getKnowledgeContextBundle(input: {
  tenantId: string;
  scope: string;
  bundleId: string;
}) {
  const bundle = await getKnowledgeContextBundleById({
    tenantId: input.tenantId,
    scope: input.scope,
    bundleId: input.bundleId,
  });

  return bundle
    ? {
        bundle_id: bundle.id,
        request_ref: bundle.request_ref,
        bundle_type: bundle.bundle_type,
        summary: bundle.summary,
        facts: bundle.facts,
        entities: bundle.entities,
        relations: bundle.relations,
        evidence_refs: bundle.evidence_refs,
        section_refs: bundle.section_refs,
        warnings: bundle.warnings,
        assembly_trace: bundle.assembly_trace,
        created_at: bundle.created_at,
      }
    : null;
}

export async function listKnowledgeGraphEntities(input: {
  tenantId: string;
  scope: string;
  query?: string | null;
  limit?: number;
}) {
  const items = await queryKnowledgeEntities({
    tenantId: input.tenantId,
    scope: input.scope,
    query: input.query ?? null,
    limit: input.limit ?? 50,
  });
  return { items };
}

export async function listKnowledgeDocuments(input: {
  tenantId: string;
  scope: string;
  query?: string | null;
  limit?: number;
  offset?: number;
}) {
  return queryKnowledgeDocuments({
    tenantId: input.tenantId,
    scope: input.scope,
    query: input.query ?? null,
    limit: input.limit ?? 20,
    offset: input.offset ?? 0,
  });
}

export async function getKnowledgeDocumentDetails(input: {
  tenantId: string;
  scope: string;
  documentId: string;
}) {
  const document = await getKnowledgeDocumentById({
    tenantId: input.tenantId,
    scope: input.scope,
    documentId: input.documentId,
  });
  if (!document) {
    return null;
  }

  const [sections, facts, relations, evidence] = await Promise.all([
    queryKnowledgeSectionsByDocumentId({
      tenantId: input.tenantId,
      scope: input.scope,
      documentId: input.documentId,
      limit: 100,
    }),
    queryKnowledgeFactsByDocumentId({
      tenantId: input.tenantId,
      scope: input.scope,
      documentId: input.documentId,
      limit: 100,
    }),
    queryKnowledgeRelationsByDocumentId({
      tenantId: input.tenantId,
      scope: input.scope,
      documentId: input.documentId,
      limit: 100,
    }),
    queryKnowledgeEvidenceByDocumentId({
      tenantId: input.tenantId,
      scope: input.scope,
      documentId: input.documentId,
      limit: 100,
    }),
  ]);

  return {
    document,
    sections,
    facts,
    relations,
    evidence,
  };
}

export async function listKnowledgeGraphFacts(input: {
  tenantId: string;
  scope: string;
  query?: string | null;
  limit?: number;
}) {
  const items = await queryKnowledgeFacts({
    tenantId: input.tenantId,
    scope: input.scope,
    query: input.query ?? null,
    limit: input.limit ?? 50,
  });
  return { items };
}

export async function listKnowledgeGraphRelations(input: {
  tenantId: string;
  scope: string;
  objectIds?: string[];
  limit?: number;
}) {
  const items = await queryKnowledgeRelationsForObjects({
    tenantId: input.tenantId,
    scope: input.scope,
    objectIds: input.objectIds ?? [],
    limit: input.limit ?? 50,
  });
  return { items };
}

// ─── 知识图谱聚合视图 ─────────────────────────────────
// 一次返回 entities + facts + relations + synthesized_knowledge + evidence + governance_proposals
// 治理提案按 proposed_action 前缀区分来源层（L2_/L3_/L4_），用于前端时间线渲染
export async function getKnowledgeGraphOverview(input: {
  tenantId: string;
  scope: string;
  limit?: number;
}) {
  const limit = input.limit ?? 100;
  const pool = getPool();
  const [
    entities,
    facts,
    relations,
    synthesizedKnowledge,
    governanceProposals,
    rules,
    memories,
    skills,
    layerLinks,
  ] = await Promise.all([
    queryKnowledgeEntities({
      tenantId: input.tenantId,
      scope: input.scope,
      query: null,
      limit,
    }),
    queryKnowledgeFacts({
      tenantId: input.tenantId,
      scope: input.scope,
      query: null,
      limit,
    }),
    queryKnowledgeRelationsForObjects({
      tenantId: input.tenantId,
      scope: input.scope,
      objectIds: [],
      limit: limit * 2, // 关系天然比节点多，放宽
    }),
    querySynthesizedKnowledge({
      tenantId: input.tenantId,
      scope: input.scope,
      governanceJobId: null,
      limit,
    }),
    listGovernanceChangeProposals({
      tenantId: input.tenantId,
      scope: input.scope,
      status: null,
      limit: limit * 2,
    }),
    // 四层节点：rule/memory/skill 也进图谱，让人类一眼看到全部治理对象
    pool
      .query(
        `SELECT id, title, statement, enforcement_level, status, origin_scope, availability_scope, created_at
       FROM rule
       WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
       ORDER BY created_at DESC LIMIT $3`,
        [input.tenantId, input.scope, limit],
      )
      .then((r) => r.rows),
    pool
      .query(
        `SELECT id, title, content, memory_type, status, origin_scope, availability_scope, created_at
       FROM memory
       WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
       ORDER BY created_at DESC LIMIT $3`,
        [input.tenantId, input.scope, limit],
      )
      .then((r) => r.rows),
    pool
      .query(
        `SELECT id, title, description, skill_type, status, origin_scope, availability_scope, source_kind, created_at
       FROM skill
       WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
       ORDER BY created_at DESC LIMIT $3`,
        [input.tenantId, input.scope, limit],
      )
      .then((r) => r.rows),
    // P1 派生机制：layer_links 表的跨层关系(derived_from / explains / constrains / provenance)
    // 转换成 relations 格式合并进 relations 数组,让洋葱图能渲染跨层关系线
    pool
      .query(
        `SELECT source_id AS from_object_id, target_id AS to_object_id,
              link_type AS relation_type, source_layer, target_layer, confidence
       FROM layer_links
       WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
       LIMIT $3`,
        [input.tenantId, input.scope, limit * 2],
      )
      .then((r) => r.rows),
  ]);

  // 批量拉取所有合成知识对应的 evidence（避免 N+1）
  // P1 派生机制：把 layer_links 表的跨层关系合并进 relations,让洋葱图能渲染 derived_from 等跨层关系线
  const allRelations = [...relations, ...layerLinks];
  const synthesizedKnowledgeIds = synthesizedKnowledge
    .map((item) => String(item.id))
    .filter(Boolean);
  const evidenceTrace = synthesizedKnowledgeIds.length
    ? await queryDerivedKnowledgeEvidence({
        tenantId: input.tenantId,
        scope: input.scope,
        synthesizedKnowledgeIds,
      })
    : [];

  // 聚合 evidence 列表（去重，evidenceTrace 可能按 synthesized_knowledge_id 重复）
  const evidenceMap = new Map<string, Record<string, unknown>>();
  for (const row of evidenceTrace) {
    const evidenceId = String(row.evidence_id ?? row.id ?? "");
    if (evidenceId && !evidenceMap.has(evidenceId)) {
      evidenceMap.set(evidenceId, row as Record<string, unknown>);
    }
  }
  const evidence = [...evidenceMap.values()];

  // 治理提案按 proposed_action 前缀分类
  // L2ConflictDetector 用 "l2_" 前缀（如 l2_conflict_skip），L3EvolutionScanner 用 "l3_"，L4CognitiveEngine 用 "l4_"
  // 前缀大小写不敏感判断；同时记录未匹配前缀的归为 "other"，方便诊断
  const proposalsByLayer = {
    l2: [] as Record<string, unknown>[],
    l3: [] as Record<string, unknown>[],
    l4: [] as Record<string, unknown>[],
    other: [] as Record<string, unknown>[],
  };
  for (const proposal of governanceProposals) {
    const action = String(proposal.proposed_action ?? "").toLowerCase();
    if (action.startsWith("l2_")) proposalsByLayer.l2.push(proposal);
    else if (action.startsWith("l3_")) proposalsByLayer.l3.push(proposal);
    else if (action.startsWith("l4_")) proposalsByLayer.l4.push(proposal);
    else proposalsByLayer.other.push(proposal);
  }

  // 动态汇总 entity_type / relation_type（列是 text 无 CHECK，按 DISTINCT 加载）
  const entityTypes = new Set<string>();
  for (const e of entities) {
    const t = String(e.entity_type ?? e.type ?? "unknown");
    entityTypes.add(t);
  }
  const relationTypes = new Set<string>();
  for (const r of allRelations) {
    const t = String(r.relation_type ?? r.type ?? "related_to");
    relationTypes.add(t);
  }

  // ─── P1-4: 合并 utility_score 到四层节点 ───
  // 从 knowledge_utility 视图批量查，让图谱节点按效用着色，展示改善后的知识质量
  const utilityEntryIds = [
    ...synthesizedKnowledge.map((k) => String(k.id)),
    ...rules.map((r) => String(r.id)),
    ...memories.map((m) => String(m.id)),
    ...skills.map((s) => String(s.id)),
  ].filter(Boolean);
  const utilityMap =
    utilityEntryIds.length > 0
      ? await getKnowledgeUtility({
          tenantId: input.tenantId,
          scope: input.scope,
          entryIds: utilityEntryIds,
        })
      : new Map();

  function attachUtility<T extends Record<string, unknown>>(items: T[]): T[] {
    return items.map((item) => {
      const id = String(item.id ?? "");
      const u = utilityMap.get(id);
      return {
        ...item,
        utility_score: u?.utilityScore ?? null,
        total_recalls: u?.totalRecalls ?? 0,
      };
    });
  }
  const rulesWithUtility = attachUtility(
    rules as Record<string, unknown>[],
  ) as typeof rules;
  const memoriesWithUtility = attachUtility(
    memories as Record<string, unknown>[],
  ) as typeof memories;
  const skillsWithUtility = attachUtility(
    skills as Record<string, unknown>[],
  ) as typeof skills;
  const knowledgeWithUtility = attachUtility(
    synthesizedKnowledge as Record<string, unknown>[],
  ) as typeof synthesizedKnowledge;

  // utility 分布统计：high ≥0.8 / medium 0.5-0.8 / low <0.5 / no_signal NULL
  const allWithUtility = [
    ...rulesWithUtility,
    ...memoriesWithUtility,
    ...skillsWithUtility,
    ...knowledgeWithUtility,
  ] as Array<Record<string, unknown>>;
  const utilitySummary = {
    high: allWithUtility.filter(
      (x) =>
        (x.utility_score as number | null) !== null &&
        (x.utility_score as number) >= 0.8,
    ).length,
    medium: allWithUtility.filter(
      (x) =>
        (x.utility_score as number | null) !== null &&
        (x.utility_score as number) >= 0.5 &&
        (x.utility_score as number) < 0.8,
    ).length,
    low: allWithUtility.filter(
      (x) =>
        (x.utility_score as number | null) !== null &&
        (x.utility_score as number) < 0.5,
    ).length,
    no_signal: allWithUtility.filter((x) => x.utility_score === null).length,
  };

  return {
    tenant_id: input.tenantId,
    scope: input.scope,
    stats: {
      entity_count: entities.length,
      fact_count: facts.length,
      relation_count: allRelations.length,
      synthesized_knowledge_count: synthesizedKnowledge.length,
      evidence_count: evidence.length,
      proposal_count: governanceProposals.length,
      l2_proposal_count: proposalsByLayer.l2.length,
      l3_proposal_count: proposalsByLayer.l3.length,
      l4_proposal_count: proposalsByLayer.l4.length,
      other_proposal_count: proposalsByLayer.other.length,
      rule_count: rules.length,
      memory_count: memories.length,
      skill_count: skills.length,
      utility_summary: utilitySummary,
    },
    entities,
    facts,
    relations: allRelations,
    synthesized_knowledge: knowledgeWithUtility,
    evidence,
    evidence_trace: evidenceTrace, // 保留合成知识→evidence 的映射关系
    governance_proposals: governanceProposals,
    proposals_by_layer: proposalsByLayer,
    entity_types: [...entityTypes].sort(),
    relation_types: [...relationTypes].sort(),
    rules: rulesWithUtility,
    memories: memoriesWithUtility,
    skills: skillsWithUtility,
  };
}

export async function listKnowledgeGovernanceRuns(input: {
  tenantId: string;
  scope: string;
  limit?: number;
}) {
  const items = await listKnowledgeGovernanceJobs({
    tenantId: input.tenantId,
    scope: input.scope,
    limit: input.limit ?? 50,
  });
  return { items };
}

export async function getKnowledgeGovernanceRunDetails(input: {
  tenantId: string;
  scope: string;
  jobId: string;
}) {
  const jobs = await listKnowledgeGovernanceJobs({
    tenantId: input.tenantId,
    scope: input.scope,
    limit: 100,
  });
  const job = jobs.find((item) => item.id === input.jobId) ?? null;
  if (!job) {
    return null;
  }

  const [decisions, cleaningLogs, synthesizedKnowledge, recallSurfaceStates] =
    await Promise.all([
      queryKnowledgeGovernanceDecisions({
        tenantId: input.tenantId,
        scope: input.scope,
        governanceJobId: input.jobId,
        limit: 200,
      }),
      queryKnowledgeGovernanceCleaningLogs({
        tenantId: input.tenantId,
        scope: input.scope,
        governanceJobId: input.jobId,
        limit: 200,
      }),
      querySynthesizedKnowledge({
        tenantId: input.tenantId,
        scope: input.scope,
        governanceJobId: input.jobId,
        limit: 100,
      }),
      queryRecallSurfaceStates({
        tenantId: input.tenantId,
        scope: input.scope,
        governanceJobId: input.jobId,
        limit: 300,
      }),
    ]);

  return {
    job,
    decisions,
    cleaning_logs: cleaningLogs,
    synthesized_knowledge: synthesizedKnowledge,
    recall_surface_states: recallSurfaceStates,
  };
}

export async function listKnowledgeGovernanceDecisions(input: {
  tenantId: string;
  scope: string;
  governanceJobId?: string | null;
  limit?: number;
}) {
  const items = await queryKnowledgeGovernanceDecisions({
    tenantId: input.tenantId,
    scope: input.scope,
    governanceJobId: input.governanceJobId ?? null,
    limit: input.limit ?? 100,
  });
  return { items };
}

export async function listSynthesizedKnowledge(input: {
  tenantId: string;
  scope: string;
  governanceJobId?: string | null;
  limit?: number;
}) {
  const items = await querySynthesizedKnowledge({
    tenantId: input.tenantId,
    scope: input.scope,
    governanceJobId: input.governanceJobId ?? null,
    limit: input.limit ?? 100,
  });
  return { items };
}

export async function getSynthesizedKnowledgeDetails(input: {
  tenantId: string;
  scope: string;
  synthesizedKnowledgeId: string;
}) {
  const item = await getSynthesizedKnowledgeById({
    tenantId: input.tenantId,
    scope: input.scope,
    synthesizedKnowledgeId: input.synthesizedKnowledgeId,
  });
  if (!item) {
    return null;
  }

  const evidence_trace = await queryDerivedKnowledgeEvidence({
    tenantId: input.tenantId,
    scope: input.scope,
    synthesizedKnowledgeIds: [input.synthesizedKnowledgeId],
  });

  return {
    item,
    evidence_trace,
  };
}

export async function listRecallSurfaceStates(input: {
  tenantId: string;
  scope: string;
  governanceJobId?: string | null;
  objectType?: string | null;
  limit?: number;
}) {
  const items = await queryRecallSurfaceStates({
    tenantId: input.tenantId,
    scope: input.scope,
    governanceJobId: input.governanceJobId ?? null,
    objectType: input.objectType ?? null,
    limit: input.limit ?? 100,
  });
  return { items };
}

export async function getKnowledgeOpsOverviewData(input: {
  tenantId: string;
  scope: string;
}) {
  const [result, dailyRuns] = await Promise.all([
    getKnowledgeOpsOverview({
      tenantId: input.tenantId,
      scope: input.scope,
    }),
    getDailyGovernanceRuns({
      tenantId: input.tenantId,
      scope: input.scope,
      days: 7,
    }).catch(
      () => [] as Array<{ date: string; l2: number; l3: number; l4: number }>,
    ),
  ]);
  return {
    document_count: Number(result.document_count ?? 0),
    section_count: Number(result.section_count ?? 0),
    evidence_count: Number(result.evidence_count ?? 0),
    entity_count: Number(result.entity_count ?? 0),
    fact_count: Number(result.fact_count ?? 0),
    relation_count: Number(result.relation_count ?? 0),
    active_review_count: Number(result.active_review_count ?? 0),
    governance_job_count: Number(result.governance_job_count ?? 0),
    // 仪表盘拟真字段
    daily_runs: dailyRuns,
    layer_counts: {
      memory: Number(result.memory_count ?? 0),
      knowledge: Number(result.knowledge_count ?? 0),
      rule: Number(result.rule_count ?? 0),
      skill: Number(result.skill_count ?? 0),
    },
    governance_breakdown: {
      approved: Number(result.approved_proposal_count ?? 0),
      rejected: Number(result.rejected_proposal_count ?? 0),
      pending: Number(result.pending_proposal_count ?? 0),
      auto_promoted: 0,
    },
    trace_count: Number(result.trace_count ?? 0),
    gate_trigger_count: Number(result.gate_trigger_count ?? 0),
    plugin_call_count: Number(result.plugin_call_count ?? 0),
    dedup_rate: Number(result.dedup_rate ?? 0),
    corpus_governance: {
      total_document_count: Number(result.total_document_count ?? 0),
      active_document_count: Number(result.document_count ?? 0),
      retired_document_count: Number(result.retired_document_count ?? 0),
      retired_section_count: Number(result.retired_section_count ?? 0),
      retired_evidence_count: Number(result.retired_evidence_count ?? 0),
      retired_fact_count: Number(result.retired_fact_count ?? 0),
      retired_relation_count: Number(result.retired_relation_count ?? 0),
      active_full_markdown_document_count: Number(
        result.active_full_markdown_document_count ?? 0,
      ),
      active_generated_document_count: Number(
        result.active_generated_document_count ?? 0,
      ),
      active_duplicate_markdown_hash_count: Number(
        result.active_duplicate_markdown_hash_count ?? 0,
      ),
      active_duplicate_canonical_source_uri_count: Number(
        result.active_duplicate_canonical_source_uri_count ?? 0,
      ),
      active_temp_test_document_count: Number(
        result.active_temp_test_document_count ?? 0,
      ),
      active_derived_knowledge_count: Number(
        result.active_derived_knowledge_count ?? 0,
      ),
    },
  };
}
