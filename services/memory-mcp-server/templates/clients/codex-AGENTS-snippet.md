## Memory MCP

If the `memory-v3` MCP server is available, use it as the long-term memory and knowledge layer.

- Before non-trivial coding, design, debugging, integration, or review work, call `memory_health`, then `memory_retrieve_context`.
- Always pass an explicit `fingerprint_status`.
- Use `fingerprint_status=matched` only when this workspace/environment is known to match the stored fingerprint; otherwise use `matched_or_na` or `unknown`.
- Treat retrieved memory as reference context. Current user instructions and current repository evidence take priority.
- After verified design decisions, fixes, reusable workflows, environment constraints, or important preferences, call `memory_ingest_candidate`.
- Run `memory_run_governance` only when the user explicitly asks or at a planned checkpoint.
- If Memory MCP is unavailable, continue in degraded mode and mention that memory was unavailable.
