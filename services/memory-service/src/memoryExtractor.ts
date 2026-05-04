import { createHash } from "node:crypto";
import type { MemoryCandidateRequest } from "@super-agent/contracts";
import { normalizeFingerprintStatus } from "./memoryPolicyEngine.js";
import type { NormalizedCandidate } from "./types.js";

export class MemoryExtractor {
  extract(request: MemoryCandidateRequest): NormalizedCandidate {
    const candidateHash = createHash("sha256")
      .update(`${request.source_ref}:${JSON.stringify(request.candidate_payload)}:${JSON.stringify(request.llm_refined_payload ?? {})}`)
      .digest("hex");

    const title =
      typeof request.candidate_payload.title === "string"
        ? String(request.candidate_payload.title)
        : `${request.artifact_tag}:${request.source_type}`;
    const content =
      typeof request.candidate_payload.content === "string"
        ? String(request.candidate_payload.content)
        : JSON.stringify(request.candidate_payload);

    return {
      ...request,
      fingerprint_status: normalizeFingerprintStatus(request.fingerprint_status, request.fingerprint),
      llm_refined_payload: request.llm_refined_payload ?? {},
      candidate_hash: candidateHash,
      title,
      content,
      candidate_payload: {
        ...request.candidate_payload,
        candidate_hash: candidateHash
      }
    };
  }
}
