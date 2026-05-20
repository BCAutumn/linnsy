<div align="center">

# Linnsy

**A personal AI secretary that lives on your computer.**

Not an "agent in a chat box", but an **always-online person**:
someone with a working rhythm, proactive reminders, memory of what you said,
and the ability to call desktop tools such as Cursor, Codex, and Claude Code
within the scope you authorize.

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E=20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-desktop-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

[中文](./README.zh-CN.md) ·
[Quickstart](#quickstart) ·
[Highlights](#highlights) ·
[How It Works](#how-it-works) ·
[Repository Layout](#repository-layout) ·
[Docs](#documentation) ·
[Roadmap](#roadmap-and-status)

</div>

---

## What Is This

Most AI assistants are tools you open, ask a question, and close.
**Linnsy flips that model: it is a person-like secretary that stays on your computer and can be reached across multiple chat entry points.**

- You can talk to the same Linnsy from WeChat, Telegram, the command line, or the desktop app, and **it remembers what you talked about before**.
- When you say "remind me about the meeting tomorrow at 8", it actually comes back tomorrow at 8. **The initiative lives with Linnsy, not inside your reminders app**.
- When you say "replace all console.log calls in this project with logger", it can **dispatch desktop agent tools such as Cursor, Codex, and Claude Code** to work on your machine, then report back.
- It **has the right to stay silent**. When there is no need to reply, it simply does not speak. It will not pad the conversation just to look busy.

In one line: **hire a digital employee, not another chatbot.**

> Warning: Linnsy is still early-stage (Phase 1). The core daemon, CLI, desktop app, WeChat / Telegram channels, and Codex integration are already working. The memory system, cross-device sync, and more IM platforms are still in progress. See [Roadmap](#roadmap-and-status).

---

## Highlights

### Actually Online, Not Just Woken Up

Linnsy runs as a **resident daemon process**. It does not only exist after you open a chat window.

- Built-in cron scheduling lets it proactively start a conversation at a specific time, such as "time for the meeting" or "that email you said you would reply to three days ago is still pending".
- It supports system events, user interjections, sub-agent summaries, and other wake-up paths. All events are injected through `linnkit` context-manager fences, without polluting the system prompt.

### One Linnsy, Many Entrances

| Entry | Status | Notes |
| --- | --- | --- |
| **CLI** | ✅ | `npm run chat`, line-based protocol, minimal validation path |
| **Desktop app** | ✅ | Electron + React 18 + shadcn/ui, the primary user surface |
| **WeChat private chat** | ✅ | Connected through a local gateway, protected by 5-layer authorization |
| **Telegram** | ✅ | Official Bot API + pairing-code authorization |
| **Web** | 🚧 | Bearer-token protocol reserved |
| **More platforms** | 🚧 | See [`docs/guides/adding-platform.md`](./docs/guides/adding-platform.md) |

Every conversation is routed into one SQLite persistence layer (WAL + FTS5). **Messages, tasks, long-term memory, and pairing grants live in one place.**

### It Can Actually Act For You

Linnsy does not just "answer questions". It can **delegate work to agent tools already installed on your computer**:

- **Codex CLI**: edit code, run commands, read files, and report the result.
- **Cursor / Claude Code**: connect through session bridges and reuse subscriptions you already have.
- All external delegation goes through the `external-dispatch` domain, with task status, workspace isolation, and audit logs.

> The idea is simple: **Linnsy does not rebuild an IDE, editor, or agent**. It **borrows the tools you already use** and turns them into subordinates it can coordinate.

### 5-Layer Authorization + Pairing, Safety Before Power

```text
platform_all  ->  platform allowlist  ->  paired (consumed)  ->  global_all  ->  default_deny
```

- The default is deny. A channel must be explicitly authorized before it can talk to Linnsy.
- First-time access from a new platform (WeChat / Telegram) requires `/pair <CODE>`. Pairing codes expire in 10 minutes, avoid ambiguous characters, and allow at most 5 attempts.
- All authorization decisions are centralized in `AuthorizationGuard`. Channel adapters **never** make permission decisions by themselves.

### Multiple LLM Providers, One Model Boundary

| Protocol | SDK | Use cases |
| --- | --- | --- |
| `openai_chat` | `openai` Chat Completions | OpenAI / DeepSeek / Moonshot / Alibaba Cloud / Together / Azure / vLLM ... |
| `openai_responses` | `openai` Responses | OpenAI o-series + reasoning summary |
| `anthropic_messages` | `@anthropic-ai/sdk` | Claude |

Only two LLM SDKs are allowed: `openai` and `@anthropic-ai/sdk`. **No third SDK.**
New providers should use a compatible protocol or provide their own codec.
Vendor extensions such as DeepSeek thinking mode or `reasoning_effort` go through `provider_options.openai.request_extra_body` without contaminating the codec.

### Serious Context Engineering

- **5 fence types**: `turn-context` / `system-event` / `subagent-summary` / `user-interjection` / `memory-context`. They are all injected as `user` role content. **Dynamic content never enters the system prompt**.
- **Observable by design**: enable `observability.llm_request_debug` to write the exact message array sent to the provider as JSONL, which helps explain why the model answered a certain way.
- **Two audit ledgers**: decision audit (`model.select`, `tool.allow`, `wait_user.request`, ...) through `linnkit` `AuditPort`; run-context audit in Linnsy's own format, hash-deduplicated, preserving the full context snapshot seen by each LLM call.

### Domain-First Architecture That Can Grow

Each domain under `packages/linnsy-daemon/src/domains/` (`channel` / `conversation` / `agent-run` / `task` / `cron` / `llm` / `desktop-integration` ...) is an independent business boundary.
**Cross-domain collaboration must go through a registry, port, public contract, domain event, or app-level orchestration**, guarded by `guard:boundary`.

See [`packages/linnsy-daemon/src/README.md`](./packages/linnsy-daemon/src/README.md).

---

## Quickstart

### Prerequisites

- Node.js 20 LTS+
- npm
- An API key from any LLM provider (DeepSeek is recommended: OpenAI-compatible, inexpensive, and strong at reasoning mode)

### Run It In 60 Seconds

```bash
git clone https://github.com/<your-org>/linnsy.git
cd linnsy

npm run install:daemon

export DEEPSEEK_API_KEY=sk-...        # or OPENAI_API_KEY / ANTHROPIC_API_KEY

# Create a minimal ~/.linnsy/config.yaml
# Full example: packages/linnsy-daemon/README.md §Quickstart

npm run doctor                         # checks DB / config / permissions / linnkit wiring / model_profile
npm run chat                           # starts an interactive chat
```

### Start The Desktop App

```bash
npm run dev:electron
```

The desktop app is the primary daily surface. It provides visual management for app connections, models, tasks, reminders, and more.

### Connect WeChat / Telegram

- WeChat private chat: [`docs/guides/wechat.md`](./docs/guides/wechat.md)
- Telegram: [`packages/linnsy-daemon/README.md`](./packages/linnsy-daemon/README.md) §Telegram channel
- Add another IM platform: [`docs/guides/adding-platform.md`](./docs/guides/adding-platform.md)

> Full installation, configuration, and testing guide: [`packages/linnsy-daemon/README.md`](./packages/linnsy-daemon/README.md)

---

## How It Works

A message entering from an IM channel roughly follows this pipeline before Linnsy replies:

```text
ChannelAdapter (CLI / Telegram / WeChat / Desktop)
        | inbound LinnsyMessage
        v
handleTurn  --->  /pair? -> AuthorizationPort
        |              5-layer fall-through authorization
        |              two-phase providerMessageId idempotency
        |              SessionRouter.resolve -> conversationId
        |              messages.insert(role=user)
        |              active run? -> queue user interjection as user-interjection
        v
RunSpawner.spawnDetached  --->  RunExecutorPort (linnkit GraphExecutor)
                                |  SqliteCheckpointer
                                |  FenceRegistry + AgentMessageOrchestrator
                                |  AiEngineBridge
                                v
                          ProviderRouter -> SDK Codec
                          (openai_chat / openai_responses / anthropic_messages)
                                v
                          NotificationLayer.replyForRun
                          channel.send -> messages.insert(outbound)
```

Key design choices:

- **Detached runs**: message handling happens in background runs, so one blocked message does not bring down the channel.
- **Two-phase idempotency**: the same IM message can enter more than once and still be handled only once.
- **Fence injection**: cron triggers, sub-agent reports, and mid-run user interjections all go through fences. **Dynamic information never gets stuffed into the system prompt**.
- **Long-term memory**: each turn fetches relevant reference snippets and injects them as the fixed fifth system section. RAG, vector recall, and independent mid-term memory storage are intentionally not enabled yet. Simple comes before complex.

See [`packages/linnsy-daemon/README.md`](./packages/linnsy-daemon/README.md) §Architecture overview and §Main ports.

---

## Repository Layout

```text
linnsy/
├── packages/
│   └── linnsy-daemon/                  # the only npm package (ESM Node + Electron)
│       ├── src/
│       │   ├── app/                    # startup, bootstrap, orchestration
│       │   ├── domains/                # business boundaries (domain-first)
│       │   │   ├── channel/            # IM channels (cli / telegram / wechat / registry / authorization)
│       │   │   ├── conversation/       # session routing, notification layer, message persistence
│       │   │   ├── agent-run/          # agent registry, system prompt, run scheduling, tool runtime
│       │   │   ├── task/               # task tracking, workspace, external delegation (Codex, etc.)
│       │   │   ├── cron/               # scheduler and scheduled-job storage
│       │   │   ├── llm/                # provider routing, model registry, codecs
│       │   │   └── desktop-integration/# Electron main-process coordination, UI hints, preferences
│       │   ├── shared/                 # stable cross-domain foundations only
│       │   └── index.ts                # public API surface (the only one)
│       ├── electron/                   # Electron main process, preload, IPC, channel controllers
│       ├── app/renderer/               # React 18 + Vite + shadcn/ui frontend
│       └── __tests__/                  # harness / contract / e2e
├── docs/
│   └── guides/                         # usage guides
├── README.zh-CN.md                     # Chinese README
└── LICENSE                             # Apache License 2.0
```

---

## Documentation

| Goal | Read |
| --- | --- |
| First run | [`docs/guides/getting-started.md`](./docs/guides/getting-started.md) |
| Full daemon installation / configuration / testing | [`packages/linnsy-daemon/README.md`](./packages/linnsy-daemon/README.md) |
| Daemon architecture / port contracts | [`packages/linnsy-daemon/src/README.md`](./packages/linnsy-daemon/src/README.md) |
| Desktop app (Electron) development | [`packages/linnsy-daemon/electron/README.md`](./packages/linnsy-daemon/electron/README.md) |
| WeChat private chat | [`docs/guides/wechat.md`](./docs/guides/wechat.md) |
| Add an IM platform | [`docs/guides/adding-platform.md`](./docs/guides/adding-platform.md) |

---

## Tech Stack

| Layer | Choice |
| --- | --- |
| Language | TypeScript (`strict`, no `any` / unsafe assertions) |
| Runtime | Node.js 20 LTS+, ESM only |
| Agent kernel | [`@linnlabs/linnkit`](https://www.npmjs.com/package/@linnlabs/linnkit) `^0.8.0` (`runtime-kernel` / `ports` / `context-manager`) |
| LLM SDKs | `openai` + `@anthropic-ai/sdk` (**only these two**) |
| Persistence | SQLite (`better-sqlite3`, WAL + FTS5) |
| Desktop | Electron + React 18 + Vite + shadcn/ui + Tailwind |
| Testing | Vitest (unit + contract + e2e + harness + live smoke) |
| Guardrail | Custom `guard:boundary`, preventing daemon code from deep-importing linnkit internals |

---

## Roadmap And Status

> Truth beats roadmap slides. Current progress is roughly:

- ✅ **Core daemon**: message pipeline, 5-layer authorization, pairing, SQLite WAL+FTS5, detached runs
- ✅ **CLI / desktop app**: line-based CLI protocol, Electron desktop app (settings / app connections / task panel)
- ✅ **IM channels**: CLI / Telegram / WeChat private chat (gateway)
- ✅ **Multi-provider LLM**: OpenAI / DeepSeek / Moonshot / Alibaba Cloud / Together / Azure / vLLM / Claude
- ✅ **External delegation**: Codex CLI integration, task state machine, workspace isolation, audit logs
- ✅ **Context engineering**: 5 fence types, context-manager, two audit ledgers
- 🚧 **Long-term memory**: currently limited to per-turn reference snippets + long-term memory system section; RAG / vector recall are not enabled yet
- 🚧 **Cross-device sync**: not supported yet
- 🚧 **More IM platforms**: Feishu / DingTalk / Discord / Slack, etc.
- 🚧 **MCP server / client**: protocol slots are reserved (`mcp.server` / `mcp.clients`), implementation pending

---

## Contributing

Issues, PRs, and design discussions are welcome. Before submitting code, please read:

- [`packages/linnsy-daemon/README.md`](./packages/linnsy-daemon/README.md) §Hard constraints (`@linnlabs/linnkit` version boundary, LLM SDK boundary, boundary guard)
- [`packages/linnsy-daemon/src/README.md`](./packages/linnsy-daemon/src/README.md) (domain-first architecture, port contracts)

Before submitting, make sure these four checks pass:

```bash
cd packages/linnsy-daemon \
  && npm run lint \
  && npm run typecheck \
  && npm run guard:boundary \
  && npm run test
```

---

## Design Philosophy

> "**A person, not an agent.**"

This is not a slogan. It is the filter behind every Linnsy architecture decision:

| Dimension | Agent mindset (❌) | Person mindset (✅) |
| --- | --- | --- |
| Replies | Must always output something | Has the right to stay silent |
| Memory | Every chat is isolated | Continuous personality |
| Tools | Swaps models / adds tools by itself | Self-shaping is staged, capability changes need owner authorization |
| Rhythm | Acts only after the user asks | Has cron and proactive reminders |
| Boundaries | Wider is better | Clearer is better |

Any design that requires mandatory replies, self-swapped models, or stateless conversations gets sent back to the drawing board.

---

## License

[Apache License 2.0](./LICENSE).
