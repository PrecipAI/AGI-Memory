import type { MemoryRetrieveRequest, MemoryRetrieveResponse } from "@super-agent/contracts";
import {
  createMemoryAccessLog,
  queryActiveDerivedKnowledge,
  queryActiveRules,
  queryActiveTaskBindings,
  queryConversationSummary,
  queryDerivedKnowledgeEvidence,
  queryFactualMemory,
  queryMemoryLayerVersions,
  queryProceduralMemory,
  queryRuleCheckpoints,
  queryResidentSnapshot
} from "@super-agent/db";
import { createFrozenHttpError } from "./errors.js";
import type { RetrievalGate } from "./retrievalGate.js";

type LayerAccessLoggerInput = {
  tenantId: string;
  scope: string;
  queryKind: string;
  queryPayload: Record<string, unknown>;
  decisionPayload: Record<string, unknown>;
  items: Record<string, unknown>[];
  traceId: string;
  objectType: string;
};

const TASK_LAYER_DEFAULTS: Record<string, string[]> = {
  design: ["conversation_summary", "rules", "resident_snapshot", "factual_memory", "synthesized_knowledge", "procedural_memory"],
  execution: ["conversation_summary", "rules", "resident_snapshot", "factual_memory", "procedural_memory"],
  debugging: ["conversation_summary", "rules", "resident_snapshot", "factual_memory", "procedural_memory", "synthesized_knowledge"],
  governance: [
    "conversation_summary",
    "rules",
    "resident_snapshot",
    "factual_memory",
    "synthesized_knowledge",
    "evidence_index",
    "procedural_memory"
  ],
  review: ["conversation_summary", "rules", "resident_snapshot", "factual_memory", "synthesized_knowledge", "evidence_index"],
  ingestion: ["conversation_summary", "rules", "resident_snapshot", "factual_memory", "synthesized_knowledge"],
  integration: ["conversation_summary", "rules", "resident_snapshot", "factual_memory", "procedural_memory", "synthesized_knowledge"],
  answer: [
    "conversation_summary",
    "rules",
    "resident_snapshot",
    "factual_memory",
    "procedural_memory",
    "synthesized_knowledge",
    "evidence_index"
  ]
};

const TASK_PHASE_DEFAULTS: Record<string, string> = {
  design: "design",
  execution: "coding",
  debugging: "coding",
  governance: "governance",
  review: "review",
  ingestion: "integration",
  integration: "integration",
  answer: "planning"
};

type RetrievalLayer =
  | "conversation_summary"
  | "resident_snapshot"
  | "rules"
  | "factual_memory"
  | "procedural_memory"
  | "synthesized_knowledge"
  | "evidence_index";

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function resolveTaskType(value: unknown): string {
  const taskType = typeof value === "string" && value.length > 0 ? value : "answer";
  return TASK_LAYER_DEFAULTS[taskType] ? taskType : "answer";
}

function resolveTaskPhase(value: unknown, taskType: string): string {
  const taskPhase = typeof value === "string" && value.length > 0 ? value : TASK_PHASE_DEFAULTS[taskType] ?? "planning";
  const allowed = new Set(["planning", "design", "coding", "testing", "review", "governance", "reporting", "integration"]);
  return allowed.has(taskPhase) ? taskPhase : TASK_PHASE_DEFAULTS[taskType] ?? "planning";
}

function resolveRequestedLayers(body: MemoryRetrieveRequest): Set<RetrievalLayer> {
  const taskType = resolveTaskType((body as Record<string, unknown>).task_type);
  const requested = new Set<RetrievalLayer>(TASK_LAYER_DEFAULTS[taskType] as RetrievalLayer[]);
  for (const layer of asStringArray((body as Record<string, unknown>).required_layers)) {
    requested.add(layer as RetrievalLayer);
  }
  for (const layer of asStringArray((body as Record<string, unknown>).forbidden_layers)) {
    requested.delete(layer as RetrievalLayer);
  }
  return requested;
}

function buildQueryHash(input: {
  query: string;
  taskType: string;
  fingerprintStatus: string;
  layers: string[];
  host?: unknown;
  projectRef?: unknown;
  operationIntent?: unknown;
  taskPhase?: unknown;
}): string {
  return Buffer.from(JSON.stringify(input)).toString("base64url").slice(0, 64);
}

function layerVersionsMatch(left: unknown, right: unknown): boolean {
  if (!left || !right || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function shouldReuseExistingBundle(input: {
  existingBundleId?: unknown;
  existingQueryHash?: unknown;
  queryHash: string;
  existingLayerVersions?: unknown;
  currentLayerVersions: Record<string, unknown>;
}): boolean {
  return (
    typeof input.existingBundleId === "string" &&
    input.existingBundleId.length > 0 &&
    typeof input.existingQueryHash === "string" &&
    input.existingQueryHash === input.queryHash &&
    layerVersionsMatch(input.existingLayerVersions, input.currentLayerVersions)
  );
}

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value ?? "").length / 4);
}

function applyContextBudget<T extends Record<string, unknown>>(items: T[], tokenBudget: number, mode: string): T[] {
  if (mode === "none" || tokenBudget <= 0) {
    return items;
  }
  const output: T[] = [];
  let used = 0;
  for (const item of items) {
    const slim =
      mode === "aggressive" || mode === "evidence_only"
        ? ({
            id: item.id,
            title: item.title ?? item.rule_key ?? item.skill_key ?? item.source_uri,
            source_ref: item.source_ref ?? item.source_uri,
            enforcement_level: item.enforcement_level,
            priority: item.priority,
            risk_level: item.risk_level
          } as unknown as T)
        : item;
    const next = estimateTokens(slim);
    if (used + next > tokenBudget) {
      break;
    }
    output.push(slim);
    used += next;
  }
  return output;
}

function buildContextPackage(input: {
  body: MemoryRetrieveRequest;
  taskType: string;
  taskPhase: string;
  requestedLayers: Set<RetrievalLayer>;
  compressionMode: string;
  contextBudgetTokens: number;
  rules: Record<string, unknown>[];
  ruleCheckpoints: Record<string, unknown>[];
  residentSnapshot: Record<string, unknown>[];
  factualMemory: Record<string, unknown>[];
  proceduralMemory: Record<string, unknown>[];
  synthesizedKnowledge: Record<string, unknown>[];
  evidenceIndex: Record<string, unknown>[];
}) {
  const ruleBudget = Math.max(200, Math.floor(input.contextBudgetTokens * 0.2));
  const memoryBudget = Math.max(200, Math.floor(input.contextBudgetTokens * 0.2));
  const skillBudget = Math.max(200, Math.floor(input.contextBudgetTokens * 0.15));
  const knowledgeBudget = Math.max(200, Math.floor(input.contextBudgetTokens * 0.2));
  const evidenceBudget = Math.max(100, Math.floor(input.contextBudgetTokens * 0.1));

  return {
    attention_layout: (input.body as Record<string, unknown>).attention_layout ?? "front_rules_tail_reminder",
    sections: [
      {
        name: "Execution Rules",
        layer: "rules",
        priority: 1,
        placement: "front",
        items: applyContextBudget(
          input.rules.map((rule) => ({
            ...rule,
            checkpoints: input.ruleCheckpoints.filter((checkpoint) => checkpoint.rule_id === rule.id)
          })),
          ruleBudget,
          input.compressionMode
        )
      },
      {
        name: "Task Goal",
        layer: "runtime",
        priority: 2,
        placement: "front",
        items: [{ query: input.body.query, task_type: input.taskType, task_phase: input.taskPhase, runtime_summary: input.body.runtime_summary ?? null }]
      },
      {
        name: "Relevant Memory",
        layer: "memory",
        priority: 3,
        placement: "middle",
        items: applyContextBudget([...input.residentSnapshot, ...input.factualMemory], memoryBudget, input.compressionMode)
      },
      {
        name: "Relevant Skills",
        layer: "skill",
        priority: 4,
        placement: "middle",
        items: applyContextBudget(input.proceduralMemory, skillBudget, input.compressionMode)
      },
      {
        name: "Synthesized Knowledge",
        layer: "knowledge",
        priority: 5,
        placement: "middle",
        items: applyContextBudget(input.synthesizedKnowledge, knowledgeBudget, input.compressionMode)
      },
      {
        name: "Evidence Index",
        layer: "evidence",
        priority: 6,
        placement: "middle",
        items: applyContextBudget(input.evidenceIndex, evidenceBudget, input.compressionMode)
      },
      {
        name: "Current Step Reminder",
        layer: "runtime",
        priority: 7,
        placement: "tail",
        items: [
          {
            reminder: "Follow Execution Rules first. Use memory as reference context. Ask the user when a rule failure cannot be bypassed."
          }
        ]
      }
    ],
    compression: {
      mode: input.compressionMode,
      estimated_tokens: estimateTokens({
        rules: input.rules,
        memory: input.factualMemory,
        skills: input.proceduralMemory,
        knowledge: input.synthesizedKnowledge,
        evidence: input.evidenceIndex
      }),
      budget_tokens: input.contextBudgetTokens
    }
  };
}

export async function logLayerAccess(input: LayerAccessLoggerInput) {
  for (const item of input.items) {
    const itemId = item.id ? String(item.id) : null;
    await createMemoryAccessLog({
      tenantId: input.tenantId,
      scope: input.scope,
      memoryId: input.objectType === "memory" && itemId ? itemId : null,
      queryKind: input.queryKind,
      queryPayload: input.queryPayload,
      decisionPayload: {
        ...input.decisionPayload,
        returned: true
      },
      objectType: input.objectType,
      objectRef: itemId,
      traceId: input.traceId
    });
  }
}

export function assertRetrieveContract(body: MemoryRetrieveRequest): void {
  if (!body.fingerprint_status) {
    throw createFrozenHttpError(
      400,
      "fingerprint_status is required for /internal/memory/retrieve so retrieval gates do not guess caller intent.",
      "FINGERPRINT_STATUS_REQUIRED"
    );
  }

  if (body.include_procedural !== false && !body.fingerprint) {
    throw createFrozenHttpError(
      400,
      "fingerprint is required when include_procedural=true because procedural retrieval must be fingerprint-gated.",
      "FINGERPRINT_REQUIRED"
    );
  }
}

export async function buildRetrieveBundle(input: {
  tenantId: string;
  scope: string;
  traceId: string;
  body: MemoryRetrieveRequest;
  retrievalGate: RetrievalGate;
}): Promise<MemoryRetrieveResponse> {
  assertRetrieveContract(input.body);
  const bodyRecord = input.body as Record<string, unknown>;
  const taskType = resolveTaskType(bodyRecord.task_type);
  const taskPhase = resolveTaskPhase(bodyRecord.task_phase, taskType);
  const requestedLayers = resolveRequestedLayers(input.body);
  const currentLayerVersions = await queryMemoryLayerVersions({
    tenantId: input.tenantId,
    scope: input.scope
  });
  const queryHash = buildQueryHash({
    query: input.body.query,
    taskType,
    taskPhase,
    fingerprintStatus: input.body.fingerprint_status,
    layers: [...requestedLayers].sort(),
    host: bodyRecord.host ?? null,
    projectRef: bodyRecord.project_ref ?? null,
    operationIntent: bodyRecord.operation_intent ?? null
  });
  const reuseExistingBundle = shouldReuseExistingBundle({
    existingBundleId: bodyRecord.existing_bundle_id,
    existingQueryHash: bodyRecord.existing_query_hash,
    queryHash,
    existingLayerVersions: bodyRecord.layer_versions,
    currentLayerVersions
  });

  const gates = input.retrievalGate.build({
    fingerprint: input.body.fingerprint ?? null,
    fingerprintStatus: input.body.fingerprint_status,
    includeFactual: input.body.include_factual,
    includeProcedural: input.body.include_procedural
  });

  const [conversationSummary, residentSnapshot, taskBindings, rules, factualMemory, proceduralMemory, synthesizedKnowledge] = await Promise.all([
    requestedLayers.has("conversation_summary")
      ? queryConversationSummary({
          tenantId: input.tenantId,
          scope: input.scope,
          taskRequestId: input.body.task_request_id,
          limit: input.body.limit ?? 10
        })
      : Promise.resolve([]),
    requestedLayers.has("resident_snapshot")
      ? queryResidentSnapshot({
          tenantId: input.tenantId,
          scope: input.scope,
          limit: 5
        })
      : Promise.resolve([]),
    requestedLayers.has("rules") || requestedLayers.has("procedural_memory")
      ? queryActiveTaskBindings({
          tenantId: input.tenantId,
          scope: input.scope,
          taskType,
          host: typeof bodyRecord.host === "string" ? bodyRecord.host : null,
          projectRef: typeof bodyRecord.project_ref === "string" ? bodyRecord.project_ref : null,
          limit: input.body.limit ?? 10
        })
      : Promise.resolve([]),
    requestedLayers.has("rules")
      ? queryActiveRules({
          tenantId: input.tenantId,
          scope: input.scope,
          query: input.body.query,
          taskType: typeof bodyRecord.task_type === "string" ? taskType : null,
          taskPhase,
          limit: input.body.limit ?? 10
        })
      : Promise.resolve([]),
    requestedLayers.has("factual_memory") && gates.factual.allowed
      ? queryFactualMemory({
          tenantId: input.tenantId,
          scope: input.scope,
          query: input.body.query,
          limit: input.body.limit ?? 10
        })
      : Promise.resolve([]),
    requestedLayers.has("procedural_memory") && gates.procedural.allowed
      ? queryProceduralMemory({
          tenantId: input.tenantId,
          scope: input.scope,
          fingerprint: input.body.fingerprint ?? null,
          limit: input.body.limit ?? 10
        })
      : Promise.resolve([]),
    requestedLayers.has("synthesized_knowledge")
      ? queryActiveDerivedKnowledge({
          tenantId: input.tenantId,
          scope: input.scope,
          query: input.body.query,
          limit: input.body.limit ?? 10
        })
      : Promise.resolve([])
  ]);
  const boundRuleKeys = new Set(
    taskBindings.flatMap((binding) => (Array.isArray(binding.rule_keys) ? binding.rule_keys.map(String) : []))
  );
  const sortedRules =
    boundRuleKeys.size > 0
      ? [...rules].sort((left, right) => Number(boundRuleKeys.has(String(right.rule_key))) - Number(boundRuleKeys.has(String(left.rule_key))))
      : rules;
  const ruleCheckpoints = await queryRuleCheckpoints({
    tenantId: input.tenantId,
    scope: input.scope,
    ruleIds: sortedRules.map((item) => String(item.id)).filter(Boolean),
    operation: typeof bodyRecord.operation_intent === "string" ? bodyRecord.operation_intent : null
  });
  const ruleChecklist = ruleCheckpoints.map((checkpoint) => ({
    checkpoint_key: checkpoint.checkpoint_key,
    rule_id: checkpoint.rule_id,
    rule_key: sortedRules.find((rule) => rule.id === checkpoint.rule_id)?.rule_key ?? null,
    phase: checkpoint.checkpoint_phase,
    operation: checkpoint.operation,
    requirement: checkpoint.requirement,
    evidence_required: checkpoint.evidence_required,
    failure_behavior: checkpoint.failure_behavior,
    verifier_ref: checkpoint.verifier_ref
  }));
  const evidenceIndex =
    requestedLayers.has("evidence_index") && synthesizedKnowledge.length > 0
      ? await queryDerivedKnowledgeEvidence({
          tenantId: input.tenantId,
          scope: input.scope,
          synthesizedKnowledgeIds: synthesizedKnowledge.map((item) => String(item.id))
        })
      : [];
  const compressionMode =
    typeof bodyRecord.compression_mode === "string"
      ? bodyRecord.compression_mode
      : Number(bodyRecord.context_budget_tokens ?? 0) > 0
        ? "light"
        : "none";
  const contextBudgetTokens = Number(bodyRecord.context_budget_tokens ?? 8000);
  const contextPackage = buildContextPackage({
    body: input.body,
    taskType,
    taskPhase,
    requestedLayers,
    compressionMode,
    contextBudgetTokens,
    rules: sortedRules,
    ruleCheckpoints,
    residentSnapshot,
    factualMemory,
    proceduralMemory,
    synthesizedKnowledge,
    evidenceIndex
  });

  const queryPayload = {
    task_request_id: input.body.task_request_id,
    query: input.body.query,
    fingerprint: input.body.fingerprint ?? null,
    fingerprint_status: input.body.fingerprint_status,
    task_type: taskType,
    task_phase: taskPhase,
    host: bodyRecord.host ?? null,
    project_ref: bodyRecord.project_ref ?? null,
    operation_intent: bodyRecord.operation_intent ?? null,
    query_hash: queryHash,
    requested_layers: [...requestedLayers],
    existing_bundle_id: bodyRecord.existing_bundle_id ?? null,
    reuse_existing_bundle: reuseExistingBundle
  };

  const bundleId = await createMemoryAccessLog({
    tenantId: input.tenantId,
    scope: input.scope,
    queryKind: "retrieve:bundle",
    queryPayload,
    decisionPayload: {
      gates,
      rule_count: sortedRules.length,
      task_binding_count: taskBindings.length,
      rule_checkpoint_count: ruleCheckpoints.length,
      factual_count: factualMemory.length,
      procedural_count: proceduralMemory.length,
      synthesized_knowledge_count: synthesizedKnowledge.length,
      evidence_index_count: evidenceIndex.length,
      layer_versions: currentLayerVersions,
      compression: contextPackage.compression,
      reuse_existing_bundle: reuseExistingBundle
    },
    objectType: "bundle",
    objectRef: input.body.task_request_id,
    traceId: input.traceId
  });

  const response: MemoryRetrieveResponse = {
    bundle_id: bundleId,
    runtime_summary: input.body.runtime_summary ?? {
      query: input.body.query
    },
    conversation_summary: conversationSummary,
    resident_snapshot: residentSnapshot,
    rules: sortedRules,
    factual_memory: factualMemory,
    procedural_memory: proceduralMemory,
    synthesized_knowledge: synthesizedKnowledge,
    evidence_index: evidenceIndex,
    layer_versions: currentLayerVersions,
    assembly_context: {
      task_type: taskType,
      task_phase: taskPhase,
      query_hash: queryHash,
      requested_layers: [...requestedLayers],
      task_bindings: taskBindings,
      rule_checklist: ruleChecklist,
      reuse_existing_bundle: reuseExistingBundle,
      existing_bundle_id: bodyRecord.existing_bundle_id ?? null,
      compression_mode: compressionMode,
      context_budget_tokens: contextBudgetTokens,
      rule_failure_policy: "rule_declares_failure_behavior"
    },
    context_package: contextPackage,
    gates
  };

  await Promise.all([
    logLayerAccess({
      tenantId: input.tenantId,
      scope: input.scope,
      queryKind: "retrieve:conversation_summary",
      queryPayload,
      decisionPayload: {
        gates
      },
      items: conversationSummary,
      traceId: input.traceId,
      objectType: "conversation_summary"
    }),
    logLayerAccess({
      tenantId: input.tenantId,
      scope: input.scope,
      queryKind: "retrieve:resident_snapshot",
      queryPayload,
      decisionPayload: {
        gates
      },
      items: residentSnapshot,
      traceId: input.traceId,
      objectType: "resident_snapshot"
    }),
    logLayerAccess({
      tenantId: input.tenantId,
      scope: input.scope,
      queryKind: "retrieve:rules",
      queryPayload,
      decisionPayload: {
        source: "active_rules"
      },
      items: sortedRules,
      traceId: input.traceId,
      objectType: "rule"
    }),
    logLayerAccess({
      tenantId: input.tenantId,
      scope: input.scope,
      queryKind: "retrieve:factual_memory",
      queryPayload,
      decisionPayload: {
        gate: gates.factual
      },
      items: factualMemory,
      traceId: input.traceId,
      objectType: "memory"
    }),
    logLayerAccess({
      tenantId: input.tenantId,
      scope: input.scope,
      queryKind: "retrieve:procedural_memory",
      queryPayload,
      decisionPayload: {
        gate: gates.procedural
      },
      items: proceduralMemory,
      traceId: input.traceId,
      objectType: "skill"
    }),
    logLayerAccess({
      tenantId: input.tenantId,
      scope: input.scope,
      queryKind: "retrieve:synthesized_knowledge",
      queryPayload,
      decisionPayload: {
        source: "active_synthesized_knowledge"
      },
      items: synthesizedKnowledge,
      traceId: input.traceId,
      objectType: "synthesized_knowledge"
    }),
    logLayerAccess({
      tenantId: input.tenantId,
      scope: input.scope,
      queryKind: "retrieve:evidence_index",
      queryPayload,
      decisionPayload: {
        source: "derived_knowledge_evidence"
      },
      items: evidenceIndex,
      traceId: input.traceId,
      objectType: "evidence"
    })
  ]);

  return response;
}
