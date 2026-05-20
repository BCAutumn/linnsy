// 桌面壳启动期 UI 提示契约。
// main / preload / renderer 三方共用同一份 sanitize，避免重复白名单漂移。
//
// 命名与 daemon REST UiPreferences 一致（dot-key），renderer 拿到 hint 后
// 可以直接展平到 state.preferences；非 hint 字段（last_opened_conversation_id /
// llm.user_models / llm.chat_model_id 等业务态）不进 hint，保持 daemon 为
// 唯一权威源。

export type UiHintThemeMode = 'auto' | 'light' | 'dark';

export type UiHintThemePrimaryColor =
  | 'distant_sky'
  | 'pine_cypress'
  | 'jade_mist'
  | 'ink_cyan'
  | 'moon_white'
  | 'royal_blue'
  | 'bamboo_ash'
  | 'lilac'
  | 'dai_purple'
  | 'autumn_fragrance'
  | 'amber_yellow'
  | 'tea_brown'
  | 'willow_green'
  | 'rouge'
  | 'rosy_red';

export type UiHintFontSize = 'small' | 'medium' | 'large';
export type UiHintLanguage = 'zh-CN' | 'en-US';

export interface UiHint {
  'theme.mode': UiHintThemeMode;
  'theme.primary_color': UiHintThemePrimaryColor;
  'font.size': UiHintFontSize;
  'sidebar.width_px': number;
  'sidebar.archived_collapsed': boolean;
  language: UiHintLanguage;
}

const UI_HINT_THEME_MODES: readonly UiHintThemeMode[] = ['auto', 'light', 'dark'];

const UI_HINT_THEME_PRIMARY_COLORS: readonly UiHintThemePrimaryColor[] = [
  'distant_sky',
  'pine_cypress',
  'jade_mist',
  'ink_cyan',
  'moon_white',
  'royal_blue',
  'bamboo_ash',
  'lilac',
  'dai_purple',
  'autumn_fragrance',
  'amber_yellow',
  'tea_brown',
  'willow_green',
  'rouge',
  'rosy_red'
];

const UI_HINT_FONT_SIZES: readonly UiHintFontSize[] = ['small', 'medium', 'large'];
const UI_HINT_LANGUAGES: readonly UiHintLanguage[] = ['zh-CN', 'en-US'];
const SIDEBAR_WIDTH_MIN = 200;
const SIDEBAR_WIDTH_MAX = 360;

// 任意字段不合法 → 返回 null，让消费方走 default 兜底；不返回部分合法的
// Partial，避免半残 hint 污染首屏。
export function sanitizeUiHint(input: unknown): UiHint | null {
  if (!isRecord(input)) {
    return null;
  }
  const themeMode = input['theme.mode'];
  const primaryColor = input['theme.primary_color'];
  const fontSize = input['font.size'];
  const sidebarWidth = input['sidebar.width_px'];
  const sidebarArchivedCollapsed = input['sidebar.archived_collapsed'];
  const language = input.language;

  if (!isThemeMode(themeMode)) return null;
  if (!isThemePrimaryColor(primaryColor)) return null;
  if (!isFontSize(fontSize)) return null;
  if (!isSidebarWidth(sidebarWidth)) return null;
  if (typeof sidebarArchivedCollapsed !== 'boolean') return null;
  if (!isLanguage(language)) return null;

  return {
    'theme.mode': themeMode,
    'theme.primary_color': primaryColor,
    'font.size': fontSize,
    'sidebar.width_px': sidebarWidth,
    'sidebar.archived_collapsed': sidebarArchivedCollapsed,
    language
  };
}

function isThemeMode(value: unknown): value is UiHintThemeMode {
  return typeof value === 'string' && (UI_HINT_THEME_MODES as readonly string[]).includes(value);
}

function isThemePrimaryColor(value: unknown): value is UiHintThemePrimaryColor {
  return typeof value === 'string' && (UI_HINT_THEME_PRIMARY_COLORS as readonly string[]).includes(value);
}

function isFontSize(value: unknown): value is UiHintFontSize {
  return typeof value === 'string' && (UI_HINT_FONT_SIZES as readonly string[]).includes(value);
}

function isLanguage(value: unknown): value is UiHintLanguage {
  return typeof value === 'string' && (UI_HINT_LANGUAGES as readonly string[]).includes(value);
}

function isSidebarWidth(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= SIDEBAR_WIDTH_MIN
    && value <= SIDEBAR_WIDTH_MAX;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
