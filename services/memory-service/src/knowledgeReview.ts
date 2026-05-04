import {
  applyKnowledgeReviewAction,
  getKnowledgeDocumentById,
  getKnowledgeOpsOverview,
  getKnowledgeContextBundleById,
  getSynthesizedKnowledgeById,
  listKnowledgeGovernanceJobs,
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
  querySynthesizedKnowledge
} from "@super-agent/db";

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
    limit: input.limit ?? 50
  });

  return {
    tenant_id: input.tenantId,
    scope: input.scope,
    items
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
    traceId: input.traceId
  });

  return {
    review_queue_id: input.reviewQueueId,
    action: input.body.action,
    status: "resolved",
    resolved_at: new Date().toISOString()
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
    bundleId: input.bundleId
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
        created_at: bundle.created_at
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
    limit: input.limit ?? 50
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
    offset: input.offset ?? 0
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
    documentId: input.documentId
  });
  if (!document) {
    return null;
  }

  const [sections, facts, relations, evidence] = await Promise.all([
    queryKnowledgeSectionsByDocumentId({
      tenantId: input.tenantId,
      scope: input.scope,
      documentId: input.documentId,
      limit: 100
    }),
    queryKnowledgeFactsByDocumentId({
      tenantId: input.tenantId,
      scope: input.scope,
      documentId: input.documentId,
      limit: 100
    }),
    queryKnowledgeRelationsByDocumentId({
      tenantId: input.tenantId,
      scope: input.scope,
      documentId: input.documentId,
      limit: 100
    }),
    queryKnowledgeEvidenceByDocumentId({
      tenantId: input.tenantId,
      scope: input.scope,
      documentId: input.documentId,
      limit: 100
    })
  ]);

  return {
    document,
    sections,
    facts,
    relations,
    evidence
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
    limit: input.limit ?? 50
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
    limit: input.limit ?? 50
  });
  return { items };
}

export async function listKnowledgeGovernanceRuns(input: {
  tenantId: string;
  scope: string;
  limit?: number;
}) {
  const items = await listKnowledgeGovernanceJobs({
    tenantId: input.tenantId,
    scope: input.scope,
    limit: input.limit ?? 50
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
    limit: 100
  });
  const job = jobs.find((item) => item.id === input.jobId) ?? null;
  if (!job) {
    return null;
  }

  const [decisions, cleaningLogs, synthesizedKnowledge, recallSurfaceStates] = await Promise.all([
    queryKnowledgeGovernanceDecisions({
      tenantId: input.tenantId,
      scope: input.scope,
      governanceJobId: input.jobId,
      limit: 200
    }),
    queryKnowledgeGovernanceCleaningLogs({
      tenantId: input.tenantId,
      scope: input.scope,
      governanceJobId: input.jobId,
      limit: 200
    }),
    querySynthesizedKnowledge({
      tenantId: input.tenantId,
      scope: input.scope,
      governanceJobId: input.jobId,
      limit: 100
    }),
    queryRecallSurfaceStates({
      tenantId: input.tenantId,
      scope: input.scope,
      governanceJobId: input.jobId,
      limit: 300
    })
  ]);

  return {
    job,
    decisions,
    cleaning_logs: cleaningLogs,
    synthesized_knowledge: synthesizedKnowledge,
    recall_surface_states: recallSurfaceStates
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
    limit: input.limit ?? 100
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
    limit: input.limit ?? 100
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
    synthesizedKnowledgeId: input.synthesizedKnowledgeId
  });
  if (!item) {
    return null;
  }

  const evidence_trace = await queryDerivedKnowledgeEvidence({
    tenantId: input.tenantId,
    scope: input.scope,
    synthesizedKnowledgeIds: [input.synthesizedKnowledgeId]
  });

  return {
    item,
    evidence_trace
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
    limit: input.limit ?? 100
  });
  return { items };
}

export async function getKnowledgeOpsOverviewData(input: {
  tenantId: string;
  scope: string;
}) {
  const result = await getKnowledgeOpsOverview({
    tenantId: input.tenantId,
    scope: input.scope
  });
  return {
    document_count: Number(result.document_count ?? 0),
    section_count: Number(result.section_count ?? 0),
    evidence_count: Number(result.evidence_count ?? 0),
    entity_count: Number(result.entity_count ?? 0),
    fact_count: Number(result.fact_count ?? 0),
    relation_count: Number(result.relation_count ?? 0),
    active_review_count: Number(result.active_review_count ?? 0),
    governance_job_count: Number(result.governance_job_count ?? 0),
    corpus_governance: {
      total_document_count: Number(result.total_document_count ?? 0),
      active_document_count: Number(result.document_count ?? 0),
      retired_document_count: Number(result.retired_document_count ?? 0),
      retired_section_count: Number(result.retired_section_count ?? 0),
      retired_evidence_count: Number(result.retired_evidence_count ?? 0),
      retired_fact_count: Number(result.retired_fact_count ?? 0),
      retired_relation_count: Number(result.retired_relation_count ?? 0),
      active_full_markdown_document_count: Number(result.active_full_markdown_document_count ?? 0),
      active_generated_document_count: Number(result.active_generated_document_count ?? 0),
      active_duplicate_markdown_hash_count: Number(result.active_duplicate_markdown_hash_count ?? 0),
      active_duplicate_canonical_source_uri_count: Number(result.active_duplicate_canonical_source_uri_count ?? 0),
      active_temp_test_document_count: Number(result.active_temp_test_document_count ?? 0),
      active_derived_knowledge_count: Number(result.active_derived_knowledge_count ?? 0)
    }
  };
}
