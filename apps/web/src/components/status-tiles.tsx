import type { Overview } from '@shared/schemas.ts';
import { Link } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { TallyLamp } from '@/components/tally-lamp.tsx';
import { useFormat, useT } from '@/i18n/i18n.tsx';
import { cn } from '@/lib/utils.ts';

export const TILE_BASE = 'block h-full rounded-md surface p-3';
const TILE = `${TILE_BASE} transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2`;

export function Numeral({
  children,
  failed = false,
}: {
  children: ReactNode;
  failed?: boolean;
}) {
  return (
    <span
      className={cn(
        'tabular block font-display text-[clamp(1.75rem,6vw,2.5rem)] leading-none font-extrabold whitespace-nowrap',
        failed && 'text-crimson',
      )}
    >
      {children}
    </span>
  );
}

export function Caption({
  children,
  failed = false,
}: {
  children: ReactNode;
  failed?: boolean;
}) {
  return (
    <span
      className={cn(
        'mt-1.5 flex items-center gap-1 text-sm',
        failed ? 'font-medium text-crimson' : 'text-muted-foreground',
      )}
    >
      {failed && <CircleAlert className="size-4 shrink-0" aria-hidden />}
      {children}
    </span>
  );
}

export function syncStamp(
  at: string,
  fmt: ReturnType<typeof useFormat>,
): string {
  const d = new Date(at);
  return d.toDateString() === new Date().toDateString()
    ? fmt.time(d)
    : fmt.dateTime(d);
}

/** Four link tiles summarising live, subscription, sync and mail state. */
export function StatusTiles({ data }: { data: Overview }) {
  const t = useT();
  const fmt = useFormat();
  const sync = data.lastSync;
  const failedMails = data.notifications.failed;
  const { live } = data.streamers;
  const subs = data.subscriptions;
  const subsShort = subs !== null && subs.active < subs.expected;
  return (
    <section aria-label={t('overview.status')}>
      <ul
        className={cn(
          'grid list-none grid-cols-2 gap-3',
          subs !== null && 'sm:grid-cols-4',
        )}
      >
        <li>
          <Link to="/" search={{ filter: 'live' }} className={TILE}>
            <Numeral>
              <span className="inline-flex items-center gap-2">
                {live > 0 && <TallyLamp live size={12} />}
                {live}
              </span>
            </Numeral>
            <Caption>{t('overview.tileLive')}</Caption>
          </Link>
        </li>
        {subs !== null && (
          <li>
            <Link to="/settings" hash="sync" className={TILE}>
              <Numeral failed={subsShort}>
                {`${subs.active}/${subs.expected}`}
              </Numeral>
              <Caption failed={subsShort}>{t('overview.tileSubs')}</Caption>
            </Link>
          </li>
        )}
        {subs !== null && (
          <li>
            <Link to="/settings" hash="sync" className={TILE}>
              <Numeral failed={sync !== null && !sync.ok}>
                {sync ? syncStamp(sync.at, fmt) : '–'}
              </Numeral>
              <Caption failed={sync !== null && !sync.ok}>
                {!sync
                  ? t('overview.syncNever')
                  : sync.ok
                    ? t('overview.tileSyncOk')
                    : t('overview.tileSyncFailed')}
              </Caption>
            </Link>
          </li>
        )}
        <li>
          <Link to="/history" search={{ status: 'failed' }} className={TILE}>
            <Numeral failed={failedMails > 0}>{failedMails}</Numeral>
            <Caption failed={failedMails > 0}>
              {t.plural('overview.tileFailedMails', failedMails)}
            </Caption>
          </Link>
        </li>
      </ul>
    </section>
  );
}
