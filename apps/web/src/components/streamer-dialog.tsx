import {
  addStreamerInput,
  type Category,
  type GameMode,
  type Streamer,
} from '@shared/schemas.ts';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { CategoryPicker } from '@/components/category-picker.tsx';
import { FieldError } from '@/components/field-error.tsx';
import { StreamerAvatar } from '@/components/streamer-avatar.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group.tsx';
import { Switch } from '@/components/ui/switch.tsx';
import { useT } from '@/i18n/i18n.tsx';
import { api, queryKeys, unwrap } from '@/lib/api.ts';
import {
  errorCode,
  gameGroupsQuery,
  lookupQuery,
  patchStreamer,
} from '@/lib/queries.ts';
import { useDebounced } from '@/lib/use-debounced.ts';

const LOOKUP_DEBOUNCE_MS = 400;
const MODES = ['default', 'custom', 'any'] as const satisfies GameMode[];
const MODE_KEYS = {
  default: ['streamer.modeDefault', 'streamer.modeDefaultHint'],
  custom: ['streamer.modeCustom', 'streamer.modeCustomHint'],
  any: ['streamer.modeAny', 'streamer.modeAnyHint'],
} as const;

interface Values {
  login: string;
  gameMode: GameMode;
  categories: Category[];
  groupIds: number[];
  enabled: boolean;
}

/** Add (streamer = null) or edit dialog. */
export function StreamerDialog({
  open,
  onOpenChange,
  streamer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  streamer: Streamer | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {open && (
          <StreamerForm
            key={streamer?.id ?? 'new'}
            streamer={streamer}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function GroupPicker({
  value,
  onChange,
}: {
  value: number[];
  onChange: (next: number[]) => void;
}) {
  const t = useT();
  const query = useQuery(gameGroupsQuery);
  const groups = (query.data ?? []).filter((g) => !g.isDefault);
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">{t('streamer.groups')}</legend>
      {query.isPending ? (
        <p className="text-sm text-muted-foreground">{t('app.loading')}</p>
      ) : query.isError ? (
        <FieldError errors={[t.error(errorCode(query.error))]} />
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('streamer.groupsNone')}
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t('streamer.groupsHint')}
          </p>
          {groups.map((g) => {
            const checked = value.includes(g.id);
            return (
              <Label
                key={g.id}
                className="flex items-start gap-2.5 font-normal"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={checked}
                  onCheckedChange={() =>
                    onChange(
                      checked
                        ? value.filter((id) => id !== g.id)
                        : [...value, g.id],
                    )
                  }
                />
                <span className="min-w-0 break-words font-medium">
                  {g.name}
                </span>
                <span className="shrink-0 text-sm text-muted-foreground">
                  {t.plural('streamer.groupGames', g.games.length)}
                </span>
              </Label>
            );
          })}
        </>
      )}
    </fieldset>
  );
}

function StreamerForm({
  streamer,
  onDone,
}: {
  streamer: Streamer | null;
  onDone: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const uid = useId();
  const isEdit = streamer !== null;
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.streamers });
    void qc.invalidateQueries({ queryKey: queryKeys.overview });
    void qc.invalidateQueries({ queryKey: queryKeys.gameGroups });
  };

  const save = useMutation({
    mutationFn: async (v: Values) => {
      const patch = {
        gameMode: v.gameMode,
        enabled: v.enabled,
        ...(v.gameMode === 'custom'
          ? {
              categoryIds: v.categories.map((c) => c.id),
              groupIds: v.groupIds,
            }
          : {}),
      };
      if (streamer) return patchStreamer(streamer.id, patch);
      const created = await unwrap(
        api.api.streamers.$post({ json: { login: v.login } }),
      );
      const changed =
        v.gameMode !== created.gameMode ||
        v.enabled !== created.enabled ||
        v.gameMode === 'custom';
      return changed ? patchStreamer(created.id, patch) : created;
    },
    onSuccess: () => {
      toast.success(t(isEdit ? 'streamer.saved' : 'streamer.added'));
      refresh();
      onDone();
    },
    onError: (err) => toast.error(t.error(errorCode(err))),
  });

  const form = useForm({
    defaultValues: {
      login: streamer?.login ?? '',
      gameMode: streamer?.gameMode ?? 'default',
      categories: streamer?.categories ?? [],
      groupIds: streamer?.groups.map((g) => g.id) ?? [],
      enabled: streamer?.enabled ?? true,
    } as Values,
    onSubmit: async ({ value }) => {
      await save.mutateAsync(value).catch(() => {});
    },
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-display text-2xl font-bold">
          {t(isEdit ? 'streamer.editTitle' : 'streamer.addTitle')}
        </DialogTitle>
      </DialogHeader>
      <form
        noValidate
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        {isEdit ? (
          <div className="flex items-center gap-3">
            <StreamerAvatar
              url={streamer.avatarUrl}
              name={streamer.displayName}
              size={40}
            />
            <div className="min-w-0">
              <p className="truncate font-medium">{streamer.displayName}</p>
              <p className="truncate text-sm text-muted-foreground">
                twitch.tv/{streamer.login}
              </p>
            </div>
          </div>
        ) : (
          <form.Field
            name="login"
            validators={{
              onSubmit: ({ value }) =>
                addStreamerInput.shape.login.safeParse(value).success
                  ? undefined
                  : t('streamer.loginInvalid'),
            }}
          >
            {(field) => (
              <div className="grid gap-1.5">
                <Label htmlFor={`${uid}-login`}>{t('streamer.login')}</Label>
                <Input
                  id={`${uid}-login`}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  aria-invalid={field.state.meta.errors.length > 0 || undefined}
                  aria-describedby={`${uid}-login-hint`}
                />
                <p
                  id={`${uid}-login-hint`}
                  className="text-sm text-muted-foreground"
                >
                  {t('streamer.loginHint')}
                </p>
                <FieldError errors={field.state.meta.errors} />
                <LookupPreview login={field.state.value} />
              </div>
            )}
          </form.Field>
        )}

        <form.Field name="gameMode">
          {(field) => (
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">
                {t('streamer.mode')}
              </legend>
              <RadioGroup
                value={field.state.value}
                onValueChange={(v) => field.handleChange(v as GameMode)}
                className="gap-3"
              >
                {MODES.map((m) => (
                  <Label
                    key={m}
                    className="flex items-start gap-2.5 font-normal"
                  >
                    <RadioGroupItem value={m} className="mt-0.5" />
                    <span className="grid gap-0.5">
                      <span className="font-medium">{t(MODE_KEYS[m][0])}</span>
                      <span className="text-sm text-muted-foreground">
                        {t(MODE_KEYS[m][1])}
                      </span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
            </fieldset>
          )}
        </form.Field>

        <form.Subscribe selector={(s) => s.values.gameMode}>
          {(mode) =>
            mode === 'custom' && (
              <form.Field
                name="categories"
                validators={{
                  onSubmit: ({ value, fieldApi }) =>
                    fieldApi.form.getFieldValue('gameMode') === 'custom' &&
                    value.length === 0 &&
                    fieldApi.form.getFieldValue('groupIds').length === 0
                      ? t('streamer.gamesRequired')
                      : undefined,
                }}
              >
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label htmlFor={`${uid}-games`}>
                      {t('streamer.games')}
                    </Label>
                    <CategoryPicker
                      id={`${uid}-games`}
                      value={field.state.value}
                      onChange={field.handleChange}
                      invalid={field.state.meta.errors.length > 0}
                    />
                    <FieldError errors={field.state.meta.errors} />
                  </div>
                )}
              </form.Field>
            )
          }
        </form.Subscribe>

        <form.Subscribe selector={(s) => s.values.gameMode}>
          {(mode) =>
            mode === 'custom' && (
              <form.Field name="groupIds">
                {(field) => (
                  <GroupPicker
                    value={field.state.value}
                    onChange={field.handleChange}
                  />
                )}
              </form.Field>
            )
          }
        </form.Subscribe>

        <form.Field name="enabled">
          {(field) => (
            <div className="flex items-start justify-between gap-4">
              <div className="grid gap-0.5">
                <Label htmlFor={`${uid}-enabled`}>{t('streamer.active')}</Label>
                <p className="text-sm text-muted-foreground">
                  {t('streamer.activeHint')}
                </p>
              </div>
              <Switch
                id={`${uid}-enabled`}
                checked={field.state.value}
                onCheckedChange={(v) => field.handleChange(v)}
              />
            </div>
          )}
        </form.Field>

        <DialogFooter className="bg-transparent sm:justify-between">
          {isEdit ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 aria-hidden />
              {t('streamer.delete')}
            </Button>
          ) : (
            <span className="hidden sm:block" />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t('streamer.cancel')}
            </DialogClose>
            <form.Subscribe selector={(s) => s.values.login}>
              {(login) => (
                <SubmitButton
                  isEdit={isEdit}
                  busy={save.isPending}
                  login={login}
                />
              )}
            </form.Subscribe>
          </div>
        </DialogFooter>
      </form>
      {streamer && (
        <DeleteDialog
          streamer={streamer}
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          onDeleted={() => {
            refresh();
            onDone();
          }}
        />
      )}
    </>
  );
}

function SubmitButton({
  isEdit,
  busy,
  login,
}: {
  isEdit: boolean;
  busy: boolean;
  login: string;
}) {
  const t = useT();
  const debounced = useDebounced(
    login.trim().toLowerCase(),
    LOOKUP_DEBOUNCE_MS,
  );
  const valid = addStreamerInput.shape.login.safeParse(debounced).success;
  const lookup = useQuery({
    ...lookupQuery(debounced),
    enabled: !isEdit && valid,
  });
  // A preview must be shown before a new streamer can be saved.
  const ready =
    isEdit || (lookup.isSuccess && debounced === login.trim().toLowerCase());
  const label = isEdit
    ? t(busy ? 'streamer.saving' : 'streamer.save')
    : t(busy ? 'streamer.adding' : 'streamer.add');
  return (
    <Button type="submit" disabled={busy || !ready}>
      {label}
    </Button>
  );
}

function LookupPreview({ login }: { login: string }) {
  const t = useT();
  const norm = login.trim().toLowerCase();
  const debounced = useDebounced(norm, LOOKUP_DEBOUNCE_MS);
  const valid = addStreamerInput.shape.login.safeParse(debounced).success;
  const lookup = useQuery({ ...lookupQuery(debounced), enabled: valid });
  if (!norm || !valid) return null;
  const waiting = norm !== debounced || lookup.isFetching;
  return (
    <div
      aria-live="polite"
      className="mt-1 flex min-h-14 items-center gap-3 rounded-md border bg-sheet p-2"
    >
      {waiting ? (
        <p className="text-sm text-muted-foreground">
          {t('streamer.lookingUp')}
        </p>
      ) : lookup.isError ? (
        <FieldError errors={[t.error(errorCode(lookup.error))]} />
      ) : lookup.data ? (
        <>
          <StreamerAvatar
            url={lookup.data.avatarUrl}
            name={lookup.data.displayName}
            size={40}
          />
          <div className="min-w-0">
            <p className="truncate font-medium">{lookup.data.displayName}</p>
            {lookup.data.alreadyAdded && (
              <p className="text-sm text-muted-foreground">
                {t('streamer.alreadyAdded')}
              </p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function DeleteDialog({
  streamer,
  open,
  onOpenChange,
  onDeleted,
}: {
  streamer: Streamer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const del = useMutation({
    mutationFn: () =>
      unwrap(api.api.streamers[':id'].$delete({ param: { id: streamer.id } })),
    onSuccess: () => {
      toast.success(t('streamer.deleted'));
      onOpenChange(false);
      onDeleted();
    },
    onError: (err) => toast.error(t.error(errorCode(err))),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {t('streamer.deleteTitle', { name: streamer.displayName })}
          </DialogTitle>
          <DialogDescription>{t('streamer.deleteBody')}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="bg-transparent">
          <DialogClose render={<Button variant="outline" />}>
            {t('streamer.cancel')}
          </DialogClose>
          <Button
            variant="destructive"
            disabled={del.isPending}
            onClick={() => del.mutate()}
          >
            {t(del.isPending ? 'streamer.deleting' : 'streamer.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
