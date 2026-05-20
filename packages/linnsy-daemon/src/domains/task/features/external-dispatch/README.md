# External Dispatcher

> **定位**：linnsy daemon 把任务派给"外部 agent"（codex / claude code / cursor 等）的统一执行层。
>
> 上层是工具集（`domains/agent-run/features/tool-runtime/tools/delegate-to-external.ts`），下层按 vendor 拆子目录（`codex/` / 未来 `claude-code/` / `cursor/`）。本目录只放 port 抽象 + vendor 索引 + 跨 vendor 标准化字段（如 `TaskLocator`）。

---

## 1. 这层是什么 · 为什么有它

linnsy = **董事长助理 / 任务管理秘书**。重活（写代码 / 翻仓库 / 跑命令 / 调 MCP / 自动化操作）由外部 agent 干，linnsy 自己负责派单、监工、汇报。

外部 agent 的本质不是某个 IDE / 应用，而是**本地任务执行器**——能启动、喂 prompt、订阅事件、收 final message、归档结果。这层就是这个抽象的落点。

---

## 2. 抽象边界（什么属于这层 / 什么不属于）


| 属于这层                                          | 不属于这层                                                   |
| --------------------------------------------- | ------------------------------------------------------- |
| `ExternalAgentDispatcherPort` 契约（`types.ts`）  | 任务状态机（在 `../tracker/`）                                |
| 各 vendor 子目录（`codex/` 等）的 dispatcher / probe 实现 | 任务表 schema（在 `domains/task/persistence/sqlite-task-store.ts`） |
| vendor 事件流 → linnsy 内部事件归一化                   | 委派工具入口（在 `domains/agent-run/features/tool-runtime/tools/delegate-to-external.ts`）  |
| `TaskLocator` 跨 vendor 标准化（§4）                | 主对话 LLM 怎么决定派给谁（在 `agents/<delegate-to-*>/`）            |
| task workspace 路径计算 / 子进程生命周期管理               | task workspace 文件落盘（在 `workspace/`）                     |
| Phase 1 mock dispatcher（`mock-dispatcher.ts`） |                                                         |
| Codex session 安全摘要与最近 thread 元数据读口（`codex/http/`） | 完整任务 payload/result 对外暴露或独立任务面板 |


---

## 3. Vendor 索引


| Vendor          | 状态            | 子目录                  | definitionKey             | locator kind 期望           | 主要文档                                     |
| --------------- | ------------- | -------------------- | ------------------------- | ------------------------- | ---------------------------------------- |
| **codex**       | Phase 1 第一个落地 | `codex/`             | `delegate_to_codex`       | `directory`               | `[./codex/README.md](./codex/README.md)` |
| **claude code** | Phase 2 计划    | `claude-code/`（未建）   | `delegate_to_claude_code` | `directory`（预期，与 codex 同） | —                                        |
| **cursor**      | Phase 2 计划    | `cursor/`（未建）        | `delegate_to_cursor`      | `directory`（预期）           | —                                        |
| **linnya**      | 独立 sprint     | `linnya/`（未建）        | `delegate_to_linnya`      | `project`                 | —                                        |
| **chatgpt_web** | Phase 2+      | `chatgpt-web/`（未建）   | —                         | `remote` 或 `none`         | —                                        |
| **mcp**         | Phase 2+      | `mcp/`（未建）           | —                         | `none` 或 `remote`         | —                                        |
| mock            | 测试用           | `mock-dispatcher.ts` | 任意 definition             | 任意                        | —                                        |

`definitionKey` 到 `externalKind` 的映射集中在 `vendor-kind.ts`，上层工具只读映射结果，不散落 vendor 字符串判断。主模型偶尔会把主人说的产品短名直接填进工具参数，例如 `codex`；`vendor-kind.ts` 只把已知短名归一化成正式 `delegate_to_*` key，未知值仍交给 registry fail closed。

**vendor 扩展原则**：

- 加一个 vendor = 加一个子目录 + 加一个 `delegate_to_<vendor>` definition（在 `agents/`）+ 在 vendor-kind 映射里登记
- **不引入 `vendor` 参数到工具集**——通过 `definitionKey` 区分，主流程零改动
- **task id 不带 vendor 前缀**（2026-05-08 拍板，明确反对）：vendor 维度由 `external_kind` / `locator` 字段表达；task id 仍是全局唯一 `task_<uuid>`，跨 vendor 续派时 id 体系不会失真，`get_task_status` 的短 id 前缀匹配也不会被 vendor 前缀语义搅乱
- 三家可同时启用、主人挑哪个用、未来允许同一个任务自动选最合适的 vendor（Phase 2+）

---

## 4. `TaskLocator` 跨 vendor 标准化（vendor-neutral 工作位置）

> 2026-05-08 拍板。所有 vendor 通过统一字段表达"这个任务在哪干活"，主流程零 vendor 分支。

### 4.1 字段形态

```ts
type TaskLocatorKind = 'directory' | 'project' | 'remote' | 'none';

interface TaskLocator {
  kind: TaskLocatorKind;
  label: string;                  // 给人看的短名
  ref?: string;                   // 真值，按 kind 解释
  meta?: Record<string, unknown>; // vendor 私货
}
```

vendor ↔ kind ↔ ref 含义对照：

| vendor | kind | ref 含义 | 示例 |
|---|---|---|---|
| codex / cursor / claude code | `directory` | 绝对文件系统路径 | `{kind:'directory', label:'linnsy', ref:'/Users/tiansi/code/linnsy'}` |
| linnya | `project` | linnya 内部 project id | `{kind:'project', label:'Q3 周报', ref:'proj_abc123'}` |
| chatgpt_web | `remote` | 网页 URL | `{kind:'remote', label:'Q4 复盘对话', ref:'https://chat.openai.com/c/...'}` |
| mcp / manual | `none` | 省略 | `{kind:'none', label:'查询 GitHub PR'}` |

### 4.2 校验职责拆分

- **主流程层（`delegate_to_external` 工具）**：只校验**形态合法**——`kind` 在枚举内、`label` 非空、`ref` 与 `kind` 协议匹配（`none` 必须无 `ref`）。
- **默认干活区兜底**：对 `directory` 类 vendor，若主模型判断是产出类任务并省略 `locator`，`delegate_to_external` 会通过 PathManager 在用户根目录下创建 `Linnsy Work/<task-slug>/`，再把生成的 directory locator 写入 task。项目类任务不允许用这条兜底，必须给明确项目目录或追问。
- **vendor adapter 层**：校验**vendor 自己关心的具体规则**：
  - codex adapter：要求 `kind=directory`；`ref` 必须是绝对路径、已存在、且是目录；不接受 `/`、`/home`、`/Users`、`/tmp`、`/private/tmp`、`/var`、`/var/tmp` 等泛目录。
  - linnya adapter（未来）：要求 `kind=project`；`ref` 必须存在于 linnya 项目库。
  - chatgpt_web adapter（未来）：要求 `kind=remote`；`ref` 必须是合法 URL。

这条拆分确保**加 cursor 时 codex 的 cwd 规则不会被 cursor 强制继承**（cursor 可能允许相对路径），加 linnya 时也不会因为"工具层硬要求 cwd"而被挡掉。

### 4.3 旧 cwd 字段处理

产品尚未发布，P0 不做 `payload.cwd` 兼容迁移，直接落目标形态：

- `delegate_to_external` 工具入参只收顶层 `locator`，不收 `cwd` 兼容字段。
- 新代码不写、不读 `payload.cwd`，也不从旧 `payload.cwd` 反推 `task.locator`。
- 没有 `locator_json` 的开发期旧 task 查询时显示 `位置=未知`。
- 主流程层（observation / `get_task_status` / `list_tasks`）**只读 `task.locator`**，不再硬读 `payload.cwd`。
- codex adapter 实际执行仍需要绝对路径，**自己**从 `locator.ref` 派生（kind 必须是 `directory`），派生失败时拒绝 dispatch 并抛 `LINNSY_TASK_LOCATOR_KIND_NOT_SUPPORTED`。

### 4.4 observation 字段顺序（统一 spec）

`get_task_status` / `list_tasks` 任务摘要行字段固定顺序：

```
taskId / status / vendor=<external_kind> / 位置=<locator.label>(<locator.ref?>) / 节点=<lastNode?> / session=<externalRef?> / error=<errorMessage?> / final=已记录?
```

vendor 私有补充（例如 codex `sandbox=workspace-write` 提示）通过 `task.locator.meta` 或 `task.result.adapterNotes`，不为某 vendor 单独加分支。

---

## 5. Port 契约（高层）

`ExternalAgentDispatcherPort`（详见 `types.ts`）：


| 方法                          | 用途                                              | Phase 1 状态                          |
| --------------------------- | ----------------------------------------------- | ----------------------------------- |
| `dispatch(input)`           | 派一个新活；fire-and-forget                           | ✅ 已有                                |
| `continue(input)`           | 在已有 task 的同 session 上追加 prompt（codex resume 等价） | ✅ Codex adapter 已接                  |
| `cancel(input)`             | 通知运行中 task 停止 / 杀子进程                             | ✅ Codex adapter 发 `SIGTERM`；mock 清理待执行回调 |


> **实现备忘**：daemon 默认通过 `RoutingExternalAgentDispatcher` 路由。`delegate_to_codex` 走真实 `CodexExecDispatcher`；其他未接 vendor fail closed。mock dispatcher 只用于测试级进度模拟。设置页的 Codex 连接状态走 `codex/CodexProbePort`，只执行 `codex --version`，不启动任务。

---

## 6. 跟 TaskTracker 的关系

External dispatcher **不写 task 状态**——所有状态变化通过 `TaskTrackerPort.onExternalUpdate(taskId, update)` 通知 TaskTracker，由 TaskTracker 决定状态机跃迁与"是否需要通知主人"（`should_notify | silent`）。

事件归一化由各 vendor 子目录的 `*-event-normalizer.ts` 负责，把 vendor 原生事件（codex NDJSON / 未来 ACP session updates / Cursor stream-json 等）翻译成 `ExternalUpdate` 形态：

```ts
{ node?: string; status?: TaskStatus; partialResult?; finalResult?; errorMessage?; meta? }
```

详见 `../tracker/definitions/types.ts` re-export 的 `ExternalUpdate` 定义。

---

## 7. 工具集对外暴露（沿用 S3 已有 + Codex 接管工具）

### 7.1 沿用（不动）

`domains/agent-run/features/tool-runtime/tools/` 下已有：

- `delegate_to_external` · 派活（`definitionKey` 选 vendor）
- `delegate_to_internal` · 派内部子 agent（与外部委派对偶，不走本层）
- `list_tasks` / `get_task_status` · 查询（observation 已按 §4.4 统一 spec）
- `manage_task` · 对已有 task 做状态控制：`action=cancel | pause | resume | continue`
- `manage_external_session` · 列外部 agent 可接管历史并接管主人选中的 session；Codex 默认先按 session `cwd` 列项目分组，再列指定项目 thread，接管时 `locator.ref` 使用 session 自己的 `cwd`
- `redelegate_task` · 关旧 task + 开新 task；默认沿用旧 locator，不允许跨 kind 切换

### 7.2 `manage_task(action="continue")`

当前工具契约：

- 入参：`action="continue"` + `taskId` + `message`
- 行为：调 `dispatcher.continue(input)` → vendor 子目录翻译成对应"resume"动作；若 task 是 `completed` 的求审批语义，会回到 `in_progress`
- 用途：约定式审批回路 / 主人补充输入 / 让 task 接着干

详见 `[./codex/README.md §9.2](./codex/README.md)`。

### 7.3 Codex 历史接管工具

`manage_external_session` 只服务“主人选择某个已有外部历史继续”的动作，不替代 `delegate_to_external`。它用 `action=list_projects | list_threads | attach` 收敛成一个工具入口，避免主 Agent 的工具面继续膨胀。关键约束：

- 不把 Codex 全量历史导入 task 表；只接管被主人选中的 session。
- 不把 Codex 历史当全局聊天列表；默认按 `session_meta.payload.cwd` 分组和过滤。
- 不读取完整 thread 正文；当前只读 index + session meta，避免上下文和隐私边界被拉大。
- 接管后的 task 初始为 `completed`，这样主人继续时可复用现有 `manage_task(action="continue")` 状态回路。

---

## 8. 安全边界（Phase 1）

linnsy 接外部 agent 不暴露所有 vendor 字段给主人配置。统一兜底：

- vendor adapter 自己校验 locator 的 vendor 特定规则（如 codex 必须绝对路径 + 非泛目录）
- `Linnsy Work` 只由工具层按产出类任务创建，不提供 `list_workspaces` / `switch_workspace` 之类用户语义工作区能力
- 沙箱级别由 vendor 子目录硬编码默认值（codex = `workspace-write`），不暴露给主人
- 不开 `danger-full-access` 等绕过沙箱的开关
- 子进程超时硬上限（具体值由各 vendor 定义）
- 子进程 stdout / stderr 不直接渲染到主对话——经过事件归一化或秘书话术二次加工

---

## 9. 反目标（**不**做）

- ❌ 不在本目录写 task 状态机逻辑（在 `../tracker/`）
- ❌ 不在本目录暴露 vendor 原生事件给上层（必须先归一化）
- ❌ 不引入 `vendor` 参数到工具集（用 `definitionKey`）
- ❌ 不为每个 vendor 复制一遍工具集（4 个 vendor × 8 个工具 = 32 个工具是反模式）
- ❌ 不内嵌 diff 渲染 / commit / 回滚 UI（diff 留在 vendor 自己里）
- ❌ 不在主流程层（`delegate_to_external` / `TaskTracker` / `agents/registry`）做 vendor 特定校验——locator 规则该谁谁管

---

## 10. 相关文档

- Codex 适配器产品决策总账 → `[./codex/README.md](./codex/README.md)`
- 委派 codex 的 definition → `[../../../agent-run/features/agents/delegate-to-codex/README.md](../../../agent-run/features/agents/delegate-to-codex/README.md)`
- dispatcher 路由层 → `routing-dispatcher.ts`
- Codex 连接状态 probe → `codex/codex-probe.ts`
- 任务跟踪 / 状态机 → `../tracker/`
- 派活工具实现 → `../../../agent-run/features/tool-runtime/tools/delegate-to-external.ts`
- 任务工作目录 → `../workspace/`
