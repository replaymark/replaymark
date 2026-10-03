import {
  type Streamer,
  SUBSCRIPTION_TYPES,
  type Subscription,
  type SubscriptionState,
  type SubscriptionType,
  type SyncResultDto,
} from '@shared/schemas.ts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clock,
  RefreshCw,
} from 'lucide-react';
import { type ComponentType, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Caption,
  Numeral,
  syncStamp,
  TILE_BASE,
} from '@/components/status-tiles.tsx';
import { StreamerAvatar } from '@/components/streamer-avatar.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import type { MessageKey } from '@/i18n/core.ts';
import { useFormat, useT } from '@/i18n/i18n.tsx';
import { api, queryKeys, unwrap } from '@/lib/api.ts';
import {
  errorCode,
  overviewQuery,
  streamersQuery,
  subscriptionsQuery,
} from '@/lib/queries.ts';
import { cn } from '@/lib/utils.ts';

/** DOM id of the interval field in Settings; the "change" link targets it. */
export const INTERVAL_FIELD_ID = 'sync-interval';

const TYPE_KEY: Record<SubscriptionType, MessageKey> = {
  'stream.online': 'overview.subOnline',
  'stream.offline': 'overview.subOffline',
  'channel.update': 'overview.subUpdate',
};
const STATE_KEY = {
  enabled: 'overview.subEnabled',
  pending: 'overview.subPending',
  error: 'overview.subError',
  missing: 'overview.subMissing',
} as const satisfies Record<SubscriptionState, MessageKey>;
const STATE_ICON: Record<
  SubscriptionState,
  {
    Icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
    cls: string;
  }
> = {
  enabled: { Icon: CircleCheck, cls: 'text-status-enabled' },
  pending: { Icon: Clock, cls: 'text-status-pending' },
  error: { Icon: CircleAlert, cls: 'text-status-error' },
  missing: { Icon: CircleDashed, cls: 'text-muted-foreground' },
};

function isKnownType(t: string): t is SubscriptionType {
  return (SUBSCRIPTION_TYPES as readonly string[]).includes(t);
}

function StateLabel({ state }: { state: SubscriptionState }) {
  const t = useT();
  const { Icon, cls } = STATE_ICON[state];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-sm',
        state === 'missing' ? 'text-muted-foreground' : 'text-foreground',
      )}
    >
      <Icon className={cn('size-4 shrink-0', cls)} aria-hidden />
      {t(STATE_KEY[state])}
    </span>
  );
}

interface RowModel {
  key: string;
  streamer: Streamer | null;
  orphanId: string | null;
  states: Record<SubscriptionType, SubscriptionState>;
  /** Raw Twitch status of the first failed subscription, when known. */
  rawStatus: string | null;
  failing: 'error' | 'missing';
}

function failingKind(
  states: Record<SubscriptionType, SubscriptionState>,
): 'error' | 'missing' | null {
  const all = SUBSCRIPTION_TYPES.map((k) => states[k]);
  if (all.includes('error')) return 'error';
  return all.includes('missing') ? 'missing' : null;
}

/** Only failing rows: enabled streamers with an error/missing subscription, and unknown broadcasters with an error. */
function buildProblemRows(
  streamers: Streamer[],
  subs: Subscription[],
): RowModel[] {
  const known = new Set(streamers.map((s) => s.id));
  const rows: RowModel[] = [];
  for (const s of [...streamers].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  )) {
    const failing = s.enabled ? failingKind(s.subscriptions) : null;
    if (!failing) continue;
    const raw = subs.find(
      (x) => x.broadcasterId === s.id && x.state === 'error',
    );
    rows.push({
      key: s.id,
      streamer: s,
      orphanId: null,
      states: s.subscriptions,
      rawStatus: raw?.status ?? null,
      failing,
    });
  }
  const orphans = new Map<string, Subscription[]>();
  for (const sub of subs) {
    if (known.has(sub.broadcasterId)) continue;
    orphans.set(sub.broadcasterId, [
      ...(orphans.get(sub.broadcasterId) ?? []),
      sub,
    ]);
  }
  for (const [id, list] of orphans) {
    const states: Record<SubscriptionType, SubscriptionState> = {
      'stream.online': 'missing',
      'stream.offline': 'missing',
      'channel.update': 'missing',
    };
    for (const s of list) if (isKnownType(s.type)) states[s.type] = s.state;
    const bad = list.find((s) => s.state === 'error');
    if (!bad) continue;
    rows.push({
      key: `orphan-${id}`,
      streamer: null,
      orphanId: id,
      states,
      rawStatus: bad.status ?? null,
      failing: 'error',
    });
  }
  return rows;
}

function newerSync(
  a: SyncResultDto | null | undefined,
  b: SyncResultDto | null | undefined,
): SyncResultDto | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return new Date(a.at).getTime() >= new Date(b.at).getTime() ? a : b;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function SyncStatus({ intervalHours }: { intervalHours: number }) {
  const t = useT();
  const qc = useQueryClient();
  const subs = useQuery(subscriptionsQuery);
  const streamers = useQuery(streamersQuery);
  const overview = useQuery(overviewQuery);

  const sync = useMutation({
    mutationFn: () => unwrap(api.api.sync.$post()),
    onSuccess: (res) => {
      if (res && !res.ok) toast.error(t('subscriptions.syncFailedToast'));
      else toast.success(t('subscriptions.synced'));
    },
    onError: (err) => toast.error(t.error(errorCode(err))),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.subscriptions });
      void qc.invalidateQueries({ queryKey: queryKeys.streamers });
      void qc.invalidateQueries({ queryKey: queryKeys.overview });
    },
  });

  const loaded = subs.isSuccess && streamers.isSuccess;
  useEffect(() => {
    if (loaded && window.location.hash === '#sync') {
      document.getElementById('sync')?.scrollIntoView();
    }
  }, [loaded]);

  const lastSync = newerSync(sync.data, overview.data?.lastSync);
  const error = subs.error ?? streamers.error;
  const rows =
    subs.data && streamers.data
      ? buildProblemRows(streamers.data, subs.data)
      : null;

  return (
    <section
      id="sync"
      aria-labelledby="sync-title"
      className="surface scroll-mt-4 space-y-5 p-5 md:p-6"
    >
      <header className="flex flex-col items-start gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2
            id="sync-title"
            className="font-display text-xl leading-none font-extrabold tracking-wide uppercase"
          >
            {t('settings.syncTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('settings.syncHint')}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => sync.mutate()}
          disabled={sync.isPending}
          aria-busy={sync.isPending || undefined}
        >
          <RefreshCw
            aria-hidden
            className={cn(
              sync.isPending && 'animate-spin motion-reduce:animate-none',
            )}
          />
          {t(
            sync.isPending ? 'subscriptions.syncing' : 'subscriptions.syncNow',
          )}
        </Button>
      </header>

      {overview.data?.subscriptions && (
        <Tiles
          lastSync={lastSync}
          active={overview.data.subscriptions.active}
          expected={overview.data.subscriptions.expected}
          intervalHours={intervalHours}
        />
      )}

      {error ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{t.error(errorCode(error))}</AlertDescription>
        </Alert>
      ) : !rows ? (
        <p className="text-muted-foreground">{t('app.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CircleCheck className="size-4 text-status-enabled" aria-hidden />
          {t('settings.syncNoProblems')}
        </p>
      ) : (
        <ul className="list-none space-y-3">
          {rows.map((r) => (
            <SubRow
              key={r.key}
              row={r}
              onRetry={() => sync.mutate()}
              busy={sync.isPending}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function nextSyncText(
  at: string,
  hours: number,
  now: number,
  t: ReturnType<typeof useT>,
  fmt: ReturnType<typeof useFormat>,
): string {
  const due = new Date(at).getTime() + hours * 3_600_000;
  const minutes = Math.round((due - now) / 60_000);
  if (minutes <= 0) return t('subscriptions.nextDue');
  if (minutes < 60) return t('subscriptions.nextMin', { n: minutes });
  if (minutes < 24 * 60) {
    return t('subscriptions.nextHours', { n: Math.round(minutes / 60) });
  }
  const d = new Date(due);
  return `${fmt.dayMonth(d)}, ${fmt.time(d)}`;
}

function Tiles({
  lastSync,
  active,
  expected,
  intervalHours,
}: {
  lastSync: SyncResultDto | null;
  active: number;
  expected: number;
  intervalHours: number;
}) {
  const t = useT();
  const fmt = useFormat();
  const now = useNow(60_000);
  const short = active < expected;
  const failed = lastSync !== null && !lastSync.ok;
  return (
    <ul className="grid list-none grid-cols-1 gap-3 sm:grid-cols-3">
      <li>
        <div className={TILE_BASE}>
          <Numeral failed={failed}>
            {lastSync ? syncStamp(lastSync.at, fmt) : '–'}
          </Numeral>
          <Caption failed={failed}>
            {!lastSync
              ? t('overview.syncNever')
              : lastSync.ok
                ? t('overview.tileSyncOk')
                : t('overview.tileSyncFailed')}
          </Caption>
          {failed && lastSync.errors.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-sm text-foreground">
              {lastSync.errors.map((e) => (
                <li key={e} className="break-words">
                  {e}
                </li>
              ))}
            </ul>
          )}
        </div>
      </li>
      <li>
        <div className={TILE_BASE}>
          <Numeral failed={short}>
            {active}/{expected}
          </Numeral>
          <Caption failed={short}>{t('overview.tileSubs')}</Caption>
        </div>
      </li>
      <li>
        <div className={TILE_BASE}>
          <Numeral>
            {lastSync && intervalHours
              ? nextSyncText(lastSync.at, intervalHours, now, t, fmt)
              : '–'}
          </Numeral>
          <Caption>
            {t('subscriptions.tileNext')}
            <a
              href={`#${INTERVAL_FIELD_ID}`}
              className="ml-1 underline underline-offset-2"
            >
              {t('subscriptions.change')}
            </a>
          </Caption>
        </div>
      </li>
    </ul>
  );
}

function SubRow({
  row,
  onRetry,
  busy,
}: {
  row: RowModel;
  onRetry: () => void;
  busy: boolean;
}) {
  const t = useT();
  const { streamer } = row;
  return (
    <li className="rounded-md border bg-paper p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
        <div className="flex min-w-0 items-center gap-3 sm:w-64 sm:shrink-0">
          <StreamerAvatar
            url={streamer?.avatarUrl ?? null}
            name={streamer?.displayName ?? '?'}
          />
          <div className="min-w-0">
            <p className="font-medium break-words">
              {streamer
                ? streamer.displayName
                : t('subscriptions.unknownStreamer', {
                    id: row.orphanId ?? '',
                  })}
            </p>
            {streamer && (
              <p className="text-sm break-all text-muted-foreground">
                {streamer.login}
              </p>
            )}
          </div>
        </div>
        <dl className="grid flex-1 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          {SUBSCRIPTION_TYPES.map((type) => (
            <div
              key={type}
              className="flex flex-wrap items-baseline justify-between gap-x-3 sm:block"
            >
              <dt className="text-sm text-muted-foreground">
                {t(TYPE_KEY[type])}
              </dt>
              <dd>
                <StateLabel state={row.states[type]} />
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="mt-3 flex flex-col items-start gap-2 border-t border-rule pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">
          {row.failing === 'error'
            ? row.rawStatus
              ? t('subscriptions.errorDetail', { status: row.rawStatus })
              : t('subscriptions.errorDetailPlain')
            : t('subscriptions.missingDetail')}
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={onRetry}
          disabled={busy}
        >
          {t('subscriptions.createAgain')}
        </Button>
      </div>
    </li>
  );
}
