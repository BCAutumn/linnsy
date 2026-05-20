# Agents

> **数据表**：无（registry 是内存只读目录，不持久化）

## 1. 职责

`agents/` 是 Agent-run domain 下的 agent 定义目录。每个具体 agent 自己持有 `definition.ts` 与 `prompt.ts`，registry 只负责在 daemon 启动时收集、校验、冻结和查询这些定义。整体上它做五件事：

1. 收集 built-in agent 列表（来源是当前目录下每个 `<agent-id>/definition.ts`）。
2. 收集外部委派 adapter 列表（当前来源是 `[registry/external-definitions.ts](./registry/external-definitions.ts)`）。
3. 通过 `[registry/registry.ts](./registry/registry.ts)` 对每条 `AgentDefinition` 跑 shape 校验 + `Object.freeze` 深冻结。
4. AgentDefinition 进入 RunSpawner 前，由 `[linnkit-agent-spec.ts](./linnkit-agent-spec.ts)` 转成 linnkit AgentSpec，并统一经过 linnkit 0.8 的 `defineContextPolicy` / `AgentSpec.parse` 校验。
5. 对外暴露 `[LinnsyAgentRegistryPort](./registry/types.ts)`（`getAgent` / `assertAgent` / `getDefaultAgent` / `listAgents`）。

它**不做**：

- registry 不写 prompt 文本（prompt 文本归 `domains/agent-run/features/agents/<id>/prompt.ts`）。
- registry 不渲染 prompt 变量（变量渲染归 `[prompt-template.ts](./prompt-template.ts)`）。
- registry 不组装 system prompt（组装归 `[domains/agent-run/features/system-prompt/system-prompt-assembler.ts](../system-prompt/system-prompt-assembler.ts)`）。
- registry 不允许运行时新增定义。`registerAtRuntime()` 永远抛 `LINNSY_DEFINITION_REGISTER_AT_RUNTIME`。

> **一句话边界**：agents 目录放具体 agent，registry 是"agent 名册管理员"，不是"agent 工厂"，更不是"agent 提示词作者"。

## 2. 内部结构


| 文件                                                           | 责任                                                                                                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `[index.ts](./index.ts)`                                      | built-in agent 列表与公开导出入口；新增内置 agent 时只在这里追加登记                                                                                      |
| `[contracts.ts](./contracts.ts)`                              | `AgentDefinition` 与 policy 数据契约                                                                                                      |
| `[linnkit-agent-spec.ts](./linnkit-agent-spec.ts)`            | AgentDefinition → linnkit AgentSpec 适配层；集中处理默认 contextPolicy、中文 token 估算、fence must-keep、工具 `argsSchema` 复制与协议校验 |
| `[registry/registry.ts](./registry/registry.ts)`              | `createLinnsyAgentRegistry()`：收集 + 校验 + 冻结 + 索引；`registerAtRuntime` 兜底抛错                                                              |
| `[registry/types.ts](./registry/types.ts)`                    | `LinnsyAgentRegistryPort`；`AgentDefinition` 与 policy 类型从 `[contracts.ts](./contracts.ts)` 转出，兼容老调用方 |
| `[registry/external-definitions.ts](./registry/external-definitions.ts)` | 外部委派 adapter 元数据（`delegate_to_codex` / `delegate_to_cursor` / `delegate_to_claude_code` / `delegate_to_linnya`）。⚠️ 见 §6 已知 follow-up  |
| `[registry/__tests__/registry.test.ts](./registry/__tests__/registry.test.ts)` | shape 校验 / 冻结 / 默认 agent / 重复 id / 运行时注册兜底                                                                                            |


> **配套目录**：built-in agent 真实定义和 prompt 长在当前目录下每个 `<agent-id>/`；数据契约长在 `[contracts.ts](./contracts.ts)`。registry 只 import `createBuiltInAgentDefinitions()`，**不**直接 import 任一个 agent 的 `definition.ts`。

## 3. 依赖与被依赖

- 上游（我依赖谁）
  - `[./](./)`：built-in agent 内聚目录（每个 agent 一个文件夹，含 `definition.ts` + `prompt.ts`）
  - `[contracts.ts](./contracts.ts)`：`AgentDefinition` 与 policy 数据契约
  - `[../../../../shared/errors.ts](../../../../shared/errors.ts)`：`LinnsyError` + `LINNSY_ERROR_CODES`
- 下游（谁依赖我）
  - `[app/bootstrap/daemon.ts](../../../../app/bootstrap/daemon.ts)`：daemon 装配时 `createLinnsyAgentRegistry()`
  - `[domains/agent-run/features/run-spawner/](../run-spawner/)`：spawn run 前 `assertAgent(agentId)` 拿 policy
  - `[domains/agent-run/features/system-prompt/](../system-prompt/)`：`composeSystemPrompt` 读 `definition.basePrompt` + policies
  - `[features/tool-runtime/](../tool-runtime/)`：`delegate_to_internal` / `delegate_to_external` 用 `assertAgent` 校验目标 agent 存在

## 4. 关键决策日志

- **2026-05-20（README 归类收口）**：本说明从 `agents/registry/README.md` 上移到 `[agents/README.md](./README.md)`；新增 / 修改 agent 的操作手册属于 agents feature，不属于 registry 子目录，避免误导后来者把具体 agent 放进 registry。
- **2026-05-10（依赖边界收口）**：`AgentDefinition` 与 policy 类型归到 `[contracts.ts](./contracts.ts)`，`agents/registry/types.ts` 只保留 registry port 并转出契约类型；旧独立 registry 目录物理合并到 `agents/registry/`。
- **2026-05-13（linnkit 0.8 contextPolicy 适配）**：新增 `[linnkit-agent-spec.ts](./linnkit-agent-spec.ts)`，RunSpawner 不再手写 AgentSpec；`AgentDefinition.contextPolicy` 只覆盖策略项，`profileId` 永远来自 `systemPromptId`；主会话、内部子 agent、cron agent 分别声明不同 token 预算与工具历史策略。
- **2026-04-27（agent 定义内聚化）**：built-in agent 从原先散落在旧 registry 文件和 registry definitions 目录，全部迁出到 `domains/agent-run/features/agents/<agent-id>/` 内聚目录；`AgentDefinition` 增 `basePrompt: string` 必填字段；registry 不再 import 单个 agent 实现文件，只 import `[index.ts](./index.ts)` 的 `createBuiltInAgentDefinitions()`。
- **2026-04-25（S3.11）**：内部子 agent `linnsy_general_subagent` 加入 built-in 列表，`delegate_to_internal` 真实跑 graph run。
- **2026-04-24（S1）**：registry 首发；锁死 B0 红线"运行时不允许新增 definition"。

## 5. 测试入口

- 单元：`[registry/__tests__/registry.test.ts](./registry/__tests__/registry.test.ts)`
- prompt 变量渲染：`[__tests__/prompt-template.test.ts](./__tests__/prompt-template.test.ts)`
- system prompt 组装（下游消费者）：`[domains/agent-run/features/system-prompt/__tests__/system-prompt-assembler.test.ts](../system-prompt/__tests__/system-prompt-assembler.test.ts)`
- 跑测试：
  ```bash
  cd packages/linnsy-daemon \
    && npm test -- src/domains/agent-run/features/agents/registry/__tests__/registry.test.ts
  ```

## 6. TODO / friction

- 把 `[registry/external-definitions.ts](./registry/external-definitions.ts)` 里的外部委派 adapter 也迁到 `[<agent-id>/](./)` 形态（与 built-in 一致），让 registry 100% 不持有 agent 元数据。优先级：低。

---

## 7. 如何新增一个内置 Agent（操作手册）

> 新增 agent 是高频动作；这一节写清楚"动哪里、动什么、怎么测"，避免每次重新翻 plan 文档。

### 7.1 心智前提：四件事各司其职


| 关注点                                  | 物理位置                                                          | 谁动谁    |
| ------------------------------------ | ------------------------------------------------------------- | ------ |
| **prompt 文本**（人能看懂的提示词）              | `domains/agent-run/features/agents/<agent-id>/prompt.ts`                         | 你写 / 改 |
| **policy 配置**（model / tool / memory） | `domains/agent-run/features/agents/<agent-id>/definition.ts`                     | 你写 / 改 |
| **加进 built-in 列表**                   | `domains/agent-run/features/agents/index.ts` 的 `createBuiltInAgentDefinitions()` | 你追加一行  |
| **校验 + 冻结 + 查询**                     | `domains/agent-run/features/agents/registry/registry.ts`                          | **不动** |


> ⚠️ 永远不要在 `agents/registry/` 内新建文件来描述某个具体 agent。registry 只能"知道有这群 agent"，不能"知道某个具体 agent 长什么样"。任何让 `registry.ts` 长出 `if (agentId === 'xxx')` 分支的改动一律拒绝。

### 7.2 四步落地流程

#### Step 1 · 建目录 + 写 prompt

```text
packages/linnsy-daemon/src/domains/agent-run/features/agents/<agent-id>/
├── definition.ts
└── prompt.ts
```

`prompt.ts` 只导出 prompt 字符串本身。**支持的变量集是封闭的**（`[prompt-template.ts](./prompt-template.ts)`）：

```text
{{agent.id}}
{{agent.display_name}}
```

当前时间不放进 prompt 模板；daemon 每轮会以 user 侧 `turn-context` 围栏注入。未知变量会在 system prompt 组装阶段直接抛 `LINNSY_DEFINITION_INVALID`，不静默降级。需要新变量时**先**在 `prompt-template.ts` 里加 case，再在 prompt 里用。

参考样例（cron runner）：

```ts
// domains/agent-run/features/agents/<agent-id>/prompt.ts
export const myAgentPrompt = `
You are <Display Name>.

<职责一句话>
<硬约束 / "不要做什么">
`.trim();
```

#### Step 2 · 写 definition

```ts
// domains/agent-run/features/agents/<agent-id>/definition.ts
import type { AgentDefinition } from '../contracts.js';

import { myAgentPrompt } from './prompt.js';

export const MY_AGENT_ID = '<agent_id_snake_case>';

export function createMyAgentDefinition(
  overrides: Partial<AgentDefinition> = {}
): AgentDefinition {
  const base: AgentDefinition = {
    id: MY_AGENT_ID,
    displayName: '<Display Name>',
    description: '<一句话职责>',
    systemPromptId: `${MY_AGENT_ID}.system_prompt.v1`,
    basePrompt: myAgentPrompt,
    modelPolicy: { model: 'default', reasoningEffort: 'low' },
    toolPolicy: { allowedToolIds: [/* 显式列出，绝不写 '*' */] },
    memoryPolicy: {
      includeLongTermMemory: false,
      includeConversationSummary: false
    },
    executionPolicy: {
      // 单轮 graph 步数预算，不是工具调用次数上限。
      maxSteps: 40
    },
    metadata: { kind: 'internal_subagent' /* 或 'cron' / 'external_adapter' */ },
    enabled: true
  };

  return {
    ...base,
    ...overrides,
    modelPolicy: { ...base.modelPolicy, ...(overrides.modelPolicy ?? {}) },
    toolPolicy: { ...base.toolPolicy, ...(overrides.toolPolicy ?? {}) },
    memoryPolicy: { ...base.memoryPolicy, ...(overrides.memoryPolicy ?? {}) },
    executionPolicy: { ...base.executionPolicy, ...(overrides.executionPolicy ?? {}) },
    metadata: { ...base.metadata, ...(overrides.metadata ?? {}) },
    basePrompt: overrides.basePrompt ?? base.basePrompt
  };
}
```

硬约束：

- `id` 必须是 snake_case 全局唯一，**禁止**与 `registry/external-definitions.ts` 里的 id 撞车。
- `basePrompt` 必须非空（registry 校验会抛 `LINNSY_DEFINITION_INVALID`）。
- `modelPolicy.model` 必须能在当前 `config.yaml` 的 `llm.providers` 里解析（参考 `domains/llm/features/model-registry/model-registry.ts`）。
- `toolPolicy.allowedToolIds` **显式枚举**；绝不允许 `'*'` 通配。
- `executionPolicy.maxSteps` 是 graph runtime 真正读取的单轮步数预算；不要把它塞进 `metadata`。
- `factory(overrides)` pattern 必须保留——测试 / 装配点会通过 overrides 注入差异。

#### Step 3 · 在 built-in 列表里登记

```ts
// domains/agent-run/features/agents/index.ts
import { createMyAgentDefinition } from './<agent-id>/definition.js';

export {
  createMyAgentDefinition,
  MY_AGENT_ID
} from './<agent-id>/definition.js';

export function createBuiltInAgentDefinitions(): AgentDefinition[] {
  return [
    createLinnsyMainAgentDefinition(),
    createLinnsyGeneralSubagentDefinition(),
    createLinnsyEchoSubagentDefinition(),
    createLinnsyCronRunnerDefinition(),
    createMyAgentDefinition()  // ← 追加这一行
  ];
}
```

> registry 会按列表顺序 `listAgents()`；用户可见列表的顺序就是这里的顺序。

#### Step 4 · 写测试 + 跑 CI 全绿

最少要补一条 registry 自动注册断言（参考 `[registry/__tests__/registry.test.ts](./registry/__tests__/registry.test.ts)` 现有的 `auto-registers` case）：

```ts
expect(registry.assertAgent('<agent_id>')).toMatchObject({
  id: '<agent_id>',
  modelPolicy: { model: '<expected>' },
  toolPolicy: { allowedToolIds: [/* expected */] }
});
```

如果新 agent 是被某个 tool 调用的（如内部子 agent），还要补对应 tool runtime 测试（参考 `[features/tool-runtime/__tests__/delegate-to-internal.test.ts](../tool-runtime/__tests__/delegate-to-internal.test.ts)`）。

CI 全绿门：

```bash
cd packages/linnsy-daemon \
  && npm run lint \
  && npm run typecheck \
  && npm run guard:boundary \
  && npm run test
```

### 7.3 反例（PR 必拒）


| 反例                                                                      | 拒绝理由                                                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 在 `agents/registry/` 下新建 `my-agent.ts`                                   | built-in agent 必须长在 `domains/agent-run/features/agents/<id>/`，registry 只做目录管理                     |
| 在 `definition.ts` 里直接拼接 prompt 字符串                                      | prompt 文本必须独占 `prompt.ts`，便于人 review / diff / 替换                               |
| `toolPolicy.allowedToolIds: ['*']`                                      | 违反 B0 红线；显式枚举或显式空数组                                                            |
| 在 prompt 里用 `{{user.name}}` / `{{owner.timezone}}` 等未支持变量               | 会在 prompt assembly 阶段抛 `LINNSY_DEFINITION_INVALID`；想要的话先扩 `prompt-template.ts` |
| 在运行时 `registry.registerAtRuntime(...)` 想"动态加 agent"                     | 会抛 `LINNSY_DEFINITION_REGISTER_AT_RUNTIME`；Phase 1 agent 拓扑启动时即冻结              |
| 复制 `registry.ts` 里 `freezeDefinitions` / `validateDefinition` 的实现自己再来一遍 | 唯一一处校验入口在 `createLinnsyAgentRegistry()`；任何绕路写法都是耦合债                            |


### 7.4 何时改 registry 本身

只有以下情况才动 `[registry/registry.ts](./registry/registry.ts)` / `[registry/types.ts](./registry/types.ts)`：

1. `AgentDefinition` 字段集要扩（如新增 `securityPolicy`）→ 改 `contracts.ts` + `validateDefinition`。
2. 校验规则要加 / 收紧 → 改 `validateDefinition`，并在 `registry/__tests__/registry.test.ts` 补对应 `expectThrows` case。
3. 新增 `LinnsyAgentRegistryPort` 方法 → 先明确调用方和兼容策略，再改 `registry/types.ts` + `registry/registry.ts` + 全部消费者。

### 7.5 速查表


| 我想做的事                                    | 动哪里                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| 改某个 agent 的 prompt 文本                    | `domains/agent-run/features/agents/<id>/prompt.ts`                                            |
| 改某个 agent 的 model / tool / memory policy | `domains/agent-run/features/agents/<id>/definition.ts`                                        |
| 加一个新的内置 agent                            | 见上面 §7.2 四步                                                                |
| 加一个新的 prompt 变量                          | `domains/agent-run/features/agents/prompt-template.ts` 加 case + 测试                            |
| 改 system prompt 组装顺序 / 增 section         | `domains/agent-run/features/system-prompt/system-prompt-assembler.ts`                         |
| 改 `AgentDefinition` 字段集 / port 方法        | 先明确调用方和兼容策略，再改 `contracts.ts` / `registry/types.ts` + `registry/registry.ts` |
| 加一个外部委派 adapter（codex / cursor 类）        | 当前在 `registry/external-definitions.ts`；中期会迁到 `domains/agent-run/features/agents/<id>/`（见 §6 follow-up） |
