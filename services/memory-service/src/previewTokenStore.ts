// preview_token 机制：Two-Step MCP Dance 的硬约束层
//
// 解决的问题：
// 之前 governance_mode='host_model' 时 host_model_result 是 optional，模型完全可以
// 跳过 Step 1 直接编一份 extraction_preview 硬传。服务端只校验 schema 格式，
// 不校验"这份 extraction 是不是真的紧跟在一次真实的 Step 1 调用之后"。
//
// 机制：
// 1. Step 1 (preview) 返回 preview_token，内容 = token_id + session_fingerprint + TTL
// 2. Step 2 (run) 必须带 preview_token，服务端校验：
//    - token 存在且未过期
//    - 当前 session 的 fingerprint 与 token 中的 fingerprint 满足"前缀匹配"
//      （Step 2 的 session 必须是 Step 1 session 的超集，允许追加不允许替换）
// 3. 失败直接拒绝，不进入 quarantine 分支
//
// 存储：内存 Map + 定时清扫过期项。单进程足够，memory-service 是单实例。
// 如未来扩多实例，可迁到 Redis，接口不变。

import { randomUUID, createHash } from "node:crypto";

const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 分钟
const CLEANUP_INTERVAL_MS = 60 * 1000; // 每分钟清扫一次过期 token

type StoredToken = {
  token_id: string;
  tenant_id: string;
  scope: string;
  trace_id: string;
  host: string;
  thread_id: string;
  session_file: string;
  // Step 1 时刻的 session 指纹：基于 user_messages 滚动哈希
  // 用于 Step 2 校验"前缀匹配"——Step 2 的 session 必须以 Step 1 的内容为前缀
  session_fingerprint: string;
  // Step 1 时刻的消息总数（用于快速判断 Step 2 是不是追加了内容）
  message_count: number;
  created_at: number;
  expires_at: number;
};

const tokenStore = new Map<string, StoredToken>();
let cleanupTimer: NodeJS.Timeout | null = null;

function ensureCleanupTimer(): void {
  if (cleanupTimer) {
    return;
  }
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, token] of tokenStore) {
      if (token.expires_at <= now) {
        tokenStore.delete(id);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  // 不阻止进程退出
  if (typeof cleanupTimer.unref === "function") {
    cleanupTimer.unref();
  }
}

/**
 * 计算 session 指纹。
 *
 * 用 messages 的 (timestamp + role + text 前缀) 串接后做 SHA-256。
 * 不用全量 text 是为了避免微小差异（比如消息里的时间戳字段）导致哈希不稳；
 * 取前 200 字符足够区分不同消息，又能稳定复现。
 *
 * 字段名是 text（对齐 CaptureMessage），不是 content。
 */
function computeSessionFingerprint(
  messages: Array<{ timestamp?: string | null; role?: string | null; text?: string | null }>
): string {
  const hasher = createHash("sha256");
  for (const msg of messages) {
    const ts = (msg.timestamp ?? "").toString();
    const role = (msg.role ?? "").toString();
    const text = (msg.text ?? "").slice(0, 200);
    hasher.update(`${ts}|${role}|${text}\n`);
  }
  return hasher.digest("hex");
}

export type IssueTokenInput = {
  tenant_id: string;
  scope: string;
  trace_id: string;
  host: string;
  thread_id: string;
  session_file: string;
  user_messages: Array<{ timestamp?: string | null; role?: string | null; text?: string | null }>;
};

export type PreviewToken = {
  token_id: string;
  expires_at: string; // ISO-8601
  session_fingerprint: string;
  message_count: number;
};

/**
 * Step 1 调用：发行一个 preview_token，返回给客户端。
 * 客户端在 Step 2 必须原样带回 token_id。
 */
export function issuePreviewToken(input: IssueTokenInput): PreviewToken {
  ensureCleanupTimer();
  const tokenId = randomUUID();
  const now = Date.now();
  const fingerprint = computeSessionFingerprint(input.user_messages);
  const stored: StoredToken = {
    token_id: tokenId,
    tenant_id: input.tenant_id,
    scope: input.scope,
    trace_id: input.trace_id,
    host: input.host,
    thread_id: input.thread_id,
    session_file: input.session_file,
    session_fingerprint: fingerprint,
    message_count: input.user_messages.length,
    created_at: now,
    expires_at: now + TOKEN_TTL_MS
  };
  tokenStore.set(tokenId, stored);
  return {
    token_id: tokenId,
    expires_at: new Date(stored.expires_at).toISOString(),
    session_fingerprint: fingerprint,
    message_count: stored.message_count
  };
}

export type ValidateTokenInput = {
  token_id: string;
  tenant_id: string;
  scope: string;
  host: string;
  thread_id: string;
  session_file: string;
  user_messages: Array<{ timestamp?: string | null; role?: string | null; text?: string | null }>;
};

export type ValidateTokenResult =
  | { valid: true; stored: StoredToken }
  | { valid: false; error_code: string; message: string };

/**
 * Step 2 调用：校验 preview_token。
 *
 * 前缀匹配语义：
 * - Step 2 的 session_fingerprint 必须与 Step 1 完全一致（同一个 session）
 * - Step 2 的 message_count 必须 >= Step 1 的 message_count（允许追加，不允许缩减）
 * - Step 2 的 user_messages 前 N 条（N=Step 1 message_count）的指纹必须等于 Step 1 的指纹
 *
 * 这样允许用户在 Step 1 之后插话（消息追加），但禁止模型偷换上下文（替换/删除已有消息）。
 */
export function validatePreviewToken(input: ValidateTokenInput): ValidateTokenResult {
  const stored = tokenStore.get(input.token_id);
  if (!stored) {
    return {
      valid: false,
      error_code: "PREVIEW_TOKEN_NOT_FOUND",
      message:
        "preview_token not found or already expired. " +
        "Please call memory_preview_host_governance first to get a fresh token, " +
        "then immediately call memory_run_full_governance with the token."
    };
  }

  const now = Date.now();
  if (stored.expires_at <= now) {
    tokenStore.delete(input.token_id);
    return {
      valid: false,
      error_code: "PREVIEW_TOKEN_EXPIRED",
      message:
        "preview_token has expired. The Two-Step Dance must be completed within 10 minutes. " +
        "Please call memory_preview_host_governance again to get a fresh token."
    };
  }

  // 租户/scope 隔离：不允许跨租户借用 token
  if (
    stored.tenant_id !== input.tenant_id ||
    stored.scope !== input.scope ||
    stored.host !== input.host ||
    stored.thread_id !== input.thread_id ||
    stored.session_file !== input.session_file
  ) {
    return {
      valid: false,
      error_code: "PREVIEW_TOKEN_CONTEXT_MISMATCH",
      message:
        `preview_token was issued for a different context. ` +
        `Expected tenant=${stored.tenant_id} scope=${stored.scope} host=${stored.host} thread=${stored.thread_id} session=${stored.session_file}, ` +
        `got tenant=${input.tenant_id} scope=${input.scope} host=${input.host} thread=${input.thread_id} session=${input.session_file}.`
    };
  }

  // 前缀匹配：Step 2 的消息数必须 >= Step 1
  if (input.user_messages.length < stored.message_count) {
    return {
      valid: false,
      error_code: "PREVIEW_TOKEN_PREFIX_VIOLATION",
      message:
        `preview_token prefix violation: Step 2 has ${input.user_messages.length} user_messages ` +
        `but Step 1 had ${stored.message_count}. Messages cannot be removed between Step 1 and Step 2; ` +
        `only appending is allowed. Please re-run memory_preview_host_governance against the current session.`
    };
  }

  // 取 Step 2 前 N 条消息算指纹，必须与 Step 1 一致
  const prefixMessages = input.user_messages.slice(0, stored.message_count);
  const prefixFingerprint = computeSessionFingerprint(prefixMessages);
  if (prefixFingerprint !== stored.session_fingerprint) {
    return {
      valid: false,
      error_code: "PREVIEW_TOKEN_PREFIX_VIOLATION",
      message:
        `preview_token prefix violation: the first ${stored.message_count} user_messages in Step 2 ` +
        `do not match Step 1. Existing messages cannot be modified; only appending is allowed. ` +
        `Please re-run memory_preview_host_governance against the current session.`
    };
  }

  return { valid: true, stored };
}

/**
 * 消费 token：Step 2 校验通过后调用，防止同一个 token 被重复使用。
 * 同一个 preview_token 只能用于一次 governance-run，避免重放。
 */
export function consumePreviewToken(tokenId: string): void {
  tokenStore.delete(tokenId);
}

/**
 * 测试/运维用：返回当前活跃 token 数（不暴露内容）。
 */
export function getActiveTokenCount(): number {
  return tokenStore.size;
}
