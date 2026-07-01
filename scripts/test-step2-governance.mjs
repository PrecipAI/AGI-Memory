// 阶段 2b：治理运行 Step 2 — 构造 extraction_preview 调 governance-run-from-extraction
const now = new Date().toISOString();

const body = {
  governance_mode: "host_model",
  fingerprint: "test-fp-001",
  extraction_preview: {
    rule_candidates: [
      {
        candidate_type: "rule_candidate",
        title: "禁止用 print 调试 Python 代码",
        content: "IF [代码文件是 .py] THEN MUST NOT [使用 print() 调试]; MUST [使用 logger]",
        rule_id: "USER_FORBID_PRINT_DEBUG",
        source_excerpt: "用户说：本项目禁止 print 调试",
        source_kind: "user_message",
        source_timestamp: now,
        origin_scope: "project",
        availability_scope: "project_reusable",
        governance_level: "shared",
        reason: "用户明确要求禁止 print 调试",
        confidence: "high",
        metadata: {
          human_readable_statement: "当编写 Python 代码时，禁止使用 print 函数进行调试输出，必须使用 logger 记录日志。",
          classification_rationale: "这是约束性规则，因为它规定了 IF 代码文件是 .py THEN MUST NOT 使用 print 的行为约束，而不是可复用的操作步骤。"
        },
        source_refs: [
          { source_kind: "user_message", source_timestamp: now, content: "本项目禁止 print 调试，必须用 logger" },
          { source_kind: "assistant_message", source_timestamp: now, content: "好的，我会使用 logger 而不是 print 进行调试输出。" }
        ]
      }
    ],
    memory_candidates: [
      {
        candidate_type: "memory_candidate",
        title: "用户技术栈偏好",
        content: "用户使用 Python 3.11 + FastAPI，重视代码质量",
        strictness: "soft_preference",
        source_excerpt: "用户说：本项目使用 Python 3.11 + FastAPI",
        source_kind: "user_message",
        source_timestamp: now,
        origin_scope: "user",
        availability_scope: "user_reusable",
        governance_level: "shared",
        reason: "了解用户技术栈有助于后续代码建议",
        confidence: "high"
      }
    ],
    knowledge_candidates: [],
    skill_proposal_candidates: [],
    governance_evidence_candidates: []
  }
};

const resp = await fetch("http://127.0.0.1:3101/internal/governance/run-from-extraction", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

const result = await resp.json();
console.log("HTTP Status:", resp.status);
console.log("Result:", JSON.stringify(result, null, 2));
