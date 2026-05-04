import { createConversationSummary, getTaskRunByTaskRequest, listArtifactsByTaskRequest, listMessagesByTaskRequest } from "@super-agent/db";

export class SummaryGenerator {
  async generate(input: {
    tenantId: string;
    scope: string;
    taskRequestId: string;
    traceId: string;
  }): Promise<string> {
    const [messages, taskRun, artifacts] = await Promise.all([
      listMessagesByTaskRequest(input.taskRequestId),
      getTaskRunByTaskRequest(input.taskRequestId),
      listArtifactsByTaskRequest(input.taskRequestId)
    ]);

    const summaryPayload = {
      goal: taskRun?.goal ?? null,
      run_status: taskRun?.run_status ?? null,
      message_count: messages.length,
      artifact_count: artifacts.length,
      message_digest: messages.slice(-3).map((message) => ({
        role: message.role,
        content: message.content
      })),
      artifact_digest: artifacts.slice(-5).map((artifact) => ({
        artifact_type: artifact.artifact_type,
        artifact_tag: artifact.artifact_tag,
        verification_status: artifact.verification_status
      }))
    };

    return createConversationSummary({
      tenantId: input.tenantId,
      scope: input.scope,
      taskRequestId: input.taskRequestId,
      summaryKey: `${input.taskRequestId}:default`,
      summaryType: "conversation_rollup",
      sourceRangeStart: 1,
      sourceRangeEnd: messages.length + artifacts.length,
      summaryPayload,
      rebuildStatus: "built",
      traceId: input.traceId
    });
  }
}
