# src/app

`app/` 是 daemon 的应用层：只负责跨 domain 编排、bootstrap 接线和 HTTP 总装配，不沉淀具体业务规则。

当前范围：

| 目录 | 责任 |
|---|---|
| `bootstrap/` | 本机 daemon 应用装配层。`foundation.ts` 只创建 DB、stores、LLM provider router、audit manager、graph executor 等基础依赖；`daemon.ts` 保留 daemon 生命周期外壳，`wiring/channel-wiring.ts` 只组织 channel、cron、spawner 与 system prompt cache 的启停清理顺序；`local-daemon-stack.ts` 只组织 foundation、channel、agent-run、task、cron、observability、HTTP 等依赖的创建和启停顺序；`channel-boot.ts` 专管通道 adapter 的本机实例化与可选通道启动失败收集；`local-daemon-tools.ts` 与 `local-daemon-http.ts` 分别收口生产工具清单和可选 HTTP server 装配。 |
| `http/` | HTTP 总装配层。`hono-server.ts` 负责挂载各 domain / route module、loopback CORS、Bearer 边界和 server start/stop；`__tests__/` 保留 Hono 级集成测试，验证 app HTTP 对 domain route 的挂载和安全边界；具体业务规则必须留在对应 domain route 或 service。 |
| `llm/` | linnkit LLM 技术适配层。`ai-engine.ts` 把 LLM domain 的 model registry / provider router 包装成 linnkit `AgentAiEngine`，并在 app 层接入 Agent-run fence registry，避免 LLM domain 反向依赖 Agent-run。 |
| `orchestration/` | 跨多个 domain 的用例编排。`turn-handler.ts` 负责单轮消息从入口到回复的顺序组织，具体授权、会话、通知、agent run、插话围栏等规则仍由对应 domain 或 runtime port 承担。 |

约束：

- 不在 `app/` 内新增业务判断、schema 或持久化实现。
- 需要业务规则时，先回到对应 domain 的 `functions/`、`orchestration/` 或 public contract。
- `app/orchestration/` 可以调用多个 domain 的 public port；仍直接依赖 feature 内部文件的旧路径，需要在后续迁移里继续收口成更窄的 public contract 或 port。
