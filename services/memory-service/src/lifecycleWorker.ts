import {
  archiveStaleSynthesizedKnowledge,
  downgradeSkillsOnFingerprintDrift,
  governRuleConflicts,
  rebuildDirtyResidentSnapshots,
  recomputeImportanceWeights,
  retireSupersededConversationSummaries,
  retireSupersededMemory,
  retireSupersededRules,
  retireSupersededResidentSnapshots,
  retireSupersededSkills
} from "@super-agent/db";
import { calibrateL2Thresholds } from "./governance/L2ThresholdCalibrator.js";
import { invalidateL2ThresholdCache } from "./governance/L2ConflictDetector.js";

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

    // ─── fix-8-3: 遗忘机制（加权衰减 + 归档保护）───
    // 步骤 1: 先重算 importance_weight（recency × frequency × utility 三因子加权）
    //   数据不足时（session_outcomes < 300）全写 0.5（降级模式，不惩罚新知识）
    const reweightResult = await recomputeImportanceWeights({
      tenantId: input.tenantId,
      scope: input.scope
    });

    // 步骤 2: 归档 importance_weight < 0.2 持续 30 天的知识
    //   归档保护：同 scope 最近 30 天平均 term_hit_ratio < 0.4 时跳过归档
    //   这是 retrieve 的锅，不是知识的锅
    const archiveResult = await archiveStaleSynthesizedKnowledge({
      tenantId: input.tenantId,
      scope: input.scope,
    });

    // fix-7 阈值自适应：从 session_outcomes 反推 L2 阈值校准
    // 被 failure_recovered / success 对话的相似度分布驱动，不再用拍脑袋的常数
    // 样本数不足时跳过（保留默认值），校准成功后清 L2 阈值缓存让下次 detectConflicts 读新值
    let thresholdCalibration: { calibrated: boolean; reason?: string; thresholds?: unknown[] } | null = null;
    try {
      thresholdCalibration = await calibrateL2Thresholds({
        tenantId: input.tenantId,
        scope: input.scope,
        traceId: input.traceId
      });
      if (thresholdCalibration.calibrated) {
        invalidateL2ThresholdCache(input.tenantId, input.scope);
      }
    } catch {
      // 校准失败不阻塞 lifecycle 主流程
      thresholdCalibration = null;
    }

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
      stale_index_ids: input.staleIndexIds ?? [],
      // fix-8-3 遗忘机制返回值
      reweighted_knowledge_count: reweightResult.reweightedCount,
      reweight_degraded: reweightResult.degraded,
      reweight_reason: reweightResult.reason,
      archived_stale_knowledge_count: archiveResult.archivedCount,
      archive_skipped_count: archiveResult.skippedCount,
      archive_skipped_reason: archiveResult.skippedReason,
      threshold_calibration: thresholdCalibration
    };
  }
}
