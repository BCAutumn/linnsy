import { t, type I18nKey, type Locale } from './i18n.js';

export interface HumanReadableDaemonError {
  title: string;
  suggestion: string;
}

interface ErrorCopyKeys {
  titleKey: I18nKey;
  suggestionKey: I18nKey;
}

const KNOWN_ERRORS = new Map<string, ErrorCopyKeys>([
  ['LINNSY_HTTP_BEARER_REQUIRED', {
    titleKey: 'errorHttpBearerRequiredTitle',
    suggestionKey: 'errorHttpBearerRequiredSuggestion'
  }],
  ['LINNSY_UI_PREFERENCE_VALUE_INVALID', {
    titleKey: 'errorUiPrefValueInvalidTitle',
    suggestionKey: 'errorUiPrefValueInvalidSuggestion'
  }],
  ['LINNSY_LLM_PROVIDER_AUTH_MISSING', {
    titleKey: 'errorLlmProviderAuthMissingTitle',
    suggestionKey: 'errorLlmProviderAuthMissingSuggestion'
  }],
  ['LINNSY_CHANNEL_NOT_STARTED', {
    titleKey: 'errorChannelNotStartedTitle',
    suggestionKey: 'errorChannelNotStartedSuggestion'
  }],
  ['LINNSY_TASK_NOT_FOUND', {
    titleKey: 'errorTaskNotFoundTitle',
    suggestionKey: 'errorTaskNotFoundSuggestion'
  }],
  ['LINNSY_TASK_INVALID_STATE', {
    titleKey: 'errorTaskInvalidStateTitle',
    suggestionKey: 'errorTaskInvalidStateSuggestion'
  }],
  ['LINNSY_AUTH_PAIRING_CODE_INVALID', {
    titleKey: 'errorAuthPairingCodeInvalidTitle',
    suggestionKey: 'errorAuthPairingCodeInvalidSuggestion'
  }],
  ['LINNSY_AUTH_DENIED', {
    titleKey: 'errorAuthDeniedTitle',
    suggestionKey: 'errorAuthDeniedSuggestion'
  }],
  ['LINNSY_CONFIG_INVALID', {
    titleKey: 'errorConfigInvalidTitle',
    suggestionKey: 'errorConfigInvalidSuggestion'
  }],
  ['LINNSY_CONFIG_MISSING', {
    titleKey: 'errorConfigMissingTitle',
    suggestionKey: 'errorConfigMissingSuggestion'
  }],
  ['LINNSY_LLM_PROVIDER_UNKNOWN', {
    titleKey: 'errorLlmProviderUnknownTitle',
    suggestionKey: 'errorLlmProviderUnknownSuggestion'
  }],
  ['LINNSY_LLM_REQUEST_FAILED', {
    titleKey: 'errorLlmRequestFailedTitle',
    suggestionKey: 'errorLlmRequestFailedSuggestion'
  }],
  ['LINNSY_MCP_TOOL_NOT_FOUND', {
    titleKey: 'errorMcpToolNotFoundTitle',
    suggestionKey: 'errorMcpToolNotFoundSuggestion'
  }],
  ['LINNSY_RUN_NOT_FOUND', {
    titleKey: 'errorRunNotFoundTitle',
    suggestionKey: 'errorRunNotFoundSuggestion'
  }],
  ['LINNSY_RUN_ALREADY_ACTIVE', {
    titleKey: 'errorRunAlreadyActiveTitle',
    suggestionKey: 'errorRunAlreadyActiveSuggestion'
  }],
  ['LINNSY_WORKSPACE_NOT_READY', {
    titleKey: 'errorWorkspaceNotReadyTitle',
    suggestionKey: 'errorWorkspaceNotReadySuggestion'
  }],
  ['LINNSY_UI_PREFERENCE_KEY_UNKNOWN', {
    titleKey: 'errorUiPrefKeyUnknownTitle',
    suggestionKey: 'errorUiPrefKeyUnknownSuggestion'
  }],
  ['LINNSY_CONVERSATION_NOT_FOUND', {
    titleKey: 'errorConversationNotFoundTitle',
    suggestionKey: 'errorConversationNotFoundSuggestion'
  }],
  ['LINNSY_CONVERSATION_DELETE_TERMINAL_BOUND', {
    titleKey: 'errorConversationTerminalBoundTitle',
    suggestionKey: 'errorConversationTerminalBoundSuggestion'
  }],
  ['LINNSY_CONVERSATION_ARCHIVE_TERMINAL_BOUND', {
    titleKey: 'errorConversationTerminalBoundTitle',
    suggestionKey: 'errorConversationTerminalBoundSuggestion'
  }],
  ['LINNSY_CONVERSATION_DELETE_HAS_ACTIVE_RUN', {
    titleKey: 'errorConversationActiveRunTitle',
    suggestionKey: 'errorConversationActiveRunSuggestion'
  }],
  ['LINNSY_CONVERSATION_TITLE_INVALID', {
    titleKey: 'errorConversationTitleInvalidTitle',
    suggestionKey: 'errorConversationTitleInvalidSuggestion'
  }],
  ['LINNSY_TELEGRAM_TOKEN_MISSING', {
    titleKey: 'errorTelegramTokenMissingTitle',
    suggestionKey: 'errorTelegramTokenMissingSuggestion'
  }],
  ['LINNSY_WECHAT_GATEWAY_OFFLINE', {
    titleKey: 'errorWechatGatewayOfflineTitle',
    suggestionKey: 'errorWechatGatewayOfflineSuggestion'
  }]
]);

export function translateDaemonError(code: string, locale: Locale): HumanReadableDaemonError {
  const known = KNOWN_ERRORS.get(code) ?? {
    titleKey: 'errorUnknownTitle',
    suggestionKey: 'errorUnknownSuggestion'
  } satisfies ErrorCopyKeys;
  return {
    title: t(locale, known.titleKey),
    suggestion: t(locale, known.suggestionKey)
  };
}
