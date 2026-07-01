// 预览多个 codex 会话，找内容最丰富的，触发治理
const base = 'http://127.0.0.1:3101';

const threads = [
  { id: '019e2ea5-172d-7050-ac2c-854bccb244b3', name: '电力预测比赛' },
  { id: '019e2e96-112d-7ef1-b9c0-60420883e310', name: '提升 GitHub Star' },
  { id: '019e76f2-7e26-7a81-8d08-d63d5d21a97e', name: '总结 AI 网关与压缩方案' },
  { id: '019e2fc2-38e2-70f3-8134-86067fc6c5b1', name: '评审纯上下文压缩插件' },
  { id: '019e3a5f-16ae-7be1-9455-bb1025b56b02', name: '电力预测' },
];

let best = null;
let bestScore = 0;

console.log('=== 预览会话内容量 ===');
for (const t of threads) {
  try {
    const res = await fetch(`${base}/internal/host-capture/codex/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codex_home: null, thread_id: t.id }),
    });
    const preview = await res.json();
    const um = preview.raw_inputs?.user_messages?.length ?? 0;
    const tc = preview.raw_inputs?.tool_calls?.length ?? 0;
    const mc = preview.raw_inputs?.mcp_calls?.length ?? 0;
    const cmd = preview.raw_inputs?.commands?.length ?? 0;
    const score = um + tc + mc + cmd;
    console.log(`  ${t.name} | user_msg=${um} tools=${tc} mcp=${mc} cmds=${cmd} | score=${score}`);
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  } catch (e) {
    console.log(`  ${t.name} | ERROR: ${e.message}`);
  }
}

if (!best || bestScore === 0) {
  console.log('\n所有会话内容量都为 0，无法触发有效治理。');
  process.exit(0);
}

console.log(`\n最佳会话: ${best.name} (score=${bestScore})`);
console.log('\n=== 触发治理运行 ===');

const res = await fetch(`${base}/internal/host-capture/codex/governance-run`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ codex_home: null, thread_id: best.id, governance_mode: 'rules_fallback' }),
});
const result = await res.json();

console.log(`thread: ${result.thread_name}`);
console.log(`task_request_id: ${result.task_request_id}`);
const p = result.persisted || {};
console.log(`持久化: rule_ids=${p.rule_ids?.length ?? 0} memory_ids=${p.memory_ids?.length ?? 0} skill_proposal_ids=${p.skill_proposal_ids?.length ?? 0} knowledge_ids=${p.knowledge_ids?.length ?? 0} evidence_ids=${p.evidence_ids?.length ?? 0}`);
const a = result.acceptance_report?.governance_candidates || {};
console.log(`候选: rule=${a.rule_count} memory=${a.memory_count} skill=${a.skill_proposal_count} knowledge=${a.knowledge_count}`);

if (result.warnings?.length) {
  console.log('\n警告:');
  for (const w of result.warnings) console.log(`  - ${w}`);
}
