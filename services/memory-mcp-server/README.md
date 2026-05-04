# Memory MCP Server Quickstart

## What this package does

`@super-agent/memory-mcp` exposes Memory System V3 through MCP tools and resources.
It does not store memory by itself. It forwards requests to an external `memory-service`
and wraps that service as a stdio MCP server.

Current scope:

- Developer beta, not a one-click end-user install
- Single-tenant validation mode
- External `memory-service` is required
- Retrieval requests must pass an explicit `fingerprint_status`

## Runtime defaults

- `tenant_id = tenant-local`
- `scope = memory.validation`
- `single_tenant_mode = true`
- default `memoryServiceUrl = http://127.0.0.1:3101`

## Prerequisites

- `Node.js >= 20`
- repository dependencies installed
- `memory-service` is running
- Postgres and migrations are ready for the current repo workflow

## Workspace commands

```powershell
npm.cmd run memory-mcp:init
npm.cmd run memory-mcp:doctor
npm.cmd run memory-mcp:start
```

## Tarball install

```powershell
npm pack .\services\memory-mcp-server
mkdir C:\temp\memory-mcp-pack-test
cd C:\temp\memory-mcp-pack-test
npm init -y
npm install C:\path\to\super-agent-memory-mcp-0.1.0.tgz
npx memory-mcp --help
```

The repo already has a packaging gate:

```powershell
npm.cmd run verify:mcp-pack
```

## Initialize local config

```powershell
npx memory-mcp init
```

Or from the repo build:

```powershell
node services/memory-mcp-server/dist/services/memory-mcp-server/src/cli.js init
```

This creates:

```text
.memory-mcp/
├── config.json
├── clients/
│   ├── claude-code-project.mcp.json
│   ├── claude-desktop.json
│   ├── codex-config.toml
│   ├── generic-mcp.json
│   ├── openclaw-mcp.json
│   ├── openclaw-mcp-set.md
│   ├── opencode.jsonc
│   ├── agent-memory-policy.md
│   ├── codex-AGENTS-snippet.md
│   ├── claude-CLAUDE-snippet.md
│   ├── opencode-instructions-snippet.md
│   ├── openclaw-skill-snippet.md
│   └── usage-instructions.md
└── README.md
```

Init behavior:

- first run creates files
- second run skips existing files
- `--force` overwrites managed files

## Start memory-service

```powershell
npm.cmd run start:memory-service
curl http://127.0.0.1:3101/healthz
```

## Start the MCP server

```powershell
npx memory-mcp start --config .memory-mcp/config.json
```

Or from the repo build:

```powershell
node services/memory-mcp-server/dist/services/memory-mcp-server/src/cli.js start --config .memory-mcp/config.json
```

Important stdio rule:

- `stdout` is reserved for the MCP protocol
- logs must go to `stderr`

## Agent host templates

`init` generates host-specific MCP templates in `.memory-mcp/clients`.

### Codex

Codex reads MCP servers from `~/.codex/config.toml`.

Copy the generated TOML snippet:

```text
.memory-mcp/clients/codex-config.toml
```

Then verify from Codex:

```powershell
codex mcp list
```

### Claude Code

Claude Code can use project-scoped `.mcp.json`.

Copy:

```text
.memory-mcp/clients/claude-code-project.mcp.json
```

to the project root as:

```text
.mcp.json
```

Or add the same JSON with:

```powershell
claude mcp add-json memory-v3 '<json from claude-code-project.mcp.json>'
claude mcp list
```

### Claude Desktop

Merge the generated JSON into `claude_desktop_config.json`:

```text
.memory-mcp/clients/claude-desktop.json
```

### OpenCode

OpenCode config uses the `mcp` key, not `mcpServers`.

Merge:

```text
.memory-mcp/clients/opencode.jsonc
```

into `opencode.json` or your global OpenCode config.

### OpenClaw

OpenClaw stores MCP definitions through its MCP registry commands.

Use:

```text
.memory-mcp/clients/openclaw-mcp-set.md
```

or:

```powershell
openclaw mcp set memory-v3 '<json from openclaw-mcp.json>'
openclaw mcp show memory-v3 --json
```

### Generic MCP clients

Use:

```text
.memory-mcp/clients/generic-mcp.json
```

On Windows, the generated templates use:

```json
{
  "mcpServers": {
    "memory-v3": {
      "command": "cmd",
      "args": ["/c", "npx", "memory-mcp", "start", "--config", ".memory-mcp/config.json"]
    }
  }
}
```

On non-Windows systems, the generated templates use:

```json
{
  "mcpServers": {
    "memory-v3": {
      "command": "npx",
      "args": ["memory-mcp", "start", "--config", ".memory-mcp/config.json"]
    }
  }
}
```

Add the usage guidance in `.memory-mcp/clients/usage-instructions.md` to the host's agent rules file if the host does not automatically know when to use memory.

## Host-side memory policy

MCP only makes tools visible. It does not force Codex, Claude Code, OpenCode, or OpenClaw to read memory before work.

To avoid "connected but not used", add the corresponding snippet to the host's instruction system:

- Codex: merge `.memory-mcp/clients/codex-AGENTS-snippet.md` into `AGENTS.md`.
- Claude Code: merge `.memory-mcp/clients/claude-CLAUDE-snippet.md` into `CLAUDE.md` or project instructions.
- OpenCode: reference `.memory-mcp/clients/opencode-instructions-snippet.md` from OpenCode instructions.
- OpenClaw: install or merge `.memory-mcp/clients/openclaw-skill-snippet.md` as an OpenClaw skill.
- Generic hosts: use `.memory-mcp/clients/agent-memory-policy.md`.

The host-side policy must also cover rule gates. For high-risk operations such
as writing host configuration, syncing generated rules/skills, approving
governance changes, or deleting long-term memory/knowledge, call
`rule_gate_check` first. A `block` decision must stop the operation; an
`ask_user` decision must be resolved by the user before continuing.

## Optional host install

`memory-mcp init` always generates templates first. For Codex and Claude Code,
the CLI can also write the first-stage host integration after explicit approval:

```powershell
npx memory-mcp install-host --host codex --dir . --yes
npx memory-mcp install-host --host claude-code --dir . --yes
```

Safety behavior:

- Without `--yes`, the command exits with `NEEDS_APPROVAL` and writes nothing.
- Existing host config and instruction files are backed up before modification.
- Existing unrelated host configuration is preserved.
- Codex writes the MCP server block into `~/.codex/config.toml` by default and
  writes policy into project `AGENTS.md`.
- Claude Code writes MCP config into project `.mcp.json` by default and policy
  into project `CLAUDE.md`.

Use explicit paths when testing or when a host uses non-default locations:

```powershell
npx memory-mcp install-host --host codex --dir . --host-config D:\tmp\codex-config.toml --instructions D:\tmp\AGENTS.md --yes
```

## Verify

```powershell
npm.cmd run verify:mcp-cli
npm.cmd run verify:mcp
npm.cmd run verify:mcp-client-smoke
npm.cmd run verify:mcp-pack
npm.cmd run verify:p1-golden
```

To run the MCP client smoke test against a real backend instead of the fake service,
set `MEMORY_SERVICE_URL` first:

```powershell
$env:MEMORY_SERVICE_URL='http://127.0.0.1:3101'
node .\scripts\verify-memory-mcp-client-smoke.mjs
```

## Troubleshooting

### Config missing

```powershell
npx memory-mcp init
npx memory-mcp doctor --config <path>
```

### memory-service unreachable

```powershell
npm.cmd run start:memory-service
```

Or update `memoryServiceUrl` in `.memory-mcp/config.json`.

### tenant/scope mismatch

Use the current validation defaults:

- `tenant-local`
- `memory.validation`

### retrieval returns `FINGERPRINT_STATUS_REQUIRED`

That is expected contract behavior. `memory_retrieve_context` must receive
an explicit `fingerprint_status`.

### retrieval returns `FINGERPRINT_REQUIRED`

Procedural retrieval requires both:

- `fingerprint`
- `fingerprint_status=matched`

## Current limitations

- developer beta only
- depends on an external `memory-service`
- depends on the repo's Postgres and migration workflow
- fixed single-tenant validation scope
- no npm publish, marketplace distribution, GUI, or cloud deployment yet
