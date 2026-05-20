import React, { useEffect, useMemo, useState } from 'react';

import { FluentIcon } from '../../../../components/FluentIcon.js';
import type { CodexTaskSessionSnapshot } from '../../../../lib/daemon-api.js';
import { createDefaultDaemonClient, getDesktopBridge } from '../../../../lib/desktop-bridge.js';
import { copyTextToClipboard } from '../../../../lib/copy-to-clipboard.js';
import { t } from '../../../../lib/i18n.js';
import { DefaultToolCard } from '../DefaultToolCard.js';
import type { ToolCardProps, ToolUiConfig } from '../types.js';

const pollIntervalMs = 2_000;
const maxPolls = 8;

function DelegateToExternalCard(props: ToolCardProps): React.JSX.Element {
  if (readString(props.item.args.definitionKey) !== 'delegate_to_codex') {
    return <DefaultToolCard {...props} />;
  }

  const taskId = readString(props.item.data?.taskId);
  const [snapshot, setSnapshot] = useState<CodexTaskSessionSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const resumeCommand = useMemo(() => (
    snapshot?.sessionId === undefined ? null : `codex resume --include-non-interactive ${snapshot.sessionId}`
  ), [snapshot?.sessionId]);

  useEffect(() => {
    if (taskId === undefined) {
      return;
    }
    const activeTaskId = taskId;
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const client = await createDefaultDaemonClient();
        if (client.getCodexTaskSession === undefined) {
          throw new Error('Codex task session API is not available');
        }
        const next = await client.getCodexTaskSession(activeTaskId);
        if (!cancelled) {
          setSnapshot(next);
          setLoadError(null);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      }
    }
    void load();
    if (snapshot?.canOpen === true || pollCount >= maxPolls) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setTimeout(() => {
      if (!cancelled) {
        setPollCount((prev) => prev + 1);
      }
    }, pollIntervalMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pollCount, snapshot?.canOpen, taskId]);

  const openSession = async (): Promise<void> => {
    if (snapshot?.sessionId === undefined || opening) {
      return;
    }
    const bridge = getDesktopBridge();
    if (bridge?.openCodexSession === undefined) {
      setActionMessage(t(props.locale, 'codexTaskDesktopBridgeMissing'));
      return;
    }
    setOpening(true);
    setActionMessage(null);
    try {
      await bridge.openCodexSession({
        sessionId: snapshot.sessionId,
        ...(snapshot.locator?.ref === undefined ? {} : { cwd: snapshot.locator.ref })
      });
      setActionMessage(t(props.locale, 'codexTaskOpenStarted'));
    } catch (error: unknown) {
      setActionMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setOpening(false);
    }
  };

  const copySession = async (): Promise<void> => {
    if (resumeCommand === null) {
      return;
    }
    await copyTextToClipboard(resumeCommand);
    setActionMessage(t(props.locale, 'codexTaskResumeCommandCopied'));
  };

  return (
    <div className={`tool-card tool-card--${props.item.status} codex-task-card`} data-tool-call-id={props.item.toolCallId}>
      <button
        type="button"
        className="tool-card__header"
        onClick={props.onToggle}
        aria-expanded={props.expanded}
      >
        <span className={`tool-card__status tool-card__status--${props.item.status}`}>{t(props.locale, statusLabelKey(props.item.status))}</span>
        <span className="tool-card__name">{t(props.locale, 'codexTaskCardTitle')}</span>
        <span className="tool-card__chevron" aria-hidden>{props.expanded ? '▾' : '▸'}</span>
      </button>
      <div className="codex-task-card__summary">
        <div className="codex-task-card__title">{snapshot?.title ?? readString(props.item.args.title) ?? t(props.locale, 'codexTaskUntitled')}</div>
        <div className="codex-task-card__meta">
          {taskId ?? t(props.locale, 'codexTaskWaitingForTaskId')}
          {snapshot?.locator?.label !== undefined ? ` · ${snapshot.locator.label}` : ''}
        </div>
        {snapshot?.promptPreview !== undefined && (
          <div className="codex-task-card__preview">{snapshot.promptPreview}</div>
        )}
        <div className="codex-task-card__actions">
          <button
            type="button"
            className="codex-task-card__action"
            disabled={snapshot?.canOpen !== true || opening}
            onClick={() => { void openSession(); }}
          >
            <FluentIcon aria-hidden name="code" size={14} />
            <span>{opening ? t(props.locale, 'codexTaskOpening') : t(props.locale, 'codexTaskOpenInTerminal')}</span>
          </button>
          <button
            type="button"
            className="codex-task-card__action"
            disabled={resumeCommand === null}
            onClick={() => { void copySession(); }}
          >
            <FluentIcon aria-hidden name="copy" size={14} />
            <span>{t(props.locale, 'codexTaskCopyResumeCommand')}</span>
          </button>
        </div>
        {snapshot?.canOpen === false && taskId !== undefined && (
          <div className="codex-task-card__hint">{t(props.locale, 'codexTaskSessionPending')}</div>
        )}
        {actionMessage !== null && <div className="codex-task-card__hint">{actionMessage}</div>}
        {loadError !== null && <div className="codex-task-card__hint codex-task-card__hint--error">{loadError}</div>}
      </div>
      {props.expanded ? (
        <dl className="codex-task-card__details">
          {resumeCommand !== null && (
            <>
              <dt>{t(props.locale, 'codexTaskResumeCommandLabel')}</dt>
              <dd><code>{resumeCommand}</code></dd>
            </>
          )}
          {snapshot?.finalMessagePreview !== undefined && (
            <>
              <dt>{t(props.locale, 'codexTaskFinalPreviewLabel')}</dt>
              <dd>{snapshot.finalMessagePreview}</dd>
            </>
          )}
        </dl>
      ) : null}
    </div>
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function statusLabelKey(status: ToolCardProps['item']['status']):
  | 'toolCardStatusRunning'
  | 'toolCardStatusSuccess'
  | 'toolCardStatusError'
  | 'toolCardStatusBlocked' {
  switch (status) {
    case 'running': return 'toolCardStatusRunning';
    case 'success': return 'toolCardStatusSuccess';
    case 'error': return 'toolCardStatusError';
    case 'blocked': return 'toolCardStatusBlocked';
  }
}

export const delegateToExternalToolUiConfig: ToolUiConfig = {
  CardComponent: DelegateToExternalCard
};
