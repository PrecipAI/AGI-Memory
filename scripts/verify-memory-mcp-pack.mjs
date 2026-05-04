import assert from "node:assert/strict";
import path from "node:path";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { spawn } from "node:child_process";
import { startFakeMemoryService } from "./fake-memory-service.mjs";

const rootDir = process.cwd();
const packageDir = path.join(rootDir, "services", "memory-mcp-server");
const reportPath = path.join(rootDir, "tests", "integration", "mcp-pack-report.json");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const installedBinName = process.platform === "win32" ? "memory-mcp.cmd" : "memory-mcp";

const packDir = await mkdtemp(path.join(os.tmpdir(), "memory-mcp-pack-"));
const installDir = await mkdtemp(path.join(os.tmpdir(), "memory-mcp-install-"));
const appDir = path.join(installDir, "app");
const fakeService = await startFakeMemoryService();
let tarballPath = "";

try {
  await mkdir(appDir, { recursive: true });

  const packResult = await runProgram(npmCommand, ["pack"], packageDir);
  assert.equal(packResult.code, 0, `npm pack failed\nstdout:\n${packResult.stdout}\nstderr:\n${packResult.stderr}`);

  const tarballName = extractTarballName(packResult.stdout);
  tarballPath = path.join(packageDir, tarballName);
  const tarEntries = await listTarEntries(tarballPath);

  assert.ok(tarEntries.includes("package/package.json"));
  assert.ok(tarEntries.includes("package/README.md"));
  assert.ok(tarEntries.some((entry) => entry.startsWith("package/dist/")));
  assert.ok(tarEntries.includes("package/templates/config.json"));
  assert.ok(tarEntries.includes("package/templates/clients/generic-mcp.json"));
  assert.ok(tarEntries.includes("package/templates/clients/codex-config.toml"));
  assert.ok(tarEntries.includes("package/templates/clients/claude-code-project.mcp.json"));
  assert.ok(tarEntries.includes("package/templates/clients/claude-desktop.json"));
  assert.ok(tarEntries.includes("package/templates/clients/opencode.jsonc"));
  assert.ok(tarEntries.includes("package/templates/clients/openclaw-mcp.json"));
  assert.ok(tarEntries.includes("package/templates/clients/agent-memory-policy.md"));
  assert.ok(tarEntries.includes("package/templates/clients/codex-AGENTS-snippet.md"));
  assert.ok(tarEntries.includes("package/templates/clients/claude-CLAUDE-snippet.md"));
  assert.ok(tarEntries.includes("package/templates/clients/opencode-instructions-snippet.md"));
  assert.ok(tarEntries.includes("package/templates/clients/openclaw-skill-snippet.md"));

  const initPackage = await runProgram(npmCommand, ["init", "-y"], appDir);
  assert.equal(initPackage.code, 0);

  const localTarballPath = path.join(appDir, tarballName);
  await copyFile(tarballPath, localTarballPath);
  const installResult = await runProgram(npmCommand, ["install", tarballName], appDir, 180000);
  assert.equal(
    installResult.code,
    0,
    `npm install tarball failed\nstdout:\n${installResult.stdout}\nstderr:\n${installResult.stderr}`
  );

  const binPath = path.join(appDir, "node_modules", ".bin", installedBinName);
  const helpResult = await runProgram(binPath, ["--help"], appDir);
  assert.equal(
    helpResult.code,
    0,
    `installed memory-mcp --help failed\nstdout:\n${helpResult.stdout}\nstderr:\n${helpResult.stderr}`
  );
  assert.match(helpResult.stdout, /memory-mcp init/);

  const initResult = await runProgram(binPath, ["init", "--dir", appDir], appDir);
  assert.equal(
    initResult.code,
    0,
    `installed memory-mcp init failed\nstdout:\n${initResult.stdout}\nstderr:\n${initResult.stderr}`
  );

  const generatedConfigPath = path.join(appDir, ".memory-mcp", "config.json");
  const generatedReadmePath = path.join(appDir, ".memory-mcp", "README.md");
  const generatedTemplates = [
    path.join(appDir, ".memory-mcp", "clients", "generic-mcp.json"),
    path.join(appDir, ".memory-mcp", "clients", "claude-code-project.mcp.json"),
    path.join(appDir, ".memory-mcp", "clients", "claude-desktop.json"),
    path.join(appDir, ".memory-mcp", "clients", "codex-config.toml"),
    path.join(appDir, ".memory-mcp", "clients", "opencode.jsonc"),
    path.join(appDir, ".memory-mcp", "clients", "openclaw-mcp-set.md"),
    path.join(appDir, ".memory-mcp", "clients", "usage-instructions.md"),
    path.join(appDir, ".memory-mcp", "clients", "agent-memory-policy.md"),
    path.join(appDir, ".memory-mcp", "clients", "codex-AGENTS-snippet.md"),
    path.join(appDir, ".memory-mcp", "clients", "claude-CLAUDE-snippet.md"),
    path.join(appDir, ".memory-mcp", "clients", "opencode-instructions-snippet.md"),
    path.join(appDir, ".memory-mcp", "clients", "openclaw-skill-snippet.md")
  ];

  await readFile(generatedConfigPath, "utf8");
  await readFile(generatedReadmePath, "utf8");
  for (const templatePath of generatedTemplates) {
    await readFile(templatePath, "utf8");
  }

  const doctorUnreachable = await runProgram(
    binPath,
    ["doctor", "--config", generatedConfigPath, "--memory-service-url", "http://127.0.0.1:39999"],
    appDir
  );
  assert.equal(doctorUnreachable.code, 1);
  assert.match(doctorUnreachable.stdout, /memory-service unreachable/);
  assert.match(doctorUnreachable.stdout, /Status: NOT READY/);

  const config = JSON.parse(await readFile(generatedConfigPath, "utf8"));
  config.memoryServiceUrl = fakeService.url;
  await writeFile(generatedConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const doctorReady = await runProgram(binPath, ["doctor", "--config", generatedConfigPath], appDir);
  assert.equal(
    doctorReady.code,
    0,
    `installed memory-mcp doctor ready check failed\nstdout:\n${doctorReady.stdout}\nstderr:\n${doctorReady.stderr}`
  );
  assert.match(doctorReady.stdout, /Status: READY/);

  const startHelp = await runProgram(binPath, ["start", "--help"], appDir);
  assert.equal(
    startHelp.code,
    0,
    `installed memory-mcp start --help failed\nstdout:\n${startHelp.stdout}\nstderr:\n${startHelp.stderr}`
  );
  assert.match(startHelp.stdout, /memory-mcp start/);

  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        status: "PASS",
        tarball_name: tarballName,
        tarball_path: tarballPath,
        generated_config_path: generatedConfigPath,
        generated_templates: generatedTemplates,
        generated_readme_path: generatedReadmePath
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
        tarball_name: tarballName
      },
      null,
      2
    )}\n`
  );
} finally {
  await fakeService.close();
  await rm(packDir, { recursive: true, force: true });
  await rm(installDir, { recursive: true, force: true });
  if (tarballPath.length > 0) {
    await rm(tarballPath, { force: true });
  }
}

function extractTarballName(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const tarball = lines.at(-1);
  if (!tarball?.endsWith(".tgz")) {
    throw new Error(`Failed to parse tarball name from npm pack output: ${stdout}`);
  }
  return tarball;
}

function listTarEntries(tarballPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "python",
      [
        "-c",
        "import json, tarfile, sys; tf = tarfile.open(sys.argv[1], 'r:gz'); print(json.dumps(tf.getnames()))",
        tarballPath
      ],
      {
        cwd: rootDir,
        env: {
          ...process.env
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve(JSON.parse(stdout));
        return;
      }
      reject(new Error(`Failed to inspect tarball\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });

    child.on("error", reject);
  });
}

function runProgram(command, args, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const isWindowsCommand = process.platform === "win32" && command.toLowerCase().endsWith(".cmd");
    const child = spawn(isWindowsCommand ? process.env.ComSpec ?? "cmd.exe" : command, isWindowsCommand ? ["/d", "/s", "/c", command, ...args] : args, {
      cwd,
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

    const timer =
      typeof timeoutMs === "number"
        ? setTimeout(() => {
            child.kill("SIGTERM");
          }, timeoutMs)
        : null;

    child.on("exit", (code) => {
      if (timer) {
        clearTimeout(timer);
      }
      resolve({
        code: code ?? 1,
        stdout,
        stderr
      });
    });

    child.on("error", (error) => {
      if (timer) {
        clearTimeout(timer);
      }
      reject(error);
    });
  });
}
