# Conversation domain

Conversation domain 负责“主人和 Linnsy 正在聊哪一段话”的业务边界。

## 当前 features

| Feature | 职责 | 边界 |
|---|---|---|
| `features/session-routing/` | 把平台消息稳定映射到 conversation，维护 `session_key = linnsy:main:{platform}:{chat_type}:{chat_id}` 规则，并支持桌面分支会话和直接 conversationId 写入 | 不判断授权，不发送消息，不管理 channel 生命周期 |
| `features/management/` | 桌面对话历史整理：重命名、置顶、归档、永久删除，并保护当前手机终端绑定对话 | 不直接写跨表 SQL，不直接依赖 runtime terminal-binding / system-prompt，只通过窄 port 查询绑定和失效缓存 |
| `features/http/` | 对话历史整理的 REST 边界：重命名、置顶、归档、永久删除 | 不写整理业务规则，不直接访问 store；只做 DTO 校验、错误码映射和 `ConversationManagementPort` 调用 |
| `features/notification/` | 把 run / task 的结果发回给主人所在 conversation，并落库 outbound message | 不管理 channel 生命周期，不直接依赖 runtime channel registry / event hub；只通过 `NotificationChannelPort` 和 `NotificationEventPublisherPort` 窄口接线 |

## 迁移说明

阶段 5.1 迁移 session routing，阶段 5.2 迁移 conversation management，阶段 5.3 迁移 conversation HTTP route，阶段 5.4 迁移 notification，均不改行为。跨表永久删除事务仍由 persistence 层 port 承接，domain 不直接绑定 SQLite schema。
