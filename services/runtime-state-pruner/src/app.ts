import Fastify from "fastify";
import { pruneRuntimeState, type RuntimeState } from "./pruneRuntimeState.js";

export function buildRuntimeStatePrunerApp() {
  const app = Fastify({ logger: false });

  app.get("/healthz", async () => ({
    service: "runtime-state-pruner",
    ok: true
  }));

  app.post("/internal/runtime/prune", async (request) => {
    const body = (request.body ?? {}) as Partial<RuntimeState>;
    const runtimeState: RuntimeState = {
      pinned_state: body.pinned_state ?? [],
      active_branch_window: body.active_branch_window ?? [],
      failure_clusters: body.failure_clusters ?? [],
      branch_digests: body.branch_digests ?? [],
      delta_journal: body.delta_journal ?? []
    };
    const softLimit = Number(process.env.RUNTIME_SOFT_LIMIT || "1200");
    const hardLimit = Number(process.env.RUNTIME_HARD_LIMIT || "1800");
    const result = pruneRuntimeState(runtimeState, softLimit, hardLimit);

    return {
      ...result,
      runtime_state: runtimeState,
      emitted_event: result.pruned ? "runtime.pruned" : null
    };
  });

  return app;
}
