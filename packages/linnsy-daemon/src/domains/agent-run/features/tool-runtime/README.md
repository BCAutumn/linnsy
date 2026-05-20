# `domains/agent-run/features/tool-runtime` 工具结果协议

> 本 feature 负责 Linnsy 自己的工具注册、执行、结果治理和 `tool_call.*` 事件发布。
> 工具结果必须同时服务两件事：前端渲染事实源，以及 AI 后续推理上下文。
>
> 具体业务规则仍归各自 domain：Cron 工具调用 Cron contract，Task 工具调用 Task contract，Memory 工具调用 Memory contract。这里是 P4 工具壳，不是业务规则归档处。

## 强制返回结构

每个 `LinnsyTool.execute()` 必须返回：

```ts
type StructuredToolResult<TData extends Record<string, unknown>> = {
  data: TData;
  observation: string;
};
```

| 字段 | 给谁用 | 约束 |
|---|---|---|
| `data` | 前端和 events 回放 | 稳定业务数据合同；不放密钥、临时调试对象、超长正文 |
| `observation` | AI 上下文工程 | 简短说明工具结果和关键 id/status；不拼大段 JSON，不承担 UI 展示 |

`data` 是前端渲染的唯一事实源。前端以后按 `toolName` 注册专属卡片，想怎么渲染就读 `item.data`，不要解析 `observation`。

`observation` 是给 AI 继续工作的文字。它会进入 `ToolResultGuard`，超长时被落到 workspace 文件并替换成短 observation；`data` 不参与这套截断逻辑。

## 成功与失败

工具成功时：

1. `execute()` 返回 `{ data, observation }`。
2. tool-runtime 把 `data` 原样发布到 `tool_call.result.payload.data`。
3. tool-runtime 把 `observation` 交给 `ToolResultGuard`，治理后的文本发布到 `payload.observation`，同时作为 linnkit 看到的工具结果。

工具失败时必须 `throw`。

不要返回这种伪成功：

```ts
return {
  data: { error: 'not found' },
  observation: 'failed'
};
```

失败要让 runtime 统一发布 `status: 'error'`、`error`、`errorKind`，这样投影和回放语义才一致。

## 后端不驱动 UI

工具定义里不要新增或依赖这些字段：

| 禁止字段 | 原因 |
|---|---|
| `presentation` | UI 决策应在前端 toolName registry |
| `viewType` | 同上 |
| `displayOptions` | 同上 |
| `titleTemplate` | 同上 |

默认工具卡只负责兜底展示 `args`、`data`、`observation`、`error`。专属工具 UI 后续一个一个在 renderer 里注册，不要求每个工具在这次协议改造里立刻补卡片。

## Observation 写法

推荐写成一句人和 AI 都能读懂的话：

```ts
return {
  data: { taskId, workspacePath, status: 'dispatched' },
  observation: `已派发外部任务 ${taskId}，status=dispatched，位置=${locator.label}(${locator.ref})，workspacePath=${workspacePath}。`
};
```

注意：

- 写关键 id，例如 `taskId`、`jobId`、`workspacePath`。
- 写最终状态，例如 `status=dispatched`、`deleted=true`。
- 不把完整 `data` JSON stringify 后塞进 `observation`。
- 不写密钥、token、完整文件正文或模型原始长输出。
- 任务查询默认只看当前 conversation；只有主人明确要跨会话查任务时，`list_tasks` 才传 `includeAllConversations=true`，避免把别的对话里的短任务 id 带回当前对话后查不到。

## 新工具自检

提交前确认：

| 问题 | 合格答案 |
|---|---|
| `execute()` 是否返回 `{ data, observation }`？ | 是 |
| `data` 是否是稳定业务对象？ | 是 |
| `observation` 是否非空且简短？ | 是 |
| 失败路径是否 `throw`？ | 是 |
| 前端是否只按 `toolName` 和 `data` 渲染？ | 是 |
| 是否新增了后端 UI hint？ | 没有 |
