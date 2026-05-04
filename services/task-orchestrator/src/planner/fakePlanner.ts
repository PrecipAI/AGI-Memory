import type { PlanRequest, PlanResponse } from "@super-agent/contracts";

export function buildFakePlan(request: PlanRequest): Omit<PlanResponse, "task_plan_id" | "plan_version"> {
  return {
    risk_level: "low",
    acceptance_criteria: [
      {
        key: "resource-created",
        description: "Mock external resource is created with a stable identifier."
      },
      {
        key: "verification-ready",
        description: "The plan emits a provisional result and is ready for verifier handoff."
      }
    ],
    steps: [
      {
        step_key: "prepare_context",
        step_order: 1,
        title: "Prepare normalized context",
        step_type: "context.prepare",
        dependency_keys: [],
        risk_level: "low",
        side_effect_class: "read_only",
        capability_hint: "mock.context.prepare",
        compensation_hint: {
          strategy: "none"
        },
        input_payload: {
          goal: request.goal,
          normalized_envelope: request.normalized_envelope
        },
        expected_output: {
          context_ready: true
        },
        acceptance_criteria: [
          {
            key: "context-ready",
            description: "Context is normalized and ready for routing."
          }
        ]
      },
      {
        step_key: "create_external_ticket",
        step_order: 2,
        title: "Create external temporary resource",
        step_type: "external.ticket.create",
        dependency_keys: ["prepare_context"],
        risk_level: "low",
        side_effect_class: "external_resource",
        capability_hint: "mock.ticket.create",
        compensation_hint: {
          compensator_id: "mock.ticket.delete",
          target_dependency: "mock-ticket-api"
        },
        input_payload: {
          title: request.goal,
          task_type: request.task_type
        },
        expected_output: {
          resource_created: true
        },
        acceptance_criteria: [
          {
            key: "ticket-created",
            description: "A reversible mock ticket has been created."
          }
        ]
      },
      {
        step_key: "finalize_provisional_result",
        step_order: 3,
        title: "Finalize provisional result",
        step_type: "result.provisionalize",
        dependency_keys: ["create_external_ticket"],
        risk_level: "low",
        side_effect_class: "none",
        capability_hint: "mock.result.provisionalize",
        compensation_hint: {
          strategy: "none"
        },
        input_payload: {
          expected_stream_state: "provisional"
        },
        expected_output: {
          output_state: "provisional"
        },
        acceptance_criteria: [
          {
            key: "provisional-state",
            description: "The result remains provisional until verification and cleanup finish."
          }
        ]
      }
    ]
  };
}
