export type ReplayPlanInput = {
  dependencyId: string;
  dependencyState: "DOWN" | "HALF-OPEN" | "UP";
  itemCount: number;
};

export function buildReplayPlan(input: ReplayPlanInput) {
  if (input.dependencyState === "DOWN") {
    return {
      canary_allowed: false,
      next_state: "DOWN",
      replay_batch_size: 0,
      reason: "dependency is still down"
    };
  }

  if (input.dependencyState === "HALF-OPEN") {
    return {
      canary_allowed: true,
      next_state: "HALF-OPEN",
      replay_batch_size: Math.min(1, input.itemCount),
      reason: "run canary replay first"
    };
  }

  return {
    canary_allowed: true,
    next_state: "UP",
    replay_batch_size: Math.min(5, input.itemCount),
    reason: "dependency recovered and cluster may thaw scope"
  };
}
