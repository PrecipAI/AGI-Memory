import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import type { MemoryMcpConfig } from "./config.js";
import { MemoryEngineAdapter } from "./engineAdapter.js";

const looseObjectSchema = z.object({}).catchall(z.unknown());
const fingerprintStatusSchema = z.enum([
  "matched",
  "matched_or_na",
  "mismatch",
  "unknown",
]);
const queryKindSchema = z.enum([
  "resident",
  "factual",
  "procedural",
  "summary",
  "candidate",
]);
const postMortemSchema = z
  .object({
    task_context: z
      .string()
      .describe(
        "In one sentence: what fundamental problem were we trying to solve? (NOT a play-by-play of what happened)",
      ),
    failed_attempts_analysis: z
      .string()
      .optional()
      .describe(
        "What was the biggest dead-end we hit? Why did that approach fail? (Focus on the REASON it failed, not the error output. Omit if no meaningful failures.)",
      ),
    core_resolution: z
      .string()
      .describe(
        "What was the decisive action or code change that solved the problem? Include the critical command or code snippet. This must be abstracted — strip all ephemeral values (PIDs, temp paths, timestamps, one-time tokens) and replace with logical placeholders.",
      ),
    future_trigger: z
      .string()
      .describe(
        "Under what 2-3 specific future scenarios should this memory be recalled? Describe as trigger conditions, not as a narrative.",
      ),
    layer_classifications: z
      .array(
        z.object({
          layer: z
            .enum(["knowledge", "rule", "memory", "skill"])
            .describe("The target storage layer for this extracted asset."),
          payload: looseObjectSchema.describe(
            "Layer-specific structured payload. MUST conform to the Four-Layer Extraction Protocol: knowledge={entity, attribute, value}, rule={condition, mandate, is_user_preference}, memory={symptom, root_cause, fix_action}, skill={name, usage, executable, parameters_list}.",
          ),
        }),
      )
      .optional()
      .describe(
        "Classified extraction items. Each MUST follow its target layer's mandatory format. Reject any item that fails the layer quality gate.",
      ),
  })
  .describe(
    "Post-Mortem Protocol: Before filling this out, switch perspective — you are writing a survival guide for a future agent facing the same problem. Prioritize CAUSAL reasoning over execution steps. Strip all ephemeral variables. Classify each asset into knowledge/rule/memory/skill and apply the layer-specific format.",
  );

const candidateTypeSchema = z.enum([
  "rule_candidate",
  "memory_candidate",
  "skill_proposal_candidate",
  "knowledge_candidate",
  "governance_evidence_candidate",
]);
const sourceKindSchema = z.enum([
  "user_message",
  "assistant_message",
  "commentary",
  "command",
  "tool",
  "mcp",
]);
const originScopeSchema = z.enum([
  "session",
  "project",
  "workspace",
  "user",
  "team",
  "global",
]);
const availabilityScopeSchema = z.enum([
  "session_only",
  "project_reusable",
  "workspace_reusable",
  "user_reusable",
  "team_reusable",
  "global_reusable",
]);
const governanceLevelSchema = z.enum(["session", "shared"]);
const promotionStatusSchema = z.enum([
  "candidate",
  "active",
  "needs_review",
  "rejected",
]);
const confidenceSchema = z.enum(["high", "medium", "low"]);
const governanceSourceRefSchema = z.object({
  source_kind: sourceKindSchema,
  source_timestamp: z.string(),
  source_excerpt: z.string(),
});

const governanceCandidateBaseSchema = z.object({
  candidate_type: candidateTypeSchema.describe(
    "Must exactly match the array this candidate belongs to.",
  ),
  title: z
    .string()
    .describe("Concise, descriptive title for this extracted asset."),
  origin_scope: originScopeSchema.describe("Where this asset originated."),
  availability_scope: availabilityScopeSchema.describe(
    "How broadly this asset can be reused.",
  ),
  governance_level: governanceLevelSchema.describe(
    "Session-scoped or shared across sessions.",
  ),
  promotion_status: promotionStatusSchema
    .default("active")
    .describe(
      "Promotion status. Default: 'active'. Use 'needs_review' for skill proposals.",
    ),
  source_kind: sourceKindSchema.describe(
    "The kind of source that produced this candidate.",
  ),
  source_timestamp: z
    .string()
    .describe("ISO-8601 timestamp of the source event."),
  source_excerpt: z
    .string()
    .describe("Short excerpt from the source evidence."),
  content: z
    .string()
    .optional()
    .describe(
      "Optional main content. Falls back to source_excerpt if omitted.",
    ),
  reason: z.string().describe("Why this candidate should be persisted."),
  confidence: confidenceSchema
    .default("medium")
    .describe("Confidence level. Default: 'medium'."),
  stability: z
    .enum(["temporary", "stable", "long_lived"])
    .default("stable")
    .describe("How stable this asset is. Default: 'stable'."),
  governance_action: z
    .enum([
      "create",
      "merge_evidence",
      "update_existing",
      "replace_existing",
      "archive_existing",
      "evidence_only",
      "discard",
    ])
    .default("create")
    .describe("What governance action to take. Default: 'create'."),
  applies_to_phase: z
    .array(
      z.enum([
        "planning",
        "design",
        "coding",
        "testing",
        "review",
        "governance",
        "reporting",
        "integration",
      ]),
    )
    .default(["review"])
    .describe("Which project phases this applies to. Default: ['review']."),
  violation_behavior: z
    .enum(["block", "ask_user", "warn", "record"])
    .default("warn")
    .describe("What to do on violation. Default: 'warn'."),
  source_refs: z
    .array(governanceSourceRefSchema)
    .optional()
    .describe("Source references supporting this candidate."),
  // 后端 hostModelGovernanceAdapter 强制要求 rule 候选提供 metadata.human_readable_statement
  // 和 metadata.classification_rationale,否则会 throw validation error。
  // 其他候选类型也接受 metadata 用于存储额外上下文。
  metadata: z
    .object({
      human_readable_statement: z
        .string()
        .optional()
        .describe(
          "Human-readable rule statement (required for rule_candidate by backend validator).",
        ),
      classification_rationale: z
        .string()
        .optional()
        .describe(
          "Why this is classified as a rule vs memory vs skill (required for rule_candidate by backend validator).",
        ),
      enforcement_action: z
        .string()
        .optional()
        .describe("Optional enforcement action hint."),
      trigger_pattern: z
        .string()
        .optional()
        .describe("Optional trigger pattern description."),
    })
    .optional()
    .describe(
      "Metadata object. For rule_candidate, human_readable_statement and classification_rationale are REQUIRED by backend validator.",
    ),
});

const ruleCandidateSchema = governanceCandidateBaseSchema
  .extend({
    candidate_type: z.literal("rule_candidate"),
    content: z
      .string()
      .describe("The rule statement in IF/THEN format with MUST/MUST NOT."),
    rule_domain: z
      .enum([
        "design",
        "execution",
        "governance",
        "memory",
        "skill",
        "tooling",
        "reporting",
        "safety",
        "integration",
      ])
      .default("execution")
      .describe("The domain this rule governs. Default: 'execution'."),
    rule_scope: originScopeSchema
      .optional()
      .describe("Scope of the rule. Defaults to origin_scope if omitted."),
    trigger_conditions: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Rule trigger conditions snapshot. Backend fills default if omitted.",
      ),
  })
  .describe(
    "A hard constraint (IF/THEN mandate). Must contain MUST/MUST NOT or equivalent language. metadata.human_readable_statement and metadata.classification_rationale are REQUIRED.",
  );

const memoryCandidateSchema = governanceCandidateBaseSchema
  .extend({
    candidate_type: z.literal("memory_candidate"),
    memory_type: z
      .enum([
        "user_memory",
        "project_memory",
        "workspace_memory",
        "team_memory",
        "session_memory",
        "design_decision",
        "integration_context",
      ])
      .default("session_memory")
      .describe("Type of memory. Default: 'session_memory'."),
  })
  .describe(
    "An episodic experience or pitfall survival guide: {symptom, root_cause, fix_action}.",
  );

const skillProposalCandidateSchema = governanceCandidateBaseSchema
  .extend({
    candidate_type: z.literal("skill_proposal_candidate"),
    promotion_status: promotionStatusSchema
      .default("needs_review")
      .describe("Skill proposals MUST use 'needs_review'."),
    target_skill: z.string().describe("Name of the skill file to modify."),
    target_skill_path: z
      .string()
      .optional()
      .describe("Full path to the skill file."),
    change_type: z
      .enum(["add", "update", "split", "merge", "deprecate"])
      .default("update")
      .describe("Type of change. Default: 'update'."),
    current_section: z
      .string()
      .optional()
      .describe("Section of the skill being modified."),
    current_text: z
      .string()
      .optional()
      .describe("Current text in that section."),
    current_gap: z
      .string()
      .describe("What is missing or wrong in the current skill."),
    proposed_text: z.string().describe("The new or updated text."),
    proposed_patch: z
      .string()
      .optional()
      .describe("Patch format of the proposed change."),
    validation_method: z
      .string()
      .describe("How to verify the change is correct."),
    rationale: z.string().describe("Why this change is needed."),
    proposal_quality: z
      .enum(["actionable", "needs_review", "rejected"])
      .default("actionable")
      .describe("Quality assessment. Default: 'actionable'."),
    description: z
      .string()
      .optional()
      .describe("Optional skill description for the proposal."),
    applicable_scenarios: z
      .array(z.string())
      .optional()
      .describe("Scenarios where this skill applies."),
    non_applicable_scenarios: z
      .array(z.string())
      .optional()
      .describe("Scenarios where this skill does NOT apply."),
    execution_steps: z
      .array(z.string())
      .optional()
      .describe("Ordered execution steps for this skill."),
  })
  .describe(
    "A concrete proposal to create or modify a skill file. Requires human review.",
  );

const knowledgeCandidateSchema = governanceCandidateBaseSchema
  .extend({
    candidate_type: z.literal("knowledge_candidate"),
    knowledge_type: z
      .enum([
        "external_fact",
        "method",
        "pattern",
        "principle",
        "comparison",
        "limitation",
        "trend",
        "synthesis",
        "counterexample",
      ])
      .default("external_fact")
      .describe("Type of knowledge. Default: 'external_fact'."),
    synthesis_reasoning: z
      .string()
      .optional()
      .describe("Reasoning behind synthesized knowledge."),
  })
  .describe(
    "A reusable, objective fact extracted from execution. No project paths or machine-specific context.",
  );

const governanceEvidenceCandidateSchema = governanceCandidateBaseSchema
  .extend({
    candidate_type: z.literal("governance_evidence_candidate"),
    evidence_category: z
      .enum([
        "external_source",
        "uploaded_knowledge",
        "execution_step",
        "verification_evidence",
        "failure_reason",
        "success_reason",
        "tool_execution",
        "mcp_execution",
      ])
      .optional()
      .describe("Category of evidence."),
  })
  .describe(
    "Execution evidence (commands, tool calls, MCP calls) for governance review.",
  );

const extractionPreviewSchema = z
  .object({
    rule_candidates: z
      .array(ruleCandidateSchema)
      .default([])
      .describe("Hard constraints and behavioral norms."),
    memory_candidates: z
      .array(memoryCandidateSchema)
      .default([])
      .describe("Episodic experiences and pitfall survival guides."),
    skill_proposal_candidates: z
      .array(skillProposalCandidateSchema)
      .default([])
      .describe("Proposals to create or modify skill files."),
    knowledge_candidates: z
      .array(knowledgeCandidateSchema)
      .default([])
      .describe("Reusable objective facts from execution."),
    governance_evidence_candidates: z
      .array(governanceEvidenceCandidateSchema)
      .default([])
      .describe("Execution evidence for governance review."),
  })
  .describe(
    "Typed candidate arrays organized by layer. Each candidate must have candidate_type matching its array.",
  );

const hostModelResultSchema = z
  .object({
    model_ref: z.string().optional().describe("Optional model identifier."),
    generated_at: z
      .string()
      .optional()
      .describe("Optional ISO-8601 generation timestamp."),
    extraction_preview: extractionPreviewSchema.describe(
      "REQUIRED: The structured extraction with typed candidate arrays. This is the primary governance payload that the backend validates against strict schema, layer boundaries, and cross-layer audits.",
    ),
  })
  .describe(
    "Host model extraction result. The extraction_preview field is REQUIRED when governance_mode='host_model'.",
  );

const codexHostGovernanceInputSchema = z.object({
  host: z
    .string()
    .optional()
    .describe(
      "宿主类型：codex / qoder / trae / cursor / windsurf / continue / aider / cline 等。" +
        "默认 'codex'（向后兼容）。必须与当前实际宿主一致，否则会扫描错误的会话目录。" +
        "常见别名：claude-code/claude/cc→claude-code, qoderwork/qoderworkcn→qoder, trae_cn/traecn→trae。",
    ),
  codex_home: z
    .string()
    .optional()
    .describe(
      "宿主数据目录路径。codex 宿主专用（兼容旧字段）。" +
        "对 qoder/trae 等其他宿主，可用 host_home 字段（如果该宿主适配器需要）。",
    ),
  host_home: z
    .string()
    .optional()
    .describe(
      "宿主数据目录路径（通用字段，适用于所有宿主）。优先级低于 codex_home（仅 codex 宿主）。",
    ),
  thread_id: z.string().optional(),
  max_items: z.number().int().min(1).max(500).optional(),
  task_request_id: z.string().uuid().optional(),
  fingerprint: z.string().optional(),
  governance_mode: z.enum(["rules_fallback", "host_model"]).optional(),
  host_model_result: hostModelResultSchema.optional(),
  post_mortem: postMortemSchema.optional(),
  // Two-Step MCP Dance 硬约束：governance_mode='host_model' 时必填，
  // 必须是 memory_preview_host_governance 返回的 preview_token.token_id。
  // 服务端校验 token 有效 + 未过期 + 前缀匹配（Step 2 session 必须是 Step 1 的超集）。
  preview_token: z
    .string()
    .uuid()
    .optional()
    .describe(
      "REQUIRED when governance_mode='host_model'. Must be the preview_token.token_id returned by memory_preview_host_governance. " +
        "Proves that Step 1 was actually called before Step 2, and that the session context hasn't been swapped. " +
        "Expires after 10 minutes. If missing or invalid, the request is rejected with PREVIEW_TOKEN_* error codes.",
    ),
});
const codexFullGovernanceInputSchema = codexHostGovernanceInputSchema
  .extend({
    refresh_memory: z.boolean().optional(),
    rebuild_resident: z.boolean().optional(),
    sync_index: z.boolean().optional(),
    run_lifecycle: z.boolean().optional(),
    post_mortem: postMortemSchema.optional(),
  })
  .superRefine((val, ctx) => {
    // 硬约束：host_model 模式必须带 preview_token 和 host_model_result
    // 这两条之前只在 description 里写"REQUIRED"，但 schema 没强制，模型可以漏传。
    // 现在用 superRefine 做服务端硬校验，缺任一字段直接拒绝。
    // 报错信息统一包含 Fix + Example hints，与后端 formatValidationError 格式对齐。
    const mode = val.governance_mode ?? "host_model"; // 服务端默认 host_model
    if (mode === "host_model") {
      if (!val.preview_token) {
        ctx.addIssue({
          code: "custom",
          path: ["preview_token"],
          message:
            "preview_token: missing required field when governance_mode='host_model'. " +
            "Fix: Call memory_preview_host_governance first with the same host/thread_id, read preview_token.token_id from its response, then pass it here as preview_token. " +
            'Example: { "host": "codex", "thread_id": "<your-thread>", "governance_mode": "host_model", "preview_token": "<token_id-from-step-1>", "host_model_result": { "extraction_preview": { ... } } }',
        });
      }
      if (!val.host_model_result?.extraction_preview) {
        ctx.addIssue({
          code: "custom",
          path: ["host_model_result", "extraction_preview"],
          message:
            "host_model_result.extraction_preview: missing required field when governance_mode='host_model'. " +
            "Fix: YOU are the extraction engine — analyze the session evidence from Step 1, extract candidates into typed arrays (rule_candidates, memory_candidates, skill_proposal_candidates, knowledge_candidates, governance_evidence_candidates), and pass them as host_model_result.extraction_preview. See the tool description for a minimal legal example. " +
            'Example: { "host_model_result": { "extraction_preview": { "rule_candidates": [{ "candidate_type": "rule", "title": "...", "origin_scope": "global", "availability_scope": "global_reusable", "governance_level": "shared", "source_kind": "user_message", "source_timestamp": "2026-07-06T10:30:00Z", "source_excerpt": "...", "reason": "...", "confidence": 0.9, "content": "IF ... THEN ..." }], "memory_candidates": [], "skill_proposal_candidates": [], "knowledge_candidates": [], "governance_evidence_candidates": [] } } }',
        });
      }
    }
  });

function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function requireToolArgument<T>(
  value: T | undefined,
  fieldName: string,
  errorCode: string,
): T {
  if (value === undefined) {
    throw new Error(`${errorCode}: missing required field '${fieldName}'`);
  }
  return value;
}

function readTaskRequestId(
  value: unknown,
  fallback?: string,
): string | undefined {
  if (typeof fallback === "string" && fallback.length > 0) {
    return fallback;
  }
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return typeof record.task_request_id === "string" &&
    record.task_request_id.length > 0
    ? record.task_request_id
    : undefined;
}

export function buildMemoryMcpServer(config: MemoryMcpConfig) {
  const adapter = new MemoryEngineAdapter(config);
  const server = new McpServer(
    {
      name: "memory-v3-mcp-server",
      version: "0.1.0",
    },
    {
      capabilities: {
        logging: {},
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

Procedural memory retrieval requires fingerprint_status=matched. Use matched_or_na when procedural memory is not expected. Treat retrieved memory as advisory context; current user instructions and repository evidence take priority.`,
    },
  );

  server.registerTool(
    "memory_health",
    {
      title: "Memory Health",
      description:
        "Return memory engine health, default runtime scope, and a suggested task_request_id. " +
        "The suggested_task_request_id is an OPTIONAL hint — callers may use it directly OR generate their own UUID v4. " +
        "CONVENTION: All calls within the same task/session (memory_ingest_candidate, memory_run_governance, " +
        "memory_preview_host_governance, memory_run_full_governance, rule_gate_check) SHOULD reuse the same " +
        "task_request_id to keep governance runs correlated. Generate a new task_request_id only when starting a new task.",
      inputSchema: looseObjectSchema.optional(),
    },
    async () => {
      const health = await adapter.getHealth();
      return {
        content: [
          {
            type: "text",
            text: jsonText(health),
          },
        ],
        structuredContent: health,
      };
    },
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
        limit: z.number().int().min(1).max(50).optional(),
      }),
    },
    async (args) => {
      const result = await adapter.query(args);
      return {
        content: [
          {
            type: "text",
            text: jsonText(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "memory_retrieve_context",
    {
      title: "Memory Retrieve Context",
      description:
        "Assemble runtime summary, conversation summary, resident snapshot, and gated factual/procedural memory. Procedural memory requires fingerprint_status=matched.",
      inputSchema: looseObjectSchema,
    },
    async (args) => {
      const raw = (args ?? {}) as Record<string, unknown>;
      if (process.env.MCP_DEBUG_PAYLOAD) {
        console.error(
          `[MCP DEBUG] retrieve handler args keys: ${Object.keys(raw).join(",")} fingerprint=${raw.fingerprint ?? "MISSING"} include_procedural=${raw.include_procedural ?? "MISSING"}`,
        );
      }
      if (!raw.task_request_id || typeof raw.task_request_id !== "string") {
        throw new Error("task_request_id is required (uuid)");
      }
      if (!raw.query || typeof raw.query !== "string") {
        throw new Error("query is required (non-empty)");
      }
      // Workaround: MCP SDK 的 zod/v4-mini safeParse 会随机剔除部分 optional 字段
      // （fingerprint/include_procedural 等），在未升级 SDK 前显式补齐默认值避免后端 400
      const retrieveBody: Record<string, unknown> = { ...raw };
      if (retrieveBody.include_procedural === undefined) {
        retrieveBody.include_procedural = false;
      }
      retrieveBody.fingerprint_status = requireToolArgument(
        raw.fingerprint_status as string | undefined,
        "fingerprint_status",
        "FINGERPRINT_STATUS_REQUIRED",
      );
      const result = await adapter.retrieve(
        retrieveBody as Parameters<typeof adapter.retrieve>[0],
      );
      return {
        content: [
          {
            type: "text",
            text: jsonText(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "memory_ingest_candidate",
    {
      title: "Memory Ingest Candidate",
      description:
        "Persist a structured memory candidate. CRITICAL — Apply the Four-Layer Extraction Quality Protocol before ingesting:\n- KNOWLEDGE: Must be Entity-Attribute key-value pairs. No action verbs or temporal states.\n- RULE: Must be IF/THEN mandates. Prefix user preferences with [UP-Override]. No fuzzy language.\n- MEMORY: Must be {symptom, root_cause, fix_action, future_trigger}. No raw logs.\n- SKILL: Must be parameterized with {placeholders}. Include parameters_list. No hardcoded ephemeral values.\nOnly candidates that pass their layer's quality gate should be persisted.",
      inputSchema: z.object({
        task_request_id: z.string().uuid(),
        task_step_id: z.string().uuid(),
        source_type: z.string(),
        source_ref: z.string(),
        artifact_tag: z.string(),
        error_code: z.string().optional(),
        verification_status: z.string(),
        side_effect_class: z.enum([
          "none",
          "read_only",
          "external_resource",
          "state_change",
          "approval",
        ]),
        fingerprint: z.string().optional(),
        fingerprint_status: fingerprintStatusSchema,
        candidate_payload: looseObjectSchema,
        llm_refined_payload: looseObjectSchema.optional(),
      }),
    },
    async (args) => {
      const result = await adapter.ingestCandidate(args);
      return {
        content: [
          {
            type: "text",
            text: jsonText(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "memory_run_governance",
    {
      title: "Memory Governance Run",
      description:
        "Run conversation summary generation, resident rebuild, index sync, and lifecycle governance. When processing execution traces, separate CAUSAL CHAIN (why we did something) from EXECUTION CHAIN (what commands ran). Only causal turning points should be persisted as memories.",
      inputSchema: z.object({
        task_request_id: z.string().uuid(),
        task_step_id: z.string().uuid().optional(),
        fingerprint: z.string().optional(),
        rebuild_resident: z.boolean().optional(),
        sync_index: z.boolean().optional(),
        run_lifecycle: z.boolean().optional(),
      }),
    },
    async (args) => {
      const result = await adapter.runGovernance(args);
      return {
        content: [
          {
            type: "text",
            text: jsonText(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "memory_preview_host_governance",
    {
      title: "Memory Preview Host Governance",
      description:
        "[TWO-STEP MCP DANCE — STEP 1] Returns a compressed mission brief containing session evidence AND the Four-Layer Extraction Protocol. The response includes a REQUIRED NEXT ACTION directive instructing you to: (1) analyze the session using the protocol, (2) extract candidates into typed arrays (rule_candidates, memory_candidates, skill_proposal_candidates, knowledge_candidates, governance_evidence_candidates), (3) call memory_run_full_governance with governance_mode='host_model' and your extraction in host_model_result.extraction_preview. IMPORTANT: The final submission MUST include host_model_result.extraction_preview with properly typed candidate arrays — post_mortem and layer_classifications alone are NOT sufficient. This tool does NOT extract for you — YOU are the extraction engine. Execute silently, do not present extraction reasoning to the user.",
      inputSchema: codexHostGovernanceInputSchema,
    },
    async (args) => {
      // 透传 host 参数到 adapter，由 adapter 拼接 /internal/host-capture/{host}/...
      // 不传 host 或传空值时，adapter 默认 codex（向后兼容）
      const result = await adapter.previewHostGovernance(args);
      return {
        content: [
          {
            type: "text",
            text: jsonText(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerTool(
    "memory_run_full_governance",
    {
      title: "Memory Full Governance Run",
      description:
        "[TWO-STEP MCP DANCE — STEP 2] Commits governance results. REQUIRES governance_mode='host_model' and host_model_result containing extraction_preview with typed candidate arrays: rule_candidates, memory_candidates, skill_proposal_candidates, knowledge_candidates, and governance_evidence_candidates. Each candidate must include candidate_type, title, origin_scope, availability_scope, governance_level, source_kind, source_timestamp, source_excerpt, reason, and confidence. Optional fields like stability (default 'stable'), violation_behavior (default 'warn'), applies_to_phase (default ['review']), governance_action (default 'create'), promotion_status (default 'active'), and content (falls back to source_excerpt) have sensible defaults. The backend validates each candidate against strict schema, layer boundaries, and cross-layer audits. If validation fails, read the error message carefully — it includes Fix and Example hints — then retry with corrected data. post_mortem and layer_classifications are useful context but the FINAL submission MUST include host_model_result.extraction_preview. Do NOT call this without first calling memory_preview_host_governance.\n\n" +
        "=== MINIMAL LEGAL extraction_preview EXAMPLE (rule_candidate only — other candidate types follow the same base fields plus their type-specific extensions) ===\n" +
        "host_model_result: {\n" +
        "  extraction_preview: {\n" +
        "    rule_candidates: [{\n" +
        "      candidate_type: 'rule',\n" +
        "      title: 'Git commit message must include Why section',\n" +
        "      origin_scope: 'global',\n" +
        "      availability_scope: 'global_reusable',\n" +
        "      governance_level: 'shared',\n" +
        "      source_kind: 'user_message',\n" +
        "      source_timestamp: '2026-07-06T10:30:00Z',\n" +
        "      source_excerpt: 'User said: 从现在起所有 commit 必须说明 why',\n" +
        "      reason: 'User explicitly requested enforced commit message format',\n" +
        "      confidence: 0.9,\n" +
        "      content: 'IF writing git commit message THEN must include Why section explaining the rationale',\n" +
        "      rule_domain: 'git',\n" +
        "      rule_scope: 'commit',\n" +
        "      stability: 'stable',\n" +
        "      violation_behavior: 'warn',\n" +
        "      applies_to_phase: ['review'],\n" +
        "      governance_action: 'create',\n" +
        "      promotion_status: 'active'\n" +
        "    }],\n" +
        "    memory_candidates: [],\n" +
        "    skill_proposal_candidates: [],\n" +
        "    knowledge_candidates: [],\n" +
        "    governance_evidence_candidates: []\n" +
        "  }\n" +
        "}\n" +
        "=== END EXAMPLE ===\n" +
        "Note: source_timestamp must be ISO-8601. confidence is 0.0-1.0. rule_domain/rule_scope are rule-specific; memory_candidates add memory_type; skill_proposal_candidates add target_skill/current_gap/proposed_text/validation_method/rationale (promotion_status forced to 'needs_review'); knowledge_candidates add knowledge_type/synthesis_reasoning; governance_evidence_candidates add evidence_category.",
      inputSchema: codexFullGovernanceInputSchema,
    },
    async (args) => {
      const {
        refresh_memory: refreshMemory,
        rebuild_resident,
        sync_index,
        run_lifecycle,
        ...hostArgs
      } = args;
      const taskRequestId = args.task_request_id ?? randomUUID();
      // 从 args 读取 host，透传给 rule_gate 和 host governance
      // 不传 host 或传空值时，默认 codex（向后兼容）
      const host = args.host ?? "codex";
      const ruleGate = await adapter.checkRuleGate({
        task_request_id: taskRequestId,
        task_type: "governance",
        host,
        operation: "run_full_host_governance",
        evidence: {
          thread_id: args.thread_id ?? null,
          max_items: args.max_items ?? null,
          codex_home_provided:
            typeof args.codex_home === "string" && args.codex_home.length > 0,
          refresh_memory: refreshMemory !== false,
          rebuild_resident: rebuild_resident ?? null,
          sync_index: sync_index ?? null,
          run_lifecycle: run_lifecycle ?? null,
        },
      });
      if (ruleGate.decision === "ask_user" || ruleGate.decision === "block") {
        throw new Error(
          `RULE_GATE_${ruleGate.decision.toUpperCase()}: full host governance was not executed`,
        );
      }

      const hostGovernance = await adapter.runHostGovernance({
        ...hostArgs,
        host,
        task_request_id: taskRequestId,
      });
      const refreshTaskRequestId = readTaskRequestId(
        hostGovernance,
        taskRequestId,
      );
      const memoryRefresh =
        refreshMemory === false || refreshTaskRequestId === undefined
          ? null
          : await adapter.runGovernance({
              task_request_id: refreshTaskRequestId,
              fingerprint: args.fingerprint,
              rebuild_resident,
              sync_index,
              run_lifecycle,
            });
      const result = {
        rule_gate: ruleGate,
        host_governance: hostGovernance,
        memory_refresh: memoryRefresh,
      };

      return {
        content: [
          {
            type: "text",
            text: jsonText(result),
          },
        ],
        structuredContent: result,
      };
    },
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
          .enum([
            "design",
            "execution",
            "debugging",
            "governance",
            "review",
            "ingestion",
            "integration",
            "answer",
          ])
          .optional(),
        host: z.string().optional(),
        project_ref: z.string().optional(),
        operation: z.string().min(1),
        checkpoint_keys: z.array(z.string()).optional(),
        evidence: looseObjectSchema.optional(),
        actor_ref: z.string().optional(),
      }),
    },
    async (args) => {
      const result = await adapter.checkRuleGate(args);
      return {
        content: [
          {
            type: "text",
            text: jsonText(result),
          },
        ],
        structuredContent: result,
      };
    },
  );

  server.registerResource(
    "memory-health",
    "memory://health",
    {
      title: "Memory Health",
      description: "Current health and runtime defaults for Memory System V3.",
    },
    async (uri) => {
      const health = await adapter.getHealth();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: jsonText(health),
          },
        ],
      };
    },
  );

  server.registerResource(
    "memory-defaults",
    "memory://defaults",
    {
      title: "Memory Defaults",
      description:
        "Default tenant, scope, and single-tenant policy for the MCP server.",
    },
    async (uri) => {
      const defaults = adapter.getDefaults();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: jsonText(defaults),
          },
        ],
      };
    },
  );

  return {
    server,
    adapter,
  };
}
