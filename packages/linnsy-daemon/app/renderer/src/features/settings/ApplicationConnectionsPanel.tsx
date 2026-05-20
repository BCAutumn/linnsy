import React from 'react';

import type { ChatStateSetter } from '../../stores/chat-app-state.js';
import { ActionButtons } from '../../components/ActionButtons.js';
import { ToggleSwitch } from '../../components/ToggleSwitch.js';
import type { CodexThreadMetadata, DaemonApiClient } from '../../lib/daemon-api.js';
import { copyTextToClipboard } from '../../lib/copy-to-clipboard.js';
import { getDesktopBridge } from '../../lib/desktop-bridge.js';
import { t, type Locale } from '../../lib/i18n.js';
import {
  createApplicationConnectionsSnapshot,
  type ApplicationConnectionsSnapshot
} from '@renderer/contracts';
import { ConnectionStatus } from '../../shell/Sidebar.js';
import { SettingRow, SettingsSection } from './SettingsLayout.js';
import {
  describeCodexConnection,
  getCodexConnectionActionLabel,
  getCodexStatusTone
} from './application-connections-status.js';
import {
  buildCodexThreadResumeCommand,
  getCodexThreadMeta,
  getCodexThreadTitle
} from './codex-recent-threads.js';

export function ApplicationConnectionsPanel(props: {
  applicationConnections: ApplicationConnectionsSnapshot | null;
  client: DaemonApiClient | null;
  locale: Locale;
  setState: ChatStateSetter;
}): React.JSX.Element {
  const [checking, setChecking] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [threadState, setThreadState] = React.useState<CodexRecentThreadsState>({
    loading: false,
    threads: null,
    message: null
  });
  const codex = props.applicationConnections?.codex ?? null;
  const canProbeCodex = props.client !== null && !checking;

  return (
    <div className="settings-stack">
      <SettingsSection>
        <div className="application-connection-group application-connection-group--codex">
          <h3 className="application-connection-heading">{t(props.locale, 'appConnectionCodex')}</h3>
          <SettingRow
            label={t(props.locale, 'codexConnectionEntry')}
            description={(
              <ConnectionStatus
                label={describeCodexConnection(props.locale, codex, checking)}
                online={getCodexStatusTone(codex) === 'online'}
              />
            )}
          >
            <ActionButtons
              isPrimaryActionDisabled={!canProbeCodex}
              onPrimaryAction={() => {
                void probeCodexConnection({
                  client: props.client,
                  locale: props.locale,
                  setChecking,
                  setMessage,
                  setState: props.setState
                });
              }}
              primaryActionText={getCodexConnectionActionLabel(props.locale, checking)}
              showSecondaryAction={false}
              size="sm"
            />
          </SettingRow>
          <SettingRow
            label={t(props.locale, 'codexAutoConnect')}
            description={t(props.locale, 'codexAutoConnectDescription')}
          >
            <ToggleSwitch
              checked={false}
              disabled
              label={t(props.locale, 'codexAutoConnect')}
              onChange={() => {}}
            />
          </SettingRow>
          <CodexRecentThreads
            client={props.client}
            locale={props.locale}
            state={threadState}
            setState={setThreadState}
          />
        </div>
        <UnsupportedApplicationConnection locale={props.locale} label={t(props.locale, 'appConnectionClaudeCode')} />
        <UnsupportedApplicationConnection locale={props.locale} label={t(props.locale, 'appConnectionCursor')} />
      </SettingsSection>
      {message === null ? null : <p className="field-error">{message}</p>}
    </div>
  );
}

interface CodexRecentThreadsState {
  loading: boolean;
  threads: CodexThreadMetadata[] | null;
  message: string | null;
}

function CodexRecentThreads(props: {
  client: DaemonApiClient | null;
  locale: Locale;
  state: CodexRecentThreadsState;
  setState: React.Dispatch<React.SetStateAction<CodexRecentThreadsState>>;
}): React.JSX.Element {
  const canLoad = props.client !== null && !props.state.loading;
  return (
    <div className="codex-recent-threads">
      <div className="codex-recent-threads__header">
        <div>
          <h4>{t(props.locale, 'codexRecentThreadsTitle')}</h4>
          <p>{t(props.locale, 'codexRecentThreadsDescription')}</p>
        </div>
        <ActionButtons
          isPrimaryActionDisabled={!canLoad}
          onPrimaryAction={() => {
            void loadRecentCodexThreads({
              client: props.client,
              locale: props.locale,
              setState: props.setState
            });
          }}
          primaryActionText={props.state.loading
            ? t(props.locale, 'codexRecentThreadsLoading')
            : t(props.locale, 'codexRecentThreadsLoad')}
          showSecondaryAction={false}
          size="sm"
        />
      </div>
      {props.state.message === null ? null : (
        <p className="codex-recent-threads__message">{props.state.message}</p>
      )}
      {props.state.threads === null ? null : (
        props.state.threads.length === 0
          ? <p className="codex-recent-threads__empty">{t(props.locale, 'codexRecentThreadsEmpty')}</p>
          : (
            <ul className="codex-recent-threads__list">
              {props.state.threads.map((thread) => (
                <CodexRecentThreadRow
                  key={thread.id}
                  locale={props.locale}
                  thread={thread}
                  setMessage={(nextMessage) => {
                    props.setState((current) => ({ ...current, message: nextMessage }));
                  }}
                />
              ))}
            </ul>
          )
      )}
    </div>
  );
}

function CodexRecentThreadRow(props: {
  locale: Locale;
  thread: CodexThreadMetadata;
  setMessage(message: string | null): void;
}): React.JSX.Element {
  const openThread = async (): Promise<void> => {
    const bridge = getDesktopBridge();
    if (bridge?.openCodexSession === undefined) {
      props.setMessage(t(props.locale, 'codexTaskDesktopBridgeMissing'));
      return;
    }
    try {
      await bridge.openCodexSession({
        sessionId: props.thread.id,
        ...(props.thread.cwd === undefined ? {} : { cwd: props.thread.cwd })
      });
      props.setMessage(t(props.locale, 'codexTaskOpenStarted'));
    } catch (error: unknown) {
      props.setMessage(readErrorMessage(error));
    }
  };

  const copyResumeCommand = async (): Promise<void> => {
    try {
      await copyTextToClipboard(buildCodexThreadResumeCommand(props.thread));
      props.setMessage(t(props.locale, 'codexTaskResumeCommandCopied'));
    } catch (error: unknown) {
      props.setMessage(readErrorMessage(error));
    }
  };

  return (
    <li className="codex-recent-threads__row">
      <div className="codex-recent-threads__text">
        <span className="codex-recent-threads__title">{getCodexThreadTitle(props.thread, props.locale)}</span>
        <span className="codex-recent-threads__meta">{getCodexThreadMeta(props.thread, props.locale)}</span>
      </div>
      <div className="codex-recent-threads__actions">
        <button type="button" onClick={() => { void openThread(); }}>
          {t(props.locale, 'codexRecentThreadsOpen')}
        </button>
        <button type="button" onClick={() => { void copyResumeCommand(); }}>
          {t(props.locale, 'codexRecentThreadsCopy')}
        </button>
      </div>
    </li>
  );
}

async function loadRecentCodexThreads(input: {
  client: DaemonApiClient | null;
  locale: Locale;
  setState: React.Dispatch<React.SetStateAction<CodexRecentThreadsState>>;
}): Promise<void> {
  if (input.client === null || input.client.listRecentCodexThreads === undefined) {
    input.setState((current) => ({
      ...current,
      message: t(input.locale, 'applicationConnectionsDaemonUnavailable')
    }));
    return;
  }

  input.setState((current) => ({ ...current, loading: true, message: null }));
  try {
    const threads = await input.client.listRecentCodexThreads(8);
    input.setState({
      loading: false,
      threads,
      message: null
    });
  } catch (error: unknown) {
    input.setState((current) => ({
      ...current,
      loading: false,
      message: t(input.locale, 'codexRecentThreadsLoadFailed', { error: readErrorMessage(error) })
    }));
  }
}

async function probeCodexConnection(input: {
  client: DaemonApiClient | null;
  locale: Locale;
  setChecking: React.Dispatch<React.SetStateAction<boolean>>;
  setMessage: React.Dispatch<React.SetStateAction<string | null>>;
  setState: ChatStateSetter;
}): Promise<void> {
  if (input.client === null) {
    input.setMessage(t(input.locale, 'applicationConnectionsDaemonUnavailable'));
    return;
  }
  input.setChecking(true);
  input.setMessage(null);
  try {
    const codex = await input.client.probeCodexConnection();
    input.setState((current) => ({
      ...current,
      applicationConnections: current.applicationConnections === null
        ? createApplicationConnectionsSnapshot({ codex })
        : {
          ...current.applicationConnections,
          codex
        }
    }));
  } catch (error: unknown) {
    input.setMessage(t(input.locale, 'applicationConnectionsProbeFailed', { error: readErrorMessage(error) }));
  } finally {
    input.setChecking(false);
  }
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function UnsupportedApplicationConnection(props: {
  locale: Locale;
  label: string;
}): React.JSX.Element {
  return (
    <div className="application-connection-group application-connection-group--unsupported">
      <h3 className="application-connection-heading">{props.label}</h3>
      <p className="application-connection-unsupported">{t(props.locale, 'terminalUnsupported')}</p>
    </div>
  );
}
