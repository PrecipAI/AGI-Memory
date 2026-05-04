export class RetrievalGate {
  build(input: {
    fingerprint?: string | null;
    fingerprintStatus?: "matched" | "matched_or_na" | "mismatch" | "unknown" | null;
    includeFactual?: boolean;
    includeProcedural?: boolean;
  }) {
    const factualAllowed = input.includeFactual !== false;
    const hasMatchedFingerprint = Boolean(input.fingerprint) && input.fingerprintStatus === "matched";
    const proceduralAllowed = input.includeProcedural !== false && hasMatchedFingerprint;
    const proceduralReason =
      input.includeProcedural === false
        ? "disabled-by-request"
        : !input.fingerprint
          ? "missing-fingerprint"
          : input.fingerprintStatus !== "matched"
            ? "fingerprint-status-not-matched"
            : "fingerprint-matched-path";

    return {
      factual: {
        allowed: factualAllowed,
        reason: factualAllowed ? "enabled" : "disabled-by-request"
      },
      procedural: {
        allowed: proceduralAllowed,
        reason: proceduralAllowed ? "fingerprint-matched-path" : proceduralReason
      }
    };
  }
}
