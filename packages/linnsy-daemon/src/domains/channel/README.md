# Channel domain

Channel domain 负责 Linnsy 与外部平台之间的入口 / 出口通道边界。

## 当前结构

| 路径 | 职责 | 边界 |
|---|---|---|
| `definitions/` | 定义 `ChannelAdapterPort`、`InboundHandler`、健康检查和发送结果契约 | 不实现具体平台连接 |
| `features/authorization/` | 入站消息 5 层授权链、配对码生成与消费、Phase 1 stub guard | 只判断消息是否允许进入，不决定 conversation，不启动 run，不发送回复 |
| `features/registry/` | 管理已启用 adapter 的注册、查找和只读快照 | 不知道 CLI / Telegram / WeChat / Desktop 的平台细节，不处理会话归属 |
| `features/cli/` | CLI stdin/stdout 行式文本入口与出站渲染 | 不判断授权，不决定 conversation，不管理 daemon 生命周期 |
| `features/desktop/` | 桌面 renderer 入站 payload 归一、HTTP 薄入口、Desktop adapter 与 message bus | 不处理 Electron IPC 契约，不判断授权，不决定 conversation，不管理 daemon 生命周期 |
| `features/telegram/` | Telegram grammY long-polling 文本入口、Telegram context 归一、`sendMessage` 出站和 healthcheck | 不判断授权，不决定 conversation，不管理 daemon 生命周期 |
| `features/wechat/` | WeChat daemon adapter、本机 gateway sidecar、二维码登录、`context_token` 持久化、deferred 队列、gateway status、pidfile inspector 与 WeChat bot API client | 不判断授权，不决定 conversation，不处理桌面 IPC 契约 |

## 迁移说明

阶段 5.5 迁移公共 contract 与 registry，阶段 5.6 迁移 CLI adapter，阶段 5.7 迁移 Desktop adapter 与 message bus，阶段 5.8 迁移 Telegram adapter，阶段 5.9 迁移 WeChat daemon adapter，阶段 5.10 迁移 WeChat gateway sidecar。阶段 8.6 已把桌面消息 HTTP 入口迁入 `features/desktop/http/`；阶段 8.8 已把入站授权链从 `runtime/auth/` 迁入 `features/authorization/`；阶段 8.9 已把本机 channel boot isolation 迁入 `app/bootstrap/channel-boot.ts`。Channel 平台能力完整归入本 domain；后续如继续拆分，应在具体 feature 内按 definitions / functions / orchestration 细化，禁止重新新增 `runtime/`。
