import type { Streamer } from '@shared/schemas.ts';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { StreamerAvatar } from '@/components/streamer-avatar.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Switch } from '@/components/ui/switch.tsx';
import type { PluralKey } from '@/i18n/core.ts';
import { useFormat, useT } from '@/i18n/i18n.tsx';
import {
  errorCode,
  gameGroupsQuery,
  useToggleStreamer,
} from '@/lib/queries.ts';
import {
  gameList,
  modeLabel,
  rowStatus,
  subscriptionIssue,
} from '@/lib/streamers.ts';
import { cn } from '@/lib/utils.ts';

const SUB_ISSUE_KEY = {
  error: 'overview.subIssueError',
  missing: 'overview.subIssueMissing',
  pending: 'overview.subIssuePending',
} as const satisfies Record<'error' | 'missing' | 'pending', PluralKey>;

export function RosterRow({
  streamer: s,
  onOpen,
}: {
  streamer: Streamer;
  onOpen: () => void;
}) {
  const t = useT();
  const fmt = useFormat();
  const toggle = useToggleStreamer();
  const groups = useQuery(gameGroupsQuery).data ?? [];
  const status = rowStatus(s);
  const issue = subscriptionIssue(s);
  const baseStatus =
    status.key === 'live'
      ? t('overview.rowLive', { time: fmt.time(status.since) })
      : status.key === 'lastLive'
        ? t('overview.rowLastLive', { when: fmt.dateTime(status.at) })
        : status.key === 'paused'
          ? t('overview.rowPaused')
          : t('overview.rowNever');
  const statusText =
    status.key === 'live' && s.currentCategory
      ? `${baseStatus} · ${s.currentCategory.name}`
      : baseStatus;
  const mode = modeLabel(s);
  const games = gameList(s, groups);
  const modeName =
    mode.key === 'custom'
      ? t.plural('overview.modeCustom', games.length)
      : t(mode.key === 'any' ? 'overview.modeAny' : 'overview.modeDefault');
  const groupNames = mode.key === 'custom' ? mode.groups : [];
  const modeText = [modeName, groupNames.join(', '), games.join(', ')]
    .filter((x) => x !== '')
    .join(' · ');
  return (
    <li className="relative flex items-center gap-3 px-3 py-2 transition-colors duration-150 hover:bg-paper/60">
      <span className="relative shrink-0">
        <StreamerAvatar url={s.avatarUrl} name={s.displayName} size={40} />
        {s.live && (
          <span
            aria-hidden
            className="absolute right-0 bottom-0 size-3 rounded-full border-2 border-card bg-live"
          />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <Button
          type="button"
          variant="ghost"
          onClick={onOpen}
          tabIndex={-1}
          aria-label={t('overview.edit', { name: s.displayName })}
          className="block h-auto max-w-full justify-start truncate rounded-none border-0 p-0 text-left font-medium hover:bg-transparent focus-visible:ring-0 after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring dark:hover:bg-transparent"
        >
          {s.displayName}
        </Button>
        <p className="break-words text-sm text-muted-foreground">
          {statusText}
        </p>
        {status.key !== 'paused' && (
          <p className="break-words text-sm text-muted-foreground">
            {modeText}
          </p>
        )}
        {issue && (
          <p
            className={cn(
              'flex items-start gap-1.5 break-words text-sm',
              issue.state === 'error'
                ? 'font-medium text-crimson'
                : 'text-muted-foreground',
            )}
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t.plural(SUB_ISSUE_KEY[issue.state], issue.count)}
          </p>
        )}
      </div>
      <div className="relative z-10 flex shrink-0 items-center gap-1">
        <Switch
          checked={s.enabled}
          aria-label={t('overview.activeSwitch', { name: s.displayName })}
          onCheckedChange={(enabled) =>
            toggle.mutate(
              { id: s.id, enabled },
              {
                onSuccess: () =>
                  toast.success(
                    t(enabled ? 'overview.activated' : 'overview.pausedToast', {
                      name: s.displayName,
                    }),
                  ),
                onError: (err) => toast.error(t.error(errorCode(err))),
              },
            )
          }
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('overview.edit', { name: s.displayName })}
          onClick={onOpen}
        >
          <Pencil aria-hidden />
        </Button>
      </div>
    </li>
  );
}
