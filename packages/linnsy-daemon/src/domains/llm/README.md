# LLM domain

LLM domain 承载 Linnsy 的模型设置、模型注册与 provider 路由边界。它对应产品里的“模型由主人明确配置，Linnsy 稳定使用该配置”的能力，而不是让模型在单轮对话里自行切换 provider。

当前已完成 model-settings 契约、model-settings HTTP route、model-registry、provider-routing 与 model persistence 迁移。linnkit `AgentAiEngine` 适配桥已迁入 `../../app/llm/`，供 app bootstrap 消费 LLM domain 的公开边界。

| 目录 | 职责 |
|---|---|
| `definitions/` | 模型设置的稳定 zod schema、默认值、运行态设置类型与 model id 工具函数 |
| `features/model-settings/` | model-settings feature 的 public facade；供 persistence、HTTP route 与 registry 共用同一份契约 |
| `features/model-settings/http/` | 设置页模型配置 REST 边界，保存时转调用持久化事务并刷新 model registry |
| `features/model-registry/` | 解析配置模型与用户模型，提供运行时模型查询、默认模型选择和用户模型热更新 port |
| `features/provider-routing/` | provider router、SDK factory、codecs 与 provider adapters；负责协议适配、provider 选择与 client 生命周期 |
| `persistence/model-settings/` | `model_settings` 表 SQLite store、`ModelSettingsStorePort`、legacy UI preferences 迁移与直接单测 |
| `persistence/model-secrets/` | `model_credentials` 表 AES-256-GCM 加密存储、`ModelSecretsStorePort` 与直接单测 |
| `shared/` | LLM request debug observer / scope 等跨 app ai-engine bridge 与 provider-routing 复用的稳定共享件 |

边界约定：

| 约定 | 原因 |
|---|---|
| model-settings 只描述用户模型 metadata、chatModelId 与运行态 API key 合并后的形状 | 保存事务、密钥加密、HTTP response 脱敏分别属于 LLM persistence 和 route，不能混进 definitions |
| model-settings HTTP route 不直接写 secrets 表 | 密钥与 metadata 必须通过 `ModelSettingsStorePort.saveWithSecrets()` 一次事务提交，避免模型可用性和凭据状态分叉 |
| provider 技术适配进入 `features/provider-routing/`，不留在 runtime | OpenAI / Anthropic / compatible codec 是 LLM domain 内的协议适配能力，不应继续挂在 runtime 技术目录下 |
| model-registry 不直接实例化 SDK provider | 模型选择是业务策略，provider client 生命周期属于技术适配；两者分开后，模型设置、registry 与 provider-routing 可以独立演进 |
| LLM request debug observer / scope 提升到 `shared/` | ai-engine bridge 和 provider-routing 都要读写同一套调试上下文；放 domain shared 才不会制造反向依赖 |
| provider-routing codecs 只接收 `FenceRegistry`，不直接读取 Linnsy fence 实现 | 围栏注册属于上下文工程 / agent-run 装配，LLM domain 只负责把已有 `AiMessage[]` 编码成 provider wire request |
