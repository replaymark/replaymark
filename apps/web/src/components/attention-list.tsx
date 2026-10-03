import type { Overview, Streamer, SubscriptionType } from '@shared/schemas.ts';
import { Link } from '@tanstack/react-router';
import { ArrowRight, CircleAlert } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button.tsx';
import type { MessageKey } from '@/i18n/core.ts';
import { useFormat, useT } from '@/i18n/i18n.tsx';
import { type AttentionItem, attentionItems } from '@/lib/streamers.ts';

const MAX_ROWS = 5;
const LINK_BUTTON = buttonVariants({ variant: 'outline', size: 'sm' });

const SUB_TYPE_KEY: Record<SubscriptionType, MessageKey> = {
  'stream.online': 'overview.subOnline',
  'stream.offline': 'overview.subOffline',
  'channel.update': 'overview.subUpdate',
};

function itemKey(item: AttentionItem): string {
  return item.kind === 'subscription'
    ? `sub:${item.streamer.id}:${item.state}`
    : item.kind;
}

/** Conditions that need the operator, each linking to its fix. Hidden when empty. */
export function AttentionList({
  overview,
  streamers,
}: {
  overview: Overview;
  streamers: readonly Streamer[];
}) {
  const t = useT();
  const fmt = useFormat();
  const items = attentionItems(overview, streamers);
  if (items.length === 0) return null;
  const shown = items.slice(0, MAX_ROWS);
  const more = items.length - shown.length;

  const describe = (
    item: AttentionItem,
  ): { title: string; detail?: string } => {
    switch (item.kind) {
      case 'syncFailed':
        return {
          title: t('overview.attentionSyncFailed', { time: fmt.time(item.at) }),
          detail: item.errors.length > 0 ? item.errors.join('; ') : undefined,
        };
      case 'failedMails': {
        const error = overview.notifications.lastError;
        return {
          title: t.plural('overview.attentionFailedMails', item.count),
          detail: error
            ? t('overview.attentionLastError', { error })
            : undefined,
        };
      }
      case 'subscription': {
        const params = {
          name: item.streamer.displayName,
          types: item.types.map((x) => t(SUB_TYPE_KEY[x])).join(', '),
        };
        return item.state === 'error'
          ? {
              title: t('overview.attentionSubError', params),
              detail: t('overview.attentionSubErrorDetail'),
            }
          : {
              title: t('overview.attentionSubMissing', params),
              detail: t('overview.attentionSubMissingDetail'),
            };
      }
    }
  };

  return (
    <section aria-labelledby="attention" className="surface">
      <h2
        id="attention"
        className="border-b border-rule p-3 font-display text-2xl leading-none font-extrabold tracking-wide uppercase"
      >
        {t('overview.attentionTitle')}
      </h2>
      <ul className="list-none divide-y divide-rule">
        {shown.map((item) => {
          const { title, detail } = describe(item);
          const label =
            item.kind === 'failedMails'
              ? t('overview.attentionViewHistory')
              : t('overview.attentionOpenSubs');
          return (
            <li
              key={itemKey(item)}
              className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="flex min-w-0 items-start gap-2">
                <CircleAlert
                  className="mt-0.5 size-4 shrink-0 text-crimson"
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="font-semibold">{title}</p>
                  {detail && (
                    <p className="break-words text-sm text-muted-foreground">
                      {detail}
                    </p>
                  )}
                </div>
              </div>
              {item.kind === 'failedMails' ? (
                <Link
                  to="/history"
                  search={{ status: 'failed' }}
                  className={LINK_BUTTON}
                >
                  {label}
                  <ArrowRight aria-hidden />
                </Link>
              ) : (
                <Link to="/settings" hash="sync" className={LINK_BUTTON}>
                  {label}
                  <ArrowRight aria-hidden />
                </Link>
              )}
            </li>
          );
        })}
        {more > 0 && (
          <li className="p-3 text-sm">
            <Link
              to="/settings"
              hash="sync"
              className="text-muted-foreground underline"
            >
              {t.plural('overview.attentionMore', more)}
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}
