import type { LoggerPort } from '../../shared/ports.js';
import type {
  LinnsyMessage,
  SendTarget
} from '../../shared/messaging.js';
import type { MessageStorePort } from '../../persistence/stores/message/message-store-port.js';
import type { AuthorizationPort } from '../../domains/channel/features/authorization/types.js';
import type { RunSpawnerPort } from '../../domains/agent-run/features/run-spawner/types.js';
import type { SessionRouterPort } from '../../domains/conversation/features/session-routing/types.js';
import type { LinnsyNotificationLayer } from '../../domains/conversation/features/notification/types.js';
import type { RuntimeEventHubPort } from '../../domains/observability/features/event-hub/event-hub.js';
import type { TerminalBindingServicePort } from '../../domains/desktop-integration/features/terminal-binding/terminal-binding-service.js';
import { createLinnsyUserInterjectionFence } from '../../domains/agent-run/features/context-engineering/fences.js';
import { addPendingContextFence } from '../../domains/agent-run/features/context-engineering/pending-interjections.js';

export interface HandleTurnContext {
  message: LinnsyMessage;
  authGuard: AuthorizationPort;
  sessionRouter: SessionRouterPort;
  spawner: RunSpawnerPort;
  notificationLayer: LinnsyNotificationLayer;
  terminalBindingService: TerminalBindingServicePort;
  messages: MessageStorePort;
  defaultDefinitionKey: string;
  logger: LoggerPort;
  inboundIdFactory: () => string;
  events?: RuntimeEventHubPort;
}

export async function handleTurn(ctx: HandleTurnContext): Promise<void> {
  const pairingCode = parsePairCommand(ctx.message.text);
  if (pairingCode !== null && ctx.authGuard.consumePairingCode !== undefined) {
    const decision = await ctx.authGuard.consumePairingCode(pairingCode, ctx.message);
    if (decision.allow) {
      await ctx.notificationLayer.reply(createSendTarget(ctx.message), { text: 'Pairing complete.' });
    } else {
      ctx.logger.info('pairing command denied', {
        messageId: ctx.message.messageId,
        reason: decision.reason
      });
    }
    return;
  }

  const decision = await ctx.authGuard.authorize(ctx.message);
  if (!decision.allow) {
    ctx.logger.info('inbound message denied by auth guard', {
      messageId: ctx.message.messageId,
      reason: decision.reason
    });
    return;
  }

  if (ctx.message.providerMessageId !== undefined) {
    const existing = await ctx.messages.findByProviderMessage(
      ctx.message.platform,
      ctx.message.providerMessageId
    );
    if (existing !== null) {
      ctx.logger.info('duplicate inbound provider message ignored', {
        messageId: ctx.message.messageId,
        providerMessageId: ctx.message.providerMessageId,
        existingMessageId: existing.messageId
      });
      return;
    }
  }

  const directSession = ctx.message.conversationId === undefined
    ? null
    : await ctx.sessionRouter.resolveConversation({
      conversationId: ctx.message.conversationId,
      ...(ctx.message.userId === undefined ? {} : { userId: ctx.message.userId }),
      ...(ctx.message.metadata === undefined ? {} : { metadata: ctx.message.metadata })
    });
  const mobileSession = directSession === null
    ? await ctx.terminalBindingService.resolveInboundSession(ctx.message)
    : null;
  const session = directSession ?? mobileSession ?? await ctx.sessionRouter.resolve({
    platform: ctx.message.platform,
    chatType: ctx.message.chatType,
    chatId: ctx.message.chatId,
    ...(ctx.message.userId === undefined ? {} : { userId: ctx.message.userId }),
    ...(ctx.message.metadata === undefined ? {} : { metadata: ctx.message.metadata })
  });

  const inboundRecordId = ctx.inboundIdFactory();
  const inboundRecord = {
    messageId: inboundRecordId,
    conversationId: session.conversationId,
    role: 'user',
    source: 'inbound',
    platform: ctx.message.platform,
    chatType: ctx.message.chatType,
    chatId: ctx.message.chatId,
    ...(ctx.message.providerMessageId === undefined
      ? {}
      : { providerMessageId: ctx.message.providerMessageId }),
    ...(ctx.message.text === undefined ? {} : { text: ctx.message.text }),
    ...(ctx.message.metadata === undefined ? {} : { metadata: ctx.message.metadata }),
    createdAt: ctx.message.receivedAt
  };
  let inserted = true;
  if (ctx.message.providerMessageId === undefined) {
    await ctx.messages.insert(inboundRecord);
  } else {
    inserted = await ctx.messages.insertIfProviderMessageAbsent(inboundRecord);
  }
  if (!inserted) {
    ctx.logger.info('duplicate inbound provider message ignored after session resolution', {
      messageId: ctx.message.messageId,
      providerMessageId: ctx.message.providerMessageId
    });
    return;
  }
  if (ctx.message.text !== undefined) {
    await ctx.sessionRouter.setTitleIfMissing(session.conversationId, ctx.message.text);
  }
  ctx.events?.publish({
    kind: 'message.inbound',
    conversationId: session.conversationId,
    messageId: inboundRecordId,
    createdAt: inboundRecord.createdAt,
    payload: {
      message: inboundRecord
    }
  });

  const activeRun = await ctx.spawner.findActiveByConversation?.(session.conversationId);
  if (activeRun !== undefined && activeRun !== null && ctx.message.text !== undefined) {
    addPendingContextFence(activeRun.runId, createLinnsyUserInterjectionFence(ctx.message.text, {
      source: 'owner-message',
      messageId: inboundRecordId,
      receivedAt: ctx.message.receivedAt
    }));
    // fence 给 LLM 看，system.event 给前端看，避免模型知道插话但主人界面看不到。
    ctx.events?.publish({
      kind: 'system.event',
      conversationId: session.conversationId,
      runId: activeRun.runId,
      createdAt: ctx.message.receivedAt,
      payload: {
        sourceKind: 'user_interjection',
        detail: ctx.message.text,
        refId: inboundRecordId,
        occurredAt: ctx.message.receivedAt
      }
    });
    ctx.logger.info('inbound owner message queued as run interjection', {
      runId: activeRun.runId,
      conversationId: session.conversationId,
      messageId: inboundRecordId
    });
    return;
  }

  const channelTarget = createSendTarget(ctx.message);

  const awaitOutcome = waitForFinalAnswer(ctx.spawner);
  const spawn = await ctx.spawner.spawnDetached({
    definitionKey: ctx.defaultDefinitionKey,
    conversationId: session.conversationId,
    query: ctx.message.text ?? '',
    inboundMessageId: inboundRecordId,
    channelTarget,
    metadata: { sessionKey: session.sessionKey }
  });

  const reply = await awaitOutcome.attach(spawn.runId);
  if (reply === null) {
    ctx.logger.warn('linnsy turn yielded no reply', { runId: spawn.runId });
    return;
  }

  await ctx.notificationLayer.replyForRun({
    runId: spawn.runId,
    conversationId: session.conversationId,
    target: channelTarget,
    payload: { text: reply.finalAnswer ?? '' }
  });
}

function createSendTarget(message: LinnsyMessage): SendTarget {
  return {
    platform: message.platform,
    chatType: message.chatType,
    chatId: message.chatId,
    ...(message.providerMessageId === undefined
      ? {}
      : { replyToProviderMessageId: message.providerMessageId })
  };
}

function parsePairCommand(text: string | undefined): string | null {
  if (text === undefined) {
    return null;
  }
  const match = /^\/pair\s+([A-HJ-KM-NP-Z2-9]{8})$/u.exec(text.trim());
  if (match === null) {
    return null;
  }
  const code = match[1];
  return code === undefined ? null : code;
}

interface FinalAnswerWaiter {
  attach(runId: string): Promise<{ finalAnswer?: string } | null>;
}

function waitForFinalAnswer(spawner: RunSpawnerPort): FinalAnswerWaiter {
  return {
    attach(runId: string): Promise<{ finalAnswer?: string } | null> {
      return spawner.waitForTerminal(runId).then((event) => {
        if (event.type !== 'completed') {
          return null;
        }
        const finalAnswer = event.outcome.finalAnswer;
        return finalAnswer === undefined ? {} : { finalAnswer };
      });
    }
  };
}
