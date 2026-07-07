import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
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
  MemoryRetrieveRequest,
} from "@super-agent/contracts";
import {
  applyGovernanceChangeProposal,
  createMemoryAccessLog,
  getEnvironmentFingerprint,
  getPool,
  listActiveRules,
  listActiveSkills,
  listGovernanceChangeProposals,
  updateMemoryRecord,
  updateRuleRecord,
  updateSkillRecord,
  updateSynthesizedKnowledgeRecord,
  upsertHostSkill,
  upsertHostMemory,
  upsertHostRule,
} from "@super-agent/db";
import { CandidateRanker } from "./candidateRanker.js";
import { handleCandidateIngress } from "./candidateIngress.js";
import {
  listCodexHostSessions,
  previewCodexHostCapture,
} from "./codexHostCapture.js";
import { formatFrozenErrorResponse } from "./errors.js";
import {
  listHostSessions,
  normalizeHost,
  previewHostCapture,
} from "./hostCapture.js";
import {
  issuePreviewToken,
  validatePreviewToken,
  consumePreviewToken,
} from "./previewTokenStore.js";
import { buildGovernanceBatchPreview } from "./hostCaptureGovernanceBatch.js";
import { summarizeSession } from "./sessionSummarizer.js";
import { buildMissionBrief } from "./governancePromptBuilder.js";
import {
  runCodexHostGovernance,
  runGovernanceFromExtraction,
} from "./hostCaptureGovernanceRun.js";
import { ingestKnowledgeDocument } from "./knowledgeDocumentIngest.js";
import { handleGovernanceRun } from "./governanceRun.js";
import { IndexSyncAdapter } from "./indexSyncAdapter.js";
import {
  createKnowledgeGovernanceJobRecord,
  getKnowledgeGovernanceJobRecord,
  runKnowledgeGovernance,
} from "./knowledgeGovernance.js";
import { buildKnowledgeRetrieveBundle } from "./knowledgeRetrieve.js";
import {
  getKnowledgeContextBundle,
  getKnowledgeDocumentDetails,
  getKnowledgeGovernanceRunDetails,
  getKnowledgeGraphOverview,
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
  listSynthesizedKnowledge,
} from "./knowledgeReview.js";
import { LifecycleWorker } from "./lifecycleWorker.js";
import { MemoryExtractor } from "./memoryExtractor.js";
import {
  getDefaultScope,
  getDefaultTenantId,
  isSingleTenantMode,
} from "./memoryPolicyEngine.js";
import { MemoryRouter } from "./memoryRouter.js";
import { queryMemoryByKind } from "./queries.js";
import {
  resolveRequestContext,
  getTraceId,
  resolveScopeFromQueryOrHeader,
} from "./requestContext.js";
import { ResidentMemoryBuilder } from "./residentMemoryBuilder.js";
import { RetrievalGate } from "./retrievalGate.js";
import { buildRetrieveBundle } from "./retrieveBundle.js";
import { fetchPendingHostActions, markHostActionStatus } from "./hostAction.js";
import { executeHostActions } from "./hostActionExecutor.js";
import { handleRuleGateCheck } from "./ruleGateCheck.js";
import { RuleBuilder } from "./ruleBuilder.js";
import { SkillBuilder } from "./skillBuilder.js";
import { SummaryGenerator } from "./summaryGenerator.js";
import { registerHostBootstrap } from "./hostBootstrap.js";
import {
  detectLearningChains,
  type LearningChainEvent,
} from "./governance/learningChainDetector.js";

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

  async function batchCountAccessLogs(input: {
    tenantId: string;
    scope: string;
    objectType: string;
    objectIds: string[];
  }): Promise<Record<string, number>> {
    if (!input.objectIds.length) return {};
    const db = getPool();
    const result = await db.query(
      `SELECT object_ref, COUNT(*) AS cnt
       FROM memory_access_log
       WHERE tenant_id = $1 AND scope = $2 AND object_type = $3 AND object_ref = ANY($4)
       GROUP BY object_ref`,
      [input.tenantId, input.scope, input.objectType, input.objectIds],
    );
    const counts: Record<string, number> = {};
    for (const row of result.rows) {
      counts[String(row.object_ref)] = Number(row.cnt);
    }
    return counts;
  }

  function attachRecallCounts(
    items: Array<{ id: string }>,
    counts: Record<string, number>,
  ) {
    for (const item of items) {
      (item as Record<string, unknown>).recall_count = counts[item.id] ?? 0;
    }
  }

  app.setErrorHandler((error, request, reply) => {
    const traceId = getTraceId(
      request.headers as Record<string, unknown>,
      `trace-memory-error-${Date.now()}`,
    );
    const frozen = formatFrozenErrorResponse({
      error,
      traceId,
    });

    reply.status(frozen.statusCode).send(frozen.body);
  });

  // public 目录位于 services/memory-service/public。
  // - 源码运行 (tsx dev)：import.meta.dirname = .../services/memory-service/src → ../public 正确
  // - 编译后运行 (dist)：import.meta.dirname = .../dist/services/memory-service/src → ../public 不存在，
  //   需要回溯到仓库根再进 services/memory-service/public
  const devPublicDir = path.resolve(import.meta.dirname, "../public");
  const distPublicDir = path.resolve(import.meta.dirname, "../../../../public");
  const publicDir = existsSync(devPublicDir) ? devPublicDir : distPublicDir;

  // GitHub Pages 兼容：static 挂载到根路径，index.html 用相对路径 ./mock-data.js。
  // 这样本地 /mock-data.js 和 GitHub Pages /repo/mock-data.js 都能解析到。
  // fastify 路由优先级高于 static，/internal/* 等 API 路由不受影响。
  app.register(fastifyStatic, {
    root: publicDir,
    prefix: "/",
    wildcard: false,
    index: false,
  });

  app.get("/", async (request, reply) =>
    reply.sendFile("index.html", publicDir),
  );
  app.get("/governance-console", async (request, reply) =>
    reply.sendFile("index.html", publicDir),
  );
  app.get("/dashboard", async (request, reply) =>
    reply.sendFile("index.html", publicDir),
  );

  app.get("/healthz", async () => ({
    service: "memory-service",
    ok: true,
    single_tenant_mode: isSingleTenantMode(),
    default_tenant_id: getDefaultTenantId(),
    default_scope: getDefaultScope(),
    // 建议调用方采用的本任务 task_request_id(optional hint,调用方也可自行生成 UUID v4)。
    // 约定:同一任务/会话内所有调用(memory_ingest_candidate / memory_run_governance /
    // memory_preview_host_governance / memory_run_full_governance / rule_gate_check)
    // 应复用同一个 task_request_id,以保证治理运行的关联性。
    suggested_task_request_id: randomUUID(),
  }));

  app.post("/internal/memory/query", async (request) => {
    const body = (request.body ?? {}) as MemoryQueryRequest;
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "memory-query",
    );

    const kind = typeof body.kind === "string" ? body.kind : "resident";
    const memoryType =
      typeof body.memory_type === "string" ? body.memory_type : null;
    const fingerprint =
      typeof body.fingerprint === "string" ? body.fingerprint : null;
    const limit = typeof body.limit === "number" ? body.limit : 10;
    const items = await queryMemoryByKind({
      tenantId: context.tenantId,
      scope: context.scope,
      kind,
      memoryType,
      taskRequestId: body.task_request_id ?? null,
      fingerprint,
      limit,
    });

    if (kind === "factual" && items.length) {
      const counts = await batchCountAccessLogs({
        tenantId: context.tenantId,
        scope: context.scope,
        objectType: "memory",
        objectIds: items.map((m) => (m as { id: string }).id),
      });
      attachRecallCounts(items as Array<{ id: string }>, counts);
    }

    await createMemoryAccessLog({
      tenantId: context.tenantId,
      scope: context.scope,
      queryKind: `query:${kind}`,
      queryPayload: {
        task_request_id: body.task_request_id ?? null,
        fingerprint,
        limit,
      },
      decisionPayload: {
        count: items.length,
        single_tenant_mode: isSingleTenantMode(),
      },
      objectType: "layer",
      objectRef: kind,
      traceId: context.traceId,
    });

    return {
      kind,
      tenant_id: context.tenantId,
      scope: context.scope,
      single_tenant_mode: isSingleTenantMode(),
      items,
    };
  });

  app.post("/internal/memory/candidates", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "memory-candidate",
    );
    return handleCandidateIngress({
      tenantId: context.tenantId,
      scope: context.scope,
      traceId: context.traceId,
      body: request.body as import("@super-agent/contracts").MemoryCandidateRequest,
      extractor,
      ranker,
      router,
      ruleBuilder,
      skillBuilder,
    });
  });

  app.post("/internal/memory/retrieve", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "memory-retrieve",
    );
    const body = request.body as MemoryRetrieveRequest;
    return buildRetrieveBundle({
      tenantId: context.tenantId,
      scope: context.scope,
      traceId: context.traceId,
      body,
      retrievalGate,
    });
  });

  app.get("/internal/rules", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "rules-list",
    );
    const query = (request.query ?? {}) as { limit?: number | string };
    const limit =
      typeof query.limit === "string" ? Number(query.limit) : query.limit;
    const items = (await listActiveRules({
      tenantId: context.tenantId,
      scope: context.scope,
    })) as Array<{ id: string } & Record<string, unknown>>;
    const visibleItems = Number.isFinite(limit) ? items.slice(0, limit) : items;
    const counts = await batchCountAccessLogs({
      tenantId: context.tenantId,
      scope: context.scope,
      objectType: "rule",
      objectIds: visibleItems.map((r) => r.id),
    });
    attachRecallCounts(visibleItems, counts);
    return {
      tenant_id: context.tenantId,
      scope: context.scope,
      items: visibleItems,
    };
  });

  app.get("/internal/skills", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "skills-list",
    );
    const query = (request.query ?? {}) as {
      limit?: number | string;
      project_id?: string;
    };
    const limit =
      typeof query.limit === "string" ? Number(query.limit) : query.limit;
    const projectId = query.project_id ?? context.scope;
    const items = (await listActiveSkills({
      tenantId: context.tenantId,
      scope: context.scope,
      fingerprint: null,
      projectId,
    })) as Array<{ id: string } & Record<string, unknown>>;
    const visibleItems = Number.isFinite(limit) ? items.slice(0, limit) : items;
    const counts = await batchCountAccessLogs({
      tenantId: context.tenantId,
      scope: context.scope,
      objectType: "skill",
      objectIds: visibleItems.map((s) => s.id),
    });
    attachRecallCounts(visibleItems, counts);
    return {
      tenant_id: context.tenantId,
      scope: context.scope,
      items: visibleItems,
    };
  });

  // ─── PUT: Inline edit for approved artifacts ───────────────────────

  app.put("/internal/rules/:id", async (request, reply) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "rule-update",
    );
    const params = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const updated = await updateRuleRecord({
      tenantId: context.tenantId,
      scope: context.scope,
      ruleId: params.id,
      patch: body,
      traceId: context.traceId,
    });
    if (!updated) {
      reply.status(404);
      return {
        error_code: "RULE_NOT_FOUND",
        message: "Rule not found or not active",
        trace_id: context.traceId,
      };
    }
    return { item: updated };
  });

  app.put("/internal/skills/:id", async (request, reply) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "skill-update",
    );
    const params = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const updated = await updateSkillRecord({
      tenantId: context.tenantId,
      scope: context.scope,
      skillId: params.id,
      patch: body,
      traceId: context.traceId,
    });
    if (!updated) {
      reply.status(404);
      return {
        error_code: "SKILL_NOT_FOUND",
        message: "Skill not found or not active",
        trace_id: context.traceId,
      };
    }
    return { item: updated };
  });

  app.put("/internal/memory/:id", async (request, reply) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "memory-update",
    );
    const params = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const updated = await updateMemoryRecord({
      tenantId: context.tenantId,
      scope: context.scope,
      memoryId: params.id,
      patch: body,
      traceId: context.traceId,
    });
    if (!updated) {
      reply.status(404);
      return {
        error_code: "MEMORY_NOT_FOUND",
        message: "Memory not found or not active",
        trace_id: context.traceId,
      };
    }
    return { item: updated };
  });

  app.put(
    "/internal/knowledge/synthesized-knowledge/:id",
    async (request, reply) => {
      const context = resolveRequestContext(
        request.headers as Record<string, unknown>,
        "knowledge-update",
      );
      const params = request.params as { id: string };
      const body = (request.body ?? {}) as Record<string, unknown>;
      const updated = await updateSynthesizedKnowledgeRecord({
        tenantId: context.tenantId,
        scope: context.scope,
        knowledgeId: params.id,
        patch: body,
        traceId: context.traceId,
      });
      if (!updated) {
        reply.status(404);
        return {
          error_code: "KNOWLEDGE_NOT_FOUND",
          message: "Synthesized knowledge not found",
          trace_id: context.traceId,
        };
      }
      return { item: updated };
    },
  );

  app.post("/internal/rules/gate/check", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "rule-gate-check",
    );
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
      },
    });
  });

  app.post("/internal/memory/governance/run", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "memory-governance",
    );
    return handleGovernanceRun({
      tenantId: context.tenantId,
      scope: context.scope,
      traceId: context.traceId,
      body: request.body as import("@super-agent/contracts").GovernanceRunRequest,
      summaryGenerator,
      residentBuilder,
      indexSyncAdapter,
      lifecycleWorker,
    });
  });

  app.post("/internal/host-capture/codex/preview", async (request, reply) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "host-capture-codex-preview",
    );
    const body = (request.body ?? {}) as {
      codex_home?: string | null;
      thread_id?: string | null;
      max_items?: number | null;
    };

    try {
      return await previewCodexHostCapture({
        codex_home: body.codex_home ?? null,
        thread_id: body.thread_id ?? null,
        max_items: body.max_items ?? null,
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
          thread_id: body.thread_id ?? null,
        },
      };
    }
  });

  app.post("/internal/host-capture/:host/preview", async (request, reply) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "host-capture-preview",
    );
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
        max_items: body.max_items ?? null,
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
          thread_id: body.thread_id ?? null,
        },
      };
    }
  });

  app.get("/internal/host-capture/codex/sessions", async (request, reply) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "host-capture-codex-sessions",
    );
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
              : null,
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
          limit: query.limit ?? null,
        },
      };
    }
  });

  app.get("/internal/host-capture/:host/sessions", async (request, reply) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "host-capture-sessions",
    );
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
              : null,
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
          limit: query.limit ?? null,
        },
      };
    }
  });

  app.post(
    "/internal/host-capture/codex/governance-batch-preview",
    async (request, reply) => {
      const context = resolveRequestContext(
        request.headers as Record<string, unknown>,
        "host-capture-codex-batch-preview",
      );
      const body = (request.body ?? {}) as {
        codex_home?: string | null;
        thread_id?: string | null;
        max_items?: number | null;
      };

      try {
        const preview = await previewCodexHostCapture({
          codex_home: body.codex_home ?? null,
          thread_id: body.thread_id ?? null,
          max_items: body.max_items ?? null,
        });
        const batch = buildGovernanceBatchPreview(preview);

        // Two-Step MCP Dance — Step 1: build mission brief for host LLM extraction
        let mission_brief: {
          text: string;
          governance_mode: "host_model";
        } | null = null;
        try {
          const summarized = summarizeSession(preview);
          mission_brief = buildMissionBrief(summarized);
        } catch {
          // Mission brief is best-effort; batch preview still valid without it
        }

        // 发行 preview_token：Step 2 (governance-run) 必须带回 token_id 才能走 host_model 路径
        const preview_token = issuePreviewToken({
          tenant_id: context.tenantId,
          scope: context.scope,
          trace_id: context.traceId,
          host: preview.host,
          thread_id: preview.thread_id,
          session_file: preview.session_file,
          user_messages: preview.governance_preview.user_messages,
        });

        return { ...batch, mission_brief, preview_token };
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
            thread_id: body.thread_id ?? null,
          },
        };
      }
    },
  );

  app.post(
    "/internal/host-capture/:host/governance-batch-preview",
    async (request, reply) => {
      const context = resolveRequestContext(
        request.headers as Record<string, unknown>,
        "host-capture-governance-batch-preview",
      );
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
          max_items: body.max_items ?? null,
        });
        const batch = buildGovernanceBatchPreview(preview);

        // Two-Step MCP Dance — Step 1: build mission brief for host LLM extraction
        let mission_brief: {
          text: string;
          governance_mode: "host_model";
        } | null = null;
        try {
          const summarized = summarizeSession(preview);
          mission_brief = buildMissionBrief(summarized);
        } catch {
          // Mission brief is best-effort; batch preview still valid without it
        }

        // 发行 preview_token：Step 2 (governance-run) 必须带回 token_id 才能走 host_model 路径
        const preview_token = issuePreviewToken({
          tenant_id: context.tenantId,
          scope: context.scope,
          trace_id: context.traceId,
          host: preview.host,
          thread_id: preview.thread_id,
          session_file: preview.session_file,
          user_messages: preview.governance_preview.user_messages,
        });

        return { ...batch, mission_brief, preview_token };
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
            thread_id: body.thread_id ?? null,
          },
        };
      }
    },
  );

  app.post(
    "/internal/host-capture/codex/governance-run",
    async (request, reply) => {
      const context = resolveRequestContext(
        request.headers as Record<string, unknown>,
        "host-capture-codex-governance-run",
      );
      const body = (request.body ?? {}) as {
        codex_home?: string | null;
        thread_id?: string | null;
        max_items?: number | null;
        task_request_id?: string | null;
        fingerprint?: string | null;
        governance_mode?: "rules_fallback" | "host_model" | null;
        host_model_result?: Record<string, unknown> | null;
        preview_token?: string | null;
      };

      try {
        return await runCodexHostGovernance({
          tenantId: context.tenantId,
          scope: context.scope,
          traceId: context.traceId,
          body,
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
            thread_id: body.thread_id ?? null,
          },
        };
      }
    },
  );

  app.post(
    "/internal/host-capture/:host/governance-run",
    async (request, reply) => {
      const context = resolveRequestContext(
        request.headers as Record<string, unknown>,
        "host-capture-governance-run",
      );
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
        preview_token?: string | null;
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
            codex_home: body.codex_home ?? body.host_home ?? null,
          },
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
            thread_id: body.thread_id ?? null,
          },
        };
      }
    },
  );

  app.post(
    "/internal/governance/run-from-extraction",
    async (request, reply) => {
      const context = resolveRequestContext(
        request.headers as Record<string, unknown>,
        "governance-run-from-extraction",
      );
      const body = (request.body ?? {}) as {
        extraction_preview: any;
        host?: string;
        governance_mode?: "rules_fallback" | "host_model";
        refresh_memory?: boolean;
        rebuild_resident?: boolean;
        sync_index?: boolean;
        run_lifecycle?: boolean;
        fingerprint?: string | null;
      };

      if (!body.extraction_preview) {
        reply.status(400);
        return {
          error_code: "MISSING_EXTRACTION_PREVIEW",
          message: "extraction_preview is required in the request body",
          trace_id: context.traceId,
          retryable: false,
          details: {},
        };
      }

      const taskRequestId = randomUUID();

      try {
        const governanceResult = await runGovernanceFromExtraction({
          tenantId: context.tenantId,
          scope: context.scope,
          traceId: context.traceId,
          extraction_preview: body.extraction_preview,
          host: body.host ?? "generic",
          task_request_id: taskRequestId,
          fingerprint: body.fingerprint ?? null,
          governance_mode: body.governance_mode ?? "host_model",
        });

        let rebuiltSnapshotId: string | null = null;
        let indexSync: Awaited<ReturnType<IndexSyncAdapter["sync"]>> | null =
          null;
        let lifecycleResult: Awaited<
          ReturnType<LifecycleWorker["run"]>
        > | null = null;

        if (body.rebuild_resident !== false) {
          rebuiltSnapshotId = await residentBuilder.rebuild({
            tenantId: context.tenantId,
            scope: context.scope,
            fingerprint: body.fingerprint ?? null,
            dirtyReason: "governance-run-from-extraction",
            traceId: context.traceId,
          });
        }

        if (body.sync_index !== false) {
          indexSync = await indexSyncAdapter.sync({
            tenantId: context.tenantId,
            scope: context.scope,
            fingerprint: body.fingerprint ?? null,
          });
        }

        // fix-9: lifecycle 改成显式触发，默认不自动跑
        // 宿主通过 memory-lifecycle skill 显式调用，或显式传 run_lifecycle=true
        if (body.run_lifecycle === true && indexSync) {
          lifecycleResult = await lifecycleWorker.run({
            tenantId: context.tenantId,
            scope: context.scope,
            fingerprint: body.fingerprint ?? null,
            traceId: context.traceId,
            staleIndexIds: indexSync.stale_index_ids,
          });
        }

        return {
          ...governanceResult,
          rebuilt_snapshot_id: rebuiltSnapshotId,
          index_sync: indexSync,
          lifecycle: lifecycleResult,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reply.status(400);
        return {
          error_code: "GOVERNANCE_RUN_FROM_EXTRACTION_FAILED",
          message,
          trace_id: context.traceId,
          retryable: false,
          details: {
            host: body.host ?? "generic",
            task_request_id: taskRequestId,
          },
        };
      }
    },
  );

  app.get("/internal/governance/change-proposals", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "governance-change-proposals",
    );
    const query = (request.query ?? {}) as {
      status?: string;
      limit?: number | string;
      action_type?: string;
      evolution_signal?: string;
      human_decision?: string;
    };
    const limit =
      typeof query.limit === "string" ? Number(query.limit) : query.limit;
    const items = await listGovernanceChangeProposals({
      tenantId: context.tenantId,
      scope: context.scope,
      status: query.status ?? "recorded",
      limit: Number.isFinite(limit) ? Number(limit) : 50,
      proposedActionType: query.action_type ?? null,
      evolutionSignal: query.evolution_signal ?? null,
      humanDecision: query.human_decision ?? null,
    });
    return {
      tenant_id: context.tenantId,
      scope: context.scope,
      items,
    };
  });

  app.get("/internal/governance/pipeline-summary", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "governance-pipeline-summary",
    );
    const db = getPool();

    const l2Result = await db.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt
       FROM governance_change_proposal
       WHERE tenant_id = $1 AND scope = $2 AND proposed_action LIKE 'l2_conflict_%'`,
      [context.tenantId, context.scope],
    );

    const l3Result = await db.query<{
      evolution_signal: string | null;
      cnt: number;
    }>(
      `SELECT evolution_signal, COUNT(*) AS cnt
       FROM governance_change_proposal
       WHERE tenant_id = $1 AND scope = $2 AND proposed_action LIKE 'l3_evolution_%'
       GROUP BY evolution_signal`,
      [context.tenantId, context.scope],
    );

    const l4Result = await db.query<{
      knowledge_type: string | null;
      cnt: number;
    }>(
      `SELECT knowledge_type, COUNT(*) AS cnt
       FROM kp_synthesized_knowledge
       WHERE tenant_id = $1 AND scope = $2 AND status = 'active'
         AND knowledge_type IN ('synthesis', 'pattern')
       GROUP BY knowledge_type`,
      [context.tenantId, context.scope],
    );

    const l3BySignal: Record<string, number> = {};
    let l3Total = 0;
    for (const row of l3Result.rows) {
      const signal = row.evolution_signal ?? "unknown";
      const cnt = Number(row.cnt);
      l3BySignal[signal] = (l3BySignal[signal] ?? 0) + cnt;
      l3Total += cnt;
    }

    const l4ByType: Record<string, number> = {};
    let l4Total = 0;
    for (const row of l4Result.rows) {
      const type = row.knowledge_type ?? "unknown";
      const cnt = Number(row.cnt);
      l4ByType[type] = (l4ByType[type] ?? 0) + cnt;
      l4Total += cnt;
    }

    return {
      l2: { conflict_proposals: Number(l2Result.rows[0]?.cnt ?? 0) },
      l3: { evolution_signals: l3Total, by_signal: l3BySignal },
      l4: { synthesized_knowledge: l4Total, by_type: l4ByType },
    };
  });

  app.post(
    "/internal/governance/change-proposals/:proposalId/actions",
    async (request, reply) => {
      const context = resolveRequestContext(
        request.headers as Record<string, unknown>,
        "governance-change-proposal-action",
      );
      const params = request.params as { proposalId: string };
      const body = (request.body ?? {}) as {
        action?: string;
        payload?: Record<string, unknown>;
        fingerprint?: string;
      };
      if (body.action !== "approve" && body.action !== "reject") {
        reply.status(400);
        return {
          error_code: "INVALID_GOVERNANCE_CHANGE_ACTION",
          message: "action must be approve or reject",
          trace_id: context.traceId,
          retryable: false,
          details: {},
        };
      }
      const feedback =
        typeof body.payload?.feedback === "string"
          ? body.payload.feedback
          : null;
      const humanResponse = { ...body.payload };
      if (feedback) {
        humanResponse.feedback = feedback;
      }
      const item = await applyGovernanceChangeProposal({
        tenantId: context.tenantId,
        scope: context.scope,
        proposalId: params.proposalId,
        action: body.action,
        humanResponse,
        traceId: context.traceId,
      });
      if (!item) {
        reply.status(404);
        return {
          error_code: "GOVERNANCE_CHANGE_PROPOSAL_NOT_FOUND",
          message: `Governance change proposal not found or already resolved: ${params.proposalId}`,
          trace_id: context.traceId,
          retryable: false,
          details: {},
        };
      }
      let rebuiltSnapshotId: string | null = null;
      let indexSync: Awaited<ReturnType<IndexSyncAdapter["sync"]>> | null =
        null;
      let postApprovalAction: {
        type: string;
        skill: string;
        payload: Record<string, unknown>;
      } | null = null;
      if (body.action === "approve") {
        rebuiltSnapshotId = await residentBuilder.rebuild({
          tenantId: context.tenantId,
          scope: context.scope,
          fingerprint: body.fingerprint ?? null,
          dirtyReason: "governance-change-approved",
          traceId: context.traceId,
        });
        indexSync = await indexSyncAdapter.sync({
          tenantId: context.tenantId,
          scope: context.scope,
          fingerprint: body.fingerprint ?? null,
        });

        // ─── Post-approval: notify host to invoke skill ─────────────
        const proposedAction = item.proposed_action as string | undefined;
        const targetType = item.target_object_type as string | undefined;
        const appliedObjectId = item.applied_object_id as string | null;

        if (
          proposedAction === "create_rule" ||
          proposedAction === "replace_rule" ||
          targetType === "rule"
        ) {
          const rules = await listActiveRules({
            tenantId: context.tenantId,
            scope: context.scope,
          });
          const appliedRule =
            rules.find((r) => r.id === appliedObjectId) ?? rules[0];
          if (appliedRule) {
            postApprovalAction = {
              type: "invoke_skill",
              skill: "gate-master",
              payload: {
                rule_id: appliedRule.id,
                rule_key: appliedRule.rule_key,
                title: appliedRule.title,
                statement: appliedRule.statement,
                enforcement_level: appliedRule.enforcement_level,
                trigger_conditions: appliedRule.trigger_conditions,
                applies_to: appliedRule.applies_to,
                risk_level: appliedRule.risk_level,
                priority: appliedRule.priority,
                origin_scope: appliedRule.origin_scope ?? "session",
                availability_scope:
                  appliedRule.availability_scope ?? "session_only",
                host_context: {
                  project_id: context.scope,
                  project_root: null,
                },
              },
            };
          }
        }

        if (
          proposedAction === "skill_update_proposal" ||
          proposedAction === "replace_skill" ||
          targetType === "skill"
        ) {
          const skills = await listActiveSkills({
            tenantId: context.tenantId,
            scope: context.scope,
            fingerprint: null,
          });
          const appliedSkill =
            skills.find((s) => s.id === appliedObjectId) ?? skills[0];
          if (appliedSkill) {
            postApprovalAction = {
              type: "invoke_skill",
              skill: "skill-creator",
              payload: {
                skill_record: appliedSkill,
                host_context: {
                  project_id: context.scope,
                  project_root: null,
                  global_skills_dir: ".trae/skills",
                },
              },
            };
          }
        }

        // ─── 自动落地:审批通过后直接调 executeHostActions ─────────────
        // 之前只返回 post_approval_action 给调用方,期望宿主侧手动调
        // POST /internal/host-actions/execute,但宿主侧没有自动触发机制,
        // 导致 host_action.status 永远 "pending",UI 一直显示"门控生成: 待宿主执行"。
        // 现在后端直接自动执行,把 .hook.ts / SKILL.md 文件落地,状态推进到 generated。
        // 失败不阻塞审批流程(审批已生效,文件落地可重试)。
        try {
          const hostActionResult = await executeHostActions({
            tenantId: context.tenantId,
            scope: context.scope,
            traceId: context.traceId,
            limit: 10, // 只处理刚审批通过的这一批,避免大批量执行阻塞响应
          });
          if (hostActionResult.succeeded > 0) {
            console.log(
              `[approval] auto-executeHostActions: ${hostActionResult.succeeded}/${hostActionResult.total} succeeded traceId=${context.traceId}`,
            );
          }
        } catch (e) {
          console.warn(
            `[approval] auto-executeHostActions failed (non-blocking): ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      return {
        item,
        rebuilt_snapshot_id: rebuiltSnapshotId,
        index_sync: indexSync,
        post_approval_action: postApprovalAction,
        feedback_recorded: feedback != null,
      };
    },
  );

  // ─── Host actions: pending skill/rule generation queue ───────────────
  app.get("/internal/host-actions/pending", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "host-actions-pending",
    );
    const query = (request.query ?? {}) as {
      object_type?: "rule" | "skill" | "all";
      project_id?: string;
      limit?: number | string;
    };
    const limit =
      typeof query.limit === "string" ? Number(query.limit) : query.limit;
    const items = await fetchPendingHostActions({
      tenantId: context.tenantId,
      scope: context.scope,
      projectId: query.project_id,
      objectType: query.object_type ?? "all",
      limit: Number.isFinite(limit) ? limit : 100,
    });
    return {
      tenant_id: context.tenantId,
      scope: context.scope,
      items,
    };
  });

  app.post(
    "/internal/host-actions/:objectType/:id/status",
    async (request, reply) => {
      const context = resolveRequestContext(
        request.headers as Record<string, unknown>,
        "host-action-status",
      );
      const params = request.params as { objectType: string; id: string };
      const body = (request.body ?? {}) as Record<string, unknown>;

      if (params.objectType !== "rule" && params.objectType !== "skill") {
        reply.status(400);
        return {
          error_code: "INVALID_OBJECT_TYPE",
          message: "objectType must be 'rule' or 'skill'",
          trace_id: context.traceId,
        };
      }

      const status = typeof body.status === "string" ? body.status : "";
      if (!["pending", "generated", "done", "failed"].includes(status)) {
        reply.status(400);
        return {
          error_code: "INVALID_STATUS",
          message: "status must be one of: pending, generated, done, failed",
          trace_id: context.traceId,
        };
      }

      const ok = await markHostActionStatus({
        tenantId: context.tenantId,
        objectType: params.objectType,
        objectId: params.id,
        status: status as "pending" | "generated" | "failed",
        error: typeof body.error === "string" ? body.error : null,
        traceId: context.traceId,
      });

      if (!ok) {
        reply.status(404);
        return {
          error_code: "HOST_ACTION_NOT_FOUND",
          message: "Rule or skill not found for host action update",
          trace_id: context.traceId,
        };
      }

      return {
        object_type: params.objectType,
        object_id: params.id,
        status,
        trace_id: context.traceId,
      };
    },
  );

  // ─── Regenerate candidate based on feedback ──────────────────────────
  app.post(
    "/internal/governance/change-proposals/:proposalId/regenerate",
    async (request, reply) => {
      const context = resolveRequestContext(
        request.headers as Record<string, unknown>,
        "governance-regenerate",
      );
      const params = request.params as { proposalId: string };
      const body = (request.body ?? {}) as { feedback?: string };
      if (!body.feedback || typeof body.feedback !== "string") {
        reply.status(400);
        return {
          error_code: "FEEDBACK_REQUIRED",
          message: "feedback field is required for regeneration",
          trace_id: context.traceId,
          retryable: false,
          details: {},
        };
      }
      // Mark the proposal as needs_review with feedback, so it can be re-extracted
      const { getPool } = await import("@super-agent/db");
      const db = getPool();
      await db.query(
        `UPDATE governance_change_proposal
       SET human_response = COALESCE(human_response, '{}'::jsonb) || $4::jsonb,
           updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND scope = $3`,
        [
          params.proposalId,
          context.tenantId,
          context.scope,
          JSON.stringify({
            regeneration_feedback: body.feedback,
            regenerated_at: new Date().toISOString(),
          }),
        ],
      );
      return {
        proposal_id: params.proposalId,
        status: "feedback_recorded",
        feedback: body.feedback,
        trace_id: context.traceId,
      };
    },
  );

  app.post("/internal/knowledge/governance/jobs", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "knowledge-governance-job-create",
    );
    const body = request.body as KnowledgeGovernanceJobCreateRequest;
    const response: KnowledgeGovernanceJobCreateResponse =
      await createKnowledgeGovernanceJobRecord({
        tenantId: context.tenantId,
        scope: context.scope,
        traceId: context.traceId,
        body,
      });
    return response;
  });

  app.get(
    "/internal/knowledge/governance/jobs/:jobId",
    async (request, reply) => {
      const context = resolveRequestContext(
        request.headers as Record<string, unknown>,
        "knowledge-governance-job-get",
      );
      const params = request.params as { jobId: string };
      const response = await getKnowledgeGovernanceJobRecord({
        tenantId: context.tenantId,
        scope: context.scope,
        jobId: params.jobId,
      });

      if (!response) {
        reply.status(404);
        return {
          error_code: "KNOWLEDGE_GOVERNANCE_JOB_NOT_FOUND",
          message: `Knowledge governance job not found: ${params.jobId}`,
          trace_id: context.traceId,
          retryable: false,
          details: {},
        };
      }

      return response as KnowledgeGovernanceJobResponse;
    },
  );

  app.post("/internal/knowledge/governance/run", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "knowledge-governance-run",
    );
    const body = request.body as KnowledgeGovernanceRunRequest;
    const response: KnowledgeGovernanceRunResponse =
      await runKnowledgeGovernance({
        tenantId: context.tenantId,
        scope: context.scope,
        traceId: context.traceId,
        body,
      });
    return response;
  });

  app.post("/internal/knowledge/documents/ingest", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "knowledge-document-ingest",
    );
    const body = request.body as KnowledgeDocumentIngestRequest;
    const response: KnowledgeDocumentIngestResponse =
      await ingestKnowledgeDocument({
        tenantId: context.tenantId,
        scope: context.scope,
        traceId: context.traceId,
        body,
        extractor,
        ranker,
        router,
        ruleBuilder,
        skillBuilder,
      });
    return response;
  });

  app.get("/internal/knowledge/documents", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "knowledge-documents",
    );
    const query = (request.query ?? {}) as {
      q?: string;
      limit?: number | string;
      offset?: number | string;
    };
    const limit =
      typeof query.limit === "string" ? Number(query.limit) : query.limit;
    const offset =
      typeof query.offset === "string" ? Number(query.offset) : query.offset;
    const response: KnowledgeDocumentListResponse =
      await listKnowledgeDocuments({
        tenantId: context.tenantId,
        scope: context.scope,
        query: query.q ?? null,
        limit: Number.isFinite(limit) ? limit : undefined,
        offset: Number.isFinite(offset) ? offset : undefined,
      });
    return response;
  });

  app.get(
    "/internal/knowledge/documents/:documentId",
    async (request, reply) => {
      const context = resolveRequestContext(
        request.headers as Record<string, unknown>,
        "knowledge-document-detail",
      );
      const params = request.params as { documentId: string };
      const response = await getKnowledgeDocumentDetails({
        tenantId: context.tenantId,
        scope: context.scope,
        documentId: params.documentId,
      });
      if (!response) {
        reply.status(404);
        return {
          error_code: "KNOWLEDGE_DOCUMENT_NOT_FOUND",
          message: `Knowledge document not found: ${params.documentId}`,
          trace_id: context.traceId,
          retryable: false,
          details: {},
        };
      }
      return response;
    },
  );

  app.get("/internal/knowledge/review-queue", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "knowledge-review-queue",
    );
    const query = (request.query ?? {}) as {
      status?: string;
      review_reason?: string;
      limit?: number;
    };
    const response: KnowledgeReviewQueueResponse =
      await listKnowledgeReviewQueueItems({
        tenantId: context.tenantId,
        scope: context.scope,
        status: query.status ?? null,
        reviewReason: query.review_reason ?? null,
        limit: typeof query.limit === "number" ? query.limit : undefined,
      });
    return response;
  });

  app.post(
    "/internal/knowledge/review-queue/:reviewQueueId/actions",
    async (request) => {
      const context = resolveRequestContext(
        request.headers as Record<string, unknown>,
        "knowledge-review-action",
      );
      const params = request.params as { reviewQueueId: string };
      const body = request.body as KnowledgeReviewActionRequest;
      const response: KnowledgeReviewActionResponse =
        await handleKnowledgeReviewAction({
          tenantId: context.tenantId,
          scope: context.scope,
          traceId: context.traceId,
          reviewQueueId: params.reviewQueueId,
          body,
        });
      return response;
    },
  );

  app.get(
    "/internal/knowledge/context-bundles/:bundleId",
    async (request, reply) => {
      const context = resolveRequestContext(
        request.headers as Record<string, unknown>,
        "knowledge-context-bundle",
      );
      const params = request.params as { bundleId: string };
      const response = await getKnowledgeContextBundle({
        tenantId: context.tenantId,
        scope: context.scope,
        bundleId: params.bundleId,
      });

      if (!response) {
        reply.status(404);
        return {
          error_code: "KNOWLEDGE_CONTEXT_BUNDLE_NOT_FOUND",
          message: `Knowledge context bundle not found: ${params.bundleId}`,
          trace_id: context.traceId,
          retryable: false,
          details: {},
        };
      }

      return response as KnowledgeContextBundleResponse;
    },
  );

  app.post("/internal/knowledge/retrieve", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "knowledge-retrieve",
    );
    const body = request.body as KnowledgeRetrieveRequest;
    const response: KnowledgeRetrieveResponse =
      await buildKnowledgeRetrieveBundle({
        tenantId: context.tenantId,
        scope: context.scope,
        traceId: context.traceId,
        body,
        retrievalGate,
      });
    return response;
  });

  app.get("/internal/knowledge/graph/entities", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "knowledge-graph-entities",
    );
    const query = (request.query ?? {}) as {
      q?: string;
      limit?: number;
      scope?: string;
    };
    const scope = resolveScopeFromQueryOrHeader(
      query as Record<string, unknown>,
      request.headers as Record<string, unknown>,
    );
    const response: KnowledgeGraphListResponse =
      await listKnowledgeGraphEntities({
        tenantId: context.tenantId,
        scope,
        query: query.q ?? null,
        limit: typeof query.limit === "number" ? query.limit : undefined,
      });
    return response;
  });

  app.get("/internal/knowledge/graph/facts", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "knowledge-graph-facts",
    );
    const query = (request.query ?? {}) as {
      q?: string;
      limit?: number;
      scope?: string;
    };
    const scope = resolveScopeFromQueryOrHeader(
      query as Record<string, unknown>,
      request.headers as Record<string, unknown>,
    );
    const response: KnowledgeGraphListResponse = await listKnowledgeGraphFacts({
      tenantId: context.tenantId,
      scope,
      query: query.q ?? null,
      limit: typeof query.limit === "number" ? query.limit : undefined,
    });
    return response;
  });

  app.get("/internal/knowledge/graph/relations", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "knowledge-graph-relations",
    );
    const query = (request.query ?? {}) as {
      object_ids?: string | string[];
      limit?: number;
      scope?: string;
    };
    const scope = resolveScopeFromQueryOrHeader(
      query as Record<string, unknown>,
      request.headers as Record<string, unknown>,
    );
    const objectIds =
      typeof query.object_ids === "string"
        ? query.object_ids
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : Array.isArray(query.object_ids)
          ? query.object_ids
              .flatMap((item) => item.split(","))
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
    const response: KnowledgeGraphListResponse =
      await listKnowledgeGraphRelations({
        tenantId: context.tenantId,
        scope,
        objectIds,
        limit: typeof query.limit === "number" ? query.limit : undefined,
      });
    return response;
  });

  // 知识图谱聚合视图：一次返回 entities + facts + relations + synthesized_knowledge
  // + evidence + governance_proposals（按 proposed_action 前缀区分 L2/L3/L4）
  // 用于前端 graph section 的力导向图 + 演化时间线渲染
  app.get("/internal/knowledge/graph/overview", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "knowledge-graph-overview",
    );
    const query = (request.query ?? {}) as {
      limit?: number | string;
      scope?: string;
    };
    const scope = resolveScopeFromQueryOrHeader(
      query as Record<string, unknown>,
      request.headers as Record<string, unknown>,
    );
    const limit =
      typeof query.limit === "string" ? Number(query.limit) : query.limit;
    return getKnowledgeGraphOverview({
      tenantId: context.tenantId,
      scope,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
  });

  app.get("/internal/knowledge/governance/runs", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "knowledge-governance-runs",
    );
    const query = (request.query ?? {}) as { limit?: number };
    const response: KnowledgeGovernanceRunsResponse =
      await listKnowledgeGovernanceRuns({
        tenantId: context.tenantId,
        scope: context.scope,
        limit: typeof query.limit === "number" ? query.limit : undefined,
      });
    return response;
  });

  app.get(
    "/internal/knowledge/governance/runs/:jobId",
    async (request, reply) => {
      const context = resolveRequestContext(
        request.headers as Record<string, unknown>,
        "knowledge-governance-run-detail",
      );
      const params = request.params as { jobId: string };
      const response = await getKnowledgeGovernanceRunDetails({
        tenantId: context.tenantId,
        scope: context.scope,
        jobId: params.jobId,
      });
      if (!response) {
        reply.status(404);
        return {
          error_code: "KNOWLEDGE_GOVERNANCE_RUN_NOT_FOUND",
          message: `Knowledge governance run not found: ${params.jobId}`,
          trace_id: context.traceId,
          retryable: false,
          details: {},
        };
      }
      return response;
    },
  );

  app.get("/internal/knowledge/governance/decisions", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "knowledge-governance-decisions",
    );
    const query = (request.query ?? {}) as {
      job_id?: string;
      limit?: number | string;
    };
    const limit =
      typeof query.limit === "string" ? Number(query.limit) : query.limit;
    return listKnowledgeGovernanceDecisions({
      tenantId: context.tenantId,
      scope: context.scope,
      governanceJobId: query.job_id ?? null,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
  });

  app.get("/internal/knowledge/synthesized-knowledge", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "knowledge-synthesized-knowledge",
    );
    const query = (request.query ?? {}) as {
      job_id?: string;
      limit?: number | string;
    };
    const limit =
      typeof query.limit === "string" ? Number(query.limit) : query.limit;
    const result = await listSynthesizedKnowledge({
      tenantId: context.tenantId,
      scope: context.scope,
      governanceJobId: query.job_id ?? null,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    const items = Array.isArray(result.items) ? result.items : [];
    if (items.length) {
      const counts = await batchCountAccessLogs({
        tenantId: context.tenantId,
        scope: context.scope,
        objectType: "knowledge",
        objectIds: items.map((k) => (k as { id: string }).id),
      });
      attachRecallCounts(items as Array<{ id: string }>, counts);
    }
    return result;
  });

  app.get(
    "/internal/knowledge/synthesized-knowledge/:synthesizedKnowledgeId",
    async (request, reply) => {
      const context = resolveRequestContext(
        request.headers as Record<string, unknown>,
        "knowledge-synthesized-knowledge-detail",
      );
      const params = request.params as { synthesizedKnowledgeId: string };
      const response = await getSynthesizedKnowledgeDetails({
        tenantId: context.tenantId,
        scope: context.scope,
        synthesizedKnowledgeId: params.synthesizedKnowledgeId,
      });
      if (!response) {
        reply.status(404);
        return {
          error_code: "SYNTHESIZED_KNOWLEDGE_NOT_FOUND",
          message: `Synthesized knowledge not found: ${params.synthesizedKnowledgeId}`,
          trace_id: context.traceId,
          retryable: false,
          details: {},
        };
      }
      return response;
    },
  );

  app.get("/internal/knowledge/recall-surface", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "knowledge-recall-surface",
    );
    const query = (request.query ?? {}) as {
      job_id?: string;
      object_type?: string;
      limit?: number | string;
    };
    const limit =
      typeof query.limit === "string" ? Number(query.limit) : query.limit;
    return listRecallSurfaceStates({
      tenantId: context.tenantId,
      scope: context.scope,
      governanceJobId: query.job_id ?? null,
      objectType: query.object_type ?? null,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
  });

  app.get("/internal/knowledge/ops/overview", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "knowledge-ops-overview",
    );
    const response: KnowledgeOpsOverviewResponse =
      await getKnowledgeOpsOverviewData({
        tenantId: context.tenantId,
        scope: context.scope,
      });
    return response;
  });

  app.post("/internal/feedback/commit", async (request) => {
    const body = request.body as FeedbackCommitRequest;
    const response: FeedbackCommitResponse = {
      feedback_status: "committed",
      affected_objects: [
        `task_step:${body.task_step_id}`,
        body.verification_result_id
          ? `verification_result:${body.verification_result_id}`
          : "policy_feedback",
      ],
      committed_at: new Date().toISOString(),
    };

    return response;
  });

  app.post("/internal/memory/debug/fingerprint", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "memory-debug-fingerprint",
    );
    const body = (request.body ?? {}) as { fingerprint?: string };

    if (!body.fingerprint) {
      return { fingerprint: null, record: null };
    }

    const record = await getEnvironmentFingerprint({
      tenantId: context.tenantId,
      scope: context.scope,
      fingerprintKey: body.fingerprint,
    });

    return {
      fingerprint: body.fingerprint,
      record,
    };
  });

  // ─── 宿主挂载注册：POST /internal/host/mount ──────────────────────
  // 宿主在挂载 memory-service 时调用，把自身已有的 skill/memory/rule 推送注册。
  // 幂等：重复推送不会产生重复数据（内容未变跳过，内容变化版本递增）。
  app.post("/internal/host/mount", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "host-mount",
    );
    const body = (request.body ?? {}) as {
      skills?: Array<Record<string, unknown>>;
      memories?: Array<Record<string, unknown>>;
      rules?: Array<Record<string, unknown>>;
      host_info?: {
        host_kind?: string;
        host_version?: string;
        host_home?: string;
        workspace_path?: string;
        agent_runtime?: string;
      } | null;
    };
    const traceId = `host-mount-${Date.now()}`;
    const result = {
      skills: { created: 0, updated: 0, skipped: 0, errors: [] as string[] },
      memories: { created: 0, skipped: 0, errors: [] as string[] },
      rules: { created: 0, updated: 0, skipped: 0, errors: [] as string[] },
      host_info: null as null | {
        host_kind: string;
        host_home: string;
        sessions_found: number;
        latest_session: string | null;
      },
    };

    // 注册 skill
    if (Array.isArray(body.skills)) {
      for (const s of body.skills) {
        const skillKey = String(s.skill_key ?? s.skillKey ?? "").trim();
        const title = String(s.title ?? "").trim();
        const description = String(s.description ?? "").trim();
        if (!skillKey || !title) {
          result.skills.errors.push(
            `skill 缺少 skill_key 或 title: ${JSON.stringify(s).slice(0, 80)}`,
          );
          continue;
        }
        try {
          const r = await upsertHostSkill({
            tenantId: context.tenantId,
            scope: context.scope,
            skillKey,
            title,
            description,
            skillType:
              typeof s.skill_type === "string"
                ? s.skill_type
                : typeof s.skillType === "string"
                  ? s.skillType
                  : "procedural",
            triggerConditions: (s.trigger_conditions ??
              s.triggerConditions ??
              null) as Record<string, unknown> | null,
            procedurePayload: (s.procedure_payload ??
              s.procedurePayload ??
              null) as Record<string, unknown> | null,
            riskLevel:
              typeof s.risk_level === "string"
                ? s.risk_level
                : typeof s.riskLevel === "string"
                  ? s.riskLevel
                  : "low",
            tags: Array.isArray(s.tags) ? s.tags.map(String) : [],
            traceId,
          });
          result.skills[r.action]++;
        } catch (e) {
          result.skills.errors.push(
            `skill ${skillKey}: ${(e as Error).message}`,
          );
        }
      }
    }

    // 注册 memory
    if (Array.isArray(body.memories)) {
      for (const m of body.memories) {
        const memoryType = String(m.memory_type ?? m.memoryType ?? "").trim();
        const title = String(m.title ?? "").trim();
        const content = String(m.content ?? "").trim();
        if (!memoryType || !title || !content) {
          result.memories.errors.push(
            `memory 缺少 memory_type/title/content: ${JSON.stringify(m).slice(0, 80)}`,
          );
          continue;
        }
        try {
          const r = await upsertHostMemory({
            tenantId: context.tenantId,
            scope: context.scope,
            memoryType,
            title,
            content,
            importance: typeof m.importance === "number" ? m.importance : null,
            tags: Array.isArray(m.tags) ? m.tags.map(String) : [],
            traceId,
          });
          result.memories[r.action === "created" ? "created" : "skipped"]++;
        } catch (e) {
          result.memories.errors.push(
            `memory ${title}: ${(e as Error).message}`,
          );
        }
      }
    }

    // 注册 rule
    if (Array.isArray(body.rules)) {
      for (const r of body.rules) {
        const ruleKey = String(r.rule_key ?? r.ruleKey ?? "").trim();
        const ruleType = String(
          r.rule_type ?? r.ruleType ?? "governance_rule",
        ).trim();
        const title = String(r.title ?? "").trim();
        const statement = String(r.statement ?? "").trim();
        if (!ruleKey || !title || !statement) {
          result.rules.errors.push(
            `rule 缺少 rule_key/title/statement: ${JSON.stringify(r).slice(0, 80)}`,
          );
          continue;
        }
        try {
          const rr = await upsertHostRule({
            tenantId: context.tenantId,
            scope: context.scope,
            ruleKey,
            ruleType,
            title,
            statement,
            enforcementLevel:
              typeof r.enforcement_level === "string"
                ? r.enforcement_level
                : typeof r.enforcementLevel === "string"
                  ? r.enforcementLevel
                  : "must",
            priority:
              typeof r.priority === "number"
                ? r.priority
                : ((
                    { P0: 10, P1: 20, P2: 50, P3: 75 } as Record<string, number>
                  )[String(r.priority ?? "P2")] ?? 50),
            riskLevel:
              typeof r.risk_level === "string"
                ? r.risk_level
                : typeof r.riskLevel === "string"
                  ? r.riskLevel
                  : "medium",
            appliesTo: Array.isArray(r.applies_to)
              ? r.applies_to.map(String)
              : Array.isArray(r.appliesTo)
                ? r.appliesTo.map(String)
                : [],
            traceId,
          });
          result.rules[rr.action]++;
        } catch (e) {
          result.rules.errors.push(`rule ${ruleKey}: ${(e as Error).message}`);
        }
      }
    }

    // 如果请求中带 host_info，自动触发会话发现（best-effort，失败不阻断挂载）
    if (body.host_info?.host_kind) {
      try {
        const host = normalizeHost(body.host_info.host_kind);
        const sessions = await listHostSessions({
          host,
          host_home: body.host_info.host_home ?? null,
          limit: 5,
        });
        result.host_info = {
          host_kind: host,
          host_home: sessions.host_home,
          sessions_found: sessions.items.length,
          latest_session: sessions.items[0]?.thread_name ?? null,
        };
      } catch (e) {
        // best-effort：会话发现失败不影响挂载主流程，但把错误信息附到返回里
        result.host_info = {
          host_kind: normalizeHost(body.host_info.host_kind),
          host_home: body.host_info.host_home ?? "",
          sessions_found: 0,
          latest_session: null,
        };
        // 错误信息只打到日志，不暴露给客户端
        console.warn(
          `[host-mount] 会话发现失败 host=${body.host_info.host_kind}:`,
          (e as Error).message,
        );
      }
    }

    return {
      tenant_id: context.tenantId,
      scope: context.scope,
      trace_id: traceId,
      summary: {
        skills: { ...result.skills, total: body.skills?.length ?? 0 },
        memories: { ...result.memories, total: body.memories?.length ?? 0 },
        rules: { ...result.rules, total: body.rules?.length ?? 0 },
      },
      host_info: result.host_info,
    };
  });

  // ─── P1b 查询：layer_links 跨层派生关系 ──────────────────────────
  // 支持 source_id / target_id / link_type 过滤，单向存储反查即可覆盖双向需求。
  app.get("/internal/layer-links", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "layer-links-query",
    );
    const query = (request.query ?? {}) as {
      source_id?: string;
      target_id?: string;
      source_layer?: string;
      target_layer?: string;
      link_type?: string;
      limit?: number | string;
    };
    const limit =
      typeof query.limit === "string" ? Number(query.limit) : query.limit;
    const pool = getPool();
    const conditions: string[] = [
      "tenant_id = $1",
      "scope = $2",
      "status = 'active'",
    ];
    const params: unknown[] = [context.tenantId, context.scope];
    let paramIdx = 3;
    if (query.source_id) {
      conditions.push(`source_id = $${paramIdx}::uuid`);
      params.push(query.source_id);
      paramIdx++;
    }
    if (query.target_id) {
      conditions.push(`target_id = $${paramIdx}::uuid`);
      params.push(query.target_id);
      paramIdx++;
    }
    if (query.source_layer) {
      conditions.push(`source_layer = $${paramIdx}`);
      params.push(query.source_layer);
      paramIdx++;
    }
    if (query.target_layer) {
      conditions.push(`target_layer = $${paramIdx}`);
      params.push(query.target_layer);
      paramIdx++;
    }
    if (query.link_type) {
      conditions.push(`link_type = $${paramIdx}`);
      params.push(query.link_type);
      paramIdx++;
    }
    const sql = `
      SELECT id, source_id, source_layer, target_id, target_layer, link_type, confidence, trace_id, created_at
      FROM layer_links
      WHERE ${conditions.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${paramIdx}
    `;
    params.push(Number.isFinite(limit) ? Number(limit) : 50);
    const result = await pool.query(sql, params);
    return {
      tenant_id: context.tenantId,
      scope: context.scope,
      items: result.rows,
      count: result.rows.length,
    };
  });

  // ─── P3 学习行为链检测 ──────────────────────────────────────────
  // 接收事件序列，返回检测到的学习链（含 isComplete 判定）。
  // 防御原则：isComplete=false 的链不硬造 Knowledge，下游自行决定降级。
  app.post("/internal/learning-chain/detect", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "learning-chain-detect",
    );
    const body = (request.body ?? {}) as { events?: LearningChainEvent[] };
    if (!Array.isArray(body.events)) {
      return {
        error_code: "INVALID_EVENTS",
        message:
          "events must be an array of { timestamp, kind, payload, status? }",
        trace_id: context.traceId,
        chains: [],
      };
    }
    const chains = detectLearningChains({ events: body.events });
    return {
      tenant_id: context.tenantId,
      scope: context.scope,
      total_chains: chains.length,
      complete_chains: chains.filter((c) => c.isComplete).length,
      incomplete_chains: chains.filter((c) => !c.isComplete).length,
      chains,
    };
  });

  // ─── 审批后落地执行：消费 host-actions 队列 ──────────────────────
  // 拉取 pending 的 host-actions，逐条执行落地（生成 .hook.ts / SKILL.md），更新状态。
  // 由 memory-host-action-execute skill 触发，也可手动 POST 触发。
  app.post("/internal/host-actions/execute", async (request) => {
    const context = resolveRequestContext(
      request.headers as Record<string, unknown>,
      "host-action-execute",
    );
    const body = (request.body ?? {}) as {
      gates_dir?: string;
      global_skills_dir?: string;
      project_skills_dir?: string;
      project_id?: string;
      limit?: number;
    };
    const result = await executeHostActions({
      tenantId: context.tenantId,
      scope: context.scope,
      traceId: context.traceId,
      gatesDir: body.gates_dir,
      globalSkillsDir: body.global_skills_dir,
      projectSkillsDir: body.project_skills_dir,
      projectId: body.project_id,
      limit: body.limit,
    });
    return result;
  });

  // ─── 宿主挂载就绪提示 + 自动注册宿主自带 skill/memory/rule ──────────
  // 服务启动后自动注册内置的宿主 bootstrap 数据（50 skills + 8 memories + 5 rules），
  // 确保仪表盘一打开就能看到宿主全部能力。幂等：重复启动不会产生重复数据。
  app.addHook("onReady", async () => {
    console.log(
      "[host-mount] memory-service 已就绪，开始自动注册宿主自带数据...",
    );
    try {
      const tenantId = getDefaultTenantId();
      const scope = getDefaultScope();
      const result = await registerHostBootstrap({ tenantId, scope });
      console.log(
        `[host-mount] 宿主数据注册完成: skills(${result.skills.created}+${result.skills.updated}+${result.skills.skipped}) memories(${result.memories.created}+${result.memories.skipped}) rules(${result.rules.created}+${result.rules.updated}+${result.rules.skipped})`,
      );
    } catch (e) {
      console.error("[host-mount] 宿主数据注册失败:", (e as Error).message);
    }
  });

  return app;
}
