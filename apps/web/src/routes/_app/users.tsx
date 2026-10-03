import type { UserItem } from '@shared/schemas.ts';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import {
  Check,
  CircleAlert,
  Copy,
  KeyRound,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Badge } from '@/components/ui/badge.tsx';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { useFormat, useT } from '@/i18n/i18n.tsx';
import { meQuery } from '@/lib/auth.ts';
import {
  errorCode,
  useCreateUser,
  useDeleteUser,
  usersQuery,
  useUpdateUser,
} from '@/lib/queries.ts';

export const Route = createFileRoute('/_app/users')({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery(meQuery);
    if (me.role !== 'admin') throw redirect({ to: '/' });
  },
  component: UsersPage,
});

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;

function useRoleItems(): { value: UserItem['role']; label: string }[] {
  const t = useT();
  return [
    { value: 'admin', label: t('users.roleAdmin') },
    { value: 'user', label: t('users.roleUser') },
  ];
}

interface Reveal {
  name: string;
  password: string;
}

function UsersPage() {
  const t = useT();
  const list = useQuery(usersQuery);
  const me = useQuery(meQuery);
  const [creating, setCreating] = useState(false);
  const [reveal, setReveal] = useState<Reveal | null>(null);

  return (
    <div className="space-y-8">
      <header className="flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="kicker">{t('users.kicker')}</p>
          <h1 className="page-title">{t('users.title')}</h1>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus aria-hidden />
          {t('users.newUser')}
        </Button>
      </header>

      {list.isError ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{t.error(errorCode(list.error))}</AlertDescription>
        </Alert>
      ) : list.isPending ? (
        <p className="text-muted-foreground">{t('app.loading')}</p>
      ) : list.data.length === 0 ? (
        <p className="empty-state">{t('users.empty')}</p>
      ) : (
        <ul className="space-y-3">
          {list.data.map((u) => (
            <li key={u.id}>
              <UserCard
                user={u}
                own={u.id === me.data?.id}
                onReveal={setReveal}
              />
            </li>
          ))}
        </ul>
      )}

      <CreateDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={setReveal}
      />
      <PasswordDialog reveal={reveal} onClose={() => setReveal(null)} />
    </div>
  );
}

function UserCard({
  user,
  own,
  onReveal,
}: {
  user: UserItem;
  own: boolean;
  onReveal: (r: Reveal) => void;
}) {
  const t = useT();
  const fmt = useFormat();
  const update = useUpdateUser();
  const [resetting, setResetting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const roleId = useId();
  const roleItems = useRoleItems();

  const onError = (err: unknown) => toast.error(t.error(errorCode(err)));

  return (
    <div className="space-y-3 rounded-lg border bg-sheet p-4">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-xl font-bold break-words">
            {user.username}
          </h2>
          {own && <Badge variant="outline">{t('users.you')}</Badge>}
          {user.mustChangePassword && (
            <Badge variant="secondary">{t('users.mustChange')}</Badge>
          )}
        </div>
        <p className="text-sm break-all text-muted-foreground">{user.email}</p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Users className="size-4 shrink-0" aria-hidden />
            {t.plural('users.streamers', user.streamerCount)}
          </span>
          <span>{fmt.date(user.createdAt)}</span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={roleId} className="sr-only">
          {t('users.changeRole')}
        </Label>
        <Select
          items={roleItems}
          value={user.role}
          disabled={own || update.isPending}
          onValueChange={(v) =>
            update.mutate(
              { id: user.id, role: v as UserItem['role'] },
              {
                onSuccess: () =>
                  toast.success(
                    t('users.roleChanged', { name: user.username }),
                  ),
                onError,
              },
            )
          }
        >
          <SelectTrigger id={roleId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {roleItems.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => setResetting(true)}>
          <KeyRound aria-hidden />
          {t('users.resetPassword')}
        </Button>
        {!own && (
          <Button variant="outline" size="sm" onClick={() => setDeleting(true)}>
            <Trash2 aria-hidden />
            {t('users.delete')}
          </Button>
        )}
      </div>
      <ResetDialog
        user={user}
        open={resetting}
        onOpenChange={setResetting}
        onReveal={onReveal}
      />
      {!own && (
        <DeleteDialog user={user} open={deleting} onOpenChange={setDeleting} />
      )}
    </div>
  );
}

function CreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (r: Reveal) => void;
}) {
  const t = useT();
  const roleItems = useRoleItems();
  const uid = useId();
  const create = useCreateUser();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserItem['role']>('user');
  const [error, setError] = useState<string | null>(null);
  const trimmed = username.trim().toLowerCase();

  useEffect(() => {
    if (!open) return;
    setUsername('');
    setEmail('');
    setRole('user');
    setError(null);
  }, [open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed) {
      setError(t('users.usernameRequired'));
      return;
    }
    if (!USERNAME_RE.test(trimmed)) {
      setError(t('users.usernameHint'));
      return;
    }
    setError(null);
    create.mutate(
      { username: trimmed, email: email.trim(), role },
      {
        onSuccess: (res) => {
          if (!res.user || !('temporaryPassword' in res)) {
            setError(t.error('internal'));
            return;
          }
          toast.success(t('users.created', { name: res.user.username }));
          onOpenChange(false);
          onCreated({
            name: res.user.username,
            password: res.temporaryPassword,
          });
        },
        onError: (err) => setError(t.error(errorCode(err))),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              {t('users.newUser')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-name`}>{t('users.username')}</Label>
            <Input
              id={`${uid}-name`}
              value={username}
              maxLength={32}
              autoComplete="off"
              aria-describedby={`${uid}-name-hint`}
              onChange={(e) => setUsername(e.target.value)}
            />
            <p
              id={`${uid}-name-hint`}
              className="text-sm text-muted-foreground"
            >
              {t('users.usernameHint')}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-email`}>{t('users.email')}</Label>
            <Input
              id={`${uid}-email`}
              type="email"
              value={email}
              autoComplete="off"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-role`}>{t('users.role')}</Label>
            <Select
              items={roleItems}
              value={role}
              onValueChange={(v) => setRole(v as UserItem['role'])}
            >
              <SelectTrigger id={`${uid}-role`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {roleItems.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter className="bg-transparent">
            <DialogClose render={<Button type="button" variant="outline" />}>
              {t('users.cancel')}
            </DialogClose>
            <Button type="submit" disabled={create.isPending}>
              {t(create.isPending ? 'users.creating' : 'users.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetDialog({
  user,
  open,
  onOpenChange,
  onReveal,
}: {
  user: UserItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReveal: (r: Reveal) => void;
}) {
  const t = useT();
  const update = useUpdateUser();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {t('users.resetPassword')}
          </DialogTitle>
          <DialogDescription>
            {t('users.resetConfirm', { name: user.username })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="bg-transparent">
          <DialogClose render={<Button variant="outline" />}>
            {t('users.cancel')}
          </DialogClose>
          <Button
            variant="destructive"
            disabled={update.isPending}
            onClick={() =>
              update.mutate(
                { id: user.id, resetPassword: true },
                {
                  onSuccess: (res) => {
                    toast.success(
                      t('users.resetDone', { name: user.username }),
                    );
                    onOpenChange(false);
                    if ('temporaryPassword' in res)
                      onReveal({
                        name: user.username,
                        password: res.temporaryPassword,
                      });
                  },
                  onError: (err) => toast.error(t.error(errorCode(err))),
                },
              )
            }
          >
            {t('users.resetPassword')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  user,
  open,
  onOpenChange,
}: {
  user: UserItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const del = useDeleteUser();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {t('users.delete')}
          </DialogTitle>
          <DialogDescription>
            {t.plural('users.deleteConfirm', user.streamerCount, {
              name: user.username,
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="bg-transparent">
          <DialogClose render={<Button variant="outline" />}>
            {t('users.cancel')}
          </DialogClose>
          <Button
            variant="destructive"
            disabled={del.isPending}
            onClick={() =>
              del.mutate(user.id, {
                onSuccess: () => {
                  toast.success(t('users.deleted', { name: user.username }));
                  onOpenChange(false);
                },
                onError: (err) => toast.error(t.error(errorCode(err))),
              })
            }
          >
            {t('users.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({
  reveal,
  onClose,
}: {
  reveal: Reveal | null;
  onClose: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (reveal) {
      setCopied(false);
      setManual(false);
    }
  }, [reveal]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reveal?.password ?? '');
      setCopied(true);
    } catch {
      inputRef.current?.select();
      setManual(true);
    }
  };

  return (
    // Closes only via its button: the password is shown once.
    <Dialog open={reveal !== null} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {t('users.temporaryPassword')}
          </DialogTitle>
          <DialogDescription>
            {t('users.temporaryPasswordHint', { name: reveal?.name ?? '' })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            readOnly
            value={reveal?.password ?? ''}
            aria-label={t('users.temporaryPassword')}
            className="font-mono"
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button type="button" variant="outline" onClick={() => void copy()}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {t(copied ? 'users.copied' : 'users.copy')}
          </Button>
        </div>
        {manual && (
          <p className="text-sm text-muted-foreground">
            {t('users.copyManual')}
          </p>
        )}
        <DialogFooter className="bg-transparent">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('users.dismiss')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
