import Fastify from "fastify";
import type {
  FeedbackCommitRequest,
  FeedbackCommitResponse,
  KnowledgeContextBundleResponse,
  KnowledgeDocumentIngestRequest,
  KnowledgeDocumentIngestResponse,
  KnowledgeDocumentListResponse,
  KnowledgeGovernanceJobCreateRequest,
  KnowledgeGovernanceJobCreateResponse,
  KnowledgeGovernanceJobResponse,
  KnowledgeGovernanceRunsResponse,
  KnowledgeGraphListResponse,
  KnowledgeOpsOverviewResponse,
  KnowledgeGovernanceRunRequest,
  KnowledgeGovernanceRunResponse,
  KnowledgeRetrieveRequest,
  KnowledgeRetrieveResponse,
  KnowledgeReviewActionRequest,
  KnowledgeReviewActionResponse,
  KnowledgeReviewQueueResponse,
  MemoryQueryRequest,
  MemoryRetrieveRequest
} from "@super-agent/contracts";
import {
  applyGovernanceChangeProposal,
  createMemoryAccessLog,
  getEnvironmentFingerprint,
  listGovernanceChangeProposals,
} from "@super-agent/db";
import { CandidateRanker } from "./candidateRanker.js";
import { handleCandidateIngress } from "./candidateIngress.js";
import { listCodexHostSessions, previewCodexHostCapture } from "./codexHostCapture.js";
import { formatFrozenErrorResponse } from "./errors.js";
import { listHostSessions, normalizeHost, previewHostCapture } from "./hostCapture.js";
import { buildGovernanceBatchPreview } from "./hostCaptureGovernanceBatch.js";
import { summarizeSession } from "./sessionSummarizer.js";
import { buildMissionBrief } from "./governancePromptBuilder.js";
import { runCodexHostGovernance } from "./hostCaptureGovernanceRun.js";
import { ingestKnowledgeDocument } from "./knowledgeDocumentIngest.js";
import { handleGovernanceRun } from "./governanceRun.js";
import { IndexSyncAdapter } from "./indexSyncAdapter.js";
import { createKnowledgeGovernanceJobRecord, getKnowledgeGovernanceJobRecord, runKnowledgeGovernance } from "./knowledgeGovernance.js";
import { buildKnowledgeRetrieveBundle } from "./knowledgeRetrieve.js";
import {
  getKnowledgeContextBundle,
  getKnowledgeDocumentDetails,
  getKnowledgeGovernanceRunDetails,
  getKnowledgeOpsOverviewData,
  getSynthesizedKnowledgeDetails,
  handleKnowledgeReviewAction,
  listKnowledgeDocuments,
  listKnowledgeGovernanceDecisions,
  listKnowledgeGovernanceRuns,
  listKnowledgeGraphEntities,
  listKnowledgeGraphFacts,
  listKnowledgeGraphRelations,
  listKnowledgeReviewQueueItems,
  listRecallSurfaceStates,
  listSynthesizedKnowledge
} from "./knowledgeReview.js";
import { LifecycleWorker } from "./lifecycleWorker.js";
import { MemoryExtractor } from "./memoryExtractor.js";
import { getDefaultScope, getDefaultTenantId, isSingleTenantMode } from "./memoryPolicyEngine.js";
import { MemoryRouter } from "./memoryRouter.js";
import { queryMemoryByKind } from "./queries.js";
import { resolveRequestContext, getTraceId } from "./requestContext.js";
import { ResidentMemoryBuilder } from "./residentMemoryBuilder.js";
import { RetrievalGate } from "./retrievalGate.js";
import { buildRetrieveBundle } from "./retrieveBundle.js";
import { handleRuleGateCheck } from "./ruleGateCheck.js";
import { RuleBuilder } from "./ruleBuilder.js";
import { SkillBuilder } from "./skillBuilder.js";
import { SummaryGenerator } from "./summaryGenerator.js";

export function buildMemoryServiceApp() {
  const app = Fastify({ logger: false });
  const extractor = new MemoryExtractor();
  const ranker = new CandidateRanker();
  const router = new MemoryRouter();
  const ruleBuilder = new RuleBuilder();
  const skillBuilder = new SkillBuilder();
  const residentBuilder = new ResidentMemoryBuilder();
  const retrievalGate = new RetrievalGate();
  const indexSyncAdapter = new IndexSyncAdapter();
  const lifecycleWorker = new LifecycleWorker();
  const summaryGenerator = new SummaryGenerator();

  app.setErrorHandler((error, request, reply) => {
    const traceId = getTraceId(request.headers as Record<string, unknown>, `trace-memory-error-${Date.now()}`);
    const frozen = formatFrozenErrorResponse({
      error,
      traceId
    });

    reply.status(frozen.statusCode).send(frozen.body);
  });

  app.get("/healthz", async () => ({
    service: "memory-service",
    ok: true,
    single_tenant_mode: isSingleTenantMode(),
    default_tenant_id: getDefaultTenantId(),
    default_scope: getDefaultScope()
  }));

  app.post("/internal/memory/query", async (request) => {
    const body = (request.body ?? {}) as MemoryQueryRequest;
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "memory-query");

    const kind = typeof body.kind === "string" ? body.kind : "resident";
    const fingerprint = typeof body.fingerprint === "string" ? body.fingerprint : null;
    const limit = typeof body.limit === "number" ? body.limit : 10;
    const items = await queryMemoryByKind({
      tenantId: context.tenantId,
      scope: context.scope,
      kind,
      taskRequestId: body.task_request_id ?? null,
      fingerprint,
      limit
    });

    await createMemoryAccessLog({
      tenantId: context.tenantId,
      scope: context.scope,
      queryKind: `query:${kind}`,
      queryPayload: {
        task_request_id: body.task_request_id ?? null,
        fingerprint,
        limit
      },
      decisionPayload: {
        count: items.length,
        single_tenant_mode: isSingleTenantMode()
      },
      objectType: "layer",
      objectRef: kind,
      traceId: context.traceId
    });

    return {
      kind,
      tenant_id: context.tenantId,
      scope: context.scope,
      single_tenant_mode: isSingleTenantMode(),
      items
    };
  });

  app.post("/internal/memory/candidates", async (request) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "memory-candidate");
    return handleCandidateIngress({
      tenantId: context.tenantId,
      scope: context.scope,
      traceId: context.traceId,
      body: request.body as import("@super-agent/contracts").MemoryCandidateRequest,
      extractor,
      ranker,
      router,
      ruleBuilder,
      skillBuilder
    });
  });

  app.post("/internal/memory/retrieve", async (request) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "memory-retrieve");
    const body = request.body as MemoryRetrieveRequest;
    return buildRetrieveBundle({
      tenantId: context.tenantId,
      scope: context.scope,
      traceId: context.traceId,
      body,
      retrievalGate
    });
  });

  app.post("/internal/rules/gate/check", async (request) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "rule-gate-check");
    return handleRuleGateCheck({
      tenantId: context.tenantId,
      scope: context.scope,
      traceId: context.traceId,
      body: request.body as {
        task_request_id: string;
        task_step_id?: string | null;
        task_type?: string | null;
        host?: string | null;
        project_ref?: string | null;
        operation: string;
        checkpoint_keys?: string[] | null;
        evidence?: Record<string, unknown> | null;
        actor_ref?: string | null;
      }
    });
  });

  app.post("/internal/memory/governance/run", async (request) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "memory-governance");
    return handleGovernanceRun({
      tenantId: context.tenantId,
      scope: context.scope,
      traceId: context.traceId,
      body: request.body as import("@super-agent/contracts").GovernanceRunRequest,
      summaryGenerator,
      residentBuilder,
      indexSyncAdapter,
      lifecycleWorker
    });
  });

  app.post("/internal/host-capture/codex/preview", async (request, reply) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "host-capture-codex-preview");
    const body = (request.body ?? {}) as {
      codex_home?: string | null;
      thread_id?: string | null;
      max_items?: number | null;
    };

    try {
      return await previewCodexHostCapture({
        codex_home: body.codex_home ?? null,
        thread_id: body.thread_id ?? null,
        max_items: body.max_items ?? null
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.status(400);
      return {
        error_code: "CODEX_HOST_CAPTURE_PREVIEW_FAILED",
        message,
        trace_id: context.traceId,
        retryable: false,
        details: {
          codex_home: body.codex_home ?? null,
          thread_id: body.thread_id ?? null
        }
      };
    }
  });

  app.post("/internal/host-capture/:host/preview", async (request, reply) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "host-capture-preview");
    const params = request.params as { host: string };
    const body = (request.body ?? {}) as {
      host_home?: string | null;
      codex_home?: string | null;
      thread_id?: string | null;
      max_items?: number | null;
    };
    const host = normalizeHost(params.host);

    try {
      return await previewHostCapture({
        host,
        host_home: body.host_home ?? body.codex_home ?? null,
        codex_home: body.codex_home ?? body.host_home ?? null,
        thread_id: body.thread_id ?? null,
        max_items: body.max_items ?? null
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.status(400);
      return {
        error_code: "HOST_CAPTURE_PREVIEW_FAILED",
        message,
        trace_id: context.traceId,
        retryable: false,
        details: {
          host,
          host_home: body.host_home ?? body.codex_home ?? null,
          thread_id: body.thread_id ?? null
        }
      };
    }
  });

  app.get("/internal/host-capture/codex/sessions", async (request, reply) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "host-capture-codex-sessions");
    const query = (request.query ?? {}) as {
      codex_home?: string | null;
      limit?: string | number | null;
    };

    try {
      return await listCodexHostSessions({
        codex_home: query.codex_home ?? null,
        limit:
          typeof query.limit === "number"
            ? query.limit
            : typeof query.limit === "string" && query.limit.trim()
              ? Number(query.limit)
              : null
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.status(400);
      return {
        error_code: "CODEX_HOST_CAPTURE_SESSION_LIST_FAILED",
        message,
        trace_id: context.traceId,
        retryable: false,
        details: {
          codex_home: query.codex_home ?? null,
          limit: query.limit ?? null
        }
      };
    }
  });

  app.get("/internal/host-capture/:host/sessions", async (request, reply) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "host-capture-sessions");
    const params = request.params as { host: string };
    const query = (request.query ?? {}) as {
      host_home?: string | null;
      codex_home?: string | null;
      limit?: string | number | null;
    };
    const host = normalizeHost(params.host);

    try {
      return await listHostSessions({
        host,
        host_home: query.host_home ?? query.codex_home ?? null,
        codex_home: query.codex_home ?? query.host_home ?? null,
        limit:
          typeof query.limit === "number"
            ? query.limit
            : typeof query.limit === "string" && query.limit.trim()
              ? Number(query.limit)
              : null
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.status(400);
      return {
        error_code: "HOST_CAPTURE_SESSION_LIST_FAILED",
        message,
        trace_id: context.traceId,
        retryable: false,
        details: {
          host,
          host_home: query.host_home ?? query.codex_home ?? null,
          limit: query.limit ?? null
        }
      };
    }
  });

  app.post("/internal/host-capture/codex/governance-batch-preview", async (request, reply) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "host-capture-codex-batch-preview");
    const body = (request.body ?? {}) as {
      codex_home?: string | null;
      thread_id?: string | null;
      max_items?: number | null;
    };

    try {
      const preview = await previewCodexHostCapture({
        codex_home: body.codex_home ?? null,
        thread_id: body.thread_id ?? null,
        max_items: body.max_items ?? null
      });
      const batch = buildGovernanceBatchPreview(preview);

      // Two-Step MCP Dance — Step 1: build mission brief for host LLM extraction
      let mission_brief: { text: string; governance_mode: "host_model" } | null = null;
      try {
        const summarized = summarizeSession(preview);
        mission_brief = buildMissionBrief(summarized);
      } catch {
        // Mission brief is best-effort; batch preview still valid without it
      }

      return { ...batch, mission_brief };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.status(400);
      return {
        error_code: "CODEX_GOVERNANCE_BATCH_PREVIEW_FAILED",
        message,
        trace_id: context.traceId,
        retryable: false,
        details: {
          codex_home: body.codex_home ?? null,
          thread_id: body.thread_id ?? null
        }
      };
    }
  });

  app.post("/internal/host-capture/:host/governance-batch-preview", async (request, reply) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "host-capture-governance-batch-preview");
    const params = request.params as { host: string };
    const body = (request.body ?? {}) as {
      host_home?: string | null;
      codex_home?: string | null;
      thread_id?: string | null;
      max_items?: number | null;
    };
    const host = normalizeHost(params.host);

    try {
      const preview = await previewHostCapture({
        host,
        host_home: body.host_home ?? body.codex_home ?? null,
        codex_home: body.codex_home ?? body.host_home ?? null,
        thread_id: body.thread_id ?? null,
        max_items: body.max_items ?? null
      });
      const batch = buildGovernanceBatchPreview(preview);

      // Two-Step MCP Dance — Step 1: build mission brief for host LLM extraction
      let mission_brief: { text: string; governance_mode: "host_model" } | null = null;
      try {
        const summarized = summarizeSession(preview);
        mission_brief = buildMissionBrief(summarized);
      } catch {
        // Mission brief is best-effort; batch preview still valid without it
      }

      return { ...batch, mission_brief };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.status(400);
      return {
        error_code: "HOST_GOVERNANCE_BATCH_PREVIEW_FAILED",
        message,
        trace_id: context.traceId,
        retryable: false,
        details: {
          host,
          host_home: body.host_home ?? body.codex_home ?? null,
          thread_id: body.thread_id ?? null
        }
      };
    }
  });

  app.post("/internal/host-capture/codex/governance-run", async (request, reply) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "host-capture-codex-governance-run");
    const body = (request.body ?? {}) as {
      codex_home?: string | null;
      thread_id?: string | null;
      max_items?: number | null;
      task_request_id?: string | null;
      fingerprint?: string | null;
      governance_mode?: "rules_fallback" | "host_model" | null;
      host_model_result?: Record<string, unknown> | null;
    };

    try {
      return await runCodexHostGovernance({
        tenantId: context.tenantId,
        scope: context.scope,
        traceId: context.traceId,
        body
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.status(400);
      return {
        error_code: "CODEX_GOVERNANCE_RUN_FAILED",
        message,
        trace_id: context.traceId,
        retryable: false,
        details: {
          codex_home: body.codex_home ?? null,
          thread_id: body.thread_id ?? null
        }
      };
    }
  });

  app.post("/internal/host-capture/:host/governance-run", async (request, reply) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "host-capture-governance-run");
    const params = request.params as { host: string };
    const body = (request.body ?? {}) as {
      host_home?: string | null;
      codex_home?: string | null;
      thread_id?: string | null;
      max_items?: number | null;
      task_request_id?: string | null;
      fingerprint?: string | null;
      governance_mode?: "rules_fallback" | "host_model" | null;
      host_model_result?: Record<string, unknown> | null;
    };
    const host = normalizeHost(params.host);

    try {
      return await runCodexHostGovernance({
        tenantId: context.tenantId,
        scope: context.scope,
        traceId: context.traceId,
        body: {
          ...body,
          host,
          host_home: body.host_home ?? body.codex_home ?? null,
          codex_home: body.codex_home ?? body.host_home ?? null
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reply.status(400);
      return {
        error_code: "HOST_GOVERNANCE_RUN_FAILED",
        message,
        trace_id: context.traceId,
        retryable: false,
        details: {
          host,
          host_home: body.host_home ?? body.codex_home ?? null,
          thread_id: body.thread_id ?? null
        }
      };
    }
  });

  app.get("/internal/governance/change-proposals", async (request) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "governance-change-proposals");
    const query = (request.query ?? {}) as { status?: string; limit?: number | string };
    const limit = typeof query.limit === "string" ? Number(query.limit) : query.limit;
    const items = await listGovernanceChangeProposals({
      tenantId: context.tenantId,
      scope: context.scope,
      status: query.status ?? "recorded",
      limit: Number.isFinite(limit) ? Number(limit) : 50
    });
    return {
      tenant_id: context.tenantId,
      scope: context.scope,
      items
    };
  });

  app.post("/internal/governance/change-proposals/:proposalId/actions", async (request, reply) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "governance-change-proposal-action");
    const params = request.params as { proposalId: string };
    const body = (request.body ?? {}) as { action?: string; payload?: Record<string, unknown>; fingerprint?: string };
    if (body.action !== "approve" && body.action !== "reject") {
      reply.status(400);
      return {
        error_code: "INVALID_GOVERNANCE_CHANGE_ACTION",
        message: "action must be approve or reject",
        trace_id: context.traceId,
        retryable: false,
        details: {}
      };
    }
    const item = await applyGovernanceChangeProposal({
      tenantId: context.tenantId,
      scope: context.scope,
      proposalId: params.proposalId,
      action: body.action,
      humanResponse: body.payload ?? {},
      traceId: context.traceId
    });
    if (!item) {
      reply.status(404);
      return {
        error_code: "GOVERNANCE_CHANGE_PROPOSAL_NOT_FOUND",
        message: `Governance change proposal not found or already resolved: ${params.proposalId}`,
        trace_id: context.traceId,
        retryable: false,
        details: {}
      };
    }
    let rebuiltSnapshotId: string | null = null;
    let indexSync: Awaited<ReturnType<IndexSyncAdapter["sync"]>> | null = null;
    if (body.action === "approve") {
      rebuiltSnapshotId = await residentBuilder.rebuild({
        tenantId: context.tenantId,
        scope: context.scope,
        fingerprint: body.fingerprint ?? null,
        dirtyReason: "governance-change-approved",
        traceId: context.traceId
      });
      indexSync = await indexSyncAdapter.sync({
        tenantId: context.tenantId,
        scope: context.scope,
        fingerprint: body.fingerprint ?? null
      });
    }
    return {
      item,
      rebuilt_snapshot_id: rebuiltSnapshotId,
      index_sync: indexSync
    };
  });

  app.post("/internal/knowledge/governance/jobs", async (request) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "knowledge-governance-job-create");
    const body = request.body as KnowledgeGovernanceJobCreateRequest;
    const response: KnowledgeGovernanceJobCreateResponse = await createKnowledgeGovernanceJobRecord({
      tenantId: context.tenantId,
      scope: context.scope,
      traceId: context.traceId,
      body
    });
    return response;
  });

  app.get("/internal/knowledge/governance/jobs/:jobId", async (request, reply) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "knowledge-governance-job-get");
    const params = request.params as { jobId: string };
    const response = await getKnowledgeGovernanceJobRecord({
      tenantId: context.tenantId,
      scope: context.scope,
      jobId: params.jobId
    });

    if (!response) {
      reply.status(404);
      return {
        error_code: "KNOWLEDGE_GOVERNANCE_JOB_NOT_FOUND",
        message: `Knowledge governance job not found: ${params.jobId}`,
        trace_id: context.traceId,
        retryable: false,
        details: {}
      };
    }

    return response as KnowledgeGovernanceJobResponse;
  });

  app.post("/internal/knowledge/governance/run", async (request) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "knowledge-governance-run");
    const body = request.body as KnowledgeGovernanceRunRequest;
    const response: KnowledgeGovernanceRunResponse = await runKnowledgeGovernance({
      tenantId: context.tenantId,
      scope: context.scope,
      traceId: context.traceId,
      body
    });
    return response;
  });

  app.post("/internal/knowledge/documents/ingest", async (request) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "knowledge-document-ingest");
    const body = request.body as KnowledgeDocumentIngestRequest;
    const response: KnowledgeDocumentIngestResponse = await ingestKnowledgeDocument({
      tenantId: context.tenantId,
      scope: context.scope,
      traceId: context.traceId,
      body,
      extractor,
      ranker,
      router,
      ruleBuilder,
      skillBuilder
    });
    return response;
  });

  app.get("/internal/knowledge/documents", async (request) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "knowledge-documents");
    const query = (request.query ?? {}) as { q?: string; limit?: number | string; offset?: number | string };
    const limit = typeof query.limit === "string" ? Number(query.limit) : query.limit;
    const offset = typeof query.offset === "string" ? Number(query.offset) : query.offset;
    const response: KnowledgeDocumentListResponse = await listKnowledgeDocuments({
      tenantId: context.tenantId,
      scope: context.scope,
      query: query.q ?? null,
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined
    });
    return response;
  });

  app.get("/internal/knowledge/documents/:documentId", async (request, reply) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "knowledge-document-detail");
    const params = request.params as { documentId: string };
    const response = await getKnowledgeDocumentDetails({
      tenantId: context.tenantId,
      scope: context.scope,
      documentId: params.documentId
    });
    if (!response) {
      reply.status(404);
      return {
        error_code: "KNOWLEDGE_DOCUMENT_NOT_FOUND",
        message: `Knowledge document not found: ${params.documentId}`,
        trace_id: context.traceId,
        retryable: false,
        details: {}
      };
    }
    return response;
  });

  app.get("/internal/knowledge/review-queue", async (request) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "knowledge-review-queue");
    const query = (request.query ?? {}) as { status?: string; review_reason?: string; limit?: number };
    const response: KnowledgeReviewQueueResponse = await listKnowledgeReviewQueueItems({
      tenantId: context.tenantId,
      scope: context.scope,
      status: query.status ?? null,
      reviewReason: query.review_reason ?? null,
      limit: typeof query.limit === "number" ? query.limit : undefined
    });
    return response;
  });

  app.post("/internal/knowledge/review-queue/:reviewQueueId/actions", async (request) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "knowledge-review-action");
    const params = request.params as { reviewQueueId: string };
    const body = request.body as KnowledgeReviewActionRequest;
    const response: KnowledgeReviewActionResponse = await handleKnowledgeReviewAction({
      tenantId: context.tenantId,
      scope: context.scope,
      traceId: context.traceId,
      reviewQueueId: params.reviewQueueId,
      body
    });
    return response;
  });

  app.get("/internal/knowledge/context-bundles/:bundleId", async (request, reply) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "knowledge-context-bundle");
    const params = request.params as { bundleId: string };
    const response = await getKnowledgeContextBundle({
      tenantId: context.tenantId,
      scope: context.scope,
      bundleId: params.bundleId
    });

    if (!response) {
      reply.status(404);
      return {
        error_code: "KNOWLEDGE_CONTEXT_BUNDLE_NOT_FOUND",
        message: `Knowledge context bundle not found: ${params.bundleId}`,
        trace_id: context.traceId,
        retryable: false,
        details: {}
      };
    }

    return response as KnowledgeContextBundleResponse;
  });

  app.post("/internal/knowledge/retrieve", async (request) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "knowledge-retrieve");
    const body = request.body as KnowledgeRetrieveRequest;
    const response: KnowledgeRetrieveResponse = await buildKnowledgeRetrieveBundle({
      tenantId: context.tenantId,
      scope: context.scope,
      traceId: context.traceId,
      body,
      retrievalGate
    });
    return response;
  });

  app.get("/internal/knowledge/graph/entities", async (request) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "knowledge-graph-entities");
    const query = (request.query ?? {}) as { q?: string; limit?: number };
    const response: KnowledgeGraphListResponse = await listKnowledgeGraphEntities({
      tenantId: context.tenantId,
      scope: context.scope,
      query: query.q ?? null,
      limit: typeof query.limit === "number" ? query.limit : undefined
    });
    return response;
  });

  app.get("/internal/knowledge/graph/facts", async (request) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "knowledge-graph-facts");
    const query = (request.query ?? {}) as { q?: string; limit?: number };
    const response: KnowledgeGraphListResponse = await listKnowledgeGraphFacts({
      tenantId: context.tenantId,
      scope: context.scope,
      query: query.q ?? null,
      limit: typeof query.limit === "number" ? query.limit : undefined
    });
    return response;
  });

  app.get("/internal/knowledge/graph/relations", async (request) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "knowledge-graph-relations");
    const query = (request.query ?? {}) as { object_ids?: string | string[]; limit?: number };
    const objectIds =
      typeof query.object_ids === "string"
        ? query.object_ids.split(",").map((item) => item.trim()).filter(Boolean)
        : Array.isArray(query.object_ids)
          ? query.object_ids.flatMap((item) => item.split(",")).map((item) => item.trim()).filter(Boolean)
          : [];
    const response: KnowledgeGraphListResponse = await listKnowledgeGraphRelations({
      tenantId: context.tenantId,
      scope: context.scope,
      objectIds,
      limit: typeof query.limit === "number" ? query.limit : undefined
    });
    return response;
  });

  app.get("/internal/knowledge/governance/runs", async (request) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "knowledge-governance-runs");
    const query = (request.query ?? {}) as { limit?: number };
    const response: KnowledgeGovernanceRunsResponse = await listKnowledgeGovernanceRuns({
      tenantId: context.tenantId,
      scope: context.scope,
      limit: typeof query.limit === "number" ? query.limit : undefined
    });
    return response;
  });

  app.get("/internal/knowledge/governance/runs/:jobId", async (request, reply) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "knowledge-governance-run-detail");
    const params = request.params as { jobId: string };
    const response = await getKnowledgeGovernanceRunDetails({
      tenantId: context.tenantId,
      scope: context.scope,
      jobId: params.jobId
    });
    if (!response) {
      reply.status(404);
      return {
        error_code: "KNOWLEDGE_GOVERNANCE_RUN_NOT_FOUND",
        message: `Knowledge governance run not found: ${params.jobId}`,
        trace_id: context.traceId,
        retryable: false,
        details: {}
      };
    }
    return response;
  });

  app.get("/internal/knowledge/governance/decisions", async (request) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "knowledge-governance-decisions");
    const query = (request.query ?? {}) as { job_id?: string; limit?: number | string };
    const limit = typeof query.limit === "string" ? Number(query.limit) : query.limit;
    return listKnowledgeGovernanceDecisions({
      tenantId: context.tenantId,
      scope: context.scope,
      governanceJobId: query.job_id ?? null,
      limit: Number.isFinite(limit) ? limit : undefined
    });
  });

  app.get("/internal/knowledge/synthesized-knowledge", async (request) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "knowledge-synthesized-knowledge");
    const query = (request.query ?? {}) as { job_id?: string; limit?: number | string };
    const limit = typeof query.limit === "string" ? Number(query.limit) : query.limit;
    return listSynthesizedKnowledge({
      tenantId: context.tenantId,
      scope: context.scope,
      governanceJobId: query.job_id ?? null,
      limit: Number.isFinite(limit) ? limit : undefined
    });
  });

  app.get("/internal/knowledge/synthesized-knowledge/:synthesizedKnowledgeId", async (request, reply) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "knowledge-synthesized-knowledge-detail");
    const params = request.params as { synthesizedKnowledgeId: string };
    const response = await getSynthesizedKnowledgeDetails({
      tenantId: context.tenantId,
      scope: context.scope,
      synthesizedKnowledgeId: params.synthesizedKnowledgeId
    });
    if (!response) {
      reply.status(404);
      return {
        error_code: "SYNTHESIZED_KNOWLEDGE_NOT_FOUND",
        message: `Synthesized knowledge not found: ${params.synthesizedKnowledgeId}`,
        trace_id: context.traceId,
        retryable: false,
        details: {}
      };
    }
    return response;
  });

  app.get("/internal/knowledge/recall-surface", async (request) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "knowledge-recall-surface");
    const query = (request.query ?? {}) as { job_id?: string; object_type?: string; limit?: number | string };
    const limit = typeof query.limit === "string" ? Number(query.limit) : query.limit;
    return listRecallSurfaceStates({
      tenantId: context.tenantId,
      scope: context.scope,
      governanceJobId: query.job_id ?? null,
      objectType: query.object_type ?? null,
      limit: Number.isFinite(limit) ? limit : undefined
    });
  });

  app.get("/internal/knowledge/ops/overview", async (request) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "knowledge-ops-overview");
    const response: KnowledgeOpsOverviewResponse = await getKnowledgeOpsOverviewData({
      tenantId: context.tenantId,
      scope: context.scope
    });
    return response;
  });

  app.post("/internal/feedback/commit", async (request) => {
    const body = request.body as FeedbackCommitRequest;
    const response: FeedbackCommitResponse = {
      feedback_status: "committed",
      affected_objects: [
        `task_step:${body.task_step_id}`,
        body.verification_result_id ? `verification_result:${body.verification_result_id}` : "policy_feedback"
      ],
      committed_at: new Date().toISOString()
    };

    return response;
  });

  app.post("/internal/memory/debug/fingerprint", async (request) => {
    const context = resolveRequestContext(request.headers as Record<string, unknown>, "memory-debug-fingerprint");
    const body = (request.body ?? {}) as { fingerprint?: string };

    if (!body.fingerprint) {
      return { fingerprint: null, record: null };
    }

    const record = await getEnvironmentFingerprint({
      tenantId: context.tenantId,
      scope: context.scope,
      fingerprintKey: body.fingerprint
    });

    return {
      fingerprint: body.fingerprint,
      record
    };
  });

  return app;
}
