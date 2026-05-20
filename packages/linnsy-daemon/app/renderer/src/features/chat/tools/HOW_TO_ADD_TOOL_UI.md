# 如何新增工具卡 UI

> 这份 cookbook 只讲对话流里的工具卡呈现。它不新增工具协议、不新增任务面板，也不让前端猜工具语义。
>
> 产品边界：工具进度仍然织入主对话流。主人看到的是 Linnsy 在当前对话里汇报进展，而不是跳到另一个 dashboard。

## 先判断需不需要自定义

默认工具卡已经覆盖通用生命周期：

| 阶段 | 数据来源 | 默认呈现 |
|---|---|---|
| 开始 | tool_call.start | 折叠 header，显示工具名和 running |
| 过程 | tool_call.progress | 展开后显示进度列表 |
| 成功 | tool_call.result | 展开后显示 data / observation |
| 失败 / 拦截 | tool_call.result | 展开后显示 error / errorKind |

只有满足下面任一条件，才建议写自定义卡：

| 触发条件 | 例子 | 该怎么做 |
|---|---|---|
| 工具有专属结构 | 文件列表、日历候选、审批选项 | 写 CardComponent |
| 需要开始后立即可见 | 长任务进度、外部 agent 运行状态 | 读 progressChunks，并在折叠态也显示关键信息 |
| data 需要专属呈现 | 表格、对比列表、步骤状态 | 写 CardComponent，仍保留展开控制 |
| 只想换视觉密度 | 更宽、更轻、隐藏背景 | 只配 layout，不写组件 |

如果只是展示入参、结构化 data 和 observation，继续用默认卡。默认卡是兜底正路，不是半成品。本次协议改造不要求给每个工具立刻补专属 UI；后续按 toolName 一个一个注册。

## 三步新增

### 1. 新建工具配置文件

位置：packages/linnsy-daemon/app/renderer/src/features/chat/tools/configs/

文件命名用 daemon 发出的 toolName。比如 toolName 是 delegate_to_internal，就建 delegate_to_internal.tsx。

配置对象使用 ToolUiConfig。它可以只写 layout，也可以提供 CardComponent。

| 字段 | 用途 | 注意 |
|---|---|---|
| layout.hideBorder | 隐藏外框 | 适合轻提示 |
| layout.hideBackground | 隐藏背景 | 适合融入消息流 |
| layout.noPadding | 内容区自己控制 padding | 只在自定义卡需要时用 |
| layout.fullWidth | 占满消息列表宽度 | 适合表格、代码、横向对比 |
| layout.hideContent | 完全不渲染内容区 | 极简状态打点，慎用 |
| CardComponent | 完全自定义卡片 | 必须接 ToolCardProps |

CardComponent 的边界：

| 可以做 | 不可以做 |
|---|---|
| 读 item.status / item.args / item.progressChunks / item.data / item.observation / item.error | 根据 observation 正则猜工具阶段 |
| 使用 expanded / onToggle 做展开折叠 | 自己再维护第二套展开状态 |
| 使用 locale 和 i18n 文案 | 硬编码用户可见中文 / 英文 |
| 用现有 token 和 chat-items.css 类名 | 写内联样式或硬编码颜色 |
| 渲染按钮的本地 pending 状态 | 直接改 item / projection / metadata |

### 2. 注册到聚合入口

位置：packages/linnsy-daemon/app/renderer/src/features/chat/tools/configs/index.ts

在 configEntries 里追加一项。key 必须和 RuntimeEvent 里的 toolName 完全一致。

不要修改这些主路径文件：

| 文件 | 为什么不能动 |
|---|---|
| packages/linnsy-daemon/app/renderer/src/features/chat/items/ToolCallCard.tsx | 它只负责查 registry 和持有展开状态 |
| packages/linnsy-daemon/app/renderer/src/features/chat/tools/registry.ts | 它只负责 toolName 到配置的纯映射 |
| packages/linnsy-daemon/app/renderer/src/features/chat/items/Message.tsx | 它只负责按 ConversationItem kind 分发 |
| packages/linnsy-daemon/app/renderer/src/features/chat/projection/projectors/ | UI 不应该改事实投影 |

### 3. 补文案和测试

用户可见文案放在：

| 语言 | 文件 |
|---|---|
| 中文 | packages/linnsy-daemon/app/renderer/src/lib/i18n/zh-CN.ts |
| English | packages/linnsy-daemon/app/renderer/src/lib/i18n/en-US.ts |

测试至少补一类：

| 改动类型 | 推荐测试 |
|---|---|
| 只加 layout config | tools/__tests__/registry.test.ts 或新增配置单测 |
| 加 CardComponent | items/__tests__/Message.test.tsx，断言关键 DOM 和 i18n |
| 依赖 progressChunks | projection 里先确保 tool_call.progress 投影正确，再测卡片呈现 |
| 有按钮交互 | 测按钮 disabled / loading / 回调，不测内部 daemon 行为 |

## 三种常见样式

### 纯展示型工具

适用：工具 data 就是简短事实，主人偶尔展开看详情。

建议：

| 项 | 选择 |
|---|---|
| CardComponent | 不写，先用 DefaultToolCard |
| layout | 可选 hideBackground 或 hideBorder |
| 展开策略 | 沿用默认折叠 |
| 文案 | 只补工具专属标题 / 字段标签 |

判断标准：如果删除自定义卡后，主人仍然能看懂这次工具做了什么，就不要自定义。

### 长任务进度型工具

适用：delegate_to_internal、delegate_to_external、网页抓取、批处理整理。

建议：

| 项 | 选择 |
|---|---|
| CardComponent | 写 |
| 数据 | 以 item.progressChunks 为主，data 为最终事实，observation 只作 AI 摘要 |
| running 态 | 可以在折叠 header 下方显示最近一条 progress |
| success 态 | 显示最终状态 + 可展开完整过程 |
| fullWidth | 只有需要横向信息时再打开 |

注意：progressChunks 是 daemon 翻译 linnkit 过程事件后的事实流。卡片只读这些事实，不从 observation 文本里再解析过程。

### 主人审批型工具

适用：写记忆、改人格、发送高风险消息、删除长期内容。

建议：

| 项 | 选择 |
|---|---|
| CardComponent | 写 |
| status | blocked 表示策略已拦截；running 可表示等待主人选择 |
| 按钮 | 明确展示允许 / 修改 / 跳过等动作 |
| 事实记录 | 主人的选择必须回到 daemon，成为新的事件或消息 |
| 本地状态 | 只用于按钮 pending，不作为最终事实 |

重要原则：审批 UI 不能直接改 projection。前端按钮只是把主人选择送回 daemon；真正的结果由 daemon 再推事件回到对话流。

具体协议见 INTERACTIVE_TOOL_PROTOCOL.md。现在新增审批型卡片时，只能写到“按协议发送动作”的边界，不要在前端私自决定工具成功或失败。

## 样式约束

| 规则 | 原因 |
|---|---|
| 样式追加到 styles/chat-items.css | 工具卡属于对话 item 样式域 |
| 类名前缀使用工具名或 tool-card 子块 | 避免污染其它气泡 |
| 使用 tokens.css 里的颜色 / radius / shadow | 保持主题可切换 |
| 折叠态尽量轻 | 工具卡是观察信息，不抢主回答焦点 |
| 不嵌套大卡片 | 对话流已经是容器，不再套 dashboard |
| 文本要能换行 | 工具名、文件名、URL、错误信息都可能很长 |

## 最后自检

提交前逐条确认：

| 问题 | 合格答案 |
|---|---|
| 不注册这个工具时会怎样？ | 仍走 DefaultToolCard，展示 data/observation，不崩 |
| 自定义卡是否只读 projection？ | 是 |
| toolName 是否和 daemon 事件完全一致？ | 是 |
| 用户可见文字是否走 i18n？ | 是 |
| 是否新增了主路径分支？ | 没有 |
| 是否能解释“调用开始就渲染”还是“调用结束后渲染”？ | 能，由工具语义决定 |
| 是否需要更新工具协议？ | 如需要，先做 daemon / shared runtime event，再做 UI |
