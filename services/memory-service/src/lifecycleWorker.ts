import {
  downgradeSkillsOnFingerprintDrift,
  governRuleConflicts,
  rebuildDirtyResidentSnapshots,
  retireSupersededConversationSummaries,
  retireSupersededMemory,
  retireSupersededRules,
  retireSupersededResidentSnapshots,
  retireSupersededSkills
} from "@super-agent/db";

export class LifecycleWorker {
  async run(input: {
    tenantId: string;
    scope: string;
    fingerprint?: string | null;
    traceId: string;
    staleIndexIds?: string[];
  }) {
    const [
      downgradedSkillIds,
      retiredMemoryIds,
      retiredRuleIds,
      retiredSkillIds,
      retiredSummaryIds,
      retiredSnapshotIds,
      rebuildingSnapshotIds
    ] = await Promise.all([
      downgradeSkillsOnFingerprintDrift({
        tenantId: input.tenantId,
        scope: input.scope,
        fingerprint: input.fingerprint,
        traceId: input.traceId
      }),
      retireSupersededMemory(),
      retireSupersededRules(),
      retireSupersededSkills(),
      retireSupersededConversationSummaries(),
      retireSupersededResidentSnapshots(),
      rebuildDirtyResidentSnapshots({
        tenantId: input.tenantId,
        scope: input.scope,
        traceId: input.traceId
      })
    ]);
    const ruleConflictIds = await governRuleConflicts({
      tenantId: input.tenantId,
      scope: input.scope,
      traceId: input.traceId
    });

    return {
      downgraded_skill_ids: [],
      skill_change_proposal_ids: downgradedSkillIds,
      retired_memory_ids: retiredMemoryIds,
      retired_rule_ids: retiredRuleIds,
      retired_skill_ids: retiredSkillIds,
      rule_conflict_ids: ruleConflictIds,
      retired_summary_ids: retiredSummaryIds,
      retired_snapshot_ids: retiredSnapshotIds,
      rebuilding_snapshot_ids: rebuildingSnapshotIds,
      stale_index_ids: input.staleIndexIds ?? []
    };
  }
}
