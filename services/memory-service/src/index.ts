import { readFileSync } from "fs";
import { resolve } from "path";
import { buildMemoryServiceApp } from "./app.js";

function findEnvPath(): string | undefined {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, ".env");
    try {
      readFileSync(candidate, "utf-8");
      return candidate;
    } catch {
      const parent = resolve(dir, "..");
      if (parent === dir) break;
      dir = parent;
    }
  }
  return undefined;
}

function loadEnv(path: string) {
  try {
    const content = readFileSync(path, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // ignore missing .env
  }
}

const envPath = findEnvPath();
if (envPath) loadEnv(envPath);

const app = buildMemoryServiceApp();
const port = Number(process.env.PORT || 3101);
// 容器/PaaS 环境需要监听 0.0.0.0；本地开发默认 127.0.0.1
const host = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");

app.listen({ port, host }).catch((error) => {
  console.error(error);
  process.exit(1);
});
