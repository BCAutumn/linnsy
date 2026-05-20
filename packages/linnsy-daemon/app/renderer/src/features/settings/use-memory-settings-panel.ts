import { useCallback, useEffect, useMemo, useState } from 'react';

import type { DaemonApiClient, MemoryItem, SystemPromptPreview } from '../../lib/daemon-api.js';
import { t, type Locale } from '../../lib/i18n.js';
import {
  applySystemPromptPreviewToDraft,
  createMemoryDraftFromItem,
  defaultMemoryItemDraft,
  isMemoryScopePreset,
  loadMemoryItems,
  loadSystemPromptPreview,
  readMemoryErrorMessage,
  saveMemoryDraftToDaemon,
  selectMemoryDraftForScope,
  upsertMemoryItem,
  validateMemoryDraft,
  type MemoryItemDraft,
  type MemoryScopePreset
} from './memory-settings.js';
import type { MemoryEditorMode } from './MemorySettingsEditorDialog.js';

export interface MemorySettingsPanelState {
  busy: boolean;
  draft: MemoryItemDraft;
  editorMode: MemoryEditorMode;
  message: string | null;
  modalDraft: MemoryItemDraft | null;
  selectedItem: MemoryItem | null;
  selectedScope: MemoryScopePreset;
  systemPromptPreview: SystemPromptPreview | null;
  closeEditor(): void;
  editCurrentDraft(): void;
  saveDraft(): Promise<void>;
  selectScope(scope: MemoryScopePreset): void;
  setEditorMode(mode: MemoryEditorMode): void;
  setModalDraft(draft: MemoryItemDraft): void;
  toggleEnabled(enabled: boolean): Promise<void>;
}

export function useMemorySettingsPanel(input: {
  client: DaemonApiClient | null;
  locale: Locale;
}): MemorySettingsPanelState {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MemoryItemDraft>(defaultMemoryItemDraft);
  const [modalDraft, setModalDraft] = useState<MemoryItemDraft | null>(null);
  const [editorMode, setEditorMode] = useState<MemoryEditorMode>('wysiwyg');
  const [selectedScope, setSelectedScope] = useState<MemoryScopePreset>('system_prompt');
  const [systemPromptPreview, setSystemPromptPreview] = useState<SystemPromptPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selectedItem = useMemo(
    () => selectedId === null ? null : items.find((item) => item.memoryId === selectedId) ?? null,
    [items, selectedId]
  );

  const reloadMemoryState = useCallback(async (shouldApply?: () => boolean): Promise<void> => {
    const [nextItems, nextPreview] = await Promise.all([
      loadMemoryItems(input.client),
      loadSystemPromptPreview(input.client)
    ]);
    if (shouldApply?.() === false) {
      return;
    }
    const nextSelection = selectMemoryDraftForScope(nextItems, selectedScope, nextPreview);
    setItems(nextItems);
    setSystemPromptPreview(nextPreview);
    setSelectedId(nextSelection.item?.memoryId ?? null);
    setDraft(nextSelection.draft);
  }, [input.client, selectedScope]);

  useEffect(() => {
    let mounted = true;
    void reloadMemoryState(() => mounted)
      .catch((error: unknown) => {
        if (mounted) setMessage(readMemoryErrorMessage(error, input.locale));
      });
    return () => {
      mounted = false;
    };
  }, [input.locale, reloadMemoryState]);

  useEffect(() => {
    if (input.client === null || modalDraft !== null) {
      return undefined;
    }
    let cancelled = false;
    const refreshVisibleMemory = (): void => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      void reloadMemoryState(() => !cancelled).catch((error: unknown) => {
        if (!cancelled) setMessage(readMemoryErrorMessage(error, input.locale));
      });
    };
    // 记忆可能由对话里的 manage_memory 工具写入；主人回到设置页时要重新读取后端权威 preview。
    window.addEventListener('focus', refreshVisibleMemory);
    document.addEventListener('visibilitychange', refreshVisibleMemory);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshVisibleMemory);
      document.removeEventListener('visibilitychange', refreshVisibleMemory);
    };
  }, [input.client, input.locale, modalDraft, reloadMemoryState]);


  return {
    busy,
    draft,
    editorMode,
    message,
    modalDraft,
    selectedItem,
    selectedScope,
    systemPromptPreview,
    closeEditor() {
      setModalDraft(null);
      setMessage(null);
    },
    editCurrentDraft() {
      setModalDraft(draft);
      setEditorMode('wysiwyg');
      setMessage(null);
    },
    async saveDraft() {
      if (modalDraft === null) {
        return;
      }
      await saveMemoryDraft({
        client: input.client,
        draft: modalDraft,
        locale: input.locale,
        setBusy,
        setDraft,
        setItems,
        setMessage,
        setSelectedId,
        setSelectedScope,
        refreshSystemPromptPreview: () => refreshSystemPromptPreview({
          client: input.client,
          locale: input.locale,
          setMessage,
          setSystemPromptPreview
        }),
        afterSave: () => {
          setModalDraft(null);
        }
      });
    },
    selectScope(scope) {
      const nextSelection = selectMemoryDraftForScope(items, scope, systemPromptPreview);
      setSelectedScope(scope);
      setSelectedId(nextSelection.item?.memoryId ?? null);
      setDraft(nextSelection.draft);
      setMessage(null);
    },
    setEditorMode,
    setModalDraft,
    async toggleEnabled(enabled) {
      await saveMemoryEnabled({
        client: input.client,
        draft,
        enabled,
        locale: input.locale,
        setBusy,
        setDraft,
        setItems,
        setMessage,
        setSelectedId,
        setSystemPromptPreview
      });
    }
  };
}

async function saveMemoryEnabled(input: {
  client: DaemonApiClient | null;
  draft: MemoryItemDraft;
  enabled: boolean;
  locale: Locale;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setDraft: React.Dispatch<React.SetStateAction<MemoryItemDraft>>;
  setItems: React.Dispatch<React.SetStateAction<MemoryItem[]>>;
  setMessage: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  setSystemPromptPreview?: React.Dispatch<React.SetStateAction<SystemPromptPreview | null>>;
}): Promise<void> {
  if (input.client === null || input.draft.memoryId === undefined) {
    input.setMessage(t(input.locale, 'memoryDaemonUnavailable'));
    return;
  }
  const nextDraft = setMemoryDraftEnabled(input.draft, input.enabled);
  input.setBusy(true);
  input.setMessage(null);
  try {
    const saved = await saveMemoryDraftToDaemon(input.client, nextDraft);
    input.setItems((current) => upsertMemoryItem(current, saved));
    input.setSelectedId(saved.memoryId);
    let refreshedPreview: SystemPromptPreview | null = null;
    if (input.setSystemPromptPreview !== undefined) {
      refreshedPreview = await refreshSystemPromptPreview({
        client: input.client,
        locale: input.locale,
        setMessage: input.setMessage,
        setSystemPromptPreview: input.setSystemPromptPreview
      });
    }
    input.setDraft(applySystemPromptPreviewToDraft(createMemoryDraftFromItem(saved), refreshedPreview));
  } catch (error: unknown) {
    input.setMessage(readMemoryErrorMessage(error, input.locale));
  } finally {
    input.setBusy(false);
  }
}

async function saveMemoryDraft(input: {
  client: DaemonApiClient | null;
  draft: MemoryItemDraft;
  locale: Locale;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setItems: React.Dispatch<React.SetStateAction<MemoryItem[]>>;
  setMessage: React.Dispatch<React.SetStateAction<string | null>>;
  setDraft: React.Dispatch<React.SetStateAction<MemoryItemDraft>>;
  setSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedScope: React.Dispatch<React.SetStateAction<MemoryScopePreset>>;
  refreshSystemPromptPreview: () => Promise<SystemPromptPreview | null>;
  afterSave: () => void;
}): Promise<void> {
  if (input.client === null) {
    input.setMessage(t(input.locale, 'memoryDaemonUnavailable'));
    return;
  }
  const invalidField = validateMemoryDraft(input.draft);
  if (invalidField !== null) {
    input.setMessage(t(input.locale, invalidField === 'bodyLimit' ? 'memoryBodyLimitExceeded' : 'memoryInvalid'));
    return;
  }

  input.setBusy(true);
  input.setMessage(null);
  try {
    const saved = await saveMemoryDraftToDaemon(input.client, input.draft);
    input.setItems((current) => upsertMemoryItem(current, saved));
    input.setSelectedId(saved.memoryId);
    if (isMemoryScopePreset(saved.scope)) {
      input.setSelectedScope(saved.scope);
    }
    const refreshedPreview = await input.refreshSystemPromptPreview();
    input.setDraft(applySystemPromptPreviewToDraft(createMemoryDraftFromItem(saved), refreshedPreview));
    input.afterSave();
  } catch (error: unknown) {
    input.setMessage(readMemoryErrorMessage(error, input.locale));
  } finally {
    input.setBusy(false);
  }
}

async function refreshSystemPromptPreview(input: {
  client: DaemonApiClient | null;
  locale: Locale;
  setMessage: React.Dispatch<React.SetStateAction<string | null>>;
  setSystemPromptPreview: React.Dispatch<React.SetStateAction<SystemPromptPreview | null>>;
}): Promise<SystemPromptPreview | null> {
  try {
    const preview = await loadSystemPromptPreview(input.client);
    input.setSystemPromptPreview(preview);
    return preview;
  } catch (error: unknown) {
    input.setMessage(readMemoryErrorMessage(error, input.locale));
    return null;
  }
}

function setMemoryDraftEnabled(draft: MemoryItemDraft, enabled: boolean): MemoryItemDraft {
  return {
    ...draft,
    metadata: {
      ...(draft.metadata ?? {}),
      enabled
    }
  };
}
