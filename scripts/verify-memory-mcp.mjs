import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startFakeMemoryService } from "./fake-memory-service.mjs";

const rootDir = process.cwd();
const cliPath = path.join(rootDir, "services", "memory-mcp-server", "dist", "services", "memory-mcp-server", "src", "cli.js");
const reportPath = path.join(rootDir, "tests", "integration", "mcp-report.json");

const tempDir = await mkdtemp(path.join(os.tmpdir(), "memory-mcp-verify-"));
const fakeService = await startFakeMemoryService();

try {
  await runCommand(process.execPath, [cliPath, "init", "--dir", tempDir], { cwd: rootDir });

  const configPath = path.join(tempDir, ".memory-mcp", "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.memoryServiceUrl = fakeService.url;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const client = new Client({
    name: "memory-v3-mcp-smoke-client",
    version: "0.1.0"
  });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliPath, "start", "--config", configPath],
    cwd: tempDir,
    env: {
      ...process.env
    },
    stderr: "pipe"
  });

  if (transport.stderr) {
    transport.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
  }

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name).sort();
    assert.deepEqual(toolNames, [
      "memory_health",
      "memory_ingest_candidate",
      "memory_preview_host_governance",
      "memory_query_layer",
      "memory_retrieve_context",
      "memory_run_full_governance",
      "memory_run_governance",
      "rule_gate_check"
    ]);

    const retrieveTool = tools.tools.find((tool) => tool.name === "memory_retrieve_context");
    assert.ok(retrieveTool);
    assert.equal(Object.prototype.hasOwnProperty.call(retrieveTool.inputSchema.properties, "fingerprint_status"), true);

    const resources = await client.listResources();
    const resourceUris = resources.resources.map((resource) => resource.uri).sort();
    assert.deepEqual(resourceUris, ["memory://defaults", "memory://health"]);

    const healthTool = await client.callTool({
      name: "memory_health",
      arguments: {}
    });
    assert.equal(healthTool.isError, undefined);

    const queryResult = await client.callTool({
      name: "memory_query_layer",
      arguments: {
        kind: "resident"
      }
    });
    assert.equal(queryResult.isError, undefined);

    const retrieveResult = await client.callTool({
      name: "memory_retrieve_context",
      arguments: {
        task_request_id: "00000000-0000-4000-8000-000000000001",
        query: "procedural memory",
        fingerprint: "fp-valid",
        fingerprint_status: "matched",
        include_procedural: true,
        include_factual: true
      }
    });
    assert.equal(retrieveResult.isError, undefined);

    const missingStatusRejected = await expectCallToolFailure(client, {
      name: "memory_retrieve_context",
      arguments: {
        task_request_id: "00000000-0000-4000-8000-000000000001",
        query: "procedural memory",
        fingerprint: "fp-valid",
        include_procedural: true,
        include_factual: true
      }
    });
    assert.match(missingStatusRejected, /FINGERPRINT_STATUS_REQUIRED/i);

    const candidateResult = await client.callTool({
      name: "memory_ingest_candidate",
      arguments: {
        task_request_id: "00000000-0000-4000-8000-000000000001",
        task_step_id: "00000000-0000-4000-8000-000000000002",
        source_type: "verification_result",
        source_ref: "verification:1",
        artifact_tag: "workflow_tag=standard_path",
        verification_status: "verified_fix",
        side_effect_class: "none",
        fingerprint: "fp-valid",
        fingerprint_status: "matched",
        candidate_payload: {
          text: "candidate"
        }
      }
    });
    assert.equal(candidateResult.isError, undefined);

    const hostGovernancePreview = await client.callTool({
      name: "memory_preview_host_governance",
      arguments: {
        thread_id: "thread-stub",
        max_items: 10
      }
    });
    assert.equal(hostGovernancePreview.isError, undefined);

    const fullGovernanceResult = await client.callTool({
      name: "memory_run_full_governance",
      arguments: {
        thread_id: "thread-stub",
        max_items: 10,
        task_request_id: "00000000-0000-4000-8000-000000000003",
        fingerprint: "fp-valid",
        refresh_memory: true,
        rebuild_resident: true,
        sync_index: true,
        run_lifecycle: true
      }
    });
    assert.equal(fullGovernanceResult.isError, undefined);
    const fullGovernance = JSON.parse(fullGovernanceResult.content[0].text);
    assert.equal(fullGovernance.rule_gate.decision, "allow");
    assert.equal(fullGovernance.host_governance.host, "codex");
    assert.equal(fullGovernance.memory_refresh.governance_status, "completed");

    const governanceResult = await client.callTool({
      name: "memory_run_governance",
      arguments: {
        task_request_id: "00000000-0000-4000-8000-000000000001"
      }
    });
    assert.equal(governanceResult.isError, undefined);

    const gateResult = await client.callTool({
      name: "rule_gate_check",
      arguments: {
        task_request_id: "00000000-0000-4000-8000-000000000001",
        task_type: "integration",
        host: "codex",
        operation: "write_host_config",
        evidence: {
          confirmed_workspace_path: "D:\\workspace\\projects"
        }
      }
    });
    assert.equal(gateResult.isError, undefined);
    assert.equal(JSON.parse(gateResult.content[0].text).operation, "write_host_config");

    const defaultsResource = await client.readResource({
      uri: "memory://defaults"
    });
    assert.ok(defaultsResource.contents.length >= 1);

    assert.equal(fakeService.requests.some((request) => request.path === "/internal/memory/query"), true);
    assert.equal(fakeService.requests.some((request) => request.path === "/internal/memory/retrieve"), true);
    assert.equal(fakeService.requests.some((request) => request.path === "/internal/memory/candidates"), true);
    assert.equal(
      fakeService.requests.some((request) => request.path === "/internal/host-capture/codex/governance-batch-preview"),
      true
    );
    assert.equal(
      fakeService.requests.some((request) => request.path === "/internal/host-capture/codex/governance-run"),
      true
    );
    assert.equal(fakeService.requests.some((request) => request.path === "/internal/memory/governance/run"), true);
    assert.equal(fakeService.requests.some((request) => request.path === "/internal/rules/gate/check"), true);

    await writeFile(
      reportPath,
      `${JSON.stringify(
        {
          tool_count: tools.tools.length,
          resource_count: resources.resources.length,
          tool_names: toolNames,
          resource_uris: resourceUris,
          adapter_request_count: fakeService.requests.length
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    process.stdout.write(
      `${JSON.stringify(
        {
          tool_count: tools.tools.length,
          resource_count: resources.resources.length,
          report_path: reportPath
        },
        null,
        2
      )}\n`
    );
  } finally {
    await client.close();
    await transport.close();
  }
} finally {
  await fakeService.close();
  await rm(tempDir, { recursive: true, force: true });
}

async function expectCallToolFailure(client, request) {
  try {
    const result = await client.callTool(request);
    if (result.isError) {
      const text = result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      return text.length > 0 ? text : JSON.stringify(result.structuredContent ?? {});
    }
    throw new Error(`Expected MCP tool failure for ${request.name}`);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env
      },
      stdio: "inherit"
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(new Error(`Command failed: ${command} ${args.join(" ")} (exit=${code})`));
    });
    child.on("error", reject);
  });
}
