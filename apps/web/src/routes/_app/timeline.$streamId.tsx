import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronLeft, CircleAlert, ExternalLink } from 'lucide-react';
import {
  SegmentRow,
  SegmentStrip,
  StreamHead,
  StripAxis,
  StripLegend,
  useNow,
  VodState,
} from '@/components/timeline.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { useFormat, useT } from '@/i18n/i18n.tsx';
import { errorCode, streamDetailQuery } from '@/lib/queries.ts';
import { parseTimelineSearch } from '@/lib/timeline.ts';

export const Route = createFileRoute('/_app/timeline/$streamId')({
  validateSearch: parseTimelineSearch,
  component: StreamDetailPage,
});

function StreamDetailPage() {
  const t = useT();
  const f = useFormat();
  const { streamId } = Route.useParams();
  const search = Route.useSearch();
  const q = useQuery(streamDetailQuery(streamId));
  const now = useNow(q.data?.live ?? false);
  const b = q.data?.broadcaster;
  const streamer = b?.displayName ?? b?.login ?? t('timeline.unknownStreamer');

  return (
    <div className="space-y-8">
      <Link
        to="/timeline"
        search={search}
        className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {t('timeline.back')}
      </Link>

      <header>
        {q.data && <p className="kicker">{streamer}</p>}
        <h1 className="page-title">
          {q.data
            ? t('timeline.detailTitle', { date: f.date(q.data.startedAt) })
            : t('timeline.title')}
        </h1>
      </header>

      {q.isError ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{t.error(errorCode(q.error))}</AlertDescription>
        </Alert>
      ) : q.isPending ? (
        <p className="text-muted-foreground">{t('app.loading')}</p>
      ) : (
        <article className="space-y-4 surface p-4">
          <StreamHead stream={q.data} now={now} />
          <div className="space-y-1">
            <SegmentStrip
              segments={q.data.segments}
              now={now}
              highlightId={search.categoryId}
              inkAll={!search.categoryId}
              labels
              markers
            />
            <StripAxis
              startedAt={q.data.startedAt}
              endedAt={q.data.endedAt}
              now={now}
            />
          </div>
          <StripLegend
            segments={q.data.segments}
            now={now}
            highlightId={search.categoryId}
          />
          <ul className="divide-y divide-rule border-t">
            {q.data.segments.map((seg, i) => (
              <SegmentRow
                // biome-ignore lint/suspicious/noArrayIndexKey: startedAt can repeat; the list is static and ordered
                key={`${seg.startedAt}-${i}`}
                segment={seg}
                now={now}
                name={seg.categoryName}
                showGame
                highlighted={seg.categoryId === search.categoryId}
              />
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t pt-3">
            <VodState state={q.data.vodState} />
            {q.data.vodUrl && (
              <a
                href={q.data.vodUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 rounded-sm text-sm font-medium underline-offset-4 hover:underline"
              >
                {t('timeline.openVod')}
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
          </div>
        </article>
      )}
    </div>
  );
}
