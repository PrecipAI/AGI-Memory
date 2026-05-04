import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { MemoryMcpConfig, ResolveMemoryMcpConfigOptions } from "./config.js";
import { pathExists, resolveMemoryMcpConfig } from "./config.js";

export const DOCTOR_EXIT_CODES = {
  READY: 0,
  NOT_READY: 1,
  CONFIG_ERROR: 2,
  INTERNAL_ERROR: 3
} as const;

export type DoctorStatus = "PASS" | "FAIL" | "SKIPPED";

export type RunDoctorOptions = ResolveMemoryMcpConfigOptions & {
  executablePath?: string;
};

type DoctorSectionState = {
  configReady: boolean;
  serviceReady: boolean;
  mcpReady: boolean;
};

export async function runDoctor(options: RunDoctorOptions): Promise<number> {
  try {
    const executablePath = options.executablePath ?? fileURLToPath(import.meta.url);
    const nodeMajor = Number(process.versions.node.split(".")[0] ?? "0");
    const resolved = await resolveMemoryMcpConfig(options);
    const state: DoctorSectionState = {
      configReady: false,
      serviceReady: false,
      mcpReady: false
    };

    process.stdout.write("Memory MCP Doctor\n\n");

    if (nodeMajor >= 20) {
      printDoctorLine("PASS", `Node.js >= 20 (${process.versions.node})`);
    } else {
      printDoctorLine("FAIL", `Node.js >= 20 required, found ${process.versions.node}`);
      printDoctorStatus(state, "NOT READY");
      return DOCTOR_EXIT_CODES.NOT_READY;
    }

    if (await pathExists(executablePath)) {
      printDoctorLine("PASS", `Executable entry found: ${executablePath}`);
    } else {
      printDoctorLine("FAIL", `Executable entry missing: ${executablePath}`);
      printDoctorStatus(state, "NOT READY");
      return DOCTOR_EXIT_CODES.INTERNAL_ERROR;
    }

    if (!resolved.configExists) {
      printDoctorLine("FAIL", `Config missing: ${resolved.configPath}`);
      process.stdout.write("\nFix:\n1. Run memory-mcp init\n2. Or specify --config <path>\n");
      printDoctorStatus(state, "NOT READY");
      return DOCTOR_EXIT_CODES.CONFIG_ERROR;
    }

    state.configReady = true;
    printDoctorLine("PASS", `Config found: ${resolved.configPath}`);
    printResolvedConfig(resolved.config, resolved.sources);

    const health = await probeHealth(resolved.config.memoryServiceUrl);
    if (!health.ok) {
      printDoctorLine("FAIL", `memory-service unreachable: ${resolved.config.memoryServiceUrl}`);
      process.stdout.write(
        `\nFix:\n1. Start memory-service first:\n   npm run start:memory-service\n\n2. Or update ${path.relative(options.cwd, resolved.configPath)}:\n   memoryServiceUrl = "http://..."\n\nDetails: ${health.message}\n`
      );
      printDoctorStatus(state, "NOT READY");
      return DOCTOR_EXIT_CODES.NOT_READY;
    }

    state.serviceReady = true;
    printDoctorLine("PASS", `memory-service reachable: ${resolved.config.memoryServiceUrl}`);
    printDoctorLine("PASS", "memory-service /healthz returned ok=true");

    if (health.payload.single_tenant_mode === true) {
      printDoctorLine("PASS", "single_tenant_mode = true");
    } else {
      printDoctorLine("FAIL", "single_tenant_mode must be true for current beta");
      printDoctorStatus(state, "NOT READY");
      return DOCTOR_EXIT_CODES.NOT_READY;
    }

    if (
      health.payload.default_tenant_id === resolved.config.tenantId &&
      health.payload.default_scope === resolved.config.scope
    ) {
      printDoctorLine("PASS", `tenant/scope: ${resolved.config.tenantId} / ${resolved.config.scope}`);
    } else {
      printDoctorLine(
        "FAIL",
        `tenant/scope mismatch: config=${resolved.config.tenantId}/${resolved.config.scope}, health=${health.payload.default_tenant_id}/${health.payload.default_scope}`
      );
      printDoctorStatus(state, "NOT READY");
      return DOCTOR_EXIT_CODES.NOT_READY;
    }

    const probe = await spawnLocalMcpAndProbe({
      executablePath,
      configPath: resolved.configPath,
      cwd: options.cwd
    });
    state.mcpReady = true;
    printDoctorLine("PASS", `tools: ${probe.tools.length}`);
    printDoctorLine("PASS", `resources: ${probe.resources.length}`);
    printDoctorStatus(state, "READY");
    return DOCTOR_EXIT_CODES.READY;
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    printDoctorLine("FAIL", `Internal doctor error: ${message}`);
    printDoctorStatus(
      {
        configReady: false,
        serviceReady: false,
        mcpReady: false
      },
      "NOT READY"
    );
    return DOCTOR_EXIT_CODES.INTERNAL_ERROR;
  }
}

function printDoctorLine(status: DoctorStatus, message: string) {
  process.stdout.write(`[${status}] ${message}\n`);
}

function printDoctorStatus(state: DoctorSectionState, overall: "READY" | "NOT READY") {
  process.stdout.write(
    `\nConfig: ${state.configReady ? "PASS" : "FAIL"}\nMemory Service: ${state.serviceReady ? "PASS" : state.configReady ? "FAIL" : "SKIPPED"}\nMCP Server: ${state.mcpReady ? "PASS" : state.serviceReady ? "FAIL" : "SKIPPED"}\n`
  );
  process.stdout.write(`\nStatus: ${overall}\n`);
}

function printResolvedConfig(
  config: MemoryMcpConfig,
  sources: Record<keyof MemoryMcpConfig, "default" | "config" | "env" | "cli">
) {
  process.stdout.write("\nResolved config\n");
  process.stdout.write(`memoryServiceUrl: ${config.memoryServiceUrl}   source=${sources.memoryServiceUrl}\n`);
  process.stdout.write(`tenantId: ${config.tenantId}   source=${sources.tenantId}\n`);
  process.stdout.write(`scope: ${config.scope}   source=${sources.scope}\n`);
  process.stdout.write(`transport: ${config.transport}   source=${sources.transport}\n`);
  process.stdout.write(
    `defaultFingerprintStatus: ${config.defaultFingerprintStatus}   source=${sources.defaultFingerprintStatus}\n\n`
  );
}

async function probeHealth(memoryServiceUrl: string) {
  try {
    const response = await fetch(new URL("/healthz", memoryServiceUrl), { method: "GET" });
    if (!response.ok) {
      return {
        ok: false as const,
        message: `HTTP ${response.status}`
      };
    }

    return {
      ok: true as const,
      payload: await response.json()
    };
  } catch (error) {
    return {
      ok: false as const,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

async function spawnLocalMcpAndProbe(options: { executablePath: string; configPath: string; cwd: string }) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [options.executablePath, "start", "--config", options.configPath],
    cwd: options.cwd,
    env: buildChildEnv(),
    stderr: "pipe"
  });

  if (transport.stderr) {
    transport.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
    });
  }

  const client = new Client({
    name: "memory-mcp-doctor",
    version: "0.1.0"
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const resources = await client.listResources();
    return {
      tools: tools.tools.map((tool) => tool.name).sort(),
      resources: resources.resources.map((resource) => resource.uri).sort()
    };
  } finally {
    await client.close();
    await transport.close();
  }
}

function buildChildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  return env;
}
