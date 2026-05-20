import type React from 'react';

export type SelectItem<T extends string> = {
  value: T;
  text: string;
  disabled?: boolean;
  shortcut?: string;
  variant?: 'default' | 'danger';
  icon?: React.ReactNode;
};

export type SelectGroup = {
  isGroup: true;
  label: string;
};

export type SelectSeparator = {
  isSeparator: true;
};

export type CustomSelectOption<T extends string> = SelectItem<T> | SelectGroup | SelectSeparator;
