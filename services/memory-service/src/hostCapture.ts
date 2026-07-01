import {
  listCodexHostSessions,
  previewCodexHostCapture,
  type CodexCapturePreviewRequest,
  type CodexCapturePreviewResponse,
  type CodexHostSessionListRequest,
  type CodexHostSessionListResponse,
  type HostCaptureName
} from "./codexHostCapture.js";
import { listGenericHostSessions, previewGenericHostCapture } from "./genericHostCapture.js";
import { listQoderHostSessions, previewQoderHostCapture } from "./qoderCaptureAdapter.js";
import { listTraeHostSessions, previewTraeHostCapture } from "./traeCaptureAdapter.js";

export type HostCapturePreviewRequest = CodexCapturePreviewRequest & {
  host?: HostCaptureName | null;
};

export type HostSessionListRequest = CodexHostSessionListRequest & {
  host?: HostCaptureName | null;
};

export async function previewHostCapture(input: HostCapturePreviewRequest): Promise<CodexCapturePreviewResponse> {
  const host = normalizeHost(input.host);
  if (host === "codex") {
    return previewCodexHostCapture(input);
  }
  if (host === "qoder") {
    return previewQoderHostCapture(input);
  }
  if (host === "trae") {
    return previewTraeHostCapture(input);
  }
  // 所有未识别的宿主（cursor/windsurf/continue/aider/cline 等）走通用适配器
  return previewGenericHostCapture({ ...input, host });
}

export async function listHostSessions(input: HostSessionListRequest): Promise<CodexHostSessionListResponse> {
  const host = normalizeHost(input.host);
  if (host === "codex") {
    return listCodexHostSessions(input);
  }
  if (host === "qoder") {
    return listQoderHostSessions(input);
  }
  if (host === "trae") {
    return listTraeHostSessions(input);
  }
  // 所有未识别的宿主走通用适配器
  return listGenericHostSessions({ ...input, host });
}

// 将已知宿主名归一化为标准名，未知宿主原样返回（交给 genericHostCapture 通用兜底）
// 不再 fallback 到 codex——避免错误地去 ~/.codex/sessions 找别的宿主的会话
export function normalizeHost(host: HostCaptureName | string | null | undefined): string {
  if (!host || typeof host !== "string" || !host.trim()) {
    return "codex";
  }
  const normalized = host.trim().toLowerCase();

  // 已知专属适配器的宿主名原样通过
  if (
    normalized === "codex" ||
    normalized === "claude-code" ||
    normalized === "openclaw" ||
    normalized === "opencode" ||
    normalized === "trae" ||
    normalized === "qoder"
  ) {
    return normalized;
  }

  // 常见宿主别名映射
  const aliases: Record<string, string> = {
    claude: "claude-code",
    claudecode: "claude-code",
    cc: "claude-code",
    qoderwork: "qoder",
    qoderworkcn: "qoder",
    trae_cn: "trae",
    traecn: "trae",
    opencode: "opencode",
    openclaw: "openclaw"
  };
  if (aliases[normalized]) {
    return aliases[normalized];
  }

  // 未知宿主（cursor/windsurf/continue/aider/cline 等）原样返回
  // genericHostCapture 会去 ~/.{host}/ 目录扫描会话文件
  return normalized;
}
