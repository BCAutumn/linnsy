# src/styles

> Linnsy 前端 CSS token 系统。所有颜色、间距、字号、圆角都在这里定义，业务代码一律消费 token。

---

## 文件清单

| 文件 | 内容 |
|---|---|
| `tokens.css` | 所有 CSS 变量定义（基础 token：颜色 / 间距 / 字号 / 圆角 / 投影）|
| `themes.css` | 15 个主题色 + 亮色/暗色模式的 token 绑定 |
| `base.css` | 全局基础样式（reset + body + 字体渲染 + 滚动条）|

---

## 核心原则

**业务 CSS 一律消费 token，禁止现场写 `#hex` / `rgba(...)`**（组件局部 scope 的临时变量除外，例如 range input 的 thumb 阴影等难以用 token 表达的一次性值）。

修改视觉效果的正确路径：先改本文档 → 再改 `tokens.css` / `themes.css` → 业务 CSS 自动生效。

全局字体渲染统一在 `base.css` 的 `html` 上收敛：macOS / Chromium 使用灰阶抗锯齿，避免中小字号中文在桌面端看起来偏粗、偏糊。业务 CSS 不单独覆盖字体平滑策略。

---

## Token 命名规范

| 前缀 | 用途 | 示例 |
|---|---|---|
| `--color-*` | 颜色（背景 / 文字 / 边框 / 主色调）| `--color-bg` / `--color-text` / `--color-primary` |
| `--spacing-*` | 间距（padding / margin / gap）| `--spacing-sm` / `--spacing-md` |
| `--font-size-*` | 字号 | `--font-size-sm` / `--font-size-base` |
| `--radius-*` | 圆角 | `--radius-sm` / `--radius-card` |
| `--shadow-*` | 投影 | `--shadow-window` / `--shadow-card` |

---

## 主题系统

支持 **15 个主题色**（传统色系，如藤紫、东方既白、朱砂红等），分为亮色（light）和暗色（dark）两套模式，以及"跟随系统"选项。

主题色存储在 SQLite `ui_preferences` 表中 `theme_color` 和 `color_mode` 字段，通过 daemon REST 读写。设置页"外观" tab 可实时切换，写入 `ui_preferences` 后即时生效。

**早期主题注入**：`lib/early-theme.ts` 在 React hydration 前读取本地偏好并注入 `<html>` 类名，避免 FOUC（首次渲染闪烁）。

---

## 布局骨架参数

| 参数 | 值 |
|---|---|
| 窗口最小宽度 | `900px` |
| 侧边栏默认宽度 | `260px`（可拖，范围 `200–360px`）|
| Titlebar / Topbar 高度 | `38px` |
| 窗口圆角 | `12px` |

Electron `BrowserWindow` 必须同步设置 `minWidth: 900`，CSS 的 `min-width` 只负责渲染骨架，不能单独阻止用户把真实桌面窗口拖得更窄。

侧边栏宽度是 layout 级变量：`AppShell` 写入 `.linnsy-window` 的 `--sidebar-width`，`base.css` 用它声明 `grid-template-columns: minmax(0, var(--sidebar-width)) minmax(0, 1fr)`。不要只给 `.linnsy-sidebar` 写宽度，也不要在响应式断点里改写 `.linnsy-window` 的列定义，否则极窄状态下主区不会稳定按剩余空间重排，容易出现对话内容覆盖侧栏。

## 侧边栏 action/menu

对话行的 hover more 按钮样式在 `sidebar.css` 内收敛：`.conv-item` 负责行容器与 `:focus-within`，`.conv-item-main` 负责选择区域，`.conv-more-btn` 默认透明、hover/focus/打开菜单时覆盖在右侧时间位置上显示，不为 more 额外预留一段宽度。more 按钮和时间替换必须即时发生，不做淡入淡出动画，避免鼠标扫过列表时有拖影。右侧 icon slot 只渲染一种状态：手机终端绑定对话显示 phone；普通置顶对话显示 pin。

对话行和侧边栏导航 hover 背景使用 `--color-surface-hover`，保持比 selected 更轻；more 按钮本体 hover / 打开态使用 `--color-primary-soft-hover`，比承载它的对话行 hover 更深一档，避免按钮被背景行吃掉层级。选中对话本身已经使用 `--color-primary-soft`，所以它的 more 按钮本体 hover / 打开态只能在同族软选中底色上继续加深，不能直接切到 `--color-primary` 这种强调色；文字颜色也继续使用普通前景色。more 菜单项继续沿用通用 `custom-select` 的 hover 规则。

More 菜单复用 `custom-select.css` 的 portaled panel、进入动画、option 行和 danger 变体，不新增颜色变量；业务只追加 `.conv-more-menu` 的尺寸微调。菜单定位默认左对齐 more 按钮并向右展开，只有右侧 viewport 空间不足时才翻到按钮左侧。弹窗继续走 `AppDialog` / `TextField` / `ActionButtons` 现有样式。

AppDialog 统一承担全局弹窗的进入 / 退出动画，只做透明度渐入渐出，不做位移或缩放。关闭入口必须走组件提供的 requestClose，先给 closing 样式留出 160ms 离场时间，再通知业务层卸载；业务弹窗不单独写关闭动画。系统开启 reduced motion 时关闭 CSS 动画，但仍保留同一条关闭状态流，避免不同弹窗行为分叉。

重命名对话弹窗是短文本场景，使用 `.conversation-rename-dialog` 收窄默认 `AppDialog` 到 280px，并使用小号 `ActionButtons`；`AppDialog` footer 内的 `ActionButtons` 默认跨整行并右对齐，避免单个按钮组落进两列 grid 的左列。输入框仍复用通用 `TextField`，仅把该场景的 control 背景调到 `--color-bg-sunken`，避免在白色 dialog 里看起来像无边白底。`TextField` 的字段名是静态说明文字，不参与点击聚焦；输入框本体通过 `aria-label` 保留可访问名称。

紧凑型“icon + 文字”行统一使用 `16px` 行盒：侧边栏入口、tab、对话标题与 more 菜单项都不能继承全局正文 `1.55` 行高，否则 flex 居中会居中到文字行盒而不是字形视觉中心，看起来像图标比文字低 1px。Fluent mask 图标本体保持 `vertical-align: middle`，菜单图标槽与图标尺寸保持一致。

---

## macOS vs Windows 差异

| 区域 | macOS | Windows |
|---|---|---|
| 红黄绿三点 | 系统绘制，renderer 不自绘 | 隐藏，使用系统 titleBarOverlay |
| 最小化/关闭按钮 | 无 | Main Topbar 右侧，close hover = `#E5212F` |
| 拖拽区域 | Sidebar Titlebar + Main Topbar | Main Topbar（排除 win-controls）|

macOS / Windows 差异通过 Electron 注入的 `data-platform` 属性区分，CSS 通过 attribute selector 条件应用。

---

## 消息气泡视觉

| 气泡类型 | 视觉特征 |
|---|---|
| 主人消息（右） | 主题色背景 |
| Linnsy 回复（左） | `--color-surface` 背景，支持 Markdown |
| 系统事件（居中） | 浅灰色 / 低对比，字号较小 |
| 工具调用（折叠卡）| 边框卡片样式，可展开 |

---

## 相关文档

- renderer 整体架构 → [`../../README.md`](../../README.md)（上级 `app/renderer/README.md`）
