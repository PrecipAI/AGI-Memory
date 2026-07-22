# 42. 项目代码知识图谱接入 Spec

> 状态：READY_FOR_REVIEW（4 个决策已确认，待用户审查后进入实施）
> 创建：2026-07-22
> 关联：[41-static-memory-compiler-spec.md](./41-static-memory-compiler-spec.md)

## 1. 背景与目标

### 1.1 问题

AGI-Memory 现有四层（Memory/Rule/Skill/Knowledge）都是**对话驱动**的——输入源是会话文本。但"项目模块怎么依赖、这个函数被谁调用、这个类的继承关系"这些**结构性事实**压根不是对话内容，是对代码文件做静态分析得出的。

现有 Graphify 接入是全量重建（`npm run graph:rebuild`），输出到 `graphify-out/` 目录，与 AGI-Memory 的 PostgreSQL 存储完全脱节。图谱过时、无法治理、无法跨层派生。

### 1.2 目标

把 Graphify 的代码知识图谱接入 AGI-Memory，作为 Knowledge 层的"项目代码"分支，实现：
1. 图谱节点写入 AGI-Memory，纳入治理体系
2. 实时增量更新（代码变更后立即同步图谱）
3. 跨层派生（代码节点 ↔ Rule/Memory/Knowledge 关联）
4. MCP 工具查询（项目结构问题走图谱，不走向量检索）

### 1.3 非目标

- 不重写 Graphify 的解析逻辑（tree-sitter AST 解析交给 Graphify）
- 不把代码 AST 存进 PostgreSQL（Graphify 自己管图谱存储）
- 不引入 Cognee/Serena（Cognee 是竞品，Serena 不存图谱）
- 不做代码编辑能力（rename/find reference 交给 IDE，不做）

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│  宿主 Agent（TRAE / Claude Code / Cursor）                   │
│  ├─ UserPromptSubmit hook → Knowledge 召回注入               │
│  └─ Stop hook → 代码变更检测 → 增量更新图谱                  │
└──────────────┬──────────────────────────────────────────────┘
               │ MCP 协议
               ▼
┌─────────────────────────────────────────────────────────────┐
│  AGI-Memory MCP Server（TypeScript）                         │
│  ├─ memory_retrieve_context（现有，认知 knowledge）          │
│  ├─ project_knowledge_query（新增，代码图谱查询）            │
│  └─ project_knowledge_update（新增，增量更新触发）           │
└──────────────┬──────────────────────────────────────────────┘
               │
       ┌───────┴────────┐
       ▼                ▼
┌──────────────┐  ┌─────────────────────────────────────────┐
│ PostgreSQL   │  │ Graphify（Python 独立进程）              │
│ layers 表    │  │ ├─ tree-sitter AST 解析                  │
│ kind=        │  │ ├─ 图谱存储（graphify-out/）             │
│  project_    │  │ └─ query/path/explain CLI                │
│  structure   │  └─────────────────────────────────────────┘
└──────────────┘
```

### 2.2 分层职责

| 组件 | 职责 | 不做什么 |
|------|------|---------|
| Graphify（Python） | tree-sitter AST 解析、图谱构建、社区发现、query/path/explain | 不存 PostgreSQL，不做治理 |
| AGI-Memory PostgreSQL | 存 project_structure knowledge 节点元数据 + layer_links 跨层关系 | 不存 AST，不存完整图谱 |
| MCP Server | 暴露查询/更新接口给宿主，路由到 Graphify 或 PostgreSQL | 不做解析 |
| Stop hook | 检测代码变更，触发增量更新 | 不做解析，不做查询 |

### 2.3 Graphify 接入方式

**决策：Graphify 作为独立 Python 进程，MCP Server 通过 child_process 调用其 CLI**

理由：
1. Graphify 是 Python 生态，AGI-Memory 是 TypeScript，跨语言内嵌不值得
2. Graphify 已有 query/path/explain CLI 子命令，直接复用
3. 独立进程隔离，Graphify 升级/崩溃不影响 AGI-Memory 主服务
4. 未来 Graphify 出 MCP server 版本时，切换成本低

## 3. 数据模型

### 3.1 Layer 归属

**决策：layer='knowledge', kind='project_structure'，与认知 knowledge 分开管理**

用户原话："我们的 knowledge 可以用，但是得完全分开来，应该是属于其分支，项目代码类 knowledge"

实现方式：
- `layer = 'knowledge'`（复用现有 Knowledge 层所有基础设施）
- `kind = 'project_structure'`（区分认知 knowledge 和代码 knowledge）
- 检索时用 kind 过滤，治理时分流

新增 kind 值（节点类型细分）：
```
kind IN (
  'project_structure',     -- 通用项目结构节点
  'project_module',        -- 模块/包
  'project_function',      -- 函数/方法
  'project_class',         -- 类/接口
  'project_file',          -- 文件
  'project_endpoint'       -- API 端点
)
```

### 3.2 节点 content schema

project_structure knowledge 节点的 content 字段存 JSON：

```json
{
  "node_id": "auth.login",
  "node_type": "function",
  "file_path": "services/memory-service/src/auth.ts",
  "start_line": 42,
  "end_line": 58,
  "summary": "用户登录接口，校验密码并生成 JWT",
  "inputs": ["username", "password"],
  "outputs": ["token"],
  "project_id": "agi-memory-src",
  "git_commit": "abc1234",
  "graphify_version": "1.0.0",
  "last_updated": "2026-07-22T10:30:00Z"
}
```

### 3.3 边（layer_links 扩展）

现有 layer_links 表的 link_type 枚举：`derived_from / explains / constrains / provenance`

新增代码图谱专用 link_type：

```sql
ALTER TABLE layer_links DROP CONSTRAINT layer_links_link_type_check;
ALTER TABLE layer_links ADD CHECK (link_type IN (
  'derived_from', 'explains', 'constrains', 'provenance',
  'calls',        -- 函数 A 调用函数 B
  'imports',      -- 模块 A 导入模块 B
  'belongs_to',   -- 函数 A 属于类 B
  'depends_on'    -- 服务 A 依赖服务 B
));
```

### 3.4 安全边界（坑二解决方案）

**强制约束：project_structure knowledge 只能是 project_reusable scope**

```sql
-- 应用层强制：插入 project_structure knowledge 时校验 scope
-- 不允许 session_only / user_reusable / global_reusable
CHECK (
  (kind NOT LIKE 'project_%') OR
  (availability_scope = 'project_reusable')
)
```

多租户隔离：
- `tenant_id + project_id` 双重锁定
- MCP 工具查询强制带 project_id
- 数据库查询 WHERE 子句强制带 tenant_id AND project_id
- 不允许跨项目/跨租户查询

## 4. 增量更新机制（坑一解决方案）

### 4.1 用户需求

用户原话："首先，图谱需要实时的根据项目变动来改变，每次一个地方的修改验证完之后，都要做图谱的修改，这样可以避免过时。"

### 4.2 设计：事件驱动增量更新

**触发点：Stop hook（AI 完成任务后）**

为什么不是 PostToolUse hook：
- PostToolUse 在每次 Edit/Write 后触发，频率太高
- 一次任务可能改多个文件，Stop 时一次性增量更新更高效
- "验证完之后"对应 Stop 事件，不是 PostToolUse

**更新流程**：

```
Stop hook 触发
    │
    ▼
git diff --name-only HEAD（获取变更文件列表）
    │
    ▼
过滤：只保留 services/ libs/ scripts/ 下的 .ts/.tsx/.mjs 文件
    │
    ▼
变更文件列表为空？─是→ exit 0（无代码变更，不更新）
    │否
    ▼
调用 Graphify 增量解析（只解析变更文件）
    │
    ▼
更新 PostgreSQL 里的 project_structure knowledge 节点
    │  ├─ 变更文件对应节点：更新 content + git_commit
    │  ├─ 删除文件对应节点：标记 deprecated
    │  └─ 新增文件对应节点：插入新节点
    │
    ▼
更新 layer_links（calls/imports/belongs_to 关系）
    │
    ▼
exit 0
```

### 4.3 版本号追踪

每个 project_structure knowledge 节点带 `git_commit` 字段：
- 值为节点对应文件最后一次变更的 git commit hash
- 查询时可对比当前 HEAD，不一致则标记 stale
- stale 节点在召回时附加警告："此节点可能过时，最后更新于 commit abc1234"

### 4.4 失效检测

MCP 工具 `project_knowledge_query` 返回结果时：
1. 检查节点 git_commit 是否与当前 HEAD 一致
2. 不一致 → 节点附加 `stale: true` 标记
3. 返回结果头部显示："N 条节点中 M 条可能过时"

### 4.5 兜底：定时全量重建

低频全量重建（每天一次或每周一次），作为增量更新的校验：
- 对比全量重建结果与增量更新结果
- 修复增量更新可能遗漏的节点
- 不作为主要更新机制，只做兜底

## 5. MCP 工具设计

### 5.1 新增 MCP 工具

| 工具 | 用途 | 输入 | 输出 |
|------|------|------|------|
| `project_knowledge_query` | 查询项目代码结构 | query, project_id, top_k | 代码节点列表 |
| `project_knowledge_update` | 触发增量更新 | changed_files[] | 更新统计 |
| `project_query_callers` | 查询函数调用者 | function_name, project_id | 调用者列表 |
| `project_query_impact` | 查询修改影响范围 | function_name, project_id | 受影响节点列表 |

### 5.2 与现有工具的关系

`memory_retrieve_context`（现有）：
- 认知类问题 → 查 knowledge（kind != 'project_%'）
- 代码结构问题 → 查 project_structure knowledge（kind = 'project_%'）
- 两者在 retrieve 时用 kind 过滤，互不干扰

`project_knowledge_query`（新增）：
- 专门给代码结构查询用
- 内部调 Graphify query/path/explain CLI
- 返回 Graphify 图谱结果 + PostgreSQL 元数据

## 6. 跨层派生

### 6.1 设计

project_structure knowledge 节点可以与其他层建立 layer_links 关系：

| 关系类型 | 示例 | link_type |
|----------|------|-----------|
| Rule 约束代码节点 | Rule "禁止 Controller 直接拼 SQL" → UserController#search | constrains |
| Memory 解释代码节点 | Memory "用户表加字段后忘记同步导出" → UserService#export | explains |
| Knowledge 源于代码节点 | Knowledge "项目采用六边形架构" → UserAdapter 类 | provenance |

### 6.2 派生触发

跨层派生在治理运行（governance run）时自动检测：
1. 扫描新增/变更的 Memory/Rule/Knowledge
2. 提取其中提到的函数名/类名/模块名
3. 在 project_structure knowledge 里匹配对应节点
4. 自动建立 layer_links 关系

## 7. 实施路线

### P0：跑通最小闭环（验证可行性）

1. 写 migration 0030_project_knowledge.sql：
   - 扩展 layer_links 的 link_type CHECK 约束
   - 加 project_structure 相关索引

2. 写脚本把 Graphify 输出（graphify-out/graph.json）批量导入 PostgreSQL：
   - 节点 → layers 表（layer='knowledge', kind='project_*'）
   - 边 → layer_links 表（link_type='calls'/'imports' 等）

3. 验证：在 governance-console 里看到 project_structure 节点

### P1：MCP 工具 + 增量更新

1. 新增 MCP 工具 project_knowledge_query
2. 写 Stop hook 脚本：检测代码变更 → 触发 Graphify 增量解析 → 更新 PostgreSQL
3. 验证：改一个函数，Stop 后图谱自动更新

### P2：跨层派生 + 治理

1. 治理运行时自动检测代码节点引用，建立 layer_links
2. L2 冲突检测：循环依赖、重复函数名
3. L3 演进扫描：废弃模块标记

### P3：可视化

1. 洋葱图支持显示 project_structure 节点
2. 从函数节点跳转到相关 Rule/Memory/Knowledge

## 8. 已确认决策

### D1：增量更新策略 → 自己写增量逻辑（方案 A）

用户原话："肯定不能每次都全量，我们自己写增量，并且要验证是否能真正的实现我们的想法"

**实现方案**：
1. 调 Graphify `extract()` 只传变更文件列表（不传全量文件）
2. 解析结果 merge 到现有 graphify-out/graph.json
3. 更新 PostgreSQL 里的 project_structure knowledge 节点

**验证要求**（必须通过才能进入 P1）：
- 增量更新结果与全量重建结果做 diff，节点/边数量一致
- 变更文件对应的节点内容与全量重建一致
- 删除文件对应的节点被正确标记 deprecated
- 新增文件对应的节点被正确插入

**失败回退**：如果增量逻辑验证不通过，降级为全量重建（方案 B），但必须标记为临时方案。

### D2：project_id 来源 → 多级 fallback

用户原话："project_id 我们可以自己根据项目名称来创建吧，通过 git 也行，这个都行吧"

**fallback 顺序**：
1. `git remote get-url origin` 提取仓库标识（最准确）
2. `package.json` name 字段（本地项目无 remote 时）
3. 当前目录名（最后兜底）

**实现**：写一个 `resolveProjectId()` 函数，按上述顺序尝试，缓存结果避免重复计算。

### D3：Stop hook 性能 → 同步等待

用户原话："必须同步，异步肯定会有问题，如果异步那要确保异步时，无代码更新修改，怎么确保？"

用户质疑正确：异步更新期间如果有新的代码修改，会产生竞态条件。

**同步方案**：
- Stop hook 同步等待图谱更新完成
- 设置硬超时 30 秒，超时则降级为标记 stale（下次查询时触发更新）
- 必须优化速度：只解析变更文件（D1 增量逻辑），不全量

**超时保护**：
```
Stop hook 触发
    │
    ▼
git diff 获取变更文件
    │
    ▼
变更文件 > 20 个？─是→ 跳过更新，标记 stale（避免超时）
    │否
    ▼
同步增量更新（超时 30 秒）
    │
    ├─ 成功 → exit 0
    ├─ 超时 → 标记 stale，exit 0（不阻塞用户）
    └─ 失败 → 标记 stale，exit 0（不阻塞用户）
```

### D4：Graphify 安装 → 全局安装

用户原话："全局安装"

**安装命令**：`pip install graphifyy`

**注意**：PyPI 包名是 `graphifyy`（双 y），CLI 命令是 `graphify`。装错包会得到一个 8 年前的随机图生成器。

**验证安装**：`graphify --version` 或 `python -c "import graphify; print(graphify.__version__)"`

## 9. 风险与缓解

| 风险 | 严重度 | 缓解措施 |
|------|--------|---------|
| Graphify 增量更新不稳定 | 高 | 自己写增量逻辑，验证不通过降级为全量重建（D1 决策） |
| Stop hook 延迟影响体验 | 中 | 同步更新 + 30 秒超时保护 + 变更文件 >20 个跳过（D3 决策） |
| project_structure 节点膨胀 | 中 | 只存函数/类/模块级节点，不存文件级（除非必要） |
| 跨项目数据泄漏 | 高 | 强制 scope=project_reusable + tenant_id+project_id 双锁 |
| Graphify Python 依赖冲突 | 低 | 全局安装，如冲突再改 venv（D4 决策） |
