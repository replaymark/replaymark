import type { GameGroup } from '@shared/schemas.ts';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { CircleAlert, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { CategoryPicker } from '@/components/category-picker.tsx';
import { FieldError } from '@/components/field-error.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { useT } from '@/i18n/i18n.tsx';
import {
  errorCode,
  gameGroupsQuery,
  useCreateGameGroup,
  useDeleteGameGroup,
  usePatchGameGroup,
} from '@/lib/queries.ts';

export const Route = createFileRoute('/_app/games')({
  component: GamesPage,
});

function GamesPage() {
  const t = useT();
  const groups = useQuery(gameGroupsQuery);
  const [creating, setCreating] = useState(false);
  const sorted = [...(groups.data ?? [])].sort(
    (a, b) =>
      Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name),
  );
  const onlyDefault = sorted.length > 0 && sorted.every((g) => g.isDefault);

  return (
    <div className="space-y-8">
      <header className="flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="kicker">{t('games.kicker')}</p>
          <h1 className="page-title">{t('games.title')}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            {t('games.intro')}
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus aria-hidden />
          {t('games.newGroup')}
        </Button>
      </header>

      {groups.isError ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>
            {t.error(errorCode(groups.error))}
          </AlertDescription>
        </Alert>
      ) : groups.isPending ? (
        <p className="text-muted-foreground">{t('app.loading')}</p>
      ) : (
        <>
          <div className="space-y-6">
            {sorted.map((g) => (
              <GroupSection key={g.id} group={g} />
            ))}
          </div>
          {onlyDefault && <p className="empty-state">{t('games.empty')}</p>}
        </>
      )}

      <NameDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function GroupSection({ group }: { group: GameGroup }) {
  const t = useT();
  const patch = usePatchGameGroup();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const name = group.isDefault ? t('games.defaultLabel') : group.name;
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-3 rounded-lg border bg-sheet p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h2
            id={headingId}
            className="font-display text-xl font-bold break-words"
          >
            {name}
          </h2>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Users className="size-4 shrink-0" aria-hidden />
            {t.plural('games.streamerCount', group.streamerCount)}
          </p>
        </div>
        {!group.isDefault && (
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              aria-label={t('games.renameLabel', { name })}
              onClick={() => setRenaming(true)}
            >
              <Pencil aria-hidden />
              {t('games.rename')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label={t('games.deleteLabel', { name })}
              onClick={() => setDeleting(true)}
            >
              <Trash2 aria-hidden />
              {t('games.delete')}
            </Button>
          </div>
        )}
      </div>
      {group.isDefault && (
        <p className="text-sm text-muted-foreground">
          {t('games.defaultHint')}
        </p>
      )}
      <div className="space-y-1.5">
        <Label>{t('games.addGame')}</Label>
        <CategoryPicker
          value={group.games}
          placeholder={t('games.noGames')}
          onChange={(next) =>
            patch.mutate(
              {
                id: group.id,
                json: { categoryIds: next.map((c) => c.id) },
                games: next,
              },
              {
                onSuccess: () => toast.success(t('games.gamesUpdated')),
                onError: (err) => toast.error(t.error(errorCode(err))),
              },
            )
          }
        />
      </div>
      {!group.isDefault && (
        <>
          <NameDialog
            group={group}
            open={renaming}
            onOpenChange={setRenaming}
          />
          <DeleteGroupDialog
            group={group}
            open={deleting}
            onOpenChange={setDeleting}
          />
        </>
      )}
    </section>
  );
}

function NameDialog({
  group,
  open,
  onOpenChange,
}: {
  group?: GameGroup;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const uid = useId();
  const create = useCreateGameGroup();
  const patch = usePatchGameGroup();
  const [name, setName] = useState(group?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const pending = create.isPending || patch.isPending;
  const trimmed = name.trim();

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? '');
    setError(null);
  }, [open, group?.name]);

  const handlers = {
    onSuccess: () => {
      toast.success(
        group ? t('games.renamed') : t('games.created', { name: trimmed }),
      );
      setName(group?.name ?? '');
      setError(null);
      onOpenChange(false);
    },
    onError: (err: unknown) => setError(t.error(errorCode(err))),
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed) return;
    setError(null);
    if (group)
      patch.mutate({ id: group.id, json: { name: trimmed } }, handlers);
    else create.mutate({ name: trimmed, categoryIds: [] }, handlers);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              {group
                ? t('games.renameLabel', { name: group.name })
                : t('games.newGroup')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-name`}>{t('games.newGroupName')}</Label>
            <Input
              id={`${uid}-name`}
              value={name}
              maxLength={60}
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${uid}-err` : undefined}
              onChange={(e) => setName(e.target.value)}
            />
            {error && <FieldError errors={[error]} id={`${uid}-err`} />}
          </div>
          <DialogFooter className="bg-transparent">
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t('games.cancel')}
            </DialogClose>
            <Button type="submit" disabled={pending || !trimmed}>
              {group
                ? t('games.save')
                : t(create.isPending ? 'games.creating' : 'games.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteGroupDialog({
  group,
  open,
  onOpenChange,
}: {
  group: GameGroup;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const del = useDeleteGameGroup();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {t('games.deleteTitle', { name: group.name })}
          </DialogTitle>
          <DialogDescription>
            {group.streamerCount > 0
              ? t.plural('games.deleteConfirm', group.streamerCount)
              : t('games.deleteUnused')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="bg-transparent">
          <DialogClose render={<Button variant="outline" />}>
            {t('games.cancel')}
          </DialogClose>
          <Button
            variant="destructive"
            disabled={del.isPending}
            onClick={() =>
              del.mutate(group.id, {
                onSuccess: () => {
                  toast.success(t('games.deleted', { name: group.name }));
                  onOpenChange(false);
                },
                onError: (err) => toast.error(t.error(errorCode(err))),
              })
            }
          >
            {t('games.deleteAction')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
