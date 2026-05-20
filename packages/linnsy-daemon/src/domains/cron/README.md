# Cron domain

Cron domain 承载 Linnsy 的 P2 触发层定时能力：一次性提醒、周期提醒、到点 claim、miss grace、执行历史与一次性任务保留清理。

## 目录

| 路径 | 职责 |
|---|---|
| `definitions/` | 定时安排与执行记录的公共契约 |
| `features/scheduler/` | 调度器入口、文件锁、scheduler port 与 feature 内错误序列化 |
| `features/scheduler/functions/` | 时间计算规则 |
| `features/scheduler/orchestration/` | due job claim、run 执行、一次性任务清理 |
| `features/http/` | 定时安排 REST 边界 |
| `features/cron-agent/` | 显式后台批处理用的 cron runner agent definition |
| `persistence/` | cron job / run 的 SQLite store、store port 与直接单测 |

## 过渡边界

本阶段只做等价迁移。scheduler orchestration 仍依赖 Agent-run run-spawner 的 public port、Observability event hub 的公开 port 与 `domains/desktop-integration/features/terminal-binding/` 的 `getBinding()` 窄口，并通过 `domains/conversation/features/notification/` 的 notification 窄口投递结果；`cron-agent` 使用 `domains/agent-run/features/agents/contracts.ts` 的 `AgentDefinition` 契约。后续阶段应由 app-level orchestration 或更窄的 public contract 承接剩余跨边界协作。
