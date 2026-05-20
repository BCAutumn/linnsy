# Agent-run domain

> 一次 agent run 的定义、启动、执行、上下文和工具边界。
>
> 2026-05-19 起进入 domain-first 迁移。当前已迁入 `features/agents/`、`features/system-prompt/`、`features/context-engineering/`、`features/run-spawner/`、`features/internal-subagent/`、`features/run-executor/` 与 `features/tool-runtime/`。

---

## 目录结构

| 目录 | 职责 |
|---|---|
| `features/agents/` | `AgentDefinition` 契约、内置 agent definition / prompt、AgentSpec 适配和冻结式 registry |
| `features/system-prompt/` | 组合 agent-owned base prompt 与 Memory domain 给出的 shaping 输入，维护会话级 system prompt 缓存，并提供设置页 system prompt preview |
| `features/context-engineering/` | 注册 user 侧围栏、创建 run-local context fence、暂存中途插话并按 runId 清理 |
| `features/run-spawner/` | 启动 detached run、等待终态、取消/恢复、按活跃主 run 安全点合并任务终态 wake |
| `features/internal-subagent/` | 内部子 agent 委派：创建 child conversation、调用 RunSpawner、落 result/transcript、发布 `subagent.summary` |
| `features/run-executor/` | 执行单次 run：装配 linnkit graph、准备模型可见上下文、桥接工具 / 子 agent 过程事件、收集最终答案，并在 finally 清理 per-run 工具白名单与未消费插话 |
| `features/tool-runtime/` | Linnsy 工具壳：注册 / 执行 P4 工具、发布工具生命周期事件、强制工具结果协议，并治理超长 observation |

---

## 边界

`features/agents/` 只声明 agent 能力，不执行 LLM、不运行工具、不启动 run。

`features/system-prompt/` 只组装 P3 system prompt 与缓存，不决定记忆召回规则、不注册 user 侧 fence、不执行 run。

`features/context-engineering/` 只定义模型可见的 user 侧围栏形状和 run-local 注入，不读取 MemoryStore、不执行 agent、不决定 run 生命周期；pending interjection 的模块级状态必须由 run executor 在 finally 里按 runId 清理。

`features/run-spawner/` 只承接 agent run 生命周期入口和任务终态 wake 编排。它依赖 Task domain 提供的 terminal-wake 事实构造、Conversation domain 的 notification 窄口、Agent-run 自己的 AgentSpec 适配，以及生产装配传入的 `RunSpawnerEventPort`；不直接依赖 event hub 具体实现，不读取工具执行细节，也不组装 LLM 上下文。

`features/internal-subagent/` 只承接内部子 agent 委派执行。它依赖 Task domain 的 `TaskTrackerPort`、Conversation store 的 child conversation 写口、Agent-run run-spawner 的 `spawnDetached/waitForTerminal` 窄口，以及生产装配传入的 `InternalSubAgentEventPort`；不直接依赖 event hub 具体实现、不管理外部 Codex/Claude Code/Cursor，也不决定工具白名单或模型上下文。

`features/run-executor/` 只承接已经启动的 run 如何执行。它依赖 Agent-run 自己的 agents / system-prompt / context-engineering / run-spawner 契约、Memory domain 的 recall 能力、LLM domain 的 model registry / provider routing 能力，以及生产装配传入的 `RunExecutorEventPort` / `RunContextAuditPort`；不直接依赖 event hub 或 audit manager 具体实现，不启动 detached run，不决定 task terminal wake，也不把具体业务工具实现搬进来。对话历史由 host 从 MessageStore 读取“最近窗口”并按时间正序交给 linnkit；token 预算、must-keep fence 与工具历史压缩继续由 linnkit `contextPolicy` 统一裁剪，避免 host 先截掉最新上下文。

`features/tool-runtime/` 只承接 LLM 可调用工具的注册、执行、结果协议和工具生命周期事件。它依赖 Cron / Task / Memory / Conversation domain 的公开 contract 完成具体业务动作，依赖生产装配传入的 `ToolRuntimeEventPort` 和 `ToolResultStorePort` 发布事件与落超长 observation；不直接依赖 event hub 具体实现、不直接绑定 file result store 具体类，也不把 task / cron / memory 的业务规则搬进 Agent-run。

| 做 | 不做 |
|---|---|
| 定义 `linnsy_main` / 内部子 agent / 外部委派 adapter 的 policy、prompt 和 metadata | 不调用模型 |
| 把 `AgentDefinition` 转成 linnkit `AgentSpec` 并校验协议形状 | 不写 run 生命周期 |
| 在 daemon 启动期冻结 registry，禁止运行时注册 | 不直接处理 channel、task、memory 或 HTTP |
| 用 Memory domain 的 prompt-shaping 输入拼出 system prompt | 不读取对话历史、不决定本轮 `<memory-context>` 注入 |
| 把 owner message、turn context、system event、task terminal update、memory context 包成稳定 fence | 不决定这些事实何时产生，也不把动态材料写入 system prompt |
| 启动 / 取消 / 等待 detached run，并把任务终态合并成主对话 wake | 不执行 graph、不运行工具、不持有 task wake 文案 |
| 执行内部子 agent 的 child conversation、结果落盘、transcript 落盘和 summary 事件发布 | 不管理外部 agent，不在内部 runner 里直接跑工具 runtime |
| 执行单次 graph run，组装模型可见上下文，桥接 `tool_call.progress` / `subagent.progress` / `message.delta`，并清理 per-run 资源 | 不启动 run，不实现具体工具业务，不直接写 event hub 或 audit manager 具体实现 |
| 注册和执行 P4 工具，保证 `{ data, observation }` 协议、工具事件与 observation 硬帽 | 不把 Cron / Task / Memory / Conversation 的规则复制进工具壳 |

Cron runner definition 仍归 `domains/cron/features/cron-agent/`，但它使用 Agent-run domain 的 `AgentDefinition` 契约；这样 Cron 只拥有自己的后台提醒 agent 内容，Agent-run 统一拥有 agent contract。
