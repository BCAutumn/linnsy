export interface FakeClock {
  now(): number;
  advance(milliseconds: number): number;
  set(timestamp: number): void;
}

export function createFakeClock(initialTimestamp = 0): FakeClock {
  let currentTimestamp = initialTimestamp;

  return {
    now(): number {
      return currentTimestamp;
    },
    advance(milliseconds: number): number {
      currentTimestamp += milliseconds;
      return currentTimestamp;
    },
    set(timestamp: number): void {
      currentTimestamp = timestamp;
    }
  };
}
