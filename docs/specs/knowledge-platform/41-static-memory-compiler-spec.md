# 41. 静态记忆编译器（Static Memory Compiler）Spec

> 把治理产出的 Rule/Skill/Memory 编译进宿主原生静态记忆文件（CLAUDE.md / AGENTS.md / .trae/instructions.md），
> 让宿主靠原生机制就能吃到高置信度知识，减少运行时 retrieve_context 调用开销。
> AGI-Memory 是输出通道，不是竞争对手。

---

## 0. 战略定位

### 0.1 职责边界（不可逾越）

| 层 | 宿主管的 | AGI-Memory 管的 |
|----|---------|----------------|
| 会话内压缩 | context window 管理、token 调度 | 不碰 |
| 临时记忆 | conversation history、当前对话上下文 | 不碰 |
| 跨会话持久化 | 不碰 | Rule/Skill/Memory/Knowledge 持久化 |
| 知识治理 | 不碰 | 审批、冲突检测、演进扫描、质量校验 |
| 静态记忆文件 | 原生读取 CLAUDE.md/AGENTS.md | **编译产出**，不替代宿主读取机制 |

### 0.2 判断准则

任何新功能提案先问：这件事宿主原生能力有没有已经在做？
- **帮它做得更好**（治理、验证、跨会话）→ 做
- **重新做一遍它做过的事**（压缩、临时记忆）→ 不做，改成跟宿主已有机制对接

### 0.3 本 spec 不做的事

- 不自己做会话摘要/压缩（纯二次劳动）
- 不替代宿主的 context window 管理
- 不在静态文件里塞时间敏感/会话特定内容
- 不全量覆盖宿主静态文件（用 marker 注入，保护用户手写内容）

---

## 1. 现状盘点（事实，非猜测）

### 1.1 已实现（可复用）

| 能力 | 位置 | 复用点 |
|------|------|--------|
| marker 注入机制 | [hostInstall.ts:209-249](../../services/memory-mcp-server/src/hostInstall.ts) `upsertMarkedTextFile` | 查找 marker → 替换内容 → 备份原文件，直接复用 |
| 三宿主安装路径 | [hostInstall.ts:117-178](../../services/memory-mcp-server/src/hostInstall.ts) `installClaudeCode`/`installCodex`/`installTrae` | 文件路径解析逻辑（CLAUDE.md / AGENTS.md / .trae/instructions.md） |
| 多 IDE 宿主检测 | [hostActionExecutor.ts:612-660](../../services/memory-service/src/hostActionExecutor.ts) | 环境变量 + 文件系统特征检测 |
| Rule DB 查询 | [queries.ts](../../services/memory-service/src/queries.ts) `queryActiveRules` / `listActiveRules` | 查 active rules 的 SQL 已有 |
| Resident snapshot 生成 | [residentMemoryBuilder.ts](../../services/memory-service/src/residentMemoryBuilder.ts) | 类似逻辑（DB → 结构化快照），可参考筛选条件 |
| host-action 执行队列 | [hostActionExecutor.ts](../../services/memory-service/src/hostActionExecutor.ts) | 审批通过后的落地执行流程，加一步编译 |

### 1.2 明确缺口

| 缺口 | 证据 |
|------|------|
| 无 Rule/Skill → markdown 反向编译器 | `Grep "compileRule|exportRule|syncToHost"` 全仓 0 匹配 |
| 无 DB → 文件系统反向同步 | host-action 只落地为 .hook.ts/.mjs，不是 markdown |
| hostInstall 只注入固定 snippet | [config.ts:503-670](../../services/memory-mcp-server/src/config.ts) `buildClaudeSnippet` 等是硬编码字符串，不从 DB 动态编译 |
| 无"输出到哪些宿主格式"配置项 | hostInstall 仅接受单一宿主，不支持多宿主并行编译 |

### 1.3 retrieve_context 开销现状（动机佐证）

每次 `memory_retrieve_context` 调用：
- 10+ DB 查询（7 层并行，每层独立 SQL）
- 3 次 embedding 调用（semanticRerank × 3）
- 2 次 Node.js 子进程 spawn（gate-runtime before/after）
- N 次访问日志写入（每返回 item 至少 1 次）
- **零缓存**（无 LRU/TTL，bundle reuse 机制存在但代码上不生效）

静态记忆编译器能直接减少调用频次：高置信度 Rule 已在 CLAUDE.md 里，宿主不需要每次都调 retrieve_context 去拿。

---

## 2. 模块设计

### 2.1 目录结构

```
services/memory-service/src/staticMemoryCompiler/
├── compiler.ts           # 核心编译逻辑（DB 查询 → 筛选 → 格式化 → 写文件）
├── markerManager.ts      # marker 注入/替换（复用 hostInstall 的 upsertMarkedTextFile 模式）
├── contentFilter.ts      # 内容筛选（哪些 Rule/Skill/Memory 适合编译进静态文件）
├── scheduler.ts          # 定时重编译兜底（cron job）
└── hostFormats/
    ├── traeFormat.ts     # .trae/instructions.md 格式化器
    ├── claudeFormat.ts   # CLAUDE.md 格式化器
    └── codexFormat.ts    # AGENTS.md 格式化器
```

### 2.2 核心接口

```typescript
// compiler.ts
export interface CompileInput {
  tenantId: string;
  scope: string;
  /** 强制指定宿主列表，不指定则自动检测 */
  targetHosts?: HostType[];
  /** 触发来源：immediate（审批通过即时触发）/ scheduled（定时兜底）*/
  trigger: "immediate" | "scheduled";
}

export interface CompileResult {
  /** 编译的规则数 */
  ruleCount: number;
  /** 编译的技能数 */
  skillCount: number;
  /** 编译的记忆数 */
  memoryCount: number;
  /** 写入的文件列表 */
  files: Array<{
    path: string;
    host: HostType;
    status: "created" | "updated" | "unchanged";
    backupPath?: string;
  }>;
  /** 跳过的条目及原因 */
  skipped: Array<{
    id: string;
    title: string;
    reason: string;
  }>;
}

export async function compileStaticMemory(input: CompileInput): Promise<CompileResult>;
```

### 2.3 marker 设计

与现有 `<!-- >>> memory-v3 policy >>>` 区分，用独立 marker：

```
<!-- >>> memory-v3 static-rules >>> -->
...编译产出的 Rule 内容...
<!-- <<< memory-v3 static-rules <<< -->

<!-- >>> memory-v3 static-skills >>> -->
...编译产出的 Skill 内容...
<!-- <<< memory-v3 static-skills <<< -->

<!-- >>> memory-v3 static-memory >>> -->
...编译产出的长期 Memory 内容...
<!-- <<< memory-v3 static-memory <<< -->
```

**为什么分三个 marker 而不是一个：**
- Rule/Skill/Memory 的更新频率不同（Rule 审批后基本不变，Memory 可能演进）
- 分开 marker 可以只重编译变化的部分，不用全量重写
- 宿主原生读取时也能区分内容类型

---

## 3. 内容筛选规则

### 3.1 编译进静态文件的（高置信度 + 长期稳定）

| 层 | 筛选条件 | 理由 |
|----|---------|------|
| Rule | `promotion_status = 'active'` AND `enforcement_level = 'must'` AND `governance_level = 'shared'` AND `origin_scope IN ('project','workspace','user','team','global')` | 只有审批通过、强制级别、共享级别的规则才值得编译 |
| Skill | `promotion_status = 'active'` AND `self_test.executable_with_generic_terms = true` | 已审批且用通用术语可执行的技能 |
| Memory | `stability = 'long_lived'` AND `self_test.about_user_not_code = true` | 长期有效的用户画像类记忆 |

### 3.2 不编译的（排除条件）

| 排除条件 | 理由 |
|---------|------|
| `promotion_status IN ('candidate','needs_review','rejected')` | 未审批通过 |
| `stability = 'temporary'` | 临时记忆，会过期 |
| content 含时间敏感词（今天/昨天/版本号/日期） | 会过期，不适合静态文件 |
| content 含项目内部状态（本地路径、DB URL） | 安全风险，不应进静态文件 |
| `origin_scope = 'session'` | 会话级，不该跨会话 |
| evidence 层 | 一次性执行证据，不是持久知识 |

### 3.3 筛选实现

```typescript
// contentFilter.ts
export interface FilterableItem {
  promotion_status: string;
  enforcement_level?: string;
  governance_level: string;
  origin_scope: string;
  stability?: string;
  content?: string;
  self_test?: Record<string, unknown>;
}

export function shouldCompileToStaticMemory(
  layer: "rule" | "skill" | "memory",
  item: FilterableItem
): { pass: boolean; reason?: string } {
  // 通用排除：未审批通过
  if (item.promotion_status !== "active") {
    return { pass: false, reason: `promotion_status=${item.promotion_status}` };
  }
  // 通用排除：会话级
  if (item.origin_scope === "session") {
    return { pass: false, reason: "origin_scope=session" };
  }
  // 通用排除：时间敏感词
  if (item.content && TIME_SENSITIVE_PATTERNS.some(p => p.test(item.content!))) {
    return { pass: false, reason: "content contains time-sensitive terms" };
  }
  // 通用排除：项目内部状态
  if (item.content && PROJECT_INTERNAL_PATTERNS.some(p => p.test(item.content!))) {
    return { pass: false, reason: "content contains project-internal state" };
  }

  // 按层筛选
  if (layer === "rule") {
    if (item.enforcement_level !== "must") return { pass: false, reason: "enforcement_level!=must" };
    if (item.governance_level !== "shared") return { pass: false, reason: "governance_level!=shared" };
  }
  if (layer === "skill") {
    const executable = item.self_test?.executable_with_generic_terms;
    if (executable !== true) return { pass: false, reason: "executable_with_generic_terms!=true" };
  }
  if (layer === "memory") {
    if (item.stability !== "long_lived") return { pass: false, reason: "stability!=long_lived" };
    const aboutUser = item.self_test?.about_user_not_code;
    if (aboutUser !== true) return { pass: false, reason: "about_user_not_code!=true" };
  }

  return { pass: true };
}
```

---

## 4. 宿主格式化器

### 4.1 通用 markdown 结构

所有宿主共用同一段 markdown 内容，只是外层 marker 和文件路径不同：

```markdown
<!-- >>> memory-v3 static-rules >>> -->
## 治理规则（AGI-Memory 编译）

以下规则已经过审批，执行时必须遵守：

### [RULE_ID] 规则标题
- **触发条件**: ...
- **约束**: ...
- **来源**: AGI-Memory rule_id=xxx, 审批时间=xxx
- **人工可读声明**: metadata.human_readable_statement

...
<!-- <<< memory-v3 static-rules <<< -->
```

### 4.2 宿主差异

| 宿主 | 文件路径 | marker 前缀 | 备注 |
|------|---------|------------|------|
| trae | `.trae/instructions.md` | `<!-- >>> memory-v3 static-rules >>>` | 已有 policy marker，新增 static marker |
| claude code | `CLAUDE.md` | 同上 | 已有 policy marker，新增 static marker |
| codex | `AGENTS.md` | 同上 | 已有 policy marker，新增 static marker |

### 4.3 格式化器接口

```typescript
// hostFormats/traeFormat.ts
export interface HostFormatter {
  /** 宿主类型 */
  host: HostType;
  /** 目标文件路径（相对仓库根） */
  getFilePath(repoRoot: string): string;
  /** 生成 Rule 段落 */
  formatRules(rules: CompiledRule[]): string;
  /** 生成 Skill 段落 */
  formatSkills(skills: CompiledSkill[]): string;
  /** 生成 Memory 段落 */
  formatMemories(memories: CompiledMemory[]): string;
}
```

---

## 5. 触发机制

### 5.1 即时编译（审批通过时）

在 `memory-host-action-execute` skill 的执行流程里加一步：
Rule/Skill 审批通过 → host-action 落地为 .hook.ts/.mjs → **调用 compileStaticMemory**。

```typescript
// 伪代码：在 hostActionExecutor.ts 的 executeHostAction 流程末尾
if (approvedRule.promotion_status === "active") {
  await compileStaticMemory({
    tenantId: input.tenantId,
    scope: input.scope,
    trigger: "immediate"
  });
}
```

**为什么即时编译不全量：**
即时编译只编译刚审批通过的那一条，写进对应 marker 区域。不重新编译所有内容（减少开销）。

但为了实现简单，第一版可以全量重编译（反正筛选后的条目数量不会太多，通常 < 50 条）。

### 5.2 定时兜底（每天 03:00）

```typescript
// scheduler.ts
// 每天 03:00 全量重编译，防止文件被手动改坏
const CRON_EXPRESSION = "0 3 * * *";

export async function scheduledRecompile(): Promise<void> {
  const tenants = await getAllTenants();
  for (const tenant of tenants) {
    await compileStaticMemory({
      tenantId: tenant.id,
      scope: tenant.defaultScope,
      trigger: "scheduled"
    });
  }
}
```

**为什么需要兜底：**
- 用户可能手动删除了 marker 区域
- 用户可能手动改坏了文件内容
- 即时编译可能因临时故障失败
- DB 中的 Rule 可能被 L3 演进扫描标记为 SUPERSEDED，需要从静态文件中移除

---

## 6. 安全保障

### 6.1 marker 注入，不全量覆盖

复用 `upsertMarkedTextFile` 的逻辑：
- 找到 marker 对 → 只替换 marker 之间的内容
- 找不到 marker 对 → 追加到文件末尾
- 用户手写的其他内容不受影响

### 6.2 编译前自动备份

复用 `backupFile` 逻辑：
- 备份到 `.memory-mcp-backups/` 目录
- 文件名带时间戳：`CLAUDE.md.{Date.now()}.bak`
- 保留最近 5 个备份（超出自动清理）

### 6.3 编译后验证

- 验证 marker 配对完整性（start 和 end 都存在且 start < end）
- 验证文件可正常解析（无 markdown 语法错误）
- 验证内容不含敏感信息（本地路径、DB URL、密钥）

### 6.4 敏感信息过滤

编译前对 content 做敏感信息扫描：
- 本地文件路径（`/Users/`、`C:\Users\`、`/home/`）
- 数据库连接字符串（`postgresql://`、`mysql://`）
- 密钥模式（`API_KEY`、`SECRET`、`TOKEN`）
- 命中则跳过该条目，记录到 `skipped` 列表

---

## 7. 实施计划

### S-1: 核心编译器（先做）

- `contentFilter.ts`：筛选逻辑 + 单元测试
- `markerManager.ts`：复用 `upsertMarkedTextFile`，支持新 marker
- `compiler.ts`：DB 查询 → 筛选 → 格式化 → 写文件
- `hostFormats/traeFormat.ts`：先做 trae 一个宿主

**验证**：手动调用 `compileStaticMemory`，检查 `.trae/instructions.md` 内容正确

### S-2: 多宿主 + 即时触发

- `hostFormats/claudeFormat.ts` + `hostFormats/codexFormat.ts`
- 修改 `hostActionExecutor.ts`：审批通过后调用 `compileStaticMemory`
- gate test：审批一条 Rule → 验证三个宿主文件都更新

**验证**：跑 host-action 流程，检查三个文件同步更新

### S-3: 定时兜底 + 安全保障

- `scheduler.ts`：cron job 每天 03:00 全量重编译
- 敏感信息过滤
- 编译后验证
- 备份清理（保留最近 5 个）

**验证**：模拟文件被改坏 → 定时任务修复

### S-4: gate test

- `tests/integration/static-memory-compiler.test.mjs`
- 测试内容：筛选正确性、marker 注入、多宿主同步、敏感信息过滤、备份

---

## 8. 验收标准

| 标准 | 验证方式 |
|------|---------|
| 审批通过的 Rule 在三个宿主文件中都出现 | 审批后检查 CLAUDE.md / AGENTS.md / .trae/instructions.md |
| 未审批的 Rule 不出现 | 检查文件内容 |
| 时间敏感内容不出现 | 构造含"今天"的 Rule，检查被跳过 |
| 用户手写内容不受影响 | 检查 marker 外的内容不变 |
| 编译前有备份 | 检查 .memory-mcp-backups/ 目录 |
| 定时任务能修复被改坏的文件 | 手动删除 marker → 跑定时任务 → 检查恢复 |

---

## 9. 风险与对策

| 风险 | 对策 |
|------|------|
| 静态文件过大导致宿主 context window 膨胀 | 限制编译条目数（默认 50 条），超出按 importance_weight 排序取 top |
| Rule 内容含项目专名导致跨项目泄露 | 复用 `PROJECT_NOUN_PATTERNS` 过滤 |
| 多宿主文件路径冲突 | 每个宿主独立文件，不共享 |
| 编译失败导致文件损坏 | 先写临时文件，成功后原子替换 |

---

## 10. 不做的事（明确排除）

- 不做 retrieve_context 的缓存层（单独 spec 处理）
- 不做宿主 context window 管理
- 不做会话摘要/压缩
- 不做静态文件的 hot reload（宿主自己管读取时机）
- 不做多租户隔离的静态文件（第一版单租户，多租户后续扩展）
