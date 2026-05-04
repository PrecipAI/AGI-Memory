# Memory MCP

When `memory-v3` is enabled under OpenCode `mcp`, use it as an optional long-term memory layer:

- Retrieve before substantial design/coding/debugging/review tasks.
- Pass explicit `fingerprint_status`.
- Use retrieved memories as contextual references, not absolute facts.
- Write back verified reusable outcomes with `memory_ingest_candidate`.
- Do not run governance automatically; run it only on explicit request/checkpoint.
- Continue without blocking if memory is unavailable.
