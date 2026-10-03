import type { Category, RecordedCategory, Streamer } from '@shared/schemas.ts';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { BoxArt } from '@/components/box-art.tsx';
import { CategoryPicker } from '@/components/category-picker.tsx';
import { StreamerAvatar } from '@/components/streamer-avatar.tsx';
import {
  SegmentRow,
  SegmentStrip,
  StreamHead,
  useNow,
  VodState,
} from '@/components/timeline.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover.tsx';
import { useFormat, useT } from '@/i18n/i18n.tsx';
import {
  errorCode,
  recordedCategoriesQuery,
  streamersQuery,
  timelineQuery,
} from '@/lib/queries.ts';
import { rosterOrder } from '@/lib/streamers.ts';
import {
  isDate,
  parseTimelineSearch,
  type TimelineSearch,
  toggleStreamer,
} from '@/lib/timeline.ts';
import { cn } from '@/lib/utils.ts';

export const Route = createFileRoute('/_app/timeline/')({
  validateSearch: parseTimelineSearch,
  component: TimelinePage,
});

function TimelinePage() {
  const t = useT();
  const fmt = useFormat();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const recorded = useQuery(recordedCategoriesQuery);
  const streamers = useQuery(streamersQuery);
  const q = useQuery(timelineQuery(search));
  const [picked, setPicked] = useState<Category | null>(null);

  const set = (next: TimelineSearch) => void navigate({ search: next });
  const patch = (p: Partial<TimelineSearch>) =>
    set({ ...search, page: undefined, ...p });

  const recordedList = recorded.data ?? [];
  const matchSegment = q.data?.items[0]?.segments.find((s) => s.match);
  const selected: Category | null = search.categoryId
    ? (recordedList.find((c) => c.id === search.categoryId) ??
      (picked?.id === search.categoryId ? picked : null) ??
      (matchSegment
        ? {
            id: search.categoryId,
            name: matchSegment.categoryName,
            boxArtUrl: matchSegment.boxArtUrl,
          }
        : { id: search.categoryId, name: search.categoryId, boxArtUrl: null }))
    : null;

  const pickCategory = (c: Category | null) => {
    setPicked(c);
    patch({ categoryId: c?.id });
  };

  const items = q.data?.items ?? [];
  const now = useNow(items.some((s) => s.live));
  const page = search.page ?? 1;
  const filtered = Boolean(
    search.streamers?.length || search.from || search.to,
  );

  return (
    <div className="space-y-8">
      <header>
        <p className="kicker tabular">
          {q.data
            ? t('timeline.kicker', { date: fmt.date(q.data.recordingSince) })
            : t('timeline.kickerPlain')}
        </p>
        <h1 className="page-title">{t('timeline.title')}</h1>
      </header>

      <section className="space-y-4 surface p-4">
        <div className="space-y-2">
          <Label htmlFor="timeline-game" className="leading-normal">
            {t('timeline.game')}
          </Label>
          <CategoryPicker
            id="timeline-game"
            single
            placeholder={t('timeline.gamePlaceholder')}
            value={selected ? [selected] : []}
            onChange={(next) => pickCategory(next[0] ?? null)}
          />
        </div>

        {recordedList.length > 0 && (
          <RecordedChips
            list={recordedList}
            current={search.categoryId}
            onPick={(c) => pickCategory(search.categoryId === c.id ? null : c)}
          />
        )}

        <StreamerFilter
          list={streamers.data ?? []}
          search={search}
          onChange={set}
        />

        <fieldset className="min-w-0">
          <legend className="sr-only">
            {t('timeline.dateFrom')} / {t('timeline.dateTo')}
          </legend>
          <div className="flex flex-wrap items-end gap-3">
            <DateField
              id="timeline-from"
              label={t('timeline.dateFrom')}
              value={search.from}
              max={search.to}
              onChange={(from) => patch({ from })}
            />
            <DateField
              id="timeline-to"
              label={t('timeline.dateTo')}
              value={search.to}
              min={search.from}
              onChange={(to) => patch({ to })}
            />
            {(search.from || search.to) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9"
                onClick={() => patch({ from: undefined, to: undefined })}
              >
                <X aria-hidden />
                {t('timeline.clearDates')}
              </Button>
            )}
          </div>
        </fieldset>
      </section>

      {q.isError ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{t.error(errorCode(q.error))}</AlertDescription>
        </Alert>
      ) : q.isPending ? (
        <p className="text-muted-foreground">{t('app.loading')}</p>
      ) : items.length === 0 ? (
        <p className="empty-state">
          {search.categoryId
            ? t('timeline.emptyResults', {
                date: fmt.date(q.data?.recordingSince ?? Date.now()),
              })
            : filtered
              ? t('timeline.emptyFiltered')
              : t('timeline.emptyRecorded')}
        </p>
      ) : (
        <>
          {!search.categoryId && (
            <h2 className="font-display text-xl font-bold">
              {t('timeline.recent')}
            </h2>
          )}
          <ul className={cn('space-y-3', q.isPlaceholderData && 'opacity-60')}>
            {items.map((s) => (
              <li key={s.streamId} className="surface p-4">
                <StreamHead stream={s} now={now} />
                <div className="mt-3">
                  <SegmentStrip
                    segments={s.segments}
                    now={now}
                    highlightId={search.categoryId}
                    inkAll={!search.categoryId}
                    labels
                  />
                </div>
                <ul className="mt-3 divide-y divide-rule border-t">
                  {s.segments
                    .filter((seg) => !search.categoryId || seg.match)
                    .map((seg, i) => (
                      <SegmentRow
                        // biome-ignore lint/suspicious/noArrayIndexKey: startedAt can repeat; the list is static and ordered
                        key={`${seg.startedAt}-${i}`}
                        segment={seg}
                        now={now}
                        name={seg.categoryName}
                        showGame={!search.categoryId}
                      />
                    ))}
                </ul>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t pt-3">
                  <VodState state={s.vodState} />
                  <Link
                    to="/timeline/$streamId"
                    params={{ streamId: s.streamId }}
                    search={search}
                    className="ml-auto inline-flex items-center gap-1 rounded-sm text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {t('timeline.details')}
                    <ChevronRight className="size-4" aria-hidden />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          {(page > 1 || q.data?.hasMore) && (
            <nav className="flex items-center justify-between gap-3">
              <Button
                variant="outline"
                size="icon"
                disabled={page <= 1}
                onClick={() =>
                  set({ ...search, page: page > 2 ? page - 1 : undefined })
                }
                aria-label={t('timeline.previous')}
              >
                <ChevronLeft aria-hidden />
              </Button>
              <span className="tabular text-sm">
                {t('timeline.page', { page })}
              </span>
              <Button
                variant="outline"
                size="icon"
                disabled={!q.data?.hasMore}
                onClick={() => set({ ...search, page: page + 1 })}
                aria-label={t('timeline.next')}
              >
                <ChevronRight aria-hidden />
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

function RecordedChips({
  list,
  current,
  onPick,
}: {
  list: RecordedCategory[];
  current: string | undefined;
  onPick: (c: RecordedCategory) => void;
}) {
  const t = useT();
  const f = useFormat();
  const scroller = useRef<HTMLUListElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the selection changes
  useEffect(() => {
    const el = scroller.current;
    const chip = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!el || !chip) return;
    const left =
      chip.getBoundingClientRect().left -
      el.getBoundingClientRect().left +
      el.scrollLeft -
      (el.clientWidth - chip.offsetWidth) / 2;
    el.scrollTo({ left: Math.max(0, left) });
  }, [current]);
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="mb-2 text-sm font-medium">
        {t('timeline.recorded')}
      </legend>
      <ul ref={scroller} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {list.map((c) => {
          const active = c.id === current;
          return (
            <li key={c.id} className="shrink-0">
              <Button
                type="button"
                variant="ghost"
                aria-pressed={active}
                onClick={() => onPick(c)}
                className={cn(
                  'h-auto max-w-64 justify-start gap-2 rounded-md border py-1 pr-3 pl-1 text-left font-normal whitespace-normal transition-colors duration-150',
                  active
                    ? 'border-ink bg-paper ring-1 ring-ink hover:bg-paper dark:hover:bg-paper'
                    : 'border-border bg-sheet hover:bg-paper dark:hover:bg-paper',
                )}
              >
                <BoxArt url={c.boxArtUrl} width={27} height={36} />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block text-sm font-medium',
                      active ? 'break-words' : 'truncate',
                    )}
                  >
                    {c.name}
                  </span>
                  <span
                    className={cn(
                      'tabular block text-xs text-muted-foreground',
                      active ? 'break-words' : 'truncate',
                    )}
                  >
                    {t.plural('timeline.recordedMeta', c.streamCount, {
                      date: f.date(c.lastPlayedAt),
                    })}
                  </span>
                </span>
                {active && <Check className="size-4 shrink-0" aria-hidden />}
              </Button>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function StreamerFilter({
  list,
  search,
  onChange,
}: {
  list: Streamer[];
  search: TimelineSearch;
  onChange: (next: TimelineSearch) => void;
}) {
  const t = useT();
  if (list.length === 0) return null;
  const chosen = search.streamers ?? [];
  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium">
        {t('timeline.streamers')}
      </span>
      <Popover>
        <PopoverTrigger
          render={<Button variant="outline" className="h-9 max-w-full" />}
        >
          <span className="truncate">
            {chosen.length === 0
              ? t('timeline.streamersAll')
              : t('timeline.streamersCount', { count: chosen.length })}
          </span>
          <ChevronDown aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="start" className="max-h-80 overflow-y-auto">
          <ul className="space-y-0.5">
            {rosterOrder(list).map((s) => (
              <li key={s.id}>
                <Label className="font-normal flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-1.5 hover:bg-paper">
                  <Checkbox
                    checked={chosen.includes(s.id)}
                    onCheckedChange={() =>
                      onChange(toggleStreamer(search, s.id))
                    }
                  />
                  <StreamerAvatar
                    url={s.avatarUrl}
                    name={s.displayName}
                    size={22}
                  />
                  <span className="min-w-0 truncate">{s.displayName}</span>
                </Label>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function DateField({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: string | undefined;
  min?: string;
  max?: string;
  onChange: (next: string | undefined) => void;
}) {
  return (
    <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-48 sm:flex-none">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="date"
        value={value ?? ''}
        min={min}
        max={max}
        onChange={(e) => {
          const v = e.target.value;
          onChange(isDate(v) ? v : undefined);
        }}
        className="h-9 min-w-0"
      />
    </div>
  );
}
