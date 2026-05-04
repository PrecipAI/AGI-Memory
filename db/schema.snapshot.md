# Schema Snapshot

- generated_at: 2026-05-04T11:14:18.811Z
- database: super_agent_system
- host: 127.0.0.1:55432

## Tables

- `artifact`
- `capability_registry`
- `cleanup_dlq`
- `cleanup_incident_cluster`
- `compensation_capsule`
- `conversation_summary`
- `dependency_state`
- `drift_check_result`
- `environment_fingerprint`
- `execution_journal`
- `extension_pack`
- `failure_event`
- `governance_change_proposal`
- `kp_candidate_link`
- `kp_context_bundle`
- `kp_document`
- `kp_entity`
- `kp_evidence`
- `kp_fact`
- `kp_governance_cleaning_log`
- `kp_governance_decision`
- `kp_governance_job`
- `kp_object_revision`
- `kp_recall_surface_state`
- `kp_relation`
- `kp_review_queue`
- `kp_section`
- `kp_synthesized_knowledge`
- `kp_synthesized_knowledge_evidence`
- `memory`
- `memory_access_log`
- `memory_candidate`
- `message`
- `reconciliation_item`
- `resident_snapshot`
- `rule`
- `rule_checkpoint`
- `rule_conflict`
- `rule_gate_audit`
- `schema_migrations`
- `skill`
- `task_attempt`
- `task_binding`
- `task_plan`
- `task_request`
- `task_result`
- `task_run`
- `task_step`
- `verification_result`
- `zombie_state`

## Enum Types

- `fingerprint_status`: matched, matched_or_na, mismatch, unknown
- `memory_candidate_status`: extracted, ranked, routed, persisted, dropped, blocked
- `record_status`: active, disabled, retired, superseded, dirty, rebuilding, recorded, parked, resolved
- `risk_level`: low, medium, high, critical
- `side_effect_class`: none, read_only, external_resource, state_change, approval
- `stream_state`: provisional, committed, revoked, replanned, blocked
- `task_plan_status`: draft, resolved, approved, executing, replanned, finalized
- `task_request_status`: requested, planned, running, blocked, succeeded, failed, aborting, closed_clean, closed_partial, dlq_parked, quarantined_drifted, manual_recovery_required, cancelled
- `task_result_status`: open, finalized, revoked, blocked, failed
- `task_run_status`: created, running, succeeded, failed, aborting
- `task_step_status`: pending, ready, running, blocked, succeeded, failed, cancelled, aborting
- `verification_phase`: precheck, postcheck, acceptance, cleanup
- `verification_verdict`: passed, failed, waived

## Columns

### `artifact`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `task_request_id` | `uuid` | `NO` |
| `task_plan_id` | `uuid` | `YES` |
| `task_step_id` | `uuid` | `YES` |
| `artifact_type` | `text` | `NO` |
| `artifact_tag` | `text` | `NO` |
| `content` | `text` | `YES` |
| `structured_payload` | `jsonb` | `NO` |
| `verification_status` | `text` | `NO` |
| `side_effect_class` | `USER-DEFINED` | `NO` |
| `source_ref` | `text` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `capability_registry`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `capability_key` | `text` | `NO` |
| `capability_type` | `text` | `NO` |
| `display_name` | `text` | `NO` |
| `endpoint_ref` | `text` | `NO` |
| `task_types` | `ARRAY` | `NO` |
| `risk_level` | `USER-DEFINED` | `NO` |
| `fingerprint_requirement` | `text` | `YES` |
| `approval_mode` | `text` | `NO` |
| `input_schema_ref` | `text` | `NO` |
| `output_schema_ref` | `text` | `NO` |
| `metadata` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `cleanup_dlq`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `task_request_id` | `uuid` | `NO` |
| `task_plan_id` | `uuid` | `NO` |
| `task_step_id` | `uuid` | `YES` |
| `dependency_id` | `text` | `NO` |
| `error_signature` | `text` | `NO` |
| `compensator_id` | `text` | `NO` |
| `fingerprint` | `text` | `NO` |
| `failure_window_start` | `timestamp with time zone` | `NO` |
| `failure_window_end` | `timestamp with time zone` | `NO` |
| `retry_count` | `integer` | `NO` |
| `replay_after` | `timestamp with time zone` | `YES` |
| `frozen_scope` | `boolean` | `NO` |
| `last_failure_payload` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `cleanup_incident_cluster`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `dependency_id` | `text` | `NO` |
| `error_signature` | `text` | `NO` |
| `compensator_id` | `text` | `NO` |
| `fingerprint` | `text` | `NO` |
| `failure_window_start` | `timestamp with time zone` | `NO` |
| `failure_window_end` | `timestamp with time zone` | `NO` |
| `affected_item_count` | `integer` | `NO` |
| `dependency_state_snapshot` | `text` | `NO` |
| `thaw_eligible` | `boolean` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `compensation_capsule`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `task_request_id` | `uuid` | `NO` |
| `task_plan_id` | `uuid` | `NO` |
| `task_step_id` | `uuid` | `NO` |
| `side_effect_class` | `USER-DEFINED` | `NO` |
| `idempotency_key` | `text` | `NO` |
| `target_dependency` | `text` | `NO` |
| `compensator_id` | `text` | `NO` |
| `compensator_version` | `text` | `NO` |
| `resource_locator` | `jsonb` | `NO` |
| `request_payload_hash` | `text` | `NO` |
| `precondition_snapshot` | `jsonb` | `NO` |
| `cleanup_precondition` | `jsonb` | `YES` |
| `fingerprint_at_execution` | `text` | `NO` |
| `committed_resource_id` | `text` | `YES` |
| `response_handle` | `text` | `YES` |
| `revision` | `text` | `YES` |
| `capsule_payload` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `conversation_summary`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `task_request_id` | `uuid` | `NO` |
| `summary_key` | `text` | `NO` |
| `summary_type` | `text` | `NO` |
| `source_range_start` | `integer` | `NO` |
| `source_range_end` | `integer` | `NO` |
| `summary_payload` | `jsonb` | `NO` |
| `supersedes_id` | `uuid` | `YES` |
| `rebuild_status` | `text` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `dependency_state`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `text` | `NO` |
| `version` | `integer` | `NO` |
| `dependency_id` | `text` | `NO` |
| `display_name` | `text` | `NO` |
| `last_probe_result` | `jsonb` | `YES` |
| `failure_rate` | `numeric` | `YES` |
| `last_failure_at` | `timestamp with time zone` | `YES` |
| `last_recovered_at` | `timestamp with time zone` | `YES` |
| `half_open_since` | `timestamp with time zone` | `YES` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `drift_check_result`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `task_request_id` | `uuid` | `NO` |
| `task_step_id` | `uuid` | `YES` |
| `resource_locator` | `jsonb` | `NO` |
| `probe_payload` | `jsonb` | `NO` |
| `match_result` | `text` | `NO` |
| `drift_reason` | `text` | `YES` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `environment_fingerprint`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `fingerprint_key` | `text` | `NO` |
| `capability_version` | `text` | `NO` |
| `config_hash` | `text` | `NO` |
| `schema_version` | `text` | `NO` |
| `dependency_signature` | `text` | `NO` |
| `deployment_baseline_id` | `text` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `execution_journal`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `task_request_id` | `uuid` | `NO` |
| `task_plan_id` | `uuid` | `NO` |
| `task_step_id` | `uuid` | `NO` |
| `journal_seq` | `bigint` | `NO` |
| `checkpoint` | `text` | `NO` |
| `effect_phase` | `text` | `NO` |
| `dependency_id` | `text` | `YES` |
| `resource_locator` | `jsonb` | `YES` |
| `payload_hash` | `text` | `YES` |
| `journal_payload` | `jsonb` | `NO` |
| `idempotency_key` | `text` | `NO` |
| `trace_id` | `text` | `NO` |
| `occurred_at` | `timestamp with time zone` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `extension_pack`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `pack_key` | `text` | `NO` |
| `title` | `text` | `NO` |
| `description` | `text` | `NO` |
| `author_ref` | `text` | `YES` |
| `source_ref` | `text` | `YES` |
| `risk_level` | `USER-DEFINED` | `NO` |
| `activation_policy` | `jsonb` | `NO` |
| `metadata` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `failure_event`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `task_request_id` | `uuid` | `NO` |
| `task_plan_id` | `uuid` | `NO` |
| `task_step_id` | `uuid` | `YES` |
| `failure_code` | `text` | `NO` |
| `failure_class` | `text` | `NO` |
| `error_signature` | `text` | `NO` |
| `dependency_id` | `text` | `YES` |
| `retryable` | `boolean` | `NO` |
| `severity` | `smallint` | `NO` |
| `verifier_phase` | `USER-DEFINED` | `YES` |
| `detail_payload` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `occurred_at` | `timestamp with time zone` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `governance_change_proposal`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `target_object_type` | `text` | `NO` |
| `target_object_id` | `uuid` | `YES` |
| `proposed_action` | `text` | `NO` |
| `proposed_payload` | `jsonb` | `NO` |
| `reason` | `text` | `NO` |
| `risk_level` | `USER-DEFINED` | `NO` |
| `source_ref` | `text` | `YES` |
| `human_decision` | `text` | `YES` |
| `human_response` | `jsonb` | `YES` |
| `decided_at` | `timestamp with time zone` | `YES` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `kp_candidate_link`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `candidate_id` | `uuid` | `NO` |
| `target_object_type` | `text` | `NO` |
| `target_object_id` | `uuid` | `NO` |
| `link_role` | `text` | `NO` |
| `metadata` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `kp_context_bundle`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `request_ref` | `text` | `NO` |
| `bundle_type` | `text` | `NO` |
| `summary` | `text` | `YES` |
| `facts` | `jsonb` | `NO` |
| `entities` | `jsonb` | `NO` |
| `relations` | `jsonb` | `NO` |
| `evidence_refs` | `jsonb` | `NO` |
| `section_refs` | `jsonb` | `NO` |
| `warnings` | `jsonb` | `NO` |
| `assembly_trace` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `kp_document`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `memory_domain` | `text` | `NO` |
| `object_type` | `text` | `NO` |
| `lifecycle_state` | `text` | `NO` |
| `review_state` | `text` | `NO` |
| `title` | `text` | `NO` |
| `source_type` | `text` | `NO` |
| `source_uri` | `text` | `NO` |
| `source_hash` | `text` | `YES` |
| `author` | `text` | `YES` |
| `language` | `text` | `YES` |
| `captured_at` | `timestamp with time zone` | `YES` |
| `published_at` | `timestamp with time zone` | `YES` |
| `valid_from` | `timestamp with time zone` | `YES` |
| `valid_to` | `timestamp with time zone` | `YES` |
| `metadata` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |
| `markdown_content` | `text` | `YES` |
| `markdown_content_hash` | `text` | `YES` |
| `markdown_content_ref` | `text` | `YES` |
| `markdown_converted_at` | `timestamp with time zone` | `YES` |
| `markdown_converter` | `text` | `YES` |

### `kp_entity`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `memory_domain` | `text` | `NO` |
| `object_type` | `text` | `NO` |
| `lifecycle_state` | `text` | `NO` |
| `review_state` | `text` | `NO` |
| `entity_type` | `text` | `NO` |
| `canonical_name` | `text` | `NO` |
| `aliases` | `ARRAY` | `NO` |
| `slug` | `text` | `NO` |
| `summary` | `text` | `YES` |
| `valid_from` | `timestamp with time zone` | `YES` |
| `valid_to` | `timestamp with time zone` | `YES` |
| `last_verified_at` | `timestamp with time zone` | `YES` |
| `review_at` | `timestamp with time zone` | `YES` |
| `staleness_score` | `numeric` | `YES` |
| `metadata` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `kp_evidence`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `memory_domain` | `text` | `NO` |
| `object_type` | `text` | `NO` |
| `lifecycle_state` | `text` | `NO` |
| `review_state` | `text` | `NO` |
| `evidence_type` | `text` | `NO` |
| `source_type` | `text` | `NO` |
| `source_uri` | `text` | `NO` |
| `raw_ref` | `text` | `YES` |
| `content_excerpt` | `text` | `YES` |
| `content_hash` | `text` | `YES` |
| `trust_level` | `text` | `NO` |
| `captured_at` | `timestamp with time zone` | `YES` |
| `metadata` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `kp_fact`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `memory_domain` | `text` | `NO` |
| `object_type` | `text` | `NO` |
| `lifecycle_state` | `text` | `NO` |
| `review_state` | `text` | `NO` |
| `fact_kind` | `text` | `NO` |
| `fact_subtype` | `text` | `YES` |
| `subject_entity_id` | `uuid` | `YES` |
| `title` | `text` | `NO` |
| `statement` | `text` | `NO` |
| `normalized_statement` | `text` | `NO` |
| `confidence_score` | `numeric` | `NO` |
| `importance` | `integer` | `NO` |
| `verification_status` | `text` | `NO` |
| `valid_from` | `timestamp with time zone` | `YES` |
| `valid_to` | `timestamp with time zone` | `YES` |
| `last_verified_at` | `timestamp with time zone` | `YES` |
| `review_at` | `timestamp with time zone` | `YES` |
| `staleness_score` | `numeric` | `YES` |
| `supersedes_fact_id` | `uuid` | `YES` |
| `metadata` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `kp_governance_cleaning_log`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `governance_job_id` | `uuid` | `NO` |
| `document_id` | `uuid` | `NO` |
| `cleaning_type` | `text` | `NO` |
| `before_hash` | `text` | `YES` |
| `after_hash` | `text` | `YES` |
| `removed_sections_summary` | `jsonb` | `NO` |
| `removed_line_count` | `integer` | `NO` |
| `kept_line_count` | `integer` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `kp_governance_decision`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `governance_job_id` | `uuid` | `NO` |
| `governance_type` | `text` | `NO` |
| `target_object_type` | `text` | `NO` |
| `target_object_id` | `uuid` | `YES` |
| `decision` | `text` | `NO` |
| `confidence_score` | `numeric` | `NO` |
| `risk_level` | `USER-DEFINED` | `NO` |
| `evidence_refs` | `jsonb` | `NO` |
| `reason` | `text` | `NO` |
| `before_state` | `jsonb` | `NO` |
| `after_state` | `jsonb` | `NO` |
| `model_name` | `text` | `NO` |
| `prompt_version` | `text` | `NO` |
| `ruleset_version` | `text` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `kp_governance_job`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `job_type` | `text` | `NO` |
| `trigger_type` | `text` | `NO` |
| `trigger_ref` | `text` | `YES` |
| `target_object_type` | `text` | `YES` |
| `target_object_ids` | `jsonb` | `NO` |
| `priority` | `integer` | `NO` |
| `run_status` | `text` | `NO` |
| `requested_by` | `text` | `YES` |
| `payload` | `jsonb` | `NO` |
| `result_payload` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `started_at` | `timestamp with time zone` | `YES` |
| `finished_at` | `timestamp with time zone` | `YES` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `kp_object_revision`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `governance_job_id` | `uuid` | `YES` |
| `object_type` | `text` | `NO` |
| `object_id` | `uuid` | `NO` |
| `revision_type` | `text` | `NO` |
| `before_state` | `jsonb` | `NO` |
| `after_state` | `jsonb` | `NO` |
| `reason` | `text` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |

### `kp_recall_surface_state`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `object_type` | `text` | `NO` |
| `object_id` | `uuid` | `NO` |
| `recall_state` | `text` | `NO` |
| `context_assembly_state` | `text` | `NO` |
| `governance_job_id` | `uuid` | `YES` |
| `reason` | `text` | `NO` |
| `metadata` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `kp_relation`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `memory_domain` | `text` | `NO` |
| `object_type` | `text` | `NO` |
| `lifecycle_state` | `text` | `NO` |
| `review_state` | `text` | `NO` |
| `relation_type` | `text` | `NO` |
| `from_object_type` | `text` | `NO` |
| `from_object_id` | `uuid` | `NO` |
| `to_object_type` | `text` | `NO` |
| `to_object_id` | `uuid` | `NO` |
| `statement` | `text` | `YES` |
| `confidence_score` | `numeric` | `NO` |
| `valid_from` | `timestamp with time zone` | `YES` |
| `valid_to` | `timestamp with time zone` | `YES` |
| `last_verified_at` | `timestamp with time zone` | `YES` |
| `review_at` | `timestamp with time zone` | `YES` |
| `staleness_score` | `numeric` | `YES` |
| `metadata` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `kp_review_queue`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `target_object_type` | `text` | `NO` |
| `target_object_id` | `uuid` | `NO` |
| `review_reason` | `text` | `NO` |
| `priority` | `integer` | `NO` |
| `assigned_to` | `text` | `YES` |
| `payload` | `jsonb` | `NO` |
| `resolution_action` | `text` | `YES` |
| `resolution_payload` | `jsonb` | `YES` |
| `resolved_at` | `timestamp with time zone` | `YES` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `kp_section`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `document_id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `memory_domain` | `text` | `NO` |
| `object_type` | `text` | `NO` |
| `lifecycle_state` | `text` | `NO` |
| `review_state` | `text` | `NO` |
| `heading_path` | `ARRAY` | `NO` |
| `section_key` | `text` | `NO` |
| `ordinal` | `integer` | `NO` |
| `title` | `text` | `YES` |
| `summary` | `text` | `YES` |
| `content` | `text` | `NO` |
| `content_hash` | `text` | `YES` |
| `token_count` | `integer` | `YES` |
| `metadata` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `kp_synthesized_knowledge`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `memory_domain` | `text` | `NO` |
| `lifecycle_state` | `text` | `NO` |
| `review_state` | `text` | `NO` |
| `recall_state` | `text` | `NO` |
| `knowledge_type` | `text` | `NO` |
| `title` | `text` | `NO` |
| `content` | `text` | `NO` |
| `normalized_content` | `text` | `NO` |
| `source_object_ids` | `jsonb` | `NO` |
| `evidence_ids` | `jsonb` | `NO` |
| `reasoning_summary` | `text` | `NO` |
| `confidence_score` | `numeric` | `NO` |
| `risk_level` | `USER-DEFINED` | `NO` |
| `governance_job_id` | `uuid` | `YES` |
| `metadata` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `kp_synthesized_knowledge_evidence`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `synthesized_knowledge_id` | `uuid` | `NO` |
| `evidence_id` | `uuid` | `NO` |
| `source_object_type` | `text` | `NO` |
| `source_object_id` | `uuid` | `NO` |
| `support_role` | `text` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |

### `memory`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `memory_type` | `text` | `NO` |
| `title` | `text` | `NO` |
| `content` | `text` | `NO` |
| `normalized_content` | `text` | `YES` |
| `source_kind` | `text` | `NO` |
| `source_ref` | `text` | `NO` |
| `verification_status` | `text` | `NO` |
| `fingerprint_requirement` | `text` | `YES` |
| `tags` | `ARRAY` | `NO` |
| `metadata` | `jsonb` | `NO` |
| `importance` | `smallint` | `NO` |
| `confidence_score` | `numeric` | `NO` |
| `supersedes_id` | `uuid` | `YES` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `memory_access_log`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `memory_id` | `uuid` | `YES` |
| `query_kind` | `text` | `NO` |
| `query_payload` | `jsonb` | `NO` |
| `decision_payload` | `jsonb` | `NO` |
| `object_type` | `text` | `NO` |
| `object_ref` | `text` | `YES` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `memory_candidate`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `task_request_id` | `uuid` | `NO` |
| `task_step_id` | `uuid` | `YES` |
| `source_type` | `text` | `NO` |
| `source_ref` | `text` | `NO` |
| `artifact_tag` | `text` | `NO` |
| `error_code` | `text` | `YES` |
| `verification_status` | `text` | `NO` |
| `side_effect_class` | `USER-DEFINED` | `NO` |
| `fingerprint` | `text` | `YES` |
| `fingerprint_status` | `USER-DEFINED` | `NO` |
| `routing_decision` | `text` | `YES` |
| `rank_score` | `numeric` | `NO` |
| `persist_target` | `text` | `YES` |
| `candidate_payload` | `jsonb` | `NO` |
| `llm_refined_payload` | `jsonb` | `YES` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `message`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `task_request_id` | `uuid` | `NO` |
| `role` | `text` | `NO` |
| `content` | `text` | `NO` |
| `normalized_content` | `text` | `YES` |
| `message_type` | `text` | `NO` |
| `metadata` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `reconciliation_item`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `task_request_id` | `uuid` | `NO` |
| `task_step_id` | `uuid` | `YES` |
| `reconciliation_type` | `text` | `NO` |
| `expected_state` | `jsonb` | `NO` |
| `observed_state` | `jsonb` | `NO` |
| `action_state` | `text` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `resident_snapshot`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `snapshot_key` | `text` | `NO` |
| `snapshot_payload` | `jsonb` | `NO` |
| `source_memory_ids` | `ARRAY` | `NO` |
| `source_skill_ids` | `ARRAY` | `NO` |
| `dirty_reason` | `text` | `YES` |
| `generated_at` | `timestamp with time zone` | `NO` |
| `expires_at` | `timestamp with time zone` | `YES` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `rule`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `rule_key` | `text` | `NO` |
| `rule_type` | `text` | `NO` |
| `title` | `text` | `NO` |
| `statement` | `text` | `NO` |
| `normalized_statement` | `text` | `NO` |
| `applies_to` | `jsonb` | `NO` |
| `trigger_conditions` | `jsonb` | `NO` |
| `enforcement_level` | `text` | `NO` |
| `priority` | `smallint` | `NO` |
| `risk_level` | `USER-DEFINED` | `NO` |
| `verification_status` | `text` | `NO` |
| `source_refs` | `jsonb` | `NO` |
| `evidence_refs` | `jsonb` | `NO` |
| `supersedes_rule_id` | `uuid` | `YES` |
| `metadata` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `rule_checkpoint`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `rule_id` | `uuid` | `NO` |
| `checkpoint_key` | `text` | `NO` |
| `checkpoint_phase` | `text` | `NO` |
| `operation` | `text` | `YES` |
| `requirement` | `text` | `NO` |
| `evidence_required` | `jsonb` | `NO` |
| `verifier_ref` | `text` | `YES` |
| `failure_behavior` | `text` | `NO` |
| `priority` | `smallint` | `NO` |
| `metadata` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `rule_conflict`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `left_rule_id` | `uuid` | `NO` |
| `right_rule_id` | `uuid` | `NO` |
| `conflict_type` | `text` | `NO` |
| `severity` | `USER-DEFINED` | `NO` |
| `resolution_action` | `text` | `NO` |
| `details` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `rule_gate_audit`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `task_request_id` | `uuid` | `YES` |
| `task_step_id` | `uuid` | `YES` |
| `rule_id` | `uuid` | `YES` |
| `checkpoint_id` | `uuid` | `YES` |
| `gate_key` | `text` | `NO` |
| `operation` | `text` | `NO` |
| `decision` | `text` | `NO` |
| `evidence` | `jsonb` | `NO` |
| `reason` | `text` | `YES` |
| `actor_ref` | `text` | `YES` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `schema_migrations`

| column | data_type | nullable |
|---|---|---|
| `filename` | `text` | `NO` |
| `applied_at` | `timestamp with time zone` | `NO` |

### `skill`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `skill_key` | `text` | `NO` |
| `title` | `text` | `NO` |
| `description` | `text` | `NO` |
| `skill_type` | `text` | `NO` |
| `trigger_conditions` | `jsonb` | `NO` |
| `procedure_payload` | `jsonb` | `NO` |
| `verification_status` | `text` | `NO` |
| `fingerprint_requirement` | `text` | `YES` |
| `risk_level` | `USER-DEFINED` | `NO` |
| `success_rate` | `numeric` | `YES` |
| `tags` | `ARRAY` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `task_attempt`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `task_request_id` | `uuid` | `NO` |
| `task_plan_id` | `uuid` | `YES` |
| `task_step_id` | `uuid` | `NO` |
| `attempt_no` | `integer` | `NO` |
| `dispatch_payload` | `jsonb` | `NO` |
| `dispatch_started_at` | `timestamp with time zone` | `NO` |
| `dispatch_finished_at` | `timestamp with time zone` | `YES` |
| `outcome_code` | `text` | `YES` |
| `outcome_payload` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `task_binding`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `binding_key` | `text` | `NO` |
| `title` | `text` | `NO` |
| `description` | `text` | `NO` |
| `extension_pack_id` | `uuid` | `YES` |
| `task_types` | `ARRAY` | `NO` |
| `hosts` | `ARRAY` | `NO` |
| `projects` | `ARRAY` | `NO` |
| `trigger_conditions` | `jsonb` | `NO` |
| `rule_keys` | `ARRAY` | `NO` |
| `skill_keys` | `ARRAY` | `NO` |
| `priority` | `smallint` | `NO` |
| `risk_level` | `USER-DEFINED` | `NO` |
| `activation_policy` | `jsonb` | `NO` |
| `source_ref` | `text` | `YES` |
| `metadata` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `task_plan`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `task_request_id` | `uuid` | `NO` |
| `planning_model` | `text` | `YES` |
| `plan_hash` | `text` | `NO` |
| `goal` | `text` | `NO` |
| `acceptance_criteria` | `jsonb` | `NO` |
| `risk_level` | `USER-DEFINED` | `NO` |
| `plan_payload` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `task_request`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `request_channel` | `text` | `NO` |
| `requester_id` | `text` | `YES` |
| `task_type` | `text` | `NO` |
| `goal` | `text` | `NO` |
| `input_payload` | `jsonb` | `NO` |
| `normalized_envelope` | `jsonb` | `NO` |
| `priority` | `smallint` | `NO` |
| `idempotency_key` | `text` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `task_result`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `task_request_id` | `uuid` | `NO` |
| `task_plan_id` | `uuid` | `NO` |
| `final_step_id` | `uuid` | `YES` |
| `output_state` | `USER-DEFINED` | `NO` |
| `user_summary` | `text` | `NO` |
| `system_result` | `jsonb` | `NO` |
| `verification_summary` | `jsonb` | `YES` |
| `cleanup_summary` | `jsonb` | `YES` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `task_run`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `task_request_id` | `uuid` | `NO` |
| `run_status` | `USER-DEFINED` | `NO` |
| `goal` | `text` | `NO` |
| `started_at` | `timestamp with time zone` | `NO` |
| `finished_at` | `timestamp with time zone` | `YES` |
| `recovery_state` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `task_step`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `task_plan_id` | `uuid` | `NO` |
| `step_key` | `text` | `NO` |
| `step_order` | `integer` | `NO` |
| `title` | `text` | `NO` |
| `step_type` | `text` | `NO` |
| `dependency_keys` | `ARRAY` | `NO` |
| `input_payload` | `jsonb` | `NO` |
| `expected_output` | `jsonb` | `NO` |
| `acceptance_criteria` | `jsonb` | `NO` |
| `risk_level` | `USER-DEFINED` | `NO` |
| `side_effect_class` | `USER-DEFINED` | `NO` |
| `capability_hint` | `text` | `YES` |
| `compensation_hint` | `jsonb` | `YES` |
| `idempotency_key` | `text` | `NO` |
| `assigned_capability_id` | `uuid` | `YES` |
| `current_attempt` | `integer` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `verification_result`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `task_request_id` | `uuid` | `NO` |
| `task_plan_id` | `uuid` | `NO` |
| `task_step_id` | `uuid` | `YES` |
| `verification_phase` | `USER-DEFINED` | `NO` |
| `verdict` | `USER-DEFINED` | `NO` |
| `verifier_id` | `text` | `NO` |
| `evidence_payload` | `jsonb` | `NO` |
| `failure_event_id` | `uuid` | `YES` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

### `zombie_state`

| column | data_type | nullable |
|---|---|---|
| `id` | `uuid` | `NO` |
| `tenant_id` | `text` | `NO` |
| `scope` | `text` | `NO` |
| `status` | `USER-DEFINED` | `NO` |
| `version` | `integer` | `NO` |
| `task_request_id` | `uuid` | `NO` |
| `task_step_id` | `uuid` | `YES` |
| `resource_locator` | `jsonb` | `NO` |
| `handoff_reason` | `text` | `NO` |
| `operator_owner` | `text` | `NO` |
| `remediation_payload` | `jsonb` | `NO` |
| `trace_id` | `text` | `NO` |
| `created_at` | `timestamp with time zone` | `NO` |
| `updated_at` | `timestamp with time zone` | `NO` |

## Indexes

### `artifact`

- `artifact_pkey`
- `idx_artifact_scope_status`
- `idx_artifact_tag_verification`
- `idx_artifact_task_ref`

### `capability_registry`

- `capability_registry_pkey`
- `capability_registry_tenant_id_scope_capability_key_version_key`
- `idx_capability_registry_scope_status`
- `idx_capability_registry_type_risk`

### `cleanup_dlq`

- `cleanup_dlq_pkey`
- `idx_cleanup_dlq_dependency_replay`
- `idx_cleanup_dlq_scope_status`
- `idx_cleanup_dlq_signature`

### `cleanup_incident_cluster`

- `cleanup_incident_cluster_pkey`
- `cleanup_incident_cluster_tenant_id_scope_dependency_id_erro_key`
- `idx_cleanup_cluster_scope_status`

### `compensation_capsule`

- `compensation_capsule_pkey`
- `compensation_capsule_tenant_id_task_step_id_idempotency_key_key`
- `idx_compensation_capsule_dependency`
- `idx_compensation_capsule_scope_status`

### `conversation_summary`

- `conversation_summary_pkey`
- `conversation_summary_tenant_id_scope_summary_key_version_key`
- `idx_conversation_summary_scope_status`
- `idx_conversation_summary_task_type`

### `dependency_state`

- `dependency_state_pkey`
- `dependency_state_tenant_id_scope_dependency_id_key`
- `idx_dependency_state_scope_status`

### `drift_check_result`

- `drift_check_result_pkey`
- `idx_drift_check_result_match`
- `idx_drift_check_result_scope_status`
- `idx_drift_check_result_task_time`

### `environment_fingerprint`

- `environment_fingerprint_pkey`
- `environment_fingerprint_tenant_id_scope_fingerprint_key_key`
- `idx_environment_fingerprint_key_status`
- `idx_environment_fingerprint_scope_status`

### `execution_journal`

- `execution_journal_pkey`
- `execution_journal_task_step_id_journal_seq_key`
- `idx_execution_journal_scope_status`
- `idx_execution_journal_task_time`

### `extension_pack`

- `extension_pack_pkey`
- `extension_pack_tenant_id_scope_pack_key_version_key`
- `idx_extension_pack_scope_status`

### `failure_event`

- `failure_event_pkey`
- `idx_failure_event_dependency_signature`
- `idx_failure_event_scope_status`
- `idx_failure_event_task_time`

### `governance_change_proposal`

- `governance_change_proposal_pkey`
- `idx_governance_change_proposal_scope_status`
- `idx_governance_change_proposal_target`

### `kp_candidate_link`

- `idx_kp_candidate_link_candidate`
- `idx_kp_candidate_link_target`
- `kp_candidate_link_candidate_id_target_object_type_target_ob_key`
- `kp_candidate_link_pkey`

### `kp_context_bundle`

- `idx_kp_context_bundle_scope_request`
- `kp_context_bundle_pkey`

### `kp_document`

- `idx_kp_document_markdown_hash`
- `idx_kp_document_scope_domain`
- `idx_kp_document_scope_state`
- `kp_document_pkey`
- `kp_document_tenant_id_scope_source_uri_source_hash_key`

### `kp_entity`

- `idx_kp_entity_aliases_gin`
- `idx_kp_entity_scope_name`
- `idx_kp_entity_scope_state`
- `kp_entity_pkey`
- `kp_entity_tenant_id_scope_entity_type_slug_key`

### `kp_evidence`

- `idx_kp_evidence_scope_state`
- `idx_kp_evidence_scope_type`
- `kp_evidence_pkey`
- `kp_evidence_tenant_id_scope_source_uri_raw_ref_content_hash_key`

### `kp_fact`

- `idx_kp_fact_scope_kind`
- `idx_kp_fact_scope_state`
- `idx_kp_fact_statement_fts`
- `idx_kp_fact_subject_entity`
- `kp_fact_pkey`

### `kp_governance_cleaning_log`

- `idx_kp_governance_cleaning_log_doc`
- `kp_governance_cleaning_log_pkey`

### `kp_governance_decision`

- `idx_kp_governance_decision_job`
- `idx_kp_governance_decision_target`
- `kp_governance_decision_pkey`

### `kp_governance_job`

- `idx_kp_governance_job_scope_status`
- `idx_kp_governance_job_type`
- `kp_governance_job_pkey`

### `kp_object_revision`

- `idx_kp_object_revision_object`
- `kp_object_revision_pkey`

### `kp_recall_surface_state`

- `idx_kp_recall_surface_state_scope`
- `kp_recall_surface_state_pkey`
- `kp_recall_surface_state_tenant_id_scope_object_type_object__key`

### `kp_relation`

- `idx_kp_relation_from_object`
- `idx_kp_relation_scope_state`
- `idx_kp_relation_scope_type`
- `idx_kp_relation_to_object`
- `kp_relation_pkey`
- `kp_relation_tenant_id_scope_relation_type_from_object_type__key`

### `kp_review_queue`

- `idx_kp_review_queue_scope_status`
- `idx_kp_review_queue_target`
- `kp_review_queue_pkey`

### `kp_section`

- `idx_kp_section_content_fts`
- `idx_kp_section_document_ordinal`
- `idx_kp_section_scope_state`
- `kp_section_document_id_section_key_key`
- `kp_section_pkey`

### `kp_synthesized_knowledge`

- `idx_kp_synthesized_knowledge_content_fts`
- `idx_kp_synthesized_knowledge_scope_type`
- `kp_synthesized_knowledge_pkey`
- `kp_synthesized_knowledge_tenant_id_scope_knowledge_type_nor_key`

### `kp_synthesized_knowledge_evidence`

- `idx_kp_synthesized_knowledge_evidence_synth`
- `kp_synthesized_knowledge_evid_synthesized_knowledge_id_evid_key`
- `kp_synthesized_knowledge_evidence_pkey`

### `memory`

- `idx_memory_fingerprint`
- `idx_memory_scope_status`
- `idx_memory_type_verification`
- `memory_pkey`

### `memory_access_log`

- `idx_memory_access_log_memory_time`
- `idx_memory_access_log_query_time`
- `idx_memory_access_log_scope_status`
- `memory_access_log_pkey`

### `memory_candidate`

- `idx_memory_candidate_routing`
- `idx_memory_candidate_scope_status`
- `idx_memory_candidate_task_time`
- `memory_candidate_pkey`

### `message`

- `idx_message_scope_status`
- `idx_message_task_time`
- `message_pkey`

### `reconciliation_item`

- `idx_reconciliation_item_scope_status`
- `idx_reconciliation_item_task_time`
- `idx_reconciliation_item_type_state`
- `reconciliation_item_pkey`

### `resident_snapshot`

- `idx_resident_snapshot_scope_status`
- `resident_snapshot_pkey`
- `resident_snapshot_tenant_id_scope_snapshot_key_version_key`

### `rule`

- `idx_rule_priority_risk`
- `idx_rule_scope_status`
- `idx_rule_type_enforcement`
- `rule_pkey`
- `rule_tenant_id_scope_rule_key_version_key`

### `rule_checkpoint`

- `idx_rule_checkpoint_operation`
- `idx_rule_checkpoint_rule_phase`
- `rule_checkpoint_pkey`
- `rule_checkpoint_tenant_id_scope_rule_id_checkpoint_key_vers_key`

### `rule_conflict`

- `idx_rule_conflict_rules`
- `idx_rule_conflict_scope_status`
- `rule_conflict_pkey`
- `rule_conflict_tenant_id_scope_left_rule_id_right_rule_id_co_key`

### `rule_gate_audit`

- `idx_rule_gate_audit_rule_decision`
- `idx_rule_gate_audit_task_time`
- `rule_gate_audit_pkey`

### `schema_migrations`

- `schema_migrations_pkey`

### `skill`

- `idx_skill_fingerprint_risk`
- `idx_skill_scope_status`
- `skill_pkey`
- `skill_tenant_id_scope_skill_key_version_key`

### `task_attempt`

- `idx_task_attempt_request_time`
- `idx_task_attempt_scope_status`
- `idx_task_attempt_step_time`
- `task_attempt_pkey`
- `task_attempt_task_step_id_attempt_no_key`

### `task_binding`

- `idx_task_binding_hosts`
- `idx_task_binding_scope_status`
- `idx_task_binding_task_types`
- `task_binding_pkey`
- `task_binding_tenant_id_scope_binding_key_version_key`

### `task_plan`

- `idx_task_plan_scope_status`
- `task_plan_pkey`
- `task_plan_task_request_id_version_key`
- `task_plan_tenant_id_plan_hash_key`

### `task_request`

- `idx_task_request_scope_status`
- `idx_task_request_type_status`
- `task_request_pkey`
- `task_request_tenant_id_idempotency_key_key`

### `task_result`

- `idx_task_result_output_state`
- `idx_task_result_scope_status`
- `task_result_pkey`
- `task_result_task_request_id_version_key`

### `task_run`

- `idx_task_run_run_status`
- `idx_task_run_scope_status`
- `task_run_pkey`
- `task_run_task_request_id_key`

### `task_step`

- `idx_task_step_capability_status`
- `idx_task_step_scope_status`
- `task_step_pkey`
- `task_step_task_plan_id_step_key_key`
- `task_step_tenant_id_idempotency_key_key`

### `verification_result`

- `idx_verification_result_phase_verdict`
- `idx_verification_result_scope_status`
- `idx_verification_result_task_step`
- `verification_result_pkey`

### `zombie_state`

- `idx_zombie_state_scope_status`
- `idx_zombie_state_task_time`
- `zombie_state_pkey`

## Constraints

### `artifact`

- `artifact_pkey` (`p`)
- `artifact_task_plan_id_fkey` (`f`)
- `artifact_task_request_id_fkey` (`f`)
- `artifact_task_step_id_fkey` (`f`)

### `capability_registry`

- `capability_registry_pkey` (`p`)
- `capability_registry_tenant_id_scope_capability_key_version_key` (`u`)

### `cleanup_dlq`

- `cleanup_dlq_pkey` (`p`)
- `cleanup_dlq_task_plan_id_fkey` (`f`)
- `cleanup_dlq_task_request_id_fkey` (`f`)
- `cleanup_dlq_task_step_id_fkey` (`f`)

### `cleanup_incident_cluster`

- `cleanup_incident_cluster_pkey` (`p`)
- `cleanup_incident_cluster_tenant_id_scope_dependency_id_erro_key` (`u`)

### `compensation_capsule`

- `compensation_capsule_pkey` (`p`)
- `compensation_capsule_task_plan_id_fkey` (`f`)
- `compensation_capsule_task_request_id_fkey` (`f`)
- `compensation_capsule_task_step_id_fkey` (`f`)
- `compensation_capsule_tenant_id_task_step_id_idempotency_key_key` (`u`)

### `conversation_summary`

- `conversation_summary_pkey` (`p`)
- `conversation_summary_supersedes_id_fkey` (`f`)
- `conversation_summary_task_request_id_fkey` (`f`)
- `conversation_summary_tenant_id_scope_summary_key_version_key` (`u`)

### `dependency_state`

- `dependency_state_pkey` (`p`)
- `dependency_state_status_check` (`c`)
- `dependency_state_tenant_id_scope_dependency_id_key` (`u`)

### `drift_check_result`

- `drift_check_result_pkey` (`p`)
- `drift_check_result_task_request_id_fkey` (`f`)
- `drift_check_result_task_step_id_fkey` (`f`)

### `environment_fingerprint`

- `environment_fingerprint_pkey` (`p`)
- `environment_fingerprint_tenant_id_scope_fingerprint_key_key` (`u`)

### `execution_journal`

- `execution_journal_pkey` (`p`)
- `execution_journal_task_plan_id_fkey` (`f`)
- `execution_journal_task_request_id_fkey` (`f`)
- `execution_journal_task_step_id_fkey` (`f`)
- `execution_journal_task_step_id_journal_seq_key` (`u`)

### `extension_pack`

- `extension_pack_pkey` (`p`)
- `extension_pack_tenant_id_scope_pack_key_version_key` (`u`)

### `failure_event`

- `failure_event_pkey` (`p`)
- `failure_event_task_plan_id_fkey` (`f`)
- `failure_event_task_request_id_fkey` (`f`)
- `failure_event_task_step_id_fkey` (`f`)

### `governance_change_proposal`

- `governance_change_proposal_pkey` (`p`)

### `kp_candidate_link`

- `kp_candidate_link_candidate_id_fkey` (`f`)
- `kp_candidate_link_candidate_id_target_object_type_target_ob_key` (`u`)
- `kp_candidate_link_pkey` (`p`)

### `kp_context_bundle`

- `kp_context_bundle_pkey` (`p`)

### `kp_document`

- `kp_document_pkey` (`p`)
- `kp_document_tenant_id_scope_source_uri_source_hash_key` (`u`)

### `kp_entity`

- `kp_entity_pkey` (`p`)
- `kp_entity_tenant_id_scope_entity_type_slug_key` (`u`)

### `kp_evidence`

- `kp_evidence_pkey` (`p`)
- `kp_evidence_tenant_id_scope_source_uri_raw_ref_content_hash_key` (`u`)

### `kp_fact`

- `kp_fact_pkey` (`p`)
- `kp_fact_subject_entity_id_fkey` (`f`)
- `kp_fact_supersedes_fact_id_fkey` (`f`)

### `kp_governance_cleaning_log`

- `kp_governance_cleaning_log_document_id_fkey` (`f`)
- `kp_governance_cleaning_log_governance_job_id_fkey` (`f`)
- `kp_governance_cleaning_log_pkey` (`p`)

### `kp_governance_decision`

- `kp_governance_decision_governance_job_id_fkey` (`f`)
- `kp_governance_decision_pkey` (`p`)

### `kp_governance_job`

- `kp_governance_job_pkey` (`p`)

### `kp_object_revision`

- `kp_object_revision_governance_job_id_fkey` (`f`)
- `kp_object_revision_pkey` (`p`)

### `kp_recall_surface_state`

- `kp_recall_surface_state_governance_job_id_fkey` (`f`)
- `kp_recall_surface_state_pkey` (`p`)
- `kp_recall_surface_state_tenant_id_scope_object_type_object__key` (`u`)

### `kp_relation`

- `kp_relation_pkey` (`p`)
- `kp_relation_tenant_id_scope_relation_type_from_object_type__key` (`u`)

### `kp_review_queue`

- `kp_review_queue_pkey` (`p`)

### `kp_section`

- `kp_section_document_id_fkey` (`f`)
- `kp_section_document_id_section_key_key` (`u`)
- `kp_section_pkey` (`p`)

### `kp_synthesized_knowledge`

- `kp_synthesized_knowledge_governance_job_id_fkey` (`f`)
- `kp_synthesized_knowledge_pkey` (`p`)
- `kp_synthesized_knowledge_tenant_id_scope_knowledge_type_nor_key` (`u`)

### `kp_synthesized_knowledge_evidence`

- `kp_synthesized_knowledge_evid_synthesized_knowledge_id_evid_key` (`u`)
- `kp_synthesized_knowledge_evidence_evidence_id_fkey` (`f`)
- `kp_synthesized_knowledge_evidence_pkey` (`p`)
- `kp_synthesized_knowledge_evidence_synthesized_knowledge_id_fkey` (`f`)

### `memory`

- `memory_pkey` (`p`)
- `memory_supersedes_id_fkey` (`f`)

### `memory_access_log`

- `memory_access_log_memory_id_fkey` (`f`)
- `memory_access_log_pkey` (`p`)

### `memory_candidate`

- `memory_candidate_pkey` (`p`)
- `memory_candidate_task_request_id_fkey` (`f`)
- `memory_candidate_task_step_id_fkey` (`f`)

### `message`

- `message_pkey` (`p`)
- `message_task_request_id_fkey` (`f`)

### `reconciliation_item`

- `reconciliation_item_pkey` (`p`)
- `reconciliation_item_task_request_id_fkey` (`f`)
- `reconciliation_item_task_step_id_fkey` (`f`)

### `resident_snapshot`

- `resident_snapshot_pkey` (`p`)
- `resident_snapshot_tenant_id_scope_snapshot_key_version_key` (`u`)

### `rule`

- `rule_pkey` (`p`)
- `rule_supersedes_rule_id_fkey` (`f`)
- `rule_tenant_id_scope_rule_key_version_key` (`u`)

### `rule_checkpoint`

- `rule_checkpoint_pkey` (`p`)
- `rule_checkpoint_rule_id_fkey` (`f`)
- `rule_checkpoint_tenant_id_scope_rule_id_checkpoint_key_vers_key` (`u`)

### `rule_conflict`

- `rule_conflict_left_rule_id_fkey` (`f`)
- `rule_conflict_pkey` (`p`)
- `rule_conflict_right_rule_id_fkey` (`f`)
- `rule_conflict_tenant_id_scope_left_rule_id_right_rule_id_co_key` (`u`)

### `rule_gate_audit`

- `rule_gate_audit_checkpoint_id_fkey` (`f`)
- `rule_gate_audit_pkey` (`p`)
- `rule_gate_audit_rule_id_fkey` (`f`)
- `rule_gate_audit_task_request_id_fkey` (`f`)
- `rule_gate_audit_task_step_id_fkey` (`f`)

### `schema_migrations`

- `schema_migrations_pkey` (`p`)

### `skill`

- `skill_pkey` (`p`)
- `skill_tenant_id_scope_skill_key_version_key` (`u`)

### `task_attempt`

- `task_attempt_pkey` (`p`)
- `task_attempt_task_plan_id_fkey` (`f`)
- `task_attempt_task_request_id_fkey` (`f`)
- `task_attempt_task_step_id_attempt_no_key` (`u`)
- `task_attempt_task_step_id_fkey` (`f`)

### `task_binding`

- `task_binding_extension_pack_id_fkey` (`f`)
- `task_binding_pkey` (`p`)
- `task_binding_tenant_id_scope_binding_key_version_key` (`u`)

### `task_plan`

- `task_plan_pkey` (`p`)
- `task_plan_task_request_id_fkey` (`f`)
- `task_plan_task_request_id_version_key` (`u`)
- `task_plan_tenant_id_plan_hash_key` (`u`)

### `task_request`

- `task_request_pkey` (`p`)
- `task_request_tenant_id_idempotency_key_key` (`u`)

### `task_result`

- `task_result_final_step_id_fkey` (`f`)
- `task_result_pkey` (`p`)
- `task_result_task_plan_id_fkey` (`f`)
- `task_result_task_request_id_fkey` (`f`)
- `task_result_task_request_id_version_key` (`u`)

### `task_run`

- `task_run_pkey` (`p`)
- `task_run_task_request_id_fkey` (`f`)
- `task_run_task_request_id_key` (`u`)

### `task_step`

- `task_step_assigned_capability_id_fkey` (`f`)
- `task_step_pkey` (`p`)
- `task_step_task_plan_id_fkey` (`f`)
- `task_step_task_plan_id_step_key_key` (`u`)
- `task_step_tenant_id_idempotency_key_key` (`u`)

### `verification_result`

- `verification_result_failure_event_id_fkey` (`f`)
- `verification_result_pkey` (`p`)
- `verification_result_task_plan_id_fkey` (`f`)
- `verification_result_task_request_id_fkey` (`f`)
- `verification_result_task_step_id_fkey` (`f`)

### `zombie_state`

- `zombie_state_pkey` (`p`)
- `zombie_state_task_request_id_fkey` (`f`)
- `zombie_state_task_step_id_fkey` (`f`)

