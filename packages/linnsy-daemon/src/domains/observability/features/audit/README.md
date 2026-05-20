# Observability audit

> Linnsy 运行审计账本，记录短决策事件和可回放的 run 上下文快照。

## 职责

- 实现 linnkit `AuditPort`，把模型选择、工具决策、等待用户、取消等短决策写入 `audit/decisions.jsonl`。
- 在每次 run 结束时写入 `audit/run-context.jsonl`，保存排障所需的模型可见上下文快照。
- 写入前剔除 thought 消息与 provider reasoning sidecar，并按消息 hash 去重，避免把不该长期留存的推理细节写进审计账本。
- 按配置执行文件轮转、保留期清理和启动清理。

## 边界

Audit 只记录已经发生的事实和上下文快照，不决定 run 是否成功、不发布 runtime event，也不参与前端对话流投影。Agent-run 只能通过 `RunContextAuditPort` 这类窄口接入审计，不直接依赖具体文件实现。
