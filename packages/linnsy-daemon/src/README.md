# linnsy-daemon/src

> daemon 的核心业务逻辑。所有 Port 实现、子系统协调、持久化，都在这里。
>
> 2026-05-19 起进入 domain-first 重构期；生产代码已完成 `runtime/` 拆解，新迁移业务优先放入 `domains/` 或 `app/` 的对应边界。
>
> 入口：`src/index.ts`（公开 surface）、`src/cli/index.ts`（CLI 命令注册）、`src/cli/chat.ts`（chat 命令入口）、`src/app/bootstrap/local-daemon-stack.ts`（本机 daemon 装配）、`src/app/bootstrap/foundation.ts`（基础依赖装配）

---

## 架构一图流

```
多通道入口（CLI / Telegram / 微信 / Web / Desktop）
         │ LinnsyMessage（归一化）
         ▼
ChannelAdapterRegistry
         │
AuthorizationGuard（5 层授权链）
         │
SessionRouter（session_key → conversationId）
         │
RunSpawner（spawnDetached）
         │ ↗ Agent-run SystemPromptAssembler（5 层缓存）
Agent-run RunExecutor（linnkit GraphExecutor 装配）
         │
AiEngineBridge ──► ProviderRouter ──► SDK Codec（openai/anthropic/compat）
         │
NotificationLayer ──► ChannelAdapter.send()
         │
SQLite WAL + FTS5（state.db）
```

横切关注：`LinnsyAgentRegistry`（所有 agent definition 注册中心），`CronScheduler`（定时任务）。Heartbeat 巡检仍是 S7 目标，本阶段不声明已实现模块。

---

## 子系统清单

| 目录 | 子系统 | 核心职责 |
|---|---|---|
| `app/bootstrap/` | App bootstrap | 本机 daemon 应用装配层：`foundation.ts` 负责 DB / stores / LLM / graph executor / audit manager 等基础依赖装配，`daemon.ts` 保留 daemon 生命周期外壳，`wiring/channel-wiring.ts` 收口 channel / cron / spawner 启停顺序，`local-daemon-stack.ts` 负责本机 daemon 总装配顺序和启停清理，`channel-boot.ts` 把 CLI / Desktop / WeChat adapter 工厂调用包成可独立失败的并列步骤，`local-daemon-tools.ts` / `local-daemon-http.ts` 分别收口生产工具清单和可选 HTTP server 装配；只做跨 domain 接线，不沉淀业务规则 |
| `app/http/` | App HTTP | daemon HTTP API 总装配：`hono-server.ts` 只挂载各 domain / route module，`http-security-boundary.ts` 承载 loopback + bearer 默认拒绝边界；不写具体业务规则 |
| `app/llm/` | App LLM adapters | linnkit `AgentAiEngine` 技术适配桥：消费 LLM domain 的 model registry / provider router，并在 app 层接入 Agent-run fence registry；负责重试、fallback 与流式桥接，不反向塞进 LLM domain |
| `app/orchestration/` | App orchestration | 跨 domain 用例编排。`turn-handler.ts` 承载单轮消息处理顺序：pairing → authorize → 幂等去重 → session 解析 → 插话入队或 spawn → reply；具体业务规则仍归对应 domain / port |
| `domains/desktop-integration/` | Desktop integration domain | 桌面壳、远程手机终端和 daemon 后端之间的集成边界。`definitions/` 放桌面通道状态、daemon sidecar 状态、应用连接快照与 UI hint 契约；`features/terminal-binding/` 放固定 mobile 终端绑定的默认会话、绑定切换、手机端入站会话归属和 `/api/v1/terminal-binding` HTTP 薄入口；`features/application-connections/http/` 放设置页应用连接状态 HTTP 薄入口；`features/ui-preferences/http/` 放桌面 UI 偏好 HTTP 薄入口；`persistence/` 放 terminal binding 与 UI preferences 的 SQLite store |
| `domains/agent-run/` | Agent-run domain | 一次 agent run 的定义、启动、执行、上下文和工具边界。当前已迁入 `features/agents/`、`features/system-prompt/`、`features/context-engineering/`、`features/run-spawner/`、`features/internal-subagent/`、`features/run-executor/` 与 `features/tool-runtime/` |
| `domains/agent-run/features/agents/` | Agent definitions + registry | `agents/contracts.ts` 定义 AgentDefinition 数据契约；每个内置 agent 自己持有 definition + prompt；`linnkit-agent-spec.ts` 负责把 Linnsy definition 转成 linnkit 0.8 AgentSpec，并统一走 `defineContextPolicy` / `AgentSpec.parse` 校验；registry 只做冻结、校验与查询，不执行 agent |
| `domains/agent-run/features/system-prompt/` | SystemPromptAssembler | 5 层 system prompt 组装 + 会话级缓存；Memory domain 负责长期记忆召回与 prompt shaping，system-prompt 只消费 shaping 输入并维护缓存 |
| `domains/agent-run/features/context-engineering/` | FenceRegistry 装配 | linnkit context-manager 围栏注册；主人真实请求以 `<user_request>` 进入模型可见上下文；任务终态复用 `<system-event kind="task_status_change">`；中途插话按 runId 暂存，run executor 结束时会清理未消费围栏 |
| `domains/agent-run/features/run-spawner/` | RunSpawner | Linnsy 对 linnkit `DefaultRunSupervisor` 的薄包装：框架负责 detached run 生命周期、取消信号、terminal waiter、drain 和 recover；Linnsy 负责 conversation 校验、AgentSpec 校验、finalAnswer 通知桥接，以及把 Task domain 给出的 terminal-wake 事实投递成主对话 wake run。feature 只暴露 `RunSpawnerEventPort` 窄口，生产装配传入 Observability event hub，不反向依赖 event hub 实现 |
| `domains/agent-run/features/internal-subagent/` | InternalSubAgentRunner | 内部子 agent 委派层；`runner.ts` 只做 executor runner / graph runner 分发，`graph-runner.ts` 是生产路径（child conversation + RunSpawner + 结果落盘 + `subagent.summary`），`executor-runner.ts` 保留旧 executor 兼容路径，`shared.ts` 只放调度、失败标记和 transcript 持久化。feature 只暴露 `InternalSubAgentEventPort` 窄口，生产装配传入 Observability event hub，不反向依赖 event hub 实现 |
| `domains/agent-run/features/run-executor/` | RunExecutor | 装配 linnkit GraphExecutor / Checkpointer / RunRegistryStore / AuditPort。`linnkit-graph-executor.ts` 只保留工厂与 run 执行编排；`run-invocation.ts` 专管单次 run 的模型输入准备（记忆召回、system prompt、turn context、最近 conversation history、tool context 与 graph local），并把 AgentSpec `contextPolicy` 传给 linnkit；`linnsy-agent-task.ts` 专管模型可见消息组装和围栏位置不变量；`policy-scoped-tool-runtime.ts` 与 `run-context-audit-scope.ts` 分别收口 per-run 工具白名单清理和上下文审计快照。feature 只暴露 `RunExecutorEventPort` 与 `RunContextAuditPort` 窄口，生产装配传入 Observability event hub / audit manager，不反向依赖 event hub 或 audit 具体实现 |
| `domains/agent-run/features/tool-runtime/` | ToolRuntime | Linnsy P4 工具壳：注册工具、执行工具、发布 `tool_call.start/result`、强制 `{ data, observation }` 结果协议、治理超长 observation。具体业务能力仍通过 Cron / Task / Memory / Conversation domain contract 调用；feature 只暴露 `ToolRuntimeEventPort` 与 `ToolResultStorePort` 窄口，生产装配传入 Observability event hub 与 file result store，不反向依赖 event hub 实现或具体持久化类 |
| `domains/cron/` | Cron domain | 定时安排 domain：`definitions/` 放 cron job / run 契约，`features/scheduler/` 放进程内调度（file lock + tick + miss grace）、时间算法、due claim、run 执行和一次性任务清理，`features/http/` 暴露定时安排 REST 边界，`features/cron-agent/` 放显式后台批处理用的 cron runner agent，`persistence/` 放 cron job / run SQLite store。普通定时安排默认以 `<system-event>` 唤起主 Linnsy，并永远走手机终端绑定对话；显式后台批处理仍可指定 cron runner |
| `domains/task/` | Task domain | 委派任务的公开契约、生命周期规则、tracker 编排、外部 agent dispatcher、terminal wake 事实与 per-task 内务目录：`definitions/` 放 `TaskRecord` / `ExternalUpdate` / locator 等稳定 contract，`ports/` 放跨 feature 依赖的窄 task port，`persistence/` 放 tasks 表 SQLite store，`features/lifecycle/functions/` 放 TaskLocator 校验、状态跃迁、upsert 继承、删除前取消判断、终态唤醒判断和外部进度合并规则，`features/tracker/` 放 TaskTracker 实现和 tracker 测试，`features/external-dispatch/` 放 ExternalAgentDispatcherPort、definitionKey 路由、mock dispatcher、Codex CLI adapter、Codex probe、session bridge 与 Codex session HTTP 薄入口，`features/terminal-wake/` 放任务终态唤醒 query / metadata / 执行提示 payload，`features/workspace/` 放 `<LINNSY_HOME>/workspaces/{taskId}/` 内部目录管理。TaskTracker **daemon 内部跟踪用，不对外暴露独立前端面板**，任务终态走主对话 `<system-event kind="task_status_change">` 唤醒。外部进度的 `partialResult` 是深度合并补丁，`finalResult` 才是终态完整替换；tracker 只负责 store 读写、乐观锁重试和唤醒副作用 |
| `domains/memory/` | Memory domain | 长期记忆 domain：`persistence/` 放 memory items SQLite store；`features/recall/` 从 MemoryStore 读取系统五段与本轮召回事实，产出 system prompt shaping 输入所需快照和本轮 `<memory-context>` 事实；`features/prompt-shaping/` 把 recall snapshot 塑形成 system prompt override / extra sections / cache version；`features/default-items/` 维护内置五段记忆初始项；`features/http/` 暴露设置页读写记忆和 system prompt preview 的 REST route。Memory domain 不注册 linnkit fence、不启动 run；system prompt preview 通过 app HTTP 装配层传入窄回调，避免 domain 反向依赖 agent registry |
| `domains/llm/` | LLM domain | 模型设置与 LLM provider 边界 domain：`definitions/` 放用户模型设置 schema、默认值、运行态设置类型和 model id 工具函数，`features/model-settings/` 作为 public facade 供 HTTP route 与 registry 共用，`persistence/` 放 model settings / encrypted secrets SQLite store，`features/model-settings/http/` 暴露设置页模型配置 REST route，`features/model-registry/` 解析配置模型与用户模型并提供运行时 registry port，`features/provider-routing/` 收口 provider router、SDK factory、codecs 与 provider adapters，`shared/` 放 LLM request debug 共享件 |
| `domains/observability/` | Observability domain | 对话流事件、运行状态回放、审计与只读观察入口的业务边界。当前 `definitions/` 承接 runtime event wire 契约；`features/audit/` 承接短决策审计、run 上下文审计、文件轮转与保留期清理；`features/dashboard/` 承接桌面 read model 与观察 REST 入口；`features/event-hub/` 承接运行事件广播、短窗口回放与持久化 history port 接入；`features/event-stream/` 承接 `WS /api/v1/stream` 的认证、cursor 回放、live 缓冲去重与 ready 帧；`features/mcp/` 承接外部观察 MCP tools 与 stdio server |
| `domains/conversation/` | Conversation domain | 主人与 Linnsy 的会话 domain：`features/session-routing/` 负责把平台消息稳定映射到 conversation，维护 `session_key = linnsy:main:{platform}:{chat_type}:{chat_id}` 规则，并支持桌面分支会话和直接 conversationId 写入；`features/management/` 负责桌面对话历史整理写口：重命名、置顶、归档、永久删除；`features/http/` 暴露这些历史整理动作的 REST 边界，只做 DTO 校验、错误码映射和 management port 调用；`features/notification/` 负责 run / task 结果回到主人对话：向 channel 发出反馈、落库 outbound message、发布 message.complete，并通过 task → conversation → latest inbound 找到任务终态回复目标；删除入口只做业务约束，短期历史清理由 `ConversationStorePort.permanentDeleteShortTermData()` 事务承接，不动长期记忆 |
| `domains/channel/` | Channel domain | 外部入口 / 出口通道 domain：`definitions/` 放 `ChannelAdapterPort` / `InboundHandler` / 健康检查与发送结果契约，`features/authorization/` 承载入站消息 5 层授权链与配对码门禁，`features/registry/` 管理 adapter 注册与查找，`features/cli/` 承载 CLI 文本入口 / 出口适配，`features/desktop/` 承载桌面 renderer 入站归一、HTTP 薄入口和 message bus，`features/telegram/` 承载 Telegram long-polling 文本入口、出站发送与健康检查，`features/wechat/` 承载 WeChat daemon adapter 与本机 gateway sidecar |
| `persistence/` | SQLite foundation + cross-domain stores | SQLite 打开、schema provider、JSON 基础件和跨 domain / 框架 / 横切 store。Cron / Task / Memory / LLM / Desktop-integration 这类单 domain store 已迁入各自 `domains/*/persistence/` |
| `shared/` | errors + DTO contracts | 错误码、共享类型、`shared/dto/` REST 契约；业务归属明确的桌面契约已迁入 `domains/desktop-integration/definitions/`，runtime event wire 契约已迁入 `domains/observability/definitions/` |

---

## 5 层授权链

```
1. per-platform allow-all   → config: channels.{platform}.allow_all
2. platform allowlist       → config: channels.{platform}.allowlist[]
3. consumed pairing grant   → SQLite pairings 表（8 位码 + TTL）
4. global allow-all         → config: auth.global_all（dev 专用）
5. default deny             → fail-closed
```

授权实现 → `domains/channel/features/authorization/authorization-guard.ts`

配对码流程：

1. 调用 `AuthorizationPort.generatePairingCode({ platform })` 生成 8 位码（剔除易混字符）
2. 在 IM 给 bot 发 `/pair XXXXXXXX`
3. daemon 写入 `pairings.consumed_at`，之后该 chat 永久授权

---

## 会话路由

```
session_key = linnsy:main:{platform}:{chat_type}:{chat_id}
conversationId = sha1(session_key)
```

同一 platform / chat_type / chat_id 的消息始终路由到同一 conversation，实现跨次会话的连续记忆。

实现 → `domains/conversation/features/session-routing/session-router.ts`

---

## Agent 启动流程（完整 handleTurn）

实现 → `app/orchestration/turn-handler.ts`

1. 收到 LinnsyMessage
2. `AuthorizationGuard.authorize()` — 5 层检查
3. `providerMessageId` 幂等去重
4. `SessionRouter.resolve()` → conversationId
5. `messages.insert(inbound, role=user)`
6. 活跃 run 存在？→ 排队为 `<user-interjection>`；否则继续
7. `SystemPromptAssembler` 预热缓存
8. `RunSpawner.spawnDetached(conversationId)`，内部注册 linnkit `DefaultRunSupervisor` run handle
9. linnkit `GraphExecutor.runUntilYield()` 使用 supervisor 下发的 `AbortSignal`
10. `NotificationLayer.replyForRun()` → `channel.send()` + `messages.insert(outbound)`

---

## Built-in Agent 目录约定

每个内置 agent 必须在 `src/domains/agent-run/features/agents/{definitionKey}/` 下放两个文件：

| 文件 | 内容 |
|---|---|
| `definition.ts` | typed policy + registration config（绑定 basePrompt）|
| `prompt.ts` | base prompt 模板（支持 `{{agent.id}}` / `{{agent.display_name}}` 变量）|

registry 只校验、冻结、查询，不直接 import 单个 agent 实现文件。

---

## 公开 Surface

`src/index.ts` 是包的唯一公开入口。命名风格：`createXxx` 工厂 + `XxxPort` 类型 + 错误码常量。

`src/runtime/` 已删除。**不要重新新增或 deep-import** `src/runtime/...`。如需 re-export 某类型，改 `index.ts`，不要绕过。

`guard:boundary` CI 脚本会在 daemon 反向 deep-import linnkit 内部时报错。

---
