#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DOCTOR_EXIT_CODES, runDoctor } from "./doctor.js";
import { installHost, type HostInstallTarget } from "./hostInstall.js";
import { initializeMemoryMcp } from "./init.js";
import { resolveMemoryMcpConfig } from "./config.js";
import { buildMemoryMcpServer } from "./server.js";

type CommandName = "init" | "doctor" | "start" | "install-host" | "help";

type ParsedArgs = {
  command: CommandName;
  options: Record<string, string | boolean>;
};

function parseArgs(argv: string[]): ParsedArgs {
  const [commandCandidate, ...rest] = argv;
  const options: Record<string, string | boolean> = {};
  const knownCommands: CommandName[] = ["init", "doctor", "start", "install-host", "help"];
  const command = knownCommands.includes(commandCandidate as CommandName)
    ? (commandCandidate as CommandName)
    : "help";

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--yes" || arg === "-y") {
      options.yes = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = rest[index + 1];
      if (!value || value.startsWith("--")) {
        options[key] = true;
      } else {
        options[key] = value;
        index += 1;
      }
    }
  }

  return {
    command,
    options
  };
}

function printHelp() {
  process.stdout.write(`Memory MCP Beta CLI

Usage:
  memory-mcp init [--dir <working-dir>] [--config .memory-mcp/config.json] [--force]
  memory-mcp install-host --host codex|claude-code [--dir <working-dir>] [--config .memory-mcp/config.json] [--host-config <path>] [--instructions <path>] --yes
  memory-mcp doctor [--dir <working-dir>] [--config .memory-mcp/config.json] [--memory-service-url http://127.0.0.1:3101]
  memory-mcp start [--dir <working-dir>] [--config .memory-mcp/config.json] [--memory-service-url http://127.0.0.1:3101]
  memory-mcp --help
`);
}

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const { command, options } = parseArgs(argv);

  if (options.help || command === "help") {
    printHelp();
    return 0;
  }

  const cwd = resolveCommandCwd(process.cwd(), typeof options.dir === "string" ? options.dir : undefined);
  const configPathInput = typeof options.config === "string" ? options.config : undefined;
  const memoryServiceUrlOverride =
    typeof options["memory-service-url"] === "string" ? options["memory-service-url"] : undefined;

  if (command === "init") {
    const result = await initializeMemoryMcp({
      cwd,
      configPathInput,
      force: Boolean(options.force)
    });

    for (const file of result.files) {
      process.stdout.write(`[${file.status}] ${file.path}\n`);
    }
    process.stdout.write(`\nStatus: ${result.status}\n`);
    return 0;
  }

  if (command === "doctor") {
    return runDoctor({
      cwd,
      configPathInput,
      env: process.env,
      cliOverrides: {
        memoryServiceUrl: memoryServiceUrlOverride
      },
      executablePath: fileURLToPath(import.meta.url)
    });
  }

  if (command === "install-host") {
    const host = options.host;
    if (host !== "codex" && host !== "claude-code") {
      process.stderr.write("install-host requires --host codex|claude-code\n");
      return DOCTOR_EXIT_CODES.CONFIG_ERROR;
    }
    const result = await installHost({
      cwd,
      host: host as HostInstallTarget,
      configPathInput,
      hostConfigPathInput: typeof options["host-config"] === "string" ? options["host-config"] : undefined,
      instructionsPathInput: typeof options.instructions === "string" ? options.instructions : undefined,
      yes: Boolean(options.yes)
    });
    if (result.status === "NEEDS_APPROVAL") {
      process.stdout.write(
        "Status: NEEDS_APPROVAL\n\nThis command writes host config/instruction files. Re-run with --yes after confirming you want backups and edits.\n"
      );
      return DOCTOR_EXIT_CODES.CONFIG_ERROR;
    }
    for (const file of result.files) {
      process.stdout.write(`[${file.status}] ${file.path}${file.backup_path ? `  backup=${file.backup_path}` : ""}\n`);
    }
    process.stdout.write(`\nStatus: ${result.status}\n`);
    return 0;
  }

  if (command === "start") {
    await runStart({
      cwd,
      configPathInput,
      memoryServiceUrlOverride
    });
    return 0;
  }

  printHelp();
  return DOCTOR_EXIT_CODES.NOT_READY;
}

async function runStart(options: {
  cwd: string;
  configPathInput?: string;
  memoryServiceUrlOverride?: string;
}) {
  const resolved = await resolveMemoryMcpConfig({
    cwd: options.cwd,
    configPathInput: options.configPathInput,
    env: process.env,
    cliOverrides: {
      memoryServiceUrl: options.memoryServiceUrlOverride
    }
  });
  const { server, adapter } = buildMemoryMcpServer(resolved.config);

  async function shutdown(exitCode = 0) {
    try {
      await Promise.all([server.close(), adapter.close()]);
    } finally {
      process.exit(exitCode);
    }
  }

  process.on("SIGINT", () => {
    void shutdown(0);
  });

  process.on("SIGTERM", () => {
    void shutdown(0);
  });

  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    await new Promise(() => {
      // Keep stdio transport alive until the host closes the process.
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    await shutdown(DOCTOR_EXIT_CODES.INTERNAL_ERROR);
  }
}

function resolveCommandCwd(cwd: string, inputDir?: string): string {
  if (!inputDir) {
    return cwd;
  }
  return path.isAbsolute(inputDir) ? inputDir : path.resolve(cwd, inputDir);
}

void (async () => {
  const exitCode = await runCli();
  process.exit(exitCode);
})();
