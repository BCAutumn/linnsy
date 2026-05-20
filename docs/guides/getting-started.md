# 快速上手

> 本指南帮助你在本地运行 Linnsy daemon，并完成第一次对话。

---

## 前置条件

- Node.js 20 LTS+
- npm
- 一个 LLM provider 的 API key（推荐 DeepSeek，兼容 OpenAI 协议）
- 可访问 npmjs 公开 registry（用于安装 @linnlabs/linnkit）

---

## 1. 安装依赖

进入 daemon 包目录安装依赖。daemon 通过 npmjs 公开包安装 @linnlabs/linnkit，仓库里的 .npmrc 会显式覆盖 @linnlabs scope 到 registry.npmjs.org，避免用户机器上遗留的 GitHub Packages 配置误命中旧包：

```bash
cd packages/linnsy-daemon
npm install
```

---

## 2. 创建最小配置文件

在 `~/.linnsy/config.yaml` 创建配置。以 DeepSeek 为例（其他 OpenAI 兼容 provider 同理，只需改 `base_url` 和 `api_key_env`）。

配置文件的完整示例 → `packages/linnsy-daemon/README.md` §Quickstart

必填字段：

- `llm.providers` 下至少配置一个 provider
- `llm.defaults.secretary`：主对话使用的模型
- `channels.cli.enabled: true`：启用 CLI 通道

---

## 3. 配置 API key

将 API key 设为环境变量，名称与 config.yaml 中 `api_key_env` 字段一致。

不要把 API key 写入 config.yaml 文件，不要提交进 git。

---

## 4. 体检

```bash
export DEEPSEEK_API_KEY=sk-...
npx tsx src/cli/index.ts doctor
```

`doctor` 命令会检查：数据库 / 配置文件 / 文件权限 / linnkit 装配 / model_profile。全部通过后进入下一步。

---

## 5. 启动对话

```bash
npx tsx src/cli/index.ts chat
```

进入交互式 CLI 对话。这是最小验证路径，不需要 IM 账号。

如需查看完整 LLM 请求日志（排查工具调用 / 流式事件）：

```bash
npx tsx src/cli/index.ts chat:audit
```

---

## 6. 打包运行（可选）

```bash
npm run build
./dist/cli.cjs doctor
./dist/cli.cjs chat
```

---

## 7. 接入 IM 通道

- 接入微信私聊 → [`wechat.md`](./wechat.md)
- 接入 Telegram → `packages/linnsy-daemon/README.md` §Telegram 通道
- 新增其他平台 → [`adding-platform.md`](./adding-platform.md)

---

## 8. 运行测试

```bash
npm run test           # 全量
npm run test:unit      # 单元测试
npm run test:e2e       # 端到端（含 mock LLM，RTT < 100ms）
npm run typecheck
npm run lint
npm run guard:boundary  # 防止 daemon 反向 deep-import linnkit 内部
```

Live LLM smoke 测试默认跳过，需要显式设置环境变量启用。完整说明 → `packages/linnsy-daemon/README.md` §测试

---

## 9. 桌面 app（Electron）

桌面 app 的开发与运行方式 → `packages/linnsy-daemon/electron/README.md`

开发期从仓库根目录启动：

```bash
npm run dev:electron
```

Codex 应用连接的产品手测也走这条路径：先在设置页“应用连接”里检测 Codex CLI 是否可用，再回到主对话给一个明确安全目录，让 Linnsy 派 Codex 修改临时文件。详细 smoke 清单见 `packages/linnsy-daemon/electron/README.md`。

---

## 相关文档

- daemon 全量配置参考 → `packages/linnsy-daemon/README.md`
