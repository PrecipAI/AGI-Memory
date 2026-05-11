import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildMemoryServiceApp } from "../services/memory-service/dist/services/memory-service/src/app.js";
import { buildTaskOrchestratorApp } from "../services/task-orchestrator/dist/services/task-orchestrator/src/app.js";
import { buildVerificationServiceApp } from "../services/verification-service/dist/services/verification-service/src/app.js";

const { Pool } = pg;
const tenantId = process.env.DEFAULT_TENANT_ID || "tenant-local";
const scope = process.env.DEFAULT_SCOPE || "memory.validation";
const fingerprint = process.env.DEFAULT_MEMORY_FINGERPRINT || "local-dev-v1";
const pool = new Pool({
  connectionString: process.env.DB_URL || "postgresql://postgres:postgres@127.0.0.1:55432/super_agent_system"
});

const taskOrchestrator = buildTaskOrchestratorApp();
const verificationService = buildVerificationServiceApp();
const memoryService = buildMemoryServiceApp();

function buildHeaders(label) {
  return {
    "X-Tenant-Id": tenantId,
    "X-Scope": scope,
    "X-Trace-Id": `trace-${label}-${Date.now()}`,
    "Idempotency-Key": `idem-${label}-${Date.now()}`
  };
}

try {
  const tableCheck = await pool.query(
    `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN (
        'message',
        'task_run',
        'artifact',
        'conversation_summary',
        'memory_candidate',
        'rule',
        'environment_fingerprint',
        'memory_access_log',
        'drift_check_result',
        'zombie_state',
        'reconciliation_item',
        'task_attempt'
      )
    ORDER BY table_name
    `
  );
  assert.equal(tableCheck.rows.length, 12, "memory system v3 production tables are missing");
  const baselines = {
    contract_requires_fingerprint_status: false,
    task_request_projects_task_run: false,
    artifact_evidence_persisted: false,
    factual_candidate_persists_to_memory: false,
    constraint_candidate_persists_to_rule: false,
    procedural_candidate_persists_to_skill: false,
    governance_rebuilds_summary_and_snapshot: false,
    matched_fingerprint_enables_procedural_retrieval: false,
    mismatch_or_missing_fingerprint_blocks_procedural_retrieval: false,
    retrieve_returns_attention_context_package: false,
    existing_bundle_reuse_detected: false,
    task_binding_matches_rules_and_skills: false,
    rule_checklist_returns_checkpoints: false,
    rule_gate_blocks_missing_evidence: false,
    rule_gate_allows_with_evidence: false,
    rule_hotplug_disable_removes_gate: false
  };

  const taskRequestId = randomUUID();
  const planner = await taskOrchestrator.inject({
    method: "POST",
    url: "/internal/planner/plan",
    headers: buildHeaders("planner"),
    payload: {
      task_request_id: taskRequestId,
      task_type: "effectful_demo",
      goal: "Create a reversible mock ticket and validate memory V3 ingestion.",
      normalized_envelope: {
        source: "verify-memory-system"
      },
      resident_context: {
        mode: "single-tenant"
      },
      retrieval_budget: {
        resident: 4,
        factual: 4,
        procedural: 4
      }
    }
  });
  assert.equal(planner.statusCode, 200, "planner happy path failed");
  const plannerBody = planner.json();

  const stepRows = await pool.query(
    `
    SELECT id, step_order, step_key
    FROM task_step
    WHERE task_plan_id = $1
    ORDER BY step_order
    `,
    [plannerBody.task_plan_id]
  );
  assert.equal(stepRows.rows.length, 3, "task plan should contain three steps");
  const effectfulStep = stepRows.rows.find((row) => row.step_order === 2);
  assert.ok(effectfulStep, "effectful step missing");

  const resolver = await taskOrchestrator.inject({
    method: "POST",
    url: "/internal/resolver/resolve",
    headers: buildHeaders("resolver"),
    payload: {
      task_plan_id: plannerBody.task_plan_id,
      task_step_id: effectfulStep.id,
      step_type: "effectful_demo",
      risk_level: "low",
      side_effect_class: "external_resource",
      required_scopes: [scope],
      fingerprint_context: {
        task_type: "effectful_demo",
        fingerprint
      }
    }
  });
  assert.equal(resolver.statusCode, 200, "resolver happy path failed");
  const resolverBody = resolver.json();

  const precheck = await verificationService.inject({
    method: "POST",
    url: "/internal/verifier/check",
    headers: buildHeaders("precheck"),
    payload: {
      task_request_id: taskRequestId,
      task_plan_id: plannerBody.task_plan_id,
      task_step_id: effectfulStep.id,
      verification_phase: "precheck",
      expected_state: {
        dispatch_allowed: true
      },
      observed_state: {
        dispatch_allowed: true,
        fingerprint,
        artifact_tag: "environment_fact",
        side_effect_class: "external_resource"
      }
    }
  });
  assert.equal(precheck.statusCode, 200, "precheck failed");
  const precheckBody = precheck.json();
  assert.ok(precheckBody.precheck_token, "precheck token missing");

  const dispatch = await taskOrchestrator.inject({
    method: "POST",
    url: "/internal/router/dispatch",
    headers: buildHeaders("dispatch"),
    payload: {
      task_request_id: taskRequestId,
      task_plan_id: plannerBody.task_plan_id,
      task_step_id: effectfulStep.id,
      resolved_capability_id: resolverBody.resolved_capability_id,
      dispatch_payload: {
        title: "Memory V3 verification mock ticket"
      },
      precheck_token: precheckBody.precheck_token
    }
  });
  assert.equal(dispatch.statusCode, 200, "dispatch failed");
  const dispatchBody = dispatch.json();
  assert.equal(dispatchBody.dispatch_status, "committed", "dispatch should commit for memory validation");
  assert.equal(dispatchBody.attempt_no, 1, "first dispatch should record attempt #1");

  const postcheck = await verificationService.inject({
    method: "POST",
    url: "/internal/verifier/check",
    headers: buildHeaders("postcheck"),
    payload: {
      task_request_id: taskRequestId,
      task_plan_id: plannerBody.task_plan_id,
      task_step_id: effectfulStep.id,
      verification_phase: "postcheck",
      expected_state: {
        resource_created: true
      },
      observed_state: {
        resource_created: true,
        fingerprint,
        artifact_tag: "workflow_tag=standard_path",
        error_code: "FIX_TIMEOUT_503",
        side_effect_class: "external_resource"
      }
    }
  });
  assert.equal(postcheck.statusCode, 200, "postcheck failed");
  const postcheckBody = postcheck.json();
  assert.ok(postcheckBody.memory_candidate_preview, "verification should emit memory candidate preview");

  const factualCandidate = await memoryService.inject({
    method: "POST",
    url: "/internal/memory/candidates",
    headers: buildHeaders("candidate-factual"),
    payload: {
      task_request_id: taskRequestId,
      task_step_id: effectfulStep.id,
      source_type: "artifact",
      source_ref: "verify://memory/factual/environment",
      artifact_tag: "environment_fact",
      verification_status: "verified",
      side_effect_class: "read_only",
      fingerprint_status: "matched_or_na",
      candidate_payload: {
        title: "Support environment endpoint",
        content: "Mock ticket capability is registered and reachable in the validation environment."
      }
    }
  });
  assert.equal(factualCandidate.statusCode, 200, "factual candidate ingestion failed");
  const factualCandidateBody = factualCandidate.json();
  assert.equal(factualCandidateBody.persist_target, "memory", "factual candidate should persist to memory");
  baselines.factual_candidate_persists_to_memory = true;

  const factualUpdateCandidate = await memoryService.inject({
    method: "POST",
    url: "/internal/memory/candidates",
    headers: buildHeaders("candidate-factual-update"),
    payload: {
      task_request_id: taskRequestId,
      task_step_id: effectfulStep.id,
      source_type: "artifact",
      source_ref: "verify://memory/factual/environment-update",
      artifact_tag: "environment_fact",
      verification_status: "verified",
      side_effect_class: "read_only",
      fingerprint_status: "matched_or_na",
      candidate_payload: {
        title: "Support environment endpoint",
        content: "Mock ticket capability is registered, reachable, and monitored in the validation environment."
      }
    }
  });
  assert.equal(factualUpdateCandidate.statusCode, 200, "factual update candidate ingestion failed");
  assert.equal(factualUpdateCandidate.json().persist_target, "memory", "factual update should route to memory proposals");

  const designDecisionCandidate = await memoryService.inject({
    method: "POST",
    url: "/internal/memory/candidates",
    headers: buildHeaders("candidate-design-decision"),
    payload: {
      task_request_id: taskRequestId,
      task_step_id: effectfulStep.id,
      source_type: "project_execution",
      source_ref: "verify://memory/factual/design-decision",
      artifact_tag: "design_decision",
      verification_status: "verified",
      side_effect_class: "state_change",
      fingerprint_status: "matched_or_na",
      candidate_payload: {
        title: "Knowledge governance routing decision",
        content: "Verified project design decisions should persist as factual memory instead of being dropped by the router."
      }
    }
  });
  assert.equal(designDecisionCandidate.statusCode, 200, "design decision candidate ingestion failed");
  const designDecisionCandidateBody = designDecisionCandidate.json();
  assert.equal(designDecisionCandidateBody.persist_target, "memory", "verified design decision should persist to memory");

  const constraintCandidate = await memoryService.inject({
    method: "POST",
    url: "/internal/memory/candidates",
    headers: buildHeaders("candidate-rule-constraint"),
    payload: {
      task_request_id: taskRequestId,
      task_step_id: effectfulStep.id,
      source_type: "project_execution",
      source_ref: "verify://memory/rule/workspace-constraint",
      artifact_tag: "project_constraint",
      verification_status: "verified",
      side_effect_class: "read_only",
      fingerprint_status: "matched_or_na",
      candidate_payload: {
        rule_key: "verify-workspace-constraint",
        title: "Workspace rule candidate",
        content: "Workspace directories are machine-specific and must be confirmed before cloning shared repositories.",
        applies_to: ["planner", "router", "executor"],
        enforcement_level: "must"
      }
    }
  });
  assert.equal(constraintCandidate.statusCode, 200, "constraint candidate ingestion failed");
  const constraintCandidateBody = constraintCandidate.json();
  assert.equal(constraintCandidateBody.persist_target, "rule", "verified project constraint should persist to rule");
  assert.ok(constraintCandidateBody.persisted_object_id, "rule candidate should persist a rule object");
  baselines.constraint_candidate_persists_to_rule = true;

  const constraintUpdateCandidate = await memoryService.inject({
    method: "POST",
    url: "/internal/memory/candidates",
    headers: buildHeaders("candidate-rule-constraint-update"),
    payload: {
      task_request_id: taskRequestId,
      task_step_id: effectfulStep.id,
      source_type: "project_execution",
      source_ref: "verify://memory/rule/workspace-constraint-update",
      artifact_tag: "project_constraint",
      verification_status: "verified",
      side_effect_class: "read_only",
      fingerprint_status: "matched_or_na",
      candidate_payload: {
        rule_key: "verify-workspace-constraint",
        title: "Workspace rule candidate updated",
        content: "Workspace directories are machine-specific and must be confirmed before cloning or moving shared repositories.",
        applies_to: ["planner", "router", "executor"],
        enforcement_level: "must",
        priority: 90
      }
    }
  });
  assert.equal(constraintUpdateCandidate.statusCode, 200, "constraint update candidate ingestion failed");
  const constraintUpdateCandidateBody = constraintUpdateCandidate.json();
  assert.equal(constraintUpdateCandidateBody.persist_target, "rule", "updated constraint should persist to rule");

  const conflictingConstraintCandidate = await memoryService.inject({
    method: "POST",
    url: "/internal/memory/candidates",
    headers: buildHeaders("candidate-rule-conflict"),
    payload: {
      task_request_id: taskRequestId,
      task_step_id: effectfulStep.id,
      source_type: "project_execution",
      source_ref: "verify://memory/rule/workspace-conflict",
      artifact_tag: "project_constraint",
      verification_status: "verified",
      side_effect_class: "read_only",
      fingerprint_status: "matched_or_na",
      candidate_payload: {
        rule_key: "verify-workspace-conflicting-constraint",
        title: "Conflicting workspace rule candidate",
        content: "Workspace directories may be assumed from another machine without confirmation.",
        applies_to: ["planner", "router", "executor"],
        enforcement_level: "must_not",
        priority: 40,
        conflicts_with_rule_key: "verify-workspace-constraint",
        conflict_type: "workspace_location_policy_conflict"
      }
    }
  });
  assert.equal(conflictingConstraintCandidate.statusCode, 200, "conflicting constraint candidate ingestion failed");
  const conflictingConstraintCandidateBody = conflictingConstraintCandidate.json();
  assert.equal(conflictingConstraintCandidateBody.persist_target, "rule", "conflicting constraint should first persist to rule before governance resolves it");

  const proceduralCandidate = await memoryService.inject({
    method: "POST",
    url: "/internal/memory/candidates",
    headers: buildHeaders("candidate-procedural"),
    payload: {
      task_request_id: taskRequestId,
      task_step_id: effectfulStep.id,
      ...postcheckBody.memory_candidate_preview
    }
  });
  assert.equal(proceduralCandidate.statusCode, 200, "procedural candidate ingestion failed");
  const proceduralCandidateBody = proceduralCandidate.json();
  assert.equal(proceduralCandidateBody.persist_target, "skill", "verified fix should persist to skill");
  baselines.procedural_candidate_persists_to_skill = true;

  const extensionTraceId = randomUUID();
  const extensionSetup = await pool.query(
    `
    WITH active_rule AS (
      SELECT id
      FROM rule
      WHERE tenant_id = $1
        AND scope = $2
        AND rule_key = 'verify-workspace-constraint'
        AND status = 'active'
      ORDER BY version DESC
      LIMIT 1
    ),
    active_skill AS (
      SELECT skill_key
      FROM skill
      WHERE tenant_id = $1
        AND scope = $2
        AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1
    ),
    pack AS (
      INSERT INTO extension_pack (
        tenant_id, scope, status, pack_key, title, description, risk_level, activation_policy, trace_id
      )
      VALUES (
        $1, $2, 'active', 'verify-mcp-integration-pack', 'Verify MCP integration pack',
        'Binds integration tasks to strict workspace rules and the latest procedural skill.',
        'medium', '{"requires_human_confirmation": true}'::jsonb, $3
      )
      ON CONFLICT (tenant_id, scope, pack_key, version)
      DO UPDATE SET status = 'active', updated_at = now()
      RETURNING id
    ),
    binding AS (
      INSERT INTO task_binding (
        tenant_id, scope, status, binding_key, title, description, extension_pack_id,
        task_types, hosts, rule_keys, skill_keys, priority, risk_level, trace_id
      )
      SELECT
        $1, $2, 'active', 'verify-integration-binding', 'Verify integration binding',
        'Integration tasks should load the workspace rule and procedural skill.',
        pack.id,
        ARRAY['integration', 'execution']::text[],
        ARRAY['codex', 'claude_code']::text[],
        ARRAY['verify-workspace-constraint']::text[],
        ARRAY[COALESCE((SELECT skill_key FROM active_skill), 'verify-procedural-skill')]::text[],
        95,
        'medium',
        $3
      FROM pack
      ON CONFLICT (tenant_id, scope, binding_key, version)
      DO UPDATE SET status = 'active', updated_at = now()
      RETURNING id
    )
    INSERT INTO rule_checkpoint (
      tenant_id, scope, status, rule_id, checkpoint_key, checkpoint_phase, operation,
      requirement, evidence_required, verifier_ref, failure_behavior, priority, trace_id
    )
    SELECT
      $1, $2, 'active', active_rule.id, 'verify-workspace-before-config-write', 'before',
      'write_host_config',
      'Confirm machine-specific workspace/config paths before writing host configuration.',
      '["confirmed_workspace_path", "backup_file_path"]'::jsonb,
      'memory-mcp doctor',
      'block_and_report',
      100,
      $3
    FROM active_rule
    ON CONFLICT (tenant_id, scope, rule_id, checkpoint_key, version)
    DO UPDATE SET status = 'active', updated_at = now()
    RETURNING id
    `,
    [tenantId, scope, extensionTraceId]
  );
  assert.ok(extensionSetup.rowCount >= 1, "extension pack binding should create a rule checkpoint");

  const mismatchCandidate = await memoryService.inject({
    method: "POST",
    url: "/internal/memory/candidates",
    headers: buildHeaders("candidate-mismatch"),
    payload: {
      task_request_id: taskRequestId,
      task_step_id: effectfulStep.id,
      source_type: "verification_result",
      source_ref: "verify://memory/procedural-mismatch",
      artifact_tag: "workflow_tag=standard_path",
      error_code: "FIX_TIMEOUT_503",
      verification_status: "verified_fix",
      side_effect_class: "external_resource",
      fingerprint: "wrong-fingerprint",
      fingerprint_status: "mismatch",
      candidate_payload: {
        title: "Do not persist mismatched procedural memory",
        content: "This candidate must not enter skill retrieval because fingerprint mismatches."
      }
    }
  });
  assert.equal(mismatchCandidate.statusCode, 200, "mismatch candidate ingestion failed");
  const mismatchCandidateBody = mismatchCandidate.json();
  assert.notEqual(mismatchCandidateBody.persist_target, "skill", "mismatched procedural candidate must not persist to skill");

  const governance = await memoryService.inject({
    method: "POST",
    url: "/internal/memory/governance/run",
    headers: buildHeaders("governance"),
    payload: {
      task_request_id: taskRequestId,
      task_step_id: effectfulStep.id,
      fingerprint,
      rebuild_resident: true,
      sync_index: true,
      run_lifecycle: true
    }
  });
  assert.equal(governance.statusCode, 200, "governance run failed");
  const governanceBody = governance.json();
  assert.ok(governanceBody.summary_ids.length >= 1, "conversation summary should be generated");
  assert.ok(governanceBody.rebuilt_snapshot_id, "resident snapshot should be rebuilt");
  assert.ok(
    Array.isArray(governanceBody.drift_check_result_ids) && governanceBody.drift_check_result_ids.length >= 1,
    "governance should record drift check results"
  );
  assert.ok(
    Array.isArray(governanceBody.reconciliation_item_ids),
    "governance response should include reconciliation item ids"
  );
  assert.ok(
    Array.isArray(governanceBody.lifecycle.rule_conflict_ids),
    "governance response should include rule conflict ids"
  );
  assert.ok(Array.isArray(governanceBody.zombie_state_ids), "governance response should include zombie state ids");
  assert.ok(
    Number(governanceBody.lifecycle.access_log_count ?? 0) >= 1,
    "governance should report memory access log count"
  );
  baselines.governance_rebuilds_summary_and_snapshot = true;

  const detachedGovernanceTaskRequestId = randomUUID();
  const detachedGovernanceTaskStepId = randomUUID();
  const detachedGovernance = await memoryService.inject({
    method: "POST",
    url: "/internal/memory/governance/run",
    headers: buildHeaders("governance-detached-mcp"),
    payload: {
      task_request_id: detachedGovernanceTaskRequestId,
      task_step_id: detachedGovernanceTaskStepId,
      fingerprint,
      rebuild_resident: false,
      sync_index: false,
      run_lifecycle: false
    }
  });
  assert.equal(
    detachedGovernance.statusCode,
    200,
    `detached MCP governance should upsert task envelope instead of failing FK: ${detachedGovernance.body}`
  );
  const detachedCandidate = await memoryService.inject({
    method: "POST",
    url: "/internal/memory/candidates",
    headers: buildHeaders("candidate-detached-same-task"),
    payload: {
      task_request_id: detachedGovernanceTaskRequestId,
      task_step_id: randomUUID(),
      source_type: "artifact",
      source_ref: "verify://memory/detached-same-task",
      artifact_tag: "environment_fact",
      verification_status: "verified",
      side_effect_class: "read_only",
      fingerprint_status: "matched_or_na",
      candidate_payload: {
        title: "Detached governance candidate envelope",
        content: "MCP candidate and governance calls may share a task_request while using different task_step ids."
      }
    }
  });
  assert.equal(
    detachedCandidate.statusCode,
    200,
    `detached MCP candidate should not conflict with governance step_key: ${detachedCandidate.body}`
  );

  const summaryQuery = await memoryService.inject({
    method: "POST",
    url: "/internal/memory/query",
    headers: buildHeaders("query-summary"),
    payload: {
      kind: "summary",
      task_request_id: taskRequestId,
      limit: 5
    }
  });
  assert.equal(summaryQuery.statusCode, 200, "summary query failed");
  const summaryQueryBody = summaryQuery.json();
  assert.ok(summaryQueryBody.items.length >= 1, "summary layer should contain generated summary");

  const candidateQuery = await memoryService.inject({
    method: "POST",
    url: "/internal/memory/query",
    headers: buildHeaders("query-candidate"),
    payload: {
      kind: "candidate",
      task_request_id: taskRequestId,
      limit: 10
    }
  });
  assert.equal(candidateQuery.statusCode, 200, "candidate query failed");
  const candidateQueryBody = candidateQuery.json();
  assert.ok(candidateQueryBody.items.length >= 3, "candidate layer should store routed candidates");

  const retrieveWithoutFingerprintStatus = await memoryService.inject({
    method: "POST",
    url: "/internal/memory/retrieve",
    headers: buildHeaders("retrieve-missing-status"),
    payload: {
      task_request_id: taskRequestId,
      query: "What is the retrieval contract?",
      runtime_summary: {
        active_step: effectfulStep.step_key
      },
      fingerprint,
      include_factual: true,
      include_procedural: true,
      limit: 10
    }
  });
  assert.equal(
    retrieveWithoutFingerprintStatus.statusCode,
    400,
    "retrieve should reject requests that omit fingerprint_status"
  );
  assert.equal(
    retrieveWithoutFingerprintStatus.json().error_code,
    "FINGERPRINT_STATUS_REQUIRED",
    "retrieve should emit a contract error when fingerprint_status is missing"
  );
  baselines.contract_requires_fingerprint_status = true;

  const retrieveWithoutFingerprint = await memoryService.inject({
    method: "POST",
    url: "/internal/memory/retrieve",
    headers: buildHeaders("retrieve-missing-fingerprint"),
    payload: {
      task_request_id: taskRequestId,
      query: "What is the retrieval contract?",
      runtime_summary: {
        active_step: effectfulStep.step_key
      },
      fingerprint_status: "matched",
      include_factual: true,
      include_procedural: true,
      limit: 10
    }
  });
  assert.equal(
    retrieveWithoutFingerprint.statusCode,
    400,
    "retrieve should reject procedural requests that omit fingerprint"
  );
  assert.equal(
    retrieveWithoutFingerprint.json().error_code,
    "FINGERPRINT_REQUIRED",
    "retrieve should emit a contract error when procedural retrieval omits fingerprint"
  );

  const matchedRetrieve = await memoryService.inject({
    method: "POST",
    url: "/internal/memory/retrieve",
    headers: buildHeaders("retrieve-matched"),
    payload: {
      task_request_id: taskRequestId,
      query: "How should I handle support triage?",
      runtime_summary: {
        active_step: effectfulStep.step_key
      },
      fingerprint,
      fingerprint_status: "matched",
      include_factual: true,
      include_procedural: true,
      task_type: "execution",
      host: "codex",
      operation_intent: "write_host_config",
      context_budget_tokens: 2048,
      compression_mode: "light",
      limit: 10
    }
  });
  assert.equal(matchedRetrieve.statusCode, 200, "matched retrieve failed");
  const matchedRetrieveBody = matchedRetrieve.json();
  assert.ok(matchedRetrieveBody.bundle_id, "retrieve should return a bundle_id for reuse checks");
  assert.equal(matchedRetrieveBody.assembly_context.task_type, "execution", "retrieve should preserve task_type in assembly context");
  assert.ok(matchedRetrieveBody.assembly_context.query_hash, "retrieve should return query_hash for existing bundle checks");
  assert.ok(matchedRetrieveBody.layer_versions.memory, "retrieve should return layer_versions");
  assert.ok(matchedRetrieveBody.context_package.sections.length >= 1, "retrieve should return an attention-aware context_package");
  assert.equal(
    matchedRetrieveBody.context_package.sections[0].name,
    "Execution Rules",
    "context package should put rules first for attention layout"
  );
  assert.ok(
    matchedRetrieveBody.context_package.sections.some((section) => section.name === "Current Step Reminder" && section.placement === "tail"),
    "context package should keep a tail reminder for attention layout"
  );
  baselines.retrieve_returns_attention_context_package = true;
  assert.ok(matchedRetrieveBody.conversation_summary.length >= 1, "retrieve should include conversation summary");
  assert.ok(matchedRetrieveBody.resident_snapshot.length >= 1, "retrieve should include resident snapshot");
  assert.ok(Array.isArray(matchedRetrieveBody.rules) && matchedRetrieveBody.rules.length >= 1, "retrieve should include active rules");
  assert.ok(
    matchedRetrieveBody.rules.some((item) => item.rule_key === "verify-workspace-constraint"),
    "retrieve should include the verified workspace constraint as a rule"
  );
  assert.ok(
    Array.isArray(matchedRetrieveBody.assembly_context.task_bindings) &&
      matchedRetrieveBody.assembly_context.task_bindings.some((item) => item.binding_key === "verify-integration-binding"),
    "retrieve should include matching task bindings for the task type and host"
  );
  baselines.task_binding_matches_rules_and_skills = true;
  assert.ok(
    Array.isArray(matchedRetrieveBody.assembly_context.rule_checklist) &&
      matchedRetrieveBody.assembly_context.rule_checklist.some(
        (item) => item.checkpoint_key === "verify-workspace-before-config-write" && item.operation === "write_host_config"
      ),
    "retrieve should return rule checkpoints as an executable checklist"
  );
  baselines.rule_checklist_returns_checkpoints = true;
  assert.ok(matchedRetrieveBody.factual_memory.length >= 1, "retrieve should include query-matched factual memory");
  assert.ok(
    matchedRetrieveBody.factual_memory.every((item) => `${item.title ?? ""} ${item.content ?? ""} ${JSON.stringify(item.tags ?? [])}`.toLowerCase().includes("support")),
    "factual memory retrieval should not return unrelated factual memories"
  );
  assert.ok(matchedRetrieveBody.procedural_memory.length >= 1, "retrieve should include matched procedural memory");
  baselines.matched_fingerprint_enables_procedural_retrieval = true;

  const blockedGate = await memoryService.inject({
    method: "POST",
    url: "/internal/rules/gate/check",
    headers: buildHeaders("rule-gate-block"),
    payload: {
      task_request_id: taskRequestId,
      task_step_id: effectfulStep.id,
      task_type: "execution",
      host: "codex",
      operation: "write_host_config",
      evidence: {
        confirmed_workspace_path: "D:\\workspace\\projects"
      },
      actor_ref: "verify-memory-system"
    }
  });
  assert.equal(blockedGate.statusCode, 200, "rule gate block check failed");
  const blockedGateBody = blockedGate.json();
  assert.equal(blockedGateBody.allowed, false, "rule gate should block when required evidence is missing");
  assert.equal(blockedGateBody.decision, "block", "rule gate should return block decision for missing evidence");
  assert.ok(blockedGateBody.audit_ids.length >= 1, "rule gate should write audit records for blocked checks");
  baselines.rule_gate_blocks_missing_evidence = true;

  const allowedGate = await memoryService.inject({
    method: "POST",
    url: "/internal/rules/gate/check",
    headers: buildHeaders("rule-gate-allow"),
    payload: {
      task_request_id: taskRequestId,
      task_step_id: effectfulStep.id,
      task_type: "execution",
      host: "codex",
      operation: "write_host_config",
      evidence: {
        confirmed_workspace_path: "D:\\workspace\\projects",
        backup_file_path: "D:\\workspace\\outputs\\verify-config-backup.json"
      },
      actor_ref: "verify-memory-system"
    }
  });
  assert.equal(allowedGate.statusCode, 200, "rule gate allow check failed");
  const allowedGateBody = allowedGate.json();
  assert.equal(allowedGateBody.allowed, true, "rule gate should allow when required evidence is present");
  assert.equal(allowedGateBody.decision, "allow", "rule gate should return allow decision with complete evidence");
  baselines.rule_gate_allows_with_evidence = true;

  const reusedRetrieve = await memoryService.inject({
    method: "POST",
    url: "/internal/memory/retrieve",
    headers: buildHeaders("retrieve-reuse"),
    payload: {
      task_request_id: taskRequestId,
      query: "How should I handle support triage?",
      runtime_summary: {
        active_step: effectfulStep.step_key
      },
      fingerprint,
      fingerprint_status: "matched",
      include_factual: true,
      include_procedural: true,
      task_type: "execution",
      host: "codex",
      operation_intent: "write_host_config",
      context_budget_tokens: 2048,
      compression_mode: "light",
      existing_bundle_id: matchedRetrieveBody.bundle_id,
      existing_query_hash: matchedRetrieveBody.assembly_context.query_hash,
      layer_versions: matchedRetrieveBody.layer_versions,
      limit: 10
    }
  });
  assert.equal(reusedRetrieve.statusCode, 200, "bundle reuse retrieve failed");
  const reusedRetrieveBody = reusedRetrieve.json();
  assert.equal(
    reusedRetrieveBody.assembly_context.reuse_existing_bundle,
    true,
    "retrieve should detect reusable bundles when query_hash and layer_versions match"
  );
  baselines.existing_bundle_reuse_detected = true;

  await pool.query(
    `
    UPDATE task_binding
    SET status = 'disabled', updated_at = now()
    WHERE tenant_id = $1
      AND scope = $2
      AND binding_key = 'verify-integration-binding'
    `,
    [tenantId, scope]
  );
  const hotplugDisabledGate = await memoryService.inject({
    method: "POST",
    url: "/internal/rules/gate/check",
    headers: buildHeaders("rule-gate-hotplug-disabled"),
    payload: {
      task_request_id: taskRequestId,
      task_step_id: effectfulStep.id,
      task_type: "execution",
      host: "codex",
      operation: "write_host_config",
      evidence: {},
      actor_ref: "verify-memory-system"
    }
  });
  assert.equal(hotplugDisabledGate.statusCode, 200, "rule gate hotplug disabled check failed");
  const hotplugDisabledGateBody = hotplugDisabledGate.json();
  assert.equal(hotplugDisabledGateBody.allowed, true, "disabled binding should remove the gate on the next check");
  assert.equal(hotplugDisabledGateBody.matched_checkpoint_count, 0, "disabled binding should stop matching checkpoints");
  baselines.rule_hotplug_disable_removes_gate = true;

  const mismatchedRetrieve = await memoryService.inject({
    method: "POST",
    url: "/internal/memory/retrieve",
    headers: buildHeaders("retrieve-mismatch"),
    payload: {
      task_request_id: taskRequestId,
      query: "How should I handle support triage?",
      runtime_summary: {
        active_step: effectfulStep.step_key
      },
      fingerprint: "wrong-fingerprint",
      fingerprint_status: "mismatch",
      include_factual: true,
      include_procedural: true,
      limit: 10
    }
  });
  assert.equal(mismatchedRetrieve.statusCode, 200, "mismatch retrieve failed");
  const mismatchedRetrieveBody = mismatchedRetrieve.json();
  assert.equal(mismatchedRetrieveBody.procedural_memory.length, 0, "mismatched fingerprint should block procedural retrieval");
  baselines.mismatch_or_missing_fingerprint_blocks_procedural_retrieval = true;

  const governanceMismatch = await memoryService.inject({
    method: "POST",
    url: "/internal/memory/governance/run",
    headers: buildHeaders("governance-mismatch"),
    payload: {
      task_request_id: taskRequestId,
      task_step_id: effectfulStep.id,
      fingerprint: "wrong-fingerprint",
      rebuild_resident: true,
      sync_index: true,
      run_lifecycle: true
    }
  });
  assert.equal(governanceMismatch.statusCode, 200, "mismatch governance run failed");
  const governanceMismatchBody = governanceMismatch.json();
  assert.ok(
    Array.isArray(governanceMismatchBody.lifecycle.retired_summary_ids) &&
      governanceMismatchBody.lifecycle.retired_summary_ids.length >= 1,
    "second governance run should retire superseded summaries"
  );
  assert.ok(
    Array.isArray(governanceMismatchBody.lifecycle.retired_snapshot_ids) &&
      governanceMismatchBody.lifecycle.retired_snapshot_ids.length >= 1,
    "second governance run should retire superseded resident snapshots"
  );
  assert.ok(
    Array.isArray(governanceMismatchBody.lifecycle.stale_index_ids) &&
      governanceMismatchBody.lifecycle.stale_index_ids.length >= 1,
    "mismatch governance should clean stale index entries"
  );
  assert.ok(
    Array.isArray(governanceMismatchBody.lifecycle.skill_change_proposal_ids) &&
      governanceMismatchBody.lifecycle.skill_change_proposal_ids.length >= 1,
    "mismatch governance should propose fingerprint-drifted skill changes instead of auto-downgrading"
  );
  const skillStillActiveBeforeApproval = await pool.query(
    `
    SELECT COUNT(*)::int AS count
    FROM skill
    WHERE tenant_id = $1
      AND scope = $2
      AND fingerprint_requirement = $3
      AND status = 'active'
    `,
    [tenantId, scope, fingerprint]
  );
  assert.ok(skillStillActiveBeforeApproval.rows[0].count >= 1, "fingerprint-drifted skills must stay active before human approval");
  assert.ok(
    Array.isArray(governanceMismatchBody.zombie_state_ids) &&
      governanceMismatchBody.zombie_state_ids.length >= 1,
    "mismatch governance should park stale index entries as zombie states"
  );
  assert.ok(
    Array.isArray(governanceMismatchBody.reconciliation_item_ids) &&
      governanceMismatchBody.reconciliation_item_ids.length >= 1,
    "mismatch governance should create reconciliation items"
  );

  const taskRunCheck = await pool.query("SELECT COUNT(*)::int AS count FROM task_run WHERE task_request_id = $1", [taskRequestId]);
  assert.equal(taskRunCheck.rows[0].count, 1, "task_request should project to exactly one task_run");
  baselines.task_request_projects_task_run = true;

  const artifactCheck = await pool.query("SELECT COUNT(*)::int AS count FROM artifact WHERE task_request_id = $1", [taskRequestId]);
  assert.ok(artifactCheck.rows[0].count >= 3, "artifacts should capture planner, dispatch and verification evidence");
  baselines.artifact_evidence_persisted = true;
  const accessLogCheck = await pool.query(
    "SELECT COUNT(*)::int AS count FROM memory_access_log WHERE tenant_id = $1 AND scope = $2",
    [tenantId, scope]
  );
  assert.ok(accessLogCheck.rows[0].count >= 8, "memory access log should capture query, retrieve and governance activity");
  const ruleCheck = await pool.query(
    "SELECT COUNT(*)::int AS count FROM rule WHERE tenant_id = $1 AND scope = $2 AND rule_key = 'verify-workspace-constraint' AND status = 'active'",
    [tenantId, scope]
  );
  assert.equal(ruleCheck.rows[0].count, 1, "verified constraints should be stored in rule, not factual memory");
  const ruleSupersedeCheck = await pool.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE status = 'active')::int AS active_count,
      COUNT(*) FILTER (WHERE status IN ('superseded', 'retired'))::int AS inactive_old_count
    FROM rule
    WHERE tenant_id = $1
      AND scope = $2
      AND rule_key = 'verify-workspace-constraint'
    `,
    [tenantId, scope]
  );
  assert.equal(ruleSupersedeCheck.rows[0].active_count, 1, "rule updates should leave exactly one active rule version");
  assert.equal(ruleSupersedeCheck.rows[0].inactive_old_count, 0, "rule updates must not supersede old versions before human approval");
  const pendingReplaceProposal = await pool.query(
    `
    SELECT id
    FROM governance_change_proposal
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'recorded'
      AND proposed_action = 'replace_rule'
      AND proposed_payload ->> 'rule_key' = 'verify-workspace-constraint'
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [tenantId, scope]
  );
  assert.ok(pendingReplaceProposal.rows[0]?.id, "rule replacement proposal should wait for human approval");
  const ruleProposalCheck = await pool.query(
    `
    SELECT proposed_action, COUNT(*)::int AS count
    FROM governance_change_proposal
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'recorded'
      AND proposed_action IN ('replace_rule', 'create_conflicting_rule')
    GROUP BY proposed_action
    `,
    [tenantId, scope]
  );
  const proposalCounts = Object.fromEntries(ruleProposalCheck.rows.map((row) => [row.proposed_action, row.count]));
  assert.ok((proposalCounts.replace_rule ?? 0) >= 1, "rule updates should create human-review change proposals");
  assert.ok((proposalCounts.create_conflicting_rule ?? 0) >= 1, "conflicting rules should create human-review change proposals");
  const proposalList = await memoryService.inject({
    method: "GET",
    url: "/internal/governance/change-proposals?status=recorded",
    headers: buildHeaders("governance-change-proposals")
  });
  assert.equal(proposalList.statusCode, 200, "governance change proposal list failed");
  assert.ok(proposalList.json().items.length >= 2, "proposal list should include pending rule changes");
  const pendingMemoryReplaceProposal = await pool.query(
    `
    SELECT id
    FROM governance_change_proposal
    WHERE tenant_id = $1
      AND scope = $2
      AND status = 'recorded'
      AND proposed_action = 'replace_memory'
      AND proposed_payload ->> 'title' = 'Support environment endpoint'
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [tenantId, scope]
  );
  assert.ok(pendingMemoryReplaceProposal.rows[0]?.id, "factual memory updates should wait for human approval");
  const approveProposal = await memoryService.inject({
    method: "POST",
    url: `/internal/governance/change-proposals/${pendingReplaceProposal.rows[0].id}/actions`,
    headers: buildHeaders("governance-change-proposal-approve"),
    payload: {
      action: "approve",
      fingerprint,
      payload: {
        approved_by: "verify-memory-system"
      }
    }
  });
  assert.equal(approveProposal.statusCode, 200, "governance change proposal approve failed");
  assert.ok(approveProposal.json().rebuilt_snapshot_id, "approving a governance change should rebuild resident snapshot");
  assert.ok(approveProposal.json().index_sync, "approving a governance change should sync the retrieval index");
  const approvedRuleCheck = await pool.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE status = 'active')::int AS active_count,
      COUNT(*) FILTER (WHERE status IN ('superseded', 'retired'))::int AS inactive_old_count,
      MAX(statement) FILTER (WHERE status = 'active') AS active_statement
    FROM rule
    WHERE tenant_id = $1
      AND scope = $2
      AND rule_key = 'verify-workspace-constraint'
    `,
    [tenantId, scope]
  );
  assert.equal(approvedRuleCheck.rows[0].active_count, 1, "approved rule replacement should leave exactly one active version");
  assert.ok(approvedRuleCheck.rows[0].inactive_old_count >= 1, "approved rule replacement should supersede the old active version");
  assert.ok(
    String(approvedRuleCheck.rows[0].active_statement ?? "").includes("moving shared repositories"),
    "approved rule replacement should apply the proposed statement"
  );
  const approveMemoryProposal = await memoryService.inject({
    method: "POST",
    url: `/internal/governance/change-proposals/${pendingMemoryReplaceProposal.rows[0].id}/actions`,
    headers: buildHeaders("governance-change-memory-approve"),
    payload: {
      action: "approve",
      fingerprint,
      payload: {
        approved_by: "verify-memory-system"
      }
    }
  });
  assert.equal(approveMemoryProposal.statusCode, 200, "factual memory replacement approve failed");
  assert.ok(approveMemoryProposal.json().rebuilt_snapshot_id, "approved memory replacement should rebuild resident snapshot");
  const approvedMemoryCheck = await pool.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE status = 'active')::int AS active_count,
      COUNT(*) FILTER (WHERE status IN ('superseded', 'retired'))::int AS inactive_old_count,
      MAX(content) FILTER (WHERE status = 'active') AS active_content
    FROM memory
    WHERE tenant_id = $1
      AND scope = $2
      AND title = 'Support environment endpoint'
    `,
    [tenantId, scope]
  );
  assert.equal(approvedMemoryCheck.rows[0].active_count, 1, "approved memory replacement should leave exactly one active version");
  assert.ok(approvedMemoryCheck.rows[0].inactive_old_count >= 1, "approved memory replacement should supersede the old active version");
  assert.ok(
    String(approvedMemoryCheck.rows[0].active_content ?? "").includes("monitored"),
    "approved memory replacement should apply the proposed content"
  );
  const conflictingRuleCheck = await pool.query(
    `
    SELECT COUNT(*)::int AS count
    FROM rule
    WHERE tenant_id = $1
      AND scope = $2
      AND rule_key = 'verify-workspace-conflicting-constraint'
    `,
    [tenantId, scope]
  );
  assert.equal(conflictingRuleCheck.rows[0].count, 0, "conflicting rules must not become active before human approval");
  const constraintMemoryCheck = await pool.query(
    "SELECT COUNT(*)::int AS count FROM memory WHERE tenant_id = $1 AND scope = $2 AND tags @> ARRAY['project_constraint']::text[] AND status = 'active'",
    [tenantId, scope]
  );
  assert.equal(constraintMemoryCheck.rows[0].count, 0, "project_constraint must not be stored as factual memory");
  const taskAttemptCheck = await pool.query(
    "SELECT COUNT(*)::int AS count FROM task_attempt WHERE task_request_id = $1 AND task_step_id = $2",
    [taskRequestId, effectfulStep.id]
  );
  assert.ok(taskAttemptCheck.rows[0].count >= 1, "dispatch should persist task_attempt records");
  const driftCheck = await pool.query(
    "SELECT COUNT(*)::int AS count FROM drift_check_result WHERE task_request_id = $1 AND task_step_id = $2",
    [taskRequestId, effectfulStep.id]
  );
  assert.ok(driftCheck.rows[0].count >= 1, "governance should persist drift_check_result records");
  const reconciliationCheck = await pool.query(
    "SELECT COUNT(*)::int AS count FROM reconciliation_item WHERE task_request_id = $1 AND task_step_id = $2",
    [taskRequestId, effectfulStep.id]
  );
  assert.ok(reconciliationCheck.rows[0].count >= 1, "governance should persist reconciliation_item records");
  const zombieCheck = await pool.query(
    "SELECT COUNT(*)::int AS count FROM zombie_state WHERE task_request_id = $1 AND task_step_id = $2",
    [taskRequestId, effectfulStep.id]
  );
  assert.ok(zombieCheck.rows[0].count >= 1, "governance should persist zombie_state records");
  const approveSkillDriftProposal = await memoryService.inject({
    method: "POST",
    url: `/internal/governance/change-proposals/${governanceMismatchBody.lifecycle.skill_change_proposal_ids[0]}/actions`,
    headers: buildHeaders("governance-change-skill-approve"),
    payload: {
      action: "approve",
      fingerprint: "wrong-fingerprint",
      payload: {
        approved_by: "verify-memory-system"
      }
    }
  });
  assert.equal(approveSkillDriftProposal.statusCode, 200, "skill drift proposal approve failed");
  assert.ok(approveSkillDriftProposal.json().index_sync, "approved skill drift change should sync the retrieval index");
  const approvedSkillDriftCheck = await pool.query(
    `
    SELECT COUNT(*)::int AS count
    FROM skill
    WHERE tenant_id = $1
      AND scope = $2
      AND fingerprint_requirement = $3
      AND status = 'dirty'
    `,
    [tenantId, scope, fingerprint]
  );
  assert.ok(approvedSkillDriftCheck.rows[0].count >= 1, "approved fingerprint drift should mark the skill dirty");

  console.log(
    JSON.stringify(
      {
        single_tenant_mode: true,
        tenant_id: tenantId,
        scope,
        summary_count: summaryQueryBody.items.length,
        candidate_count: candidateQueryBody.items.length,
        factual_memory_count: matchedRetrieveBody.factual_memory.length,
        procedural_match_count: matchedRetrieveBody.procedural_memory.length,
        procedural_mismatch_count: mismatchedRetrieveBody.procedural_memory.length,
        rebuilt_snapshot_id: governanceBody.rebuilt_snapshot_id,
        retired_summary_count: governanceMismatchBody.lifecycle.retired_summary_ids.length,
        stale_index_count: governanceMismatchBody.lifecycle.stale_index_ids.length,
        access_log_count: accessLogCheck.rows[0].count,
        task_attempt_count: taskAttemptCheck.rows[0].count,
        drift_check_count: driftCheck.rows[0].count,
        reconciliation_item_count: reconciliationCheck.rows[0].count,
        zombie_state_count: zombieCheck.rows[0].count,
        procedural_persist_target: proceduralCandidateBody.persist_target,
        mismatch_persist_target: mismatchCandidateBody.persist_target,
        acceptance_baselines: baselines
      },
      null,
      2
    )
  );
} finally {
  await Promise.all([taskOrchestrator.close(), verificationService.close(), memoryService.close(), pool.end()]);
}
