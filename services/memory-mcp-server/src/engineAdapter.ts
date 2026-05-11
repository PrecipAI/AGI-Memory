import { randomUUID } from "node:crypto";
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
  RuleGateCheckResponse
} from "@super-agent/contracts";
import type { MemoryMcpConfig } from "./config.js";

type EngineCallPath =
  | "/internal/memory/query"
  | "/internal/memory/candidates"
  | "/internal/memory/retrieve"
  | "/internal/host-capture/codex/governance-batch-preview"
  | "/internal/host-capture/codex/governance-run"
  | "/internal/memory/governance/run"
  | "/internal/rules/gate/check";

export type CodexHostGovernanceRequest = {
  codex_home?: string | null;
  thread_id?: string | null;
  max_items?: number | null;
  task_request_id?: string | null;
  fingerprint?: string | null;
  governance_mode?: "rules_fallback" | "host_model" | null;
  host_model_result?: Record<string, unknown> | null;
};

export type CodexHostGovernanceResponse = Record<string, unknown>;

export class MemoryEngineAdapter {
  constructor(private readonly config: MemoryMcpConfig) {}

  getDefaults() {
    return {
      tenant_id: this.config.tenantId,
      scope: this.config.scope,
      transport: this.config.transport,
      memory_service_url: this.config.memoryServiceUrl
    };
  }

  async getHealth() {
    const response = await fetch(new URL("/healthz", this.config.memoryServiceUrl), {
      method: "GET"
    });
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

  async ingestCandidate(body: MemoryCandidateRequest): Promise<MemoryCandidateResponse> {
    return this.call("/internal/memory/candidates", body);
  }

  async previewCodexHostGovernance(body: CodexHostGovernanceRequest): Promise<CodexHostGovernanceResponse> {
    return this.call("/internal/host-capture/codex/governance-batch-preview", body);
  }

  async runCodexHostGovernance(body: CodexHostGovernanceRequest): Promise<CodexHostGovernanceResponse> {
    return this.call("/internal/host-capture/codex/governance-run", body);
  }

  async runGovernance(body: GovernanceRunRequest): Promise<GovernanceRunResponse> {
    return this.call("/internal/memory/governance/run", body);
  }

  async checkRuleGate(body: RuleGateCheckRequest): Promise<RuleGateCheckResponse> {
    return this.call("/internal/rules/gate/check", body);
  }

  async close(): Promise<void> {
    return;
  }

  private async call<TResponse>(
    url: EngineCallPath,
    payload:
      | MemoryQueryRequest
      | MemoryRetrieveRequest
      | MemoryCandidateRequest
      | GovernanceRunRequest
      | RuleGateCheckRequest
      | CodexHostGovernanceRequest
  ): Promise<TResponse> {
    const defaults = this.getDefaults();
    const traceId = `trace-memory-mcp-${Date.now()}-${randomUUID()}`;
    const idempotencyKey = `memory-mcp:${url}:${randomUUID()}`;
    const response = await fetch(new URL(url, this.config.memoryServiceUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": defaults.tenant_id,
        "x-scope": defaults.scope,
        "x-trace-id": traceId,
        "idempotency-key": idempotencyKey
      },
      body: JSON.stringify(payload)
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`memory engine call failed for ${url}: ${response.status} ${bodyText || "Unknown MCP adapter failure"}`);
    }

    return JSON.parse(bodyText) as TResponse;
  }
}
