# Memory MCP usage instructions for agents

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

## When to run governance

- Only when explicitly requested or at a planned checkpoint.
- Do not run governance automatically for every small task; it can be model/token expensive.
