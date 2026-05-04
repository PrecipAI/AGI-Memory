# AI Domain Corpus v1

## Purpose

This corpus is the phase-1 real-world test set for the unified long-term knowledge system.

It is intentionally small and high-signal:

- 8 sources only
- official docs, official repos, engineering write-ups, or high-quality papers
- focused on agent systems, memory, RAG, and harness/eval engineering

This corpus is meant to validate:

- ingest stability
- sectioning quality
- governance usefulness
- retrieval quality
- evidence grounding
- ops visibility

It is not yet large enough for final benchmark conclusions.

## Selection Rules

- Prefer official engineering sources over social summaries.
- Prefer sources that contain reusable system concepts, not just product marketing.
- Prefer sources that exercise different knowledge shapes:
  - architecture
  - memory model
  - evaluation methodology
  - reliability risks
  - retrieval/grounding mechanics

## Selected Sources

### 1. GitHub Copilot Memory Public Preview

- Theme: `agent_memory`
- Source type: official product changelog
- Date: `2026-01-15`
- URL: <https://github.blog/changelog/2026-01-15-agentic-memory-for-github-copilot-is-in-public-preview/>
- Why selected:
  - clear product-level memory contract
  - repository scope
  - cross-agent reuse
  - explicit expiration behavior
- Best for testing:
  - factual extraction
  - rule extraction
  - time-bounded memory facts

### 2. Building an Agentic Memory System for GitHub Copilot

- Theme: `agent_memory`
- Source type: official engineering blog
- Date: `2026-01-15`
- URL: <https://github.blog/ai-and-ml/github-copilot/building-an-agentic-memory-system-for-github-copilot/>
- Why selected:
  - stronger engineering detail than the changelog
  - cross-agent memory design
  - validation before use
  - cumulative repository knowledge
- Best for testing:
  - section splitting
  - relation extraction
  - retrieval of architectural intent

### 3. LangGraph Memory Overview

- Theme: `agent_framework`
- Source type: official docs
- Date checked: `2026-04-28`
- URL: <https://docs.langchain.com/oss/javascript/concepts/memory>
- Why selected:
  - explicit short-term vs long-term memory boundary
  - namespace-based long-term memory
  - useful conceptual contrast with our current design
- Best for testing:
  - concept retrieval
  - definition-style queries
  - comparison queries

### 4. LangGraph ReAct Memory Agent

- Theme: `agent_framework`
- Source type: official GitHub repo
- Date checked: `2026-04-28`
- URL: <https://github.com/langchain-ai/memory-agent>
- Why selected:
  - concrete memory agent implementation
  - `user_id` scoped memory example
  - embedded evaluation guidance
- Best for testing:
  - implementation-detail retrieval
  - example-driven fact extraction
  - memory scope questions

### 5. Microsoft AutoGen Repository

- Theme: `agent_framework`
- Source type: official GitHub repo
- Date checked: `2026-04-28`
- URL: <https://github.com/microsoft/autogen>
- Why selected:
  - still influential historically
  - now clearly marked `maintenance mode`
  - migration pressure toward Microsoft Agent Framework
- Best for testing:
  - change-over-time facts
  - maintenance/deprecation knowledge
  - framework comparison queries

### 6. Haystack Repository

- Theme: `agentic_rag`
- Source type: official GitHub repo
- Date checked: `2026-04-28`
- URL: <https://github.com/deepset-ai/haystack>
- Why selected:
  - production-oriented agent/RAG framing
  - explicit control over retrieval, routing, memory, generation
  - good for modular pipeline concepts
- Best for testing:
  - pipeline concept extraction
  - architecture term grounding
  - RAG component relationship queries

### 7. SoK: Agentic RAG

- Theme: `agentic_rag`
- Source type: paper
- Date: `2026-03-07`
- URL: <https://arxiv.org/abs/2603.07379>
- Why selected:
  - taxonomy
  - architecture decomposition
  - evaluation and reliability framing
  - strong source for structured AI-system knowledge
- Best for testing:
  - multi-hop retrieval
  - abstract-to-structure extraction
  - risk and taxonomy questions

### 8. RAGalyst

- Theme: `eval_harness`
- Source type: paper
- Date: `2025-11-06`
- URL: <https://arxiv.org/abs/2511.04502>
- Why selected:
  - RAG evaluation methodology
  - human-aligned evaluation framing
  - useful for harness/eval engineering questions
- Best for testing:
  - evaluation-method retrieval
  - evidence-aware benchmarking questions
  - design trade-off queries

## Deferred but Important

These are strong follow-up sources for phase 2, but not required for the first real test round:

- Facet-Level Tracing of Evidence Uncertainty and Hallucination in RAG
- awesome-harness-engineering
- openai/simple-evals

Reason:

- they are valuable, but phase 1 should avoid overloading the corpus
- awesome lists are better as navigational support than as primary truth sources
- phase 1 needs tight, high-signal inputs first

## Phase 1 Query Categories

Use each source to generate questions across:

- `fact_lookup`
- `definition_lookup`
- `rule_lookup`
- `architecture_relation`
- `cross_section_summary`
- `evidence_grounding`
- `boundary_or_risk`
- `time_sensitive_change`

## Phase 1 Success Criteria

This corpus is sufficient if it helps answer:

- can the system ingest official AI-system sources cleanly
- can the system extract useful sections/evidence/facts
- can retrieval answer AI-system questions with grounding
- can ops console show meaningful objects from these sources

If phase 1 passes, expand to 20-30 sources for phase 2.
