export interface SettingsRangeInput {
  min: number;
  max: number;
  value: number;
}

export function calculateSettingsRangeProgress(input: SettingsRangeInput): number {
  const span = input.max - input.min;
  if (span === 0) {
    return 0;
  }
  const raw = ((input.value - input.min) / span) * 100;
  return Math.min(100, Math.max(0, raw));
}
