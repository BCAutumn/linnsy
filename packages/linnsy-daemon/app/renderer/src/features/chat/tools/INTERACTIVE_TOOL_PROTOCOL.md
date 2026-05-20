# 主人交互工具协议

> S7.2 拍板：先写协议，不新增运行时代码。当前 Linnsy 还没有真实需要主人在工具卡里审批 / 修改 / 跳过的工具，提前新增 wire event、HTTP endpoint 或第七种气泡都会变成悬空实现。
>
> 这份文档定义“第一张交互工具卡出现时应该怎么接”，用于后续实现时避免走偏。

## 大白话边界

交互工具不是让前端自己决定工具成败。它只是 Linnsy 说：“这件事要你点头或补一句话，我已经停住等你了。”

主人点了按钮之后，选择要回到 daemon；daemon 再继续 run，并把新的事实事件推回对话流。前端不直接改工具卡的最终状态。

## 调研结论

### 来自 linnkit

`@linnlabs/linnkit` 的集成指南给了两条关键约束：

| 结论 | 对 Linnsy 的含义 |
|---|---|
| WaitUserNode 会发出 requires_user_interaction | 这是“后端已经正式暂停”的权威信号 |
| 实时事件要走 host 自己的 EventBus 唯一出口 | Linnsy 不能让 renderer 直接消费 linnkit 内部事件 |
| shouldPersist / shouldReplay / shouldEnterAgentContext / shouldEmitToSse 是治理边界 | 等真实接入时，daemon 端要明确哪些事件进库、回放、进上下文、推 UI |
| contracts / runtime-kernel/events 是浏览器安全入口 | renderer 仍不应 import Node-only runtime-kernel |

### 来自 Linnya

Linnya 的经验更贴近 UI：

| 结论 | 对 Linnsy 的含义 |
|---|---|
| requires_user_interaction 是控制面事件 | 它本身不创建消息，只改变“等待主人提交”的状态 |
| 用户提交后用 tool_output 继续 | 主人选择是工具结果的一部分，不是前端私改状态 |
| interaction metadata 只 patch 同一张工具消息 | 不新增一条“审批消息”把时间线打散 |
| 严格按 tool_call_id 关联 | 不用数组位置、文本内容、工具名猜关联 |
| 不因 SDK 差异加 UI 分支 | 只消费统一事件协议 |

## Linnsy 拍板

### 不新增第七种气泡

之前计划里写过“requires_user_interaction -> 新增 user_input_request kind”。这次重读 linnkit / Linnya 后，决定先不这么做。

原因：

| 方案 | 优点 | 问题 |
|---|---|---|
| 新增独立 user_input_request item | 看起来清楚 | 容易把一次工具调用拆成两条消息，审批结果和工具事实分离 |
| 作为 tool_call_card 的交互状态 | 保持同一张工具卡完整表达 start / wait / response / result | 需要工具卡支持 action 区 |

Linnsy 选择第二种。交互是工具调用生命周期的一段，不是新消息种类。

### 两层事件，不混用

| 层 | 职责 | 未来实现 |
|---|---|---|
| 等待信号 | daemon 告诉 renderer：这个 toolCallId 已安全暂停，正在等主人 | 新增 Linnsy 自己的控制面 wire 事件，或扩展 tool_call.progress 的 metadata；实现时再定 |
| 主人回复 | renderer 告诉 daemon：主人选择了允许 / 修改 / 跳过 | 新增 resume endpoint / IPC action，daemon 再转成工具输出或继续 run |

这两层不能混成“前端点按钮后直接把工具卡改成成功”。

## 状态模型

交互工具卡的状态按下面理解：

| 状态 | 触发 | UI |
|---|---|---|
| running | tool_call.start | 普通运行态 |
| awaiting_user | 后端正式暂停等待主人 | 显示按钮 / 输入框，可提交 |
| submitting | 前端已发出主人选择，等 daemon 确认 | 按钮 pending，本地临时态 |
| responded | daemon 接收了主人选择，并继续 run | 显示已选择摘要，按钮不可重复提交 |
| success / error / blocked | tool_call.result | 最终事实 |

其中 awaiting_user / submitting / responded 是交互层状态；success / error / blocked 仍是工具最终状态。

## 动作语义

Phase 1 只预留三种通用动作：

| 动作 | 含义 | 适用 |
|---|---|---|
| approve | 同意原方案 | 写记忆、改人格、发送前确认 |
| modify | 主人给出修改后的内容 | 修改记忆内容、改发送文案、调整参数 |
| skip | 不执行这一步 | 放弃写入、跳过发送、取消本次危险动作 |

不预留任意 action 字符串。某个工具真的需要更多动作时，先扩协议文档，再扩 daemon 类型，再扩 UI。

## 数据归属

| 数据 | 权威来源 |
|---|---|
| toolCallId | daemon / linnkit |
| toolName | daemon |
| 需要主人看的标题、说明、候选项 | daemon 的交互请求 payload |
| 主人选择 | renderer 发回 daemon |
| 工具是否成功 | daemon 后续 tool_call.result |
| 工具最终事实 | daemon 后续 tool_call.result.payload.data |
| AI 上下文摘要 | daemon 后续 tool_call.result.payload.observation |
| 卡片最终展示 | projection reducer |

前端可以持有提交中的临时 pending，但刷新后应以 daemon 事件回放为准。

## 第一张交互工具落地时的实现顺序

1. 先选一个真实工具场景，例如 memory_write 或 persona_update。
2. 在 daemon 端定义交互请求 payload，字段必须和 toolCallId 强绑定。
3. 决定等待信号是新增 RuntimeEventKind，还是复用 tool_call.progress 的结构化 metadata。
4. 增加 renderer projection：只 patch 既有 tool_call_card，不新增 conversation item kind。
5. 增加 tool config：在 tools/configs/<tool_name>.tsx 写 CardComponent。
6. 增加 resume action：renderer 提交主人选择，daemon 继续 run。
7. 增加 replay 测试：刷新后仍能看到等待态 / 已回复态 / 最终态。

实现时必须同步更新：

| 改动 | 必更新 |
|---|---|
| 新 RuntimeEventKind | packages/linnsy-daemon/src/domains/observability/definitions/runtime-events.ts |
| 新 daemon resume endpoint / IPC | packages/linnsy-daemon/src/app/README.md + renderer daemon-api |
| 新工具卡 UI | HOW_TO_ADD_TOOL_UI.md + Message / registry 测试 |
| 新审批策略 | 对应工具 README 与测试 |

## 反目标

- 不用 observation 文本正则判断 requireUser。
- 不让 renderer 直接消费 linnkit 原始 requires_user_interaction。
- 不把审批做成独立任务面板。
- 不把主人选择写进前端本地状态后就算成功。
- 不新增匿名 action。
- 不让不同 SDK / provider 走不同 UI 分支。
