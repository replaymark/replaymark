import { eq } from 'drizzle-orm';
import type { Clock } from '../clock.ts';
import type { Db } from '../db/client.ts';
import { follows, subscriptions } from '../db/schema.ts';
import { getSetting, setMeta } from '../db/settings.ts';
import type { Bus } from '../events/bus.ts';
import type { Logger } from '../log.ts';
import type { SyncResult } from '../shared/events.ts';
import type { Helix, TwitchSubscription } from './helix.ts';

export const DESIRED_TYPES = [
  { type: 'stream.online', version: '1' },
  { type: 'stream.offline', version: '1' },
  { type: 'channel.update', version: '2' },
] as const;

const HEALTHY = new Set(['enabled', 'webhook_callback_verification_pending']);
export const DEBOUNCE_MS = 2_000;
const HOUR_MS = 3_600_000;

type TimerHandle = ReturnType<typeof setTimeout>;

export interface ReconcilerDeps {
  db: Db;
  helix: Pick<
    Helix,
    'listSubscriptions' | 'createSubscription' | 'deleteSubscription'
  >;
  clock: Clock;
  logger: Logger;
  bus: Bus;
  callbackUrl: string;
  webhookSecret: string;
  liveSync: () => Promise<void>;
  setTimeout?: (fn: () => void, ms: number) => TimerHandle;
  clearTimeout?: (handle: TimerHandle) => void;
}

export interface Reconciler {
  run(reason?: string): Promise<SyncResult>;
  request(reason: string): Promise<void>;
  requestDebounced(reason: string): void;
  startInterval(): void;
  stop(): void;
}

const PENDING = 'webhook_callback_verification_pending';

/** Maps a Twitch subscription to its local mirror row. */
export function mirrorRow(
  s: TwitchSubscription,
  now: number,
): typeof subscriptions.$inferInsert {
  const parsed = Date.parse(s.createdAt);
  return {
    twitchSubId: s.id,
    type: s.type,
    version: s.version,
    broadcasterId: s.condition.broadcaster_user_id ?? '',
    status: s.status,
    createdAt: Number.isNaN(parsed) ? now : parsed,
    updatedAt: now,
  };
}

function key(type: string, version: string, broadcasterId: string): string {
  return `${type}|${version}|${broadcasterId}`;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createReconciler(deps: ReconcilerDeps): Reconciler {
  const { db, helix, clock, logger, bus } = deps;
  const setT = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = deps.clearTimeout ?? ((h) => clearTimeout(h));

  async function run(reason = 'manual'): Promise<SyncResult> {
    bus.publish('sync', { phase: 'start', reason });
    const errors: string[] = [];
    let created = 0;
    let deleted = 0;
    const kept: TwitchSubscription[] = [];
    const now = clock.now();
    const mirror: (typeof subscriptions.$inferInsert)[] = [];
    let listed = false;

    try {
      const all = await helix.listSubscriptions();
      listed = true;
      const ours = all.filter((s) => s.callback === deps.callbackUrl);

      const active = db
        .selectDistinct({ userId: follows.broadcasterId })
        .from(follows)
        .where(eq(follows.enabled, true))
        .all();
      const desired = new Set<string>();
      for (const { userId } of active)
        for (const d of DESIRED_TYPES)
          desired.add(key(d.type, d.version, userId));

      // Group candidates per desired key; prefer `enabled` when choosing one.
      const toDelete: TwitchSubscription[] = [];
      const byKey = new Map<string, TwitchSubscription[]>();
      for (const s of ours) {
        const k = key(s.type, s.version, s.condition.broadcaster_user_id ?? '');
        if (!desired.has(k) || !HEALTHY.has(s.status)) {
          toDelete.push(s);
          continue;
        }
        const list = byKey.get(k) ?? [];
        list.push(s);
        byKey.set(k, list);
      }
      for (const list of byKey.values()) {
        list.sort(
          (a, b) =>
            Number(b.status === 'enabled') - Number(a.status === 'enabled'),
        );
        const [keep, ...dupes] = list;
        if (keep) kept.push(keep);
        toDelete.push(...dupes);
      }

      for (const s of toDelete) {
        try {
          await helix.deleteSubscription(s.id);
          deleted++;
        } catch (e) {
          errors.push(`delete ${s.type} ${s.id}: ${errText(e)}`);
          // Still exists on Twitch; keep it mirrored so the UI shows it.
          mirror.push(mirrorRow(s, now));
        }
      }
      for (const s of kept) mirror.push(mirrorRow(s, now));

      for (const { userId } of active) {
        for (const d of DESIRED_TYPES) {
          if (byKey.has(key(d.type, d.version, userId))) continue;
          try {
            const id = await helix.createSubscription({
              type: d.type,
              version: d.version,
              broadcasterId: userId,
              callback: deps.callbackUrl,
              secret: deps.webhookSecret,
            });
            created++;
            mirror.push({
              twitchSubId: id,
              type: d.type,
              version: d.version,
              broadcasterId: userId,
              status: PENDING,
              createdAt: now,
              updatedAt: now,
            });
          } catch (e) {
            errors.push(`create ${d.type} ${userId}: ${errText(e)}`);
          }
        }
      }
    } catch (e) {
      errors.push(`list subscriptions: ${errText(e)}`);
    }

    // Only replace the mirror when we actually know the remote state.
    if (listed) {
      db.transaction((tx) => {
        // A verification callback may have enabled a row while this run was
        // in flight; never downgrade it back to pending.
        const enabled = new Set(
          tx
            .select({ id: subscriptions.twitchSubId })
            .from(subscriptions)
            .where(eq(subscriptions.status, 'enabled'))
            .all()
            .map((r) => r.id),
        );
        for (const m of mirror)
          if (m.status === PENDING && enabled.has(m.twitchSubId))
            m.status = 'enabled';
        tx.delete(subscriptions).run();
        if (mirror.length) tx.insert(subscriptions).values(mirror).run();
      });
    }
    // Without a listing the stored mirror is unchanged, so report its count.
    const activeCount = listed
      ? mirror.filter((m) => HEALTHY.has(m.status)).length
      : db
          .select({ status: subscriptions.status })
          .from(subscriptions)
          .all()
          .filter((s) => HEALTHY.has(s.status)).length;

    try {
      await deps.liveSync();
    } catch (e) {
      errors.push(`live sync: ${errText(e)}`);
    }

    const result: SyncResult = {
      at: clock.now(),
      ok: errors.length === 0,
      active: activeCount,
      created,
      deleted,
      errors,
    };
    setMeta(db, 'last_sync', result);
    const msg = `${activeCount} active, ${created} created, ${deleted} deleted`;
    if (result.ok) logger.info(`reconcile: ${msg}`, { reason });
    else logger.warn(`reconcile: ${msg}`, { reason, errors });
    bus.publish('subscriptions', { active: activeCount });
    bus.publish('sync', { phase: 'end', reason, result });
    return result;
  }

  let running: Promise<void> | undefined;
  let followUp: Promise<void> | undefined;
  let followUpReason = '';

  async function safeRun(reason: string): Promise<void> {
    try {
      await run(reason);
    } catch (e) {
      logger.error('reconcile crashed', { reason, error: errText(e) });
    }
  }

  function start(reason: string): Promise<void> {
    const p = safeRun(reason).finally(() => {
      running = undefined;
      afterRun();
    });
    running = p;
    return p;
  }

  function request(reason: string): Promise<void> {
    if (!running) return start(reason);
    if (!followUp) {
      followUpReason = reason;
      const current = running;
      followUp = current.then(() => {
        followUp = undefined;
        return start(followUpReason);
      });
    }
    return followUp;
  }

  let debounceTimer: TimerHandle | undefined;
  function requestDebounced(reason: string): void {
    if (debounceTimer !== undefined) clearT(debounceTimer);
    debounceTimer = setT(() => {
      debounceTimer = undefined;
      void request(reason);
    }, DEBOUNCE_MS);
  }

  let intervalTimer: TimerHandle | undefined;
  let intervalOn = false;
  function arm(): void {
    if (intervalTimer !== undefined) clearT(intervalTimer);
    const hours = getSetting(db, 'syncIntervalHours');
    intervalTimer = setT(
      () => {
        intervalTimer = undefined;
        void request('interval');
      },
      (hours > 0 ? hours : 6) * HOUR_MS,
    );
  }
  function afterRun(): void {
    if (intervalOn) arm();
  }

  return {
    run,
    request,
    requestDebounced,
    startInterval() {
      intervalOn = true;
      arm();
    },
    stop() {
      intervalOn = false;
      if (intervalTimer !== undefined) clearT(intervalTimer);
      if (debounceTimer !== undefined) clearT(debounceTimer);
      intervalTimer = undefined;
      debounceTimer = undefined;
    },
  };
}
