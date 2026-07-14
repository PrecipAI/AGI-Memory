#!/usr/bin/env node
/**
 * 回归测试：验证 _lib.mjs runHook async 包装修复
 * 
 * 问题：runHook 原来是 async 函数，调用时没有 await，导致 Promise 没执行完进程就退出
 * 修复：runHook 改为同步函数，内部用 IIFE 包裹 async 逻辑
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../");

function runHookTest(input) {
  return new Promise((resolve, reject) => {
    const hookPath = path.join(projectRoot, ".trae/hooks/host-rule-e6e2079a7780.mjs");
    const proc = spawn("node", [hookPath], {
      cwd: projectRoot,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => { stdout += data; });
    proc.stderr.on("data", (data) => { stderr += data; });

    proc.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });

    proc.on("error", reject);

    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
  });
}

async function testHookTriggersOnSecretFile() {
  console.log("测试 1: 写入密钥文件应触发 hook 并拒绝...");
  
  const result = await runHookTest({
    tool_input: { file_path: ".env.test" },
    cwd: projectRoot,
  });

  if (result.code !== 2) {
    throw new Error(`期望 exit code 2，实际 ${result.code}。stderr: ${result.stderr}`);
  }

  if (!result.stderr.includes("密钥文件") || !result.stderr.includes(".gitignore")) {
    throw new Error(`期望 stderr 包含"密钥文件"和".gitignore"，实际: ${result.stderr}`);
  }

  const output = JSON.parse(result.stdout);
  if (output.hookSpecificOutput?.permissionDecision !== "deny") {
    throw new Error(`期望 permissionDecision=deny，实际: ${JSON.stringify(output)}`);
  }

  console.log("✓ 测试 1 通过：hook 正确拦截密钥文件写入");
}

async function testHookSkipsNormalFile() {
  console.log("测试 2: 写入普通文件应跳过 hook...");
  
  const result = await runHookTest({
    tool_input: { file_path: "README.md" },
    cwd: projectRoot,
  });

  if (result.code !== 0) {
    throw new Error(`期望 exit code 0（跳过），实际 ${result.code}。stderr: ${result.stderr}`);
  }

  console.log("✓ 测试 2 通过：hook 正确跳过普通文件");
}

async function main() {
  console.log("=== Trae Hook async 包装回归测试 ===\n");

  try {
    await testHookTriggersOnSecretFile();
    await testHookSkipsNormalFile();

    console.log("\n=== 所有测试通过 ===");
    process.exit(0);
  } catch (err) {
    console.error("\n✗ 测试失败:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();