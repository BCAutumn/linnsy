import type { CodexThreadMetadata } from '../../lib/daemon-api.js';
import type { Locale } from '../../lib/i18n.js';

export function buildCodexThreadResumeCommand(thread: Pick<CodexThreadMetadata, 'id'>): string {
  return `codex resume --include-non-interactive ${thread.id}`;
}

export function getCodexThreadTitle(thread: CodexThreadMetadata, locale: Locale): string {
  if (thread.threadName !== undefined && thread.threadName.trim().length > 0) {
    return thread.threadName;
  }
  return locale === 'zh-CN' ? '未命名 Codex 对话' : 'Untitled Codex thread';
}

export function getCodexThreadMeta(thread: CodexThreadMetadata, locale: Locale): string {
  const parts = [
    formatUpdatedAt(thread.updatedAt, locale),
    thread.cwd,
    thread.source
  ].filter((part): part is string => part !== undefined && part.length > 0);
  return parts.join(' · ');
}

function formatUpdatedAt(updatedAt: number, locale: Locale): string {
  return new Date(updatedAt).toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}
