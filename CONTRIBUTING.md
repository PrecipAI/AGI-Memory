# Contributing

## Scope

This repository is currently maintained as a private team project under `PrecipAI`.
Contributions should preserve the existing architecture, contracts, and verification workflow.

## Development flow

1. Create a focused branch from `main`.
2. Keep changes scoped to the feature or fix you are actually working on.
3. Run the relevant verification commands before opening a pull request.
4. Document any contract, schema, or workflow changes in the corresponding spec or README.

## Local setup

```powershell
npm install
npm run build
```

If your change touches the memory or MCP path, also run:

```powershell
npm run verify:mcp-cli
npm run verify:mcp-client-smoke
npm run verify:mcp
```

If your change touches the broader memory or knowledge platform, run the smallest relevant set first, then expand:

```powershell
npm run verify:memory
npm run verify:knowledge
npm run verify:knowledge-ops-console
```

## Change expectations

- Do not commit local caches, virtual environments, generated temp files, or machine-specific runtime state.
- Keep database migrations forward-only and explicit.
- Treat retrieval contracts and rule-gate behavior as compatibility-sensitive surfaces.
- If a design decision changes system behavior materially, update the corresponding spec under `docs/specs/`.

## Pull requests

Pull requests should describe:

- what changed
- why it changed
- which areas are affected
- what verification was run
- any known limitations or follow-up work
