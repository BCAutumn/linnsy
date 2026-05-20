import {
  applicationConnectionsResponseSchema,
  codexRecentThreadsResponseSchema,
  codexThreadProjectsResponseSchema,
  codexTaskSessionResponseSchema,
  codexConnectionProbeResponseSchema,
  conversationEventsResponseSchema,
  conversationResponseSchema,
  createdConversationResponseSchema,
  cronJobResponseSchema,
  cronListResponseSchema,
  cronRunOutputResponseSchema,
  cronRunsResponseSchema,
  deleteConversationResponseSchema,
  deleteCronResponseSchema,
  deleteMemoryItemResponseSchema,
  listConversationsResponseSchema,
  listMemoryItemsResponseSchema,
  memoryItemResponseSchema,
  messagesResponseSchema,
  modelSettingsResponseSchema,
  okResponseSchema,
  systemPromptPreviewResponseSchema,
  terminalBindingResponseSchema,
  uiPreferencesResponseSchema,
  updateCronResponseSchema,
  type ApplicationConnectionsSnapshot,
  type CodexConnectionState,
  type CodexTaskSessionSnapshot,
  type CodexThreadMetadata,
  type CodexThreadProject,
  type ConversationMessage,
  type ConversationSummary,
  type CreateCronInput,
  type CronListEntry,
  type CronRunOutputResponse,
  type CronRunSummary,
  type ListMemoryItemsOptions,
  type MemoryItem,
  type MemoryItemWriteInput,
  type ModelSettings,
  type SendDesktopMessageInput,
  type SystemPromptPreview,
  type TerminalBindingSnapshot,
  type UiPreferences,
  type UserModelWriteInput
} from '@renderer/contracts';

import { conversationUrl, createMemoryItemsQuerySuffix, requestJson } from './daemon-http.js';
import {
  openRuntimeEventStream,
  type RuntimeClientEvent,
  type RuntimeEventStream,
  type RuntimeEventStreamHandlers
} from './runtime-event-stream.js';

export interface DaemonApiClientOptions {
  baseUrl: string;
  bearerToken: string;
  fetchFn?: typeof fetch;
}

export interface DaemonApiClient {
  listConversations(): Promise<ConversationSummary[]>;
  createDesktopConversation(): Promise<ConversationSummary>;
  renameConversation(conversationId: string, title: string | null): Promise<ConversationSummary>;
  setConversationPinned(conversationId: string, pinned: boolean): Promise<ConversationSummary>;
  archiveConversation(conversationId: string): Promise<ConversationSummary>;
  deleteConversation(conversationId: string): Promise<boolean>;
  getTerminalBinding(): Promise<TerminalBindingSnapshot>;
  updateTerminalBinding(conversationId: string): Promise<TerminalBindingSnapshot>;
  getApplicationConnections(): Promise<ApplicationConnectionsSnapshot>;
  probeCodexConnection(): Promise<CodexConnectionState>;
  getCodexTaskSession?(taskId: string): Promise<CodexTaskSessionSnapshot>;
  listCodexThreadProjects?(limit?: number): Promise<CodexThreadProject[]>;
  listRecentCodexThreads?(limit?: number, options?: {
    cwd?: string;
    includeChildDirectories?: boolean;
  }): Promise<CodexThreadMetadata[]>;
  readMessages(conversationId: string): Promise<ConversationMessage[]>;
  // 拉取持久化的"对话流元素"事件流（工具调用 / 子 agent / 系统事件等），
  // 与 readMessages 平行，用于刷新页面后 hydrate 投影状态。
  readEvents(conversationId: string, options?: { sinceSeq?: number; limit?: number }): Promise<RuntimeClientEvent[]>;
  sendDesktopMessage(input: SendDesktopMessageInput): Promise<void>;
  openEventStream(handlers: RuntimeEventStreamHandlers): RuntimeEventStream;
  getUiPreferences(): Promise<UiPreferences>;
  setUiPreference<K extends keyof UiPreferences>(key: K, value: UiPreferences[K]): Promise<void>;
  resetUiPreferences(): Promise<UiPreferences>;
  getModelSettings(): Promise<ModelSettings>;
  saveModelSettings(input: { chatModelId: string | null; userModels: UserModelWriteInput[] }): Promise<ModelSettings>;
  listMemoryItems(options?: ListMemoryItemsOptions): Promise<MemoryItem[]>;
  getSystemPromptPreview(): Promise<SystemPromptPreview>;
  createMemoryItem(input: MemoryItemWriteInput): Promise<MemoryItem>;
  updateMemoryItem(memoryId: string, input: MemoryItemWriteInput): Promise<MemoryItem>;
  deleteMemoryItem(memoryId: string): Promise<boolean>;
  listCron(): Promise<CronListEntry[]>;
  createCron(input: CreateCronInput): Promise<CronListEntry>;
  deleteCron(jobId: string): Promise<boolean>;
  setCronEnabled(jobId: string, enabled: boolean): Promise<boolean>;
  listCronRuns(jobId: string, limit?: number): Promise<CronRunSummary[]>;
  getCronRunOutput(jobId: string, cronRunId: string): Promise<CronRunOutputResponse>;
}

export function createDaemonApiClient(options: DaemonApiClientOptions): DaemonApiClient {
  const fetchFn = options.fetchFn ?? fetch;
  const headers = {
    Authorization: `Bearer ${options.bearerToken}`
  };

  return {
    async listConversations() {
      const body = await requestJson(fetchFn, `${options.baseUrl}/api/v1/conversations`, headers, listConversationsResponseSchema);
      return body.conversations;
    },
    async createDesktopConversation() {
      const body = await requestJson(fetchFn, `${options.baseUrl}/api/v1/conversations`, headers, createdConversationResponseSchema, {
        method: 'POST',
        body: JSON.stringify({})
      });
      return body.conversation;
    },
    async renameConversation(conversationId, title) {
      const body = await requestJson(fetchFn, conversationUrl(options.baseUrl, conversationId), headers, conversationResponseSchema, {
        method: 'PATCH',
        body: JSON.stringify({ title })
      });
      return body.conversation;
    },
    async setConversationPinned(conversationId, pinned) {
      const body = await requestJson(fetchFn, conversationUrl(options.baseUrl, conversationId), headers, conversationResponseSchema, {
        method: 'PATCH',
        body: JSON.stringify({ pinned })
      });
      return body.conversation;
    },
    async archiveConversation(conversationId) {
      const body = await requestJson(
        fetchFn,
        `${conversationUrl(options.baseUrl, conversationId)}/archive`,
        headers,
        conversationResponseSchema,
        { method: 'POST' }
      );
      return body.conversation;
    },
    async deleteConversation(conversationId) {
      const body = await requestJson(fetchFn, conversationUrl(options.baseUrl, conversationId), headers, deleteConversationResponseSchema, { method: 'DELETE' });
      return body.deleted;
    },
    async getTerminalBinding() {
      const body = await requestJson(fetchFn, `${options.baseUrl}/api/v1/terminal-binding`, headers, terminalBindingResponseSchema);
      return body.binding;
    },
    async updateTerminalBinding(conversationId) {
      const body = await requestJson(fetchFn, `${options.baseUrl}/api/v1/terminal-binding`, headers, terminalBindingResponseSchema, {
        method: 'PUT',
        body: JSON.stringify({ conversationId })
      });
      return body.binding;
    },
    async getApplicationConnections() {
      const body = await requestJson(fetchFn, `${options.baseUrl}/api/v1/application-connections`, headers, applicationConnectionsResponseSchema);
      return body.connections;
    },
    async probeCodexConnection() {
      const body = await requestJson(fetchFn, `${options.baseUrl}/api/v1/application-connections/codex/probe`, headers, codexConnectionProbeResponseSchema, { method: 'POST' });
      return body.codex;
    },
    async getCodexTaskSession(taskId) {
      const body = await requestJson(
        fetchFn,
        `${options.baseUrl}/api/v1/codex/tasks/${encodeURIComponent(taskId)}/session`,
        headers,
        codexTaskSessionResponseSchema
      );
      return body.session;
    },
    async listCodexThreadProjects(limit) {
      const query = limit === undefined ? '' : `?limit=${encodeURIComponent(String(limit))}`;
      const body = await requestJson(
        fetchFn,
        `${options.baseUrl}/api/v1/codex/projects${query}`,
        headers,
        codexThreadProjectsResponseSchema
      );
      return body.projects;
    },
    async listRecentCodexThreads(limit, listOptions = {}) {
      const params = new URLSearchParams();
      if (limit !== undefined) params.set('limit', String(limit));
      if (listOptions.cwd !== undefined) params.set('cwd', listOptions.cwd);
      if (listOptions.includeChildDirectories !== undefined) {
        params.set('includeChildDirectories', String(listOptions.includeChildDirectories));
      }
      const query = params.toString();
      const body = await requestJson(
        fetchFn,
        `${options.baseUrl}/api/v1/codex/threads/recent${query.length === 0 ? '' : `?${query}`}`,
        headers,
        codexRecentThreadsResponseSchema
      );
      return body.threads;
    },
    async readMessages(conversationId) {
      const body = await requestJson(
        fetchFn,
        `${conversationUrl(options.baseUrl, conversationId)}/messages?limit=80`,
        headers,
        messagesResponseSchema
      );
      return body.messages;
    },
    async readEvents(conversationId, opts = {}) {
      const params = new URLSearchParams();
      if (opts.limit !== undefined) params.set('limit', String(opts.limit));
      if (opts.sinceSeq !== undefined) params.set('sinceSeq', String(opts.sinceSeq));
      const query = params.toString();
      const body = await requestJson(
        fetchFn,
        `${conversationUrl(options.baseUrl, conversationId)}/events${query.length === 0 ? '' : `?${query}`}`,
        headers,
        conversationEventsResponseSchema
      );
      return body.events;
    },
    async sendDesktopMessage(input) {
      await requestJson(fetchFn, `${options.baseUrl}/api/v1/desktop/messages`, headers, okResponseSchema, {
        method: 'POST',
        body: JSON.stringify({
          text: input.text,
          ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
          ...(input.chatId === undefined ? {} : { chatId: input.chatId }),
          ...(input.metadata === undefined ? {} : { metadata: input.metadata })
        })
      });
    },
    openEventStream(handlers) {
      return openRuntimeEventStream({
        baseUrl: options.baseUrl,
        bearerToken: options.bearerToken,
        handlers
      });
    },
    async listCron() {
      const body = await requestJson(fetchFn, `${options.baseUrl}/api/v1/cron`, headers, cronListResponseSchema);
      return body.jobs;
    },
    async createCron(input) {
      const body = await requestJson(fetchFn, `${options.baseUrl}/api/v1/cron`, headers, cronJobResponseSchema, {
        method: 'POST',
        body: JSON.stringify(input)
      });
      return body.job;
    },
    async deleteCron(jobId) {
      const body = await requestJson(fetchFn, `${options.baseUrl}/api/v1/cron/${encodeURIComponent(jobId)}`, headers, deleteCronResponseSchema, { method: 'DELETE' });
      return body.deleted;
    },
    async setCronEnabled(jobId, enabled) {
      const body = await requestJson(fetchFn, `${options.baseUrl}/api/v1/cron/${encodeURIComponent(jobId)}`, headers, updateCronResponseSchema, {
        method: 'PATCH',
        body: JSON.stringify({ enabled })
      });
      return body.updated;
    },
    async listCronRuns(jobId, limit) {
      const query = limit === undefined ? '' : `?limit=${encodeURIComponent(String(limit))}`;
      const body = await requestJson(fetchFn, `${options.baseUrl}/api/v1/cron/${encodeURIComponent(jobId)}/runs${query}`, headers, cronRunsResponseSchema);
      return body.runs;
    },
    async getCronRunOutput(jobId, cronRunId) {
      const body = await requestJson(
        fetchFn,
        `${options.baseUrl}/api/v1/cron/${encodeURIComponent(jobId)}/runs/${encodeURIComponent(cronRunId)}/output`,
        headers,
        cronRunOutputResponseSchema
      );
      return {
        jobId: body.jobId,
        cronRunId: body.cronRunId,
        run: body.run,
        output: body.output
      };
    },
    async getUiPreferences() {
      const body = await requestJson(fetchFn, `${options.baseUrl}/api/v1/ui-preferences`, headers, uiPreferencesResponseSchema);
      return body.preferences;
    },
    async setUiPreference(key, value) {
      await requestJson(fetchFn, `${options.baseUrl}/api/v1/ui-preferences/${encodeURIComponent(key)}`, headers, okResponseSchema, {
        method: 'PUT',
        body: JSON.stringify({ value })
      });
    },
    async resetUiPreferences() {
      const body = await requestJson(fetchFn, `${options.baseUrl}/api/v1/ui-preferences/reset`, headers, uiPreferencesResponseSchema, { method: 'POST' });
      return body.preferences;
    },
    async getModelSettings() {
      const body = await requestJson(fetchFn, `${options.baseUrl}/api/v1/models/settings`, headers, modelSettingsResponseSchema);
      return body.settings;
    },
    async saveModelSettings(input) {
      const body = await requestJson(fetchFn, `${options.baseUrl}/api/v1/models/settings`, headers, modelSettingsResponseSchema, {
        method: 'PUT',
        body: JSON.stringify(input)
      });
      return body.settings;
    },
    async listMemoryItems(listOptions = {}) {
      const suffix = createMemoryItemsQuerySuffix(listOptions);
      const body = await requestJson(fetchFn, `${options.baseUrl}/api/v1/memory/items${suffix}`, headers, listMemoryItemsResponseSchema);
      return body.items;
    },
    async getSystemPromptPreview() {
      const body = await requestJson(fetchFn, `${options.baseUrl}/api/v1/memory/system-prompt-preview`, headers, systemPromptPreviewResponseSchema);
      return body.preview;
    },
    async createMemoryItem(input) {
      const body = await requestJson(fetchFn, `${options.baseUrl}/api/v1/memory/items`, headers, memoryItemResponseSchema, {
        method: 'POST',
        body: JSON.stringify(input)
      });
      return body.item;
    },
    async updateMemoryItem(memoryId, input) {
      const body = await requestJson(fetchFn, `${options.baseUrl}/api/v1/memory/items/${encodeURIComponent(memoryId)}`, headers, memoryItemResponseSchema, {
        method: 'PUT',
        body: JSON.stringify(input)
      });
      return body.item;
    },
    async deleteMemoryItem(memoryId) {
      const body = await requestJson(fetchFn, `${options.baseUrl}/api/v1/memory/items/${encodeURIComponent(memoryId)}`, headers, deleteMemoryItemResponseSchema, { method: 'DELETE' });
      return body.removed;
    }
  };
}
