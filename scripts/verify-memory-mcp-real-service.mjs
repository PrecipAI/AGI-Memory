import { spawn } from "node:child_process";

const memoryServiceUrl = process.env.MEMORY_SERVICE_URL || "http://127.0.0.1:3101";

async function main() {
  const healthResponse = await fetch(`${memoryServiceUrl}/healthz`).catch((error) => {
    throw new Error(`Memory service is not reachable at ${memoryServiceUrl}: ${error instanceof Error ? error.message : String(error)}`);
  });
  if (!healthResponse.ok) {
    throw new Error(`Memory service health check failed at ${memoryServiceUrl}: HTTP ${healthResponse.status}`);
  }

  await runCommand(process.execPath, ["./scripts/verify-memory-mcp-client-smoke.mjs"], {
    MEMORY_SERVICE_URL: memoryServiceUrl
  });
}

function runCommand(command, args, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...extraEnv
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

await main();
