# Desktop integration domain

> 桌面壳、远程手机终端和 daemon 后端之间的集成边界。

## 目录

| 路径 | 职责 |
|---|---|
| `definitions/` | 桌面通道 IPC 状态、daemon sidecar 状态、应用连接快照、启动期 UI hint 等 Desktop integration 对外契约 |
| `features/terminal-binding/` | 固定 mobile 终端绑定：默认绑定桌面主窗口、切换绑定 conversation、把手机 IM 入站映射到当前绑定会话 |
| `features/application-connections/http/` | 设置页应用连接状态 REST 薄入口：读取 Codex 连接状态并返回未来应用的 unsupported 占位，不启动真实任务 |
| `features/ui-preferences/http/` | 桌面 UI 偏好 REST 薄入口：读取、保存、重置 renderer 偏好，不承载业务状态 |
| `persistence/terminal-binding/` | `terminal_bindings` 表 SQLite store、store port 与直接单测 |
| `persistence/ui-preferences/` | `ui_preferences` 表 SQLite store、schema registry、store port 与直接单测 |

## 边界

Desktop integration 只表达“桌面/手机终端如何接到同一个秘书”的集成规则，不处理 Channel adapter 的平台协议，也不处理 Cron 调度规则。Cron、Conversation、Channel 需要手机终端绑定时，只依赖这里暴露的窄口。应用连接状态只通过注入的 `probe()` 窄口读取外部工具可用性，避免 Desktop integration 直接依赖 Task domain 的 Codex 执行实现。UI preferences route 只依赖 `get/getAll/set/reset` 窄口，schema 注册和 SQLite 落盘留在当前 domain 的 persistence 内，避免设置入口反向知道持久化初始化细节。
