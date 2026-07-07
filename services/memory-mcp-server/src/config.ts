import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type MemoryMcpConfig = {
  memoryServiceUrl: string;
  transport: "stdio";
  tenantId: string;
  scope: string;
  defaultFingerprintStatus:
    "matched" | "matched_or_na" | "mismatch" | "unknown";
  logLevel: "debug" | "info" | "warn" | "error";
};

export type MemoryMcpConfigKey = keyof MemoryMcpConfig;
export type ConfigSource = "default" | "config" | "env" | "cli";

export type ResolvedMemoryMcpConfig = {
  config: MemoryMcpConfig;
  configPath: string;
  configExists: boolean;
  sources: Record<MemoryMcpConfigKey, ConfigSource>;
};

export type ClientTemplateFile = {
  fileName: string;
  kind: "json" | "text";
  payload: unknown;
};

export type ResolveMemoryMcpConfigOptions = {
  cwd: string;
  configPathInput?: string;
  env?: NodeJS.ProcessEnv;
  cliOverrides?: Partial<MemoryMcpConfig>;
};

const ENV_KEY_BY_CONFIG_KEY: Record<MemoryMcpConfigKey, string> = {
  memoryServiceUrl: "MEMORY_SERVICE_URL",
  transport: "MEMORY_MCP_TRANSPORT",
  tenantId: "MEMORY_MCP_TENANT_ID",
  scope: "MEMORY_MCP_SCOPE",
  defaultFingerprintStatus: "MEMORY_MCP_DEFAULT_FINGERPRINT_STATUS",
  logLevel: "MEMORY_MCP_LOG_LEVEL",
};

export const DEFAULT_CONFIG_DIRNAME = ".memory-mcp";
export const DEFAULT_CONFIG_FILENAME = "config.json";

export const defaultMemoryMcpConfig: MemoryMcpConfig = {
  memoryServiceUrl: "http://127.0.0.1:3101",
  transport: "stdio",
  tenantId: "tenant-local",
  scope: "memory.validation",
  defaultFingerprintStatus: "unknown",
  logLevel: "info",
};

export function resolveConfigPath(cwd: string, inputPath?: string): string {
  if (inputPath) {
    return path.isAbsolute(inputPath)
      ? inputPath
      : path.resolve(cwd, inputPath);
  }
  return path.resolve(cwd, DEFAULT_CONFIG_DIRNAME, DEFAULT_CONFIG_FILENAME);
}

export async function readMemoryMcpConfig(
  configPath: string,
): Promise<MemoryMcpConfig> {
  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<MemoryMcpConfig>;
  const merged: MemoryMcpConfig = { ...defaultMemoryMcpConfig };

  for (const key of Object.keys(parsed) as MemoryMcpConfigKey[]) {
    const value = parsed[key];
    if (value !== undefined) {
      assignConfigValue(merged, key, value);
    }
  }

  return merged;
}

export async function resolveMemoryMcpConfig(
  options: ResolveMemoryMcpConfigOptions,
): Promise<ResolvedMemoryMcpConfig> {
  const configPath = resolveConfigPath(options.cwd, options.configPathInput);
  const env = options.env ?? process.env;
  const cliOverrides = options.cliOverrides ?? {};
  const configExists = await pathExists(configPath);
  const configFileValues = configExists
    ? ((JSON.parse(
        await readFile(configPath, "utf8"),
      ) as Partial<MemoryMcpConfig>) ?? {})
    : {};
  const envOverrides = buildEnvOverrides(env);
  const merged: MemoryMcpConfig = { ...defaultMemoryMcpConfig };
  const sources = buildDefaultSources();

  for (const key of Object.keys(configFileValues) as MemoryMcpConfigKey[]) {
    const value = configFileValues[key];
    if (value !== undefined) {
      assignConfigValue(merged, key, value);
      sources[key] = "config";
    }
  }

  for (const key of Object.keys(envOverrides) as MemoryMcpConfigKey[]) {
    const value = envOverrides[key];
    if (value !== undefined) {
      assignConfigValue(merged, key, value);
      sources[key] = "env";
    }
  }

  for (const key of Object.keys(cliOverrides) as MemoryMcpConfigKey[]) {
    const value = cliOverrides[key];
    if (value !== undefined) {
      assignConfigValue(merged, key, value);
      sources[key] = "cli";
    }
  }

  return {
    config: merged,
    configPath,
    configExists,
    sources,
  };
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function writeJsonFile(
  filePath: string,
  payload: unknown,
): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function writeTextFile(
  filePath: string,
  payload: string,
): Promise<void> {
  await writeFile(filePath, payload, "utf8");
}

export function buildMcpStdioCommand(configPath: string): {
  command: string;
  args: string[];
  commandArray: string[];
} {
  const normalizedConfigPath = configPath.replace(/\\/g, "/");
  const shellCommand = process.platform === "win32" ? "cmd" : "npx";
  const shellArgs =
    process.platform === "win32"
      ? ["/c", "npx", "memory-mcp", "start", "--config", normalizedConfigPath]
      : ["memory-mcp", "start", "--config", normalizedConfigPath];

  return {
    command: shellCommand,
    args: shellArgs,
    commandArray: [shellCommand, ...shellArgs],
  };
}

export function buildClientTemplates(configPath: string) {
  const shell = buildMcpStdioCommand(configPath);

  return {
    "generic-mcp.json": {
      mcpServers: {
        "memory-v3": {
          command: shell.command,
          args: shell.args,
        },
      },
    },
    "claude-code-project.mcp.json": {
      mcpServers: {
        "memory-v3": {
          command: shell.command,
          args: shell.args,
        },
      },
    },
    "claude-desktop.json": {
      mcpServers: {
        "memory-v3": {
          command: shell.command,
          args: shell.args,
        },
      },
    },
    "trae-mcp.json": {
      mcpServers: {
        "memory-v3": {
          command: shell.command,
          args: shell.args,
        },
      },
    },
  };
}

export function buildClientTemplateFiles(
  configPath: string,
): ClientTemplateFile[] {
  const shell = buildMcpStdioCommand(configPath);
  const jsonTemplates = buildClientTemplates(configPath);
  const openclawConfig = {
    command: shell.command,
    args: shell.args,
  };

  return [
    ...Object.entries(jsonTemplates).map(([fileName, payload]) => ({
      fileName,
      kind: "json" as const,
      payload,
    })),
    {
      fileName: "codex-config.toml",
      kind: "text",
      payload: [
        "[mcp_servers.memory-v3]",
        `command = ${JSON.stringify(shell.command)}`,
        `args = ${toTomlStringArray(shell.args)}`,
        "enabled = true",
        "",
      ].join("\n"),
    },
    {
      fileName: "opencode.jsonc",
      kind: "json",
      payload: {
        $schema: "https://opencode.ai/config.json",
        mcp: {
          "memory-v3": {
            type: "local",
            command: shell.commandArray,
            enabled: true,
          },
        },
      },
    },
    {
      fileName: "openclaw-mcp.json",
      kind: "json",
      payload: openclawConfig,
    },
    {
      fileName: "openclaw-mcp-set.md",
      kind: "text",
      payload: [
        "# OpenClaw MCP install",
        "",
        "Run this command from a shell where `openclaw` is available:",
        "",
        "```powershell",
        `openclaw mcp set memory-v3 '${JSON.stringify(openclawConfig).replace(/'/g, "''")}'`,
        "openclaw mcp show memory-v3 --json",
        "```",
        "",
        "This only writes OpenClaw MCP registry config. It does not validate the server; run `memory-mcp doctor` first.",
      ].join("\n"),
    },
    {
      fileName: "usage-instructions.md",
      kind: "text",
      payload: buildUsageInstructions(),
    },
    {
      fileName: "agent-memory-policy.md",
      kind: "text",
      payload: buildAgentMemoryPolicy(),
    },
    {
      fileName: "codex-AGENTS-snippet.md",
      kind: "text",
      payload: buildCodexAgentsSnippet(),
    },
    {
      fileName: "claude-CLAUDE-snippet.md",
      kind: "text",
      payload: buildClaudeSnippet(),
    },
    {
      fileName: "opencode-instructions-snippet.md",
      kind: "text",
      payload: buildOpenCodeInstructionsSnippet(),
    },
    {
      fileName: "openclaw-skill-snippet.md",
      kind: "text",
      payload: buildOpenClawSkillSnippet(),
    },
  ];
}

export function buildInitReadme(configPath: string): string {
  return `# Memory MCP Local Config

## What this folder contains

- \`config.json\`: local MCP beta config
- \`clients/\`: MCP client config templates

## Quick commands

\`\`\`powershell
npx memory-mcp doctor --config ${configPath}
npx memory-mcp start --config ${configPath}
\`\`\`

## Notes

- This is a developer beta, not a one-click product install.
- The MCP adapter still depends on an external \`memory-service\`.
- Retrieval requests must pass an explicit \`fingerprint_status\`.
`;
}

function toTomlStringArray(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function buildUsageInstructions(): string {
  return `# Memory MCP usage instructions for agents

Use the Memory MCP server as an optional long-term memory and knowledge layer.

## When to retrieve

- Before designing or implementing non-trivial code.
- Before answering questions about this project, previous decisions, known failures, rules, skills, or long-term knowledge.
- Before repeating a workflow that may already have a stored skill or memory.

## When to ingest

- After a verified design decision.
- After a verified fix or failure pattern.
- After discovering a stable environment constraint.
- After producing a reusable workflow or skill candidate.

### Post-Mortem Protocol (Before Ingesting or Running Governance)

You are NOT recording a log. You are writing a survival guide for a future agent.

Extract only:
1. **Pitfall Warnings**: What dead-end was hit and WHY it failed.
2. **Breakthrough Actions**: The decisive command/code change that solved it.
3. **Environment Constraints**: Preconditions for this solution to hold.

**Variable Stripping**: Replace PIDs, temp paths, timestamps, and one-time tokens with logical placeholders. Only generalizable knowledge survives.

**Causality Over Execution**: Separate WHY from WHAT. Dense command sequences are noise.

### Four-Layer Extraction Quality Protocol

Before persisting, classify each candidate and enforce its layer format:
- **Knowledge**: Entity-Attribute pairs only. No action verbs or temporal states.
- **Rule**: IF/THEN mandates. \`[UP-Override]\` prefix for user preferences. No fuzzy language.
- **Memory**: \`{symptom, root_cause, fix_action, future_trigger}\`. No raw logs.
- **Skill**: Parameterized with \`{placeholders}\` and \`parameters_list\`. No hardcoded ephemeral values.

Reject any candidate that fails its layer's quality gate.

## When to run governance

- Only when explicitly requested or at a planned checkpoint.
- Always populate the \`post_mortem\` field with structured analysis.
- Do not run governance automatically for every small task.

## Contract

- Always pass explicit \`fingerprint_status\`.
- Use \`fingerprint_status=matched\` when procedural memory/skills are expected.
- If Memory MCP is unavailable, continue the task and report the degraded mode.
`;
}

export function buildAgentMemoryPolicy(): string {
  return `# Agent memory policy

MCP connection only makes tools visible. It does not force the host agent to read or use memory.

To actually use the existing memory system, the host must follow this policy.

## Task start

Before non-trivial design, coding, debugging, review, integration, or documentation work:

1. Call \`memory_health\`.
2. If healthy, call \`memory_retrieve_context\` with:
   - \`query\`: current task goal and important constraints.
   - \`fingerprint_status\`: explicit value.
   - \`fingerprint_status=matched\` only when the current project/environment fingerprint is known to match.
3. Use returned memory as reference context, not as unquestioned truth.

## Context usage

- Prefer current user instructions over memory.
- Prefer current repository/source evidence over memory.
- Use factual memory for stable project decisions and constraints.
- Use procedural memory only when \`fingerprint_status=matched\`.
- Use returned \`Execution Rules\` and \`rule_checklist\` as mandatory execution constraints, not advisory memory.
- If memory conflicts with current evidence, continue with current evidence and optionally write a corrected candidate after verification.

## Rule gate checks

Before high-risk operations, call \`rule_gate_check\` with \`task_request_id\`, \`task_type\`, \`host\`, \`operation\`, and evidence.

High-risk operations include:

- writing host/client configuration;
- synchronizing generated rules or skills into host files;
- activating rule/skill/governance changes;
- deleting memory, knowledge, rules, or skills;
- approving governance changes.

If \`rule_gate_check\` returns \`block\`, do not continue the operation. If it returns \`ask_user\`, ask the user before continuing. If it returns \`warn\`, continue only after reporting the warning.

## Task completion — Post-Mortem Protocol

After verified outcomes, before calling \`memory_ingest_candidate\` or triggering governance, switch perspective:

**You are writing a survival guide for a future agent facing this exact problem.**

Do NOT record a play-by-play log. Instead, extract only three categories:

1. **Pitfall Warnings (防坑警示)**: What dead-end was hit? Why did that approach fail? Focus on the REASON, not the error output. Omit failures with no reusable insight.
2. **Breakthrough Actions (制胜关键)**: What was the single decisive action or code change that broke the deadlock? Include the critical command or code snippet.
3. **Environment Constraints (环境约束)**: Under what preconditions does this solution hold? (OS, dependency versions, database state, etc.)

### Variable Stripping Rule (变量剥离)

Before packaging any memory payload, abstract away ALL ephemeral values:
- Replace specific PIDs, port numbers, temp file paths, timestamps, and one-time tokens with logical placeholders.
- BAD: "Kill process 14532 on port 8080"
- GOOD: "Kill the process occupying the required port"
- BAD: "pip install requests==2.31.0 fixed ModuleNotFoundError in /tmp/script_v3.py"
- GOOD: "When a Python script fails with ModuleNotFoundError for a known library, pin the dependency version to avoid pulling incompatible latest"

Only memories that survive variable stripping have generalizable recall value.

### Causality Over Execution (因果优先于执行)

When analyzing execution traces, separate the CAUSAL CHAIN (why we did something) from the EXECUTION CHAIN (what commands we ran). Dense command sequences (ls, cat, npm run, git status) are execution noise. Extract only the causal turning points.

After applying the Post-Mortem Protocol, call \`memory_ingest_candidate\` with the distilled, abstracted, causally-structured payload.

Do not ingest transient logs, unverified guesses, credentials, or private noise.

### Four-Layer Extraction Quality Protocol (四层抽取质量协议)

Before persisting ANY candidate, classify it into one of four layers and enforce its mandatory format:

**Knowledge (知识层)** — Objective, stateless workspace properties.
- Format: Entity-Attribute key-value pairs: \`{"entity": "...", "attribute": "...", "value": "..."}\`
- FORBIDDEN: Action verbs ("we installed..."), temporal states ("currently failing...").
- Quality gate: Is it absolutely objective with all action verbs removed?

**Rule (规则层)** — Enforceable, binary behavioral mandates.
- Format: IF [trigger condition] THEN [mandatory requirement OR absolute prohibition].
- User preferences from complaints/frustration MUST be prefixed with \`[UP-Override]\` for highest recall priority (L1).
- FORBIDDEN: Fuzzy qualifiers ("try to", "preferably", "it would be nice").
- Quality gate: Is it binary and strong enough to be the sole behavioral guide?

**Memory (记忆层)** — Validated crisis-resolution chains.
- Format: \`{"symptom": "...", "root_cause": "...", "fix_action": "...", "future_trigger": "..."}\`
- FORBIDDEN: Raw error logs, unverified guesses, trial-and-error sequences.
- Quality gate: Does it have a clear trigger for future recall?

**Skill (技能层)** — Generalized, parameterized tools.
- Format: \`{"name": "...", "usage": "...", "executable": "...with {placeholders}", "parameters_list": ["param: description"]}\`
- FORBIDDEN: Any hardcoded ephemeral values (test usernames, temp paths, specific timestamps).
- Quality gate: Have ALL hardcoded values been replaced with parameter placeholders?

If ANY candidate fails its layer's quality gate, either re-refine it or discard it.

## Governance

Run \`memory_run_full_governance\` or \`memory_run_governance\` only when explicitly requested or at planned checkpoints. When running governance, always populate the \`post_mortem\` field with the structured analysis (task_context, failed_attempts_analysis, core_resolution, future_trigger). Governance can be model/token expensive and should not run after every small task.

## Fallback

If Memory MCP is unavailable, continue the task and report that memory was unavailable. Do not block the user just because memory cannot be read.
`;
}

export function buildCodexAgentsSnippet(): string {
  return `## Memory MCP

If the \`memory-v3\` MCP server is available, use it as the long-term memory and knowledge layer.

- Before non-trivial coding, design, debugging, integration, or review work, call \`memory_health\`, then \`memory_retrieve_context\`.
- Always pass an explicit \`fingerprint_status\`.
- Use \`fingerprint_status=matched\` only when this workspace/environment is known to match the stored fingerprint; otherwise use \`matched_or_na\` or \`unknown\`.
- Treat retrieved memory as reference context. Current user instructions and current repository evidence take priority.
- Treat retrieved \`Execution Rules\` and \`rule_checklist\` as mandatory constraints.
- Before high-risk operations such as writing host config, syncing rules/skills, approving governance changes, or deleting memory/knowledge, call \`rule_gate_check\` with evidence. Do not proceed on \`block\`; ask the user on \`ask_user\`.
- After verified design decisions, fixes, reusable workflows, environment constraints, or important preferences, call \`memory_ingest_candidate\`.
- Run \`memory_run_governance\` only when the user explicitly asks or at a planned checkpoint.
- If Memory MCP is unavailable, continue in degraded mode and mention that memory was unavailable.

### Post-Mortem Protocol (Governance & Ingestion)

When writing memories or running governance, you are NOT recording a log — you are writing a survival guide for a future agent. Extract only:

1. **Pitfall Warnings**: What dead-end was hit and WHY it failed (not the error output).
2. **Breakthrough Actions**: The decisive command/code change that solved it.
3. **Environment Constraints**: Preconditions required for this solution to hold.

**Variable Stripping**: Replace all PIDs, temp paths, timestamps, and one-time tokens with logical placeholders before persisting. Only generalizable knowledge survives.

**Causality Over Execution**: Separate WHY from WHAT. Dense command sequences are noise. Extract only causal turning points.

When calling \`memory_run_full_governance\`, always populate the \`post_mortem\` field with structured analysis.

### Four-Layer Extraction Quality Protocol

Classify each candidate before persisting:
- **Knowledge**: Entity-Attribute pairs only. No action verbs or temporal states.
- **Rule**: IF/THEN mandates. Prefix user preferences with \`[UP-Override]\`. No fuzzy language.
- **Memory**: \`{symptom, root_cause, fix_action, future_trigger}\`. No raw logs.
- **Skill**: Parameterized with \`{placeholders}\` and \`parameters_list\`. No hardcoded ephemeral values.

Reject any candidate that fails its layer's quality gate.
`;
}

export function buildClaudeSnippet(): string {
  return `## Memory MCP

Use the \`memory-v3\` MCP server when available.

At the start of substantial work, retrieve prior context with \`memory_retrieve_context\`. Use explicit \`fingerprint_status\`; only trust procedural memories as executable guidance when \`fingerprint_status=matched\`.

Treat returned \`Execution Rules\` and \`rule_checklist\` as mandatory. Before writing host configuration, syncing rules/skills, approving governance changes, or deleting long-term memory/knowledge, call \`rule_gate_check\` with evidence. Do not proceed on \`block\`; ask the user on \`ask_user\`.

At the end of verified work, write reusable decisions, fixes, constraints, and preferences with \`memory_ingest_candidate\`. Do not write transient reasoning, secrets, or unverified guesses.

Only run \`memory_run_governance\` when asked by the user or at a deliberate checkpoint. If memory is unavailable, continue and report degraded mode.

### Post-Mortem Protocol

When writing memories or running governance, write a survival guide for a future agent — NOT a log. Extract: Pitfall Warnings (why an approach failed), Breakthrough Actions (the decisive fix), and Environment Constraints (preconditions). Strip all ephemeral variables (PIDs, temp paths, timestamps) into logical placeholders. Prioritize causality over execution steps. Populate the \`post_mortem\` field in governance calls with structured analysis.

### Four-Layer Extraction Quality Protocol

Classify each candidate before persisting:
- **Knowledge**: Entity-Attribute pairs only. No action verbs.
- **Rule**: IF/THEN mandates. \`[UP-Override]\` for user preferences. No fuzzy language.
- **Memory**: \`{symptom, root_cause, fix_action, future_trigger}\`. No raw logs.
- **Skill**: Parameterized with \`{placeholders}\` and \`parameters_list\`. No hardcoded values.

Reject any candidate that fails its layer's quality gate.
`;
}

export function buildTraeSnippet(): string {
  return `## Memory MCP

Use the \`memory-v3\` MCP server when available in TRAE.

At the start of substantial work, retrieve prior context with \`memory_retrieve_context\`. Use explicit \`fingerprint_status\`; only trust procedural memories as executable guidance when \`fingerprint_status=matched\`.

Treat returned \`Execution Rules\` and \`rule_checklist\` as mandatory. Before writing host configuration, syncing rules/skills, approving governance changes, or deleting long-term memory/knowledge, call \`rule_gate_check\` with evidence. Do not proceed on \`block\`; ask the user on \`ask_user\`.

At the end of verified work, write reusable decisions, fixes, constraints, and preferences with \`memory_ingest_candidate\`. Do not write transient reasoning, secrets, or unverified guesses.

Only run \`memory_run_governance\` when asked by the user or at a deliberate checkpoint. If memory is unavailable, continue and report degraded mode.

### Trae Hooks

Trae hooks (\`.trae/hooks.json\`) are managed by GateMaster. Do not manually edit hook files — they are auto-generated from approved Rules. Hooks use \`.mjs\` ESM format and share \`_lib.mjs\` for BOM stripping, JSON parsing, and output formatting.

### Post-Mortem Protocol

When writing memories or running governance, write a survival guide for a future agent — NOT a log. Extract: Pitfall Warnings (why an approach failed), Breakthrough Actions (the decisive fix), and Environment Constraints (preconditions). Strip all ephemeral variables. Prioritize causality over execution steps.

### Four-Layer Extraction Quality Protocol

Classify each candidate before persisting:
- **Knowledge**: Entity-Attribute pairs only. No action verbs.
- **Rule**: IF/THEN mandates. \`[UP-Override]\` for user preferences. No fuzzy language.
- **Memory**: \`{symptom, root_cause, fix_action, future_trigger}\`. No raw logs.
- **Skill**: Parameterized with \`{placeholders}\` and \`parameters_list\`. No hardcoded values.

Reject any candidate that fails its layer's quality gate.
`;
}

function buildOpenCodeInstructionsSnippet(): string {
  return `# Memory MCP

When \`memory-v3\` is enabled under OpenCode \`mcp\`, use it as an optional long-term memory layer:

- Retrieve before substantial design/coding/debugging/review tasks.
- Pass explicit \`fingerprint_status\`.
- Use retrieved memories as contextual references, not absolute facts.
- Treat retrieved \`Execution Rules\` and \`rule_checklist\` as mandatory constraints.
- Call \`rule_gate_check\` before high-risk operations; never continue on \`block\`.
- Write back verified reusable outcomes with \`memory_ingest_candidate\`.
- Do not run governance automatically; run it only on explicit request/checkpoint.
- Continue without blocking if memory is unavailable.

## Post-Mortem Protocol

When writing memories or running governance, write a survival guide for a future agent — NOT a log. Extract: Pitfall Warnings (why an approach failed), Breakthrough Actions (the decisive fix), and Environment Constraints (preconditions). Strip all ephemeral variables into logical placeholders. Prioritize causality over execution steps. Populate the \`post_mortem\` field in governance calls.

### Four-Layer Extraction Quality Protocol

- **Knowledge**: Entity-Attribute pairs. No action verbs.
- **Rule**: IF/THEN mandates. \`[UP-Override]\` for user preferences.
- **Memory**: \`{symptom, root_cause, fix_action, future_trigger}\`.
- **Skill**: Parameterized with \`{placeholders}\` and \`parameters_list\`.
Reject candidates that fail their layer's quality gate.
`;
}

function buildOpenClawSkillSnippet(): string {
  return `# Memory MCP Skill Snippet

This skill tells OpenClaw-backed agents how to use the \`memory-v3\` MCP server.

Use memory before substantial work:

1. Check \`memory_health\`.
2. Retrieve with \`memory_retrieve_context\`.
3. Use explicit \`fingerprint_status\`.
4. Treat memory as advisory context unless confirmed by current evidence.
5. Treat \`Execution Rules\` and \`rule_checklist\` as mandatory constraints.
6. Call \`rule_gate_check\` before high-risk operations such as writing config, syncing rules/skills, deleting long-term data, or approving governance changes.

Write memory after verified reusable outcomes:

- design decisions;
- fixes and failure patterns;
- environment constraints;
- reusable workflows;
- stable user/project preferences.

Run governance only on explicit user request or checkpoint.

## Post-Mortem Protocol

When writing memories or running governance, write a survival guide for a future agent — NOT a log. Extract: Pitfall Warnings (why an approach failed), Breakthrough Actions (the decisive fix), and Environment Constraints (preconditions). Strip all ephemeral variables into logical placeholders. Prioritize causality over execution steps. Populate the \`post_mortem\` field in governance calls.

### Four-Layer Extraction Quality Protocol

- **Knowledge**: Entity-Attribute pairs. No action verbs.
- **Rule**: IF/THEN mandates. \`[UP-Override]\` for user preferences.
- **Memory**: \`{symptom, root_cause, fix_action, future_trigger}\`.
- **Skill**: Parameterized with \`{placeholders}\` and \`parameters_list\`.
Reject candidates that fail their layer's quality gate.
`;
}

function buildDefaultSources(): Record<MemoryMcpConfigKey, ConfigSource> {
  return {
    memoryServiceUrl: "default",
    transport: "default",
    tenantId: "default",
    scope: "default",
    defaultFingerprintStatus: "default",
    logLevel: "default",
  };
}

function buildEnvOverrides(env: NodeJS.ProcessEnv): Partial<MemoryMcpConfig> {
  const overrides: Partial<MemoryMcpConfig> = {};

  for (const [configKey, envKey] of Object.entries(
    ENV_KEY_BY_CONFIG_KEY,
  ) as Array<[MemoryMcpConfigKey, string]>) {
    const value = env[envKey];
    if (typeof value === "string" && value.length > 0) {
      assignPartialConfigValue(
        overrides,
        configKey,
        value as MemoryMcpConfig[MemoryMcpConfigKey],
      );
    }
  }

  return overrides;
}

function assignConfigValue(
  target: MemoryMcpConfig,
  key: MemoryMcpConfigKey,
  value: MemoryMcpConfig[MemoryMcpConfigKey],
) {
  switch (key) {
    case "memoryServiceUrl":
      target.memoryServiceUrl = value as MemoryMcpConfig["memoryServiceUrl"];
      return;
    case "transport":
      target.transport = value as MemoryMcpConfig["transport"];
      return;
    case "tenantId":
      target.tenantId = value as MemoryMcpConfig["tenantId"];
      return;
    case "scope":
      target.scope = value as MemoryMcpConfig["scope"];
      return;
    case "defaultFingerprintStatus":
      target.defaultFingerprintStatus =
        value as MemoryMcpConfig["defaultFingerprintStatus"];
      return;
    case "logLevel":
      target.logLevel = value as MemoryMcpConfig["logLevel"];
      return;
  }
}

function assignPartialConfigValue(
  target: Partial<MemoryMcpConfig>,
  key: MemoryMcpConfigKey,
  value: MemoryMcpConfig[MemoryMcpConfigKey],
) {
  switch (key) {
    case "memoryServiceUrl":
      target.memoryServiceUrl = value as MemoryMcpConfig["memoryServiceUrl"];
      return;
    case "transport":
      target.transport = value as MemoryMcpConfig["transport"];
      return;
    case "tenantId":
      target.tenantId = value as MemoryMcpConfig["tenantId"];
      return;
    case "scope":
      target.scope = value as MemoryMcpConfig["scope"];
      return;
    case "defaultFingerprintStatus":
      target.defaultFingerprintStatus =
        value as MemoryMcpConfig["defaultFingerprintStatus"];
      return;
    case "logLevel":
      target.logLevel = value as MemoryMcpConfig["logLevel"];
      return;
  }
}
