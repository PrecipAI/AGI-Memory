import type { GovernanceRunRequest, GovernanceRunResponse } from "@super-agent/contracts";
import {
  countMemoryAccessLogs,
  createMemoryAccessLog,
  createReconciliationItems,
  createZombieStates,
  ensureMemoryCandidateTaskEnvelope,
  recordDriftCheckResults,
  upsertEnvironmentFingerprint
} from "@super-agent/db";
import type { IndexSyncAdapter } from "./indexSyncAdapter.js";
import type { LifecycleWorker } from "./lifecycleWorker.js";
import type { ResidentMemoryBuilder } from "./residentMemoryBuilder.js";
import type { SummaryGenerator } from "./summaryGenerator.js";

export async function handleGovernanceRun(input: {
  tenantId: string;
  scope: string;
  traceId: string;
  body: GovernanceRunRequest;
  summaryGenerator: SummaryGenerator;
  residentBuilder: ResidentMemoryBuilder;
  indexSyncAdapter: IndexSyncAdapter;
  lifecycleWorker: LifecycleWorker;
}): Promise<GovernanceRunResponse> {
  const taskStepId = "task_step_id" in input.body && typeof input.body.task_step_id === "string" ? input.body.task_step_id : null;
  if (input.body.fingerprint) {
    await upsertEnvironmentFingerprint({
      tenantId: input.tenantId,
      scope: input.scope,
      fingerprintKey: input.body.fingerprint,
      capabilityVersion: "memory-v3",
      configHash: "local-dev",
      schemaVersion: "v1",
      dependencySignature: "local-fallback",
      deploymentBaselineId: "memory-validation",
      status: "active",
      traceId: input.traceId
    });
  }
  if (taskStepId) {
    await ensureMemoryCandidateTaskEnvelope({
      tenantId: input.tenantId,
      scope: input.scope,
      taskRequestId: input.body.task_request_id,
      taskStepId,
      sourceRef: `memory-governance://${input.body.task_request_id}`,
      artifactTag: "memory_governance_run",
      sideEffectClass: "state_change",
      traceId: input.traceId
    });
  }

  const summaryId = await input.summaryGenerator.generate({
    tenantId: input.tenantId,
    scope: input.scope,
    taskRequestId: input.body.task_request_id,
    traceId: input.traceId
  });
  const rebuiltSnapshotId =
    input.body.rebuild_resident === false
      ? null
      : await input.residentBuilder.rebuild({
          tenantId: input.tenantId,
          scope: input.scope,
          fingerprint: input.body.fingerprint ?? null,
          dirtyReason: "governance-run",
          traceId: input.traceId
        });
  const indexSync =
    input.body.sync_index === false
      ? {
          backend: "local-fallback",
          synced_memory_ids: [],
          synced_skill_ids: [],
          stale_index_ids: [],
          index_size: 0
        }
      : await input.indexSyncAdapter.sync({
          tenantId: input.tenantId,
          scope: input.scope,
          fingerprint: input.body.fingerprint ?? null
        });
  // fix-9: lifecycle 改成显式触发，默认不自动跑
  // 宿主通过 memory-lifecycle skill 显式调用，或显式传 run_lifecycle=true
  const lifecycle =
    input.body.run_lifecycle !== true
      ? {
          downgraded_skill_ids: [],
          retired_memory_ids: [],
          retired_skill_ids: [],
          retired_summary_ids: [],
          retired_snapshot_ids: [],
          rebuilding_snapshot_ids: [],
          stale_index_ids: indexSync.stale_index_ids
        }
      : await input.lifecycleWorker.run({
          tenantId: input.tenantId,
          scope: input.scope,
          fingerprint: input.body.fingerprint ?? null,
          traceId: input.traceId,
          staleIndexIds: indexSync.stale_index_ids
        });
  const driftChecks = await recordDriftCheckResults({
    tenantId: input.tenantId,
    scope: input.scope,
    taskRequestId: input.body.task_request_id,
    taskStepId,
    fingerprint: input.body.fingerprint ?? null,
    traceId: input.traceId
  });
  const reconciliationItemIds = await createReconciliationItems({
    tenantId: input.tenantId,
    scope: input.scope,
    taskRequestId: input.body.task_request_id,
    taskStepId,
    driftRecords: driftChecks,
    staleIndexIds: lifecycle.stale_index_ids,
    traceId: input.traceId
  });
  const zombieStateIds = await createZombieStates({
    tenantId: input.tenantId,
    scope: input.scope,
    taskRequestId: input.body.task_request_id,
    taskStepId,
    staleIndexIds: lifecycle.stale_index_ids,
    traceId: input.traceId
  });
  const accessLogCount = await countMemoryAccessLogs({
    tenantId: input.tenantId,
    scope: input.scope
  });
  await createMemoryAccessLog({
    tenantId: input.tenantId,
    scope: input.scope,
    queryKind: "governance:run",
    queryPayload: {
      task_request_id: input.body.task_request_id,
      task_step_id: taskStepId,
      fingerprint: input.body.fingerprint ?? null,
      rebuild_resident: input.body.rebuild_resident !== false,
      sync_index: input.body.sync_index !== false,
      run_lifecycle: input.body.run_lifecycle !== false
    },
    decisionPayload: {
      summary_id: summaryId,
      rebuilt_snapshot_id: rebuiltSnapshotId ?? null,
      stale_index_ids: indexSync.stale_index_ids,
      lifecycle,
      drift_check_result_ids: driftChecks.map((item) => item.id),
      reconciliation_item_ids: reconciliationItemIds,
      zombie_state_ids: zombieStateIds
    },
    objectType: "governance_run",
    objectRef: input.body.task_request_id,
    traceId: input.traceId
  });

  return {
    summary_ids: [summaryId],
    rebuilt_snapshot_id: rebuiltSnapshotId ?? undefined,
    persisted_memory_ids: indexSync.synced_memory_ids,
    persisted_skill_ids: indexSync.synced_skill_ids,
    index_sync: indexSync,
    drift_check_result_ids: driftChecks.map((item) => item.id),
    reconciliation_item_ids: reconciliationItemIds,
    zombie_state_ids: zombieStateIds,
    lifecycle: {
      ...lifecycle,
      drift_mismatch_count: driftChecks.filter((item) => item.match_result === "mismatch").length,
      drift_unknown_count: driftChecks.filter((item) => item.match_result === "unknown").length,
      access_log_count: accessLogCount + 1
    }
  };
}
