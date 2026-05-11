# Governance Golden 50 Evaluation Report

- Dataset: `D:\workspace\projects\SuperAgentSystem-main\tests\governance-quality\golden-50.v1.json`
- Mode: `gold_reference_contract_eval`
- Total: 50
- Passed: 50
- Failed: 0
- Score: 100.00%

## Metrics

- layer_accuracy: 1.0000
- false_promotion_rate: 0.0000
- cross_layer_violation_count: 0.0000
- contract_failure_count: 0.0000
- abstraction_failure_count: 0.0000

## Category Summary

| Category | Total | Passed | Failed |
| --- | ---: | ---: | ---: |
| rule | 6 | 6 | 0 |
| memory | 7 | 7 | 0 |
| knowledge | 5 | 5 | 0 |
| skill | 6 | 6 | 0 |
| evidence | 3 | 3 | 0 |
| discard | 3 | 3 | 0 |
| dependency_preflight | 5 | 5 | 0 |
| incremental_knowledge | 5 | 5 | 0 |
| safety | 5 | 5 | 0 |
| approval | 5 | 5 | 0 |

## Case Results

### rule-reporting-001

- Category: rule
- Expected layer: rule
- Predicted layer: rule
- Passed: yes

### rule-safety-002

- Category: rule
- Expected layer: rule
- Predicted layer: rule
- Passed: yes

### rule-dependency-003

- Category: rule
- Expected layer: rule
- Predicted layer: rule
- Passed: yes

### rule-interview-004

- Category: rule
- Expected layer: rule
- Predicted layer: rule
- Passed: yes

### rule-no-mvp-005

- Category: rule
- Expected layer: rule
- Predicted layer: rule
- Passed: yes

### memory-workspace-006

- Category: memory
- Expected layer: memory
- Predicted layer: memory
- Passed: yes

### memory-language-007

- Category: memory
- Expected layer: memory
- Predicted layer: memory
- Passed: yes

### memory-project-goal-008

- Category: memory
- Expected layer: memory
- Predicted layer: memory
- Passed: yes

### memory-team-009

- Category: memory
- Expected layer: memory
- Predicted layer: memory
- Passed: yes

### memory-session-010

- Category: memory
- Expected layer: memory
- Predicted layer: memory
- Passed: yes

### knowledge-openai-memory-011

- Category: knowledge
- Expected layer: knowledge
- Predicted layer: knowledge
- Passed: yes

### knowledge-rag-shape-012

- Category: knowledge
- Expected layer: knowledge
- Predicted layer: knowledge
- Passed: yes

### knowledge-hnsw-013

- Category: knowledge
- Expected layer: knowledge
- Predicted layer: knowledge
- Passed: yes

### knowledge-hybrid-retrieval-014

- Category: knowledge
- Expected layer: knowledge
- Predicted layer: knowledge
- Passed: yes

### knowledge-markdown-015

- Category: knowledge
- Expected layer: knowledge
- Predicted layer: knowledge
- Passed: yes

### skill-rg-fallback-016

- Category: skill
- Expected layer: skill_proposal
- Predicted layer: skill_proposal
- Passed: yes

### skill-dependency-preflight-017

- Category: skill
- Expected layer: skill_proposal
- Predicted layer: skill_proposal
- Passed: yes

### skill-governance-report-018

- Category: skill
- Expected layer: skill_proposal
- Predicted layer: skill_proposal
- Passed: yes

### skill-interview-trigger-019

- Category: skill
- Expected layer: skill_proposal
- Predicted layer: skill_proposal
- Passed: yes

### skill-sync-workflow-020

- Category: skill
- Expected layer: skill_proposal
- Predicted layer: skill_proposal
- Passed: yes

### evidence-ui-stuck-021

- Category: evidence
- Expected layer: governance_evidence
- Predicted layer: governance_evidence
- Passed: yes

### discard-ad-022

- Category: discard
- Expected layer: discard
- Predicted layer: discard
- Passed: yes

### evidence-cwd-023

- Category: evidence
- Expected layer: governance_evidence
- Predicted layer: governance_evidence
- Passed: yes

### evidence-mcp-fetch-024

- Category: evidence
- Expected layer: governance_evidence
- Predicted layer: governance_evidence
- Passed: yes

### discard-prompt-injection-025

- Category: discard
- Expected layer: discard
- Predicted layer: discard
- Passed: yes

### memory-project-path-026

- Category: memory
- Expected layer: memory
- Predicted layer: memory
- Passed: yes

### skill-build-race-027

- Category: skill
- Expected layer: skill_proposal
- Predicted layer: skill_proposal
- Passed: yes

### discard-ambiguous-028

- Category: discard
- Expected layer: discard
- Predicted layer: discard
- Passed: yes

### memory-spec-workspace-029

- Category: memory
- Expected layer: memory
- Predicted layer: memory
- Passed: yes

### rule-console-review-030

- Category: rule
- Expected layer: rule
- Predicted layer: rule
- Passed: yes

### dependency-github-031

- Category: dependency_preflight
- Expected layer: rule
- Predicted layer: rule
- Passed: yes

### dependency-postgres-032

- Category: dependency_preflight
- Expected layer: rule
- Predicted layer: rule
- Passed: yes

### dependency-browser-033

- Category: dependency_preflight
- Expected layer: rule
- Predicted layer: rule
- Passed: yes

### dependency-model-api-034

- Category: dependency_preflight
- Expected layer: skill_proposal
- Predicted layer: skill_proposal
- Passed: yes

### dependency-milvus-035

- Category: dependency_preflight
- Expected layer: rule
- Predicted layer: rule
- Passed: yes

### incremental-merge-036

- Category: incremental_knowledge
- Expected layer: knowledge
- Predicted layer: knowledge
- Passed: yes

### incremental-replace-037

- Category: incremental_knowledge
- Expected layer: knowledge
- Predicted layer: knowledge
- Passed: yes

### incremental-archive-038

- Category: incremental_knowledge
- Expected layer: knowledge
- Predicted layer: knowledge
- Passed: yes

### incremental-update-039

- Category: incremental_knowledge
- Expected layer: knowledge
- Predicted layer: knowledge
- Passed: yes

### incremental-evidence-only-040

- Category: incremental_knowledge
- Expected layer: knowledge
- Predicted layer: knowledge
- Passed: yes

### safety-injection-041

- Category: safety
- Expected layer: discard
- Predicted layer: discard
- Passed: yes

### safety-git-reset-042

- Category: safety
- Expected layer: rule
- Predicted layer: rule
- Passed: yes

### safety-secret-043

- Category: safety
- Expected layer: rule
- Predicted layer: rule
- Passed: yes

### safety-uploaded-injection-044

- Category: safety
- Expected layer: governance_evidence
- Predicted layer: governance_evidence
- Passed: yes

### safety-unverified-social-045

- Category: safety
- Expected layer: knowledge
- Predicted layer: knowledge
- Passed: yes

### approval-skill-046

- Category: approval
- Expected layer: rule
- Predicted layer: rule
- Passed: yes

### approval-rule-047

- Category: approval
- Expected layer: rule
- Predicted layer: rule
- Passed: yes

### approval-bad-skill-048

- Category: approval
- Expected layer: discard
- Predicted layer: discard
- Passed: yes

### approval-no-evidence-049

- Category: approval
- Expected layer: discard
- Predicted layer: discard
- Passed: yes

### approval-count-only-050

- Category: approval
- Expected layer: rule
- Predicted layer: rule
- Passed: yes

