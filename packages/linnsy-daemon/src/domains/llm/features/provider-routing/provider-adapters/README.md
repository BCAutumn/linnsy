# LLM Provider Adapter 开发规范

> 本目录只处理“某个 provider 怎么接入某个 API protocol”。通用 factory 不写厂商分支。

## 选择顺序

`createSdkProviderFactory()` 按固定顺序解析：

1. 精确 adapter：`provider + apiProtocol`，例如 `deepseek + openai_chat`。
2. 协议 fallback：只按 `apiProtocol`，例如任意 provider 的 `openai_chat`。

这保证 DeepSeek 这类 OpenAI-compatible 但有私有字段要求的 provider 可以局部适配，同时 OpenRouter / LiteLLM proxy / 自建中转仍能复用通用 OpenAI-compatible adapter。

## 目录职责

| 文件 | 职责 |
|---|---|
| `types.ts` | SDK client port、adapter interface、注册项类型 |
| `registry.ts` | adapter 注册与解析；内置 exact/fallback 清单 |
| `shared.ts` | provider 调用的共同能力：timeout、错误归一、stream helpers |
| `*-adapter.ts` | 某条 provider/protocol 边界：构造请求、调用 SDK、归一响应/stream |
| `../codecs/*.ts` | wire payload 构造与 provider 私有 message 字段转换 |

## 临时故障与重试边界

- provider adapter 只负责把 SDK / HTTP 错误归一成 `LinnsyError`：401 / 403 是不可恢复鉴权错误；408 / 409 / 425 / 429 / 5xx、SDK connection error、`fetch failed`、`ECONNRESET`、`ECONNREFUSED`、`ENOTFOUND`、`EAI_AGAIN`、`ETIMEDOUT` 等短暂网络问题归为 `LINNSY_LLM_PROVIDER_UNAVAILABLE` 且 `recoverable=true`。
- 自动重试集中在 `ai-engine.ts`，顺序是“同一 model 最多重试 5 次 → 再走 `fallback_chain`”。adapter 不自己写重试，避免不同 provider 行为分叉。
- 流式调用只有在还没有发出 content / thought / tool chunk / finish / usage 前才允许重试；一旦前端已经看到输出，中途失败就不重试，避免同一轮回答重复或跳变。

## 新增 provider 的规则

1. 能复用通用协议时，不新增 SDK。Phase 1 核心只允许 `openai` 与 `@anthropic-ai/sdk`。
2. provider 有私有字段、历史回放约束、stream 差异时，新建独立 adapter 或 codec，不把 `if (provider === ...)` 写进 `sdk-provider-factory.ts`。
3. adapter 只依赖 SDK client port，不直接 new SDK client。SDK client 统一由 `sdk-provider-factory.ts` 创建。
4. wire payload 先按 `unknown` 进入，再用 type guard / zod 收窄；禁止 `any` / `as any`。
5. provider 私有字段必须有明确归属：请求构造放 codec，响应/stream 归一放 adapter。
6. 不做防御性吞错。provider 返回结构不符合预期时，抛 `LINNSY_LLM_CODEC_INVALID_PAYLOAD` 或对应 provider 错误。

## 必补测试

新增或修改 adapter 必须覆盖：

- 请求侧：linnkit/linnsy 内部字段不会泄漏，provider 需要的字段会正确物料化。
- 响应侧：`content / tool_calls / reasoning_details / usage` 能归一到 linnkit 需要的形状。
- 流式侧：delta、tool call chunk、reasoning、usage、finish 都按真实 provider 语义发出；如果 provider 同时返回“可读思考过程”和“必须回放的 sidecar”（如 DeepSeek `reasoning_content`），adapter 必须同时写 `onThought` 与 `reasoning_details`，不能用其中一条替代另一条。
- 多轮工具历史：assistant tool call + tool result + follow-up 不会触发 provider 协议错误。
- registry 选择：需要 exact adapter 的 provider 必须证明它优先于 protocol fallback。

真实网络 smoke 只能作为手工或 staging 检查；常规 CI 只跑 mock/port 注入测试。
