import assert from "node:assert/strict";
import { buildMemoryServiceApp } from "../../services/memory-service/dist/services/memory-service/src/app.js";
import { getPool } from "../../libs/db/dist/pool.js";

const app = buildMemoryServiceApp();
const tenantId = "tenant-local";
const scope = "memory.validation";
const traceId = "p0-5-verify-trace";

async function runHostModelWithProjectInternalKnowledge() {
  const payload = {
    extraction_preview: {
      rule_candidates: [],
      memory_candidates: [],
      skill_proposal_candidates: [],
      knowledge_candidates: [
        {
          candidate_type: "knowledge_candidate",
          title: "Project internal state leak test",
          origin_scope: "project",
          availability_scope: "project_reusable",
          governance_level: "shared",
          promotion_status: "active",
          knowledge_type: "pattern",
          source_kind: "assistant_message",
          source_timestamp: "2026-06-22T10:00:00.000Z",
          content: "构建失败是因为本项目的 node_modules 缺失，需要先在仓库根目录执行 npm install。",
          source_excerpt: "构建失败是因为本项目的 node_modules 缺失，需要先在仓库根目录执行 npm install。",
          reason: "Testing P0.5 §9 project-internal rejection.",
          confidence: "high"
        }
      ],
      governance_evidence_candidates: []
    },
    host: "generic",
    governance_mode: "host_model",
    fingerprint: null
  };

  const response = await app.inject({
    method: "POST",
    url: "/internal/governance/run-from-extraction",
    headers: {
      "x-tenant-id": tenantId,
      "x-scope": scope,
      "x-trace-id": traceId
    },
    payload
  });

  console.log("project-internal response status:", response.statusCode);
  console.log("project-internal response body:", response.body);
  assert.equal(response.statusCode, 400, "host_model must reject project-internal knowledge");
  assert.ok(response.body.includes("spec 39 §9 violation"), "error must mention spec 39 §9 violation");
}

async function runHostModelWithUserPreferenceKnowledge() {
  const payload = {
    extraction_preview: {
      rule_candidates: [],
      memory_candidates: [],
      skill_proposal_candidates: [],
      knowledge_candidates: [
        {
          candidate_type: "knowledge_candidate",
          title: "User preference leak test",
          origin_scope: "project",
          availability_scope: "project_reusable",
          governance_level: "shared",
          promotion_status: "active",
          knowledge_type: "pattern",
          source_kind: "user_message",
          source_timestamp: "2026-06-22T10:00:00.000Z",
          content: "用户偏好简洁回答，不喜欢详细解释。",
          source_excerpt: "用户偏好简洁回答，不喜欢详细解释。",
          reason: "Testing P0.5 §9 user-preference rejection.",
          confidence: "high"
        }
      ],
      governance_evidence_candidates: []
    },
    host: "generic",
    governance_mode: "host_model",
    fingerprint: null
  };

  const response = await app.inject({
    method: "POST",
    url: "/internal/governance/run-from-extraction",
    headers: {
      "x-tenant-id": tenantId,
      "x-scope": scope,
      "x-trace-id": traceId
    },
    payload
  });

  console.log("user-preference response status:", response.statusCode);
  console.log("user-preference response body:", response.body);
  assert.equal(response.statusCode, 400, "host_model must reject user-preference knowledge");
}

async function runHostModelWithLocalDbUrlKnowledge() {
  const payload = {
    extraction_preview: {
      rule_candidates: [],
      memory_candidates: [],
      skill_proposal_candidates: [],
      knowledge_candidates: [
        {
          candidate_type: "knowledge_candidate",
          title: "Local database connection string leak test",
          origin_scope: "project",
          availability_scope: "project_reusable",
          governance_level: "shared",
          promotion_status: "active",
          knowledge_type: "external_fact",
          source_kind: "assistant_message",
          source_timestamp: "2026-06-22T10:00:00.000Z",
          content: "The local test database URL is postgresql://postgres:postgres@127.0.0.1:15432/super_agent_system.",
          source_excerpt: "set DB_URL=postgresql://postgres:postgres@127.0.0.1:15432/super_agent_system",
          reason: "Testing P0.5 §9 local endpoint / database URL rejection.",
          confidence: "high"
        }
      ],
      governance_evidence_candidates: []
    },
    host: "generic",
    governance_mode: "host_model",
    fingerprint: null
  };

  const response = await app.inject({
    method: "POST",
    url: "/internal/governance/run-from-extraction",
    headers: {
      "x-tenant-id": tenantId,
      "x-scope": scope,
      "x-trace-id": traceId
    },
    payload
  });

  console.log("local-db-url response status:", response.statusCode);
  console.log("local-db-url response body:", response.body);
  assert.equal(response.statusCode, 400, "host_model must reject local database URL knowledge");
  assert.ok(response.body.includes("spec 39 §9 violation"), "error must mention spec 39 §9 violation");
}

try {
  await runHostModelWithProjectInternalKnowledge();
  await runHostModelWithUserPreferenceKnowledge();
  await runHostModelWithLocalDbUrlKnowledge();
  console.log("\n✅ P0.5 audit verification passed.");
} finally {
  await app.close();
  await getPool().end();
}
