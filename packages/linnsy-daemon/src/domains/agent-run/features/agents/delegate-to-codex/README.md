# delegate_to_codex · Agent Definition

> **本目录是"派给 codex 这件事"在 agents/registry 里的声明位置**——`delegate_to_codex` 是一个 `AgentDefinition`，但它**不被当作 graph 跑**，而是 `delegate_to_external` 工具识别 `definitionKey` 时通过 `LinnsyAgentRegistryPort.assertAgent('delegate_to_codex')` 拿到的 vendor 元数据。
>
> Codex 真实子进程执行逻辑在 `[../../../../task/features/external-dispatch/codex/](../../../../task/features/external-dispatch/codex/)`。
>
> 产品决策总账（话术 / 审批 / 监工 / 工作区策略 / 安全边界）见 `[../../../../task/features/external-dispatch/codex/README.md](../../../../task/features/external-dispatch/codex/README.md)`，**本文档不重复**。

---

## 1. 这个 definition 是什么

当前外部 agent 委派约定：

> **外部 agent 委派 | `delegate_to_`* | 由对端决定，registry 只配 endpoint**

`delegate_to_codex` 就是这条规则下的第一个具体 definition：

- **不是 graph agent**：不会被 `RunSpawner` 拿去启动 LLM 调用循环
- **是 vendor 元数据**：包含 codex 专用的 prompt 模板、默认参数、capability 标记
- **被谁读取**：`delegate_to_external` 工具拿到 `definitionKey='delegate_to_codex'` 后，先调 `assertAgent` 校验存在，再把 task 派给 `domains/task/features/external-dispatch/codex/CodexExecDispatcher`

---

## 2. 文件结构

```
delegate-to-codex/
├── README.md       ← 本文件（产品意图 / 工作流 / 与 codex/ 的关系）
├── definition.ts   ← AgentDefinition 声明（id / basePrompt / metadata）
└── prompt.ts       ← 派给 codex 的任务 prompt 模板（含求审批约定）
```

跟 `linnsy-main/{definition.ts, prompt.ts}` 现有约定一致，便于将来扩展 `delegate-to-claude-code/` / `delegate-to-cursor/`。

---

## 3. `basePrompt` 字段的用法（特殊）

对 graph agent（如 `linnsy_main`）来说，`basePrompt` 是 system prompt 的人格底色。
对 `delegate_to_codex` 这种 vendor definition 来说，`**basePrompt` 承载的是"派给 codex 的任务 prompt 模板"**——会被 codex dispatcher 在拼任务实际 prompt 时作为前缀使用。

模板内容必须包含的两段约定（详见 `prompt.ts`）：

1. **角色 / 工作目录约束**：明确告诉 codex 它在替主人办事，cwd 是主人指定的目录，不要越界
2. **求审批约定**（最关键）：
  > 遇到可能影响主人利益的事（发邮件、推送代码、改重要配置、删大量文件、对外发请求等），**不要直接做**。把要做的事写在最终消息里，然后退出，等被重派或被 `manage_task(action="continue")` 唤回继续干。

后接由 dispatcher 拼接的具体任务描述（`payload.prompt`）。

---

## 4. `metadata` 字段的用法

利用 `AgentDefinition.metadata` 通用 slot 放 vendor-specific 配置：


| key               | 类型                  | 用途                                                                                                  |
| ----------------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| `vendor`          | `'codex'`           | dispatcher 路由用                                                                                      |
| `transport`       | `'codex_exec'`      | Phase 1 固定，Phase 2 可能 `'codex_app_server'`                                                          |
| `defaultSandbox`  | `'workspace-write'` | 不暴露给主人配置                                                                                            |
| `defaultModel`    | `string?`           | 可选，传 codex `--model`；空表示用 codex 自己默认                                                                |
| `requiresGitRepo` | `false`             | Phase 1 不强制 git repo |


`modelPolicy` 字段对 vendor definition **不影响 codex 端模型选择**——codex 自己决定模型，linnsy 只是通过 metadata 透传一个建议值。`ai-strategy.md §2.3` 已拍板：模型策略由对端决定，registry 只配 endpoint。

---

## 5. `toolPolicy` 字段的用法

vendor definition 的 `allowedToolIds` 数组对 codex 子进程**没有约束力**——codex 用什么工具是 codex 自己 sandbox 决定的。

但这个字段仍要填，作为**linnsy 主对话 LLM 在派活时的能力声明**，告诉主对话 LLM“派给 codex 这条路能完成 X 类任务”，影响主对话 LLM 的判断三问。

Phase 1 建议留空数组 `allowedToolIds: []`（vendor definition 不参与 linnsy 工具白名单计算），靠 system prompt 里的判断三问做选择。

---

## 6. 跟 `linnsy_main` 的连接关系

```
linnsy_main definition (graph agent)
  └─ toolPolicy.allowedToolIds includes:
       - delegate_to_external
       - manage_task            ← 继续 / 取消 / 暂停 / 恢复已有 task
       - list_tasks / get_task_status / ...

delegate_to_external 工具 (domains/agent-run/features/tool-runtime/tools/delegate-to-external.ts)
  └─ assertAgent(definitionKey='delegate_to_codex')   ← 命中本目录 definition
  └─ dispatcher.dispatch({ taskId, definitionKey, workspacePath, payload })
       └─ ExternalAgentDispatcherPort
            └─ CodexExecDispatcher (domains/task/features/external-dispatch/codex/)   ← 真正 spawn 子进程
```

当前 `linnsy_main` 的 `allowedToolIds` 已包含 `manage_task`，用于主人审批通过后让同一个外部 task 接着干，也用于取消 / 暂停 / 恢复已有 task。

---

## 7. 注册位置

按 `agents/registry/registry.ts` 现有约定，所有内置 definition 由 `createBuiltInAgentDefinitions()` 一次性注册。`delegate_to_codex` 已加进这个工厂方法，跟 `linnsy_main` / `linnsy_general_subagent` / `linnsy_echo_subagent` / `linnsy_cron_runner` 平等注册。

`Phase 1 contract: registry is frozen at boot`——不允许运行时再注册新 definition，加 vendor 必须改代码 + 重启。

---

## 8. 反目标（**不**做）

- ❌ 在本目录写子进程生命周期管理逻辑（在 `domains/task/features/external-dispatch/codex/`）
- ❌ 在本目录暴露原始 codex NDJSON 事件格式（事件归一化在 `domains/task/features/external-dispatch/codex/codex-event-normalizer.ts`）
- ❌ 在本目录写秘书话术 / 审批回路（产品决策在 `domains/task/features/external-dispatch/codex/README.md`）
- ❌ 把这个 definition 当 graph agent 跑（registry 标记 vendor + dispatcher 路由是关键边界，运行时若误把它喂给 `RunSpawner` 应抛错）

---

## 9. 相关文档

- Codex 适配器产品决策总账 → `[../../../../task/features/external-dispatch/codex/README.md](../../../../task/features/external-dispatch/codex/README.md)`
- External Dispatcher port + vendor 索引 → `[../../../../task/features/external-dispatch/README.md](../../../../task/features/external-dispatch/README.md)`
- 主对话 agent definition 现状 → `[../linnsy-main/definition.ts](../linnsy-main/definition.ts)`
