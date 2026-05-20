# 微信接入指南

> **适用人群**：你已经能在这台机器上正常运行 `npx tsx src/cli/index.ts chat`，Linnsy 已经能和你对话。
>
> 本指南只做一件事：在现有能跑的 Linnsy 上，**补一个微信私聊入口**。不重配 LLM。

---

## 1. 前提确认

先确认 CLI 对话能正常跑，再来接微信。如果 CLI 还跑不通，先看 [`getting-started.md`](./getting-started.md)。

---

## 2. 当前支持范围

| 支持 | 不支持 |
|---|---|
| 个人微信私聊 | 群聊 |
| 单微信账号 | 多账号 |
| 腾讯 ilink AI 接入平台扫码通道 | hook / 灰色方案 |

**重要**：Linnsy 的主体是这台机器上的 daemon 实例，不是某个微信号。换微信号不会重置记忆。

---

## 3. 补充配置

在现有 `~/.linnsy/config.yaml` 的 `channels` 下加入 `wechat` 段（不要删除已有的 `cli` / `telegram` 等）：

在 config.yaml 的 channels 下加入以下字段（字段含义见下表）：

| 字段 | 含义 |
|---|---|
| `enabled: true` | 启用微信通道 |
| `gateway_bind` | 本地微信 gateway 监听地址（推荐 `127.0.0.1:7788`）|
| `gateway_base_url` | daemon 访问 gateway 的地址 |
| `bearer_env` | 本地 gateway 和 daemon 之间通信用的 bearer token 的环境变量名 |
| `poll_interval_ms` | daemon 轮询 gateway 的间隔（推荐 1500ms）|

完整 config 示例（包含 wechat 段）→ `packages/linnsy-daemon/README.md` §Quickstart

---

## 4. 设置环境变量

除了已有的 LLM API key 外，再补一个本地 gateway bearer token：

```bash
export LINNSY_WECHAT_GATEWAY_BEARER=<你自己生成的一串本地密钥>
```

这个 token 只在本机 daemon 和本机 wechat-gateway 之间使用，不是微信官方 token。生成方式：用任意随机字符串生成器生成 32+ 位随机字符串即可。

---

## 5. 启动方式

**方式 A：桌面 app（推荐）**

进入设置 → 终端连接 → 点击「连接微信」。桌面端会自动启动 wechat-gateway，并让 daemon 接入微信通道。勾选「启动时自动连接微信」后，之后每次打开桌面 app 会自动完成。

**方式 B：命令行（两个终端）**

终端 A — 启动微信 gateway：

```bash
cd packages/linnsy-daemon
npx tsx src/cli/index.ts wechat-gateway
```

终端 B — 启动 Linnsy 主进程：

```bash
npx tsx src/cli/index.ts chat
```

---

## 6. 首次扫码

wechat-gateway 首次启动时（或账号未保存时）：

1. 终端会打印二维码和 QR URL
2. 用微信扫码确认
3. 账号保存到 `${LINNSY_HOME}/wechat-gateway/account.json`
4. 之后启动自动复用，不再每次扫码

如果终端二维码显示不正常，使用桌面 app 的「连接微信」入口会显示可扫描的图形二维码。

---

## 7. 验证连接

最靠谱的验证方式：

1. 用微信号 A 扫码，把 Linnsy 接到 A
2. 用另一个微信号 B 给 A 发私聊
3. 看 Linnsy 是否在 A 号里回复

**注意**：用 A 给 A 自己发消息，当前不会触发回复（自己发给自己的消息会被过滤）。

---

## 8. 配对授权

接入后，直接发消息默认走 `global_all` 授权（dev 配置）。生产环境建议关闭 `global_all`，使用 8 位配对码授权：

1. daemon 侧调用 `AuthorizationPort.generatePairingCode({ platform: 'wechat' })` 生成 8 位码
2. 在微信给 Linnsy 发 `/pair XXXXXXXX`
3. daemon 写入 `pairings.consumed_at`，该会话永久授权

---

## 9. 切换微信账号

在桌面设置 → 终端连接 → 「删除当前微信登录态并重新绑定」。这只是换 Linnsy 躺在哪个微信列表里，不会重置 Linnsy 的记忆和对话历史。

---

## 10. 相关文档

- 快速上手（先跑通 CLI）→ [`getting-started.md`](./getting-started.md)
- 新增其他 IM 平台 → [`adding-platform.md`](./adding-platform.md)
- daemon 架构（通道授权链详解）→ `packages/linnsy-daemon/src/README.md`
