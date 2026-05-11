import {
  listActiveFactualMemory,
  listActiveRules,
  listActiveSkills,
  listGovernanceChangeProposals,
  queryActiveDerivedKnowledge,
  replaceResidentSnapshot
} from "@super-agent/db";

export class ResidentMemoryBuilder {
  async rebuild(input: {
    tenantId: string;
    scope: string;
    fingerprint?: string | null;
    dirtyReason?: string | null;
    traceId: string;
  }): Promise<string | null> {
    const [memoryRows, ruleRows, skillRows, knowledgeRows, proposalRows] = await Promise.all([
      listActiveFactualMemory({ tenantId: input.tenantId, scope: input.scope }),
      listActiveRules({ tenantId: input.tenantId, scope: input.scope }),
      listActiveSkills({ tenantId: input.tenantId, scope: input.scope, fingerprint: input.fingerprint }),
      queryActiveDerivedKnowledge({ tenantId: input.tenantId, scope: input.scope, limit: 5 }),
      listGovernanceChangeProposals({ tenantId: input.tenantId, scope: input.scope, status: "recorded", limit: 50 })
    ]);

    const skillProposalRows = proposalRows
      .filter((row) => row.target_object_type === "skill")
      .slice(0, 5)
      .map((row) => ({
        id: row.id,
        proposed_action: row.proposed_action,
        reason: row.reason,
        target_object_id: row.target_object_id,
        proposed_payload: row.proposed_payload
      }));

    const ruleProposalRows = proposalRows
      .filter((row) => row.target_object_type === "rule")
      .slice(0, 5)
      .map((row) => ({
        id: row.id,
        proposed_action: row.proposed_action,
        reason: row.reason,
        target_object_id: row.target_object_id,
        proposed_payload: row.proposed_payload
      }));

    if (memoryRows.length === 0 && ruleRows.length === 0 && skillRows.length === 0 && knowledgeRows.length === 0 && proposalRows.length === 0) {
      return null;
    }

    return replaceResidentSnapshot({
      tenantId: input.tenantId,
      scope: input.scope,
      snapshotKey: "memory-validation-resident",
      snapshotPayload: {
        memory: memoryRows.slice(0, 3).map((row) => ({
          id: row.id,
          title: row.title,
          content: row.content
        })),
        rules: ruleRows.slice(0, 5).map((row) => ({
          id: row.id,
          rule_key: row.rule_key,
          rule_type: row.rule_type,
          statement: row.statement,
          enforcement_level: row.enforcement_level
        })),
        skills: skillRows.slice(0, 3).map((row) => ({
          id: row.id,
          skill_key: row.skill_key,
          description: row.description
        })),
        knowledge: knowledgeRows.slice(0, 5).map((row) => ({
          id: row.id,
          title: row.title,
          knowledge_type: row.knowledge_type,
          content: row.content,
          confidence_score: row.confidence_score,
          recall_state: row.recall_state
        })),
        skill_proposals: skillProposalRows,
        rule_proposals: ruleProposalRows,
        factual_highlights: memoryRows.slice(0, 3).map((row) => ({
          id: row.id,
          title: row.title,
          content: row.content
        })),
        procedural_highlights: skillRows.slice(0, 3).map((row) => ({
          id: row.id,
          skill_key: row.skill_key,
          description: row.description
        })),
        knowledge_highlights: knowledgeRows.slice(0, 5).map((row) => ({
          id: row.id,
          title: row.title,
          knowledge_type: row.knowledge_type,
          content: row.content
        })),
        fingerprint: input.fingerprint ?? null
      },
      sourceMemoryIds: memoryRows.map((row) => String(row.id)),
      sourceSkillIds: skillRows.map((row) => String(row.id)),
      dirtyReason: input.dirtyReason ?? null,
      traceId: input.traceId
    });
  }
}
