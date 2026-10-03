import type {
  TimelineSegment,
  TimelineStream,
  TimelineVodState,
} from '@shared/schemas.ts';
import {
  CircleAlert,
  Clock,
  ExternalLink,
  Info,
  PlayCircle,
  VolumeX,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { BoxArt } from '@/components/box-art.tsx';
import { StreamerAvatar } from '@/components/streamer-avatar.tsx';
import { TallyLamp } from '@/components/tally-lamp.tsx';
import { Button, buttonVariants } from '@/components/ui/button.tsx';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip.tsx';
import type { MessageKey } from '@/i18n/core.ts';
import { useFormat, useT } from '@/i18n/i18n.tsx';
import { formatDuration, segmentDuration, stripParts } from '@/lib/timeline.ts';
import { cn } from '@/lib/utils.ts';

const TICK_MS = 30_000;

/** Current time, ticking while `active` so open segments count up. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function Hint({
  icon,
  label,
  hint,
  className,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            className={cn(
              'h-auto cursor-help gap-1 rounded-sm border-0 p-0 text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-muted-foreground dark:hover:bg-transparent',
              className,
            )}
          />
        }
      >
        {icon}
        {label}
        <span className="sr-only">: {hint}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{hint}</TooltipContent>
    </Tooltip>
  );
}

const VOD: Record<
  TimelineVodState,
  { label: MessageKey; hint: MessageKey | null }
> = {
  available: { label: 'timeline.vodAvailable', hint: null },
  pending: { label: 'timeline.vodPending', hint: 'timeline.vodPendingHint' },
  none: { label: 'timeline.vodNone', hint: 'timeline.vodNoneHint' },
  likely_expired: {
    label: 'timeline.vodExpired',
    hint: 'timeline.vodExpiredHint',
  },
};

export function VodState({ state }: { state: TimelineVodState }) {
  const t = useT();
  const v = VOD[state];
  if (!v.hint)
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <PlayCircle className="size-3.5" aria-hidden />
        {t(v.label)}
      </span>
    );
  const icon =
    state === 'likely_expired' ? (
      <CircleAlert className="size-3.5" aria-hidden />
    ) : state === 'pending' ? (
      <Clock className="size-3.5" aria-hidden />
    ) : (
      <Info className="size-3.5" aria-hidden />
    );
  return (
    <Hint
      icon={icon}
      label={t(v.label)}
      hint={t(v.hint)}
      className={cn(state === 'likely_expired' && 'text-status-pending')}
    />
  );
}

export function LiveBadge() {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm bg-live px-1.5 py-0.5 text-xs font-bold tracking-wide text-white uppercase">
      <TallyLamp live className="bg-white!" size={6} />
      {t('timeline.live')}
    </span>
  );
}

/** Avatar, name, date and span of a stream; `children` go on the right. */
export function StreamHead({
  stream,
  now,
  children,
  as: Heading = 'h2',
}: {
  stream: TimelineStream;
  now: number;
  children?: ReactNode;
  as?: 'h1' | 'h2';
}) {
  const t = useT();
  const f = useFormat();
  const b = stream.broadcaster;
  const name = b.displayName ?? b.login ?? t('timeline.unknownStreamer');
  const total = (stream.endedAt ?? now) - stream.startedAt;
  return (
    <div className="flex min-w-0 items-start gap-3">
      <StreamerAvatar url={b.avatarUrl} name={name} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Heading className="truncate font-display text-xl leading-tight font-bold">
            {name}
          </Heading>
          {stream.live && <LiveBadge />}
        </div>
        <p className="tabular text-sm text-muted-foreground">
          <span className="text-foreground">{f.date(stream.startedAt)}</span> ·{' '}
          {stream.endedAt === null
            ? t('timeline.streamLive', { start: f.time(stream.startedAt) })
            : t('timeline.streamTime', {
                start: f.time(stream.startedAt),
                end: `${stream.endApprox ? '~' : ''}${f.time(stream.endedAt)}`,
              })}{' '}
          · <span className="whitespace-nowrap">{formatDuration(total)}</span>
        </p>
      </div>
      {children}
    </div>
  );
}

/** One segment: window, duration, hints and the deep link. */
export function SegmentRow({
  segment: s,
  now,
  name,
  showGame = false,
  highlighted = false,
}: {
  segment: TimelineSegment;
  now: number;
  name: string;
  showGame?: boolean;
  highlighted?: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const start = `${s.startApprox ? '~' : ''}${f.time(s.startedAt)}`;
  const window =
    s.endedAt === null
      ? t('timeline.streamLive', { start })
      : t('timeline.streamTime', {
          start,
          end: `${s.endApprox ? '~' : ''}${f.time(s.endedAt)}`,
        });
  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5',
        highlighted && 'border-l-4 border-l-ink pl-2',
      )}
    >
      {showGame && (
        <span className="flex w-full min-w-0 items-center gap-2 sm:w-56">
          <BoxArt url={s.boxArtUrl} width={21} height={28} />
          <span
            className={cn(
              'truncate text-sm',
              highlighted ? 'font-semibold' : 'text-muted-foreground',
            )}
          >
            {s.categoryName}
          </span>
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="tabular font-medium">{window}</span>
        <span className="tabular text-sm whitespace-nowrap text-muted-foreground">
          {formatDuration(segmentDuration(s, now))}
        </span>
        {(s.startApprox || s.endApprox) && (
          <Hint
            icon={<Info className="size-3.5" aria-hidden />}
            label={t('timeline.approx')}
            hint={t('timeline.approxHint')}
          />
        )}
        {s.muted && (
          <Hint
            icon={<VolumeX className="size-3.5" aria-hidden />}
            label={t('timeline.muted')}
            hint={t('timeline.mutedHint')}
          />
        )}
      </span>
      {s.link && (
        <a
          href={s.link}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('timeline.watchLabel', { name, time: start })}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          {t('timeline.watch')}
          <ExternalLink aria-hidden />
        </a>
      )}
    </li>
  );
}

const LABEL_MIN_PX = 56;
const MARKER_MIN_PX = 14;
const HOUR_MS = 3_600_000;
const TICK_MIN_PX = 64;
const TICK_STEPS = [1, 2, 3, 6];

/** Width of the referenced element, tracked while `enabled`. */
function useWidth(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);
  return { ref, width };
}

/**
 * Proportional strip of every segment. Ink: segments of `highlightId`, or all
 * when `inkAll`; the rest is muted. `labels` names segments wide enough.
 */
export function SegmentStrip({
  segments,
  now,
  highlightId,
  inkAll = false,
  labels = false,
  markers = false,
}: {
  segments: TimelineSegment[];
  now: number;
  highlightId?: string;
  inkAll?: boolean;
  labels?: boolean;
  /** Number segments too narrow for a label; pair with `StripLegend`. */
  markers?: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const { ref, width } = useWidth(labels || markers);
  const parts = stripParts(segments, now, highlightId);
  return (
    <div
      ref={ref}
      role="img"
      aria-label={t('timeline.strip')}
      className="flex h-9 w-full gap-0.5 overflow-hidden surface p-0.5"
    >
      {parts.map((p) => {
        const s = segments[p.index];
        if (!s) return null;
        const ink = inkAll || p.highlighted;
        const showLabel = labels && (width * p.percent) / 100 >= LABEL_MIN_PX;
        return (
          <span
            key={`${s.startedAt}-${p.index}`}
            title={`${s.categoryName} · ${f.time(s.startedAt)} · ${formatDuration(segmentDuration(s, now))}`}
            className={cn(
              'flex h-full min-w-0 items-center rounded-xs px-1.5 text-xs',
              ink
                ? 'bg-ink text-primary-foreground'
                : 'bg-muted-foreground/30 text-foreground',
              p.open && (ink ? 'strip-open-ink' : 'strip-open'),
            )}
            style={{ width: `${p.percent}%` }}
          >
            {showLabel ? (
              <span className="truncate">{s.categoryName}</span>
            ) : (
              markers &&
              (width * p.percent) / 100 >= MARKER_MIN_PX && (
                <span className="tabular mx-auto font-semibold">
                  {p.index + 1}
                </span>
              )
            )}
          </span>
        );
      })}
    </div>
  );
}

/** Numbered list of every segment, matching the markers in the strip. */
export function StripLegend({
  segments,
  now,
  highlightId,
}: {
  segments: TimelineSegment[];
  now: number;
  highlightId?: string;
}) {
  const t = useT();
  const f = useFormat();
  return (
    <ol
      aria-label={t('timeline.legend')}
      className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs"
    >
      {segments.map((s, i) => {
        const end = s.endedAt === null ? now : s.endedAt;
        return (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: startedAt can repeat; the list is static and ordered
            key={`${s.startedAt}-${i}`}
            className="flex min-w-0 max-w-full items-baseline gap-1.5"
          >
            <span className="tabular inline-flex size-5 shrink-0 items-center justify-center rounded-xs bg-muted-foreground/30 font-semibold">
              {i + 1}
            </span>
            <span
              className={cn(
                'break-words',
                s.categoryId === highlightId && 'font-semibold',
              )}
            >
              {s.categoryName}
            </span>
            <span className="tabular whitespace-nowrap text-muted-foreground">
              {f.time(s.startedAt)}–{f.time(end)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Start and end time under the strip, plus hour ticks from 3 h on. */
export function StripAxis({
  startedAt,
  endedAt,
  now,
}: {
  startedAt: number;
  endedAt: number | null;
  now: number;
}) {
  const f = useFormat();
  const end = endedAt ?? now;
  const span = end - startedAt;
  const { ref, width } = useWidth(true);
  const ticks: { at: number; pos: number }[] = [];
  // Smallest hour step that keeps neighbouring labels TICK_MIN_PX apart.
  const step =
    TICK_STEPS.find((h) => (width * h * HOUR_MS) / span >= TICK_MIN_PX) ??
    TICK_STEPS[TICK_STEPS.length - 1] ??
    1;
  if (span >= 3 * HOUR_MS && width > 0) {
    const first = new Date(startedAt);
    first.setMinutes(0, 0, 0);
    for (
      let d = new Date(first.getTime());
      d.getTime() < end;
      d.setHours(d.getHours() + 1)
    ) {
      const pos = (d.getTime() - startedAt) / span;
      if (
        d.getHours() % step === 0 &&
        pos * width >= TICK_MIN_PX &&
        (1 - pos) * width >= TICK_MIN_PX
      )
        ticks.push({ at: d.getTime(), pos });
    }
  }
  return (
    <div
      ref={ref}
      className="tabular relative h-9 text-xs text-muted-foreground"
      aria-hidden
    >
      <span className="absolute left-0 top-0">{f.time(startedAt)}</span>
      <span className="absolute right-0 top-0">{f.time(end)}</span>
      {ticks.map(({ at, pos }) => (
        <span
          key={at}
          className="absolute top-0 -translate-x-1/2"
          style={{ left: `${pos * 100}%` }}
        >
          <span className="mx-auto block h-1.5 w-px bg-rule" />
          {f.time(at)}
        </span>
      ))}
    </div>
  );
}
