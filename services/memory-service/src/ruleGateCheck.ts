import { createRuleGateAudit, ensureTaskRequestForExternalGate, queryRuleGateCheckpoints } from "@super-agent/db";

type RuleGateCheckBody = {
  task_request_id: string;
  task_step_id?: string | null;
  task_type?: string | null;
  host?: string | null;
  project_ref?: string | null;
  operation: string;
  checkpoint_keys?: string[] | null;
  evidence?: Record<string, unknown> | null;
  actor_ref?: string | null;
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function hasEvidence(evidence: Record<string, unknown>, key: string): boolean {
  const value = evidence[key];
  if (value === undefined || value === null || value === false) {
    return false;
  }
  if (typeof value === "string" && value.trim().length === 0) {
    return false;
  }
  if (Array.isArray(value) && value.length === 0) {
    return false;
  }
  return true;
}

function classifyDecision(input: { failureBehavior: string; missingEvidence: string[] }): "allow" | "warn" | "ask_user" | "block" {
  if (input.missingEvidence.length === 0) {
    return "allow";
  }
  if (input.failureBehavior === "warn_and_continue") {
    return "warn";
  }
  if (input.failureBehavior === "ask_user") {
    return "ask_user";
  }
  return "block";
}

export async function handleRuleGateCheck(input: {
  tenantId: string;
  scope: string;
  traceId: string;
  body: RuleGateCheckBody;
}) {
  const evidence = input.body.evidence ?? {};
  await ensureTaskRequestForExternalGate({
    tenantId: input.tenantId,
    scope: input.scope,
    taskRequestId: input.body.task_request_id,
    taskType: input.body.task_type ?? null,
    host: input.body.host ?? null,
    projectRef: input.body.project_ref ?? null,
    operation: input.body.operation,
    actorRef: input.body.actor_ref ?? null,
    traceId: input.traceId
  });
  const checkpoints = await queryRuleGateCheckpoints({
    tenantId: input.tenantId,
    scope: input.scope,
    taskType: input.body.task_type ?? null,
    host: input.body.host ?? null,
    projectRef: input.body.project_ref ?? null,
    operation: input.body.operation,
    checkpointKeys: input.body.checkpoint_keys ?? null
  });

  const checkpointDecisions = checkpoints.map((checkpoint) => {
    const evidenceRequired = asStringArray(checkpoint.evidence_required);
    const missingEvidence = evidenceRequired.filter((key) => !hasEvidence(evidence, key));
    const failureBehavior = String(checkpoint.failure_behavior ?? "block_and_report");
    const decision = classifyDecision({ failureBehavior, missingEvidence });
    return {
      checkpoint_id: checkpoint.id,
      checkpoint_key: checkpoint.checkpoint_key,
      rule_id: checkpoint.rule_id,
      rule_key: checkpoint.rule_key,
      operation: checkpoint.operation,
      phase: checkpoint.checkpoint_phase,
      requirement: checkpoint.requirement,
      evidence_required: evidenceRequired,
      missing_evidence: missingEvidence,
      failure_behavior: failureBehavior,
      decision,
      reason:
        missingEvidence.length > 0
          ? `Missing required evidence: ${missingEvidence.join(", ")}`
          : "Required evidence is present."
    };
  });

  const hasBlock = checkpointDecisions.some((item) => item.decision === "block");
  const needsUser = checkpointDecisions.some((item) => item.decision === "ask_user");
  const hasWarn = checkpointDecisions.some((item) => item.decision === "warn");
  const overallDecision = hasBlock ? "block" : needsUser ? "ask_user" : hasWarn ? "warn" : "allow";
  const allowed = overallDecision === "allow" || overallDecision === "warn";

  const auditIds = await Promise.all(
    checkpointDecisions.map((item) =>
      createRuleGateAudit({
        tenantId: input.tenantId,
        scope: input.scope,
        taskRequestId: input.body.task_request_id,
        taskStepId: input.body.task_step_id ?? null,
        ruleId: item.rule_id ? String(item.rule_id) : null,
        checkpointId: item.checkpoint_id ? String(item.checkpoint_id) : null,
        gateKey: String(item.checkpoint_key ?? input.body.operation),
        operation: input.body.operation,
        decision: String(item.decision),
        evidence,
        reason: item.reason,
        actorRef: input.body.actor_ref ?? null,
        traceId: input.traceId
      })
    )
  );

  if (checkpointDecisions.length === 0) {
    auditIds.push(
      await createRuleGateAudit({
        tenantId: input.tenantId,
        scope: input.scope,
        taskRequestId: input.body.task_request_id,
        taskStepId: input.body.task_step_id ?? null,
        gateKey: input.body.operation,
        operation: input.body.operation,
        decision: "allow",
        evidence,
        reason: "No active rule checkpoint matched this operation.",
        actorRef: input.body.actor_ref ?? null,
        traceId: input.traceId
      })
    );
  }

  return {
    allowed,
    decision: overallDecision,
    operation: input.body.operation,
    matched_checkpoint_count: checkpointDecisions.length,
    checkpoints: checkpointDecisions,
    audit_ids: auditIds,
    rule_hotplug_note: "Rule/binding status is read at check time, so enabling or disabling packs affects the next gate check."
  };
}
