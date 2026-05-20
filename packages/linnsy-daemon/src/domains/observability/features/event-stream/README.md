# Observability event stream

> daemon 到桌面 renderer 的 WebSocket 运行事件出口。

## 职责

- 暴露 `WS /api/v1/stream`，认证通过后订阅运行事件。
- 支持 `?since=<seq>` 重连补齐，先订阅 live 事件并缓冲，再回放持久化历史，最后发送 ready 帧。
- 为每次 daemon 启动生成 `bootInstanceId`，让 renderer 在重启后主动重新 hydrate。

## 边界

Event stream 只负责传输、cursor、去重和 ready 帧，不解析业务 payload，也不决定事件是否应该产生。具体事件事实来自 event hub；业务规则仍归 Cron、Task、Agent-run、Conversation 等 domain。
