import type { UiPreferences } from './daemon-api.js';
import { enCopy } from './i18n/en-US.js';
import { zhCopy } from './i18n/zh-CN.js';
import type { ThemeMode, ThemePrimaryColor } from './theme.js';

export type Locale = UiPreferences['language'];
export type I18nKey = keyof typeof zhCopy;

const enMessages: Record<I18nKey, string> = enCopy;

const copy: Record<Locale, Record<I18nKey, string>> = {
  'zh-CN': zhCopy,
  'en-US': enMessages
};

export type I18nParams = Record<string, string | number>;

export function t(locale: Locale, key: I18nKey, params: I18nParams = {}): string {
  const localeCopy: Partial<Record<I18nKey, string>> = copy[locale];
  const template = localeCopy[key];
  if (template === undefined) {
    throw new Error(`Missing i18n copy for locale "${locale}" and key "${key}"`);
  }
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

const themePrimaryColorLabelKeys: Record<ThemePrimaryColor, I18nKey> = {
  distant_sky: 'themeDistantSky',
  pine_cypress: 'themePineCypress',
  jade_mist: 'themeJadeMist',
  ink_cyan: 'themeInkCyan',
  moon_white: 'themeMoonWhite',
  royal_blue: 'themeRoyalBlue',
  bamboo_ash: 'themeBambooAsh',
  lilac: 'themeLilac',
  dai_purple: 'themeDaiPurple',
  autumn_fragrance: 'themeAutumnFragrance',
  amber_yellow: 'themeAmberYellow',
  tea_brown: 'themeTeaBrown',
  willow_green: 'themeWillowGreen',
  rouge: 'themeRouge',
  rosy_red: 'themeRosyRed'
};

export function getThemePrimaryColorLabel(locale: Locale, color: ThemePrimaryColor): string {
  return t(locale, themePrimaryColorLabelKeys[color]);
}

export function getThemePrimaryColorLabels(locale: Locale, color: ThemePrimaryColor): {
  primary: string;
  secondary: string;
} {
  const key = themePrimaryColorLabelKeys[color];
  return {
    primary: t(locale, key),
    secondary: locale === 'zh-CN' ? enMessages[key] : zhCopy[key]
  };
}

const themeModeLabelKeys: Record<ThemeMode, I18nKey> = {
  auto: 'themeModeAuto',
  light: 'themeModeLight',
  dark: 'themeModeDark'
};

export function getThemeModeLabels(locale: Locale): Record<ThemeMode, string> {
  return {
    auto: t(locale, themeModeLabelKeys.auto),
    light: t(locale, themeModeLabelKeys.light),
    dark: t(locale, themeModeLabelKeys.dark)
  };
}
