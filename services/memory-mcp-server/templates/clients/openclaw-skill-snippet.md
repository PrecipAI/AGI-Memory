# Memory MCP Skill Snippet

This skill tells OpenClaw-backed agents how to use the `memory-v3` MCP server.

Use memory before substantial work:

1. Check `memory_health`.
2. Retrieve with `memory_retrieve_context`.
3. Use explicit `fingerprint_status`.
4. Treat memory as advisory context unless confirmed by current evidence.

Write memory after verified reusable outcomes:

- design decisions;
- fixes and failure patterns;
- environment constraints;
- reusable workflows;
- stable user/project preferences.

Run governance only on explicit user request or checkpoint.
