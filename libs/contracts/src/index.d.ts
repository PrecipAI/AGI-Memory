import type { paths } from "./generated/internal-api.js";
type JsonContent<T> = T extends {
    content: {
        "application/json": infer C;
    };
} ? C : never;
type RequestBody<T> = T extends {
    requestBody: infer R;
} ? JsonContent<R> : never;
type SuccessResponse<T> = T extends {
    responses: {
        200: infer R;
    };
} ? JsonContent<R> : never;
export type PlanRequest = RequestBody<paths["/internal/planner/plan"]["post"]>;
export type PlanResponse = SuccessResponse<paths["/internal/planner/plan"]["post"]>;
export type ResolveRequest = RequestBody<paths["/internal/resolver/resolve"]["post"]>;
export type ResolveResponse = SuccessResponse<paths["/internal/resolver/resolve"]["post"]>;
export type DispatchRequest = RequestBody<paths["/internal/router/dispatch"]["post"]>;
export type DispatchResponse = SuccessResponse<paths["/internal/router/dispatch"]["post"]>;
export type VerifyRequest = RequestBody<paths["/internal/verifier/check"]["post"]>;
export type VerifyResponse = SuccessResponse<paths["/internal/verifier/check"]["post"]>;
export type CleanupRequest = RequestBody<paths["/internal/cleanup/dispatch"]["post"]>;
export type CleanupResponse = SuccessResponse<paths["/internal/cleanup/dispatch"]["post"]>;
export type MemoryCandidateRequest = RequestBody<paths["/internal/memory/candidates"]["post"]>;
export type MemoryCandidateResponse = SuccessResponse<paths["/internal/memory/candidates"]["post"]>;
export type FeedbackCommitRequest = RequestBody<paths["/internal/feedback/commit"]["post"]>;
export type FeedbackCommitResponse = SuccessResponse<paths["/internal/feedback/commit"]["post"]>;
export * from "./generated/state-machines.js";
export type { paths };
