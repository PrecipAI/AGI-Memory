# Security Policy

## Supported scope

This repository is currently maintained as a private engineering project.
Security issues should be reported privately and should not be disclosed through public issues or pull requests.

## Report a vulnerability

If you discover a security issue, report it through your internal PrecipAI security or engineering contact channel.

Include:

- affected component
- impact summary
- reproduction steps
- proof-of-concept if available
- mitigation ideas if known

## Sensitive areas

The following areas should be treated as higher-risk surfaces:

- MCP host installation and host config mutation
- long-term memory governance and deletion paths
- rule-gate bypass or audit integrity
- retrieval context assembly and prompt injection resistance
- database migrations and access control boundaries
