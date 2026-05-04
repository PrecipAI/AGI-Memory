export interface paths {
    "/internal/planner/plan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header: {
                    "X-Tenant-Id": components["parameters"]["TenantId"];
                    "X-Scope": components["parameters"]["Scope"];
                    "X-Trace-Id": components["parameters"]["TraceId"];
                    "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["PlanRequest"];
                };
            };
            responses: {
                /** @description Planned */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["PlanResponse"];
                    };
                };
                default: components["responses"]["ErrorResponse"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/internal/resolver/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header: {
                    "X-Tenant-Id": components["parameters"]["TenantId"];
                    "X-Scope": components["parameters"]["Scope"];
                    "X-Trace-Id": components["parameters"]["TraceId"];
                    "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ResolveRequest"];
                };
            };
            responses: {
                /** @description Resolved */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ResolveResponse"];
                    };
                };
                default: components["responses"]["ErrorResponse"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/internal/router/dispatch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header: {
                    "X-Tenant-Id": components["parameters"]["TenantId"];
                    "X-Scope": components["parameters"]["Scope"];
                    "X-Trace-Id": components["parameters"]["TraceId"];
                    "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["DispatchRequest"];
                };
            };
            responses: {
                /** @description Dispatched */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DispatchResponse"];
                    };
                };
                default: components["responses"]["ErrorResponse"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/internal/verifier/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header: {
                    "X-Tenant-Id": components["parameters"]["TenantId"];
                    "X-Scope": components["parameters"]["Scope"];
                    "X-Trace-Id": components["parameters"]["TraceId"];
                    "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["VerifyRequest"];
                };
            };
            responses: {
                /** @description Verified */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["VerifyResponse"];
                    };
                };
                default: components["responses"]["ErrorResponse"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/internal/cleanup/dispatch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header: {
                    "X-Tenant-Id": components["parameters"]["TenantId"];
                    "X-Scope": components["parameters"]["Scope"];
                    "X-Trace-Id": components["parameters"]["TraceId"];
                    "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CleanupRequest"];
                };
            };
            responses: {
                /** @description Cleanup dispatched */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CleanupResponse"];
                    };
                };
                default: components["responses"]["ErrorResponse"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/internal/memory/candidates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header: {
                    "X-Tenant-Id": components["parameters"]["TenantId"];
                    "X-Scope": components["parameters"]["Scope"];
                    "X-Trace-Id": components["parameters"]["TraceId"];
                    "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["MemoryCandidateRequest"];
                };
            };
            responses: {
                /** @description Candidate ingested */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MemoryCandidateResponse"];
                    };
                };
                default: components["responses"]["ErrorResponse"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/internal/feedback/commit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header: {
                    "X-Tenant-Id": components["parameters"]["TenantId"];
                    "X-Scope": components["parameters"]["Scope"];
                    "X-Trace-Id": components["parameters"]["TraceId"];
                    "Idempotency-Key": components["parameters"]["IdempotencyKey"];
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["FeedbackCommitRequest"];
                };
            };
            responses: {
                /** @description Feedback committed */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["FeedbackCommitResponse"];
                    };
                };
                default: components["responses"]["ErrorResponse"];
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Error: {
            error_code: string;
            message: string;
            trace_id: string;
            retryable: boolean;
            details: {
                [key: string]: unknown;
            };
        };
        Step: {
            step_key: string;
            step_order: number;
            title: string;
            step_type: string;
            dependency_keys: string[];
            /** @enum {string} */
            risk_level: "low" | "medium" | "high" | "critical";
            /** @enum {string} */
            side_effect_class: "none" | "read_only" | "external_resource" | "state_change" | "approval";
            capability_hint?: string;
            compensation_hint?: {
                [key: string]: unknown;
            };
            input_payload: {
                [key: string]: unknown;
            };
            expected_output: {
                [key: string]: unknown;
            };
            acceptance_criteria: {
                [key: string]: unknown;
            }[];
        };
        PlanRequest: {
            /** Format: uuid */
            task_request_id: string;
            task_type: string;
            goal: string;
            normalized_envelope: {
                [key: string]: unknown;
            };
            resident_context: {
                [key: string]: unknown;
            };
            retrieval_budget: {
                [key: string]: unknown;
            };
        };
        PlanResponse: {
            /** Format: uuid */
            task_plan_id: string;
            plan_version: number;
            risk_level: string;
            acceptance_criteria: {
                [key: string]: unknown;
            }[];
            steps: components["schemas"]["Step"][];
        };
        ResolveRequest: {
            /** Format: uuid */
            task_plan_id: string;
            /** Format: uuid */
            task_step_id: string;
            step_type: string;
            risk_level: string;
            side_effect_class: string;
            required_scopes: string[];
            fingerprint_context: {
                [key: string]: unknown;
            };
        };
        ResolveResponse: {
            /** Format: uuid */
            resolved_capability_id: string;
            candidate_capabilities: {
                [key: string]: unknown;
            }[];
            approval_required: boolean;
            resolution_reason: string;
        };
        DispatchRequest: {
            /** Format: uuid */
            task_request_id: string;
            /** Format: uuid */
            task_plan_id: string;
            /** Format: uuid */
            task_step_id: string;
            /** Format: uuid */
            resolved_capability_id: string;
            dispatch_payload: {
                [key: string]: unknown;
            };
            precheck_token: string;
        };
        DispatchResponse: {
            dispatch_status: string;
            attempt_no: number;
            execution_reference: {
                [key: string]: unknown;
            };
            journal_checkpoint: string;
            /** @enum {string} */
            stream_state: "provisional" | "committed" | "revoked" | "replanned" | "blocked";
        };
        VerifyRequest: {
            /** Format: uuid */
            task_request_id: string;
            /** Format: uuid */
            task_plan_id: string;
            /** Format: uuid */
            task_step_id?: string;
            /** @enum {string} */
            verification_phase: "precheck" | "postcheck" | "acceptance" | "cleanup";
            expected_state: {
                [key: string]: unknown;
            };
            observed_state: {
                [key: string]: unknown;
            };
        };
        VerifyResponse: {
            /** Format: uuid */
            verification_result_id: string;
            /** @enum {string} */
            verdict: "passed" | "failed" | "waived";
            /** Format: uuid */
            failure_event_id?: string;
            evidence_payload: {
                [key: string]: unknown;
            };
        };
        CleanupRequest: {
            /** Format: uuid */
            task_request_id: string;
            /** Format: uuid */
            task_plan_id: string;
            /** Format: uuid */
            task_step_id: string;
            cleanup_status: string;
            journal_cursor: number;
            /** Format: uuid */
            capsule_id: string;
            /** @enum {string} */
            dependency_state: "DOWN" | "HALF-OPEN" | "UP";
        };
        CleanupResponse: {
            cleanup_status: string;
            drift_detected: boolean;
            /** Format: uuid */
            dlq_item_id?: string;
            scope_frozen: boolean;
            reconciliation_required: boolean;
        };
        MemoryCandidateRequest: {
            /** Format: uuid */
            task_request_id: string;
            /** Format: uuid */
            task_step_id: string;
            candidate_type: string;
            source_ref: string;
            routing_reason: string;
            candidate_payload: {
                [key: string]: unknown;
            };
        };
        MemoryCandidateResponse: {
            accepted: boolean;
            candidate_hash: string;
            storage_decision: string;
        };
        FeedbackCommitRequest: {
            /** Format: uuid */
            task_request_id: string;
            /** Format: uuid */
            task_step_id: string;
            /** Format: uuid */
            verification_result_id?: string;
            /** Format: uuid */
            failure_event_id?: string;
            capability_feedback: {
                [key: string]: unknown;
            };
            policy_feedback: {
                [key: string]: unknown;
            };
        };
        FeedbackCommitResponse: {
            feedback_status: string;
            affected_objects: string[];
            /** Format: date-time */
            committed_at: string;
        };
    };
    responses: {
        /** @description Standard error */
        ErrorResponse: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
    };
    parameters: {
        TenantId: string;
        Scope: string;
        TraceId: string;
        IdempotencyKey: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
