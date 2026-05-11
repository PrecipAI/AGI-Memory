import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getPool } from "../libs/db/dist/pool.js";
import { buildMemoryServiceApp } from "../services/memory-service/dist/services/memory-service/src/app.js";

const app = buildMemoryServiceApp();
const fixtureRoot = path.join(process.cwd(), "tests", "fixtures", "generic-host-capture");
const hosts = ["claude-code", "openclaw", "opencode"];
const runRef = randomUUID().slice(0, 8);

try {
  for (const host of hosts) {
    await getPool().query(
      "DELETE FROM host_governance_event WHERE tenant_id = $1 AND scope = $2 AND host = $3",
      ["tenant-local", "memory.validation", host]
    );

    const hostHome = path.join(fixtureRoot, host);
    const sessions = await app.inject({
      method: "GET",
      url: `/internal/host-capture/${host}/sessions?host_home=${encodeURIComponent(hostHome)}&limit=5`
    });
    assert.equal(sessions.statusCode, 200, sessions.body);
    const sessionBody = sessions.json();
    assert.equal(sessionBody.host, host);
    assert.ok(sessionBody.items.length >= 1, `${host} should list fixture sessions`);
    const threadId = sessionBody.items[0].thread_id;

    const preview = await app.inject({
      method: "POST",
      url: `/internal/host-capture/${host}/preview`,
      payload: {
        host_home: hostHome,
        thread_id: threadId,
        max_items: 8
      }
    });
    assert.equal(preview.statusCode, 200, preview.body);
    const previewBody = preview.json();
    assert.equal(previewBody.host, host);
    assert.ok(previewBody.totals.user_message_count >= 1, `${host} should capture user messages`);
    assert.ok(previewBody.totals.command_event_count >= 1, `${host} should capture command evidence`);

    const firstUserMessage = previewBody.governance_preview.user_messages[0];
    const run = await app.inject({
      method: "POST",
      url: `/internal/host-capture/${host}/governance-run`,
      payload: {
        host_home: hostHome,
        thread_id: threadId,
        max_items: 8,
        governance_mode: "host_model",
        task_request_id: randomUUID(),
        host_model_result: {
          model_ref: `${host}:fixture-model`,
          generated_at: "2026-05-06T00:00:00.000Z",
          extraction_preview: {
            rule_candidates: [
              {
                candidate_type: "rule_candidate",
                title: `${host} host model governance rule ${runRef}`,
                origin_scope: "user",
                availability_scope: "user_reusable",
                governance_level: "shared",
                promotion_status: "active",
                rule_domain: "integration",
                rule_scope: "user",
                applies_to_phase: ["integration", "governance"],
                violation_behavior: "block",
                source_kind: "user_message",
                source_timestamp: firstUserMessage.timestamp,
                content: `${host} 接入治理时必须由宿主模型输出结构化治理结果。验证批次：${runRef}。`,
                source_excerpt: firstUserMessage.text,
                reason: "The host fixture model produced a reusable integration rule.",
                confidence: "high"
              }
            ],
            memory_candidates: [
              {
                candidate_type: "memory_candidate",
                title: `${host} host model integration decision ${runRef}`,
                origin_scope: "project",
                availability_scope: "project_reusable",
                governance_level: "shared",
                promotion_status: "active",
                memory_type: "integration_context",
                stability: "long_lived",
                source_kind: "user_message",
                source_timestamp: firstUserMessage.timestamp,
                content: `${host} 使用宿主模型治理，memory-service 负责 schema 校验、去重、审批和落库。验证批次：${runRef}。`,
                source_excerpt: firstUserMessage.text,
                reason: "The host fixture model distilled the integration decision.",
                confidence: "high"
              }
            ],
            skill_proposal_candidates: [
              {
                candidate_type: "skill_proposal_candidate",
                title: `${host} host-model skill contract proposal ${runRef}`,
                origin_scope: "user",
                availability_scope: "user_reusable",
                governance_level: "shared",
                promotion_status: "needs_review",
                source_kind: "user_message",
                source_timestamp: firstUserMessage.timestamp,
                target_skill: "memory-governance-guidelines",
                target_skill_path: "C:\\Users\\Administrator\\.codex\\skills\\memory-governance-guidelines\\SKILL.md",
                change_type: "update",
                current_section: `治理模型接入 ${runRef}`,
                current_text: "当前缺少多宿主接入口说明。",
                current_gap: "缺少多宿主热插拔治理接入说明会导致各宿主实现分叉。",
                proposed_text: `${host} 接入时按 host_model_result contract 输出治理结果，服务端只做校验与落库。验证批次：${runRef}。`,
                proposed_patch: "*** Begin Patch\n*** Update File: SKILL.md\n@@\n+多宿主治理接入按 host_model_result contract 执行。\n*** End Patch",
                validation_method: "运行多宿主 fixture 验证时，claude-code/openclaw/opencode 都必须通过 host_model_result contract 落库。",
                rationale: "保持多宿主治理接入一致。",
                proposal_quality: "actionable",
                source_refs: [
                  {
                    source_kind: "user_message",
                    source_timestamp: firstUserMessage.timestamp,
                    source_excerpt: firstUserMessage.text
                  }
                ],
                merged_source_count: 1,
                source_excerpt: firstUserMessage.text,
                reason: "The host fixture model produced a concrete skill proposal.",
                confidence: "high"
              }
            ],
            knowledge_candidates: [],
            governance_evidence_candidates: [
              {
                candidate_type: "governance_evidence_candidate",
                title: `${host} session evidence`,
                origin_scope: "session",
                availability_scope: "session_only",
                governance_level: "session",
                promotion_status: "candidate",
                evidence_category: "execution_step",
                source_kind: "user_message",
                source_timestamp: firstUserMessage.timestamp,
                source_excerpt: firstUserMessage.text,
                reason: "Original host session remains evidence only.",
                confidence: "medium"
              }
            ]
          }
        }
      }
    });
    assert.equal(run.statusCode, 200, run.body);
    const runBody = run.json();
    assert.equal(runBody.host, host);
    assert.equal(runBody.acceptance_report.governance_model.mode, "host_model");
    assert.equal(runBody.acceptance_report.governance_model.model_ref, `${host}:fixture-model`);
    assert.equal(runBody.persisted.rule_items.length, 1, JSON.stringify(runBody.persisted, null, 2));
    assert.equal(runBody.persisted.memory_items.length, 1, JSON.stringify(runBody.persisted, null, 2));
    assert.equal(runBody.persisted.skill_proposal_items.length, 1, JSON.stringify(runBody.persisted, null, 2));
    assert.equal(runBody.persisted.knowledge_items.length, 0);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        verified_hosts: hosts,
        fixture_root: fixtureRoot
      },
      null,
      2
    )}\n`
  );
} finally {
  await app.close();
}
