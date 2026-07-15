import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  GovernanceRunRequest,
  GovernanceRunResponse,
  MemoryCandidateRequest,
  MemoryCandidateResponse,
  MemoryQueryRequest,
  MemoryQueryResponse,
  MemoryRetrieveRequest,
  MemoryRetrieveResponse,
  RuleGateCheckRequest,
  RuleGateCheckResponse,
} from "@super-agent/contracts";
import type { MemoryMcpConfig } from "./config.js";

type EngineCallPath =
  | "/internal/memory/query"
  | "/internal/memory/candidates"
  | "/internal/memory/retrieve"
  | "/internal/memory/governance/run"
  | "/internal/rules/gate/check"
  | (string & {}); // 动态 host-capture URL: /internal/host-capture/{host}/governance-{kind}

export type HostGovernanceRequest = {
  host?: string | null;
  host_home?: string | null;
  codex_home?: string | null;
  thread_id?: string | null;
  max_items?: number | null;
  task_request_id?: string | null;
  fingerprint?: string | null;
  governance_mode?: "rules_fallback" | "host_model" | null;
  host_model_result?: Record<string, unknown> | null;
  preview_token?: string | null;
};

export type HostGovernanceResponse = Record<string, unknown>;

// 向后兼容别名
export type CodexHostGovernanceRequest = HostGovernanceRequest;
export type CodexHostGovernanceResponse = HostGovernanceResponse;

export class MemoryEngineAdapter {
  constructor(private readonly config: MemoryMcpConfig) {}

  getDefaults() {
    return {
      tenant_id: this.config.tenantId,
      scope: this.config.scope,
      transport: this.config.transport,
      memory_service_url: this.config.memoryServiceUrl,
    };
  }

  async getHealth() {
    const response = await fetch(
      new URL("/healthz", this.config.memoryServiceUrl),
      {
        method: "GET",
      },
    );
    if (!response.ok) {
      throw new Error(`memory-service health check failed: ${response.status}`);
    }
    return response.json();
  }

  async query(body: MemoryQueryRequest): Promise<MemoryQueryResponse> {
    return this.call("/internal/memory/query", body);
  }

  async retrieve(body: MemoryRetrieveRequest): Promise<MemoryRetrieveResponse> {
    return this.call("/internal/memory/retrieve", body);
  }

  /**
   * 调 /internal/knowledge/retrieve 召回 synthesized_knowledge（认知层）。
   * Knowledge 层含模型不搜索不思考就得不出的合成认知（limitation/pattern/synthesis 等），
   * memory_retrieve_context 调用后并行调本方法，把 derived_knowledge 合并到返回结果。
   *
   * 设计：不走 runGate 门控（knowledge retrieve 是只读召回，无副作用）。
   * 失败不抛异常（knowledge 召回失败不阻塞 memory 召回），返回空数组。
   */
  async retrieveKnowledge(body: {
    task_request_id: string;
    query: string;
    fingerprint?: string;
    fingerprint_status?: string;
    top_k?: number;
    include_factual?: boolean;
    include_procedural?: boolean;
  }): Promise<{ derived_knowledge: unknown[]; [key: string]: unknown }> {
    const defaults = this.getDefaults();
    const traceId = `trace-memory-mcp-knowledge-${Date.now()}-${randomUUID()}`;
    const idempotencyKey = `memory-mcp:/internal/knowledge/retrieve:${randomUUID()}`;
    try {
      const response = await fetch(
        new URL("/internal/knowledge/retrieve", this.config.memoryServiceUrl),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-tenant-id": defaults.tenant_id,
            "x-scope": defaults.scope,
            "x-trace-id": traceId,
            "idempotency-key": idempotencyKey,
          },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        const bodyText = await response.text();
        if (process.env.MCP_DEBUG_PAYLOAD) {
          console.error(
            `[MCP DEBUG] knowledge retrieve failed: ${response.status} ${bodyText}`,
          );
        }
        return { derived_knowledge: [] };
      }
      const result = await response.json() as { derived_knowledge?: unknown[] };
      return {
        ...result,
        derived_knowledge: Array.isArray(result.derived_knowledge)
          ? result.derived_knowledge
          : [],
      };
    } catch (e) {
      if (process.env.MCP_DEBUG_PAYLOAD) {
        console.error(
          `[MCP DEBUG] knowledge retrieve error: ${(e as Error).message}`,
        );
      }
      return { derived_knowledge: [] };
    }
  }

  async ingestCandidate(
    body: MemoryCandidateRequest,
  ): Promise<MemoryCandidateResponse> {
    return this.call("/internal/memory/candidates", body);
  }

  async previewHostGovernance(
    body: HostGovernanceRequest,
  ): Promise<HostGovernanceResponse> {
    const host = this.normalizeHost(body.host);
    return this.call(
      `/internal/host-capture/${host}/governance-batch-preview`,
      body,
    );
  }

  async runHostGovernance(
    body: HostGovernanceRequest,
  ): Promise<HostGovernanceResponse> {
    const host = this.normalizeHost(body.host);
    return this.call(`/internal/host-capture/${host}/governance-run`, body);
  }

  // 向后兼容别名（旧代码可能仍调旧名）
  async previewCodexHostGovernance(
    body: HostGovernanceRequest,
  ): Promise<HostGovernanceResponse> {
    return this.previewHostGovernance(body);
  }

  async runCodexHostGovernance(
    body: HostGovernanceRequest,
  ): Promise<HostGovernanceResponse> {
    return this.runHostGovernance(body);
  }

  // 与后端 normalizeHost 保持一致：空值默认 codex（向后兼容）
  private normalizeHost(host: string | null | undefined): string {
    if (!host || typeof host !== "string" || !host.trim()) return "codex";
    return host.trim().toLowerCase();
  }

  async runGovernance(
    body: GovernanceRunRequest,
  ): Promise<GovernanceRunResponse> {
    return this.call("/internal/memory/governance/run", body);
  }

  async checkRuleGate(
    body: RuleGateCheckRequest,
  ): Promise<RuleGateCheckResponse> {
    return this.call("/internal/rules/gate/check", body);
  }

  async close(): Promise<void> {
    return;
  }

  /**
   * 运行 gate-runtime 门控检查。
   * exit code 1 = REJECT → 抛异常阻断调用链。
   * 其他情况（PASS / 脚本不存在 / 执行异常）均放行，不阻断。
   */
  private runGate(mountPoint: string, operation: string): void {
    try {
      const here = path.dirname(fileURLToPath(import.meta.url));
      // 向上查找项目根（包含 scripts/gate-runtime.mjs 的目录）
      let dir = here;
      const root = path.parse(dir).root;
      while (dir !== root) {
        if (existsSync(path.join(dir, "scripts", "gate-runtime.mjs"))) break;
        dir = path.dirname(dir);
      }
      const projectRoot = dir;
      const script = path.join(projectRoot, "scripts", "gate-runtime.mjs");
      execSync(
        `node "${script}" --mount-point=${mountPoint} --operation=${operation} --quiet`,
        { cwd: projectRoot, stdio: "pipe", timeout: 5000 },
      );
    } catch (e: any) {
      if (e.status === 1) {
        // gate-runtime REJECT — stdout/stderr 里有具体拦截原因
        const detail = (e.stdout ?? "") + (e.stderr ?? "");
        throw new Error(
          `[gate-runtime] 门控拦截 (${mountPoint}/${operation}):\n${detail}`,
        );
      }
      // exit code 2 (runtime 自身出错) 或脚本不存在 → 不阻断，仅警告
      if (process.env.MCP_DEBUG_PAYLOAD) {
        console.error(
          `[gate-runtime] ${mountPoint}/${operation} 检查异常，放行: ${e.message}`,
        );
      }
    }
  }

  private async call<TResponse>(
    url: EngineCallPath,
    payload:
      | MemoryQueryRequest
      | MemoryRetrieveRequest
      | MemoryCandidateRequest
      | GovernanceRunRequest
      | RuleGateCheckRequest
      | HostGovernanceRequest,
  ): Promise<TResponse> {
    const defaults = this.getDefaults();
    const traceId = `trace-memory-mcp-${Date.now()}-${randomUUID()}`;
    const idempotencyKey = `memory-mcp:${url}:${randomUUID()}`;

    // ── 门控：tool 执行前 ──
    this.runGate("before_tool_call", url);

    if (process.env.MCP_DEBUG_PAYLOAD) {
      console.error(
        `[MCP DEBUG] ${url} payload keys: ${Object.keys(payload ?? {}).join(",")} fingerprint=${(payload as Record<string, unknown>)?.fingerprint ?? "MISSING"}`,
      );
    }
    const response = await fetch(new URL(url, this.config.memoryServiceUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": defaults.tenant_id,
        "x-scope": defaults.scope,
        "x-trace-id": traceId,
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(payload),
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(
        `memory engine call failed for ${url}: ${response.status} ${bodyText || "Unknown MCP adapter failure"}`,
      );
    }

    // ── 门控：tool 执行后 ──
    this.runGate("after_tool_call", url);

    return JSON.parse(bodyText) as TResponse;
  }
}
