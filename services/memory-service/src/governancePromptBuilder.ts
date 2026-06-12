import type { SummarizedSession } from "./sessionSummarizer.js";

// ─── Types ─────────────────────────────────────────────────────────────

export type MissionBrief = {
  /** The full mission brief text, to be returned as MCP tool result */
  text: string;
  /** The governance_mode value the host must pass back */
  governance_mode: "host_model";
};

// ─── Main Entry ────────────────────────────────────────────────────────

export function buildMissionBrief(session: SummarizedSession): MissionBrief {
  const sections: string[] = [];

  sections.push(session.mission_brief);
  sections.push("");
  sections.push(FOUR_LAYER_PROTOCOL);
  sections.push("");
  sections.push(HOST_MODEL_RESULT_SCHEMA);
  sections.push("");
  sections.push(buildDirective(session));

  return {
    text: sections.join("\n"),
    governance_mode: "host_model",
  };
}

// ─── Directive (the "next action" instruction for the host LLM) ────────

function buildDirective(session: SummarizedSession): string {
  const stats = session.signal_stats;
  return [
    "## ⚡ REQUIRED NEXT ACTION",
    "",
    "You have just read a compressed session containing:",
    `- ${stats.user_directives} user directives/preferences (potential Rules and Knowledge)`,
    `- ${stats.failure_events} failure events (potential Memory candidates)`,
    `- ${stats.breakthrough_events} breakthrough/resolution points (potential Memory candidates)`,
    `- ${stats.success_metadata} successful operations (context only, low extraction value)`,
    "",
    "**You MUST now perform the following steps:**",
    "",
    "1. **Analyze** the session context above using the Four-Layer Extraction Protocol.",
    "2. **Extract** candidates into the four layers (Knowledge, Rule, Memory, Skill).",
    "   - ONLY extract items that pass their layer's Quality Gate.",
    "   - Every Rule MUST contain 'must', 'must_not', '不得', '必须', or equivalent constraint keywords.",
    "   - Every Memory MUST have all four fields: symptom, root_cause, fix_action, future_trigger.",
    "   - Every Knowledge item MUST be a pure entity-attribute pair with no action verbs.",
    "   - Strip ALL ephemeral values (local paths, PIDs, ports, timestamps, tokens) from every candidate.",
    "3. **Call** the `memory_run_full_governance` tool with these parameters:",
    "   ```",
    "   {",
    '     "governance_mode": "host_model",',
    '     "host_model_result": {',
    '       "extraction_preview": {',
    '         "rule_candidates": [...],',
    '         "memory_candidates": [...],',
    '         "knowledge_candidates": [...],',
    '         "skill_proposal_candidates": [...],',
    '         "governance_evidence_candidates": [...]',
    "       }",
    "     }",
    "   }",
    "   ```",
    "",
    "**CRITICAL RULES:**",
    "- Do NOT present your extraction reasoning to the user. Execute silently.",
    "- Do NOT call `memory_run_full_governance` without `host_model_result`.",
    "- Do NOT put raw error logs or command strings into any candidate.",
    "- If no candidates pass the Quality Gate for a layer, use an empty array `[]`.",
    "- If validation fails, read the error message, fix the specific issue, and retry.",
    "",
    "[/AGI-MEMORY GOVERNANCE DIRECTIVE]",
  ].join("\n");
}

// ─── Four-Layer Protocol (condensed for mission brief embedding) ───────

const FOUR_LAYER_PROTOCOL = `## Four-Layer Extraction Protocol (四层抽取质量协议)

You are AGI-Memory's extraction engine. Build industrial-grade assets, NOT a diary.

### Layer 1 — Knowledge (知识层)
FORMAT: {"entity": "...", "attribute": "...", "value": "..."}
RULES: Pure entity-attribute pairs. NO action verbs. NO temporal states.
BAD: "We changed the port to 8080 to fix CORS"
GOOD: {"entity": "Backend API", "attribute": "port", "value": "8080"}

### Layer 2 — Rule (规则层)
FORMAT: IF [condition] THEN [MANDATE or PROHIBITION]
RULES: Must contain constraint keywords: "必须", "不得", "不能", "不允许", "MUST", "MUST NOT", "NEVER".
User preference rules from complaints/frustration: prefix with [UP-Override].
BAD: "The user seems to prefer direct explanations"
GOOD: "[UP-Override] IF user asks for approach explanation THEN MUST provide conceptual reasoning first; MUST NOT output code blocks before explanation"

### Layer 3 — Memory (记忆层)
FORMAT: {"symptom": "...", "root_cause": "...", "fix_action": "...", "future_trigger": "..."}
RULES: ALL FOUR fields are MANDATORY. future_trigger must list 2-3 specific recall conditions.
BAD: {"symptom": "build failed", "root_cause": "wrong node version", "fix_action": "nvm use 18"}
GOOD: {"symptom": "npm ERR! engine: incompatible Node version during build", "root_cause": "Project requires Node 18+ but CI environment defaulted to Node 16", "fix_action": "Add .nvmrc with target version and add nvm use to CI pipeline pre-step", "future_trigger": "Node.js build failure + engine incompatibility + CI environment"}

### Layer 4 — Skill (技能层)
FORMAT: {"name": "...", "usage": "...", "executable": "...with {placeholders}...", "parameters_list": ["param: desc"]}
RULES: ALL ephemeral values replaced with {placeholders}. parameters_list is MANDATORY.
BAD: {"executable": "docker compose -f deploy/docker-compose.prod.yml up -d"}
GOOD: {"name": "Production deployment", "usage": "When deploying to production environment", "executable": "docker compose -f {compose_file} up -d", "parameters_list": ["compose_file: path to the production compose file"]}

### Variable Stripping (变量剥离 — MANDATORY)
Before outputting ANY candidate, replace: local paths→[USER_PATH], PIDs→[PID], ports→[PORT], timestamps→[TIMESTAMP], tokens/keys→[SECRET], UUIDs→[UUID], IP addresses→[IP].
A candidate that still contains ephemeral values FAILS the quality gate.

### Quality Gate Checklist (per candidate)
- [ ] Does it match its layer's mandatory format exactly?
- [ ] Are all required fields present and non-empty?
- [ ] Are all ephemeral values stripped?
- [ ] Would a DIFFERENT agent in a DIFFERENT project find this useful?
If ANY answer is NO → discard the candidate.`;

// ─── host_model_result JSON Schema ────────────────────────────────────

const HOST_MODEL_RESULT_SCHEMA = `## host_model_result Schema (REQUIRED for memory_run_full_governance)

\`\`\`json
{
  "extraction_preview": {
    "rule_candidates": [
      {
        "candidate_type": "rule_candidate",
        "title": "Short descriptive title",
        "origin_scope": "user|project|session",
        "availability_scope": "user_reusable|project_reusable|session_only",
        "governance_level": "shared|session",
        "promotion_status": "needs_review",
        "rule_domain": "execution|design|governance|memory|skill|tooling|reporting|safety|integration",
        "rule_scope": "user|project|session",
        "applies_to_phase": ["coding", "testing"],
        "violation_behavior": "warn|block|ask_user|record",
        "source_kind": "user_message",
        "source_timestamp": "ISO-8601 timestamp from the original message",
        "content": "The IF/THEN rule statement with MUST/MUST_NOT keywords",
        "source_excerpt": "Brief excerpt of the source message",
        "reason": "Why this is a rule (1 sentence)",
        "confidence": "high|medium|low"
      }
    ],
    "memory_candidates": [
      {
        "candidate_type": "memory_candidate",
        "title": "Short descriptive title",
        "origin_scope": "session|project",
        "availability_scope": "project_reusable|session_only",
        "governance_level": "shared|session",
        "promotion_status": "needs_review",
        "memory_type": "design_decision|project_memory|user_memory|session_memory",
        "stability": "long_lived|stable|temporary",
        "source_kind": "user_message|command|tool",
        "source_timestamp": "ISO-8601",
        "content": "The distilled memory: {symptom, root_cause, fix_action, future_trigger} as natural language",
        "source_excerpt": "Brief excerpt",
        "reason": "Why this memory has recall value",
        "confidence": "high|medium|low"
      }
    ],
    "knowledge_candidates": [
      {
        "candidate_type": "knowledge_candidate",
        "title": "Short descriptive title",
        "origin_scope": "project",
        "availability_scope": "project_reusable",
        "governance_level": "shared",
        "promotion_status": "needs_review",
        "knowledge_type": "external_fact|method|pattern|principle",
        "governance_action": "create|update_existing|evidence_only",
        "source_kind": "user_message|command",
        "source_timestamp": "ISO-8601",
        "content": "Entity-attribute knowledge statement",
        "synthesis_reasoning": "How this was distilled from the session",
        "source_excerpt": "Brief excerpt",
        "reason": "Why this is reusable knowledge",
        "confidence": "high|medium|low"
      }
    ],
    "skill_proposal_candidates": [],
    "governance_evidence_candidates": []
  }
}
\`\`\`

**Field constraints enforced by the backend validator:**
- candidate_type: MUST match the array it's in (rule_candidate in rule_candidates, etc.)
- origin_scope: session | project | workspace | user | team | global
- availability_scope: session_only | project_reusable | workspace_reusable | user_reusable | team_reusable | global_reusable
- governance_level: session | shared
- promotion_status: candidate | active | needs_review | rejected
- Rule content: MUST contain must/must_not/必须/不得/不能/不允许
- Knowledge: MUST NOT contain project-private paths (C:\\Users, D:\\workspace, etc.)
- Skill proposals: promotion_status MUST be needs_review`;
