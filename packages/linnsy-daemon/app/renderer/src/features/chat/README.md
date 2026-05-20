# `features/chat` —— 对话主区

> linnsy 桌面端的"对话即观察台"主区。任何 LLM 输出（纯文本回复 / 思考链 / 工具调用 / 子 agent 派发与汇报 / cron 系统事件 / 主人中途插话）都在这里**流式、不重复、不卡顿、不丢失、可定制样式**地呈现。
>
> 上层文档：[`app/renderer/README.md`](../../../README.md)。

---

## 心智模型（一句话）

主人和 Linnsy 的所有对话都由"事件"驱动。daemon 推什么、前端就消费什么——**前端不猜事件类型、不识别文本、不判正则**。一组纯函数 reducer 把事件序列折叠成 `ProjectionState`，UI 只是这个 state 的只读视图。

| 心智 | 反义词（永不做） |
|---|---|
| 强类型事件契约 | 文本正则识别工具调用 |
| 投影器是纯函数 | 投影器读时间 / 读全局 / 写副作用 |
| ID 优先合并 | 用数组下标合并 |
| 流式只是"末尾追加 delta"的特例 | 把"是否流式"拆成两条主路径 |
| 6 种气泡同等重要 | "对话区只该出 user/assistant 两种气泡" |

---

## 模块边界

```
features/chat/
├── README.md                  # 本文
├── ChatView.tsx               # 主入口：聚合 projection / scroll / markdown / Composer
├── ChatComposer.tsx           # 输入框（多行 + 小号图标发送）
├── chat-render-observer.ts    # S4.4 开发期大对话观察点（>300 条只提醒一次）
├── message-entry-animation.ts # S6.3 实时新 item 入场动画判定（历史回放不播）
├── use-message-entry-animation.ts
│
├── projection/                # 真相源数据层（事件 → ProjectionState 纯函数）
│   ├── README.md              # 详细模块边界 / 4 条不变量 / 测试矩阵
│   ├── types.ts               # ConversationItem 6 种 kind / EventEnvelope
│   ├── state.ts               # ProjectionState
│   ├── settings.ts            # S4.1 流式 flush interval（默认 33ms；测试可设 0）
│   ├── reducer.ts             # 主 dispatcher
│   ├── hydration.ts           # 历史回放（双源：messages + events）
│   ├── projectors/            # inbound / delta / complete / tool-call-* / subagent-summary / system-event
│   ├── helpers/               # ids / item-ops / selectors / payload-readers
│   └── __tests__/             # 10 文件 · 57 项断言 · golden-replay / multi-answer 反漂移闸门
│
├── items/                     # 渲染分发层（ConversationItem → React 组件）
│   ├── Message.tsx            # 6 种 kind 的 switch 分发器
│   ├── UserBubble.tsx         # 主人消息
│   ├── AssistantBubble.tsx    # Linnsy 回复（流式 markdown）
│   ├── ToolCallCard.tsx       # 工具调用卡（折叠 / 状态 / 走 Tool Registry）
│   ├── SubagentSummary.tsx    # 子 agent 汇报（缩进 + summary markdown）
│   ├── SystemEvent.tsx        # 系统事件（cron 居中胶囊）
│   ├── UserInterjection.tsx   # 主人插话（偏右轻量标签）
│   └── __tests__/Message.test.tsx
│
├── tools/                     # 工具卡 Registry（水平扩展点）
│   ├── types.ts               # ToolUiConfig / ToolCardLayout / ToolCardProps
│   ├── registry.ts            # lookupToolUiConfig / resetToolRegistry
│   ├── DefaultToolCard.tsx    # 未注册工具的兜底渲染
│   ├── HOW_TO_ADD_TOOL_UI.md  # S7.1 新增工具卡 cookbook
│   ├── INTERACTIVE_TOOL_PROTOCOL.md # S7.2 主人交互工具协议
│   ├── configs/index.ts       # 工具配置聚合点，新增工具只在此处加一行
│   └── __tests__/registry.test.ts
│
├── markdown/                  # markdown 渲染层
│   ├── chat-markdown.ts       # stream-markdown-parser 包装（保留单换行 / 流式安全）
│   ├── chat-markdown-cache.ts # S4.2 稳定块 AST 缓存：只重解析增长中的尾块
│   ├── ChatMarkdownView.tsx   # AST → React VNode；streaming 时持有上一帧缓存
│   └── __tests__/
│
└── scroll/                    # 滚动 / sticky / clip 行为
    ├── use-sticky-scroll.ts   # 用户向上滚 → 解除 sticky；message list 变高 → 贴底跟随
    ├── chat-scroll.ts         # buildChatScrollWatchKey（基于内容签名触发滚到底）
    ├── chat-scroll-clip.ts    # 消息列表上下软裁切（让最后一条不被 Composer 遮挡）
    ├── jump-to-bottom.ts      # 上翻后的回到底部按钮计数规则
    └── __tests__/
```

> **目录划分原则**：每个子目录都是"数据流的一个站"——`projection` 算 state，`items` 渲染气泡，`tools` 提供工具卡扩展点，`markdown` 解析文本，`scroll` 处理滚动行为。各子目录之间**只通过明确的导入边界对话**（`items/` 不知道 `projection/` 怎么算的，只读 `selectAllItems` 出来的数组）。

---

## 数据流（从 daemon 推到屏幕）

```
daemon
  │  WS push: RuntimeEventEnvelope
  ↓
lib/runtime-event-batcher.ts ── 33ms 合并 message.delta，不改写事件
  ↓
lib/runtime-event-reducer.ts ── projection/reducer.ts ── projection/projectors/* ── 派生 ProjectionState
  │                                                     ↑
  │                                              optimistic 用户消息
  │                                              ── 构造一条本地 inbound 事件
  │                                              ── 喂给同一个 reducer
  ↓
ChatView.tsx
  │  selectAllItems(state.projection) → ConversationItem[]
  ↓
items/Message.tsx ── switch (item.kind) → 6 种气泡组件 ── 渲染
  │                                       ↑
  │                                  tool_call_card 走 tools/registry 查配置 → DefaultToolCard 兜底 / 自定义 CardComponent
  │
  ├─ markdown/ChatMarkdownView      （assistant / subagent summary 用；流式 assistant 可打开末尾光标）
  └─ scroll/use-sticky-scroll       （在 ChatView 层挂一次；工具卡展开可暂停一次自动贴底）

历史回放：
daemon REST: readMessages + readEvents
  ↓
lib/conversations/hydrate-actions.ts: projectionFromHistoryWithEvents
  ↓
projection/hydration.ts ── 双源合并 ── 走同一个 reducer ── 等价 ProjectionState

daemon 重启：
WS ready.bootInstanceId 变化
  ↓
lib/daemon-api.ts reset cursor
  ↓
shell/AppShell.tsx 清空当前 projection
  ↓
shell/desktop-data.ts 重新拉 readMessages + readEvents 快照
```

> **关键不变量**：实时增量与历史回放最终产物 `deep-equal`。这条由 `projection/__tests__/golden-replay.basic.test.ts` 与 `projection/__tests__/golden-replay.dual-source.test.ts` 守，是反"前后端协议漂移"的核心闸门。

---

## 6 种气泡 ↔ 数据契约

| ConversationItemKind | 触发的事件 | 渲染组件 | 视觉 | 数据来源 |
|---|---|---|---|---|
| `user_bubble` | `message.inbound` (role=user) | `UserBubble.tsx` | 右侧深色气泡 | `messages` 表 / optimistic |
| `assistant_bubble` | `message.inbound` + `message.delta` + `message.thought_delta` + `message.thought_complete` + `message.complete` (role=assistant) | `AssistantBubble.tsx` | 左侧浅色气泡 + 流式 markdown；思考过程以“思考了 1.2 秒”低权重文字行折叠在气泡内 | `messages` 表 + `events` 表 + 实时 WS |
| `tool_call_card` | `tool_call.start` + `tool_call.progress` + `tool_call.result` | `ToolCallCard.tsx` | 折叠卡 + status chip；展开后显示进度 / 入参 / data / observation | `events` 表 + 实时 WS |
| `subagent_summary` | `subagent.progress` + `subagent.summary` | `SubagentSummary.tsx` | 缩进气泡 + 子 run 进度 + summary markdown | `events` 表 + 实时 WS |
| `system_event` | `system.event` (sourceKind: cron / task_execution_notice) | `SystemEvent.tsx` | 居中胶囊 / 灰色小字分隔提示 | `events` 表 + 实时 WS |
| `user_interjection` | `system.event` (sourceKind: user_interjection) | `UserInterjection.tsx` | 偏右轻量标签 | `events` 表 + 实时 WS |

> 围栏 `<turn-context>` 和 `<memory-context>` **不展示给主人**（仅给 LLM）。`<system-event kind="task_status_change">` 是 LLM 终态唤醒围栏，不是前端 runtime event sourceKind；历史数据库里若残留 `system.event(sourceKind=task_status_change)`，投影层会静默忽略。外部 agent 完成时只投影 `task_execution_notice` 这类轻量分隔提示；`channel_status` 只代表连接 / daemon 启停这类运行状态，不投影为对话气泡；主人看右上角状态入口即可。

> **S5.0 已拍板并落地**：`thought`（LLM 思考链）走 `assistant_bubble.thoughtChunks`，不新增 `thought_bubble` kind。daemon 把 linnkit `thought` 事件翻译成 `message.thought_delta` / `message.thought_complete`，前端按同一条 assistant 气泡内的折叠段展示；最终回答出现时自动折叠，刷新后通过 `events` 表回放。同一个 run 内若先输出一段文字、再调工具、再产生新的 thought，投影器会先创建新的 thought 占位气泡，等下一段 answer delta 到达后并入下一段 assistant，避免工具后的思考链被挂回上一段文字气泡。回答正文第一帧或 `message.complete` 到达时，未显式 complete 的 thought 也会被标记完成；`run.status_change` 进入 completed / failed / cancelled 时会立刻把当前 assistant 气泡 `streaming=false`，并且 hydrate / 重连回放也会保留这个终态事件，确保 AI 输出结束后不再生成 `linnsy-markdown__streaming-cursor`。2026-05-07 修订：`AssistantThoughtChunk` 保存 `startedAt / updatedAt / completedAt`，渲染层用纯函数生成“思考了 1.2 秒 / Thinking for 1.2s”的折叠文案，秒数保留 1 位小数。2026-05-11 修订：若 thought 占位段在正文到来前被工具调用截断，渲染层保留该 assistant item 的时间线语义，但使用 `message--thought-only` 紧凑样式，且不渲染空正文 Markdown 容器，避免思考过程撑出一条普通回复的间距。
>
> **S5.4 已落地**：linnkit `tool_process` / `subrun_trace` 不直接进前端，而是在 daemon host 出口翻译成 `tool_call.progress` / `subagent.progress`。默认工具卡只在展开态显示进度，具体工具若需要“调用开始就渲染”或“调用结束后渲染”继续通过 `tools/registry.ts` 的自定义 Card 决定。
>
> **S6.1 已落地**：流式中的 `assistant_bubble` 在 markdown 末尾显示闪烁光标，`complete` 到达后光标消失。光标只由 `AssistantBubble` 打开，具体贴到最后一个 markdown 节点的细节收敛在 `ChatMarkdownView.tsx`，避免 ChatView 感知渲染装饰。
>
> **S6.2 已落地**：工具卡从折叠到展开会造成消息列表高度变化，但这属于用户主动查看细节，不应被 sticky-scroll 当成“新内容流入”。`useStickyScroll` 暴露一次性暂停接口，`ToolCallCard` 展开前调用；下一次流式内容增长仍会恢复贴底。
>
> **S6.3 已落地**：入场动画由 `message-entry-animation.ts` 按 item 可见历史判定。历史 hydrate / 切换会话首帧不播；同一会话内实时新增的气泡才挂 `message--entering`。assistant 流式收尾时虽然 itemId 会从 `stream:*` 换成最终 messageId，但同一位置同一 run 会被视作连续替换，不重播动画。工具卡在同一判定下使用更轻的从下往上淡入动画，并遵守系统减少动态效果设置。
>
> **S6.4 已落地**：主人向上翻旧内容后，`useStickyScroll` 会保持 sticky 断开，并由 `jump-to-bottom.ts` 记录离底时的 item 数量基线；后续新增气泡 / 工具卡 / 系统事件才进入"新消息"计数，流式文本增长本身不反复累加。输入区上方右侧的圆形按钮点击后通过 `jumpToBottom()` 显式恢复 sticky，并刷新输入区裁切；按钮绝对定位在 `composer-wrap` 上方，不参与输入区高度计算，避免消息列表提前裁断。

---

## 工具卡扩展点（水平扩展，不动主路径）

新增工具的 UI 卡片**不需要动**任何渲染主路径代码。3 步：

| 步骤 | 文件 | 做什么 |
|---|---|---|
| 1 | `tools/configs/<tool_name>.tsx` | 写一个 `ToolUiConfig`：`layout` 定大小 / 边框 / 留白；`CardComponent` 定具体样式 |
| 2 | `tools/configs/index.ts` | 在 `configEntries` 数组里加一行 `[toolName, config]` |
| 3 | `lib/i18n/zh-CN.ts` + `en-US.ts` | 加该工具相关的本地化 key |

> **S7.1 已落地**：`tools/HOW_TO_ADD_TOOL_UI.md` 是新增工具卡 cookbook。新增工具 UI 的默认路径是：先判断默认卡是否足够；确实需要专属呈现时，在 `tools/configs/<tool_name>.tsx` 写 `ToolUiConfig`，再到 `configs/index.ts` 注册，最后补 i18n / 测试。主渲染路径不为具体工具开分支。
>
> **S7.2 已拍板**：交互 / 审批不是第 7 种气泡，而是同一张 `tool_call_card` 生命周期里的等待与回复状态。`tools/INTERACTIVE_TOOL_PROTOCOL.md` 记录了 linnkit `requires_user_interaction` 与 Linnya 交互工具经验的取舍：等待信号只表示 daemon 已暂停，主人选择必须回到 daemon，再由后续事件改 projection。

---

## 4 条核心不变量

| # | 不变量 | 守的位置 |
|---|---|---|
| 1 | **纯函数 reducer**：相同入参产生相同 state，无时间 / 全局 / 副作用依赖 | `projection/reducer.ts` + 单测 |
| 2 | **幂等**：相同 `eventId` 二次进 reduce → state 引用 `Object.is` 不变 | `seenEventIds` + `markRunSettled` |
| 3 | **ID 优先合并**：所有合并走 `itemId` / `runId` / `messageId` / `toolCallId`，绝不用数组下标 | `helpers/ids.ts` |
| 4 | **回放等价**：实时增量 `reduceAll(events)` 与历史回放 `hydrateFromMessagesAndEvents(...)` `deep-equal` | `__tests__/golden-replay.{basic,dual-source}.test.ts` |

任何 reducer / projector / hydration 的改动，必须先看 `projection/__tests__/` 下的 10 个文件并保持全绿。新增能力（例如 S5 的 `thought` / 多答复段），先在测试里加 `it()`，**先红再绿**。

---

## 测试覆盖矩阵

| 层 | 文件 | 项 | 主要守的坑 |
|---|---|---|---|
| projection | `__tests__/reducer.test.ts` | 5 | 基础分发、跨会话隔离 |
| projection | `__tests__/streaming.test.ts` | 7 | 拼接等价、CJK / emoji 边界 |
| projection | `__tests__/idempotency.test.ts` | 6 | eventId 闸门、settled 后 delta 丢弃 |
| projection | `__tests__/ordering.test.ts` | 5 | chunkSeq 排序、多 answerId 分组 |
| projection | `__tests__/hydration.test.ts` | 7 | 历史 → state 等价 / 跨会话过滤 |
| projection | `__tests__/tool-call-projectors.test.ts` | 7 | tool_call.start/progress/result 终态 / 重复 / 兜底 |
| projection | `__tests__/subagent-system-projectors.test.ts` | 9 | subagent progress/summary / 3 种可见 sourceKind 分发 + 历史 task_status_change 静默丢弃 |
| projection | `__tests__/thought-projector.test.ts` | 7 | 思考链归属、工具后新思考链归属下一段回答、输出结束后光标收尾、乱序拼接、complete 保留、跨会话过滤 |
| projection | `__tests__/multi-answer.test.ts` | 2 | S5.3 同 run 多 answerId、工具卡夹在两段回答中间、刷新回放等价 |
| projection | `__tests__/streaming.test.ts` | 8 | 流式正文拼接、run 完成后立刻移除正文光标、message.complete 原地替换 |
| projection | `__tests__/golden-replay.{basic,dual-source}.test.ts` | 8 | 反漂移：实时与回放 deep-equal；S5.5 全 kind 混合时间线 |
| items | `items/__tests__/Message.test.tsx` | 13 | 4 种气泡 RTL、思考链折叠/展开、流式光标、入场 class、工具卡折叠态零 body、progress、status chip、展开布局通知、i18n、markdown |
| animation | `__tests__/message-entry-animation.test.ts` | 5 | S6.3 历史 hydrate 不播、实时新增播、切换会话不播、stream id settle 不重播、多答复段新视觉行播 |
| tools | `tools/__tests__/registry.test.ts` | 4 | 默认空表 / 注入 layout / 注入 CardComponent / 多条目 |
| markdown | `markdown/__tests__/chat-markdown-cache.test.ts` | 7 | S4.2 稳定块复用、代码围栏空行、缩进代码块边界、列表容器跨空行、reference definition 全量回退、任意 chunk 等价 |
| observer | `__tests__/chat-render-observer.test.ts` | 3 | S4.4 大对话开发期提醒、生产关闭、按 conversation 去重 |
| scroll | `scroll/__tests__/sticky-scroll-resize.test.tsx` | 4 | S4.5 ResizeObserver 观察 message list、贴底跟随、用户上翻不抢滚动；S6.2 工具卡展开暂停一次自动贴底；S6.4 显式回到底部恢复 sticky |
| scroll | `scroll/__tests__/jump-to-bottom.test.ts` | 4 | S6.4 离底基线、新增 item 计数、回到底部重置、切换会话重置 |
| lib | `lib/__tests__/runtime-event-stream-cursor.test.ts` | 2 | S5.1 WS 重连 since cursor、S5.2 daemon 重启后 cursor reset |
| lib | `lib/__tests__/runtime-event-batcher.test.ts` | 4 | S4.1 delta 33ms 合并、非 delta 立即冲刷、0ms 测试开关、关闭取消 |
| lib | `lib/__tests__/runtime-event-reducer.test.ts` | 5 | 顶层副作用、批量事件与逐条事件等价 |
| shell | `shell/__tests__/AppShell.test.ts` | 32 | 桌面主壳 hydration、设置 / 定时安排入口、S5.2 bootInstanceId 变化后重新拉历史快照 |
| performance | `__tests__/render-performance-baseline.test.tsx` | 3 | S4.0 原始基线 / S4.1 batcher 路径对比 / S4.3 50 张工具卡展开折叠基线 |

> **缺口**：ChatView 整体没有"集成测试"层，未来如果想加，应当走 happy-dom + 一段事件序列脚本回放成屏幕。

---

## 与上下游模块的契合点

| 上游 | 我们消费什么 | 出处 |
|---|---|---|
| `lib/daemon-api.ts` + `lib/runtime-event-stream-cursor.ts` | `RuntimeEventEnvelope` 流（WS，断线重连带 since cursor；ready 带 bootInstanceId，daemon 重启后 reset cursor）+ `readMessages` / `readEvents`（REST） | daemon 单源 |
| `shell/desktop-data.ts` | 桌面启动 / daemon 重启后的 conversation + messages + events 快照读取 | AppShell 薄封装 |
| `lib/chat-actions.ts` | `ChatAppState` 类型与会话动作 re-export | 兼容旧调用方的门面，不放新业务逻辑 |
| `lib/conversations/hydrate-actions.ts` | `selectConversation` + `projectionFromHistory*` | 历史消息 / 事件双源 hydrate |
| `lib/conversations/desktop-send.ts` | `sendDesktopMessage` + pending 桌面对话创建 | 桌面发送动作 |
| `lib/conversations/list-ops.ts` | 会话列表排序、activity 更新时间、首条消息标题 | 纯函数列表层 |
| `lib/runtime-event-batcher.ts` | 把高频 `message.delta` 以 33ms 批次交给 reducer；非 delta 立即冲刷 | S4.1 性能层 |
| `lib/runtime-event-reducer.ts` | 把 WS 事件喂进 `projection/reducer.ts` 的唯一接入点 | 防止"投影路径多源" |
| `features/chat/projection/helpers/payload-readers.ts` | 把未知 payload 窄化成 `src/domains/observability/definitions/runtime-events.ts` 的共享 payload 类型 | 防止"前端重声明协议字段" |
| `lib/i18n.ts` | `t(locale, key)` —— 所有可见文案 | renderer 全局 |

| 下游（被我们用） | 我们怎么用 |
|---|---|
| `stream-markdown-parser` | `markdown/chat-markdown.ts` 包装；S4.2 由 `chat-markdown-cache.ts` 在包外做稳定块缓存，不依赖未公开 mid-state API |
| `components/ScrollArea.tsx` | `ChatView.tsx` 顶层容器 |
| `styles/chat.css` + `chat-items.css` | 6 种气泡 / 工具卡 / sticky 滚动条都在这两个文件 |

---

## 反目标

- ❌ 在 `items/` 组件里写"是否显示"判断（违反"可见性与流式解耦"——可见性由列表层决定）
- ❌ 在 `projection/` 里 import React 任何东西（违反"投影器不感知 React"）
- ❌ 在 `markdown/` 里识别 markdown 之外的语义（违反"渲染层只渲染，不识别意图"）
- ❌ 给某个 LLM provider 在前端开 UI 分支（违反"SDK 无感知"原则；provider 差异由 daemon `provider-adapters` 抹平）
- ❌ 让 `projection/` 依赖 Pinia / Redux / Zustand（投影器必须保持纯 TS；全局 UI 状态切片只允许在 `stores/` 边界内）

---

## 相关文档

- 投影 reducer 详细：[`./projection/README.md`](./projection/README.md)
- 上层前端架构：[`../../../README.md`](../../../README.md)
- daemon 事件 Hub：[`../../../../../src/domains/observability/features/event-hub/event-hub.ts`](../../../../../src/domains/observability/features/event-hub/event-hub.ts)
