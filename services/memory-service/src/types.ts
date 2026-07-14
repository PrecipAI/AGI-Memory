export type PersistTarget = "memory" | "rule" | "skill" | "resident_candidate" | "summary_only" | "drop" | "block";

export type NormalizedCandidate = {
  task_request_id: string;
  task_step_id: string;
  source_type: string;
  source_ref: string;
  artifact_tag: string;
  layer?: "rule" | "memory" | "skill" | "knowledge" | "evidence" | null;
  error_code?: string | null;
  verification_status: string;
  side_effect_class: string;
  fingerprint?: string | null;
  fingerprint_status: "matched" | "matched_or_na" | "mismatch" | "unknown";
  candidate_payload: Record<string, unknown>;
  llm_refined_payload?: Record<string, unknown>;
  candidate_hash: string;
  title: string;
  content: string;
  rank_score?: number;
  routing_decision?: string;
  persist_target?: PersistTarget;
};
