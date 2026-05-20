import type { LinnsyConfig } from '../../config/schema.js';
import type { LoggerPort } from '../../shared/ports.js';

import { createCliChannelAdapter } from '../../domains/channel/features/cli/cli-channel-adapter.js';
import { createDesktopChannelAdapter } from '../../domains/channel/features/desktop/desktop-channel-adapter.js';
import {
  createDesktopMessageBus,
  type DesktopMessageBusPort
} from '../../domains/channel/features/desktop/desktop-message-bus.js';
import type { ChannelAdapterPort } from '../../domains/channel/definitions/types.js';
import {
  createHttpWechatGatewayClient,
  createWechatChannelAdapter
} from '../../domains/channel/features/wechat/wechat-channel-adapter.js';

export type ChannelBootChannelId = 'cli' | 'wechat' | 'desktop';

export interface ChannelBootFailure {
  channelId: ChannelBootChannelId;
  reason: string;
}

export interface BootedChannels {
  adapters: ChannelAdapterPort[];
  desktopBus: DesktopMessageBusPort | null;
  failures: ChannelBootFailure[];
}

export interface BootChannelAdaptersOptions {
  config: LinnsyConfig;
  logger: LoggerPort;
  env?: Record<string, string | undefined>;
  cliOutboundPrefix?: string;
}

// 启动每个 channel 是一组并列的可独立失败步骤。可选 channel 缺前置条件
// （比如缺 bearer 环境变量）只记入 failures 并打 warn，不会让 daemon 主进程
// 抛异常退出——这样 HTTP server / 桌面 UI / cron / 内部子代理这些不依赖该
// channel 的子系统才能继续起来。详见 docs/02 §4.10o。
export function bootChannelAdapters(options: BootChannelAdaptersOptions): BootedChannels {
  const env = options.env ?? process.env;
  const adapters: ChannelAdapterPort[] = [];
  const failures: ChannelBootFailure[] = [];

  adapters.push(createCliChannelAdapter({
    outboundPrefix: options.cliOutboundPrefix ?? '> ',
    logger: options.logger
  }));

  const wechatConfig = options.config.channels.wechat;
  if (wechatConfig?.enabled) {
    const result = tryCreateWechatChannel({
      wechatConfig,
      env,
      logger: options.logger
    });
    if (result.kind === 'ok') {
      adapters.push(result.adapter);
    } else {
      failures.push({ channelId: 'wechat', reason: result.reason });
      options.logger.warn(
        `wechat channel disabled at boot: ${result.reason}`,
        { channelId: 'wechat' }
      );
    }
  }

  let desktopBus: DesktopMessageBusPort | null = null;
  if (options.config.channels.web.enabled) {
    desktopBus = createDesktopMessageBus();
    adapters.push(createDesktopChannelAdapter({
      connection: desktopBus,
      logger: options.logger
    }));
  }

  return { adapters, desktopBus, failures };
}

type WechatBootResult =
  | { kind: 'ok'; adapter: ChannelAdapterPort }
  | { kind: 'failed'; reason: string };

function tryCreateWechatChannel(input: {
  wechatConfig: NonNullable<LinnsyConfig['channels']['wechat']>;
  env: Record<string, string | undefined>;
  logger: LoggerPort;
}): WechatBootResult {
  const bearer = input.env[input.wechatConfig.bearer_env];
  if (bearer === undefined || bearer.trim().length === 0) {
    return {
      kind: 'failed',
      reason: `missing required environment variable ${input.wechatConfig.bearer_env}`
    };
  }
  try {
    const adapter = createWechatChannelAdapter({
      gateway: createHttpWechatGatewayClient({
        baseUrl: input.wechatConfig.gateway_base_url,
        bearerToken: bearer
      }),
      pollIntervalMs: input.wechatConfig.poll_interval_ms,
      logger: input.logger
    });
    return { kind: 'ok', adapter };
  } catch (error: unknown) {
    return {
      kind: 'failed',
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}
