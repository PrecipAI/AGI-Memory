import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { buildMemoryServiceApp } from "../services/memory-service/dist/services/memory-service/src/app.js";

const app = buildMemoryServiceApp();
const limit = Number(process.env.CODEX_GOVERNANCE_THREAD_LIMIT || 500);
const maxItems = Number(process.env.CODEX_GOVERNANCE_MAX_ITEMS || 500);
const codexHome = process.env.CODEX_HOME_OVERRIDE || null;
const reportPath =
  process.env.CODEX_GOVERNANCE_REPORT ||
  path.join(process.cwd(), "tests", "integration", "codex-all-governance-report.json");

try {
  const sessionUrl = `/internal/host-capture/codex/sessions?limit=${encodeURIComponent(String(limit))}${
    codexHome ? `&codex_home=${encodeURIComponent(codexHome)}` : ""
  }`;
  const sessionsResponse = await app.inject({ method: "GET", url: sessionUrl });
  if (sessionsResponse.statusCode !== 200) {
    throw new Error(`Failed to list Codex sessions: ${sessionsResponse.statusCode} ${sessionsResponse.body}`);
  }
  const sessionsBody = sessionsResponse.json();
  const byThreadId = new Map();
  for (const item of sessionsBody.items ?? []) {
    if (!item.thread_id || byThreadId.has(item.thread_id)) {
      continue;
    }
    byThreadId.set(item.thread_id, item);
  }

  const items = [];
  for (const session of byThreadId.values()) {
    const response = await app.inject({
      method: "POST",
      url: "/internal/host-capture/codex/governance-run",
      payload: {
        codex_home: codexHome,
        thread_id: session.thread_id,
        max_items: maxItems,
        task_request_id: randomUUID()
      }
    });
    const body = response.json();
    items.push({
      thread_id: session.thread_id,
      thread_name: session.thread_name,
      updated_at: session.updated_at,
      status_code: response.statusCode,
      warnings: body.warnings ?? [],
      inputs_read: body.acceptance_report?.inputs_read ?? null,
      governance_candidates: body.acceptance_report?.governance_candidates ?? null,
      promoted_outputs: body.acceptance_report?.promoted_outputs ?? null,
      incremental: body.acceptance_report?.incremental ?? null,
      governance_evidence_retained: body.acceptance_report?.governance_evidence_retained ?? [],
      persisted: {
        rule_items: body.persisted?.rule_items ?? [],
        memory_items: body.persisted?.memory_items ?? [],
        skill_proposal_items: body.persisted?.skill_proposal_items ?? [],
        knowledge_items: body.persisted?.knowledge_items ?? [],
        governance_evidence_bundle_id: body.persisted?.governance_evidence_bundle_id ?? null
      },
      error: response.statusCode === 200 ? null : body
    });
  }

  const totals = items.reduce(
    (acc, item) => {
      acc.thread_count += 1;
      if (item.status_code === 200) {
        acc.success_count += 1;
      } else {
        acc.failure_count += 1;
      }
      const candidates = item.governance_candidates ?? {};
      const promoted = item.promoted_outputs ?? {};
      const incremental = item.incremental ?? {};
      acc.rule_candidates += candidates.rule_count ?? 0;
      acc.memory_candidates += candidates.memory_count ?? 0;
      acc.skill_proposal_candidates += candidates.skill_proposal_count ?? 0;
      acc.knowledge_candidates += candidates.knowledge_count ?? 0;
      acc.governance_evidence_candidates += candidates.governance_evidence_count ?? 0;
      acc.promoted_rules += promoted.rule_count ?? 0;
      acc.promoted_memories += promoted.long_term_memory_count ?? 0;
      acc.promoted_skill_proposals += promoted.skill_proposal_count ?? 0;
      acc.promoted_knowledge += promoted.synthesized_knowledge_count ?? 0;
      acc.new_candidate_count += incremental.new_candidate_count ?? 0;
      acc.skipped_previously_governed_count += incremental.skipped_previously_governed_count ?? 0;
      return acc;
    },
    {
      thread_count: 0,
      success_count: 0,
      failure_count: 0,
      rule_candidates: 0,
      memory_candidates: 0,
      skill_proposal_candidates: 0,
      knowledge_candidates: 0,
      governance_evidence_candidates: 0,
      promoted_rules: 0,
      promoted_memories: 0,
      promoted_skill_proposals: 0,
      promoted_knowledge: 0,
      new_candidate_count: 0,
      skipped_previously_governed_count: 0
    }
  );

  const report = {
    host: "codex",
    codex_home: sessionsBody.codex_home,
    max_items: maxItems,
    generated_at: new Date().toISOString(),
    totals,
    items
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ report_path: reportPath, totals }, null, 2)}\n`);
} finally {
  await app.close();
}
