import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildMemoryServiceApp } from "../services/memory-service/dist/services/memory-service/src/app.js";
import { buildKnowledgeOpsConsoleApp } from "../services/knowledge-ops-console/dist/app.js";

const tenantId = process.env.DEFAULT_TENANT_ID || "tenant-local";
const scope = process.env.DEFAULT_SCOPE || "memory.validation";
const taskRequestId = randomUUID();
const taskStepId = randomUUID();

function buildHeaders(label) {
  return {
    "X-Tenant-Id": tenantId,
    "X-Scope": scope,
    "X-Trace-Id": `trace-console-${label}-${Date.now()}`,
    "Idempotency-Key": `idem-console-${label}-${Date.now()}`
  };
}

const memoryApp = buildMemoryServiceApp();
const memoryAddress = await memoryApp.listen({ port: 0, host: "127.0.0.1" });
const consoleApp = buildKnowledgeOpsConsoleApp({
  apiBaseUrl: memoryAddress,
  tenantId,
  scope
});

try {
  const root = await consoleApp.inject({
    method: "GET",
    url: "/"
  });
  assert.equal(root.statusCode, 200, "console root failed");
  assert.match(root.body, /Knowledge Ops/i, "console root html missing");

  const css = await consoleApp.inject({
    method: "GET",
    url: "/styles.css"
  });
  assert.equal(css.statusCode, 200, "console css failed");

  const js = await consoleApp.inject({
    method: "GET",
    url: "/app.js"
  });
  assert.equal(js.statusCode, 200, "console js failed");

  const config = await consoleApp.inject({
    method: "GET",
    url: "/api/config"
  });
  assert.equal(config.statusCode, 200, "console config failed");
  const configBody = config.json();
  assert.equal(configBody.tenant_id, tenantId, "console config tenant mismatch");

  const overview = await consoleApp.inject({
    method: "GET",
    url: "/api/overview"
  });
  assert.equal(overview.statusCode, 200, "console overview failed");
  const overviewBody = overview.json();
  assert.ok(Number(overviewBody.document_count) >= 1, "console overview document_count should be >= 1");

  const documents = await consoleApp.inject({
    method: "GET",
    url: "/api/documents"
  });
  assert.equal(documents.statusCode, 200, "console documents failed");
  assert.ok(Array.isArray(documents.json().items), "console documents items missing");

  const review = await consoleApp.inject({
    method: "GET",
    url: "/api/review-queue"
  });
  assert.equal(review.statusCode, 200, "console review queue failed");
  assert.ok(Array.isArray(review.json().items), "console review queue items missing");

  const seedRule = await memoryApp.inject({
    method: "POST",
    url: "/internal/memory/candidates",
    headers: buildHeaders("proposal-seed-rule"),
    payload: {
      task_request_id: taskRequestId,
      task_step_id: taskStepId,
      source_type: "console_smoke",
      source_ref: "verify://console/proposal-rule",
      artifact_tag: "project_constraint",
      verification_status: "verified",
      side_effect_class: "read_only",
      fingerprint_status: "matched_or_na",
      candidate_payload: {
        rule_key: "console-proposal-smoke-rule",
        title: "Console proposal smoke rule",
        content: "Console proposal smoke seed rule should become active before update.",
        applies_to: ["knowledge-ops-console"],
        enforcement_level: "should_follow"
      }
    }
  });
  assert.equal(seedRule.statusCode, 200, "console proposal seed rule failed");

  const updateRule = await memoryApp.inject({
    method: "POST",
    url: "/internal/memory/candidates",
    headers: buildHeaders("proposal-update-rule"),
    payload: {
      task_request_id: taskRequestId,
      task_step_id: taskStepId,
      source_type: "console_smoke",
      source_ref: "verify://console/proposal-rule-update",
      artifact_tag: "project_constraint",
      verification_status: "verified",
      side_effect_class: "read_only",
      fingerprint_status: "matched_or_na",
      candidate_payload: {
        rule_key: "console-proposal-smoke-rule",
        title: "Console proposal smoke rule updated",
        content: "Console proposal smoke update should create a human-review proposal.",
        applies_to: ["knowledge-ops-console"],
        enforcement_level: "should_follow"
      }
    }
  });
  assert.equal(updateRule.statusCode, 200, "console proposal update rule failed");

  const proposals = await consoleApp.inject({
    method: "GET",
    url: "/api/governance/change-proposals?status=recorded"
  });
  assert.equal(proposals.statusCode, 200, "console governance proposals failed");
  const proposalItems = proposals.json().items;
  assert.ok(Array.isArray(proposalItems), "console governance proposals items missing");
  const smokeProposal = proposalItems.find((item) => item.proposed_payload?.rule_key === "console-proposal-smoke-rule");
  assert.ok(smokeProposal?.id, "console governance proposals should include smoke rule update");

  const rejectProposal = await consoleApp.inject({
    method: "POST",
    url: `/api/governance/change-proposals/${smokeProposal.id}/actions`,
    payload: {
      action: "reject",
      payload: {
        rejected_by: "verify-knowledge-ops-console"
      }
    }
  });
  assert.equal(rejectProposal.statusCode, 200, "console governance proposal reject failed");
  assert.equal(rejectProposal.json().item.human_decision, "rejected", "console reject should resolve proposal as rejected");

  const runs = await consoleApp.inject({
    method: "GET",
    url: "/api/governance-runs"
  });
  assert.equal(runs.statusCode, 200, "console governance runs failed");
  assert.ok(Array.isArray(runs.json().items), "console governance runs items missing");

  const entities = await consoleApp.inject({
    method: "GET",
    url: "/api/graph/entities"
  });
  assert.equal(entities.statusCode, 200, "console graph entities failed");
  assert.ok(Array.isArray(entities.json().items), "console graph entities items missing");

  console.log("knowledge ops console verification passed");
} finally {
  await consoleApp.close();
  await memoryApp.close();
}
