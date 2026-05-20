import type { WechatGatewayAccount } from './types.js';

export const DEFAULT_WECHAT_BOT_API_BASE_URL = 'https://ilinkai.weixin.qq.com';
export const DEFAULT_WECHAT_QR_LOGIN_TTL_MS = 120_000;
const DEFAULT_BOT_TYPE = '3';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type SleepLike = (ms: number) => Promise<void>;

export interface StartWechatQrLoginResult {
  qrcode: string;
  qrUrl: string;
  expiresAt: number;
}

export interface WaitForWechatQrConfirmationResult {
  connected: true;
  account: WechatGatewayAccount;
}

export interface FailedWechatQrConfirmationResult {
  connected: false;
  reason: 'expired' | 'timeout';
}

export interface WechatQrLoginClientPort {
  start(): Promise<StartWechatQrLoginResult>;
  waitForConfirmation(input: {
    qrcode: string;
    timeoutMs: number;
  }): Promise<WaitForWechatQrConfirmationResult | FailedWechatQrConfirmationResult>;
}

export interface CreateWechatQrLoginClientOptions {
  fetch?: FetchLike;
  sleep?: SleepLike;
  fixedBaseUrl?: string;
}

interface QrCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

interface QrStatusResponse {
  status: 'wait' | 'scaned' | 'confirmed' | 'expired' | 'scaned_but_redirect';
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  baseurl?: string;
  redirect_host?: string;
}

export function createWechatQrLoginClient(
  options: CreateWechatQrLoginClientOptions = {}
): WechatQrLoginClientPort {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? defaultSleep;
  const fixedBaseUrl = options.fixedBaseUrl ?? DEFAULT_WECHAT_BOT_API_BASE_URL;

  return {
    async start(): Promise<StartWechatQrLoginResult> {
      const response = await readJsonResponse<QrCodeResponse>(
        await fetchImpl(
          `${fixedBaseUrl}/ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(DEFAULT_BOT_TYPE)}`,
          { method: 'GET' }
        )
      );
      if (
        typeof response.qrcode !== 'string'
        || typeof response.qrcode_img_content !== 'string'
      ) {
        throw new Error('invalid WeChat bot API QR response');
      }
      return {
        qrcode: response.qrcode,
        qrUrl: response.qrcode_img_content,
        expiresAt: Date.now() + DEFAULT_WECHAT_QR_LOGIN_TTL_MS
      };
    },

    async waitForConfirmation(input): Promise<WaitForWechatQrConfirmationResult | FailedWechatQrConfirmationResult> {
      const deadline = Date.now() + input.timeoutMs;
      let currentBaseUrl = fixedBaseUrl;

      while (Date.now() <= deadline) {
        const response = await readJsonResponse<QrStatusResponse>(
          await fetchImpl(
            `${currentBaseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(input.qrcode)}`,
            { method: 'GET' }
          )
        );

        if (response.status === 'confirmed') {
          if (
            typeof response.bot_token !== 'string'
            || typeof response.ilink_bot_id !== 'string'
          ) {
            throw new Error('invalid confirmed WeChat bot API QR response');
          }
          return {
            connected: true,
            account: {
              accountId: response.ilink_bot_id,
              botToken: response.bot_token,
              baseUrl: typeof response.baseurl === 'string' ? response.baseurl : currentBaseUrl,
              connectedAt: Date.now(),
              ...(typeof response.ilink_user_id === 'string' ? { userId: response.ilink_user_id } : {})
            }
          };
        }

        if (response.status === 'scaned_but_redirect' && typeof response.redirect_host === 'string') {
          currentBaseUrl = `https://${response.redirect_host}`;
        } else if (response.status === 'expired') {
          return { connected: false, reason: 'expired' };
        }

        await sleep(1_000);
      }

      return { connected: false, reason: 'timeout' };
    }
  };
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`wechat qr transport failed: ${response.status.toString()} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
