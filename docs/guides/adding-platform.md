# 新增 IM 平台

> 本指南说明如何为 Linnsy 添加新的 IM 通道适配器，同时不把平台细节泄露进 daemon 内部。
>
> Port 接口定义 → `packages/linnsy-daemon/src/domains/channel/definitions/types.ts`

---

## 1. 接口契约（ChannelAdapterPort）

每个平台都必须实现 `ChannelAdapterPort`：

| 方法 / 属性 | 要求 |
|---|---|
| `platform` | 稳定字符串，与 `LinnsyMessage.platform` 一致 |
| `start(handler)` | 注册一个 inbound handler，打开平台连接。Phase 1 Telegram 用 grammY long-polling |
| `stop()` | 关闭连接，等待 in-flight 工作完成 |
| `send(target, payload)` | 发送出站消息，有平台稳定 ID 时返回 `providerMessageId`；延迟投递时返回 `delivery: 'deferred'` |
| `healthcheck()` | 连通性失败时返回 `{ ok: false, detail }`，不抛异常 |

**出站 delivery 三类**：

| delivery | 含义 |
|---|---|
| `sent` | 平台已接受出站 payload |
| `deferred` | 平台无法立刻发送，适配器已诚实排队 |
| `failed` | 适配器确认出站路径失败 |

---

## 2. 入站消息归一化（LinnsyMessage）

适配器负责把平台原生事件转换为 `LinnsyMessage`：

| 字段 | 说明 |
|---|---|
| `messageId` | 本 daemon 事件的本地唯一 ID |
| `platform` | 适配器平台名（如 `telegram`）|
| `chatType` | 归一化为 `private` / `group` / `channel` |
| `chatId` | 平台 chat ID 的字符串形式 |
| `userId` | 发送者 ID（可选）|
| `providerMessageId` | 幂等去重用的稳定 ID（Telegram 示例：`${chatId}:${messageId}`）|
| `text` | 归一化文本内容 |
| `metadata` | 小量平台元数据（如 Telegram `updateId` / chat 标题），不放 secret |

---

## 3. 授权边界

**不要在适配器里做授权决策。** 所有 inbound 消息必须流过 `AuthorizationGuard`。

适配器只做透传，包括 `/pair CODE` 命令——当作普通文本传入即可。

5 层授权链（在 Channel authorization feature 处理）：

1. per-platform allow-all
2. per-platform allowlist
3. consumed pairing grant
4. global allow-all
5. default deny

---

## 4. 幂等性要求

平台消息可能被重发或重放时，适配器必须设置 `providerMessageId`。daemon 以 `(platform, provider_message_id)` 为唯一键持久化 inbound 消息，在 spawning run 前去重。

**测试要求**：发送相同原生消息两次，断言只 spawn 一个 run。

---

## 5. 文件放置规范

| 内容 | 路径 |
|---|---|
| channel adapter | `src/domains/channel/features/{platform}/{platform}-channel-adapter.ts` |
| adapter 测试 | `src/domains/channel/features/{platform}/__tests__/{platform}-channel-adapter.test.ts` |
| 平台专用 fake client | 与 adapter 同目录（除非被多平台共享）|

> 迁移期说明：Channel 的公共契约、registry、CLI adapter、Desktop adapter、Telegram adapter、WeChat daemon adapter 和 WeChat gateway sidecar 均已进入 `src/domains/channel/`；新增平台应直接落到目标 feature。

有 Electron 桌面端控制需求的平台（如微信），还需要：

| 内容 | 路径 |
|---|---|
| 桌面控制器 | `electron/channels/{platform}/` |

---

## 6. 桌面控制器（需要 Electron 侧管理的平台）

如果平台需要 Electron 侧的生命周期控制（如微信 gateway 进程管理、二维码登录），需在 `electron/channels/{platform}/` 实现 `ChannelDesktopController`。

**要求**：

- 实现 `ChannelDesktopController` 接口
- 在 `ChannelDesktopRegistry` 中注册
- 状态只通过 `ChannelDesktopStatus` 契约暴露
- 只使用 IPC 名：`linnsy:channels:list` / `get` / `invoke` / `status-changed`；不添加平台专用 IPC 名
- sidecar 进程管理 / 登录提示 / 自动连接偏好都放在控制器内
- **网络恢复 vs 账号重置分开**：`reconnect-network` 用于 sidecar/网络恢复；`delete-account` 用于切换登录的平台账号
- **在 `electron/shutdown.ts` 中注册 sidecar 关闭逻辑**，不要在控制器内单独监听 `app.on('before-quit')`
- 启动后写 pidfile 到 `{config.home}/{platform}-gateway/gateway.pid`；正常停止时删除
- 检测到现有 pidfile 时，**不自动 kill**，只记录警告，让用户决定（避免破坏开发者在独立终端启动 gateway 的工作流）

---

## 7. 微信参考（Phase 1 约束平台示例）

微信是有约束平台的参考实现，关键设计决策：

- daemon adapter 保持轻量，只与 localhost gateway 通信
- daemon adapter 实现位于 `src/domains/channel/features/wechat/wechat-channel-adapter.ts`
- gateway sidecar 位于 `src/domains/channel/features/wechat/gateway/`
- gateway 自己持有 Tencent ilink AI 二维码登录、`context_token`、出站队列
- 二维码渲染由用户触发：桌面 app 调用 channel `request-qr-code` action
- 渲染器通过 `/v1/status` 读取二维码 URL，不从 stdout 读
- 平台级账号/会话删除是运行时数据操作（清除 token / 队列），不是进程重启标志
- 长轮询适配器不允许 poll cycle 重叠
- `/v1/health`（liveness）和 `/v1/status`（真实上游状态）分开；等待登录期间 `/v1/status` 也必须可用

微信完整接入指南 → [`wechat.md`](./wechat.md)

---

## 8. Telegram 参考（Phase 1 标准平台示例）

- 实现：`src/domains/channel/features/telegram/telegram-channel-adapter.ts`
- SDK：grammY
- 传输：long-polling（webhook 推 Phase 2）
- 幂等 key：`${chatId}:${messageId}`

---

## 9. 测试清单

新增平台前，先写以下测试：

- 适配器在注入 fake platform client 时能启动，不触碰真实网络
- 原生私聊消息映射为正确的 `LinnsyMessage`
- 原生群组/频道消息映射为正确的 `chatType`
- `send()` 调用原生 API 并返回 provider message id
- `start()` 前调用 `send()` 抛出 `LINNSY_CHANNEL_NOT_STARTED`
- 真实 token 不进 commit；live smoke 通过环境变量 opt-in

---

## 相关文档

- daemon 架构（ChannelAdapter 在架构图中的位置）→ `packages/linnsy-daemon/src/README.md`
- 微信快速接入 → [`wechat.md`](./wechat.md)
