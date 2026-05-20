export interface ObservabilityMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ObservabilityMcpToolRegistry {
  list(): ObservabilityMcpTool[];
  invoke(name: string, args: unknown): Promise<Record<string, unknown>>;
}

export interface MessageIngressPort {
  send(input: {
    conversationId: string;
    text: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ ok: true; messageId: string; runId?: string }>;
}
