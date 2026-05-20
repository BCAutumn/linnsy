# electron/

> Electron 主进程（main）、预加载脚本（preload）、IPC 契约，以及各 IM 平台的桌面控制器。
>
> 开发启动 → 仓库根目录 `npm run dev:electron`

---

## 进程模型

```
┌─────────────────────────────────────────┐
│  Electron main（Node.js）               │
│  ├── TrayManager（托盘菜单 + 窗口控制）   │
│  ├── DaemonSpawner（sidecar 管理）        │
│  ├── ChannelDesktopRegistry（通道控制器）│
│  │     └── WechatDesktopController       │
│  ├── AutoStart（launchd / 注册表）        │
│  └── ShutdownCoordinator（优雅退出）      │
└──────────────┬──────────────────────────┘
               │ preload.ts（contextBridge）
               │ IPC（ipc-contract.ts）
┌──────────────▼──────────────────────────┐
│  Renderer（Vite + React，独立 origin）   │
│  → 通过 IPC 与 main 通信                 │
│  → 通过 REST + WS 与 daemon 通信         │
└─────────────────────────────────────────┘
               │ REST + WS（Bearer 保护）
┌──────────────▼──────────────────────────┐
│  Daemon sidecar（Node.js，独立进程）      │
│  src/cli/index.ts daemon 模式            │
└─────────────────────────────────────────┘
```

三个进程通过两条通道通信：
- **main ↔ renderer**：Electron IPC（`contextBridge` 暴露的 `window.linnsy` API）
- **renderer ↔ daemon**：HTTP REST + WebSocket（localhost Bearer 保护）

---

## 文件清单

| 文件 | 职责 |
|---|---|
| `main.ts` | Electron 入口，窗口创建，IPC 注册，bootstrap |
| `preload.ts` | contextBridge 暴露 `window.linnsy`（不暴露 Node.js 原生模块）|
| `ipc-contract.ts` | IPC channel 名称与类型定义（renderer/main 共享的类型契约）|
| `ipc-handlers.ts` | main 进程侧 IPC handler 注册（实现 ipc-contract 中的操作）|
| `dev.ts` | 开发模式入口（Vite renderer + hot reload）|
| `autostart.ts` | 系统自启动（macOS launchd plist / Windows 注册表）|
| `daemon-spawner.ts` | sidecar daemon 进程的启动、停止、重启与状态广播；`stop()` 未完成前 `start()` 不会拉起第二个 sidecar，避免新旧 daemon 短暂双开；健康检查由 renderer ↔ daemon 的 REST/WS 链路承担 |
| `desktop-preferences.ts` | 本机持久化偏好（`userData/desktop-preferences.json`，非 SQLite）|
| `shutdown.ts` | ShutdownCoordinator（统一优雅退出，5s ceiling，幂等）|
| `tray.ts` | 托盘图标 + 菜单 |
| `local-bearer-tokens.ts` | 本机 Bearer token 解析与注入（daemon + sidecar 共享）|
| `ui-hint-store.ts` | UI hint 状态（如"需要刷新配置"提示）|
| `channels/wechat/` | WechatDesktopController（微信 gateway 生命周期管理）|

## Preload 打包边界

Electron 33 默认 sandbox preload，运行时只允许安全白名单 require。`preload.ts` 可以复用 `ipc-contract.ts` 和 Desktop integration contract 做 zod parse，但构建时必须把这些运行时依赖 bundle 进 `dist-electron/preload.cjs`，只保留 `electron` 作为外部依赖。`__tests__/electron/preload-bundle.spec.ts` 会构建 preload 并扫描裸 `require()`，避免再次出现 sandbox 里 `module not found: zod` 导致 `contextBridge` 整段失效。

## 开发端口

`dev.ts` 默认优先使用 `127.0.0.1:5173` 作为 renderer Vite 端口。启动器会先读取该地址的 HTML，并检查 Linnsy renderer 标记：

- 如果已经是 Linnsy renderer，就复用现有 Vite server。
- 如果端口被别的项目占用，会自动顺延到下一个空闲端口并把真实 URL 传给 Electron。
- 如果显式设置了 `LINNSY_RENDERER_URL`，但该地址不是 Linnsy renderer，会直接报错，避免把其它 app 装进 Linnsy Electron 壳。

## Codex 连接手测

桌面开发期的真实产品路径是从仓库根目录启动：

```bash
npm run dev:electron
```

建议每次手测都先准备一个安全临时目录，避免真实项目被 smoke prompt 误改：

```bash
SMOKE_DIR="$(mktemp -d)/linnsy-codex-smoke"
mkdir -p "$SMOKE_DIR"
printf 'before\n' > "$SMOKE_DIR/smoke.txt"
echo "$SMOKE_DIR"
```

手测步骤：

1. 启动 Electron 后，先在设置页确认模型 API key 已保存且主对话模型可用。
2. 进入“应用连接”，点击“连接 Codex”。期望 Codex 卡片显示本机 CLI 可用；Claude Code / Cursor 仍显示暂未支持。
3. 回到主对话，发送一条带明确目录的请求：

```text
请让 Codex 在 <上一步输出的 SMOKE_DIR> 做一个小测试：只修改 smoke.txt，把完整内容改成 linnsy dev electron codex ok，然后简短汇报。
```

4. Linnsy 应该把任务派给 Codex，并在完成后用对话文字回报。
5. 在终端确认文件内容：

```bash
cat "$SMOKE_DIR/smoke.txt"
```

期望输出：

```text
linnsy dev electron codex ok
```

这条手测是产品验收路径；自动化回归仍走 daemon Vitest 中默认跳过的真实主模型 dogfood 和真实 Codex smoke。

---

## IPC 契约规范

所有 IPC 名称定义在 `ipc-contract.ts`，**不在 main 或 renderer 内硬编码字符串**。`ipc-contract.ts` 同时提供 preload 使用的返回值 schema；`preload.ts` 对每个 `ipcRenderer.invoke` 返回值和 status push payload 做运行时 parse，失败时拒绝 Promise 或忽略脏事件，不把不可信 IPC 数据直接写进 renderer 状态。

标准通道名格式：`linnsy:{domain}:{action}`，例如：

- `linnsy:channels:list` / `linnsy:channels:get` / `linnsy:channels:invoke` / `linnsy:channels:status-changed`
- `linnsy:daemon-status` / `linnsy:daemon:status-changed`
- `linnsy:codex-session:open`
- `linnsy:app-quit`

**不允许**为单个平台添加专用 IPC 通道名，所有平台通过 `linnsy:channels:invoke` + action 参数实现。

例外：Codex session 可见接管属于桌面应用能力，不是 IM channel，因此使用独立 `linnsy:codex-session:open`。renderer 只传 `sessionId` 和可选 `cwd`，main 在新终端中执行 `codex resume --include-non-interactive <sessionId>`；daemon 不负责弹 GUI 窗口。

---

## Local Bearer Token 机制

本机进程间通信（renderer → daemon，daemon → wechat-gateway）使用 Bearer token 安全边界。

`main.ts` 启动时调用 `resolveLocalBearerTokens()`，自动解析或生成 token 并注入 daemon 和 sidecar。**开发者不需要手动 export 任何 `LINNSY_*_BEARER`**。

需要外部覆盖时（如在独立终端启动 gateway），在 shell 里 export 同名变量，main 会优先采用 env 值。

实现 → `local-bearer-tokens.ts`

---

## ShutdownCoordinator

统一管理应用退出（⌘Q / dock / `window-all-closed` / IPC `linnsy:app-quit`），幂等，5 秒 ceiling。

每个 sidecar 控制器必须在 `main.ts` bootstrap 时向 `shutdown.ts` 注册关闭回调，**不允许**在控制器内单独监听 `app.on('before-quit')`。

实现 → `shutdown.ts`

---

## 通道控制器（ChannelDesktopController）

需要 Electron 侧管理的 IM 平台（如微信）需要实现 `ChannelDesktopController`，在 `ChannelDesktopRegistry` 中注册。

**状态生命周期**：`idle → starting → awaiting_login → connected → degraded`

renderer 通过以下流程获取通道状态：
1. `linnsy:channels:list` hydrate（初始加载）
2. 订阅 `linnsy:channels:status-changed` 事件（实时更新）

**账号操作分类**：
- `reconnect-network`：sidecar / 网络恢复（不重置账号）
- `delete-account`：切换登录账号（清除 token / 队列 / 登录态，返回新二维码）

账号操作会开启短暂 stale-connected 保护窗，挡住 gateway 旧连接状态回灌。`reconnect-network` 必须在操作结束时关闭保护窗；`delete-account` 真正执行后保留 3 秒自然过期保护窗，未执行删除的 early return 必须关闭保护窗。

微信控制器实现 → `channels/wechat/`

---

## CORS 边界

renderer（`127.0.0.1:5173`）与 daemon（`127.0.0.1:7700`）端口不同 = 跨源，production Electron `file://` 也是跨源。Hono server 必须放行 loopback origin（含 `Origin: null`），否则预检请求会被浏览器拦截。

---

## 自启动

| 平台 | 机制 |
|---|---|
| macOS | launchd plist（`~/Library/LaunchAgents/`）|
| Windows | `app.setLoginItemSettings()`（HKCU 注册表）—— 不引入 Windows Service wrapper |
| Linux | 不适用（Linux 走 headless daemon + systemd，不做 Electron 包）|

实现 → `autostart.ts`

---

## 相关文档

- renderer 前端架构 → [`../app/renderer/README.md`](../app/renderer/README.md)
- daemon 整体架构 → [`../src/README.md`](../src/README.md)
- 新增 IM 平台（含桌面控制器规范）→ [`../../../docs/guides/adding-platform.md`](../../../docs/guides/adding-platform.md)
