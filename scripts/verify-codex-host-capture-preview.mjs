import assert from "node:assert/strict";
import path from "node:path";
import { buildMemoryServiceApp } from "../services/memory-service/dist/services/memory-service/src/app.js";

const app = buildMemoryServiceApp();
const fixtureRoot = path.join(process.cwd(), "tests", "fixtures", "codex-capture");

try {
  const response = await app.inject({
    method: "POST",
    url: "/internal/host-capture/codex/preview",
    payload: {
      codex_home: fixtureRoot,
      thread_id: "019df330-e9df-7ef3-90bc-7c403ef1741e",
      max_items: 5
    }
  });

  assert.equal(response.statusCode, 200, "codex host capture preview should succeed");
  const body = response.json();

  assert.equal(body.host, "codex");
  assert.equal(body.thread_id, "019df330-e9df-7ef3-90bc-7c403ef1741e");
  assert.match(body.session_file, /rollout-2026-05-04T21-32-42-019df330-e9df-7ef3-90bc-7c403ef1741e\.jsonl$/);

  assert.equal(body.totals.user_message_count, 4, "fixture should exclude injected AGENTS/environment scaffold and keep the four real user messages");
  assert.equal(body.totals.command_event_count, 3, "fixture should expose exec events and shell_command calls as command evidence");
  assert.equal(body.totals.mcp_call_count, 2, "fixture should expose two MCP calls");
  assert.equal(body.governance_preview.readiness.has_user_intent, true);
  assert.equal(body.governance_preview.readiness.has_execution_trace, true);
  assert.equal(body.governance_preview.readiness.has_tool_trace, true);
  assert.equal(body.governance_preview.readiness.quality, "high");

  assert.ok(body.governance_preview.corrections.length >= 1, "correction extraction should keep explicit user correction text");
  assert.ok(body.governance_preview.preferences.length >= 1, "preference extraction should keep hard-constraint user text");
  assert.ok(body.governance_preview.decisions.length >= 1, "decision extraction should keep short affirmative decisions");
  assert.ok(
    body.governance_preview.workspace_paths.includes("D:\\workspace\\projects\\SuperAgentSystem-main"),
    "workspace path extraction should include command cwd"
  );
  assert.ok(
    body.governance_preview.commands.some(
      (item) => item.status === "failure" && item.command.join(" ").includes("rg --files")
    ),
    "preview should expose command status so adapter can retain failed execution steps"
  );
  assert.ok(
    body.governance_preview.commands.some(
      (item) => item.status === "success" && item.command.join(" ").includes("npm run verify:mcp")
    ),
    "preview should expose shell_command tool calls as command execution steps even without exec_command_end events"
  );
  assert.ok(
    body.governance_preview.mcp_calls.every((item) => Object.prototype.hasOwnProperty.call(item, "status")),
    "preview should expose MCP call status fields for downstream governance adapters"
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        thread_id: body.thread_id,
        session_file: body.session_file,
        totals: body.totals,
        readiness: body.governance_preview.readiness
      },
      null,
      2
    )}\n`
  );
} finally {
  await app.close();
}
