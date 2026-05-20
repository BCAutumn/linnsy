import { randomUUID } from 'node:crypto';

import type { MessageStorePort } from '../../../../persistence/stores/message/message-store-port.js';
import { LINNSY_ERROR_CODES, LinnsyError } from '../../../../shared/errors.js';
import type { OutboundPayload, Platform, SendTarget } from '../../../../shared/messaging.js';
import type { ClockPort, LoggerPort } from '../../../../shared/ports.js';
import { consoleLogger, systemClock } from '../../../../shared/ports.js';
import type { TaskTrackerPort } from '../../../task/ports/task-tracker-port.js';

import type {
  LinnsyNotificationLayer,
  NotificationChannelPort,
  NotificationChannelRegistryPort,
  NotificationChannelSendResult,
  NotificationDelivery,
  NotificationEventPublisherPort,
  NotificationProactiveSummary,
  NotifyForTaskInput,
  ReplyForTaskRunInput,
  ReplyForRunInput,
  ReplyForRunResult
} from './types.js';

export interface CreateNotificationLayerOptions {
  channels: Iterable<NotificationChannelPort> | Map<Platform, NotificationChannelPort> | NotificationChannelRegistryPort;
  messages: MessageStorePort;
  taskTracker?: TaskTrackerPort;
  clock?: ClockPort;
  logger?: LoggerPort;
  outboundIdFactory?: () => string;
  events?: NotificationEventPublisherPort;
}

export function createNotificationLayer(
  options: CreateNotificationLayerOptions
): LinnsyNotificationLayer {
  const clock = options.clock ?? systemClock;
  const logger = options.logger ?? consoleLogger;
  const outboundIdFactory = options.outboundIdFactory ?? defaultOutboundIdFactory;
  const channelRegistry = normalizeChannels(options.channels);

  function lookupChannel(platform: Platform): NotificationChannelPort {
    const adapter = channelRegistry.get(platform);
    if (adapter === undefined) {
      throw new LinnsyError(
        LINNSY_ERROR_CODES.CHANNEL_NOT_STARTED,
        `notification layer cannot find channel adapter for platform ${String(platform)}`,
        false
      );
    }
    return adapter;
  }

  async function replyForRun(input: ReplyForRunInput): Promise<ReplyForRunResult> {
    const adapter = lookupChannel(input.target.platform);
    const sendResult = ensureDeliveryAccepted(await adapter.send(input.target, input.payload));
    const outboundMessageId = outboundIdFactory();
    const createdAt = clock.now();
    const outboundRecord = {
      messageId: outboundMessageId,
      conversationId: input.conversationId,
      role: 'assistant',
      source: 'outbound',
      platform: input.target.platform,
      chatType: input.target.chatType,
      chatId: input.target.chatId,
      ...(sendResult.providerMessageId === undefined
        ? {}
        : { providerMessageId: sendResult.providerMessageId }),
      ...(input.payload.text === undefined ? {} : { text: input.payload.text }),
      runId: input.runId,
      createdAt
    };
    await options.messages.insert(outboundRecord);
    options.events?.publish({
      kind: 'message.complete',
      conversationId: input.conversationId,
      messageId: outboundMessageId,
      runId: input.runId,
      createdAt,
      payload: {
        message: outboundRecord
      }
    });
    return {
      outboundMessageId,
      delivery: sendResult.delivery,
      ...(sendResult.detail === undefined ? {} : { detail: sendResult.detail }),
      ...(sendResult.providerMessageId === undefined
        ? {}
        : { providerMessageId: sendResult.providerMessageId })
    };
  }

  return {
    async reply(target: SendTarget, payload: OutboundPayload): Promise<void> {
      const adapter = lookupChannel(target.platform);
      ensureDeliveryAccepted(await adapter.send(target, payload));
      logger.info('notification.reply dispatched without conversation context', {
        platform: target.platform,
        chatType: target.chatType,
        chatId: target.chatId
      });
    },

    async replyForRun(input: ReplyForRunInput): Promise<ReplyForRunResult> {
      return replyForRun(input);
    },

    async replyForTaskRun(input: ReplyForTaskRunInput): Promise<ReplyForRunResult> {
      if (options.taskTracker === undefined) {
        throw new LinnsyError(
          LINNSY_ERROR_CODES.NOTIFICATION_NO_TARGET,
          'replyForTaskRun requires a TaskTrackerPort',
          false
        );
      }
      const task = await options.taskTracker.get(input.taskId);
      if (task === null) {
        throw new LinnsyError(LINNSY_ERROR_CODES.TASK_NOT_FOUND, `task ${input.taskId} was not found`, false);
      }
      const target = await options.messages.findLatestInboundTarget(task.conversationId);
      if (target === null) {
        throw new LinnsyError(
          LINNSY_ERROR_CODES.NOTIFICATION_NO_TARGET,
          `cannot find inbound target for task ${input.taskId}`,
          false
        );
      }
      const result = await replyForRun({
        runId: input.runId,
        conversationId: task.conversationId,
        target,
        payload: { text: input.text }
      });
      if (task.status === 'completed' && result.delivery === 'sent') {
        await options.taskTracker.transition(input.taskId, 'reported', { reportedAt: clock.now() });
      }
      return result;
    },

    async proactive(target: SendTarget, summary: NotificationProactiveSummary): Promise<void> {
      const adapter = lookupChannel(target.platform);
      ensureDeliveryAccepted(await adapter.send(target, { text: summary.text }));
      logger.info('notification.proactive dispatched', {
        platform: target.platform,
        chatType: target.chatType
      });
    },

    async notifyForTask(input: NotifyForTaskInput): Promise<ReplyForRunResult> {
      if (options.taskTracker === undefined) {
        throw new LinnsyError(
          LINNSY_ERROR_CODES.NOTIFICATION_NO_TARGET,
          'notifyForTask requires a TaskTrackerPort',
          false
        );
      }
      const task = await options.taskTracker.get(input.taskId);
      if (task === null) {
        throw new LinnsyError(LINNSY_ERROR_CODES.TASK_NOT_FOUND, `task ${input.taskId} was not found`, false);
      }
      const target = await options.messages.findLatestInboundTarget(task.conversationId);
      if (target === null) {
        throw new LinnsyError(
          LINNSY_ERROR_CODES.NOTIFICATION_NO_TARGET,
          `cannot find inbound target for task ${input.taskId}`,
          false
        );
      }
      const adapter = lookupChannel(target.platform);
      const sendResult = ensureDeliveryAccepted(await adapter.send(target, { text: input.text }));
      const outboundMessageId = outboundIdFactory();
      await options.messages.insert({
        messageId: outboundMessageId,
        conversationId: task.conversationId,
        role: 'assistant',
        source: 'outbound',
        platform: target.platform,
        chatType: target.chatType,
        chatId: target.chatId,
        ...(sendResult.providerMessageId === undefined
          ? {}
          : { providerMessageId: sendResult.providerMessageId }),
        text: input.text,
        createdAt: clock.now()
      });
      if (task.status === 'completed' && sendResult.delivery === 'sent') {
        await options.taskTracker.transition(input.taskId, 'reported', { reportedAt: clock.now() });
      }
      return {
        outboundMessageId,
        delivery: sendResult.delivery,
        ...(sendResult.detail === undefined ? {} : { detail: sendResult.detail }),
        ...(sendResult.providerMessageId === undefined
          ? {}
          : { providerMessageId: sendResult.providerMessageId })
      };
    }
  };
}

function normalizeChannels(
  input: Iterable<NotificationChannelPort> | Map<Platform, NotificationChannelPort> | NotificationChannelRegistryPort
): NotificationChannelRegistryPort | Map<Platform, NotificationChannelPort> {
  if (isNotificationChannelRegistry(input) || input instanceof Map) {
    return input;
  }
  return createNotificationChannelRegistry(input);
}

function isNotificationChannelRegistry(input: unknown): input is NotificationChannelRegistryPort {
  return typeof input === 'object'
    && input !== null
    && 'get' in input
    && typeof input.get === 'function';
}

function createNotificationChannelRegistry(
  channels: Iterable<NotificationChannelPort>
): NotificationChannelRegistryPort {
  const byPlatform = new Map<Platform, NotificationChannelPort>();
  for (const channel of channels) {
    if (byPlatform.has(channel.platform)) {
      throw new LinnsyError(
        LINNSY_ERROR_CODES.CHANNEL_NOT_STARTED,
        `duplicate channel adapter for platform ${String(channel.platform)}`,
        false
      );
    }
    byPlatform.set(channel.platform, channel);
  }
  return {
    get(platform: Platform): NotificationChannelPort | undefined {
      return byPlatform.get(platform);
    }
  };
}

function defaultOutboundIdFactory(): string {
  return `out_${randomUUID()}`;
}

function ensureDeliveryAccepted(
  sendResult: NotificationChannelSendResult
): NotificationChannelSendResult & { delivery: NotificationDelivery } {
  if (sendResult.delivery === 'sent' || sendResult.delivery === 'deferred') {
    return {
      delivery: sendResult.delivery,
      ...(sendResult.providerMessageId === undefined
        ? {}
        : { providerMessageId: sendResult.providerMessageId }),
      ...(sendResult.detail === undefined ? {} : { detail: sendResult.detail })
    };
  }
  throw new LinnsyError(
    LINNSY_ERROR_CODES.NOTIFICATION_DELIVERY_FAILED,
    sendResult.detail ?? 'channel reported failed delivery',
    false
  );
}
