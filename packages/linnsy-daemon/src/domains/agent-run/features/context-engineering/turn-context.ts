import type { ClockPort } from '../../../../shared/ports.js';

import { createLinnsyTurnContextFence } from './fences.js';

export function createCurrentTimeTurnContextFence(clock: ClockPort) {
  const nowMs = clock.now();
  return createLinnsyTurnContextFence(formatCurrentTimeContext(nowMs), {
    source: 'daemon',
    kind: 'current-time',
    generatedAt: nowMs
  });
}

function formatCurrentTimeContext(nowMs: number): string {
  return [
    'Current local time:',
    `- Local: ${formatLocalTime(nowMs)}`,
    `- Timezone: ${readLocalTimezone()}`
  ].join('\n');
}

function formatLocalTime(nowMs: number): string {
  const date = new Date(nowMs);
  const year = date.getFullYear().toString().padStart(4, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${year}-${month}-${day} ${formatWeekday(date)} ${hours}:${minutes}:${seconds}`;
}

function formatWeekday(date: Date): string {
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return weekdays[date.getDay()] ?? 'Unknown';
}

function readLocalTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
