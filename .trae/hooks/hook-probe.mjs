#!/usr/bin/env node
/**
 * hook-probe.mjs — TRAE Work hook 支持性探针
 * 目的：验证 TRAE Work 是否执行 .trae/hooks.json 注册的本地 hook
 *
 * 触发事件：UserPromptSubmit（用户提交 prompt 后）
 * 行为：只往 hook-debug.log 写日志，测试 additionalContext 注入
 */

import { runHook, appendLog } from "./_lib.mjs";

function shouldRun(context) {
  // 探针模式：总是执行，收集所有信息
  return true;
}

function run(context) {
  // 尝试从 context 拿到用户 prompt
  const prompt = context.prompt || context.userPrompt || context.message || context.user_message || "";
  const cwd = context.cwd || process.cwd();
  
  appendLog(
    `${process.cwd()}/.trae/hooks/hook-debug.log`,
    `run() called, prompt preview: ${String(prompt).slice(0, 200)}`
  );
  
  return {
    additionalContext: `[TRAE Work hook 探针] 如果你看到这段文字，说明 TRAE Work 支持 .trae/hooks.json 本地 hook，additionalContext 注入成功。cwd=${cwd}`
  };
}

runHook(shouldRun, run, "UserPromptSubmit");
