import http from "node:http";
import { randomUUID } from "node:crypto";

export async function startFakeMemoryService(options = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const requests = [];

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${host}`);
    const body = await readJsonBody(request);
    requests.push({
      method: request.method ?? "GET",
      path: url.pathname,
      body,
      headers: request.headers
    });

    if (request.method === "GET" && url.pathname === "/healthz") {
      return sendJson(response, 200, {
        service: "fake-memory-service",
        ok: true,
        single_tenant_mode: true,
        default_tenant_id: "tenant-local",
        default_scope: "memory.validation"
      });
    }

    if (request.method === "POST" && url.pathname === "/internal/memory/query") {
      return sendJson(response, 200, {
        kind: body.kind ?? "resident",
        tenant_id: request.headers["x-tenant-id"] ?? "tenant-local",
        scope: request.headers["x-scope"] ?? "memory.validation",
        single_tenant_mode: true,
        items: [
          {
            id: "memory-item-stub",
            kind: body.kind ?? "resident",
            source: "fake-memory-service"
          }
        ]
      });
    }

    if (request.method === "POST" && url.pathname === "/internal/memory/retrieve") {
      if (body.include_procedural === true && typeof body.fingerprint_status !== "string") {
        return sendJson(response, 400, {
          error_code: "FINGERPRINT_STATUS_REQUIRED",
          message: "fingerprint_status is required when procedural retrieval is requested",
          trace_id: request.headers["x-trace-id"] ?? null,
          retryable: false,
          details: {}
        });
      }

      if (
        body.include_procedural === true &&
        body.fingerprint_status === "matched" &&
        typeof body.fingerprint !== "string"
      ) {
        return sendJson(response, 400, {
          error_code: "FINGERPRINT_REQUIRED",
          message: "fingerprint is required when fingerprint_status=matched",
          trace_id: request.headers["x-trace-id"] ?? null,
          retryable: false,
          details: {}
        });
      }

      const fingerprintMatched = body.fingerprint_status === "matched" && typeof body.fingerprint === "string";
      return sendJson(response, 200, {
        task_request_id: body.task_request_id ?? randomUUID(),
        runtime_summary: body.runtime_summary ?? {},
        conversation_summaries: [
          {
            id: "summary-stub",
            summary_type: "conversation",
            summary_payload: {
              text: "summary from fake service"
            }
          }
        ],
        resident_snapshot: {
          id: "resident-stub",
          snapshot_payload: {
            key_points: ["fake resident snapshot"]
          }
        },
        factual_memory: [
          {
            id: "factual-stub",
            content: "factual memory"
          }
        ],
        procedural_memory: fingerprintMatched
          ? [
              {
                id: "skill-stub",
                content: "procedural memory"
              }
            ]
          : []
      });
    }

    if (request.method === "POST" && url.pathname === "/internal/memory/candidates") {
      const persistTarget =
        body.verification_status === "verified_fix" || body.artifact_tag === "workflow_tag=standard_path"
          ? "skill"
          : "memory";

      return sendJson(response, 200, {
        candidate_id: randomUUID(),
        routing_decision: "persist",
        persist_target: persistTarget
      });
    }

    if (request.method === "POST" && url.pathname === "/internal/host-capture/codex/governance-batch-preview") {
      return sendJson(response, 200, {
        host: "codex",
        thread_id: body.thread_id ?? "thread-stub",
        ingestion_readiness: "ready",
        raw_inputs: {
          user_messages: 2,
          assistant_commentary_messages: 1,
          command_events: 1,
          tool_calls: 3,
          mcp_tool_calls: 1
        },
        extraction_preview: {
          memory_candidates: 1,
          knowledge_candidates: 0,
          skill_candidates: 1,
          rule_candidates: 0,
          governance_evidence_events: 2
        }
      });
    }

    if (request.method === "POST" && url.pathname === "/internal/host-capture/codex/governance-run") {
      return sendJson(response, 200, {
        host: "codex",
        thread_id: body.thread_id ?? "thread-stub",
        task_request_id: body.task_request_id ?? randomUUID(),
        persisted: {
          memory: 1,
          knowledge: 0,
          skill: 1,
          rule: 0,
          governance_evidence: 2
        },
        acceptance_report: {
          raw_inputs: {
            user_messages: 2,
            assistant_commentary_messages: 1,
            command_events: 1,
            tool_calls: 3,
            mcp_tool_calls: 1
          },
          candidates: {
            memory: 1,
            knowledge: 0,
            skill: 1,
            rule: 0,
            governance_evidence: 2
          }
        },
        warnings: []
      });
    }

    if (request.method === "POST" && url.pathname === "/internal/memory/governance/run") {
      return sendJson(response, 200, {
        governance_status: "completed",
        rebuilt_summary_id: randomUUID(),
        rebuilt_snapshot_id: randomUUID(),
        index_sync_status: "synced",
        lifecycle_status: "completed"
      });
    }

    if (request.method === "POST" && url.pathname === "/internal/rules/gate/check") {
      return sendJson(response, 200, {
        allowed: true,
        decision: "allow",
        operation: body.operation,
        matched_checkpoint_count: 0,
        checkpoints: [],
        audit_ids: [randomUUID()],
        rule_hotplug_note: "fake service accepts rule gate checks"
      });
    }

    return sendJson(response, 404, {
      error: "not_found",
      path: url.pathname
    });
  });

  await new Promise((resolve, reject) => {
    server.listen(port, host, () => resolve(undefined));
    server.on("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve fake memory-service address");
  }

  return {
    url: `http://${host}:${address.port}`,
    requests,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(undefined);
        });
      });
    }
  };
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length > 0 ? JSON.parse(raw) : {};
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(body);
}
