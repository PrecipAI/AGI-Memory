import type { NormalizedCandidate } from "./types.js";

export class CandidateRanker {
  rank(candidate: NormalizedCandidate): number {
    let score = 40;

    if (candidate.verification_status === "verified") {
      score += 25;
    }
    if (candidate.verification_status === "verified_fix") {
      score += 30;
    }
    if (candidate.fingerprint_status === "matched") {
      score += 15;
    }
    if (candidate.fingerprint_status === "matched_or_na") {
      score += 10;
    }
    if (candidate.artifact_tag === "resident_hint") {
      score += 10;
    }
    if (candidate.artifact_tag === "summary_only") {
      score -= 20;
    }
    if (candidate.fingerprint_status === "mismatch") {
      score -= 25;
    }

    return Math.max(0, Math.min(100, score));
  }
}
