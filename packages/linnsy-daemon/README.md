# linnsy-daemon

> Linnsy 秘书产品的核心 daemon。一个 ESM Node 进程，把多个 IM 通道（CLI / Telegram / 微信 / 桌面）+ 5 层授权 + 单 agent runtime（基于 `[@linnlabs/linnkit](https://github.com/linnlabs/linnkit)` `runtime-kernel`）+ SQLite 持久化（WAL + FTS5）装在一起，对外暴露 `linnsy` 这个 CLI 和 Electron 桌面 app。
>
> 本 README 是 **package 入口**：安装 / 开发 / 运行 / 测试，以及端到端架构图。**架构与 Port 契约** → `[src/README.md](./src/README.md)`。


## Quickstart

### 1. 安装

linnsy 通过 npmjs 公开包安装 @linnlabs/linnkit。daemon 目录下的 .npmrc 显式把 @linnlabs scope 指向 registry.npmjs.org，避免用户级旧 GitHub Packages 配置误命中旧包：

```bash
cd packages/linnsy-daemon
npm install
```

### 2. 最小 `~/.linnsy/config.yaml`

仅 CLI 通道 + DeepSeek（OpenAI 兼容）：

```yaml
profile: dev
home: ~/.linnsy

llm:
  default_provider: deepseek
  defaults:
    secretary: deepseek.v4-pro
    cron_summary: deepseek.v4-flash
    memory_consolidate: deepseek.v4-flash
  providers:
    deepseek:
      api_protocol: openai_chat
      base_url: https://api.deepseek.com
      api_key_env: DEEPSEEK_API_KEY
      models:
        v4-pro:
          model_name: deepseek-v4-pro
          capabilities:
            supports_reasoning: true
          provider_options:
            openai:
              # DeepSeek 思考模式（OpenAI SDK 透传到 body 顶层）
              request_extra_body:
                thinking: { type: enabled }
                reasoning_effort: high
        v4-flash:
          model_name: deepseek-v4-flash

channels:
  cli: { enabled: true }
  web: { enabled: false, bind: "127.0.0.1:0", bearer_env: LINNSY_WEB_BEARER }

auth:
  global_all: true   # dev 用；生产请改 false 并配 platform allowlist 或 pairing
  pairing:
    code_ttl_ms: 600000
    max_attempts: 5

cron:
  tick_interval_ms: 1000
  default_miss_grace_ms: 60000

memory:
  on_pre_compress_provider: deepseek

mcp:
  server: { enabled: false, transport: stdio }
  clients: []

observability:
  llm_request_debug:
    enabled: false
    # enabled=true 时写本地 JSONL；console 只打一行摘要和路径，不打印正文
    dir: ~/.linnsy/debug/llm-requests
    max_message_chars: 20000
    max_records_per_run: 20
    max_file_bytes: 5242880
    max_files: 8
```

### 3. 跑通

```bash
export DEEPSEEK_API_KEY=sk-...

# 体检：检查 DB / 配置 / 文件权限 / linnkit 装配 / model_profile
npx tsx src/cli/index.ts doctor

# 进入交互式 chat（stdin/stdout 行式协议）
npx tsx src/cli/index.ts chat

# 带运行审计日志的 chat（用于排查 GraphExecutor / LLM 流式事件）
npx tsx src/cli/index.ts chat:audit
```

打包发布后入口是 `dist/cli.cjs`，可作为 `linnsy doctor` / `linnsy chat` 直接调用：

```bash
npm run build
./dist/cli.cjs doctor
```

### 4. 接微信私聊

如果你已经能正常 `chat`，微信接入**不需要重配一套 LLM**。
直接看 → [`../../docs/guides/wechat.md`](../../docs/guides/wechat.md)

### 5. 桌面 app（Electron）

```bash
npm run dev:electron
```

详见 → [`electron/README.md`](./electron/README.md)

Codex 应用连接的真实产品手测也走这条路径：启动桌面 app 后，在“应用连接”tab 触发 Codex 轻量检测，再回到主对话让 Linnsy 派 Codex 去修改一个临时 smoke 文件。

## 架构一图流

端到端数据流如下：

```
                    ┌──────────────────────────────────────────────┐
                    │ ChannelAdapter (CLI / Telegram / …)         │
                    │  - start(handler)/stop()/send(target,payload)│
                    │  - native event ──► LinnsyMessage           │
                    └──────────────┬───────────────────────────────┘
                                   │ inbound LinnsyMessage
                                   ▼
                    ┌──────────────────────────────────────────────┐
                    │ handleTurn (app/orchestration/turn-handler.ts)│
                    │  ① /pair CODE? ──► AuthorizationPort         │
                    │     .consumePairingCode                      │
                    │  ② AuthorizationPort.authorize               │
                    │     5 层：platform_all / allowlist / paired  │
                    │             / global_all / default_deny      │
                    │  ③ providerMessageId 幂等去重（两阶段）      │
                    │  ④ SessionRouter.resolve ──► conversationId  │
                    │  ⑤ messages.insert(inbound, role=user)       │
                    │  ⑥ 活跃前台 run? 主人插话排队为 user fence   │
                    │  ⑦ SystemPromptAssembler 预热缓存            │
                    │  ⑧ RunSpawner.spawnDetached                  │
                    └──────────────┬───────────────────────────────┘
                                   │ runId
                                   ▼
                    ┌──────────────────────────────────────────────┐
                    │ RunExecutorPort (LinnkitGraphRunExecutor)    │
                    │  装配 linnkit/runtime-kernel:                │
                    │   GraphExecutor + SqliteCheckpointer +       │
                    │   SqliteRunRegistryStore + AiEngineBridge    │
                    │  context-manager: FenceRegistry +            │
                    │   AgentMessageOrchestrator                   │
                    └──────────────┬───────────────────────────────┘
                                   │ AgentAiEngine
                                   ▼
                    ┌──────────────────────────────────────────────┐
                    │ ProviderRouter ──► SDK Codec                 │
                    │   openai_chat / openai_responses /           │
                    │   anthropic_messages                         │
                    │  （OpenAI-compat 走 base_url + extra_body）  │
                    └──────────────┬───────────────────────────────┘
                                   │ final_answer (RunSubscriberEvent.unstable.completed)
                                   ▼
                    ┌──────────────────────────────────────────────┐
                    │ NotificationLayer.replyForRun                │
                    │  channel.send(target, {text}) 先发           │
                    │  messages.insert(outbound) 后写              │
                    └──────────────────────────────────────────────┘
```

## 主要 Port

| Port | 实现 |
| --- | --- |
| `ChannelAdapterPort` | `src/domains/channel/features/{cli,telegram}/` + `src/domains/channel/features/registry/` |
| `SessionRouterPort` | `src/domains/conversation/features/session-routing/session-router.ts` |
| `LinnsyAgentRegistryPort` | `src/domains/agent-run/features/agents/registry/registry.ts` + `src/domains/agent-run/features/agents/**` |
| `SystemPromptAssemblerPort` | `src/domains/agent-run/features/system-prompt/system-prompt-assembler.ts` + `src/domains/agent-run/features/agents/prompt-template.ts` |
| `RunSpawnerPort` + `RunExecutorPort` | `src/domains/agent-run/features/run-spawner/run-spawner.ts`, `src/domains/agent-run/features/run-executor/linnkit-graph-executor.ts` |
| `NotificationPort` + `LinnsyNotificationLayer` | `src/domains/conversation/features/notification/notification-layer.ts` |
| `AuthorizationPort` | `src/domains/channel/features/authorization/authorization-guard.ts` + `auth-guard-stub.ts` |
| `PairingStorePort` | `persistence/stores/sqlite-pairing-store.ts` |
| `AgentAiEngine` bridge | `src/app/llm/ai-engine.ts` + `src/domains/llm/features/{model-registry,provider-routing}/` |
| `TaskTrackerPort` | `src/domains/task/features/tracker/task-tracker.ts` + `src/domains/task/persistence/sqlite-task-store.ts` |
| `WorkspacePort` | `src/domains/task/features/workspace/workspace-manager.ts` |
| `LinnsyPathManager` | `config/path-manager.ts` |
| `CronSchedulerPort` + `CronJobStorePort` | `src/domains/cron/features/scheduler/{scheduler,file-lock,definitions/types}.ts` + `src/domains/cron/persistence/sqlite-cron-job-store.ts` |



## Built-in agent 约定

新增内置 agent 时，必须新增一个目录：

```text
src/domains/agent-run/features/agents/<agent-id>/
├── definition.ts   # typed policy / registration config
└── prompt.ts       # base prompt
```

`definition.ts` 必须把 `basePrompt` 绑定到 `AgentDefinition`，registry 只负责校验、冻结、查询，不直接 import 单个 agent 实现文件。`prompt.ts` 当前支持的变量只有：

```text
{{agent.id}}
{{agent.display_name}}
```

当前时间不放进 prompt 模板；daemon 每轮会以 user 侧 `turn-context` 围栏注入。未知变量会在 system prompt assembly 阶段直接失败，避免提示词拼错后静默降级。

## 多 provider LLM 配置

`config.yaml` 的 `llm.providers.*` 支持三种 `api_protocol`：


| 协议                   | SDK                       | 适用                                                                                              |
| -------------------- | ------------------------- | ----------------------------------------------------------------------------------------------- |
| `openai_chat`        | `openai` chat completions | OpenAI 自己；任何 OpenAI 兼容端点（DeepSeek / Moonshot / 阿里云 / together.ai / Azure OpenAI compat / vLLM…） |
| `openai_responses`   | `openai` responses        | OpenAI o-series + reasoning summary                                                             |
| `anthropic_messages` | `@anthropic-ai/sdk`       | Claude                                                                                          |


`provider_options.openai.request_extra_body` 是给 OpenAI 兼容端点扩展 body 字段的逃生口（典型场景：DeepSeek `thinking` + `reasoning_effort`）。codec 显式字段（`model` / `messages` / `temperature` / …）始终覆盖同名 extras。

## 上下文工程与 LLM 请求调试

本项目使用 linnkit 作为 agent 框架，开发文档参考：`linnsy-daemon/node_modules/@linnlabs/linnkit/docs/integration/README.md`

daemon 侧上下文入口统一走 linnkit `context-manager`：

- 已注册 `turn-context`、`system-event`、`subagent-summary`、`user-interjection`、`memory-context` 五类 Linnsy fence，全部作为 `user` role 注入，动态事件不进入 system prompt；`<user_request>` 已在文档中拍板为模型可见的主人真实请求边界，待 T5.7 接入实现。
- cron / reminder 用 `system-event`；内部子 agent 完成后用 `subagent-summary` 唤醒父会话；主人在活跃 run 中途发话时排队为 `user-interjection`，下一次工具结果后注入，不新开 run。
- 主 agent 每轮会从长期记忆里取本轮参考片段；长期记忆按固定 system 第 5 段进入 system。当前时间 / 时区每轮走 `turn-context`，不启用 RAG / 向量召回 / 中期记忆独立存储。

排查最终发给 provider 的消息数组时，打开：

```yaml
observability:
  llm_request_debug:
    enabled: true
```

记录会写到 `${LINNSY_HOME}/debug/llm-requests/*.jsonl`，包含脱敏后的 canonical `AiMessage[]` 与最终 wire request；控制台只输出 runId、modelId、消息数量和记录路径。单条记录超过 `max_file_bytes` 会丢弃完整 payload、保留摘要与 hash；目录只保留最近 `max_files` 个 JSONL 文件。

运行审计分两条账本，路径全部由 `path-manager.ts` 统一计算：

- 决策审计：`${LINNSY_HOME}/audit/decisions.jsonl`，实现 linnkit `AuditPort`，记录 `model.select` / `model.fallback` / `tool.allow` / `tool.deny` / `wait_user.request` / `run.cancel` 等短事件。
- run 上下文审计：`${LINNSY_HOME}/audit/run-context.jsonl`，Linnsy 自有格式；每次 run 结束写入该 run 每次 LLM 调用真正看到的完整 `AiMessage[]` 快照，消息正文按 hash 去重，快照只保留引用。

审计文件默认启动时清理一次，之后每小时清理一次；决策审计默认保留 30 天 / 16 个文件 / 单文件 20MiB，run 上下文审计默认保留 30 天 / 24 个文件 / 单文件 128MiB。可通过 `observability.audit.cleanup_interval_ms`、`retention_ms`、`decision_max_file_bytes`、`decision_max_files`、`run_context_enabled`、`run_context_max_file_bytes`、`run_context_max_files` 调整。两条账本都不写入 Linnsy `events` 表，也不会新增 renderer `RuntimeEvent.kind`。

## Telegram 通道（S2）

启用 Telegram：在 `config.yaml` 的 `channels` 加：

```yaml
channels:
  telegram:
    enabled: true
    token_env: LINNSY_TG_TOKEN
    allowlist: []   # 空 = 必须走 pairing 才能对话
```

授权流（5 层 fall-through）：`platform_all` → `platform allowlist` → `paired (consumed)` → `global_all` → `default_deny`。

主人首次接入流程：

1. 调一次 `AuthorizationPort.generatePairingCode({ platform: 'telegram' })` 拿到 8 位码（剔除易混字符 `I/L/O/0/1`）
2. 在 Telegram 给 bot 发 `/pair XXXXXXXX`
3. daemon 写入 `pairings.consumed_at`，之后该 chat 永久授权

新加平台请读 `[docs/guides/adding-platform.md](../../docs/guides/adding-platform.md)`，里面写明 contract / 幂等 key / 测试清单。

## 测试

```bash
npm run test            # 全量 vitest run（unit + contract + e2e + harness）
npm run test:unit       # src/**
npm run test:contract   # __tests__/contract/**（如 boundary guard contract）
npm run test:e2e        # __tests__/e2e/**（含 mock LLM 端到端 RTT < 100ms）
npm run typecheck
npm run lint
npm run guard:boundary  # 防止 daemon 反向 deep-import linnkit 内部
```

### Live LLM smoke（默认 skip）

```bash
# DeepSeek（OpenAI 兼容；reasoning case 用 v4-pro + extra_body.thinking）
export DEEPSEEK_API_KEY=sk-...
export LINNSY_LIVE_BASE_URL=https://api.deepseek.com
export LINNSY_LIVE_API_KEY_ENV=DEEPSEEK_API_KEY
export LINNSY_LIVE_MODEL=deepseek-v4-flash
export LINNSY_LIVE_REASONING=1
export LINNSY_LIVE_REASONING_MODEL=deepseek-v4-pro
npm run test:e2e -- live-openai-chat
```

详见 `__tests__/e2e/live-openai-chat.spec.ts`。

### Codex 连接 smoke

Codex 连接有两类验证：

- 自动化回归：默认测试集只跑 fake Codex，不调用真实主模型，也不调用真实 Codex CLI。
- 真实产品手测：从仓库根目录执行 `npm run dev:electron`，按 `electron/README.md` 的 Codex 连接手测清单操作。

另外保留两个显式 opt-in 测试：

```bash
LINNSY_TEST_REAL_CODEX=1 npm run test:e2e -- codex-real-smoke
LINNSY_TEST_REAL_MAIN_CODEX=1 npm run test:e2e -- codex-main-delegation-live
```

第二条需要把 live 模型 key 放到测试进程环境变量；日常产品手测优先走桌面 app 已保存的模型配置。

## 公开 API

`src/index.ts` 是包的唯一公开 surface（命名风格：`createXxx` 工厂 + `XxxPort` 类型 + 错误码常量）。`src/runtime/` 已删除，**不要重新新增或 deep-import** `src/runtime/...`；如果发现需要 re-export 的类型缺了，请走改 `index.ts` 而不是绕过它。

## 硬约束

- **@linnlabs/linnkit 当前依赖版本 = ^0.8.0**。daemon 继续使用公开子入口里的 DefaultRunSupervisor 承接 detached run 生命周期 / cancel signal / terminal wait / drain / recover；AgentDefinition 通过 `src/domains/agent-run/features/agents/linnkit-agent-spec.ts` 统一转换为 linnkit AgentSpec，并用 0.8.0 的 `defineContextPolicy` / `AgentSpec.parse` 校验。默认 contextPolicy 固定主会话级 token 预算、工具历史 per-run、保留 Linnsy 六类 fence，并用轻量中文 token 估算；内部子 agent / cron agent 在 definition 中覆盖更小预算；真实 tool runtime 可把工具 JSON Schema 复制进 AgentSpec `argsSchema`；ContextTrace 暂只保留策略入口，未默认打开。升级后如本机 Electron 原生依赖不匹配，执行 npm rebuild better-sqlite3
- 仅依赖 `@linnlabs/linnkit` 的公开子入口（`/runtime-kernel`, `/ports`, `/runtime-kernel/events`, …）；deep import linnkit 内部路径会被 `guard:boundary` 拦截；`__tests__/contract/linnkit-package-import.contract.ts` 会守住 npmjs 包源、0.8.0 版本、MIT license 与公开入口可 import
- LLM 核心 SDK 只允许 `openai` + `@anthropic-ai/sdk`；新 provider 必须走 OpenAI/Anthropic 兼容协议或新建 codec，禁止引入第三个 LLM SDK
- channel adapter **不**做授权决策，授权全部在 `AuthorizationGuard`
- 真实 token 不进 commit，live smoke 一律 opt-in
