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
const reportPath = path.join(rootDir, "tests", "integration", "mcp-client-smoke-report.json");
const realMemoryServiceUrl = process.env.MEMORY_SERVICE_URL;
const memoryServiceMode = realMemoryServiceUrl ? "real" : "fake";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "memory-mcp-client-smoke-"));
const fakeService = memoryServiceMode === "fake" ? await startFakeMemoryService() : null;
const memoryServiceUrl = fakeService?.url ?? realMemoryServiceUrl;

try {
  await runCommand(process.execPath, [cliPath, "init", "--dir", tempDir], { cwd: rootDir });

  const configPath = path.join(tempDir, ".memory-mcp", "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.memoryServiceUrl = memoryServiceUrl;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const client = new Client({
    name: "memory-v3-generic-smoke-client",
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
    const resources = await client.listResources();
    const toolNames = tools.tools.map((tool) => tool.name).sort();
    const resourceUris = resources.resources.map((resource) => resource.uri).sort();

    assert.deepEqual(toolNames, [
      "memory_health",
      "memory_ingest_candidate",
      "memory_query_layer",
      "memory_retrieve_context",
      "memory_run_governance",
      "rule_gate_check"
    ]);
    assert.deepEqual(resourceUris, ["memory://defaults", "memory://health"]);

    const defaultsResource = await client.readResource({
      uri: "memory://defaults"
    });
    assert.ok(defaultsResource.contents.length >= 1);

    const healthResult = await client.callTool({
      name: "memory_health",
      arguments: {}
    });
    assert.equal(healthResult.isError, undefined);

    const queryResult = await client.callTool({
      name: "memory_query_layer",
      arguments: {
        kind: "resident"
      }
    });
    assert.equal(queryResult.isError, undefined);

    const matchedRetrieve = await client.callTool({
      name: "memory_retrieve_context",
      arguments: {
        task_request_id: "00000000-0000-4000-8000-000000000111",
        query: "procedural memory",
        fingerprint: "fp-valid",
        fingerprint_status: "matched",
        include_procedural: true,
        include_factual: true
      }
    });
    assert.equal(matchedRetrieve.isError, undefined);

    const missingStatusRejected = await expectCallToolFailure(client, {
      name: "memory_retrieve_context",
      arguments: {
        task_request_id: "00000000-0000-4000-8000-000000000111",
        query: "procedural memory",
        fingerprint: "fp-valid",
        include_procedural: true,
        include_factual: true
      }
    });
    assert.match(missingStatusRejected, /FINGERPRINT_STATUS_REQUIRED/i);

    const missingFingerprintRejected = await expectCallToolFailure(client, {
      name: "memory_retrieve_context",
      arguments: {
        task_request_id: "00000000-0000-4000-8000-000000000111",
        query: "procedural memory",
        fingerprint_status: "matched",
        include_procedural: true,
        include_factual: true
      }
    });
    assert.match(missingFingerprintRejected, /FINGERPRINT_REQUIRED|fingerprint/i);

    const gateResult = await client.callTool({
      name: "rule_gate_check",
      arguments: {
        task_request_id: "00000000-0000-4000-8000-000000000111",
        task_type: "integration",
        host: "codex",
        operation: "write_host_config",
        evidence: {}
      }
    });
    assert.equal(gateResult.isError, undefined);

    const report = {
      client: "generic",
      memory_service_mode: memoryServiceMode,
      memory_service_url: memoryServiceUrl,
      mcp_server_command: `${process.execPath} ${cliPath} start --config ${configPath}`,
      tools_listed: true,
      resources_listed: true,
      memory_health: true,
      memory_query_layer: true,
      memory_defaults_resource: true,
      memory_retrieve_context: true,
      retrieve_context_matched: true,
      retrieve_context_missing_fingerprint_status_rejected: true,
      retrieve_context_missing_fingerprint_rejected: true,
      rule_gate_check: true,
      status: "PASS"
    };

    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify({ report_path: reportPath, ...report }, null, 2)}\n`);
  } finally {
    await client.close();
    await transport.close();
  }
} finally {
  await fakeService?.close();
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
