## Memory MCP

Use the `memory-v3` MCP server when available.

At the start of substantial work, retrieve prior context with `memory_retrieve_context`. Use explicit `fingerprint_status`; only trust procedural memories as executable guidance when `fingerprint_status=matched`.

At the end of verified work, write reusable decisions, fixes, constraints, and preferences with `memory_ingest_candidate`. Do not write transient reasoning, secrets, or unverified guesses.

Only run `memory_run_governance` when asked by the user or at a deliberate checkpoint. If memory is unavailable, continue and report degraded mode.
