/**
 * MCP Protocol Handshake Test
 * Sends JSON-RPC messages via stdio to the MCP server and captures responses.
 */
import { spawn } from "node:child_process";
import path from "node:path";

const repoRoot = "C:/Users/yangy/.qoderworkcn/workspace/mq988j0j137zwdp8/agi-memory-src";
const cli = `${repoRoot}/services/memory-mcp-server/dist/services/memory-mcp-server/src/cli.js`;
const config = "C:/workspace/projects/agent-memory-knowledge-platform/.memory-mcp/config.json";
const node = "C:/Program Files/nodejs/node.exe";

const child = spawn(node, [`--env-file=${repoRoot}/.env`, cli, "start", "--config", config], {
  cwd: repoRoot,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { /* ignore */ });

function send(msg) {
  child.stdin.write(JSON.stringify(msg) + "\n");
}

// Step 1: Initialize
send({
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test-client", version: "1.0" } }
});

// Step 2: Initialized notification
send({ jsonrpc: "2.0", method: "notifications/initialized" });

// Step 3: List tools
setTimeout(() => {
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
}, 500);

// Collect results
setTimeout(() => {
  const lines = output.split("\n").filter(Boolean);
  console.log(`\nMCP Protocol Test Results`);
  console.log(`${"=".repeat(50)}`);
  console.log(`Total JSON-RPC messages received: ${lines.length}`);

  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      if (msg.id === 1) {
        console.log(`\n[Initialize Response]`);
        console.log(`  Server: ${msg.result?.serverInfo?.name} v${msg.result?.serverInfo?.version}`);
        console.log(`  Protocol: ${msg.result?.protocolVersion}`);
        console.log(`  Capabilities: ${JSON.stringify(msg.result?.capabilities)}`);
      }
      if (msg.id === 2) {
        const tools = msg.result?.tools ?? [];
        console.log(`\n[Tools List] ${tools.length} tools registered:`);
        for (const t of tools) {
          const desc = (t.description || "").slice(0, 80);
          console.log(`  - ${t.name}: ${desc}...`);
        }

        // Check Two-Step Dance tools
        const step1 = tools.find(t => t.name === "memory_preview_host_governance");
        const step2 = tools.find(t => t.name === "memory_run_full_governance");
        console.log(`\n[Two-Step Dance Check]`);
        console.log(`  Step 1 (memory_preview_host_governance): ${step1 ? "REGISTERED" : "MISSING"}`);
        console.log(`  Step 2 (memory_run_full_governance):     ${step2 ? "REGISTERED" : "MISSING"}`);

        if (step1?.description?.includes("TWO-STEP MCP DANCE")) {
          console.log(`  Step 1 description: Contains "TWO-STEP MCP DANCE" marker ✓`);
        }
        if (step2?.description?.includes("TWO-STEP MCP DANCE")) {
          console.log(`  Step 2 description: Contains "TWO-STEP MCP DANCE" marker ✓`);
        }
      }
    } catch {
      // skip non-JSON lines
    }
  }

  child.kill();
  process.exit(0);
}, 2000);
