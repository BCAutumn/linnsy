# app/renderer

> Linnsy 桌面 app 的前端（renderer 进程），基于 React 18 + Vite + shadcn/ui + Tailwind。
>
> 开发启动 → 仓库根目录 `npm run dev:electron`（一键启动 Electron + renderer + daemon）

---

## 心智模型："对话即观察台"

桌面端不是 daemon 的"控制台"，而是一台桌面 IM。主人在这里和 Linnsy 直接对话，秘书会顺手把"我在干嘛"通过对话告诉你——任务进度 / 提醒触发 / 子 agent 完成这类需要主人知道的状态以对话气泡呈现，不开独立 dashboard 大区抢主视觉。通道连接 / daemon 启停这类运维状态不进对话流，统一由右上角状态入口和通道设置承载。

---

## 三大区

```
┌──────────────────────────────────────────────────────┐
│  Sidebar（260px）       │   主区                      │
│  ─────────────────────  │  ─────────────────────────  │
│  + 新对话                │  [消息气泡区（流式输出）]   │
│  🔍 搜索                 │                             │
│                          │                             │
│  · 桌面对话              │  ─────────────────────────  │
│  · 微信 / 张三           │  [Composer（输入框）]       │
│  · TG / 自己             │                             │
│                          │─────────────────────────────│
│  [⚙ 设置]               │  [Settings / Onboarding]    │
└──────────────────────────────────────────────────────┘
```

| 区域 | 路由 | 说明 |
|---|---|---|
| 历史侧边栏 | 常驻 | 对话列表 + 搜索 + 新建对话 + 定时安排入口 + 设置入口；每条对话 hover/focus 显示 more 菜单；右边缘可拖拽调整宽度（200–360px） |
| 对话主区 | `/chat/:id` | 流式消息气泡 + Composer（多行输入 + 发送）|
| 定时安排 | `/schedule` | 主人对未来触发的安排；可手动新建 / 启停 / 删除；**X1 自适应**：每行默认展示最近执行历史，有产物仅给"查看完整对话"跳转，无产物只显触发时间；一次性触发完进"已完成（7 天后清理）"段 |
| 设置面板 | `/settings/*` | 6 个 tab（常规 / 外观 / 模型 / 记忆 / 终端连接 / 应用连接）|
| Onboarding | `/onboarding` | 6 步独立向导（首次运行 / 未完成配置时显示）|

> 原"任务管理"tab（`/tasks`）已砍掉。Linnsy 替主人跟进的任务（子 agent / 外部 agent 委派）进度走对话流（`<subagent-summary>` / `<system-event>` 围栏）注入主对话，不开独立面板。daemon 后端 `task-tracker` / `delegate_to_*` / `tasks` 表全部保留供 LLM 内部调度。

## 历史侧边栏对话管理

2026-05-07 起，侧边栏对话行在 hover 或键盘 focus 时，右侧显示 more 菜单。普通对话菜单包含：重命名、置顶/取消置顶、归档、删除。重命名使用通用 `AppDialog` + `TextField` + `ActionButtons`；删除使用通用确认弹窗，确认后永久删除短期消息和事件，但不删除长期记忆。侧边栏右边缘提供 6px 拖拽热区，拖拽中实时更新内存态，松手后写回 `sidebar.width_px` 偏好；键盘聚焦该分隔线时可用左右方向键按 10px 调整。外层 `.linnsy-window` 通过同一个 `--sidebar-width` 明确切分侧栏列和主区列，主区宽度永远来自剩余空间，不能让对话内容覆盖侧栏。

排序规则由 `lib/conversation-list.ts` 纯函数负责：手机终端绑定对话永远第一；其他置顶对话按 `pinnedAt` 新到旧排序；普通对话按 `lastActivityAt` 新到旧排序；`archivedAt` 非空默认隐藏。侧边栏时间也显示 `lastActivityAt`，只代表最近一次可见对话流活动，不代表重命名 / 置顶 / 归档这类整理动作。手机终端绑定对话自动置顶，在原 icon slot 显示 phone 图标，菜单只保留重命名，归档/删除/置顶均不渲染，后端也会拒绝。

---

## 对话流气泡类型

| 气泡类型 | 呈现方式 | 物理来源 |
|---|---|---|
| 主人消息 | 右侧气泡，下方有复制按钮 | `messages` 表，`direction=inbound` |
| Linnsy 回复 | 左侧气泡，支持 Markdown 流式渲染；最终回答下方有复制按钮；纯思考占位段使用紧凑行，不渲染空正文 | `messages` 表，`direction=outbound` |
| 工具调用 | 左侧折叠卡片（可展开查看 `data` / `observation`） | WS `tool_call.start` + `tool_call.result` |
| 系统事件 | 居中浅灰气泡 / 灰色小字分隔提示 | `<system-event>` 围栏（cron 触发 / 提醒；任务状态变更只给 LLM 做终态唤醒；外部 agent 完成时展示轻量执行提示）|
| 子 agent 汇报 | 左缩进气泡 | `<subagent-summary>` 围栏 |
| 中途插话标记 | 贴在工具卡之后 | `<user-interjection>` 围栏 |

`<turn-context>` 和 `<memory-context>` 不展示给主人（仅给 LLM）。通道连接 / daemon 启停这类 `channel_status` 运行状态也不展示在对话流里，避免用底层诊断信息打断主人；右上角状态入口是它的唯一用户可见位置。

> **当前实现状态**：6 种气泡全部走 [`features/chat/projection/`](./src/features/chat/projection/README.md) 投影 reducer + [`features/chat/items/`](./src/features/chat/items/) 渲染分发；工具卡走 [`features/chat/tools/`](./src/features/chat/tools/) Registry，未注册工具走 `DefaultToolCard` 兜底。daemon 端 `tool_call.start/result` / `subagent.summary` / `system.event` 事件协议 + `events` 表持久化 + 双源 hydration（`messages` + `events`）已就绪。

历史 hydrate 读取 `events` 时只需要最近的有限窗口，但必须是“最近 N 条再按 seq 正序回放”，不能读最早 N 条；否则长对话重新打开后，最新的 Codex / 子 agent 工具卡会被旧事件挤掉，只剩最终文字气泡。

工具调用事件允许 `tool_call.progress` 先于 `tool_call.start` 到达：投影器会先创建 `args={}` 的占位卡，等迟到的 `start` 回填工具入参、`turnId` 和开始时间。自定义工具卡（例如 Codex 可见接管）必须依赖回填后的 `args` 命中，不能假设 start 一定最早到。

**委派类工具调用的产物归宿**（2026-05-05 拍板）：LLM 调 `delegate_to_internal` / `delegate_to_external` 时，对话流里**只**出现"工具调用"折叠卡 + 后续的"子 agent 汇报"左缩进气泡（来自 `<subagent-summary>` 围栏）。daemon 内部 `tasks` 表照常跟踪，但**不**在前端开独立任务面板——所有进度回流到这条对话里就近呈现。

**Codex 可见接管**（2026-05-14 补充）：`delegate_to_external(definitionKey=delegate_to_codex)` 命中专属工具卡。卡片按 `taskId` 通过 daemon 读取安全摘要，只展示任务标题、目录、prompt 摘要、session 可打开状态；点击“在 Codex 打开”走 Electron IPC，当前实现会新开终端执行 `codex resume --include-non-interactive <sessionId>`，不把 Codex thread 正文塞进 Linnsy 对话流。设置页「应用连接 / Codex」另有最近 Codex 对话选择器，必须由主人手动点击读取，只展示 thread 元数据并提供打开 / 复制 resume 命令。

---

## 数据流

```
daemon（Hono REST + WS）
         │
         ├── REST：初始加载（历史消息 / 设置 / 配置）
         └── WS：实时事件更新（message.delta / tool_call.* / system_event 等）
```

**硬约束**：

- renderer 不直读 SQLite
- renderer 不持有独立持久化（不写 localStorage / IndexedDB）
- renderer 不持有 API key（设置页只显示前 4 位 + 后 4 位，写入通过 REST，从不读取明文）
- 所有业务数据通过 daemon REST / WS 获取

---

## 技术栈

| 层 | 选择 |
|---|---|
| UI 框架 | React 18 |
| 构建工具 | Vite |
| 组件库 | shadcn/ui + Tailwind CSS |
| 状态管理 | Zustand（客户端 UI 状态切片）+ React useState（组件局部瞬态）|
| 路由 | React Router v6 |
| 表单 | 纯 TS view-model + 受控组件 |
| Markdown 渲染 | stream-markdown-parser（自研流式 AST 渲染，保留单换行）|
| 富文本（记忆编辑）| Tiptap（文档模式 + Markdown 源码双模式）|
| 图标 | Fluent SVG（按需加载）|

**不引入**：第二个 UI 框架 / 第二个 CSS 方案 / Redux / MobX / 图表库 / 拖拽库 / 完整图标包

> **2026-05-10 拍板修订**：原先的裸 `useState` 已无法承载 `ChatAppState` 的 11 个顶层字段，桌面主入口改用 Zustand 做客户端 UI 状态切片。Zustand 只管理 renderer 内存态，不做持久化；所有业务数据仍通过 daemon REST / WS 取得。

---

## 目录结构

```
app/renderer/src/
├── features/           # 按功能聚合（高内聚）
│   ├── chat/           # 对话主区（组件 + scroll + markdown + sticky-scroll）
│   ├── settings/       # 设置面板（SettingsView 只做 tab 分发；General / Channels / Memory / Model 分模块）
│   ├── onboarding/     # 6 步 onboarding 向导
│   └── scheduled/      # 定时安排：`ScheduledView` 入口 + `scheduled-view-model` / 历史 hydration / 创建表单纯函数 + 列表与弹窗子组件；未送达段独立 `UndeliveredReminderRow` 极简两行（标题 + 红徽章 + 一次性·原计划时间，详见组件注释）；行内操作（暂停 / 启用 / 删除）用 `IconActionButtons` + `HoverTooltip`，不藏二级菜单
├── lib/                # 跨功能共享工具（daemon-api facade / daemon-client / runtime-event-stream / desktop-bridge / i18n）
│   ├── conversations/  # 会话动作按职责拆分：hydrate / desktop-send / CRUD / 列表纯函数
│   └── i18n/           # 语言包（zh-CN.ts / en-US.ts）
├── shell/              # AppShell（路由骨架 + 全局 layout）
├── stores/             # Zustand 客户端状态切片（conversation / projection / preferences / connections）
├── contracts/          # renderer 唯一共享契约入口：`@renderer/contracts` 汇出 daemon wire DTO / runtime event / desktop IPC 契约
├── components/         # 通用 UI 组件（非业务）；弹层菜单统一复用 `CustomSelect` 的开合过渡，日期 / 时间选择器通过 `use-disclosure-transition` 延迟卸载关闭态
└── styles/             # CSS token 系统（详见 styles/README.md）
```

## 状态层

客户端内存态按职责拆成 4 个 store：

| Store | 职责 |
|---|---|
| `stores/conversation-store.ts` | daemon client、会话列表、当前会话、终端绑定、连接文案与错误 banner |
| `stores/projection-store.ts` | 对话流投影状态；历史 hydration 与 WS 增量都落到同一个 `ProjectionState` |
| `stores/preferences-store.ts` | UI 偏好（主题、语言、侧边栏、定时安排确认偏好等） |
| `stores/application-connections-store.ts` | 应用连接快照与桌面通道状态 |

`stores/chat-app-state.ts` 是过渡期兼容层：AppShell 已经订阅 store，但 Settings / Scheduled / Chat 等旧组件仍可接收 `ChatAppState + setState` 快照。`chat-app-state-slices.ts` 负责把兼容快照拆回 4 个切片；`setChatAppState` 只写发生变化的 store，避免一次状态更新把 conversation / projection / preferences / connections 全部通知一遍。后续页面薄化时再逐步改为直接订阅各自切片。

AppShell 启动期只在 `useLayoutEffect` 里 reset 这些 store：首屏绘制前仍能注入 preload 传来的 theme / language hint，但不在 React render 阶段写全局 store，避免 Strict Mode 或未来 React 调度把初始化执行次数变成隐患。

renderer 需要 daemon 共享契约时，只能从 `@renderer/contracts` 导入。该入口由 `app/renderer/src/contracts/shared.ts` 汇出 wire DTO、`domains/observability/definitions/` 的 RuntimeEvent，以及 `domains/desktop-integration/definitions/` 的 desktop channel / daemon / ui-hint / application-connections 契约；业务组件和 lib 不再写深相对路径穿透到 daemon `src/`。

---

## React 薄化边界

Sprint C 起，renderer 的页面组件只负责布局和事件接线，业务状态与派生逻辑沉到 `.ts` view-model / store / helper：

- `features/settings/SettingsView.tsx` 只做 6 个 tab 的路由分发，常规设置在 `GeneralSettings.tsx`，通道设置在 `ChannelsSettings.tsx`。
- `features/settings/MemorySettingsPanel.tsx` 只拼装侧栏、预览卡和编辑弹窗；加载、保存、开关、后端 effective prompt 刷新都在 `use-memory-settings-panel.ts`。
- `features/scheduled/ScheduledReminderList.tsx` 只负责列表编排；历史、未送达段、行内操作分别拆到独立子组件。
- 通用选择器 `CustomSelect.tsx` 的类型与选项遍历逻辑拆到 `custom-select-types.ts` / `CustomSelectOptions.tsx`，避免控件本体变成混合职责文件。
- `shell/__tests__/AppShell.*.test.ts` 按 chat / settings / memory / wechat 场景拆分，共享夹具落 `app-shell-test-support.tsx`。

当前约束：renderer 生产 `.tsx` 文件不超过 400 行；超过时先判断能否抽 view-model / helper / 子组件，而不是继续往 React 文件里堆逻辑。

---

## 关键 lib 模块

| 文件 | 职责 |
|---|---|
| `lib/daemon-api.ts` | renderer API facade：导出 `DaemonApiClient`、client 工厂与共享 DTO 类型；具体 REST 调用在 `daemon-client.ts`，DTO 类型来自 daemon `src/shared/dto/` |
| `lib/daemon-client.ts` | REST client；每个 `response.json()` 都用共享 zod schema parse，禁止 `as T` 式边界断言 |
| `lib/daemon-http.ts` | REST fetch + URL/query helper；唯一负责把 raw JSON 交给 zod schema |
| `lib/runtime-event-stream.ts` | WebSocket 事件流连接、重连、ready/backfill 处理；WS 顶层事件信封复用共享 DTO guard |
| `lib/chat-actions.ts` | 兼容旧调用方的会话动作门面；只 re-export，不承载业务逻辑 |
| `lib/conversations/hydrate-actions.ts` | 会话选择与历史 hydration；`readMessages + readEvents` 双源回放统一落到 projection |
| `lib/conversations/desktop-send.ts` | 桌面发送与 pending 桌面对话创建；optimistic 用户消息也走 projection reducer |
| `lib/conversations/crud-actions.ts` | 重命名 / 置顶 / 归档 / 删除，以及 daemon 错误人话化入口 |
| `lib/conversations/list-ops.ts` | 会话列表纯函数：upsert、可见活动时间、发送后排序与首条消息标题 |
| `lib/desktop-bridge.ts` | IPC bridge（`window.linnsy`）与 Electron main 通信 |
| `lib/i18n.ts` | 翻译函数 `t(key, locale)`，语言包在 `lib/i18n/` |
| `lib/boot-ui-hint.ts` | 启动时 UI hint 检查（"需要刷新配置"等提示）|
| `lib/early-theme.ts` | 早期主题注入（避免 FOUC）|
| `lib/model-settings.ts` | 模型配置读写工具 |

`desktop-send.ts` 的异步发送必须防会话串台：pending 桌面对话创建返回后，只有用户仍停留在“新对话待创建”状态时才切到新 conversation / 替换 projection；如果用户已经切走，只更新会话列表与偏好，消息仍发到原目标 conversation。

---

## 全局弹窗

通用弹窗统一使用 components/AppDialog.tsx。它负责背景、标题、关闭按钮、ESC / 背景点击关闭，以及进入 / 退出透明度过渡；footer 里需要关闭弹窗的按钮使用 requestClose，不要在业务组件里直接复制关闭动画。弹窗离场会先进入 closing 状态，再由组件回调业务层卸载，避免用户看到硬切。

---

## 国际化

支持中文（zh-CN）和英文（en-US），通过 `t(key, locale)` 函数访问。语言包：

- `lib/i18n/zh-CN.ts`
- `lib/i18n/en-US.ts`

语言偏好存储在 SQLite `ui_preferences` 表，通过 daemon REST 读写。

---

## 样式系统

所有颜色、间距、字号都通过 CSS token 管理，不在业务 CSS 中硬编码 `#hex` / `rgba(...)`。

详细规范 → [`src/styles/README.md`](./src/styles/README.md)

---

## Onboarding 向导（6 步）

```
欢迎 → 选 LLM provider → 填 API key → 连接 IM 平台 → 配勿扰时段 → 完成
```

Onboarding 是 REST 表单流，不是 LLM tool 调用，不进 agent 的 `availableTools`。

---

## 设置面板（6 tab）

| Tab | 内容 |
|---|---|
| 常规 | 语言偏好 / 基础配置 |
| 外观 | 主题色（15 选）/ 颜色模式（亮 / 暗 / 系统）/ 侧边栏宽度 |
| 模型 | LLM provider 选择 + API key 管理 |
| 记忆 | 5 层稳定上下文分段编辑 + 后端 effective `role=system` 响应式投影 + 长期记忆浏览 / 删除 / 编辑 |
| 终端连接 | IM 通道连接管理（微信扫码 / Telegram token）|
| 应用连接 | 外部编码应用连接；Codex 可触发 daemon 轻量 probe 显示本机 CLI 状态，也可手动读取最近 Codex thread 元数据用于打开 / 接管；Claude Code / Cursor 暂未支持 |

记忆 tab 的展示以 daemon 的 system prompt preview 为唯一权威源。对话里的 `manage_memory` 工具可能在设置页已经打开时写入长期记忆，因此记忆面板在窗口重新获得焦点或页面重新可见时会重新读取 memory items 与 preview，避免主人看到旧快照。

---

## 相关文档

- Electron 主进程 → [`../../electron/README.md`](../../electron/README.md)
- daemon HTTP API → [`../../src/app/README.md`](../../src/app/README.md)
- 样式 token 系统 → [`src/styles/README.md`](./src/styles/README.md)
