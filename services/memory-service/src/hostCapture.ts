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
  return previewGenericHostCapture({ ...input, host });
}

export async function listHostSessions(input: HostSessionListRequest): Promise<CodexHostSessionListResponse> {
  const host = normalizeHost(input.host);
  if (host === "codex") {
    return listCodexHostSessions(input);
  }
  return listGenericHostSessions({ ...input, host });
}

export function normalizeHost(host: HostCaptureName | string | null | undefined): HostCaptureName {
  if (host === "claude-code" || host === "openclaw" || host === "opencode" || host === "codex") {
    return host;
  }
  if (host === "claude" || host === "claudecode") {
    return "claude-code";
  }
  return "codex";
}
