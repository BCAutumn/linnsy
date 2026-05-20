# Codex 适配器

> **本文件是 linnsy 接入 codex 这件事的产品决策总账**——所有"为什么这么做 / 不那么做 / 边界在哪"的判断都集中沉淀在这里。代码实现细节在源文件 `codex-exec-dispatcher.ts` / `codex-event-normalizer.ts` 里。
>
> 跨模块契约（任务状态机 / 工具集语义）见 `[../README.md](../README.md)`。

---

## 1. 这是什么 · 为什么有它

**codex 是 linnsy 生态里的众多外部 agent 之一**，目前最成熟、用户最顺手，所以被选作**第一个落地的真实外部 agent 适配器**——之前 daemon 里只有 `MockExternalAgentDispatcher`（S3）。

**linnsy 接 codex 的真正动机不是"接一个写代码的"**，而是：

> codex / claude code / cursor 这类外部 agent 都自带 MCP / 工具生态，可以做大量"非编码"的重活——查邮件、整理文件、跑分析脚本、改配置、自动化工作流……写代码只是其中一种。**linnsy = 董事长助理 / 任务管理秘书**，把这类需要"长手脚 + 工具生态"的活派出去，自己负责派单、监工、汇报。

未来 claude code、cursor 会按同样的目录模板加进来：`external-dispatch/<vendor>/`。三家可以**同时启用，主人也可以挑哪个用**——`definitionKey` 决定派给谁，主流程、工具集、任务状态机三家共用。

---

## 2. Phase 1 范围（这一轮做什么 / 不做什么）

> **2026-05-14 实施补充 / 2026-05-19 迁移 / 2026-05-20 历史接管补充**：P1 已新增 `CodexSessionBridge`、`/api/v1/codex/tasks/:taskId/session`、`/api/v1/codex/threads/recent`、`/api/v1/codex/projects` 和桌面 `delegate_to_external` Codex 工具卡。HTTP route 已迁入 `http/codex-session-routes.ts`，归 Task external-dispatch/Codex feature；历史 thread 当前只暴露索引和 `session_meta` 元数据，不读取正文。Codex 历史按 session 自带 `cwd` 绑定项目目录，Linnsy 只在主人选择某条历史后通过 `manage_external_session(action="attach")` 接管成 task，不自动导入全量历史。

### 2.1 做

- 真实 `CodexExecDispatcher`：以子进程方式调用 `codex exec --json`，替换 mock dispatcher 在 codex 这一支的角色
- `agents/delegate-to-codex/` definition 落地（声明 modelPolicy / availableTools / 派给 codex 的任务 prompt 模板）
- "继续对话"能力：通过 `manage_task(action="continue")` 触发 `codex exec resume <sessionId>`，用于约定式审批回路与主人补充输入
- "历史接管"能力：通过 `manage_external_session` 先按 Codex `cwd` 列项目或列指定项目 thread，再把主人选中的 session 接管成一个已完成的 Codex task，后续继续仍走 `manage_task(action="continue")`
- 事件归一化：codex NDJSON event → linnsy 内部任务状态变化 / 终态 `<system-event kind="task_status_change">` 唤醒

### 2.2 不做

- ❌ Codex App Server / SDK 长连接（Phase 2 触发条件：产品上确实需要中途审批 / 中途追加消息的细粒度协议事件）
- ❌ Codex Cloud / Codex Desktop Automations / 计算机使用能力
- ❌ 强制状态机审批（waiting_approval 状态、approval 卡片、permission callback）—— 见 §5 约定式审批
- ❌ Diff 渲染 / commit / 回滚 UI——diff 留在 codex 自己里，linnsy 只用文字描述（见 §6 秘书话术）
- ❌ 工作区子系统（list_workspaces / create_workspace / switch_workspace 都不做，详见 §7）

---

## 3. 接入策略（fire-and-forget + 可 resume）

### 3.1 transport 选 `codex exec --json`


| 维度              | `codex exec --json`（选用）                | `codex app-server`（暂不）                       |
| --------------- | -------------------------------------- | -------------------------------------------- |
| 实现复杂度           | 低，子进程 + 解 NDJSON                       | 高，要做 JSON-RPC 客户端 + 长连接生命周期                  |
| 跟 linnsy 对话流契合度 | 完美——派出去 → 等结果 → 回家汇报                   | 中途控制（steer / interrupt / inject_items）对话流用不上 |
| 中途取消            | 杀子进程                                   | turn/interrupt                               |
| 中途审批            | 不支持，转化为"完成时报告 + 主人确认 + 重派 / continue"  | 支持但 Phase 1 不需要                              |
| 失败可观测           | stdout / stderr / exit code 足够         | event stream 更细，过剩                           |
| Session resume  | ✅ 原生支持 `codex exec resume <sessionId>` | 同样支持                                         |


### 3.2 默认参数

新派活时执行：

```bash
codex exec \
  --cd <主对话 LLM 推断的 cwd> \
  --skip-git-repo-check \
  --sandbox workspace-write \
  --json \
  --output-last-message <task workspace>/codex-final.txt \
  "<任务 prompt 模板拼装结果>"
```

约束：

- `--sandbox` 硬编码 `workspace-write`，**不暴露给主人配置**——这是 linnsy 自己做的安全兜底（见 §5）
- `--cd` 必填，**不允许 codex 默认在 `$HOME` 下乱跑**。P0 之后 cwd 由 codex adapter 自己从 `task.locator.ref`（kind=`directory`）派生（见 §10），主流程层不再硬要求 cwd
- 主人要新产物且没有指定已有项目目录时，`delegate_to_external` 会先创建用户根目录下的 `Linnsy Work/<task-slug>/`，再把这个真实目录作为 `task.locator.ref` 交给 Codex。Codex 仍然只看到一个明确 cwd，不知道也不管理 Linnsy 的意图分类。
- `--skip-git-repo-check` 固定开启，和 vendor definition 的 `requiresGitRepo=false` 对齐；否则 Codex CLI 会在非 git / 非 trusted directory 下直接失败，连简单 smoke 都跑不起来
- `--json` 强制开启 NDJSON 事件流，过 `codex-event-normalizer.ts` 转译成 linnsy 内部事件
- `--output-last-message` 写到 task workspace 内（`<workspace>/codex-final.txt`），归一化到 `TaskRecord.payload.lastFinalMessage`
- 当前实现已在 `codex-exec-dispatcher.ts` 落地并用模拟 process 覆盖 dispatch / resume / failed exit / cancel；daemon 默认装配通过 `RoutingExternalAgentDispatcher` 只把 `delegate_to_codex` 路由到 Codex，未支持 vendor fail closed。
- 测试分五层：processRunner 单测覆盖事件消费与状态机；假 `codex` 可执行文件测试覆盖真实 spawn、argv、NDJSON stdout、`--output-last-message` 文件；主对话 mock LLM dogfood 覆盖 `delegate_to_external` 到 Codex task 的工具链路；`LINNSY_TEST_REAL_MAIN_CODEX=1` 手动 opt-in 的真实主模型 dogfood 验证主模型会不会自然派活，Codex 侧仍是假可执行文件；`LINNSY_TEST_REAL_CODEX=1` 手动 opt-in 的真实 smoke 会在临时 git repo 中跑真实 `codex exec` 并只改 `smoke.txt`。默认测试不调用真实主模型，也不调用真实 Codex CLI。
- processRunner 边界覆盖包括：缺 `cwd/prompt`、continue 缺 session/cwd、final message 文件缺失时从 stdout final 回退、非 0 退出无 stderr、Codex error event + 非 0 退出只记一次失败、用户取消后子进程迟到结果不覆盖 cancelled。
- 设置页连接检测由 `codex-probe.ts` 负责，只跑 `codex --version` 并返回 `not_found / available / failed` 三档；它不做登录探测、不跑 `codex exec`、不保存凭据。
- 真实 smoke 默认显式传 `gpt-5.4`，避免被用户本机 Codex profile 的默认模型带偏；需要覆盖时用 `LINNSY_TEST_REAL_CODEX_MODEL=<model>`。

### 3.3 继续对话（codex resume）

主人审批 / 补充后，linnsy 调用 `manage_task(action="continue", taskId, message)`：

```bash
codex exec resume \
  --skip-git-repo-check \
  --json \
  --output-last-message <task workspace>/codex-final.txt \
  <sessionId> \
  "<主人新指令 + 上次 final message 摘要>"
```

`resume` 子命令会恢复原 session 的工作目录，不支持 `--cd`，也不支持新派活使用的 `--sandbox` 参数。adapter 仍会读取并校验 task 上记录的 directory locator，保证被接管的历史对话确实绑定到一个本机项目目录，但不会把 cwd 再传给 `codex exec resume`。

`<sessionId>` 来自首次派活时 codex NDJSON 第一帧返回的 session id，存在 `TaskRecord.externalRef`。

### 3.4 选择已有 Codex 历史

Codex 本地历史不是全局聊天列表，而是和项目工作目录绑定的执行记录。`~/.codex/session_index.jsonl` 只有 id / 标题 / 更新时间；真正的项目目录在 `~/.codex/sessions/**.jsonl` 首帧 `session_meta.payload.cwd` 里。

因此 Linnsy 的历史接管流程必须是：

1. 先确定项目目录。主人说“linnsy 项目”时，优先用长期记忆或当前会话 task 里的 `locator.ref`；不清楚就调用 `manage_external_session(action="list_projects", definitionKey="delegate_to_codex")` 返回项目 cwd 分组，让主人选。
2. 再列该项目下的历史：`manage_external_session(action="list_threads", definitionKey="delegate_to_codex", locator={kind:"directory", ref:<cwd>})`。默认精确匹配 cwd；只有主人明确需要包含子目录时才传 `includeChildDirectories=true`。
3. 主人选中某条 session 后，调用 `manage_external_session(action="attach", sessionId=<sessionId>)`。接管出来的 `TaskRecord.locator.ref` 必须使用 session 自己的 `cwd`，不能用 Linnsy 当前运行目录或某个记忆里的近似路径。
4. 如果 session 的 `cwd` 不存在或不是目录，工具直接报错，让主人重新指定或打开 Codex 原环境；不静默换目录。
5. 后续继续对话仍用 `manage_task(action="continue", taskId, message)`，由 Codex 自己根据 `externalRef=sessionId` 恢复上下文。

这也回答了“task 越来越多怎么办”：Linnsy 不把 Codex 历史全量导入 task 表。task 表只记录 Linnsy 派发过的任务，或主人明确接管过的一条外部历史；未选择的 Codex 历史停留在 Codex 本地索引里，通过项目 cwd 分组按需查询。

---

## 4. 委派的判断逻辑（什么时候派给 codex）

主对话 LLM 的"判断三问"（写在 `linnsy_main` definition 的 system prompt 工作方式层 + `delegate-to-codex` definition 的描述里）：

1. **能不能 linnsy 自己一个回合搞定？**（查记忆 / 翻历史 / 设提醒 / 简单算数）→ 自己干
2. **是不是写文章 / 翻译 / 内容创作类？** → 派 linnya（监工模式，独立 sprint，不在本文档范围）
3. **要不要在主人电脑上调用工具、跑命令、读写文件、连 MCP？** → 派 **codex**

第三类涵盖：写代码 / 改代码 / 跑测试 / 读电脑文件 / 翻仓库 / 跑命令 / 通过 codex MCP 调外部服务（GitHub / Linear / Notion / 邮件 / ……）/ 自动化操作（生成报表 / 整理文件夹 / 批量改文件）。

**默认门槛**：主人没明确同意时，任何**写文件 / 跑命令**的活先问"我让 codex 去干哈？"再派。这条门槛通过 `linnsy_main` system prompt 实现，不在 codex 适配器层强制。

---

## 5. 审批模型 · 约定式 + sandbox 兜底

### 5.1 不做强制审批

linnsy 不实现 `waiting_approval` 状态、不实现 approval 卡片、不在 codex `--json` 事件流里拦截 `approval.requested` 事件转人工 UI。**所有审批走自然语言对话**。

理由：

- **协议层强制审批 = 状态机膨胀 + UI 复杂度爆炸**，跟 "linnsy 是一个人不是 Agent" 的扁平心智冲突
- **手机终端只有 markdown 流式输出**，不可能呈现协议级 approval 控件，做了也是死代码
- 全自然语言交互的产品本身就有"开口确认 → 开口同意"的天然回路，不需要协议层重做一遍

### 5.2 怎么做"约定式审批"

两端约定：

**A. 派给 codex 的任务 prompt 模板里追加**（在 `agents/delegate-to-codex/prompt.ts`）：

> "遇到可能影响主人利益的事（发邮件、推送代码、改重要配置、删大量文件、对外发请求等），不要直接做。把你想做的事写在最终消息里，然后退出，等主人审批后被重派或被继续对话。"

**B. linnsy 主对话 LLM 这边**（在 `linnsy_main` system prompt 工作方式层，未来沉淀进 skill）：

> "收到 codex 完成事件时，识别 final message 是'求审批'还是'真完成'。是求审批就用秘书话术问主人；主人回 'ok / 可以 / 全按推荐来 / 就这么办' 等表达同意的话，就调 `manage_task(action="continue")` 把'主人同意了'喂回去。"

### 5.3 sandbox 兜底

约定式审批的代价是 **codex 不听话时 linnsy 兜不住**——所以靠 `--sandbox workspace-write` 物理兜底：

- codex 想动 cwd 之外的文件 → 被 sandbox 拒绝，物理失败
- codex 想跑高风险 shell 命令（推送 / 删除 / 网络修改） → 大部分被 sandbox 拒绝
- **不开 `danger-full-access`**，永远不开

这是 Phase 1 唯一的硬安全边界。约定违反责任在 codex（提示性约定，不做事后弥补）。

---

## 6. 秘书话术（产品规范，Phase 1 不进 system prompt，未来作 skill 装载）

> **重要**：以下话术是**产品规范沉淀**，不是这一阶段的 system prompt 内容。Phase 1 主对话 LLM 自然生成秘书话术，本表给工程师 / 产品 / 未来 skill 作者一个**统一的语调对照**。
>
> 未来作为 skill 按需装载时，再决定是否字字落地。

### 6.1 状态 → 话术对照表


| codex / task 状态 | linnsy 在主对话 / 微信里说的话                                     |
| --------------- | -------------------------------------------------------- |
| 派出去成功           | "好，这个我让 codex 去干，回头告诉你结果。"                               |
| 进行中节点变化         | **不说话**（沉默原则）。仅写库 + 桌面卡片状态行刷新（手机端无表现）。                   |
| 卡了一段时间没动静       | linnsy **默认不主动催**，自己心里有数。**主人问了才答**："还在跑，已经 X 分钟了。"      |
| 干完了，没什么事        | "活干完了。要看具体改了啥吗？"                                         |
| 干完了，但有不确定       | "活看着是干完了，但有几处我不太放心：…。等你回电脑前自己看一下，还是要我现在转述给你？"            |
| 干坏了             | "出问题了。是 [一句话原因]。要回退吗？还是要让它再试一次？"                         |
| 没干完（自己中止 / 求审批） | "它干到一半停了，说 [一句话求审批 / 失败原因]。要我让它接着干吗？还是别管了？"              |
| 主人主动想看细节        | "好，我把它的原话给你转述：[final message 摘要]。完整 diff 在 codex 里看更清楚。" |


### 6.2 关键约束

- **手机终端永远只有 markdown 文字**——所有交互必须先在文字流里立得住，桌面卡片只是文字流的"工效附加层"
- **不展示 diff**——linnsy 只用文字描述"干了啥 / 改了几个文件 / 主要修了什么"，diff 真要看就回 codex 自己里看
- **沉默原则压过监工本能**——linnsy 默认不催不报，"完成 / 失败 / 求审批"才主动开口

---

## 7. 工作区策略 · linnsy 不持有"用户语义工作区"

### 7.1 两层语义拆开看


| 层                      | 是什么                                   | linnsy 的态度             |
| ---------------------- | ------------------------------------- | ---------------------- |
| **工程事实层** · cwd        | codex 新派活必须有 `--cd <path>`；`exec resume` 恢复原 session cwd，不接收 `--cd` | 新派活**必须给**；继续对话必须复用 task 上的 locator 校验 |
| **用户语义层** · "项目 / 工作区" | 给目录起人话名字、记最近用过、跨任务复用语义                | **不持有**，靠长期记忆兜底（见 7.3） |
| **默认干活区** · `Linnsy Work` | 主人只要新产物、没指定外部项目时，给本地执行器一个可见落脚点 | **只创建当次子目录**，不提供列出 / 切换 / 管理 |


### 7.2 派活时 cwd / locator 怎么算

主对话 LLM 在调 `delegate_to_external` 前自己算工作位置（P0 之后表达为 `locator`，见 §10），三个来源：

1. **主人原话有 path** → 直接用，构造 `{kind:'directory', label: <basename or 主人提及的名字>, ref: <path>}`
2. **主人说"那个 X 项目"** → `<memory-context>` 围栏里有"X 项目 = ~/code/x"那条长期记忆 → 映射到 path
3. **主人说"刚才那个 / 继续那个"** → 先用 `list_tasks` 看当前会话最近任务，找到唯一相关 directory locator 时用自然语言确认；多条歧义就让主人选
4. **主人只要新产物且没指定目录** → 主模型省略 locator；工具层创建 `~/Linnsy Work/<task-slug>/`，写回 `task.locator` 后派给 Codex
5. **项目类仍然都没有** → 主对话 LLM 直接追问主人："在哪干？"

LLM 算不出项目类 locator 时**不允许编造**——新派活 `--cd` 必填，否则 codex 会在 `$HOME` 下到处乱跑，违反安全边界。猜 `/tmp`、`/Users`、`~/code` 或临时 scratch 目录不是兜底，是坏派工单，会让主人收到一次本可避免的失败汇报。产出类任务省略 locator 是唯一例外，由工具层创建 `Linnsy Work` 子目录。继续已有 Codex 历史时，locator 来自 session 自己记录的 cwd，只用于校验和任务可见性，不再传给 `resume`。

**连接测试不是派活**：主人只是问"Codex 在吗 / 给 Codex 发个你好"时，Linnsy 不调用 `delegate_to_external`，而是解释 Codex 是本地任务执行器；设置页能检测 CLI 是否可用，端到端测试需要一个具体目录和一个真实小任务。

### 7.3 为什么不做工作区子系统

linnsy 是董事长助理，不是项目管理工具。董秘不"管理"工作区，董秘**记得**哪些目录是哪个项目——这能力由长期记忆兜底：

- 主人某次说："这是我的 linnsy 项目，在 `~/code/linnsy`" → linnsy 写记忆
- 后续主人说："在 linnsy 项目里干 X" → 拼上下文时 `<memory-context>` 围栏有那条记忆 → LLM 自然映射

不另起 `list_workspaces` / `create_workspace` / `switch_workspace` 工具集——避免跟长期记忆 90% 功能重合，避免滑向"项目管理工具"。

### 7.4 task workspace ≠ 用户语义工作区

注意区分：daemon 已有的 `WorkspacePort`（`src/domains/task/features/workspace/`）维护的是**每个 task 的临时目录**（`<LINNSY_HOME>/workspaces/<taskId>/`），用来存 codex 输出文件、transcripts 等内部产物——这是**daemon 内部基础设施**，跟"用户语义工作区"是两回事，本节的"不持有工作区"不否定它。

`~/Linnsy Work/<task-slug>/` 是另一层：它是主人可见的默认干活区，只在产出类任务没有外部目录时使用。它不放在 `<LINNSY_HOME>` 下面，避免主人找不到；也不叫 workspace，避免后续误加工作区管理工具。

---

## 8. 监工职责（linnsy 派出去之后干嘛）


| 监工动作        | 触发                             | linnsy 怎么处理                                                                                                                                                               | Phase 1 启用？        |
| ----------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| 盯进度         | codex event 进来                 | 写库 + **默认沉默**；只在节点变化（completed / failed）时主动汇报                                                                                                                             | ✅                  |
| 主人主动查询      | 主人对话里问"那个活咋样了"                 | LLM 调 `get_task_status(taskId)` 查询后回答                                                                                                                                     | ✅（已有工具）            |
| 失败升级        | codex 退出码非 0 / NDJSON error 事件 | 立即 reply_user，给"重派 / 取消 / 我自己看" 三个建议                                                                                                                                      | ✅                  |
| 重派          | 主人说"再试一次" / linnsy 判断结果不到位     | LLM 用 `manage_task(action="cancel")` + `delegate_to_external`（或现有 `redelegate_task`）；超过合理重试次数后升级给主人 | ✅                  |
| 中途取消        | 主人说"算了" / 超时硬上限                | LLM 调 `manage_task(action="cancel")` → kill 子进程 + task 转 `cancelled`                                                                                                                       | ✅                  |
| 继续对话        | 主人审批后 / 主人补充                   | LLM 调 `manage_task(action="continue", taskId, message)` → `codex exec resume`                                                                                                              | ✅                  |
| 主动催问        | 任务派出去 N 分钟没新事件                 | **不做**——linnsy 默认不主动催，主人问了才答（"沉默原则"压过监工本能）                                                                                                                                | ❌                  |
| 中途追加消息（非审批） | 主人在执行中插话                       | Phase 1 用 `manage_task(action="continue")`，但等当前 turn 完成才生效（fire-and-forget 限制）                                                                                                             | ⚠️ 部分支持            |
| 协议层中途审批     | codex `approval.requested` 事件  | 不接 App Server 拿不到此事件；约定式审批兜底（§5）                                                                                                                                          | ❌                  |


### 8.1 linnsy 看得见 / 看不见 Codex 什么（产品级预期校准）

主人对"linnsy 监督 Codex"的天然预期是"它能看到 Codex 跟它的整段对话历史，还能中途插话让它干第二步"。Phase 1 实际能力跟这个预期有差距，必须先用大白话写清楚，避免后续 dogfood 误把 Codex 当聊天对象。

**linnsy 看得见的**（来自 `codex exec --json` NDJSON 归一化）：

- 每条 task 的 `status` / `locator` / `lastNode` / `externalRef`（=Codex sessionId）/ `result.finalMessage` / `result.errorMessage`
- 工具卡里的派发记录与进度；Codex completed 后的 `task_execution_notice` 会投影成灰色小字分隔提示；task status transition 是内部流水，不再投影成前端系统气泡
- completed / failed / cancelled 终态会唤醒 `linnsy_main`，并把同一事实作为 `<system-event kind="task_status_change">` 注入模型上下文；LLM 自己判断要不要 `reply_user`
- `payload.lastFinalMessage`（上一轮 Codex 最终消息原文，给 `manage_task(action="continue")` 拼新 prompt 用）

**linnsy 看不见的**（Phase 1 拍板边界）：

- **Codex 内部 thread 中间对话**：reasoning、子轮工具调用细节、中间产物 diff——`--json` 事件流里有部分 reasoning，但被 `codex-event-normalizer.ts` 归一化吃掉只留 node + partialResult；linnsy 不还原原始 thread
- **Codex 在不同工作目录的历史会话**：linnsy 只看自己派出去的 task；主人自己在终端手动起的 codex session 完全不在 `tasks` 表里
- **Codex 自己的本地 session 存档**（`~/.codex/...` 之类）：linnsy 不读，不解析，不索引；这是 Codex CLI 的内部物
- **Codex 跑期间的实时 progress**：写进 task.lastNode + system.event 只是"节点级"事实，不是逐字流式

**linnsy 不能做的（fire-and-forget 限制）**：

- ❌ 在 Codex 当前 turn 还在跑时中途插话——`manage_task(action="continue")` 必须等当前子进程退出才能 spawn 下一轮 `codex exec resume`
- ❌ 让 Codex 暂停问主人一个问题然后等回答——Codex 协议级中途审批要 App Server，Phase 1 不接
- ✅ 替代回路：Codex 自己**主动 exit**，把"完成第一步，要不要继续？"写在 final message 里，linnsy 看到 task→completed → 用秘书话术问主人 → 主人回"继续" → linnsy 调 `manage_task(action="continue")` → Codex 用 `exec resume <sessionId>` 把上次 thread 还原后接着干。这条路径已落地（详见 §5.2 + §9.2）。

**这意味着主对话 LLM 在派 Codex 时必须把"分步求审批"显式写进任务 prompt**，否则 Codex 默认会一口气把整件事干完。模板举例：

> "请按以下步骤干：1. 改 X 文件加 Y 字段；2. 跑 Y 字段的测试；3. 改 README 说明 Y。**第一步做完后，把改了什么写在最终消息里然后退出**，等我让你继续。"

---

## 9. 工具集（沿用 S3 已有 + 新增 1 个）

### 9.1 沿用（S3 已落地，无需重命名）


| 工具                                           | 作用                                                  | 实现                                           |
| -------------------------------------------- | --------------------------------------------------- | -------------------------------------------- |
| `delegate_to_external`                       | 派外部活，`definitionKey: 'delegate_to_codex'` 区分 vendor | `domains/agent-run/features/tool-runtime/tools/delegate-to-external.ts` |
| `delegate_to_internal`                       | 派内部子 agent（与 codex 平行的"内"侧）                         | 同目录                                          |
| `list_tasks` / `get_task_status`             | 查询                                                  | 同目录                                          |
| `manage_task`                                | 状态机控制与继续对话，action 可为 cancel、pause、resume、continue | 同目录                                          |
| `redelegate_task`                            | 关旧 task + 开新 task                                   | 同目录                                          |


**vendor 区分原则**：通过 `definitionKey` 维度，**不引入 `vendor` 参数**——加 claude code / cursor 时只多两个 definition（`delegate_to_claude_code` / `delegate_to_cursor`），工具集不变。

### 9.2 `manage_task(action="continue")`

`manage_task` 统一收敛任务控制动作，其中 `action="continue"` 弥补"在 active task 上追加 prompt"能力。


| 字段        | 类型     | 说明           |
| --------- | ------ | ------------ |
| `action`  | string | 固定为 `continue` |
| `taskId`  | string | 必填           |
| `message` | string | 主人新指令 / 审批回复 |


行为：

- task 必须在 `dispatched` / `in_progress` / `completed`（刚完成、求审批语义）状态——否则报 `LINNSY_TASK_CANNOT_CONTINUE`
- 调 dispatcher 的 `continue(input)`（port 已具备；codex adapter 内部翻译成 `codex exec resume`）
- codex 适配器把它翻译成 `codex exec resume <sessionId>` + 新 prompt
- 写入新一轮 task event；attemptCount 不变（这不是重派，是同一 session 内追加）

### 9.3 重派 vs 继续对话


| 场景                      | 工具                                                         | 心智                                   |
| ----------------------- | ---------------------------------------------------------- | ------------------------------------ |
| 主人说"算了换个思路再来" / 结果不达标重做 | `manage_task(action="cancel")` + `delegate_to_external` 或 `redelegate_task` | 关旧 session 开新 session，attemptCount+1 |
| 主人审批通过 / 主人补充信息 / 让它接着干 | `manage_task(action="continue")`                                            | 同 session 追加 prompt（codex resume）    |


---

## 10. 数据模型补充

### 10.1 `TaskRecord` 字段约定（codex 视角）


| 字段                         | 用途                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `locator`                  | vendor-neutral 工作位置。**codex 只接受 `kind='directory'`**；`label` 是给人看的短名（仓库简名 / 任务别名），`ref` 是绝对路径。adapter dispatch 前再做 codex 自己关心的校验，不在主流程层做 codex 特定校验 |
| `externalRef`              | codex `sessionId`（首帧 NDJSON 返回）                                                                  |
| `externalKind`             | 派活时根据 `definitionKey` 推断写入：`'codex'`（**不再用旧值 `'cc'`**——Phase 1 顺手把枚举改名 `'cc'` → `'claude_code'`） |
| `payload.prompt`           | 任务 prompt 文本（约定式，Phase 1 不动 schema；未来若 `delegate_to_external` 提升 prompt 为顶层字段再迁移）                |
| `payload.lastFinalMessage` | codex 上一轮 final message，给 `manage_task(action="continue")` 拼新 prompt 用                                            |
| `workspacePath`            | task 临时工作目录（daemon 自己管，见 §7.4）                                                                   |
| `result`                   | codex 任务结束后的最终结构化结果（Phase 1 仅含 `finalMessage` + `exitCode`）                                      |


**codex adapter 校验规则（dispatch 前自己做，不靠主流程）**：

- `locator.kind === 'directory'`，否则抛 `LINNSY_TASK_LOCATOR_KIND_NOT_SUPPORTED`
- `locator.ref` 非空、绝对路径
- `locator.ref` 不在泛目录黑名单（`/`、`/home`、`/Users`、`/tmp`、`/private/tmp`、`/var`、`/var/tmp`）
- `locator.ref` 必须已经存在，且必须是目录；不存在目录在 spawn Codex 前直接失败，避免把 `os error 2` 这种底层错误丢给主人
- 否则抛 `LINNSY_TASK_LOCATOR_INVALID`

这些规则是 **codex 自己关心**的，不通过主流程强制——claude code / cursor / linnya 加进来时各自有不同的校验需求（详见 [`../README.md §4.2`](../README.md)）。

### 10.2 现有 `delegate_to_external` 的约定

- `delegate_to_external` 已根据 `definitionKey` 反推写入 `externalKind`；`payload.definitionKey` 不能覆盖系统入参。
- 当前 `delegate_to_external` 没有 `prompt` 顶层字段，prompt 必须塞 `payload.prompt`。Phase 1 沿用此约定不改 schema；如未来工程上出现"prompt 频繁不在 payload 里"的真实痛点，再考虑提升为顶层字段。
- P0 之后工具入参只收顶层 `locator`，不收 `cwd` 兼容字段；codex adapter 只读 `locator.ref`，不直读 `payload.cwd`，也不从旧 `payload.cwd` 反推。

---

## 11. 同类产品借鉴对照


| 来源                                                                                                       | 借鉴                                                                                                            | 抛弃                                                          |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 用户调研 §1（Codex App Server / SDK / mcp-server / cloud）                                                     | "外部 agent = 本地任务执行器"抽象 / `--json` NDJSON 事件流 / `--output-last-message` / `--sandbox workspace-write`          | App Server / SDK / cloud / desktop computer-use（Phase 2 再议） |
| 用户调研 §3（Cursor headless / ACP）                                                                           | 未来 vendor 扩展只动 `external-dispatch/<vendor>/` 子目录                                                            | Phase 1 不做 ACP 通用 adapter（Phase 1.5/2 再议）                   |
| OpenClaw | `sessions_spawn` 立即返回 + announce/push 注入会话——对应 linnsy 的 `delegate_to_external` 立即返回 + 任务终态 `<system-event>` 唤醒主对话 | OpenClaw skills 安全模型不引入                                     |
| Claude Code                                                                                              | "permission mode" 思路写进文档作为未来扩展锚点                                                                              | Phase 1 不做 permission mode，约定式审批替代                          |
| Hermes-agent                                                                                             | `<subagent_notification>` 注入会话——对应 linnsy 任务终态 `<system-event>` / 前端 `subagent.summary` 双通道表达                                             | 散布式权限不引入                                                    |


---

## 12. 后续 sprint 锚点（Phase 1 不做但要记下）

- ⏳ Codex App Server / SDK 长连接（触发条件：产品上需要协议层中途审批）
- ✅ Codex 可见接管 P1：后台 `exec` task 回到桌面可打开 Codex session，并可读取最近 thread 元数据
- ⏳ Codex Cloud（触发条件：用户明确希望任务跑在 OpenAI 云端）
- ⏳ `delegate_to_external` schema 升级 prompt 为顶层字段（触发条件：实操中 payload.prompt 约定带来真实痛点）
- ⏳ 通用 ACP adapter（用于一次性接入 Cursor / Gemini / OpenCode）
- ⏳ 秘书话术沉淀进 P5 skill 层（触发条件：skill 子系统在 Phase 2 落地）

---

## 13. 相关文档

- 上层 port 索引 + vendor 全景 → `[../README.md](../README.md)`
- `delegate-to-codex` definition 说明 → `[../../../../agent-run/features/agents/delegate-to-codex/README.md](../../../../agent-run/features/agents/delegate-to-codex/README.md)`
