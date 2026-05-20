import React, { useEffect, useState } from 'react';

import type { ChannelDesktopStatus } from '@renderer/contracts';
import type { ChatAppState } from '../../stores/chat-app-state.js';
import { createQrSvgDataUri } from '../../lib/qr-code.js';
import { getDesktopBridge } from '../../lib/desktop-bridge.js';
import { getChannelLifecycleLabel, getWechatStatus } from '../../lib/channels/desktop-channels.js';
import { t, type Locale } from '../../lib/i18n.js';
import { ActionButtons } from '../../components/ActionButtons.js';
import { AppDialog } from '../../components/AppDialog.js';
import { CustomSelect } from '../../components/CustomSelect.js';
import { ConnectionStatus } from '../../shell/Sidebar.js';
import { SettingRow, SettingsSection } from './SettingsLayout.js';
import { ToggleSwitch } from '../../components/ToggleSwitch.js';
import { bindMobileTerminalToConversation } from './terminal-binding-actions.js';
import { createTerminalBindingOptions } from './terminal-binding-options.js';

interface WechatQrDialogState {
  url: string;
  expiresAt?: number;
}
export function ChannelsSettings(props: {
  state: ChatAppState;
  setState: React.Dispatch<React.SetStateAction<ChatAppState>>;
}): React.JSX.Element {
  const locale = props.state.preferences.language;
  const status = getWechatStatus(props.state.channelStatuses) ?? createIdleWechatStatus();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [qrDialog, setQrDialog] = useState<WechatQrDialogState | null>(null);
  const bridge = getDesktopBridge();
  const canControlWechat = bridge !== undefined
    && bridge.invokeChannelAction !== undefined
    && bridge.onChannelStatusChanged !== undefined;

  useEffect(() => {
    if (status.lifecycle !== 'awaiting_login') {
      setQrDialog(null);
    }
  }, [status.lifecycle]);

  useEffect(() => {
    if (qrDialog === null || status.lifecycle !== 'awaiting_login') {
      return;
    }
    const hint = readQrLoginHint(status);
    if (hint === null) {
      return;
    }
    if (qrDialog.url !== hint.url || qrDialog.expiresAt !== hint.expiresAt) {
      setQrDialog(hint);
    }
  }, [qrDialog, status]);

  if (!canControlWechat) {
    return (
      <div className="placeholder-panel">
        <p>{t(locale, 'channelsElectronOnly')}</p>
      </div>
    );
  }

  return (
    <div className="settings-stack">
      <SettingsSection>
        <div className="terminal-connection-group terminal-connection-group--wechat">
          <h3 className="terminal-connection-heading">{t(locale, 'terminalWechat')}</h3>
          <SettingRow
            label={t(locale, 'terminalBoundConversation')}
            description={t(locale, 'terminalBoundConversationDescription')}
          >
            <CustomSelect
              ariaLabel={t(locale, 'terminalBoundConversation')}
              value={props.state.terminalBinding?.conversationId ?? ''}
              options={createTerminalBindingOptions(props.state, locale)}
              title={t(locale, 'terminalBoundConversation')}
              fallbackPlaceholder={t(locale, 'customSelectPlaceholder')}
              fallbackTitle={t(locale, 'customSelectTitle')}
              minWidth="220px"
              width="220px"
              onChange={(conversationId) => {
                void bindMobileTerminalToConversation(conversationId, props.state, props.setState);
              }}
            />
          </SettingRow>
          <SettingRow
            label={t(locale, 'wechatConnectionEntry')}
            description={<ConnectionStatus label={getChannelLifecycleLabel(locale, status)} online={status.lifecycle === 'connected'} />}
          >
            {renderWechatActionButtons({ busy, locale, status, setBusy, setMessage, setDeleteDialogOpen, setQrDialog })}
          </SettingRow>
          <SettingRow label={t(locale, 'wechatAutoConnect')} description={t(locale, 'wechatAutoConnectDescription')}>
            <ToggleSwitch
              checked={status.autoConnect}
              disabled={busy}
              label={t(locale, 'wechatAutoConnectDescription')}
              onChange={(enabled) => {
                void setWechatAutoConnect(locale, enabled, setBusy, setMessage);
              }}
            />
          </SettingRow>
        </div>
        {(['terminalFeishu', 'terminalTelegram', 'terminalDiscord'] as const).map((key) => (
          <UnsupportedTerminalConnection key={key} locale={locale} label={t(locale, key)} />
        ))}
      </SettingsSection>
      {message === null ? null : <p className="field-error">{message}</p>}
      {deleteDialogOpen ? (
        <WechatDeleteAccountDialog
          busy={busy}
          locale={locale}
          onCancel={() => {
            setDeleteDialogOpen(false);
          }}
          onConfirm={() => {
            void deleteWechatAccount(locale, setBusy, setMessage, setDeleteDialogOpen);
          }}
        />
      ) : null}
      {qrDialog === null ? null : (
        <WechatQrDialog
          busy={busy}
          locale={locale}
          qr={qrDialog}
          onClose={() => {
            setQrDialog(null);
          }}
          onRefresh={() => {
            void requestWechatQrCode(locale, setBusy, setMessage, setQrDialog);
          }}
        />
      )}
    </div>
  );
}

function WechatQrDialog(props: {
  busy: boolean;
  locale: Locale;
  qr: WechatQrDialogState;
  onClose: () => void;
  onRefresh: () => void;
}): React.JSX.Element {
  const qrImageSrc = createQrSvgDataUri(props.qr.url);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    setExpired(false);
    if (props.qr.expiresAt === undefined) {
      return undefined;
    }
    const delayMs = Math.max(0, props.qr.expiresAt - Date.now());
    const timer = setTimeout(() => {
      setExpired(true);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [props.qr.url, props.qr.expiresAt]);

  return (
    <AppDialog
      ariaLabel={t(props.locale, 'wechatLoginQrDialogTitle')}
      bodyClassName="wechat-qr-dialog-body"
      className="wechat-qr-dialog"
      closeLabel={t(props.locale, 'dialogClose')}
      onClose={props.onClose}
      showCloseButton
      title={t(props.locale, 'wechatLoginQrDialogTitle')}
    >
      <div className="wechat-qr-card" aria-label={t(props.locale, 'wechatLoginQrImageAlt')}>
        <img alt={t(props.locale, 'wechatLoginQrImageAlt')} className="wechat-qr-image" src={qrImageSrc} />
        {expired ? (
          <button className="wechat-qr-expired-overlay" disabled={props.busy} onClick={props.onRefresh} type="button">
            <span>{t(props.locale, 'qrCodeExpiredOverlayTitle')}</span>
            <small>{t(props.locale, 'qrCodeExpiredOverlayHint')}</small>
          </button>
        ) : null}
      </div>
      <p>{t(props.locale, 'wechatLoginQrDialogDescription')}</p>
    </AppDialog>
  );
}

function UnsupportedTerminalConnection(props: {
  locale: Locale;
  label: string;
}): React.JSX.Element {
  return (
    <div className="terminal-connection-group terminal-connection-group--unsupported">
      <h3 className="terminal-connection-heading">{props.label}</h3>
      <p className="terminal-connection-unsupported">{t(props.locale, 'terminalUnsupported')}</p>
    </div>
  );
}

function WechatDeleteAccountDialog(props: {
  busy: boolean;
  locale: Locale;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  return (
    <AppDialog
      ariaLabel={t(props.locale, 'wechatDeleteAccountConfirmTitle')}
      bodyClassName="wechat-delete-dialog-body"
      closeLabel={t(props.locale, 'dialogClose')}
      footer={({ requestClose }) => (
        <ActionButtons
          isPrimaryActionDisabled={props.busy}
          isSecondaryActionDisabled={props.busy}
          onPrimaryAction={props.onConfirm}
          onSecondaryAction={requestClose}
          primaryActionText={t(props.locale, 'wechatDeleteAccountConfirm')}
          primaryVariant="danger"
          secondaryActionText={t(props.locale, 'memoryCancel')}
          secondaryVariant="ghost"
          size="sm"
        />
      )}
      footerClassName="wechat-delete-dialog-footer"
      onClose={props.onCancel}
      showCloseButton
      title={t(props.locale, 'wechatDeleteAccountConfirmTitle')}
    >
      <p>{t(props.locale, 'wechatDeleteAccountConfirmBody')}</p>
    </AppDialog>
  );
}

async function setWechatAutoConnect(
  locale: Locale,
  enabled: boolean,
  setBusy: React.Dispatch<React.SetStateAction<boolean>>,
  setMessage: React.Dispatch<React.SetStateAction<string | null>>
): Promise<void> {
  const bridge = getDesktopBridge();
  if (bridge?.invokeChannelAction === undefined) {
    setMessage(t(locale, 'wechatCannotSaveAutoConnect'));
    return;
  }
  setBusy(true);
  setMessage(null);
  try {
    await bridge.invokeChannelAction({ channelId: 'wechat', action: { type: 'set-auto-connect', enabled } });
  } catch (error: unknown) {
    setMessage(readErrorMessage(error, locale));
  } finally {
    setBusy(false);
  }
}

async function deleteWechatAccount(
  locale: Locale,
  setBusy: React.Dispatch<React.SetStateAction<boolean>>,
  setMessage: React.Dispatch<React.SetStateAction<string | null>>,
  setDeleteDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
): Promise<void> {
  const bridge = getDesktopBridge();
  if (bridge?.invokeChannelAction === undefined) {
    setMessage(t(locale, 'wechatCannotControl'));
    return;
  }
  setBusy(true);
  setMessage(null);
  try {
    await bridge.invokeChannelAction({ channelId: 'wechat', action: { type: 'delete-account' } });
    setDeleteDialogOpen(false);
  } catch (error: unknown) {
    setMessage(readErrorMessage(error, locale));
  } finally {
    setBusy(false);
  }
}

function renderWechatActionButtons(input: {
  busy: boolean;
  locale: Locale;
  status: ChannelDesktopStatus;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setMessage: React.Dispatch<React.SetStateAction<string | null>>;
  setDeleteDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setQrDialog: React.Dispatch<React.SetStateAction<WechatQrDialogState | null>>;
}): React.JSX.Element {
  if (input.status.lifecycle === 'starting') {
    return (
      <ActionButtons
        isPrimaryActionDisabled
        onPrimaryAction={() => {}}
        primaryActionText={t(input.locale, 'channelStarting')}
        showSecondaryAction={false}
        size="sm"
      />
    );
  }

  const action = input.status.lifecycle === 'connected'
    ? 'stop'
    : input.status.lifecycle === 'degraded' ? 'reconnect-network' : 'request-qr-code';
  return (
    <ActionButtons
      isPrimaryActionDisabled={input.busy}
      isSecondaryActionDisabled={input.busy}
      onPrimaryAction={() => {
        if (action === 'request-qr-code') {
          void requestWechatQrCode(input.locale, input.setBusy, input.setMessage, input.setQrDialog);
          return;
        }
        void invokeWechatAction(input.locale, action, input.setBusy, input.setMessage);
      }}
      onSecondaryAction={() => {
        input.setDeleteDialogOpen(true);
      }}
      primaryActionText={getWechatPrimaryActionText(input.locale, input.status.lifecycle)}
      primaryVariant={input.status.lifecycle === 'connected' ? 'neutral' : 'default'}
      secondaryActionText={t(input.locale, 'wechatDeleteAccount')}
      secondaryVariant="danger"
      showSecondaryAction={input.status.lifecycle === 'connected'}
      size="sm"
    />
  );
}

async function invokeWechatAction(
  locale: Locale,
  action: 'stop' | 'reconnect-network',
  setBusy: React.Dispatch<React.SetStateAction<boolean>>,
  setMessage: React.Dispatch<React.SetStateAction<string | null>>
): Promise<void> {
  const bridge = getDesktopBridge();
  if (bridge?.invokeChannelAction === undefined) {
    setMessage(t(locale, 'wechatCannotControl'));
    return;
  }
  setBusy(true);
  setMessage(null);
  try {
    await bridge.invokeChannelAction({ channelId: 'wechat', action: { type: action } });
  } catch (error: unknown) {
    setMessage(readErrorMessage(error, locale));
  } finally {
    setBusy(false);
  }
}

async function requestWechatQrCode(
  locale: Locale,
  setBusy: React.Dispatch<React.SetStateAction<boolean>>,
  setMessage: React.Dispatch<React.SetStateAction<string | null>>,
  setQrDialog: React.Dispatch<React.SetStateAction<WechatQrDialogState | null>>
): Promise<void> {
  const bridge = getDesktopBridge();
  if (bridge?.invokeChannelAction === undefined) {
    setMessage(t(locale, 'wechatCannotControl'));
    return;
  }
  setBusy(true);
  setMessage(null);
  try {
    const status = await bridge.invokeChannelAction({ channelId: 'wechat', action: { type: 'request-qr-code' } });
    const hint = readQrLoginHint(status);
    if (hint === null) {
      setMessage(t(locale, 'wechatLoginQrNotReady'));
      return;
    }
    setQrDialog(hint);
  } catch (error: unknown) {
    setMessage(readErrorMessage(error, locale));
  } finally {
    setBusy(false);
  }
}

function getWechatPrimaryActionText(locale: Locale, lifecycle: ChannelDesktopStatus['lifecycle']): string {
  if (lifecycle === 'connected') {
    return t(locale, 'wechatDisconnect');
  }
  if (lifecycle === 'degraded') {
    return t(locale, 'wechatReconnect');
  }
  return t(locale, 'qrCodeView');
}

function createIdleWechatStatus(): ChannelDesktopStatus {
  return { channelId: 'wechat', lifecycle: 'idle', autoConnect: false };
}

function readQrLoginHint(status: ChannelDesktopStatus): WechatQrDialogState | null {
  return status.loginHint?.kind === 'qr'
    ? {
        url: status.loginHint.url,
        ...(status.loginHint.expiresAt === undefined ? {} : { expiresAt: status.loginHint.expiresAt })
      }
    : null;
}

function readErrorMessage(error: unknown, locale: Locale): string {
  return error instanceof Error ? error.message : t(locale, 'operationRetryLater');
}
