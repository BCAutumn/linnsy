import { randomBytes, randomUUID } from 'node:crypto';

import { isRecord } from '../../../../../shared/json.js';

const WECHAT_BOT_API_MESSAGE_TYPE_USER = 1;
const WECHAT_BOT_API_MESSAGE_TYPE_BOT = 2;
const WECHAT_BOT_API_TEXT_ITEM_TYPE = 1;
// Per WeChat bot API `WeixinMessage` proto: `0=NEW, 1=GENERATING, 2=FINISH`.
// Linnsy only sends fully-rendered replies, so always FINISH.
const WECHAT_BOT_API_MESSAGE_STATE_FINISH = 2;

export type WechatBotApiMessageType = 'user' | 'bot';

export interface WechatBotApiUpdate {
  providerMessageId: string;
  fromUserId?: string;
  toUserId?: string;
  messageType: WechatBotApiMessageType;
  text?: string;
  receivedAt: number;
  contextToken?: string;
  metadata?: Record<string, unknown>;
}

export interface WechatBotApiGetUpdatesResult {
  nextCursor: string;
  updates: WechatBotApiUpdate[];
}

export interface WechatBotApiPort {
  getUpdates(): Promise<WechatBotApiGetUpdatesResult>;
  commitCursor(nextCursor: string): Promise<void>;
  sendMessage(input: {
    toUserId: string;
    text: string;
    contextToken: string;
  }): Promise<void>;
}

export interface CreateWechatBotApiClientOptions {
  baseUrl: string;
  botToken: string;
  fetch?: FetchLike;
  /**
   * Factory for WeChat bot API `client_id` (the WeixinMessage idempotency key). Defaults to randomUUID.
   * Override only for deterministic tests.
   */
  clientIdFactory?: () => string;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function createWechatBotApiClient(options: CreateWechatBotApiClientOptions): WechatBotApiPort {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const clientIdFactory = options.clientIdFactory ?? randomUUID;
  let committedCursor = '';

  return {
    async getUpdates(): Promise<WechatBotApiGetUpdatesResult> {
      const response = await fetchImpl(buildUrl(options.baseUrl, 'ilink/bot/getupdates'), {
        method: 'POST',
        headers: buildHeaders(options.botToken),
        body: JSON.stringify({
          get_updates_buf: committedCursor
        })
      });
      const body = await readJsonResponse(response);
      return parseGetUpdatesResponse(body);
    },

    commitCursor(nextCursor: string): Promise<void> {
      committedCursor = nextCursor;
      return Promise.resolve();
    },

    async sendMessage(input): Promise<void> {
      // WeChat bot API iLink `sendmessage` requires the full BOT/FINISH WeixinMessage shape.
      // Sending only `to_user_id + context_token + item_list` returns HTTP 200 + body
      // `{}` and is silently dropped server-side (see ilink Weixin / cyberboss
      // `buildSendMessageReq`).
      const response = await fetchImpl(buildUrl(options.baseUrl, 'ilink/bot/sendmessage'), {
        method: 'POST',
        headers: buildHeaders(options.botToken),
        body: JSON.stringify({
          msg: {
            from_user_id: '',
            to_user_id: input.toUserId,
            client_id: clientIdFactory(),
            message_type: WECHAT_BOT_API_MESSAGE_TYPE_BOT,
            message_state: WECHAT_BOT_API_MESSAGE_STATE_FINISH,
            item_list: [
              {
                type: WECHAT_BOT_API_TEXT_ITEM_TYPE,
                text_item: {
                  text: input.text
                }
              }
            ],
            context_token: input.contextToken
          }
        })
      });
      await readSendMessageResponse(response);
    }
  };
}

function buildUrl(baseUrl: string, path: string): string {
  return new URL(path, ensureTrailingSlash(baseUrl)).toString();
}

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function buildHeaders(botToken: string): HeadersInit {
  return {
    AuthorizationType: 'ilink_bot_token',
    Authorization: `Bearer ${botToken}`,
    'Content-Type': 'application/json',
    'X-WECHAT-UIN': createWechatUin()
  };
}

function createWechatUin(): string {
  const value = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(value), 'utf-8').toString('base64');
}

async function readJsonResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`WeChat bot API transport failed: ${response.status.toString()} ${response.statusText}`);
  }
  return response.json() as Promise<unknown>;
}

async function readSendMessageResponse(response: Response): Promise<void> {
  if (!response.ok) {
    throw new Error(`WeChat bot API transport failed: ${response.status.toString()} ${response.statusText}`);
  }
  const raw = await response.text();
  if (raw.length === 0) {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return;
  }
  if (!isRecord(parsed)) {
    return;
  }
  const ret = parsed.ret;
  if (ret !== undefined && typeof ret !== 'number') {
    throw new Error('invalid WeChat bot API sendmessage ret');
  }
  if (typeof ret === 'number' && ret !== 0) {
    const errcode = typeof parsed.errcode === 'number' ? parsed.errcode : ret;
    const errmsg = typeof parsed.errmsg === 'string' ? parsed.errmsg : 'unknown error';
    throw new Error(`WeChat bot API sendmessage failed: ${errcode.toString()} ${errmsg}`);
  }
}

function parseGetUpdatesResponse(body: unknown): WechatBotApiGetUpdatesResult {
  if (!isRecord(body)) {
    throw new Error('invalid WeChat bot API getupdates response');
  }

  const ret = body.ret;
  if (ret !== undefined && typeof ret !== 'number') {
    throw new Error('invalid WeChat bot API getupdates ret');
  }
  if (typeof ret === 'number' && ret !== 0) {
    const errcode = typeof body.errcode === 'number' ? body.errcode : ret;
    const errmsg = typeof body.errmsg === 'string' ? body.errmsg : 'unknown error';
    throw new Error(`WeChat bot API getupdates failed: ${errcode.toString()} ${errmsg}`);
  }

  const nextCursor = body.get_updates_buf;
  if (typeof nextCursor !== 'string') {
    throw new Error('invalid WeChat bot API get_updates_buf');
  }

  const updatesValue = body.msgs;
  if (updatesValue === undefined) {
    return { nextCursor, updates: [] };
  }
  if (!Array.isArray(updatesValue)) {
    throw new Error('invalid WeChat bot API msgs payload');
  }

  return {
    nextCursor,
    updates: updatesValue.map(parseUpdate)
  };
}

function parseUpdate(value: unknown): WechatBotApiUpdate {
  if (!isRecord(value)) {
    throw new Error('invalid WeChat bot API update entry');
  }

  const providerMessageId = parseProviderMessageId(value);
  const messageType = parseMessageType(value.message_type);
  const receivedAt = parseReceivedAt(value.create_time_ms);
  const metadata = buildMetadata(value);

  if (value.from_user_id !== undefined && typeof value.from_user_id !== 'string') {
    throw new Error('invalid WeChat bot API from_user_id');
  }
  if (value.to_user_id !== undefined && typeof value.to_user_id !== 'string') {
    throw new Error('invalid WeChat bot API to_user_id');
  }
  if (value.context_token !== undefined && typeof value.context_token !== 'string') {
    throw new Error('invalid WeChat bot API context_token');
  }

  const text = extractText(value.item_list);

  return {
    providerMessageId,
    ...(value.from_user_id === undefined ? {} : { fromUserId: value.from_user_id }),
    ...(value.to_user_id === undefined ? {} : { toUserId: value.to_user_id }),
    messageType,
    ...(text === undefined ? {} : { text }),
    receivedAt,
    ...(value.context_token === undefined ? {} : { contextToken: value.context_token }),
    ...(metadata === undefined ? {} : { metadata })
  };
}

function parseProviderMessageId(value: Record<string, unknown>): string {
  if (typeof value.message_id === 'number') {
    return `wx:${value.message_id.toString()}`;
  }
  if (typeof value.seq === 'number') {
    return `wx-seq:${value.seq.toString()}`;
  }
  throw new Error('invalid WeChat bot API message identifier');
}

function parseMessageType(value: unknown): WechatBotApiMessageType {
  if (value === WECHAT_BOT_API_MESSAGE_TYPE_USER) {
    return 'user';
  }
  if (value === WECHAT_BOT_API_MESSAGE_TYPE_BOT) {
    return 'bot';
  }
  throw new Error('invalid WeChat bot API message_type');
}

function parseReceivedAt(value: unknown): number {
  if (typeof value !== 'number') {
    throw new Error('invalid WeChat bot API create_time_ms');
  }
  return value;
}

function extractText(itemList: unknown): string | undefined {
  if (itemList === undefined) {
    return undefined;
  }
  if (!Array.isArray(itemList)) {
    throw new Error('invalid WeChat bot API item_list');
  }

  const textParts: string[] = [];
  for (const item of itemList) {
    if (!isRecord(item)) {
      throw new Error('invalid WeChat bot API message item');
    }
    if (item.type !== undefined && typeof item.type !== 'number') {
      throw new Error('invalid WeChat bot API message item type');
    }
    if (item.type !== WECHAT_BOT_API_TEXT_ITEM_TYPE) {
      continue;
    }
    const textItem = item.text_item;
    if (!isRecord(textItem) || typeof textItem.text !== 'string') {
      throw new Error('invalid WeChat bot API text item');
    }
    textParts.push(textItem.text);
  }

  if (textParts.length === 0) {
    return undefined;
  }
  return textParts.join('\n');
}

function buildMetadata(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const itemTypes = readItemTypes(value.item_list);
  const metadata: Record<string, unknown> = {};

  if (typeof value.message_id === 'number') {
    metadata.messageId = value.message_id;
  }
  if (typeof value.seq === 'number') {
    metadata.sequence = value.seq;
  }
  if (itemTypes.length > 0) {
    metadata.itemTypes = itemTypes;
  }

  return Object.keys(metadata).length === 0 ? undefined : metadata;
}

function readItemTypes(itemList: unknown): number[] {
  if (!Array.isArray(itemList)) {
    return [];
  }

  const result: number[] = [];
  for (const item of itemList) {
    if (!isRecord(item)) {
      continue;
    }
    if (typeof item.type === 'number') {
      result.push(item.type);
    }
  }
  return result;
}
