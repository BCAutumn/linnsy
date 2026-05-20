import { z } from 'zod';

const reasoningSchema = z
  .object({
    enabled: z.boolean().optional(),
    effort: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
    budget_tokens: z.number().int().positive().optional()
  })
  .strict();

const capabilitiesSchema = z
  .object({
    context_window_tokens: z.number().int().positive().optional(),
    max_output_tokens: z.number().int().positive().optional(),
    modalities: z.array(z.enum(['text', 'image', 'audio'])).nonempty().optional(),
    supports_tools: z.boolean().optional(),
    supports_streaming: z.boolean().optional(),
    supports_reasoning: z.boolean().optional()
  })
  .strict();

const requestDefaultsSchema = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    max_tokens: z.number().int().positive().optional()
  })
  .strict();

const openAiProviderOptionsSchema = z
  .object({
    reasoning_summary: z.enum(['auto', 'concise', 'detailed']).optional(),
    text_verbosity: z.enum(['low', 'medium', 'high']).optional(),
    // Provider-native passthrough body fields for OpenAI-compatible endpoints
    // whose request shape extends the standard chat-completions schema (e.g.
    // DeepSeek `thinking` + `reasoning_effort`). 透传到 OpenAI SDK
    // chat.completions.create 的 body 顶层；codec 显式字段（model/messages/
    // temperature/...）始终覆盖同名 extras。请按提供商文档自担风险。
    request_extra_body: z.record(z.unknown()).optional()
  })
  .strict();

const anthropicProviderOptionsSchema = z
  .object({
    thinking_budget_tokens: z.number().int().positive().optional()
  })
  .strict();

const providerOptionsSchema = z
  .object({
    openai: openAiProviderOptionsSchema.optional(),
    anthropic: anthropicProviderOptionsSchema.optional()
  })
  .strict();

const modelSchema = z
  .object({
    model_name: z.string().min(1),
    display_name: z.string().min(1).optional(),
    capabilities: capabilitiesSchema.optional(),
    reasoning: reasoningSchema.optional(),
    request_defaults: requestDefaultsSchema.optional(),
    provider_options: providerOptionsSchema.optional(),
    fallback_chain: z.array(z.string().min(1)).optional()
  })
  .strict();

const providerSchema = z
  .object({
    api_protocol: z.enum(['openai_chat', 'openai_responses', 'anthropic_messages']),
    base_url: z.string().url().optional(),
    api_key_env: z.string().min(1),
    models: z.record(modelSchema)
  })
  .strict();

const telegramChannelSchema = z
  .object({
    enabled: z.boolean(),
    token_env: z.string().min(1),
    allowlist: z.array(z.string().min(1))
  })
  .strict();

const wechatChannelSchema = z
  .object({
    enabled: z.boolean(),
    gateway_bind: z.string().min(1),
    gateway_base_url: z.string().url(),
    bearer_env: z.string().min(1),
    wechat_bot_api_base_url: z.string().url().optional(),
    wechat_bot_api_token_env: z.string().min(1).optional(),
    poll_interval_ms: z.number().int().positive()
  })
  .strict();

const workspaceSchema = z
  .object({
    root: z.string().min(1).optional()
  })
  .strict();

const runtimeSchema = z
  .object({
    internal_subagent: z
      .object({
        max_concurrency: z.number().int().positive().optional()
      })
      .strict()
      .optional()
  })
  .strict();

const observabilitySchema = z
  .object({
    audit: z
      .object({
        cleanup_interval_ms: z.number().int().positive().optional(),
        retention_ms: z.number().int().positive().optional(),
        decision_max_file_bytes: z.number().int().positive().optional(),
        decision_max_files: z.number().int().positive().optional(),
        run_context_enabled: z.boolean().optional(),
        run_context_max_file_bytes: z.number().int().positive().optional(),
        run_context_max_files: z.number().int().positive().optional()
      })
      .strict()
      .optional(),
    llm_request_debug: z
      .object({
        enabled: z.boolean(),
        dir: z.string().min(1).optional(),
        max_message_chars: z.number().int().positive().optional(),
        max_records_per_run: z.number().int().positive().optional(),
        max_file_bytes: z.number().int().positive().optional(),
        max_files: z.number().int().positive().optional()
      })
      .strict()
      .optional()
  })
  .strict();

export const linnsyConfigSchema = z
  .object({
    profile: z.string().min(1),
    home: z.string().min(1),
    llm: z
      .object({
        default_provider: z.string().min(1),
        defaults: z
          .object({
            secretary: z.string().min(1),
            cron_summary: z.string().min(1),
            memory_consolidate: z.string().min(1)
          })
          .strict(),
        providers: z.record(providerSchema)
      })
      .strict(),
    channels: z
      .object({
        cli: z
          .object({
            enabled: z.boolean()
          })
          .strict(),
        web: z
          .object({
            enabled: z.boolean(),
            bind: z.string().min(1),
            bearer_env: z.string().min(1)
          })
          .strict(),
        telegram: telegramChannelSchema.optional(),
        wechat: wechatChannelSchema.optional()
      })
      .strict(),
    workspace: workspaceSchema.optional(),
    runtime: runtimeSchema.optional(),
    observability: observabilitySchema.optional(),
    auth: z
      .object({
        global_all: z.boolean(),
        pairing: z
          .object({
            code_ttl_ms: z.number().int().positive(),
            max_attempts: z.number().int().positive()
          })
          .strict()
      })
      .strict(),
    cron: z
      .object({
        tick_interval_ms: z.number().int().positive(),
        default_miss_grace_ms: z.number().int().positive()
      })
      .strict(),
    memory: z
      .object({
        on_pre_compress_provider: z.string().min(1)
      })
      .strict(),
    mcp: z
      .object({
        server: z
          .object({
            enabled: z.boolean(),
            transport: z.enum(['stdio'])
          })
          .strict(),
        clients: z.array(z.unknown())
      })
      .strict()
  })
  .strict();

export type LinnsyConfig = z.infer<typeof linnsyConfigSchema>;
