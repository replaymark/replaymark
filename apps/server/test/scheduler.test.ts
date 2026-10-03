import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { systemClock } from '../src/clock.ts';
import { createScheduler } from '../src/jobs/scheduler.ts';
import type { Logger } from '../src/log.ts';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test('runs tasks periodically and survives a throwing task', async () => {
  const errors: string[] = [];
  const logger: Logger = {
    debug() {},
    info() {},
    warn() {},
    error: (_msg, data) => {
      errors.push(String(data?.task));
    },
  };
  let ok = 0;
  let bad = 0;
  const scheduler = createScheduler({
    clock: systemClock,
    logger,
    tasks: [
      { name: 'ok', everyMs: 1_000, run: () => void ok++ },
      {
        name: 'bad',
        everyMs: 1_000,
        run: () => {
          bad++;
          throw new Error('boom');
        },
      },
    ],
  });
  scheduler.start();
  await vi.advanceTimersByTimeAsync(3_000);
  expect(ok).toBe(3);
  expect(bad).toBe(3);
  expect(errors).toEqual(['bad', 'bad', 'bad']);
  scheduler.stop();
  await vi.advanceTimersByTimeAsync(3_000);
  expect(ok).toBe(3);
});
