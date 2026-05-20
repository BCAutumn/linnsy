import { loadLinnsyConfig } from '../../../src/config/loader.js';

export interface ResolvedWechatGatewayStatusClientConfig {
  baseUrl: string;
  bearerToken: string;
}

export interface ResolveWechatGatewayStatusClientConfigOptions {
  /** 已由 `local-bearer-tokens` 解析好的本机 wechat-gateway bearer。main 是事实源。 */
  bearerToken: string;
  /** 当 config.yaml 不可读时使用的兜底 base URL（dev 默认值）。 */
  fallbackBaseUrl: string;
  env?: NodeJS.ProcessEnv;
  logger?: Pick<Console, 'warn'>;
}

// 解析 wechat-gateway status client 的连接参数。
//
// **bearer 不再由本函数兜底**——main 已通过 [`local-bearer-tokens`](../../local-bearer-tokens.ts)
// 把"开发者 shell 显式 export > 持久化文件 > 新生成"的优先级处理完毕，并保证两端 token 一致。
// 本函数只负责 baseUrl 的解析（env > config > 兜底），避免出现"main 拿一份 bearer、
// statusClient 拿另一份"的对不上场景。
export async function resolveWechatGatewayStatusClientConfig(
  options: ResolveWechatGatewayStatusClientConfigOptions
): Promise<ResolvedWechatGatewayStatusClientConfig> {
  const env = options.env ?? process.env;
  const logger = options.logger ?? console;

  const envBaseUrl = env.LINNSY_WECHAT_GATEWAY_URL;
  if (envBaseUrl !== undefined && envBaseUrl.length > 0) {
    return { baseUrl: envBaseUrl, bearerToken: options.bearerToken };
  }

  try {
    const config = await loadLinnsyConfig();
    const wechat = config.channels.wechat;
    if (wechat !== undefined) {
      return { baseUrl: wechat.gateway_base_url, bearerToken: options.bearerToken };
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[linnsy electron] failed to read WeChat gateway config: ${message}`);
  }

  return { baseUrl: options.fallbackBaseUrl, bearerToken: options.bearerToken };
}
