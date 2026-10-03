import type { Clock } from '../clock.ts';
import type { Logger } from '../log.ts';

export interface ScheduledTask {
  name: string;
  everyMs: number;
  run(): unknown;
}

export interface Scheduler {
  start(): void;
  stop(): void;
}

export function createScheduler(deps: {
  clock: Clock;
  logger: Logger;
  tasks: ScheduledTask[];
}): Scheduler {
  const { logger, clock } = deps;
  let timers: ReturnType<typeof setInterval>[] = [];

  async function runTask(task: ScheduledTask) {
    const started = clock.now();
    try {
      await task.run();
      logger.debug('scheduled task done', {
        task: task.name,
        ms: clock.now() - started,
      });
    } catch (err) {
      logger.error('scheduled task failed', {
        task: task.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    start() {
      if (timers.length > 0) return;
      timers = deps.tasks.map((task) => {
        const t = setInterval(() => void runTask(task), task.everyMs);
        t.unref();
        return t;
      });
    },
    stop() {
      for (const t of timers) clearInterval(t);
      timers = [];
    },
  };
}
