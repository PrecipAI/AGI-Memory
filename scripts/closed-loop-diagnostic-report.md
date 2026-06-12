## Closed-Loop Metric Diagnostic Report

**Date:** 2026-06-12  
**Sprint:** Sprint 1 — Two-Step MCP Dance Pipeline  
**Status:** Partial Measurement Available

---

### Background

The user requested measurement of three critical closed-loop metrics for the Two-Step MCP Dance architecture:

1. **Handshake Success Rate** — Does the host LLM actually call Step 2 after receiving Step 1?
2. **Zod Validation First-Pass Rate** — Does the host_model_result pass validation on the first attempt?
3. **Layer Classification Accuracy** — Are candidates placed in the correct layers?

These metrics require a live, end-to-end deployment (MCP server + host LLM + memory service). This report assesses what we CAN measure now and what remains a blind spot.

---

### Environment Status

| Component | Status | Notes |
|-----------|--------|-------|
| PostgreSQL | Running (port 15432) | Service expects port 55432 — config mismatch |
| Memory Service | Not running | Cannot start without DB connection |
| MCP Server | Not running | Depends on memory service |
| MCP Wrapper Log | 2213 lines | Only startup/health checks; zero governance tool calls recorded |
| Old Pipeline Data | Available (May 13-14) | 60 candidates from deterministic pipeline |
| Real Codex Data | Available (291MB) | Thread 019e76f2, 27K events |

**Conclusion:** The local environment cannot produce live closed-loop metrics. The MCP wrapper log confirms no governance tool calls have ever been recorded — the handshake has never been attempted.

---

### Proxy Measurements (Offline)

#### Dimension 1: Handshake Feasibility

The adapter correctly enforces `extraction_preview` presence:
- Missing extraction_preview → rejected with actionable error
- Null host_model_result → rejected with actionable error

**Assessment: ROBUST** — The gate is solid; the handshake protocol will correctly reject malformed Step 2 calls.

**What we can't measure:** Whether the host LLM actually reads the directive and calls Step 2. This requires live deployment.

#### Dimension 2: Validation First-Pass Rate (Simulated)

24 test scenarios covering:
- Perfect submissions (all four layers)
- Missing required fields (title, source_excerpt, content)
- Invalid enum values (wrong scope, type, behavior)
- Rule without constraint keywords
- Knowledge with private paths
- Memory containing procedure language
- Skill with wrong promotion_status
- Cross-layer duplicates
- Malformed inputs (null, string, non-array)

| Metric | Value |
|--------|-------|
| Total test cases | 24 |
| Correctly handled | 23/24 (95.8%) |
| Valid submissions accepted | 1/2 |
| Invalid submissions rejected | 16/16 (100%) |
| Old-pipeline quality accepted | 4/4 (passes structure, fails quality) |

**One false positive discovered:** A well-formed memory_candidate containing "fix_action: Add .nvmrc and CI pre-step" was rejected because `looksLikeProcedure` matched "step" in "pre-step". The word "step" in the procedure detector is too aggressive — it catches legitimate memory content that references fix steps.

**Assessment: STRONG with one edge case** — The adapter is an effective gatekeeper. The false positive needs a minor fix (use word boundary `\bstep\b` or require "step" to appear in procedural context).

#### Dimension 3: Layer Classification Accuracy

7 layer boundary tests, all correctly caught:
- Rule without must/must_not keywords → rejected
- Knowledge with project-private paths (D:\workspace) → rejected
- Knowledge with session_only scope → rejected
- Skill with promotion_status != needs_review → rejected
- Cross-layer duplicate (same content in rule + memory) → rejected
- Memory with procedure language (steps/workflow) → rejected
- Memory with external URLs (https://, arxiv.org) → rejected

**Assessment: 100% on structural layer boundaries**

---

### Old Pipeline Quality Baseline

Analysis of 60 candidates from the old deterministic pipeline (run 20260514-025343):

| Metric | Value |
|--------|-------|
| Total candidates | 60 |
| Clean (no quality issues) | **0 (0%)** |
| Structurally compatible with new adapter | **0 (0%)** |
| Type distribution | memory: 41, knowledge: 9, skill: 8, rule: 2 |

**Top quality issues:**

| Issue | Count | % |
|-------|-------|---|
| Verbose (>300 chars) | 49 | 82% |
| Memory missing {symptom, root_cause, fix_action} structure | 41 | 100% of memories |
| Verbose summary (>500 chars) | 38 | 63% |
| Contains raw file paths | 18 | 30% |
| Title is raw user text/question | 17 | 28% |
| Contains external URLs | 12 | 20% |
| Skill has no parameterized placeholders | 8 | 100% of skills |
| Rule missing constraint keywords | 2 | 100% of rules |

**Key insight:** The old pipeline's 33.2/100 quality score is confirmed by this analysis. Every single candidate had at least one quality issue. The new Two-Step Dance pipeline addresses all of these by:
1. Forcing the host LLM to follow the Four-Layer Extraction Protocol
2. Validating every field through the adapter's strict schema
3. Providing Fix/Example hints in error messages for self-correction

---

### Discovered Bug

**`looksLikeProcedure` false positive:** The function checks for the word "step" (among others like "步骤", "流程", "workflow"). This causes false positives when a memory_candidate's `content` legitimately mentions "step" in context (e.g., "fix_action: Add .nvmrc and CI pre-step"). 

**Fix suggestion:** Change the regex to require word boundary or procedural context:
```typescript
// Current (too aggressive):
"step"
// Proposed:
/\bstep\s*\d|\bstep\s+by\s+step/i
```

---

### What Remains Unmeasured (Live Deployment Required)

| Metric | Requires | Estimated Effort |
|--------|----------|-----------------|
| Real handshake rate | Running MCP server + host LLM | Deploy and observe 10+ sessions |
| Real validation first-pass rate | Host LLM following Four-Layer Protocol | Deploy and collect 20+ governance runs |
| Real layer classification accuracy | Host LLM + human review of results | Deploy + manual audit of 50+ candidates |
| Token estimation accuracy fix | Code change (Chinese chars ≈ 1.5-2.0 tokens) | Sprint 2 task |
| Ephemeral regex edge cases | Code change (path/IP coverage) | Sprint 2 task |

---

### Recommended Next Steps

1. **Fix the looksLikeProcedure false positive** — quick win, improves adapter precision
2. **Fix DB port mismatch** — align memory-service config (55432) with running PG (15432)
3. **Deploy end-to-end** — start memory-service + MCP server + connect Codex host
4. **Run 10 governance cycles** — measure real handshake rate, validation rate, and layer accuracy
5. **Compare against old pipeline baseline** — the 0/60 clean score is the bar to beat
