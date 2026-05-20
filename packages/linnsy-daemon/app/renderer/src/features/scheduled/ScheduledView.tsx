import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { CreateCronInput } from '../../lib/daemon-api.js';
import type { ChatAppState, ChatStateSetter } from '../../stores/chat-app-state.js';
import { selectConversation } from '../../lib/conversations/hydrate-actions.js';
import { t } from '../../lib/i18n.js';
import { ScrollArea } from '../../components/ScrollArea.js';
import type { LastRunByJob } from './scheduled-view-model.js';
import { hydrateAllHistories } from './scheduled-history-hydration.js';
import { formatScheduledLoadError, toScheduledLoadError } from './scheduled-load-error.js';
import type { HistoryState, LoadState, OutputState } from './scheduled-view-types.js';
import { ScheduledReminderList } from './ScheduledReminderList.js';

export type { ScheduledHistoryContext } from './scheduled-view-types.js';

export function ScheduledView(props: {
  state: ChatAppState;
  setState?: ChatStateSetter;
}): React.JSX.Element {
  const locale = props.state.preferences.language;
  const navigate = useNavigate();
  const [loadState, setLoadState] = useState<LoadState>({
    status: 'idle',
    reminders: [],
    error: null
  });
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [historyByJob, setHistoryByJob] = useState<Record<string, HistoryState>>({});
  const [outputsByRun, setOutputsByRun] = useState<Record<string, OutputState>>({});
  const client = props.state.client;

  const lastRunByJob = useMemo<LastRunByJob>(() => {
    const result: LastRunByJob = {};
    for (const [jobId, state] of Object.entries(historyByJob)) {
      if (state.status === 'ready') {
        result[jobId] = state.runs[0] ?? null;
      }
    }
    return result;
  }, [historyByJob]);

  async function reload(): Promise<void> {
    if (client === null) {
      setLoadState({
        status: 'error',
        reminders: [],
        error: { kind: 'i18n', key: 'tasksRemindersDaemonUnavailable' }
      });
      return;
    }
    setLoadState((current) => ({ ...current, status: 'loading', error: null }));
    try {
      const reminders = await client.listCron();
      setLoadState({ status: 'ready', reminders, error: null });
      void hydrateAllHistories(client, reminders, setHistoryByJob, setOutputsByRun);
    } catch (error: unknown) {
      setLoadState((current) => ({
        ...current,
        status: 'error',
        error: toScheduledLoadError(error)
      }));
    }
  }

  const onOpenConversation = useCallback((conversationId: string, _finishedAt?: number): void => {
    void _finishedAt;
    if (props.setState !== undefined && client !== null) {
      void selectConversation(conversationId, props.state, props.setState).then(() => {
        navigate('/chat');
      });
      return;
    }
    navigate('/chat');
  }, [client, navigate, props.setState, props.state]);

  const skipInactiveDeleteConfirm = props.state.preferences['scheduled.skip_inactive_delete_confirm'];
  const onSetSkipInactiveDeleteConfirm = useCallback(async (next: boolean): Promise<void> => {
    if (client === null) return;
    await client.setUiPreference('scheduled.skip_inactive_delete_confirm', next);
    if (props.setState !== undefined) {
      props.setState((current) => ({
        ...current,
        preferences: {
          ...current.preferences,
          'scheduled.skip_inactive_delete_confirm': next
        }
      }));
    }
  }, [client, props.setState]);

  async function performAction(actionId: string, action: () => Promise<void>): Promise<void> {
    setPendingAction(actionId);
    try {
      await action();
      await reload();
    } catch (error: unknown) {
      setLoadState((current) => ({
        ...current,
        status: 'error',
        error: toScheduledLoadError(error)
      }));
    } finally {
      setPendingAction(null);
    }
  }

  useEffect(() => {
    void reload();
  }, [client]);

  return (
    <ScrollArea as="section" className="scheduled-view" aria-label={t(locale, 'scheduledSectionTitle')}>
      <div className="scheduled-view-shell">
        {loadState.status === 'error' ? (
          <p className="scheduled-view-error">{formatScheduledLoadError(locale, loadState.error)}</p>
        ) : null}
        <ScheduledReminderList
          busyId={pendingAction}
          locale={locale}
          historyByJob={historyByJob}
          lastRunByJob={lastRunByJob}
          onCreate={async (input: CreateCronInput) => {
            if (client === null) return;
            await performAction('reminder-create', async () => {
              await client.createCron(input);
            });
          }}
          onDelete={async (jobId: string) => {
            if (client === null) return;
            await performAction(`reminder-delete:${jobId}`, async () => {
              await client.deleteCron(jobId);
            });
          }}
          onOpenConversation={onOpenConversation}
          onSetSkipInactiveDeleteConfirm={onSetSkipInactiveDeleteConfirm}
          onToggle={async (jobId: string, enabled: boolean) => {
            if (client === null) return;
            await performAction(`reminder-toggle:${jobId}`, async () => {
              await client.setCronEnabled(jobId, enabled);
            });
          }}
          outputsByRun={outputsByRun}
          reminders={loadState.reminders}
          skipInactiveDeleteConfirm={skipInactiveDeleteConfirm}
        />
      </div>
    </ScrollArea>
  );
}
