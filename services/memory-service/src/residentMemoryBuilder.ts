import { listActiveFactualMemory, listActiveRules, listActiveSkills, replaceResidentSnapshot } from "@super-agent/db";

export class ResidentMemoryBuilder {
  async rebuild(input: {
    tenantId: string;
    scope: string;
    fingerprint?: string | null;
    dirtyReason?: string | null;
    traceId: string;
  }): Promise<string | null> {
    const [memoryRows, ruleRows, skillRows] = await Promise.all([
      listActiveFactualMemory({ tenantId: input.tenantId, scope: input.scope }),
      listActiveRules({ tenantId: input.tenantId, scope: input.scope }),
      listActiveSkills({ tenantId: input.tenantId, scope: input.scope, fingerprint: input.fingerprint })
    ]);

    if (memoryRows.length === 0 && ruleRows.length === 0 && skillRows.length === 0) {
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
        fingerprint: input.fingerprint ?? null
      },
      sourceMemoryIds: memoryRows.map((row) => String(row.id)),
      sourceSkillIds: skillRows.map((row) => String(row.id)),
      dirtyReason: input.dirtyReason ?? null,
      traceId: input.traceId
    });
  }
}
