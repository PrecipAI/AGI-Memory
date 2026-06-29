/**
 * GateContext — 门控运行时上下文
 * 由宿主程序提供，注入到每个 gate / hook 的 run() 函数中。
 */

export interface GateContext {
  /** 当前任务类型 */
  taskType: string;
  /** 当前操作标识 */
  operation: string;
  /** 当前工作目录 */
  cwd: string;
  /** 当前任务请求 ID */
  taskRequestId?: string;
  /** 当前宿主类型 */
  host?: string;
  /** 项目引用 */
  projectRef?: string;
  /** 当前 session ID */
  sessionId?: string;
  /** 当前 project ID */
  projectId?: string;

  /** 获取当前变更的文件列表 */
  getChangedFiles(): Promise<string[]>;
  /** 在 diff 中搜索匹配 */
  searchInDiff(pattern: RegExp | string): Promise<string[]>;
  /** 读取文件内容 */
  readFile(filePath: string): Promise<string>;
  /** 写入文件内容 */
  writeFile?(filePath: string, content: string): Promise<void>;
  /** 执行 shell 命令 */
  exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** 获取 git 状态 */
  getGitStatus(): Promise<{ staged: string[]; modified: string[]; untracked: string[] }>;
  /** 检查指定文件是否被修改 */
  isFileChanged?(filePath: string): Promise<boolean>;
  /** 搜索代码内容 */
  searchInFiles?(pattern: RegExp | string, glob?: string): Promise<Array<{ file: string; line: number; text: string }>>;
}

/**
 * GateResult — 门控检查结果
 */
export interface GateResult {
  /** 是否通过 */
  pass: boolean;
  /** 是否阻止操作继续 */
  block?: boolean;
  /** 关联的规则 ID */
  rule_id?: string;
  /** 关联的规则键 */
  rule_key?: string;
  /** 失败原因 */
  message?: string;
  /** 修复建议 */
  suggestion?: string;
}

/**
 * GateModule — 门控模块接口（旧版，向后兼容）
 * 每个生成的 gate 文件必须导出这三个成员。
 */
export interface GateModule {
  RULE_ID: string;
  RULE_KEY: string;
  shouldRun(context: GateContext): boolean;
  run(context: GateContext): Promise<GateResult>;
}

// ═══════════════════════════════════════════════════════════════════
// 执行 Hook 标准接口（Execution Hook）
// ═══════════════════════════════════════════════════════════════════

/**
 * Hook 挂载点
 * 定义 Hook 在宿主执行生命周期中的触发时机
 */
export type HookMountPoint =
  /** 在模型调用任何工具之前 */
  | "before_tool_call"
  /** 在模型调用工具之后、结果返回模型之前 */
  | "after_tool_call"
  /** 在模型生成输出之前（可注入 prompt 约束） */
  | "before_generation"
  /** 在模型生成输出之后、提交给用户之前 */
  | "after_generation"
  /** 在任务标记为完成之前（最终检查） */
  | "before_task_complete"
  /** 在文件写入之前 */
  | "before_file_write"
  /** 在文件写入之后 */
  | "after_file_write"
  /** 在命令执行之前 */
  | "before_command_exec"
  /** 在命令执行之后 */
  | "after_command_exec"
  /** 在 git commit 之前 */
  | "pre_commit";

/**
 * Hook 执行结果
 */
export interface HookResult {
  /** PASS: 放行；REJECT: 拦截；RETRY: 要求模型重试；INJECT: 注入上下文 */
  action: "PASS" | "REJECT" | "RETRY" | "INJECT";
  /** 拦截或重试时的原因说明 */
  reason?: string;
  /** 给模型的修复提示 */
  retry_hint?: string;
  /** INJECT 时要注入到 prompt 的额外内容 */
  inject_content?: string;
  /** 关联的规则 ID */
  rule_id?: string;
  /** 关联的规则键 */
  rule_key?: string;
}

/**
 * RuleHook — 执行 Hook 标准接口
 * 由 gate-master skill 生成的每个 Hook 文件必须实现此接口。
 *
 * 与 GateModule 的区别：
 * - GateModule 是简单的 shouldRun + run 模式，适合一次性检查
 * - RuleHook 支持多个挂载点，可以在执行生命周期的不同阶段触发
 * - RuleHook 支持 INJECT 动作，可以动态修改模型上下文
 */
export interface RuleHook {
  /** Hook 唯一标识 */
  id: string;
  /** 关联的规则 ID */
  rule_id: string;
  /** 关联的规则键 */
  rule_key: string;
  /** 挂载点列表（一个 Hook 可以挂载到多个生命周期节点） */
  mount_points: HookMountPoint[];
  /** 判断当前上下文是否应该触发此 Hook */
  shouldRun(context: GateContext): boolean;
  /** 执行 Hook 逻辑 */
  run(context: GateContext): Promise<HookResult>;
}

/**
 * HookRegistryEntry — Hook registry 中的条目
 */
export interface HookRegistryEntry {
  hook_id: string;
  rule_id: string;
  rule_key: string;
  /** 作用域：global 或 project */
  scope: "global" | "project" | "user" | "workspace" | "session";
  /** 项目级 Hook 必须填 project_id */
  project_id: string | null;
  /** 挂载点列表 */
  mount_points: HookMountPoint[];
  /** Hook 文件路径 */
  file: string;
  /** 是否启用 */
  enabled: boolean;
  /** 生成时间 */
  generated_at: string;
}

/**
 * GateRegistryEntry — 旧版 gate registry 条目（向后兼容）
 */
export interface GateRegistryEntry {
  rule_id: string;
  rule_key: string;
  file: string;
  checkpoint: "pre_action" | "post_action" | "on_file_change" | "pre_commit";
  task_type: string;
  operation: string;
  enabled: boolean;
  generated_at: string;
}
