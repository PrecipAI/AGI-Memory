import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { spawn } from "node:child_process";
import { startFakeMemoryService } from "./fake-memory-service.mjs";

const rootDir = process.cwd();
const cliPath = path.join(rootDir, "services", "memory-mcp-server", "dist", "services", "memory-mcp-server", "src", "cli.js");
const packageJsonPath = path.join(rootDir, "services", "memory-mcp-server", "package.json");
const quickstartPath = path.join(rootDir, "services", "memory-mcp-server", "README.md");
const reportPath = path.join(rootDir, "tests", "integration", "mcp-cli-report.json");

const tempDir = await mkdtemp(path.join(os.tmpdir(), "memory-mcp-cli-"));
const fakeService = await startFakeMemoryService();

try {
  const helpResult = await runCli(["--help"], { cwd: rootDir });
  assert.equal(helpResult.code, 0);
  assert.match(helpResult.stdout, /memory-mcp init/);

  const missingConfigResult = await runCli(["doctor", "--dir", tempDir], { cwd: rootDir });
  assert.equal(missingConfigResult.code, 2);
  assert.match(missingConfigResult.stdout, /Config missing/);

  const initResult = await runCli(["init", "--dir", tempDir], { cwd: rootDir });
  assert.equal(initResult.code, 0);
  assert.match(initResult.stdout, /\[CREATE\]/);

  const configPath = path.join(tempDir, ".memory-mcp", "config.json");
  const originalConfigText = await readFile(configPath, "utf8");
  const originalConfig = JSON.parse(originalConfigText);
  originalConfig.logLevel = "debug";
  await writeFile(configPath, `${JSON.stringify(originalConfig, null, 2)}\n`, "utf8");

  const secondInitResult = await runCli(["init", "--dir", tempDir], { cwd: rootDir });
  assert.equal(secondInitResult.code, 0);
  assert.match(secondInitResult.stdout, /\[SKIP\]/);

  const afterSecondInit = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(afterSecondInit.logLevel, "debug");

  const forceInitResult = await runCli(["init", "--dir", tempDir, "--force"], { cwd: rootDir });
  assert.equal(forceInitResult.code, 0);
  assert.match(forceInitResult.stdout, /\[OVERWRITE\]/);

  const afterForceInit = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(afterForceInit.logLevel, "info");
  afterForceInit.memoryServiceUrl = fakeService.url;
  await writeFile(configPath, `${JSON.stringify(afterForceInit, null, 2)}\n`, "utf8");

  const unreachableResult = await runCli(["doctor", "--dir", tempDir, "--memory-service-url", "http://127.0.0.1:39999"], {
    cwd: rootDir
  });
  assert.equal(unreachableResult.code, 1);
  assert.match(unreachableResult.stdout, /memory-service unreachable/);
  assert.match(unreachableResult.stdout, /Fix:/);

  const readyResult = await runCli(["doctor", "--dir", tempDir], { cwd: rootDir });
  assert.equal(readyResult.code, 0);
  assert.match(readyResult.stdout, /Status: READY/);
  assert.match(readyResult.stdout, /tools: 6/);
  assert.match(readyResult.stdout, /resources: 2/);

  const startHelpResult = await runCli(["start", "--help"], { cwd: rootDir });
  assert.equal(startHelpResult.code, 0);
  assert.match(startHelpResult.stdout, /memory-mcp start/);

  const quietStartResult = await probeStartStreams(configPath, tempDir);
  assert.equal(quietStartResult.stdout.trim(), "");
  assert.equal(quietStartResult.stderr.trim(), "");

  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  assert.equal(packageJson.bin["memory-mcp"], "dist/services/memory-mcp-server/src/cli.js");
  assert.equal(Array.isArray(packageJson.files), true);
  assert.equal(packageJson.files.includes("templates"), true);
  assert.equal(packageJson.files.includes("README.md"), true);

  const cliSource = await readFile(cliPath, "utf8");
  assert.equal(cliSource.startsWith("#!/usr/bin/env node"), true);

  const mcpServersTemplates = [
    path.join(tempDir, ".memory-mcp", "clients", "generic-mcp.json"),
    path.join(tempDir, ".memory-mcp", "clients", "claude-code-project.mcp.json"),
    path.join(tempDir, ".memory-mcp", "clients", "claude-desktop.json")
  ];

  for (const templatePath of mcpServersTemplates) {
    const template = JSON.parse(await readFile(templatePath, "utf8"));
    const memoryServer = template.mcpServers["memory-v3"];
    assert.ok(memoryServer);
    assert.match(JSON.stringify(memoryServer.args), /memory-mcp/);

    if (process.platform === "win32") {
      assert.equal(memoryServer.command, "cmd");
      assert.equal(memoryServer.args.includes("npx"), true);
    } else {
      assert.equal(memoryServer.command, "npx");
    }
  }

  const codexConfig = await readFile(path.join(tempDir, ".memory-mcp", "clients", "codex-config.toml"), "utf8");
  assert.match(codexConfig, /\[mcp_servers\.memory-v3\]/);
  assert.match(codexConfig, /enabled = true/);
  assert.match(codexConfig, /memory-mcp/);

  const opencodeConfig = JSON.parse(await readFile(path.join(tempDir, ".memory-mcp", "clients", "opencode.jsonc"), "utf8"));
  assert.equal(opencodeConfig.mcp["memory-v3"].type, "local");
  assert.equal(opencodeConfig.mcp["memory-v3"].enabled, true);
  assert.equal(Array.isArray(opencodeConfig.mcp["memory-v3"].command), true);

  const openclawInstall = await readFile(path.join(tempDir, ".memory-mcp", "clients", "openclaw-mcp-set.md"), "utf8");
  assert.match(openclawInstall, /openclaw mcp set memory-v3/);

  const usageInstructions = await readFile(path.join(tempDir, ".memory-mcp", "clients", "usage-instructions.md"), "utf8");
  assert.match(usageInstructions, /When to retrieve/);

  const agentPolicy = await readFile(path.join(tempDir, ".memory-mcp", "clients", "agent-memory-policy.md"), "utf8");
  assert.match(agentPolicy, /MCP connection only makes tools visible/);
  assert.match(agentPolicy, /rule_gate_check/);

  const codexSnippet = await readFile(path.join(tempDir, ".memory-mcp", "clients", "codex-AGENTS-snippet.md"), "utf8");
  assert.match(codexSnippet, /memory_retrieve_context/);
  assert.match(codexSnippet, /rule_gate_check/);

  const claudeSnippet = await readFile(path.join(tempDir, ".memory-mcp", "clients", "claude-CLAUDE-snippet.md"), "utf8");
  assert.match(claudeSnippet, /fingerprint_status/);
  assert.match(claudeSnippet, /rule_gate_check/);

  const opencodeInstructions = await readFile(path.join(tempDir, ".memory-mcp", "clients", "opencode-instructions-snippet.md"), "utf8");
  assert.match(opencodeInstructions, /OpenCode/);

  const openclawSkill = await readFile(path.join(tempDir, ".memory-mcp", "clients", "openclaw-skill-snippet.md"), "utf8");
  assert.match(openclawSkill, /OpenClaw/);

  const quickstart = await readFile(quickstartPath, "utf8");
  assert.match(quickstart, /npx memory-mcp doctor/);

  const installNeedsApproval = await runCli(
    [
      "install-host",
      "--dir",
      tempDir,
      "--host",
      "codex",
      "--host-config",
      path.join(tempDir, "codex", "config.toml"),
      "--instructions",
      path.join(tempDir, "codex", "AGENTS.md")
    ],
    { cwd: rootDir }
  );
  assert.equal(installNeedsApproval.code, 2);
  assert.match(installNeedsApproval.stdout, /NEEDS_APPROVAL/);

  const codexHostConfigPath = path.join(tempDir, "codex", "config.toml");
  const codexInstructionsPath = path.join(tempDir, "codex", "AGENTS.md");
  await mkdir(path.dirname(codexHostConfigPath), { recursive: true });
  await writeFile(codexHostConfigPath, "# existing codex config\n", "utf8");
  await writeFile(codexInstructionsPath, "# Existing Agents\n", "utf8");
  const codexInstall = await runCli(
    [
      "install-host",
      "--dir",
      tempDir,
      "--host",
      "codex",
      "--host-config",
      codexHostConfigPath,
      "--instructions",
      codexInstructionsPath,
      "--yes"
    ],
    { cwd: rootDir }
  );
  assert.equal(codexInstall.code, 0);
  assert.match(codexInstall.stdout, /Status: INSTALLED/);
  assert.match(codexInstall.stdout, /backup=/);
  const installedCodexConfig = await readFile(codexHostConfigPath, "utf8");
  assert.match(installedCodexConfig, /\[mcp_servers\.memory-v3\]/);
  assert.match(installedCodexConfig, /memory-mcp/);
  const installedCodexInstructions = await readFile(codexInstructionsPath, "utf8");
  assert.match(installedCodexInstructions, /rule_gate_check/);

  const claudeHostConfigPath = path.join(tempDir, "claude", ".mcp.json");
  const claudeInstructionsPath = path.join(tempDir, "claude", "CLAUDE.md");
  await mkdir(path.dirname(claudeHostConfigPath), { recursive: true });
  await writeFile(claudeHostConfigPath, `${JSON.stringify({ mcpServers: { existing: { command: "existing" } } }, null, 2)}\n`, "utf8");
  await writeFile(claudeInstructionsPath, "# Existing Claude\n", "utf8");
  const claudeInstall = await runCli(
    [
      "install-host",
      "--dir",
      tempDir,
      "--host",
      "claude-code",
      "--host-config",
      claudeHostConfigPath,
      "--instructions",
      claudeInstructionsPath,
      "--yes"
    ],
    { cwd: rootDir }
  );
  assert.equal(claudeInstall.code, 0);
  const installedClaudeConfig = JSON.parse(await readFile(claudeHostConfigPath, "utf8"));
  assert.ok(installedClaudeConfig.mcpServers.existing);
  assert.ok(installedClaudeConfig.mcpServers["memory-v3"]);
  const installedClaudeInstructions = await readFile(claudeInstructionsPath, "utf8");
  assert.match(installedClaudeInstructions, /rule_gate_check/);

  const generatedTemplates = [
    ...mcpServersTemplates,
    path.join(tempDir, ".memory-mcp", "clients", "codex-config.toml"),
    path.join(tempDir, ".memory-mcp", "clients", "opencode.jsonc"),
    path.join(tempDir, ".memory-mcp", "clients", "openclaw-mcp.json"),
    path.join(tempDir, ".memory-mcp", "clients", "openclaw-mcp-set.md"),
    path.join(tempDir, ".memory-mcp", "clients", "usage-instructions.md"),
    path.join(tempDir, ".memory-mcp", "clients", "agent-memory-policy.md"),
    path.join(tempDir, ".memory-mcp", "clients", "codex-AGENTS-snippet.md"),
    path.join(tempDir, ".memory-mcp", "clients", "claude-CLAUDE-snippet.md"),
    path.join(tempDir, ".memory-mcp", "clients", "opencode-instructions-snippet.md"),
    path.join(tempDir, ".memory-mcp", "clients", "openclaw-skill-snippet.md")
  ];

  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        commands: ["memory-mcp --help", "memory-mcp init", "memory-mcp doctor", "memory-mcp start --help"],
        generated_config_path: configPath,
        generated_templates: generatedTemplates,
        quickstart_path: quickstartPath,
        status: "PASS"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        report_path: reportPath,
        config_path: configPath,
        quickstart_path: quickstartPath
      },
      null,
      2
    )}\n`
  );
} finally {
  await fakeService.close();
  await rm(tempDir, { recursive: true, force: true });
}

function runCli(args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: options.cwd,
      env: {
        ...process.env
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("exit", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr
      });
    });
    child.on("error", reject);
  });
}

function probeStartStreams(configPath, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, "start", "--config", configPath], {
      cwd,
      env: {
        ...process.env
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);

    setTimeout(() => {
      child.kill("SIGTERM");
    }, 500);

    child.on("exit", () => {
      resolve({ stdout, stderr });
    });
  });
}
