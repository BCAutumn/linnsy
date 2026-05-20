export type ThemeMode = 'auto' | 'light' | 'dark';
export type ThemePrimaryColor =
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

export interface ThemePrimaryColorOption {
  key: ThemePrimaryColor;
}

// 顺序会直接影响设置页色块的阅读节奏：冷色、绿色、暖色、红紫相邻分组。
export const themePrimaryColorOptions: ThemePrimaryColorOption[] = [
  { key: 'distant_sky' },
  { key: 'moon_white' },
  { key: 'royal_blue' },
  { key: 'bamboo_ash' },
  { key: 'ink_cyan' },
  { key: 'pine_cypress' },
  { key: 'jade_mist' },
  { key: 'willow_green' },
  { key: 'autumn_fragrance' },
  { key: 'amber_yellow' },
  { key: 'tea_brown' },
  { key: 'rouge' },
  { key: 'rosy_red' },
  { key: 'lilac' },
  { key: 'dai_purple' }
];

export const themePrimaryColors: ThemePrimaryColor[] = themePrimaryColorOptions.map((option) => option.key);
export const themeModes: ThemeMode[] = ['auto', 'light', 'dark'];
