<div align="center">

# Linnsy

**常驻在你电脑里的个人 AI 秘书。**

不是一个"对话框里的 Agent"，而是一个**一直在线的人**——
有自己的工作节奏，会主动提醒你，记得你说过的话，
能在你授权的范围内调用 Cursor / Codex / Claude Code 等桌面工具替你干活。

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E=20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-desktop-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#贡献)

[快速上手](#快速上手) ·
[亮点](#亮点) ·
[工作原理](#工作原理) ·
[仓库布局](#仓库布局) ·
[文档](#文档导航) ·
[路线图](#路线图与状态)

</div>

---

## 这是什么

大多数 AI 助手是"打开对话框 → 提问 → 关掉"的工具。
**Linnsy 反过来：它是一个常驻在你电脑里、跨多个聊天入口都能找到的"人"。**

- 你在微信、Telegram、命令行、桌面 app 里都能找到同一个 Linnsy，**它记得你们以前聊过什么**。
- 你让它"明早八点提醒我开会"，它就在明早八点真的来戳你；**主动权在它手里，不在你的提醒事项 App 里**。
- 你让它"帮我把这个项目里所有 console.log 换成 logger"，它会**派 Cursor / Codex / Claude Code 这些桌面 agent 工具**真的去你电脑上动手干，然后回来汇报。
- 它**有沉默权**。没必要回应的时候它就是不出声，不会为了"显得勤快"硬塞一堆回复。

一句话：**给你雇一个数字员工，而不是再多装一个 Chatbot。**

> ⚠️ 项目当前处于早期阶段（Phase 1）。核心 daemon、CLI、桌面 app、微信 / Telegram 通道、Codex 集成已经跑通；记忆体系、跨设备同步、更多 IM 平台仍在路上。详见 [路线图](#路线图与状态)。

---

## 亮点

### 真的"在线"，不是"被叫起来"

Linnsy 是一个**常驻 daemon 进程**，不靠你打开对话框才活着。

- 内置 cron 调度，能在指定时间主动发起对话（"该开会了" / "你三天前说要回复的那个邮件还没回"）。
- 支持"系统事件" → "用户插话" → "子 agent 汇报"等多种唤醒方式，所有事件统一走 `linnkit` 的 context-manager fence 注入，不污染 system prompt。

### 一个 Linnsy，多个入口

| 入口 | 状态 | 说明 |
|---|---|---|
| **CLI** | ✅ | `npm run chat`，行式协议，最小验证路径 |
| **桌面 app** | ✅ | Electron + React 18 + shadcn/ui，主力使用面 |
| **微信私聊** | ✅ | 通过本地 gateway 接入，5 层授权保护 |
| **Telegram** | ✅ | 官方 Bot API + Pairing Code 授权 |
| **Web** | 🚧 | 已预留 bearer token 协议 |
| **更多平台** | 🚧 | 参见 [`docs/guides/adding-platform.md`](./docs/guides/adding-platform.md) |

每个会话都被路由到统一的 SQLite 持久化层（WAL + FTS5），**消息、任务、长期记忆、授权配对都在一处**。

### 真敢替你动手

Linnsy 不仅会"回答问题"，更会**派活给你电脑上已经装好的 agent 工具**：

- **Codex CLI**：派去改代码、跑命令、读文件，回来汇报结果。
- **Cursor / Claude Code**：通过会话桥接，复用你已经登录的订阅。
- 所有外部派活都走 `external-dispatch` domain，每一步都有 task 状态、workspace 隔离、审计日志。

> 这件事的逻辑是：**Linnsy 不重新造 IDE / 编辑器 / agent**，它**借用你已经在用的那些**，把它们编排成"它能指挥的下属"。

### 5 层授权 + Pairing，安全比能力先行

```
platform_all  →  platform allowlist  →  paired (consumed)  →  global_all  →  default_deny
```

- 默认走 deny，需要明确授权才能对话。
- 首次接入新平台（微信 / Telegram）必须 `/pair <CODE>`，配对码 10 分钟过期、剔除易混字符、最多 5 次尝试。
- 所有授权决策集中在 `AuthorizationGuard`，channel adapter **绝不**自己判定权限。

### 多 LLM Provider 一视同仁

| 协议 | SDK | 适用 |
|---|---|---|
| `openai_chat` | `openai` Chat Completions | OpenAI / DeepSeek / Moonshot / 阿里云 / Together / Azure / vLLM ... |
| `openai_responses` | `openai` Responses | OpenAI o-series + reasoning summary |
| `anthropic_messages` | `@anthropic-ai/sdk` | Claude |

只允许这两个 LLM SDK，**禁止引入第三个**——新 provider 要么走兼容协议，要么自己写 codec。
DeepSeek 思考模式 / `reasoning_effort` 这类厂商扩展走 `provider_options.openai.request_extra_body` 透传，不污染 codec。

### 上下文工程是认真的

- **5 类 fence**：`turn-context` / `system-event` / `subagent-summary` / `user-interjection` / `memory-context`，全部以 `user` role 注入，**动态内容绝不进 system prompt**。
- **可观察**：开 `observability.llm_request_debug` 就能把每次发给 provider 的真实消息数组写成 JSONL，方便排查"模型为什么这么回答"。
- **两条审计账本**：决策审计（model.select / tool.allow / wait_user.request ...）走 `linnkit` AuditPort；run 上下文审计是 Linnsy 自有格式，按 hash 去重保留每次 LLM 调用看到的完整快照。

### domain-first 架构，长得动

`packages/linnsy-daemon/src/domains/` 下每个 domain（`channel` / `conversation` / `agent-run` / `task` / `cron` / `llm` / `desktop-integration` ...）都是独立业务边界。
**跨 domain 协作只能通过 registry / port / public contract / domain event / app-level orchestration**，由 `guard:boundary` 守住。

详见 [`packages/linnsy-daemon/src/README.md`](./packages/linnsy-daemon/src/README.md)。

---

## 快速上手

### 前置条件

- Node.js 20 LTS+
- npm
- 任一 LLM provider 的 API key（推荐 DeepSeek，兼容 OpenAI 协议、便宜、思考模式强）

### 60 秒跑通

```bash
git clone https://github.com/<your-org>/linnsy.git
cd linnsy

npm run install:daemon

export DEEPSEEK_API_KEY=sk-...        # 或 OPENAI_API_KEY / ANTHROPIC_API_KEY

# 在 ~/.linnsy/config.yaml 写最小配置
# 完整示例见 packages/linnsy-daemon/README.md §Quickstart

npm run doctor                         # 体检：DB / 配置 / 权限 / linnkit 装配 / model_profile
npm run chat                           # 进入交互式对话
```

### 启动桌面 app

```bash
npm run dev:electron
```

桌面 app 是日常使用的主力面，提供应用连接 / 模型管理 / 任务面板 / 提醒面板等可视化能力。

### 接入微信 / Telegram

- 微信私聊：[`docs/guides/wechat.md`](./docs/guides/wechat.md)
- Telegram：[`packages/linnsy-daemon/README.md`](./packages/linnsy-daemon/README.md) §Telegram 通道
- 新增其他 IM 平台：[`docs/guides/adding-platform.md`](./docs/guides/adding-platform.md)

> 完整安装 / 配置 / 测试说明 → [`packages/linnsy-daemon/README.md`](./packages/linnsy-daemon/README.md)

---

## 工作原理

一条消息从 IM 进来，到 Linnsy 回复，大致经过这条管线：

```
ChannelAdapter (CLI / Telegram / 微信 / 桌面)
        │ inbound LinnsyMessage
        ▼
handleTurn  ──►  /pair? → AuthorizationPort
        │              5 层 fall-through 授权
        │              providerMessageId 两阶段幂等去重
        │              SessionRouter.resolve → conversationId
        │              messages.insert(role=user)
        │              活跃 run? → 主人插话排队为 user-interjection
        ▼
RunSpawner.spawnDetached  ──►  RunExecutorPort (linnkit GraphExecutor)
                                │  SqliteCheckpointer
                                │  FenceRegistry + AgentMessageOrchestrator
                                │  AiEngineBridge
                                ▼
                          ProviderRouter → SDK Codec
                          (openai_chat / openai_responses / anthropic_messages)
                                ▼
                          NotificationLayer.replyForRun
                          channel.send → messages.insert(outbound)
```

关键设计：

- **detached run**：消息处理用后台 run，单条消息卡住不会拖垮通道。
- **两阶段幂等**：同一条 IM 消息重复进入只会被处理一次。
- **fence 注入**：cron 触发、子 agent 汇报、主人在 run 中途插话，统统走 fence，**绝不把动态信息塞进 system prompt**。
- **长期记忆**：每轮取本轮参考片段，作为固定 system 第 5 段进入。当前不启用 RAG / 向量召回 / 中期记忆独立存储——简单先于复杂。

详见 [`packages/linnsy-daemon/README.md`](./packages/linnsy-daemon/README.md) §架构一图流 和 §主要 Port。

---

## 仓库布局

```
linnsy/
├── packages/
│   └── linnsy-daemon/                  # 唯一一个 npm 包（ESM Node + Electron）
│       ├── src/
│       │   ├── app/                    # 启动、bootstrap、orchestration
│       │   ├── domains/                # 业务边界（domain-first）
│       │   │   ├── channel/            # IM 通道（cli / telegram / wechat / registry / authorization）
│       │   │   ├── conversation/       # 会话路由、通知层、消息持久化
│       │   │   ├── agent-run/          # agent 注册、system prompt、run 调度、tool runtime
│       │   │   ├── task/               # 任务跟踪、workspace、外部派活（Codex 等）
│       │   │   ├── cron/               # 调度器、定时任务存储
│       │   │   ├── llm/                # provider 路由、model registry、codec
│       │   │   └── desktop-integration/# Electron 主进程协作、UI hint、偏好
│       │   ├── shared/                 # 真正跨 domain 的稳定基础能力
│       │   └── index.ts                # 公开 API surface（唯一）
│       ├── electron/                   # Electron 主进程、preload、IPC、通道控制器
│       ├── app/renderer/               # React 18 + Vite + shadcn/ui 前端
│       └── __tests__/                  # harness / contract / e2e
├── docs/
│   └── guides/                         # 操作指南
└── LICENSE                             # Apache License 2.0
```

---

## 文档导航

| 我要做什么 | 看哪 |
|---|---|
| 第一次运行 | [`docs/guides/getting-started.md`](./docs/guides/getting-started.md) |
| 看 daemon 完整安装 / 配置 / 测试 | [`packages/linnsy-daemon/README.md`](./packages/linnsy-daemon/README.md) |
| 看 daemon 架构 / Port 契约 | [`packages/linnsy-daemon/src/README.md`](./packages/linnsy-daemon/src/README.md) |
| 看桌面 app（Electron）开发 | [`packages/linnsy-daemon/electron/README.md`](./packages/linnsy-daemon/electron/README.md) |
| 接微信私聊 | [`docs/guides/wechat.md`](./docs/guides/wechat.md) |
| 新增 IM 平台 | [`docs/guides/adding-platform.md`](./docs/guides/adding-platform.md) |

---

## 技术栈

| 层 | 选型 |
|---|---|
| 语言 | TypeScript（strict，禁止 `any` / 不安全断言） |
| Runtime | Node.js 20 LTS+，ESM only |
| Agent kernel | [`@linnlabs/linnkit`](https://www.npmjs.com/package/@linnlabs/linnkit) `^0.8.0`（runtime-kernel / ports / context-manager） |
| LLM SDK | `openai` + `@anthropic-ai/sdk`（**只允许这两个**） |
| 持久化 | SQLite（`better-sqlite3`，WAL + FTS5） |
| 桌面 | Electron + React 18 + Vite + shadcn/ui + Tailwind |
| 测试 | Vitest（unit + contract + e2e + harness + live smoke） |
| 守门 | 自研 `guard:boundary`，防止 daemon 反向 deep-import linnkit 内部 |

---

## 路线图与状态

> 真话比 roadmap PPT 重要。当前进度大致如下，详细 Sprint 进度在 `plan/phase1/` 下。

- ✅ **核心 daemon**：消息管线、5 层授权、Pairing、SQLite WAL+FTS5、detached run
- ✅ **CLI / 桌面 app**：行式协议 CLI、Electron 桌面 app（设置 / 应用连接 / 任务面板）
- ✅ **IM 通道**：CLI / Telegram / 微信私聊（gateway）
- ✅ **多 provider LLM**：OpenAI / DeepSeek / Moonshot / 阿里云 / Together / Azure / vLLM / Claude
- ✅ **外部派活**：Codex CLI 集成、task 状态机、workspace 隔离、审计日志
- ✅ **上下文工程**：5 类 fence、context-manager、两条审计账本
- 🚧 **长期记忆**：当前仅"本轮参考片段 + 长期记忆 system 段"，RAG / 向量召回未启用
- 🚧 **跨设备同步**：暂未支持
- 🚧 **更多 IM 平台**：飞书 / 钉钉 / Discord / Slack 等
- 🚧 **MCP server / client**：协议已留口子（`mcp.server` / `mcp.clients`），实现待补

---

## 贡献

欢迎 Issue、PR、设计讨论。提交代码前请阅读：

- [`packages/linnsy-daemon/README.md`](./packages/linnsy-daemon/README.md) §硬约束（@linnlabs/linnkit 版本红线、LLM SDK 红线、boundary 红线）
- [`packages/linnsy-daemon/src/README.md`](./packages/linnsy-daemon/src/README.md)（domain-first 架构、Port 契约）

提交前请确保以下四项全绿：

```bash
cd packages/linnsy-daemon \
  && npm run lint \
  && npm run typecheck \
  && npm run guard:boundary \
  && npm run test
```

---

## 设计哲学

> "**是一个人，不是一个 Agent。**"

这句话不是修辞——它是 Linnsy 所有架构决策的滤网：

| 维度 | Agent 心智（❌） | 人 的心智（✅） |
|---|---|---|
| 回复 | 必有输出 | 有沉默权 |
| 记忆 | 每次对话独立 | 人格连续 |
| 工具 | 自换大模型 / 自加工具 | 自我塑形分级，能力变更需主人授权 |
| 节奏 | 用户问才动 | 有自己的 cron / 主动提醒 |
| 边界 | 越宽越好 | 越清晰越好 |

任何"必须回复 / 自换模型 / 每轮无记忆"的设计都会被这张表打回去重做。

---

## License

[Apache License 2.0](./LICENSE).
