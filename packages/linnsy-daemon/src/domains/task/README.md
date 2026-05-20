# Task domain

Task domain 承载 Linnsy “派活、监工、汇报”的任务记账能力：任务公开契约、locator 校验、生命周期状态规则、外部 agent 进度合并、tracker 编排，以及外部 agent dispatcher。

当前已完成 definitions、lifecycle functions、tracker、external-dispatch、terminal-wake、workspace 与 task persistence 的迁移。`runtime/external-dispatcher/`、`runtime/task-tracker/` 与 `runtime/workspace/` 兼容出口已删除，bootstrap、HTTP、observability、tool-runtime、run-spawner、internal-subagent 与 notification 直接依赖本 domain 的公开契约、port、persistence 或 feature 函数。

| 目录 | 职责 |
|---|---|
| `definitions/` | `TaskRecord`、`TaskLocator`、`ExternalUpdate`、列表过滤条件等稳定公开契约 |
| `features/lifecycle/functions/` | TaskLocator 校验、状态跃迁、upsert 继承、删除前取消判断、终态唤醒判断、外部进度合并规则 |
| `features/tracker/` | TaskTracker 实现、`TaskTrackerPort` / `TaskWakeHook` 类型、tracker 行为测试 |
| `features/external-dispatch/` | 外部 agent dispatcher port、definitionKey 路由、mock dispatcher、Codex CLI adapter、Codex probe 与 session bridge |
| `features/terminal-wake/` | 任务终态唤醒的 task-owned 事实构造：wake query、metadata、轻量执行提示 payload；不启动 run，不等待活跃主对话安全点 |
| `features/workspace/` | 每个 task 的 daemon 内部目录管理；只创建/解析/枚举 `<LINNSY_HOME>/workspaces/{taskId}/`，不引入用户语义工作区 |
| `ports/` | 当前 domain 对外暴露的窄 port；`task-tracker-port.ts` 供 dispatcher / app 编排依赖任务跟踪能力，不暴露 tracker 内部实现 |
| `persistence/` | tasks 表 SQLite store、row/mapper/sql 拆分、`TaskStorePort` 与直接单测 |

仍在过渡目录中的能力：

| 现路径 | 后续目标 |
|---|---|
| `domains/agent-run/features/run-spawner/wake-on-task-transition.ts` | Agent-run bridge：等待主 run 安全点、合并待唤醒任务、调用 RunSpawner 并通知；Task domain 已提供 terminal-wake 事实构造 |

边界约定：

| 规则 | 说明 |
|---|---|
| lifecycle functions 不读写数据库 | 它们只接收 Task contract，返回新记录或判断结果 |
| tracker 只做任务跟踪编排 | 负责 store 读写、乐观锁重试和 wake hook 副作用，不直接启动外部进程 |
| 外部进度合并不在 webhook 层处理 | HTTP 只验证 DTO 并转交 task-tracker，合并语义属于 Task lifecycle |
| terminal wake 不直接启动 run | Task domain 只描述“该怎么唤醒主人”，真正 spawn / wait / notify 留在 Agent-run bridge 与 app-level orchestration |
| workspace 不等于用户项目空间 | workspace feature 只管理任务内务目录；用户可见 `Linnsy Work` 仍由 path-manager 在产出类任务里按需创建 |
