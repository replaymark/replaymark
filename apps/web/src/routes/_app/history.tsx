import type { NotificationItem, NotificationStatus } from '@shared/schemas.ts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock,
  RotateCw,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BoxArt } from '@/components/box-art.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Label } from '@/components/ui/label.tsx';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group.tsx';
import type { MessageKey } from '@/i18n/core.ts';
import { useFormat, useT } from '@/i18n/i18n.tsx';
import { api, queryKeys, unwrap } from '@/lib/api.ts';
import {
  applyStatusFilter,
  pageCount,
  parseHistorySearch,
  type StatusFilter,
} from '@/lib/history.ts';
import {
  errorCode,
  notificationsQuery,
  retryFailedNotifications,
} from '@/lib/queries.ts';
import { cn } from '@/lib/utils.ts';

export const Route = createFileRoute('/_app/history')({
  validateSearch: parseHistorySearch,
  component: HistoryPage,
});

const FILTERS = ['all', 'failed', 'pending', 'sent'] as const;

const FILTER_KEY: Record<StatusFilter, MessageKey> = {
  all: 'history.filterAll',
  pending: 'history.statusPending',
  sent: 'history.statusSent',
  failed: 'history.statusFailed',
};

const ICON = 'size-4 shrink-0';

function HistoryPage() {
  const t = useT();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const qc = useQueryClient();
  const [requeued, setRequeued] = useState<number | null>(null);
  const current: StatusFilter = search.status ?? 'all';
  const page = search.page ?? 1;
  const main = useQuery(
    notificationsQuery({
      status: current === 'all' ? ['pending', 'sent'] : current,
      page,
    }),
  );
  const attentionEnabled = current === 'all' && page === 1;
  const attention = useQuery({
    ...notificationsQuery({ status: 'failed', page: 1 }),
    enabled: attentionEnabled,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on filter/page change
  useEffect(() => setRequeued(null), [current, page]);
  useEffect(() => {
    if (requeued === null) return;
    const id = setTimeout(() => setRequeued(null), 6000);
    return () => clearTimeout(id);
  }, [requeued]);
  const counts = main.data?.counts ?? attention.data?.counts;
  const retryAll = useMutation({
    mutationFn: retryFailedNotifications,
    onSuccess: (r) => setRequeued(r.requeued),
    onError: (err) => toast.error(t.error(errorCode(err))),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.notifications });
      void qc.invalidateQueries({ queryKey: queryKeys.overview });
    },
  });
  const pages = main.data ? pageCount(main.data.total, main.data.pageSize) : 1;
  const goPage = (p: number) =>
    void navigate({ search: (s) => ({ ...s, page: p > 1 ? p : undefined }) });
  const showAttention =
    attentionEnabled && (attention.data?.items.length ?? 0) > 0;
  const attentionLoading = attentionEnabled && attention.isPending;
  const attentionError = attentionEnabled && attention.isError;
  const noMain = (main.data?.items.length ?? 0) === 0;

  return (
    <div className="space-y-8">
      <header className="flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="kicker">{t('history.kicker')}</p>
          <h1 className="page-title">{t('history.title')}</h1>
        </div>
        {counts && counts.failed > 0 && (
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <Button
              disabled={retryAll.isPending}
              onClick={() => {
                setRequeued(null);
                retryAll.mutate();
              }}
            >
              <RotateCw
                aria-hidden
                className={cn(
                  retryAll.isPending &&
                    'animate-spin motion-reduce:animate-none',
                )}
              />
              {t(
                retryAll.isPending ? 'history.retryingAll' : 'history.retryAll',
              )}
            </Button>
          </div>
        )}
      </header>
      {requeued !== null && (
        <p role="status" className="-mt-6 text-sm">
          {t.plural('history.retriedAll', requeued)}
        </p>
      )}

      <div className="space-y-1.5">
        <span id="history-filter-label" className="sr-only">
          {t('history.filter')}
        </span>
        <RadioGroup
          value={current}
          onValueChange={(v) =>
            void navigate({ search: applyStatusFilter(v as StatusFilter) })
          }
          aria-labelledby="history-filter-label"
          className="grid w-full grid-cols-2 gap-1 sm:flex sm:w-auto sm:flex-wrap sm:gap-1.5"
        >
          {FILTERS.map((f) => (
            <Label
              key={f}
              className="inline-flex h-8 min-w-0 cursor-pointer items-center justify-center gap-1 rounded-md border border-input bg-background px-1.5 sm:justify-start sm:gap-1.5 sm:px-2.5 text-sm font-medium has-[[data-checked]]:border-2 has-[[data-checked]]:border-foreground has-[[data-checked]]:font-bold has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
            >
              <span className="sr-only">
                <RadioGroupItem value={f} />
              </span>
              {f === current && (
                <Check aria-hidden className="size-3.5 shrink-0" />
              )}
              {t(FILTER_KEY[f])}{' '}
              {counts && (
                <span className="tabular text-muted-foreground">
                  {counts[f]}
                </span>
              )}
            </Label>
          ))}
        </RadioGroup>
      </div>

      {main.isError ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{t.error(errorCode(main.error))}</AlertDescription>
        </Alert>
      ) : main.isPending ? (
        <p className="text-muted-foreground">{t('app.loading')}</p>
      ) : (
        <>
          {showAttention && attention.data && (
            <MailSection
              title={t('history.needsAttention')}
              items={attention.data.items}
            />
          )}
          {attentionError && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>
                {t.error(errorCode(attention.error))}
              </AlertDescription>
            </Alert>
          )}
          {attentionLoading && (
            <p className="text-muted-foreground">{t('app.loading')}</p>
          )}
          {noMain && !showAttention ? (
            attentionLoading || attentionError ? null : (
              <p className="empty-state">
                {t(search.status ? 'history.emptyFiltered' : 'history.empty')}
              </p>
            )
          ) : (
            !noMain && (
              <MailSection
                title={current === 'all' ? t('history.allMails') : undefined}
                items={main.data.items}
                dim={main.isPlaceholderData}
              />
            )
          )}
          {pages > 1 && (
            <nav className="flex items-center justify-between gap-3">
              <Button
                variant="outline"
                size="icon"
                disabled={page <= 1}
                onClick={() => goPage(page - 1)}
                aria-label={t('history.previous')}
              >
                <ChevronLeft aria-hidden />
              </Button>
              <span className="tabular text-sm">
                {t('history.pageOf', { page, pages })}
              </span>
              <Button
                variant="outline"
                size="icon"
                disabled={page >= pages}
                onClick={() => goPage(page + 1)}
                aria-label={t('history.next')}
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

function MailSection({
  title,
  items,
  dim,
}: {
  title?: string;
  items: NotificationItem[];
  dim?: boolean;
}) {
  return (
    <section className="space-y-3">
      {title && (
        <h2 className="font-display text-2xl leading-none font-extrabold tracking-wide uppercase">
          {title}
        </h2>
      )}
      <ul
        className={cn(
          'divide-y divide-rule overflow-hidden surface',
          dim && 'opacity-60',
        )}
      >
        {items.map((n) => (
          <HistoryRow key={n.id} item={n} />
        ))}
      </ul>
    </section>
  );
}

function StatusLabel({ status }: { status: NotificationStatus }) {
  const t = useT();
  const [icon, text] =
    status === 'sent'
      ? [
          <CircleCheck
            key="i"
            className={cn(ICON, 'text-status-enabled')}
            aria-hidden
          />,
          t('history.statusSent'),
        ]
      : status === 'pending'
        ? [
            <Clock
              key="i"
              className={cn(ICON, 'text-status-pending')}
              aria-hidden
            />,
            t('history.statusPending'),
          ]
        : [
            <CircleAlert
              key="i"
              className={cn(ICON, 'text-crimson')}
              aria-hidden
            />,
            t('history.statusFailed'),
          ];
  return (
    <span className="inline-flex items-center gap-1 font-medium">
      {icon}
      {text}
    </span>
  );
}

function RetryButton({
  mutation,
  className,
}: {
  mutation: { isPending: boolean; mutate: () => void };
  className?: string;
}) {
  const t = useT();
  return (
    <Button
      variant="outline"
      size="sm"
      className={className}
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      <RotateCw
        aria-hidden
        className={cn(
          mutation.isPending && 'animate-spin motion-reduce:animate-none',
        )}
      />
      {t(mutation.isPending ? 'history.retrying' : 'history.retry')}
    </Button>
  );
}

function HistoryRow({ item: n }: { item: NotificationItem }) {
  const t = useT();
  const fmt = useFormat();
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: () =>
      unwrap(
        api.api.notifications[':id'].retry.$post({
          param: { id: String(n.id) },
        }),
      ),
    onSuccess: () => toast.success(t('history.retried')),
    onError: (err) => toast.error(t.error(errorCode(err))),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.notifications });
      void qc.invalidateQueries({ queryKey: queryKeys.overview });
    },
  });
  const name = n.displayName ?? n.login ?? n.broadcasterId;
  const failed = n.status === 'failed';
  return (
    <li className="flex gap-3 px-3 py-2.5">
      <BoxArt url={n.boxArtUrl} width={30} height={40} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="font-medium">{name}</span>
          <span className="text-sm">{n.gameName ?? n.categoryId}</span>
        </div>
        {n.title && (
          <p className="line-clamp-2 text-sm break-words text-muted-foreground">
            {n.title}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm">
          <time
            dateTime={n.createdAt}
            className="tabular text-muted-foreground"
          >
            {fmt.dateTime(n.createdAt)}
          </time>
          <StatusLabel status={n.status} />
          {n.owner !== null && (
            <span className="text-muted-foreground">
              {t('history.owner')}: {n.owner}
            </span>
          )}
          {n.status !== 'sent' && n.attempts > 0 && (
            <span className="tabular text-muted-foreground">
              {t.plural('history.attempts', n.attempts)}
            </span>
          )}
          {n.status === 'pending' && n.nextAttemptAt && (
            <span className="tabular text-muted-foreground">
              {t('history.nextAttempt', {
                time: fmt.dateTime(n.nextAttemptAt),
              })}
            </span>
          )}
        </div>
        {n.lastError && n.status !== 'sent' && (
          <p className="flex items-start gap-1.5 text-sm break-words">
            <CircleAlert
              className={cn(ICON, 'mt-0.5 text-crimson')}
              aria-hidden
            />
            <span className="min-w-0">
              <span className="sr-only">{t('history.error')}: </span>
              {n.lastError}
            </span>
          </p>
        )}
        {failed && <RetryButton mutation={retry} className="mt-2 sm:hidden" />}
      </div>
      {failed && (
        <RetryButton
          mutation={retry}
          className="hidden self-start sm:inline-flex"
        />
      )}
    </li>
  );
}
