export interface TerminalBindingRecord {
  terminalId: string;
  conversationId: string;
  updatedAt: number;
  updatedBy: string;
}

export interface TerminalBindingStorePort {
  get(terminalId: string): Promise<TerminalBindingRecord | null>;
  upsert(record: TerminalBindingRecord): Promise<void>;
}
