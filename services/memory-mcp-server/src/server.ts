import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import type { MemoryMcpConfig } from "./config.js";
import { MemoryEngineAdapter } from "./engineAdapter.js";

const looseObjectSchema = z.object({}).catchall(z.unknown());
const fingerprintStatusSchema = z.enum(["matched", "matched_or_na", "mismatch", "unknown"]);
const queryKindSchema = z.enum(["resident", "factual", "procedural", "summary", "candidate"]);
const codexHostGovernanceInputSchema = z.object({
  codex_home: z.string().optional(),
  thread_id: z.string().optional(),
  max_items: z.number().int().min(1).max(500).optional(),
  task_request_id: z.string().uuid().optional(),
  fingerprint: z.string().optional(),
  governance_mode: z.enum(["rules_fallback", "host_model"]).optional(),
  host_model_result: looseObjectSchema.optional()
});
const codexFullGovernanceInputSchema = codexHostGovernanceInputSchema.extend({
  refresh_memory: z.boolean().optional(),
  rebuild_resident: z.boolean().optional(),
  sync_index: z.boolean().optional(),
  run_lifecycle: z.boolean().optional()
});

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function requireToolArgument<T>(value: T | undefined, fieldName: string, errorCode: string): T {
  if (value === undefined) {
    throw new Error(`${errorCode}: missing required field '${fieldName}'`);
  }
  return value;
}

function readTaskRequestId(value: unknown, fallback?: string): string | undefined {
  if (typeof fallback === "string" && fallback.length > 0) {
    return fallback;
  }
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return typeof record.task_request_id === "string" && record.task_request_id.length > 0
    ? record.task_request_id
    : undefined;
}

export function buildMemoryMcpServer(config: MemoryMcpConfig) {
  const adapter = new MemoryEngineAdapter(config);
  const server = new McpServer(
    {
      name: "memory-v3-mcp-server",
      version: "0.1.0"
    },
    {
      capabilities: {
        logging: {}
      },
      instructions:
        "Memory System V3 MCP server for single-tenant validation and productization. Use tools for query, retrieve, candidate ingestion, and governance. Procedural retrieval requires fingerprint_status=matched."
    }
  );

  server.registerTool(
    "memory_health",
    {
      title: "Memory Health",
      description: "Return memory engine health and default runtime scope.",
      inputSchema: looseObjectSchema.optional()
    },
    async () => {
      const health = await adapter.getHealth();
      return {
        content: [
          {
            type: "text",
            text: jsonText(health)
          }
        ],
        structuredContent: health
      };
    }
  );

  server.registerTool(
    "memory_query_layer",
    {
      title: "Memory Query Layer",
      description: "Read one memory layer for debugging or validation.",
      inputSchema: z.object({
        kind: queryKindSchema,
        task_request_id: z.string().uuid().optional(),
        fingerprint: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional()
      })
    },
    async (args) => {
      const result = await adapter.query(args);
      return {
        content: [
          {
            type: "text",
            text: jsonText(result)
          }
        ],
        structuredContent: result
      };
    }
  );

  server.registerTool(
    "memory_retrieve_context",
    {
      title: "Memory Retrieve Context",
      description:
        "Assemble runtime summary, conversation summary, resident snapshot, and gated factual/procedural memory. Procedural memory requires fingerprint_status=matched.",
      inputSchema: z.object({
        task_request_id: z.string().uuid(),
        query: z.string().min(1),
        runtime_summary: looseObjectSchema.optional(),
        fingerprint: z.string().optional(),
        fingerprint_status: fingerprintStatusSchema.optional(),
        include_procedural: z.boolean().optional(),
        include_factual: z.boolean().optional(),
        limit: z.number().int().min(1).max(50).optional(),
        task_type: z
          .enum(["design", "execution", "debugging", "governance", "review", "ingestion", "integration", "answer"])
          .optional(),
        host: z.string().optional(),
        project_ref: z.string().optional(),
        operation_intent: z.string().optional(),
        context_budget_tokens: z.number().int().min(256).max(200000).optional(),
        existing_bundle_id: z.string().uuid().optional(),
        existing_query_hash: z.string().optional(),
        layer_versions: looseObjectSchema.optional(),
        required_layers: z.array(z.string()).optional(),
        forbidden_layers: z.array(z.string()).optional(),
        compression_mode: z.enum(["none", "light", "aggressive", "evidence_only"]).optional(),
        attention_layout: z.string().optional()
      })
    },
    async (args) => {
      const result = await adapter.retrieve({
        ...args,
        fingerprint_status: requireToolArgument(
          args.fingerprint_status,
          "fingerprint_status",
          "FINGERPRINT_STATUS_REQUIRED"
        )
      });
      return {
        content: [
          {
            type: "text",
            text: jsonText(result)
          }
        ],
        structuredContent: result
      };
    }
  );

  server.registerTool(
    "memory_ingest_candidate",
    {
      title: "Memory Ingest Candidate",
      description: "Persist a structured memory candidate and route it deterministically into memory or skill.",
      inputSchema: z.object({
        task_request_id: z.string().uuid(),
        task_step_id: z.string().uuid(),
        source_type: z.string(),
        source_ref: z.string(),
        artifact_tag: z.string(),
        error_code: z.string().optional(),
        verification_status: z.string(),
        side_effect_class: z.enum(["none", "read_only", "external_resource", "state_change", "approval"]),
        fingerprint: z.string().optional(),
        fingerprint_status: fingerprintStatusSchema,
        candidate_payload: looseObjectSchema,
        llm_refined_payload: looseObjectSchema.optional()
      })
    },
    async (args) => {
      const result = await adapter.ingestCandidate(args);
      return {
        content: [
          {
            type: "text",
            text: jsonText(result)
          }
        ],
        structuredContent: result
      };
    }
  );

  server.registerTool(
    "memory_run_governance",
    {
      title: "Memory Governance Run",
      description: "Run conversation summary generation, resident rebuild, index sync, and lifecycle governance.",
      inputSchema: z.object({
        task_request_id: z.string().uuid(),
        task_step_id: z.string().uuid().optional(),
        fingerprint: z.string().optional(),
        rebuild_resident: z.boolean().optional(),
        sync_index: z.boolean().optional(),
        run_lifecycle: z.boolean().optional()
      })
    },
    async (args) => {
      const result = await adapter.runGovernance(args);
      return {
        content: [
          {
            type: "text",
            text: jsonText(result)
          }
        ],
        structuredContent: result
      };
    }
  );

  server.registerTool(
    "memory_preview_host_governance",
    {
      title: "Memory Preview Host Governance",
      description:
        "Preview the full Codex host-capture governance path before writing candidates. Use before a full governance run when the user asks what evidence will be governed.",
      inputSchema: codexHostGovernanceInputSchema
    },
    async (args) => {
      const result = await adapter.previewCodexHostGovernance(args);
      return {
        content: [
          {
            type: "text",
            text: jsonText(result)
          }
        ],
        structuredContent: result
      };
    }
  );

  server.registerTool(
    "memory_run_full_governance",
    {
      title: "Memory Full Governance Run",
      description:
        "Run the complete Codex host-capture governance path, then optionally refresh Memory MCP summary, resident snapshot, index, and lifecycle. Prefer this when the user asks to run governance.",
      inputSchema: codexFullGovernanceInputSchema
    },
    async (args) => {
      const { refresh_memory: refreshMemory, rebuild_resident, sync_index, run_lifecycle, ...hostArgs } = args;
      const taskRequestId = args.task_request_id ?? randomUUID();
      const ruleGate = await adapter.checkRuleGate({
        task_request_id: taskRequestId,
        task_type: "governance",
        host: "codex",
        operation: "run_full_host_governance",
        evidence: {
          thread_id: args.thread_id ?? null,
          max_items: args.max_items ?? null,
          codex_home_provided: typeof args.codex_home === "string" && args.codex_home.length > 0,
          refresh_memory: refreshMemory !== false,
          rebuild_resident: rebuild_resident ?? null,
          sync_index: sync_index ?? null,
          run_lifecycle: run_lifecycle ?? null
        }
      });
      if (ruleGate.decision === "ask_user" || ruleGate.decision === "block") {
        throw new Error(`RULE_GATE_${ruleGate.decision.toUpperCase()}: full host governance was not executed`);
      }

      const hostGovernance = await adapter.runCodexHostGovernance({
        ...hostArgs,
        task_request_id: taskRequestId
      });
      const refreshTaskRequestId = readTaskRequestId(hostGovernance, taskRequestId);
      const memoryRefresh =
        refreshMemory === false || refreshTaskRequestId === undefined
          ? null
          : await adapter.runGovernance({
              task_request_id: refreshTaskRequestId,
              fingerprint: args.fingerprint,
              rebuild_resident,
              sync_index,
              run_lifecycle
            });
      const result = {
        rule_gate: ruleGate,
        host_governance: hostGovernance,
        memory_refresh: memoryRefresh
      };

      return {
        content: [
          {
            type: "text",
            text: jsonText(result)
          }
        ],
        structuredContent: result
      };
    }
  );

  server.registerTool(
    "rule_gate_check",
    {
      title: "Rule Gate Check",
      description:
        "Check active task-bound rule checkpoints before a high-risk operation and write a rule gate audit record.",
      inputSchema: z.object({
        task_request_id: z.string().uuid(),
        task_step_id: z.string().uuid().optional(),
        task_type: z
          .enum(["design", "execution", "debugging", "governance", "review", "ingestion", "integration", "answer"])
          .optional(),
        host: z.string().optional(),
        project_ref: z.string().optional(),
        operation: z.string().min(1),
        checkpoint_keys: z.array(z.string()).optional(),
        evidence: looseObjectSchema.optional(),
        actor_ref: z.string().optional()
      })
    },
    async (args) => {
      const result = await adapter.checkRuleGate(args);
      return {
        content: [
          {
            type: "text",
            text: jsonText(result)
          }
        ],
        structuredContent: result
      };
    }
  );

  server.registerResource(
    "memory-health",
    "memory://health",
    {
      title: "Memory Health",
      description: "Current health and runtime defaults for Memory System V3."
    },
    async (uri) => {
      const health = await adapter.getHealth();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: jsonText(health)
          }
        ]
      };
    }
  );

  server.registerResource(
    "memory-defaults",
    "memory://defaults",
    {
      title: "Memory Defaults",
      description: "Default tenant, scope, and single-tenant policy for the MCP server."
    },
    async (uri) => {
      const defaults = adapter.getDefaults();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: jsonText(defaults)
          }
        ]
      };
    }
  );

  return {
    server,
    adapter
  };
}
