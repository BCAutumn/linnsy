# `features/chat/projection` —— 流式投影 reducer

> 本目录是渲染层的"真相源数据层"。`ChatAppState.projection` 完全由本目录的纯函数 reducer 派生；
> ChatView / Message / 各种 Bubble 通过 `selectAllItems(state.projection)` 读出有序 `ConversationItem[]` 渲染。
>
> 本目录的设计目标和不变量见下文。

## 模块边界

```
projection/
├── types.ts                 # ConversationItem 6 种 kind / EventEnvelope 等纯类型
├── state.ts                 # ProjectionState 数据结构（含 toolCallsById 索引）+ createInitialState()
├── reducer.ts               # 主入口 reduce(state, event) / reduceAll(state, events)
├── hydration.ts             # 历史回放双源：messages + events → ProjectionState（内部转事件后走同一个 reduce）
├── projectors/
│   ├── inbound.ts           # message.inbound 投影器（user / assistant 入站态）
│   ├── delta.ts             # message.delta 投影器（流式 chunk 拼接）
│   ├── complete.ts          # message.complete 投影器（流式收尾、settle 切 ID）
│   ├── tool-call-start.ts   # tool_call.start → ToolCallCardItem(running)
│   ├── tool-call-progress.ts # tool_call.progress → ToolCallCardItem.progressChunks
│   ├── tool-call-result.ts  # tool_call.result → patch data / observation / error 等终态字段
│   ├── subagent-summary.ts  # subagent.progress/summary → SubagentSummaryItem
│   └── system-event.ts      # system.event → SystemEventItem / UserInterjectionItem
├── helpers/
│   ├── ids.ts               # 流式 / settled / toolCall / subagent / systemEvent / interjection itemId 派生
│   ├── item-ops.ts          # 不可变操作集（appendItem / replaceItem / swapItemId / markEventSeen / markRunSettled / bindStreamingItem / bindToolCall）
│   ├── selectors.ts         # 渲染层只读视图（selectAllItems / selectStreamingItemId）
│   └── payload-readers.ts   # 事件 payload 类型守卫（对话流 kind 都有对应 reader）
└── __tests__/               # 10 个文件 · 57 项断言
```

## 4 条不变量（任何修改都必须守住）

1. **纯函数**：`reduce(state, event)` 内部不读时间不读全局，只依赖入参。
2. **幂等**：相同 `eventId` 二次进 reduce → state 引用 `Object.is` 不变（`seenEventIds` 闸门 + `markRunSettled` 双保险）。
3. **ID 优先**：所有合并都走 `itemId` / `runId` / `messageId`，绝不用数组下标。
4. **回放等价**：`reduceAll(events).items` 与 `hydrateFromMessagesAndEvents(eventsToMessages(events), events).items` `deep-equal`。这条由 `__tests__/golden-replay.basic.test.ts` / `__tests__/golden-replay.dual-source.test.ts` / `multi-answer.test.ts` 守，**S2.4 升级为双源版本，S5.3 起 message.delta 也参与历史回放**。

## Assistant 段落边界

`streamingItemIdByRun` 只代表同一个 run 当前正在写入的 assistant 段，不是整轮 run 的永久归属。`message.complete` / `run.status_change` 可以保留这个槽位，等待最终消息把流式气泡原地替换成权威 `messageId`；但 `tool_call.start` / `tool_call.result(blocked)` 是对话时间线上的硬边界，必须关闭并释放当前 assistant 段。否则“工具前只有思考、工具后继续思考并回答”的场景会把后半段重新接回工具前的 thought-only 气泡，导致工具卡和回答顺序串位。

## 测试矩阵（11 个文件 · 66 项）

| 文件 | 项 | 守的坑 / 不变量 |
|---|---|---|
| `reducer.test.ts` | 5 | 基础分发、跨会话隔离、未知事件不变 |
| `streaming.test.ts` | 8 | 拼接等价、不 trim、CJK / emoji 边界、流式 ↔ settled 切换 |
| `idempotency.test.ts` | 6 | eventId 闸门、settled 后 delta 丢弃、optimistic→authoritative swap |
| `ordering.test.ts` | 5 | chunkSeq 排序、多 answerId 分组、user/assistant 视觉次序 |
| `hydration.test.ts` | 8 | ConversationMessage[] → state 等价、空数组 / 元数据保留 / 跨会话过滤 |
| `tool-call-projectors.test.ts` ⭐ S2/S5.4 | 8 | tool_call.start 创建 running 卡 / progress 追加 / result patch 终态 / 重复 start 被拒 / blocked 兜底 / 跨会话 |
| `subagent-system-projectors.test.ts` ⭐ S2/S5.4 | 9 | subagent.progress 占位 + summary patch / subagent.summary 幂等 / system.event 可见 sourceKind 分发 / 历史 task_status_change 静默丢弃 / 跨会话隔离 |
| `thought-projector.test.ts` ⭐ S5.0 | 8 | 思考链归属、工具边界切段、乱序拼接、complete 保留、跨会话过滤 |
| `multi-answer.test.ts` ⭐ S5.3 | 2 | 同 run 多 answerId、工具卡夹在两段回答中间、刷新回放等价 |
| `golden-replay.{basic,dual-source}.test.ts` ⭐ | 8 | 反漂移闸门：reduce 路径与 hydrate 路径产物 deep-equal（含 S2 新事件双源等价、S5.5 全 kind 混合时间线） |

任何 reducer / projector / hydration 的改动，11 个文件都必须保持绿。如果新增能力（例如 S5 的 `thought` kind / 多答复段），就在对应文件里新增 it，**先红再绿**。

## 与上层 ChatAppState 的契合点

- `lib/conversations/hydrate-actions.ts` 的 `projectionFromHistory(conversationId, messages)` 暴露了"历史 → projection"的单源入口。
- `lib/conversations/hydrate-actions.ts` 的 `projectionFromHistoryWithEvents(conversationId, messages, events)` 是 **S2.4 双源入口**——caller 同时拉 `client.readMessages()` + `client.readEvents()` 喂进来，让 hydrate 出的 state 与实时态在结构上 deep-equal。
- `lib/chat-actions.ts` 只保留旧调用方门面，避免 hydrate / 发送 / CRUD / 列表纯函数继续混在一个文件里。
- `runtime-event-reducer.ts` 在每个事件里调 `reduceProjection(state.projection, event)`，是 daemon WS 推送的唯一接入点。
- optimistic 用户消息也走"构造一条本地 inbound 事件喂 reducer"的路径——保证投影路径单一。
- `helpers/payload-readers.ts` 只做 `unknown` → 共享 payload 类型的运行时窄化；字段定义必须从 `src/domains/observability/definitions/runtime-events.ts` 导入，不能在前端重新声明一套同名 payload，避免 wire 协议漂移。

## S2/S5 与 linnkit events 协议的边界

linnkit 内部已经有一套 agent-level `RuntimeEvent` 协议（`@linnlabs/linnkit/contracts`），覆盖 `thought / tool_call_decision / tool_process / observation / subrun_trace / stream_chunk` 等。**它和本目录消费的 `RuntimeEventEnvelope` 不是同一个 union**——本目录消费的是 daemon → renderer 的 wire 协议（`domains/observability/definitions/runtime-events.ts`），linnkit 内部协议由 daemon 自己消化（在 `tool-runtime.ts` / `cron/scheduler.ts` 等位置 publish 出 wire 事件）。

S5.4 起，daemon 在 `domains/agent-run/features/run-executor/agent-event-bridge.ts` 把 linnkit `tool_process` / `subrun_trace` 收敛成 Linnsy 自己的 `tool_call.progress` / `subagent.progress`。本目录只消费这两种 wire 事件并追加到 `progressChunks`，不直接理解 linnkit 的十几种内部事件；具体工具卡如何呈现 progress 仍由工具 registry 决定。
