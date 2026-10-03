import type { Clock } from '../../src/clock.ts';

export interface FakeClock extends Clock {
  /** Durations passed to `sleep`, in call order. */
  sleeps: number[];
  advance(ms: number): void;
}

/** Clock whose `sleep` advances time instantly and records the duration. */
export function createFakeClock(start = 1_700_000_000_000): FakeClock {
  let t = start;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    advance(ms) {
      t += ms;
    },
    async sleep(ms) {
      sleeps.push(ms);
      t += Math.max(0, ms);
    },
  };
}
