import { listPendingHostActions, updateHostActionStatus } from "@super-agent/db";

export type HostActionItem = {
  object_type: "rule" | "skill";
  id: string;
  key: string;
  title: string;
  scope: string;
  host_action: Record<string, unknown>;
  invoke_skill: {
    type: "invoke_skill";
    skill: string;
    payload: Record<string, unknown>;
  };
};

function buildRulePayload(rule: Record<string, unknown>): Record<string, unknown> {
  const ruleKey = rule.rule_key ?? rule.key;
  return {
    rule_id: rule.id,
    rule_key: ruleKey,
    title: rule.title,
    statement: rule.statement,
    enforcement_level: rule.enforcement_level,
    trigger_conditions: rule.trigger_conditions,
    applies_to: rule.applies_to,
    risk_level: rule.risk_level,
    priority: rule.priority,
    origin_scope: rule.origin_scope ?? "session",
    availability_scope: rule.availability_scope ?? "session_only",
    host_context: {
      project_id: rule.scope,
      project_root: null
    }
  };
}

function buildSkillPayload(skill: Record<string, unknown>): Record<string, unknown> {
  return {
    skill_record: skill,
    host_context: {
      project_id: skill.scope,
      project_root: null,
      global_skills_dir: ".trae/skills"
    }
  };
}

export async function fetchPendingHostActions(input: {
  tenantId: string;
  scope?: string | null;
  projectId?: string | null;
  objectType?: "rule" | "skill" | "all";
  limit?: number;
}): Promise<HostActionItem[]> {
  const raw = await listPendingHostActions({
    tenantId: input.tenantId,
    scope: null,
    projectId: input.projectId,
    objectType: input.objectType ?? "all",
    limit: input.limit ?? 100
  });

  return raw.map((item) => {
    const objectType = item.object_type as "rule" | "skill";
    const hostAction = (item.host_action as Record<string, unknown>) ?? {};
    const skill = hostAction.skill as string | undefined;

    return {
      object_type: objectType,
      id: String(item.id),
      key: String(item.key ?? ""),
      title: String(item.title ?? ""),
      scope: String(item.scope ?? ""),
      host_action: hostAction,
      invoke_skill: {
        type: "invoke_skill",
        skill: skill ?? (objectType === "rule" ? "gate-master" : "skill-creator"),
        payload: objectType === "rule" ? buildRulePayload(item) : buildSkillPayload(item)
      }
    };
  });
}

export async function markHostActionStatus(input: {
  tenantId: string;
  objectType: "rule" | "skill";
  objectId: string;
  status: "pending" | "generated" | "done" | "failed";
  error?: string | null;
  summary?: string | null;
  traceId: string;
}): Promise<boolean> {
  return updateHostActionStatus({
    tenantId: input.tenantId,
    objectType: input.objectType,
    objectId: input.objectId,
    status: input.status,
    error: input.error ?? null,
    summary: input.summary ?? null,
    traceId: input.traceId
  });
}
