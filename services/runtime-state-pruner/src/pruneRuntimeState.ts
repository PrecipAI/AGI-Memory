export type RuntimeState = {
  pinned_state: Array<Record<string, unknown>>;
  active_branch_window: Array<Record<string, unknown>>;
  failure_clusters: Array<Record<string, unknown>>;
  branch_digests: Array<Record<string, unknown>>;
  delta_journal: Array<Record<string, unknown>>;
};

export type PruneResult = {
  pruned: boolean;
  total_before: number;
  total_after: number;
  removed_from_active_branch_window: number;
  stream_state: "unchanged" | "pruned";
};

function countUnits(state: RuntimeState): number {
  return (
    state.pinned_state.length +
    state.active_branch_window.length +
    state.failure_clusters.length +
    state.branch_digests.length +
    state.delta_journal.length
  );
}

export function pruneRuntimeState(state: RuntimeState, softLimit: number, hardLimit: number): PruneResult {
  const totalBefore = countUnits(state);
  if (totalBefore <= softLimit) {
    return {
      pruned: false,
      total_before: totalBefore,
      total_after: totalBefore,
      removed_from_active_branch_window: 0,
      stream_state: "unchanged"
    };
  }

  const budgetForActiveWindow = Math.max(hardLimit - state.pinned_state.length - state.failure_clusters.length, 0);
  const beforeWindow = state.active_branch_window.length;
  state.active_branch_window = state.active_branch_window.slice(0, budgetForActiveWindow);

  const totalAfter = countUnits(state);
  return {
    pruned: totalAfter < totalBefore,
    total_before: totalBefore,
    total_after: totalAfter,
    removed_from_active_branch_window: Math.max(beforeWindow - state.active_branch_window.length, 0),
    stream_state: totalAfter < totalBefore ? "pruned" : "unchanged"
  };
}
