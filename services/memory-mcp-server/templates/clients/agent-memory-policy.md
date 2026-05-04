# Agent memory policy

MCP connection only makes tools visible. It does not force the host agent to read or use memory.

To actually use the existing memory system, the host must follow this policy.

## Task start

Before non-trivial design, coding, debugging, review, integration, or documentation work:

1. Call `memory_health`.
2. If healthy, call `memory_retrieve_context` with explicit `fingerprint_status`.
3. Use returned memory as reference context, not as unquestioned truth.

## Task completion

After verified outcomes, call `memory_ingest_candidate` for stable design decisions, verified fixes, recurring failure modes, reusable workflows, environment constraints, and important preferences.

## Governance

Run `memory_run_governance` only when explicitly requested or at planned checkpoints.
