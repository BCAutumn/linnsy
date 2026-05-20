# Observability dashboard

> Linnsy 的只读观察入口：把对话、消息、任务和运行事件整理成桌面端可回放的 read model。

## 职责

- 从注入的 conversation / message / task / event 读口读取数据，转换成桌面观察视图需要的稳定形状。
- 暴露 `/api/v1/conversations`、`/api/v1/conversations/:conversationId/messages`、`/api/v1/conversations/:conversationId/events`、`/api/v1/tasks` 和 `/api/v1/events` 这组观察 REST 入口。
- 支持桌面新建本地 conversation，但只通过注入的 `ConversationCreatePort` 触发，不直接持有 session-routing 实现。
- 历史事件读取和实时事件轮询分开：前者来自持久化 history port，后者来自 event hub ring buffer。

## 边界

Dashboard 只服务“看见发生了什么”和“回放发生过什么”。它不决定任务状态、不生成通知、不启动 run，也不修改记忆或模型设置；这些动作继续留在各自 domain 或 app 装配层。
