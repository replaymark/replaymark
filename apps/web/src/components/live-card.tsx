import type { Streamer } from '@shared/schemas.ts';
import { Link } from '@tanstack/react-router';
import {
  CircleCheck,
  CircleDashed,
  CircleMinus,
  Clock,
  ExternalLink,
  MailX,
  Pause,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { BoxArt } from '@/components/box-art.tsx';
import { StreamerAvatar } from '@/components/streamer-avatar.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { useFormat, useT } from '@/i18n/i18n.tsx';
import { type LiveReason, liveDuration, liveReason } from '@/lib/streamers.ts';
import { cn } from '@/lib/utils.ts';

export function LiveCard({
  streamer: s,
  now,
  entering,
}: {
  streamer: Streamer;
  now: Date;
  entering: boolean;
}) {
  const t = useT();
  const fmt = useFormat();
  const cat = s.currentCategory;
  let timing: string | null = null;
  if (s.startedAt) {
    const { hours, minutes } = liveDuration(s.startedAt, now);
    const duration =
      hours > 0
        ? t('overview.durationHoursMinutes', { h: hours, m: minutes })
        : t('overview.durationMinutes', { m: minutes });
    timing = `${t('overview.since', { time: fmt.time(s.startedAt) })} · ${duration}`;
  }
  return (
    <li
      className={cn(
        'surface flex min-w-0 flex-col gap-3 p-3',
        entering &&
          'animate-in fade-in-0 slide-in-from-left-4 duration-500 motion-reduce:animate-none',
      )}
    >
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <StreamerAvatar url={s.avatarUrl} name={s.displayName} size={40} />
          <span
            role="img"
            aria-label={t('overview.liveNow', { name: s.displayName })}
            data-live
            className="tally-lamp absolute right-0 bottom-0 size-3 ring-2 ring-card"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{s.displayName}</p>
          {timing && (
            <p className="tabular text-sm text-muted-foreground">{timing}</p>
          )}
        </div>
        <Badge variant="outline" className="shrink-0 gap-1.5 font-bold">
          <span aria-hidden className="tally-lamp size-2" data-live />
          {t('overview.liveBadge')}
        </Badge>
      </div>
      <div className="flex min-w-0 gap-3">
        <BoxArt url={cat?.boxArtUrl ?? null} width={45} height={60} />
        <div className="min-w-0 flex-1">
          <p className="font-bold">{cat?.name ?? t('overview.noGame')}</p>
          {s.title && (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {s.title}
            </p>
          )}
        </div>
      </div>
      <div className="mt-auto flex flex-col gap-1 border-t border-rule pt-2 sm:flex-row sm:items-center sm:justify-between sm:gap-x-3">
        <ReasonLine reason={liveReason(s)} />
        <a
          href={`https://www.twitch.tv/${s.login}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('overview.watchOnTwitch', { name: s.displayName })}
          className="inline-flex items-center gap-1 self-start text-sm font-medium underline-offset-2 hover:underline"
        >
          {t('overview.watch')}
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
    </li>
  );
}

function Reason({
  icon,
  className,
  children,
}: {
  icon: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      className={cn('flex items-center gap-1.5 text-sm font-medium', className)}
    >
      {icon}
      {children}
    </p>
  );
}

const ICON = 'size-4 shrink-0';

function ReasonLine({ reason }: { reason: LiveReason }) {
  const t = useT();
  const fmt = useFormat();
  const muted = 'text-muted-foreground';
  if (reason.key === 'paused')
    return (
      <Reason icon={<Pause className={ICON} aria-hidden />} className={muted}>
        {t('overview.reasonPaused')}
      </Reason>
    );
  if (reason.key === 'noMatch')
    return (
      <Reason
        icon={<CircleMinus className={ICON} aria-hidden />}
        className={muted}
      >
        {t(
          reason.mode === 'custom'
            ? 'overview.reasonNoMatchCustom'
            : 'overview.reasonNoMatchDefault',
        )}
      </Reason>
    );
  if (reason.mail === 'failed')
    return (
      <Reason
        icon={<MailX className={cn(ICON, 'text-status-error')} aria-hidden />}
      >
        <Link
          to="/history"
          search={{ status: 'failed' }}
          className="font-medium text-status-error underline underline-offset-2"
        >
          {t('overview.reasonMatchFailed')}
        </Link>
      </Reason>
    );
  if (reason.mail === 'pending')
    return (
      <Reason
        icon={<Clock className={cn(ICON, 'text-status-pending')} aria-hidden />}
      >
        {t('overview.reasonMatchPending')}
      </Reason>
    );
  if (reason.mail === 'sent')
    return (
      <Reason
        icon={
          <CircleCheck
            className={cn(ICON, 'text-status-enabled')}
            aria-hidden
          />
        }
      >
        {reason.at
          ? t('overview.reasonMatchSent', { time: fmt.time(reason.at) })
          : t('overview.reasonMatchSentPlain')}
      </Reason>
    );
  return (
    <Reason
      icon={<CircleDashed className={cn(ICON, muted)} aria-hidden />}
      className={muted}
    >
      {t('overview.reasonMatchNone')}
    </Reason>
  );
}
