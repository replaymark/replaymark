import { useForm } from '@tanstack/react-form';
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { AuthCard } from '@/components/auth-card.tsx';
import { FieldError } from '@/components/field-error.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { useT } from '@/i18n/i18n.tsx';
import { ApiClientError, api, queryKeys, unwrap } from '@/lib/api.ts';
import { changePassword, meQuery } from '@/lib/auth.ts';

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;

export const Route = createFileRoute('/change-password')({
  beforeLoad: async ({ context }) => {
    try {
      const me = await context.queryClient.fetchQuery(meQuery);
      return { forced: me.mustChangePassword };
    } catch {
      throw redirect({ to: '/login' });
    }
  },
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  const t = useT();
  const navigate = useNavigate();
  const { queryClient, forced } = Route.useRouteContext();
  const [error, setError] = useState<string | null>(null);

  const logout = async () => {
    try {
      await unwrap(api.api.auth.logout.$post());
    } finally {
      queryClient.clear();
      await navigate({ to: '/login' });
    }
  };

  const form = useForm({
    defaultValues: { current: '', next: '', repeat: '' },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        await changePassword({
          currentPassword: value.current,
          newPassword: value.next,
        });
        // Drop the cached session so the guards see the cleared flag.
        queryClient.removeQueries({ queryKey: queryKeys.me });
        await navigate({ to: '/' });
      } catch (err) {
        const code = err instanceof ApiClientError ? err.code : 'internal';
        setError(
          code === 'invalid_password'
            ? t('changePassword.currentWrong')
            : t.error(code),
        );
      }
    },
  });

  return (
    <AuthCard
      title={t('changePassword.title')}
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <p className="text-sm text-muted-foreground">
        {forced ? t('changePassword.introForced') : t('changePassword.intro')}
      </p>
      <form.Field
        name="current"
        validators={{
          onSubmit: ({ value }) =>
            value ? undefined : t('changePassword.currentRequired'),
        }}
      >
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>{t('changePassword.current')}</Label>
            <Input
              id={field.name}
              name={field.name}
              type="password"
              autoComplete="current-password"
              autoFocus
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              aria-invalid={field.state.meta.errors.length > 0}
            />
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field
        name="next"
        validators={{
          onSubmit: ({ value }) =>
            value.length >= MIN_PASSWORD && value.length <= MAX_PASSWORD
              ? undefined
              : t('changePassword.newShort', { min: MIN_PASSWORD }),
        }}
      >
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>{t('changePassword.new')}</Label>
            <Input
              id={field.name}
              name={field.name}
              type="password"
              autoComplete="new-password"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              aria-invalid={field.state.meta.errors.length > 0}
            />
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field
        name="repeat"
        validators={{
          onSubmit: ({ value, fieldApi }) =>
            value === fieldApi.form.getFieldValue('next')
              ? undefined
              : t('changePassword.mismatch'),
        }}
      >
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>{t('changePassword.repeat')}</Label>
            <Input
              id={field.name}
              name={field.name}
              type="password"
              autoComplete="new-password"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              aria-invalid={field.state.meta.errors.length > 0}
            />
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      {error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <form.Subscribe selector={(s) => s.isSubmitting}>
        {(submitting) => (
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting
              ? t('changePassword.submitting')
              : t('changePassword.submit')}
          </Button>
        )}
      </form.Subscribe>
      {forced ? (
        <Button
          type="button"
          variant="link"
          className="h-auto w-full p-0 text-sm text-muted-foreground"
          onClick={() => void logout()}
        >
          {t('shell.logout')}
        </Button>
      ) : (
        <Link
          to="/settings"
          className="block text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {t('nav.settings')}
        </Link>
      )}
    </AuthCard>
  );
}
