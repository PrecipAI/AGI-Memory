import {
  queryOutcomeRetrievedContents,
  upsertThresholdCalibration
} from "@super-agent/db";
import { jaccardSimilarity } from "./L2ConflictDetector.js";

// ─── fix-7 阈值自适应：从 session_outcomes 反推 L2 阈值校准 ───
//
// 用户原话：
//   "被标记为 failure_recovered 的对话里，retrieve 到的相似知识的分布是什么？
//    这个分布就是阈值应该在的位置，不是拍脑袋决定的常数。"
//
// 算法：
//   1. 从 session_outcomes 拉 outcome + task_description + retrieved content
//   2. 对每条 (task_description, retrieved_content) 算 jaccard 相似度
//   3. 按 outcome 分组，算 P25/P50/P95
//   4. 反推三个阈值：
//      - SIMILARITY_TRIGGER ≤ failure_recovered 组 P25（让"接近但需纠正"的能进 L2 检测）
//      - DUPLICATE_THRESHOLD > success 组 P95（避免把"刚好够用"的判为重复 SKIP）
//      - JACCARD_DUPLICATE_THRESHOLD = DUPLICATE_THRESHOLD（校准后统一）
//
// 边界处理：
//   - 样本数 < 20：不校准，保留默认值（数据不足以反推）
//   - 某组无数据：跳过该阈值
//   - 推荐值越界：clamp 到合理区间
//
// applied_value 策略：
//   不是直接用 recommended_value 覆盖，而是用 0.5 混合（避免极端校准导致 L2 行为突变）
//   applied = default * 0.5 + recommended * 0.5
//   这让校准有影响但不会让阈值剧烈跳变——稳定性优先

const DEFAULT_SIMILARITY_TRIGGER = 0.50;
const DEFAULT_DUPLICATE_THRESHOLD = 0.96;
const DEFAULT_JACCARD_DUPLICATE_THRESHOLD = 0.80;

const MIN_SAMPLE_SIZE = 20;

// 阈值合理区间（防止校准到不合理值）
const BOUNDS = {
  similarity_trigger: { min: 0.2, max: 0.7 },
  duplicate_threshold: { min: 0.7, max: 0.99 },
  jaccard_duplicate_threshold: { min: 0.5, max: 0.95 }
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const idx = Math.min(sortedValues.length - 1, Math.floor((p / 100) * (sortedValues.length - 1)));
  return sortedValues[idx];
}

type OutcomeGroup = {
  outcome: string;
  similarities: number[];
  p25: number;
  p50: number;
  p95: number;
  count: number;
};

function groupByOutcome(rows: Array<{
  outcome: string;
  task_description: string;
  content: string;
}>): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.task_description || !row.content) continue;
    const sim = jaccardSimilarity(row.task_description, row.content);
    if (!groups.has(row.outcome)) {
      groups.set(row.outcome, []);
    }
    groups.get(row.outcome)!.push(sim);
  }
  return groups;
}

function computeGroupStats(similarities: number[]): {
  p25: number;
  p50: number;
  p95: number;
  count: number;
} {
  const sorted = [...similarities].sort((a, b) => a - b);
  return {
    p25: percentile(sorted, 25),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    count: sorted.length
  };
}

export async function calibrateL2Thresholds(input: {
  tenantId: string;
  scope: string;
  traceId: string;
}): Promise<{
  calibrated: boolean;
  reason?: string;
  thresholds?: Array<{
    threshold_name: string;
    recommended_value: number;
    default_value: number;
    applied_value: number;
    sample_size: number;
    basis_outcome: string;
  }>;
}> {
  const rows = await queryOutcomeRetrievedContents({
    tenantId: input.tenantId,
    scope: input.scope,
    limit: 200
  });

  if (rows.length < MIN_SAMPLE_SIZE) {
    return {
      calibrated: false,
      reason: `样本数不足（${rows.length} < ${MIN_SAMPLE_SIZE}），保留默认阈值。建议等 session_outcomes 累积到 ${MIN_SAMPLE_SIZE}+ 条再校准。`
    };
  }

  const grouped = groupByOutcome(rows);
  const outcomeGroups: OutcomeGroup[] = [];
  for (const [outcome, sims] of grouped) {
    const stats = computeGroupStats(sims);
    outcomeGroups.push({ outcome, similarities: sims, ...stats });
  }

  const successGroup = outcomeGroups.find((g) => g.outcome === "success");
  const failureRecoveredGroup = outcomeGroups.find((g) => g.outcome === "failure_recovered");
  const failureGroup = outcomeGroups.find((g) => g.outcome === "failure");

  const results: Array<{
    threshold_name: string;
    recommended_value: number;
    default_value: number;
    applied_value: number;
    sample_size: number;
    basis_outcome: string;
    distribution_p25?: number;
    distribution_p50?: number;
    distribution_p95?: number;
    rationale: string;
  }> = [];

  // ─── 1. SIMILARITY_TRIGGER ───
  // 阈值应 ≤ failure_recovered 组 P25，让"接近但需纠正"的能进 L2 检测
  // 如果没有 failure_recovered 数据，用 failure 组 P50（更宽松）
  if (failureRecoveredGroup && failureRecoveredGroup.count >= 5) {
    const recommended = clamp(
      failureRecoveredGroup.p25,
      BOUNDS.similarity_trigger.min,
      BOUNDS.similarity_trigger.max
    );
    const applied = clamp(
      DEFAULT_SIMILARITY_TRIGGER * 0.5 + recommended * 0.5,
      BOUNDS.similarity_trigger.min,
      BOUNDS.similarity_trigger.max
    );
    results.push({
      threshold_name: "similarity_trigger",
      recommended_value: Number(recommended.toFixed(4)),
      default_value: DEFAULT_SIMILARITY_TRIGGER,
      applied_value: Number(applied.toFixed(4)),
      sample_size: failureRecoveredGroup.count,
      basis_outcome: "failure_recovered",
      distribution_p25: Number(failureRecoveredGroup.p25.toFixed(4)),
      distribution_p50: Number(failureRecoveredGroup.p50.toFixed(4)),
      distribution_p95: Number(failureRecoveredGroup.p95.toFixed(4)),
      rationale: `SIMILARITY_TRIGGER ≤ failure_recovered 组 P25 (${failureRecoveredGroup.p25.toFixed(4)})，让"接近但需纠正"的能进入 L2 检测而非被门槛挡掉。applied = default*0.5 + recommended*0.5（混合策略避免突变）。`
    });
  } else if (failureGroup && failureGroup.count >= 5) {
    const recommended = clamp(
      failureGroup.p50,
      BOUNDS.similarity_trigger.min,
      BOUNDS.similarity_trigger.max
    );
    const applied = clamp(
      DEFAULT_SIMILARITY_TRIGGER * 0.5 + recommended * 0.5,
      BOUNDS.similarity_trigger.min,
      BOUNDS.similarity_trigger.max
    );
    results.push({
      threshold_name: "similarity_trigger",
      recommended_value: Number(recommended.toFixed(4)),
      default_value: DEFAULT_SIMILARITY_TRIGGER,
      applied_value: Number(applied.toFixed(4)),
      sample_size: failureGroup.count,
      basis_outcome: "failure",
      distribution_p25: Number(failureGroup.p25.toFixed(4)),
      distribution_p50: Number(failureGroup.p50.toFixed(4)),
      distribution_p95: Number(failureGroup.p95.toFixed(4)),
      rationale: `无 failure_recovered 数据，降级用 failure 组 P50 (${failureGroup.p50.toFixed(4)})。`
    });
  }

  // ─── 2. DUPLICATE_THRESHOLD ───
  // 阈值应 > success 组 P95，避免把"刚好够用"的判为重复 SKIP
  if (successGroup && successGroup.count >= 5) {
    const recommended = clamp(
      successGroup.p95 + 0.02,
      BOUNDS.duplicate_threshold.min,
      BOUNDS.duplicate_threshold.max
    );
    const applied = clamp(
      DEFAULT_DUPLICATE_THRESHOLD * 0.5 + recommended * 0.5,
      BOUNDS.duplicate_threshold.min,
      BOUNDS.duplicate_threshold.max
    );
    results.push({
      threshold_name: "duplicate_threshold",
      recommended_value: Number(recommended.toFixed(4)),
      default_value: DEFAULT_DUPLICATE_THRESHOLD,
      applied_value: Number(applied.toFixed(4)),
      sample_size: successGroup.count,
      basis_outcome: "success",
      distribution_p25: Number(successGroup.p25.toFixed(4)),
      distribution_p50: Number(successGroup.p50.toFixed(4)),
      distribution_p95: Number(successGroup.p95.toFixed(4)),
      rationale: `DUPLICATE_THRESHOLD > success 组 P95 + 0.02 (${successGroup.p95.toFixed(4)} + 0.02)，避免把"刚好够用"的成功知识判为重复而 SKIP。`
    });
  }

  // ─── 3. JACCARD_DUPLICATE_THRESHOLD ───
  // 跟 DUPLICATE_THRESHOLD 保持一致（校准后统一）
  const dupResult = results.find((r) => r.threshold_name === "duplicate_threshold");
  if (dupResult) {
    const recommended = clamp(
      dupResult.recommended_value,
      BOUNDS.jaccard_duplicate_threshold.min,
      BOUNDS.jaccard_duplicate_threshold.max
    );
    const applied = clamp(
      DEFAULT_JACCARD_DUPLICATE_THRESHOLD * 0.5 + recommended * 0.5,
      BOUNDS.jaccard_duplicate_threshold.min,
      BOUNDS.jaccard_duplicate_threshold.max
    );
    results.push({
      threshold_name: "jaccard_duplicate_threshold",
      recommended_value: Number(recommended.toFixed(4)),
      default_value: DEFAULT_JACCARD_DUPLICATE_THRESHOLD,
      applied_value: Number(applied.toFixed(4)),
      sample_size: dupResult.sample_size,
      basis_outcome: "success",
      distribution_p25: dupResult.distribution_p25,
      distribution_p50: dupResult.distribution_p50,
      distribution_p95: dupResult.distribution_p95,
      rationale: `跟 DUPLICATE_THRESHOLD 保持一致（校准后统一，不再需要因为 embedding/Jaccard 天然偏差而设两个值）。`
    });
  }

  if (results.length === 0) {
    return {
      calibrated: false,
      reason: `outcome 分组后没有满足 ≥5 样本的组（success/failure_recovered/failure），保留默认阈值。`
    };
  }

  // 写入校准结果
  for (const r of results) {
    await upsertThresholdCalibration({
      tenantId: input.tenantId,
      scope: input.scope,
      thresholdName: r.threshold_name,
      recommendedValue: r.recommended_value,
      defaultValue: r.default_value,
      appliedValue: r.applied_value,
      sampleSize: r.sample_size,
      basisOutcome: r.basis_outcome,
      distributionP25: r.distribution_p25 ?? null,
      distributionP50: r.distribution_p50 ?? null,
      distributionP95: r.distribution_p95 ?? null,
      rationale: r.rationale
    });
  }

  return {
    calibrated: true,
    thresholds: results.map((r) => ({
      threshold_name: r.threshold_name,
      recommended_value: r.recommended_value,
      default_value: r.default_value,
      applied_value: r.applied_value,
      sample_size: r.sample_size,
      basis_outcome: r.basis_outcome
    }))
  };
}
