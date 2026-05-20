export interface MockChannelMessage {
  conversationId: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface MockChannel {
  id: string;
  sent: MockChannelMessage[];
  send(message: MockChannelMessage): Promise<void>;
  pushInbound(message: MockChannelMessage): void;
  drainInbound(): MockChannelMessage[];
}

export function createMockChannel(id: string): MockChannel {
  const inbound: MockChannelMessage[] = [];
  const sent: MockChannelMessage[] = [];

  return {
    id,
    sent,
    send(message: MockChannelMessage): Promise<void> {
      sent.push(message);
      return Promise.resolve();
    },
    pushInbound(message: MockChannelMessage): void {
      inbound.push(message);
    },
    drainInbound(): MockChannelMessage[] {
      return inbound.splice(0, inbound.length);
    }
  };
}
