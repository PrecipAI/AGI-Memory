import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import type { MemoryMcpConfig } from "./config.js";
import { MemoryEngineAdapter } from "./engineAdapter.js";

const looseObjectSchema = z.object({}).catchall(z.unknown());
const fingerprintStatusSchema = z.enum(["matched", "matched_or_na", "mismatch", "unknown"]);
const queryKindSchema = z.enum(["resident", "factual", "procedural", "summary", "candidate"]);
const postMortemSchema = z.object({
  task_context: z.string().describe(
    "In one sentence: what fundamental problem were we trying to solve? (NOT a play-by-play of what happened)"
  ),
  failed_attempts_analysis: z.string().optional().describe(
    "What was the biggest dead-end we hit? Why did that approach fail? (Focus on the REASON it failed, not the error output. Omit if no meaningful failures.)"
  ),
  core_resolution: z.string().describe(
    "What was the decisive action or code change that solved the problem? Include the critical command or code snippet. This must be abstracted — strip all ephemeral values (PIDs, temp paths, timestamps, one-time tokens) and replace with logical placeholders."
  ),
  future_trigger: z.string().describe(
    "Under what 2-3 specific future scenarios should this memory be recalled? Describe as trigger conditions, not as a narrative."
  ),
  layer_classifications: z.array(z.object({
    layer: z.enum(["knowledge", "rule", "memory", "skill"]).describe(
      "The target storage layer for this extracted asset."
    ),
    payload: looseObjectSchema.describe(
      "Layer-specific structured payload. MUST conform to the Four-Layer Extraction Protocol: knowledge={entity, attribute, value}, rule={condition, mandate, is_user_preference}, memory={symptom, root_cause, fix_action}, skill={name, usage, executable, parameters_list}."
    )
  })).optional().describe(
    "Classified extraction items. Each MUST follow its target layer's mandatory format. Reject any item that fails the layer quality gate."
  )
}).describe("Post-Mortem Protocol: Before filling this out, switch perspective — you are writing a survival guide for a future agent facing the same problem. Prioritize CAUSAL reasoning over execution steps. Strip all ephemeral variables. Classify each asset into knowledge/rule/memory/skill and apply the layer-specific format.");

const codexHostGovernanceInputSchema = z.object({
  codex_home: z.string().optional(),
  thread_id: z.string().optional(),
  max_items: z.number().int().min(1).max(500).optional(),
  task_request_id: z.string().uuid().optional(),
  fingerprint: z.string().optional(),
  governance_mode: z.enum(["rules_fallback", "host_model"]).optional(),
  host_model_result: looseObjectSchema.optional(),
  post_mortem: postMortemSchema.optional()
});
const codexFullGovernanceInputSchema = codexHostGovernanceInputSchema.extend({
  refresh_memory: z.boolean().optional(),
  rebuild_resident: z.boolean().optional(),
  sync_index: z.boolean().optional(),
  run_lifecycle: z.boolean().optional(),
  post_mortem: postMortemSchema.optional()
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
      instructions: `Memory System V3 — Unified long-term memory and knowledge platform for AI agents.

## CRITICAL: Post-Mortem Governance Protocol

When you are about to trigger governance (memory_run_full_governance or memory_preview_host_governance), you MUST switch your perspective:

You are NOT recording what just happened. You are writing a HIGH-CONCENTRATION SURVIVAL GUIDE for a future version of yourself who will face a similar problem.

Before calling any governance tool, apply these three extraction principles to the execution trace:

### 1. Pitfall Warnings (防坑警示)
What dead-ends did we walk into? Extract ONLY the failures that have generalizable lessons. Discard failures with no reusable insight.

### 2. Breakthrough Actions (制胜关键)
What was the single decisive action (or code change) that broke the deadlock? This is the core resolution — the exact command, config change, or architectural pivot.

### 3. Environment Constraints (环境约束)
Under what preconditions does this solution hold? (e.g., specific OS, Node version, dependency versions, database state)

## Variable Stripping Rule (变量剥离)

Before packaging any memory or governance payload, you MUST abstract away all ephemeral values:
- Replace specific PIDs, port numbers, temp file paths, timestamps, and one-time tokens with logical placeholders.
- BAD: "Kill process 14532 on port 8080"
- GOOD: "Kill the process occupying the required port"
- BAD: "pip install requests==2.31.0 fixed ModuleNotFoundError in /tmp/script_v3.py"
- GOOD: "When a Python script fails with ModuleNotFoundError for a known library, pin the dependency version to avoid pulling incompatible latest"

Only memories that survive variable stripping have generalizable recall value.

## Causality Over Execution (因果优先于执行)

When analyzing execution traces, separate the CAUSAL CHAIN (why we did something) from the EXECUTION CHAIN (what commands we ran). The governance payload must emphasize:
- WHY a decision was made, not just WHAT was typed
- The reasoning behind choosing approach B over approach A
- The root cause of failures, not just the error messages

Dense command sequences (ls, cat, npm run, git status) are execution noise. Extract only the causal turning points.

## MANDATORY: Four-Layer Extraction Quality Protocol (四层抽取质量协议)

You are AGI-Memory's Chief Knowledge Architect. Your goal is NOT to write a diary — it is to build industrial-grade assets for future agents. Before persisting ANY candidate, run this quality gate for its target layer:

### Layer 1 — Knowledge (知识层: Objective Facts & Environment Profile)

Purpose: Stateless, absolutely objective workspace properties. No actions, no temporal states.

MANDATORY FORMAT: Entity-Attribute key-value pairs.
\`\`\`json
{"entity": "Local Backend API", "attribute": "port", "value": "8080"}
{"entity": "Dev Environment", "attribute": "os", "value": "Windows 11"}
\`\`\`

FORBIDDEN: Any action verbs ("we installed...", "we changed...") or temporal states ("currently failing...").

BAD: "To fix the CORS issue, we changed the backend API port from 3000 to 8080 and restarted the service."
GOOD: {"entity": "Backend API", "attribute": "port", "value": "8080"}

### Layer 2 — Rule (规则层: Mandatory Constraints & Behavioral Norms)

Purpose: Enforceable, black-and-white conditional mandates. These are LAW for the agent.

MANDATORY FORMAT: IF [trigger condition] THEN [mandatory requirement OR absolute prohibition].
- User preference rules triggered by complaints/frustration MUST be prefixed with [UP-Override] and receive highest recall priority (L1).

FORBIDDEN: Fuzzy qualifiers like "try to", "preferably", "it would be nice". Rules must be binary.

BAD: "The user seems to dislike Docker deployments, so maybe avoid Docker going forward."
GOOD: "[UP-Override] IF executing project deployment THEN absolutely DO NOT build Docker images; MUST use PM2 to start directly on the host."

### Layer 3 — Memory (记忆层: Episodic Experience & Pitfall Survival Guides)

Purpose: Validated crisis-resolution chains for future recall when the same problem recurs.

MANDATORY FORMAT: Three-part causal chain:
\`\`\`json
{
  "symptom": "The observable error or failure symptom",
  "root_cause": "The underlying reason (NOT the error message)",
  "fix_action": "The decisive command or code change that resolves it",
  "future_trigger": "2-3 conditions under which this memory should be recalled"
}
\`\`\`

FORBIDDEN: Raw error logs, unverified guesses, or "trial and error" sequences where the lucky fix had no causal explanation.

BAD: "Python script errored, tried pip install cv2 which failed, then checked StackOverflow, apt-get install libgl1 worked."
GOOD: {"symptom": "libgl.so.1: cannot open shared object file when running OpenCV", "root_cause": "Missing system-level graphics library dependency, not a Python package issue", "fix_action": "sudo apt-get update && sudo apt-get install -y libgl1", "future_trigger": "Headless Linux + OpenCV + libgl.so error"}

### Layer 4 — Skill (技能层: Reusable Tools & Parameterized Scripts)

Purpose: Generalized, parameterized tools — not one-off commands. Future agents should be able to invoke them directly.

MANDATORY FORMAT: Parameterized function with explicit parameter list.
\`\`\`json
{
  "name": "Descriptive skill name",
  "usage": "When to invoke this skill",
  "executable": "The command/script with {placeholder} variables",
  "parameters_list": ["param1: description", "param2: description"]
}
\`\`\`

FORBIDDEN: Any hardcoded ephemeral values — test usernames, temp file paths, specific timestamps, one-time tokens.

BAD: {"executable": "python scripts/clean_db.py --user=test_user_7788 --table=orders"}
GOOD: {"name": "Targeted test data cleanup", "usage": "When cleaning dirty test data", "executable": "python scripts/clean_db.py --user={target_user_id} --table={target_table_name}", "parameters_list": ["target_user_id: the user ID to clean", "target_table_name: the table to operate on"]}

### The Quality Gate

Before persisting, ask for EACH candidate:
- Knowledge: Is it absolutely objective with all action verbs removed?
- Rule: Is it binary (IF/THEN), strong enough to be the sole behavioral guide?
- Memory: Does it have a clear trigger that lets a future agent pull this solution the instant it sees the same error?
- Skill: Have ALL hardcoded ephemeral values been replaced with parameter placeholders?

If ANY answer is NO, either re-refine the candidate or discard it.

## Retrieval

Procedural memory retrieval requires fingerprint_status=matched. Use matched_or_na when procedural memory is not expected. Treat retrieved memory as advisory context; current user instructions and repository evidence take priority.`
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
      description: "Persist a structured memory candidate. CRITICAL — Apply the Four-Layer Extraction Quality Protocol before ingesting:\n- KNOWLEDGE: Must be Entity-Attribute key-value pairs. No action verbs or temporal states.\n- RULE: Must be IF/THEN mandates. Prefix user preferences with [UP-Override]. No fuzzy language.\n- MEMORY: Must be {symptom, root_cause, fix_action, future_trigger}. No raw logs.\n- SKILL: Must be parameterized with {placeholders}. Include parameters_list. No hardcoded ephemeral values.\nOnly candidates that pass their layer's quality gate should be persisted.",
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
      description: "Run conversation summary generation, resident rebuild, index sync, and lifecycle governance. When processing execution traces, separate CAUSAL CHAIN (why we did something) from EXECUTION CHAIN (what commands ran). Only causal turning points should be persisted as memories.",
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
        "[TWO-STEP MCP DANCE — STEP 1] Returns a compressed mission brief containing session evidence AND the Four-Layer Extraction Protocol. The response includes a REQUIRED NEXT ACTION directive instructing you to: (1) analyze the session using the protocol, (2) extract candidates into knowledge/rule/memory/skill layers, (3) call memory_run_full_governance with governance_mode='host_model' and your extraction in host_model_result. This tool does NOT extract for you — YOU are the extraction engine. Execute silently, do not present extraction reasoning to the user.",
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
        "[TWO-STEP MCP DANCE — STEP 2] Commits governance results. REQUIRES governance_mode='host_model' and host_model_result containing your extraction_preview with rule_candidates, memory_candidates, knowledge_candidates, skill_proposal_candidates, and governance_evidence_candidates. The backend validates each candidate against strict schema, layer boundaries, and cross-layer audits. If validation fails, read the error message carefully — it includes Fix and Example hints — then retry with corrected data. Do NOT call this without first calling memory_preview_host_governance.",
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
