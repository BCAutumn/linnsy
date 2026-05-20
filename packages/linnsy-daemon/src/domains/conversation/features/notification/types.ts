import type { MessageRecord } from '../../../../persistence/stores/message/message-store-port.js';
import type { OutboundPayload, Platform, SendTarget } from '../../../../shared/messaging.js';

export type NotificationChannelDelivery = 'sent' | 'deferred' | 'failed';

export interface NotificationChannelSendResult {
  delivery: NotificationChannelDelivery;
  providerMessageId?: string;
  detail?: string;
}

export interface NotificationChannelPort {
  readonly platform: Platform;
  send(target: SendTarget, payload: OutboundPayload): Promise<NotificationChannelSendResult>;
}

export interface NotificationChannelRegistryPort {
  get(platform: Platform): NotificationChannelPort | undefined;
}

export interface NotificationProactiveSummary {
  taskId?: string;
  text: string;
  cite?: Array<{ memoryId: string; lines?: string; note?: string }>;
}

/**
 * Stable contract mirroring docs/02b §3.9; Phase 1 only implements `reply`.
 * `proactive` is reserved for S3/S4 and currently throws.
 */
export interface NotificationPort {
  proactive(target: SendTarget, summary: NotificationProactiveSummary): Promise<void>;
  reply(target: SendTarget, payload: OutboundPayload): Promise<void>;
}

export interface ReplyForRunInput {
  runId: string;
  conversationId: string;
  target: SendTarget;
  payload: OutboundPayload;
}

export interface ReplyForTaskRunInput {
  taskId: string;
  runId: string;
  text: string;
}

export type NotificationDelivery = Exclude<NotificationChannelDelivery, 'failed'>;

export interface NotificationMessageCompleteEvent {
  kind: 'message.complete';
  conversationId: string;
  messageId: string;
  runId: string;
  createdAt: number;
  payload: {
    message: MessageRecord;
  };
}

export interface NotificationEventPublisherPort {
  publish(event: NotificationMessageCompleteEvent): void;
}

export interface ReplyForRunResult {
  outboundMessageId: string;
  delivery: NotificationDelivery;
  providerMessageId?: string;
  detail?: string;
}

export interface NotifyForTaskInput {
  taskId: string;
  text: string;
}

/**
 * Host-internal extension that adds the run/conversation context daemon needs
 * to persist the outbound message record. Daemon depends on this richer port;
 * external `NotificationPort` consumers stay on the docs-stable contract.
 */
export interface LinnsyNotificationLayer extends NotificationPort {
  replyForRun(input: ReplyForRunInput): Promise<ReplyForRunResult>;
  replyForTaskRun(input: ReplyForTaskRunInput): Promise<ReplyForRunResult>;
  notifyForTask(input: NotifyForTaskInput): Promise<ReplyForRunResult>;
}
