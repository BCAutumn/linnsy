# Observability MCP

> 把 Linnsy 的观察能力以 MCP server / tool registry 形式暴露给外部调试和集成客户端。

## 职责

- 注册 `conversations_list`、`messages_read`、`messages_send`、`events_poll` 和 `tasks_list` 这组稳定工具名。
- 读类工具统一走 DashboardReadModel，不直接穿透到 persistence 或其他 domain 内部实现。
- `messages_send` 只通过可选注入的 `MessageIngressPort` 进入 Linnsy 对话，不在 MCP 层自行拼装 daemon 流程。
- `mcp-server.ts` 只负责把工具 registry 绑定到 MCP stdio transport。

## 边界

MCP 是外部观察和集成出口，不是 Linnsy 主对话 LLM 自己消费的 P4 工具运行时。真正的主会话工具仍归 `domains/agent-run/features/tool-runtime/` 管理。
