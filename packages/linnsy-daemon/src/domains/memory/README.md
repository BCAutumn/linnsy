# Memory domain

Memory domain 承载 Linnsy 的长期记忆读取、默认记忆项、system prompt 塑形规则和记忆设置页 HTTP 边界。它对应产品里的 P3 上下文层：让主人偏好、人格连续性、长期事实和本轮相关记忆稳定进入模型上下文。

当前已完成 recall、prompt-shaping、default-items、http route 与 memory persistence 的迁移。system prompt preview 的 agent registry 接线留在 app HTTP 装配层。

| 目录 | 职责 |
|---|---|
| `features/recall/` | 从 MemoryStore 读取长期记忆，过滤 disabled 项，产出 system prompt 所需快照和本轮 `<memory-context>` 事实 |
| `features/prompt-shaping/` | 把 recall snapshot 塑形成 system prompt override、extra sections、long-term memory 段和 shaping cache version |
| `features/default-items/` | 维护内置五段记忆初始项与开发期旧内置项清理 |
| `features/http/` | 暴露记忆设置页所需的 REST route：列表、创建、更新、删除与 system prompt preview |
| `persistence/` | memory items SQLite store、`MemoryProviderPort` 与直接单测 |

边界约定：

| 约定 | 原因 |
|---|---|
| Memory domain 不注册 linnkit fence | fence schema 属于 agent-run/context-engineering 装配，Memory 只描述本轮应注入的记忆事实 |
| Memory domain 不直接依赖 AgentDefinition | 是否给某个 agent 使用长期记忆由调用方根据 agent policy 决定，Memory 只执行召回规则 |
| Memory HTTP route 不直接依赖 agent registry | system prompt preview 通过窄回调注入，agent registry 与 preview builder 留在 app HTTP 装配层 |
| system prompt assembler 不读取 MemoryStore | assembler 只组合已塑形输入并维护缓存，避免“读记忆”和“拼 prompt”互相牵动 |
