import type { Streamer } from '@shared/schemas.ts';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Check, CircleAlert, Plus, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AttentionList } from '@/components/attention-list.tsx';
import { SEARCH_DEBOUNCE_MS } from '@/components/category-picker.tsx';
import { LiveCard } from '@/components/live-card.tsx';
import { RosterRow } from '@/components/roster-row.tsx';
import { StatusTiles } from '@/components/status-tiles.tsx';
import { StreamerDialog } from '@/components/streamer-dialog.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group.tsx';
import type { MessageKey } from '@/i18n/core.ts';
import { useFormat, useT } from '@/i18n/i18n.tsx';
import {
  errorCode,
  gameGroupsQuery,
  overviewQuery,
  streamersQuery,
} from '@/lib/queries.ts';
import {
  filterRoster,
  liveInOrder,
  newlyLive,
  parseRosterSearch,
  ROSTER_FILTERS,
  type RosterFilter,
  rosterCounts,
  rosterOrder,
} from '@/lib/streamers.ts';
import { useDebounced } from '@/lib/use-debounced.ts';

export const Route = createFileRoute('/_app/')({
  validateSearch: parseRosterSearch,
  component: OverviewPage,
});

const JUST_LIVE_MS = 1_500;

/** Ids that went live during this session, cleared after the entrance. */
function useJustWentLive(list: Streamer[] | undefined): ReadonlySet<string> {
  const prev = useRef<Map<string, boolean> | null>(null);
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!list) return;
    const fresh = newlyLive(prev.current, list);
    prev.current = new Map(list.map((s) => [s.id, s.live]));
    if (fresh.length === 0) return;
    setIds((cur) => new Set([...cur, ...fresh]));
    const timer = setTimeout(() => {
      setIds((cur) => new Set([...cur].filter((id) => !fresh.includes(id))));
    }, JUST_LIVE_MS);
    return () => clearTimeout(timer);
  }, [list]);
  return ids;
}

/** Current time, refreshed every 30 s so the header clock stays right. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function OverviewPage() {
  const t = useT();
  const fmt = useFormat();
  const now = useNow();
  const kicker = t('overview.kicker', {
    date: fmt.dayMonth(now),
    time: fmt.time(now),
  });
  const streamers = useQuery(streamersQuery);
  const overview = useQuery(overviewQuery);
  const justLive = useJustWentLive(streamers.data);
  const [dialog, setDialog] = useState<{ streamer: Streamer | null } | null>(
    null,
  );

  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const setSearch = (next: { q?: string; filter?: RosterFilter }) =>
    void navigate({
      search: (s) => ({ ...s, ...next }),
      replace: true,
    });

  const groups = useQuery(gameGroupsQuery);
  const list = streamers.data ?? [];
  const counts = rosterCounts(list);
  const visible = filterRoster(list, search, groups.data ?? []);
  const live = liveInOrder(list);

  return (
    <div className="space-y-8">
      <header className="flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="kicker tabular">{kicker}</p>
          <h1 className="page-title">{t('overview.title')}</h1>
        </div>
        <Button onClick={() => setDialog({ streamer: null })}>
          <Plus aria-hidden />
          {t('overview.addStreamer')}
        </Button>
      </header>

      {overview.data && <StatusTiles data={overview.data} />}

      {overview.data && streamers.data && (
        <AttentionList overview={overview.data} streamers={streamers.data} />
      )}

      <section aria-labelledby="on-air" className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2
            id="on-air"
            className="font-display text-2xl leading-none font-extrabold tracking-wide uppercase"
          >
            {t('overview.onAir')}
          </h2>
          <p className="tabular text-sm text-muted-foreground">
            {t('overview.onAirCount', { count: live.length })}
          </p>
        </div>
        {streamers.isPending ? (
          <p className="text-muted-foreground">{t('app.loading')}</p>
        ) : live.length === 0 ? (
          <p className="empty-state">{t('overview.nobodyLive')}</p>
        ) : (
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {live.map((s) => (
              <LiveCard
                key={s.id}
                streamer={s}
                now={now}
                entering={justLive.has(s.id)}
              />
            ))}
          </ol>
        )}
      </section>

      <section
        aria-labelledby="roster"
        className="space-y-4 border-t border-rule pt-6"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2
            id="roster"
            className="font-display text-2xl leading-none font-extrabold tracking-wide uppercase"
          >
            {t('overview.allStreamers')}
          </h2>
          <p className="tabular text-sm text-muted-foreground">
            {t.plural('overview.rosterCount', list.length)}
          </p>
        </div>
        {streamers.isError ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>
              {t.error(errorCode(streamers.error))}
            </AlertDescription>
          </Alert>
        ) : streamers.isPending ? null : list.length === 0 ? (
          <div className="empty-state">
            <p className="mb-3">{t('overview.empty')}</p>
            <Button
              variant="outline"
              onClick={() => setDialog({ streamer: null })}
            >
              <Plus aria-hidden />
              {t('overview.addStreamer')}
            </Button>
          </div>
        ) : (
          <>
            <RosterControls
              q={search.q ?? ''}
              filter={search.filter}
              counts={counts}
              onChange={setSearch}
            />
            {visible.length === 0 ? (
              <div className="empty-state">
                <p className="mb-3">
                  {search.q
                    ? t('overview.emptyQuery', { q: search.q })
                    : t('overview.emptyFiltered')}
                </p>
                <Button
                  variant="ghost"
                  onClick={() => setSearch({ q: undefined, filter: undefined })}
                >
                  {t('overview.resetFilter')}
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-rule overflow-hidden surface">
                {rosterOrder(visible).map((s) => (
                  <RosterRow
                    key={s.id}
                    streamer={s}
                    onOpen={() => setDialog({ streamer: s })}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <StreamerDialog
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        streamer={dialog?.streamer ?? null}
      />
    </div>
  );
}

const FILTER_KEY = {
  all: 'overview.filterAll',
  live: 'overview.filterLive',
  active: 'overview.filterActive',
  paused: 'overview.filterPaused',
} as const satisfies Record<RosterFilter | 'all', MessageKey>;

function RosterControls({
  q,
  filter,
  counts,
  onChange,
}: {
  q: string;
  filter: RosterFilter | undefined;
  counts: Record<RosterFilter | 'all', number>;
  onChange: (next: { q?: string; filter?: RosterFilter }) => void;
}) {
  const t = useT();
  const current = filter ?? 'all';
  const [text, setText] = useState(q);
  const textRef = useRef(text);
  textRef.current = text;
  const debounced = useDebounced(text, SEARCH_DEBOUNCE_MS);

  // Debounced typing -> URL (the URL keeps the trimmed-blank rule).
  // biome-ignore lint/correctness/useExhaustiveDependencies: only react to the debounced text
  useEffect(() => {
    const next = debounced.trim() === '' ? undefined : debounced;
    if (next !== (q || undefined)) onChange({ q: next });
  }, [debounced]);

  // External URL change (reset, live tile link) -> input text.
  useEffect(() => {
    if (q !== textRef.current && !(q === '' && textRef.current.trim() === ''))
      setText(q);
  }, [q]);

  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
      <div className="w-full space-y-1.5 sm:max-w-md sm:flex-1">
        <Label
          htmlFor="roster-search"
          className="kicker block text-[0.6875rem] leading-normal font-bold"
        >
          {t('overview.searchLabel')}
        </Label>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="roster-search"
            type="search"
            value={text}
            placeholder={t('overview.searchPlaceholder')}
            onChange={(e) => setText(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>
      <div className="w-full space-y-1.5 sm:w-auto">
        <span id="roster-filter-label" className="kicker block">
          {t('overview.filterLabel')}
        </span>
        <RadioGroup
          value={current}
          onValueChange={(v) =>
            onChange({ filter: v === 'all' ? undefined : (v as RosterFilter) })
          }
          aria-labelledby="roster-filter-label"
          className="grid w-full grid-cols-4 gap-1 sm:flex sm:w-auto sm:flex-wrap sm:gap-1.5"
        >
          {(['all', ...ROSTER_FILTERS] as const).map((f) => (
            <Label
              key={f}
              className="inline-flex h-8 min-w-0 cursor-pointer items-center justify-center gap-1 rounded-md border border-input bg-background px-1.5 sm:justify-start sm:gap-1.5 sm:px-2.5 text-sm font-medium has-[[data-checked]]:border-2 has-[[data-checked]]:border-foreground has-[[data-checked]]:font-bold has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
            >
              <span className="sr-only">
                <RadioGroupItem value={f} />
              </span>
              {f === current && (
                <Check aria-hidden className="hidden size-3.5 sm:block" />
              )}
              {t(FILTER_KEY[f])}{' '}
              <span className="tabular text-muted-foreground">{counts[f]}</span>
            </Label>
          ))}
        </RadioGroup>
      </div>
    </div>
  );
}
