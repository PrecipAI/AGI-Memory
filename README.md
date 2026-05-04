# Agent Memory Knowledge Platform

Unified long-term memory and knowledge platform for AI agents, with MCP access, memory governance, rule gating, and graph-oriented knowledge evolution.

[![Repository Gates](https://github.com/PrecipAI/agent-memory-knowledge-platform/actions/workflows/repository-gates.yml/badge.svg)](https://github.com/PrecipAI/agent-memory-knowledge-platform/actions/workflows/repository-gates.yml)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20-43853d)](#getting-started)
[![MCP](https://img.shields.io/badge/protocol-MCP-111111)](services/memory-mcp-server/README.md)
[![Status](https://img.shields.io/badge/status-engineering_stage-orange)](#current-status)

## Highlights

- Unified long-term memory, knowledge, rule, and skill platform
- MCP integration for agent hosts such as Codex and Claude Code
- Governance-oriented knowledge evolution instead of append-only storage
- Rule-gated high-risk operations with auditability
- Markdown-first ingestion and graph-first knowledge synthesis

## Why this project

Most agent memory systems stop at one of three incomplete states:

- chat history storage
- vector-only retrieval
- isolated knowledge/document ingestion

This project combines them into one engineering system:

- long-term memory for agents
- governed knowledge ingestion and evolution
- host-agnostic MCP access for Codex, Claude Code, OpenCode, OpenClaw, and custom agents
- rule-aware context assembly before execution
- graph-first governance for cross-source knowledge linking and consolidation

The goal is not to build a larger document pile. The goal is to build a system that becomes cleaner, more reusable, and more reliable as knowledge accumulates.

## What it includes

- `memory-service`: the main backend for memory, rule, skill, governance, and retrieval contracts
- `memory-mcp-server`: the MCP adapter that exposes the system to agent hosts over stdio
- `knowledge-ops-console`: the review and inspection UI for ingested knowledge and governance output
- `embedding-service`: vector backend integration entrypoint
- `db` and `libs/*`: contracts, repositories, migrations, and shared system modules
- `tests` and `scripts`: verification, smoke tests, evaluation scripts, and dataset tooling

## Core capabilities

- Long-term memory with factual, procedural, resident, and rule-oriented layers
- MCP tool surface for `memory_health`, `memory_retrieve_context`, `memory_ingest_candidate`, `memory_query_layer`, `memory_run_governance`, and `rule_gate_check`
- Explicit `fingerprint_status` contract for safe procedural retrieval
- Host integration templates and install flow for Codex and Claude Code
- Rule-gated high-risk operations with audit records
- Markdown-first knowledge ingestion
- Governance-oriented knowledge evolution instead of append-only storage
- Cross-source relation discovery and synthesized knowledge generation
- Knowledge Ops Console for inspection and debugging

## Architecture

At a high level, the system is split into four planes:

1. Ingestion plane
   External knowledge, task outputs, rules, and reusable skills enter through constrained write paths.
2. Governance plane
   The system deduplicates, aligns, upgrades, rejects, or synthesizes knowledge instead of blindly accumulating artifacts.
3. Retrieval and assembly plane
   Context is assembled by layer, with rule constraints and memory contracts applied before work execution.
4. Host integration plane
   MCP adapters expose the platform to agent hosts without coupling the core system to any one client runtime.

## Repository layout

```text
.
├── db/                          # schema and migrations
├── docs/                        # specs and design documents
├── libs/                        # shared contracts and repositories
├── scripts/                     # verification, packaging, evaluation, and tooling
├── services/
│   ├── memory-service/          # backend API and governance core
│   ├── memory-mcp-server/       # MCP server and host install flow
│   ├── knowledge-ops-console/   # inspection UI
│   └── embedding-service/       # vector backend integration entrypoint
├── tests/                       # integration and benchmark coverage
└── SPEC-SuperAgentSystem-knowledge-platform.md
```

## Getting started

### Prerequisites

- Node.js `>= 20`
- PostgreSQL available for the repo workflow
- npm dependencies installed

### Install

```powershell
npm install
```

### Build

```powershell
npm run build
```

### Start the main services

```powershell
npm run start:memory-service
npm run start:memory-mcp
npm run start:knowledge-ops-console
```

## MCP quickstart

Initialize local MCP config:

```powershell
npm run memory-mcp:init
```

Run health checks:

```powershell
npm run memory-mcp:doctor
```

Start the MCP server:

```powershell
npm run memory-mcp:start
```

The generated `.memory-mcp/clients` directory contains host-specific config templates for:

- Codex
- Claude Code
- Claude Desktop
- OpenCode
- OpenClaw
- generic MCP clients

For package-level details, see [services/memory-mcp-server/README.md](services/memory-mcp-server/README.md).

## Verification

The repo includes end-to-end MCP and knowledge-platform verification scripts.

```powershell
npm run verify:mcp-cli
npm run verify:mcp-client-smoke
npm run verify:mcp
```

Additional verification coverage:

- `npm run verify:memory`
- `npm run verify:knowledge`
- `npm run verify:knowledge-ops-console`
- `npm run verify:mcp-pack`
- `npm run verify:governance-complete`

## Current status

This repository is an engineering-stage platform, not a consumer-ready product.

Current characteristics:

- MCP integration for agent hosts is working
- single-tenant validation mode is the current operational baseline
- external `memory-service` dependency remains required
- governance and graph-oriented knowledge evolution are active design priorities
- host hot-plug integration exists, but broader host packaging/distribution is still evolving

## Design principles

- Product-unified, engineering-layered memory and knowledge system
- Graph-first governance instead of document-first accumulation
- Markdown as the standard canonical knowledge source
- Retrieval contracts must be explicit, not implied
- High-risk changes must pass rule gates
- Governance must improve knowledge quality, not just knowledge volume

## Documentation

- Master spec: [SPEC-SuperAgentSystem-knowledge-platform.md](SPEC-SuperAgentSystem-knowledge-platform.md)
- Knowledge platform specs: [docs/specs/knowledge-platform](docs/specs/knowledge-platform)
- Launch and contract freeze docs: [docs/specs/launch-v1](docs/specs/launch-v1)
- MCP package quickstart: [services/memory-mcp-server/README.md](services/memory-mcp-server/README.md)

## Roadmap

- Strengthen graph-based governance and cross-source relation synthesis
- Expand evaluation coverage for multihop retrieval and structured navigation
- Improve host integration packaging for more agent runtimes
- Replace temporary/vector baselines with production-grade retrieval backends where needed
- Continue separating stable long-term knowledge from intermediate governance artifacts

## License

This repository is currently distributed under a private internal-use license. See [LICENSE](LICENSE).
