# Observability event hub

> daemon 对话流事件的进程内广播与短窗口回放能力。

## 职责

- 发布 `RuntimeEvent`，并在广播前同步调用注入的持久化 port。
- 为 WebSocket stream、测试夹具和 bootstrap 提供订阅与 cursor poll 能力。
- 在没有持久化 history port 的轻量测试里，用内存 ring buffer 提供短窗口回放。

## 边界

Event hub 不决定事件是否应该产生，也不理解 Cron、Task、Agent-run 的业务状态。各 domain 只能通过窄 event port 或 app 装配传入的 `RuntimeEventHubPort` 发布事实，具体规则仍留在各自 domain 内。
