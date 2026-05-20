# Terminal binding

> 手机终端接入对话的绑定规则。

## 职责

| 文件 | 职责 |
|---|---|
| `terminal-binding-service.ts` | 维护 Phase 1 固定 `mobile` 终端绑定、默认桌面主窗口绑定、绑定切换与手机 IM 入站会话解析 |
| `http/terminal-binding-routes.ts` | `GET /api/v1/terminal-binding` 与 `PUT /api/v1/terminal-binding` 的 HTTP 薄入口，只做 DTO 校验和 service 调用 |

## 边界

- 只依赖 Conversation domain 的 session-routing 契约和 conversation store port。
- 不启动 Channel adapter，不解析平台 webhook，不发送消息。
- 不决定 Cron 何时触发；Cron 只通过 `getBinding()` 获取主动提醒应该回到哪个 conversation。
