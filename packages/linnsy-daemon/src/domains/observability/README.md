# Observability domain

> 对话流事件、运行状态回放、审计与只读观察入口的业务边界。

## 目录

| 路径 | 职责 |
|---|---|
| `definitions/` | daemon publish、SQLite events、WebSocket stream、renderer projection 共享的 runtime event wire 契约 |
| `features/audit/` | 短决策审计、run 上下文审计、审计文件轮转与保留期清理 |
| `features/dashboard/` | 对话、消息、任务和事件的只读 read model 与观察 REST 入口 |
| `features/event-hub/` | 运行事件的进程内广播、短窗口回放与持久化 append/history port 接入 |
| `features/event-stream/` | `WS /api/v1/stream` 的认证、cursor 回放、live 缓冲去重与 ready 帧 |
| `features/mcp/` | 面向外部调试 / 集成客户端的 Observability MCP tools 与 stdio server |

## 边界

Observability 只描述“发生了什么、如何被回放、如何被观察”。它不决定 Cron 是否触发、不决定 Task 是否完成、不决定 Agent-run 如何执行工具；这些业务规则留在各自 domain 内。其他 domain 需要发布或订阅运行事件时，只依赖这里的 public definitions 或由装配层注入窄 port。
