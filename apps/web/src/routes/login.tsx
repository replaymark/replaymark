import { loginInput } from '@shared/schemas.ts';
import { useForm } from '@tanstack/react-form';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { FieldError } from '@/components/field-error.tsx';
import { TallyLamp } from '@/components/tally-lamp.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { useT } from '@/i18n/i18n.tsx';
import { ApiClientError, api, unwrap } from '@/lib/api.ts';
import { meQuery, setupQuery } from '@/lib/auth.ts';

export const Route = createFileRoute('/login')({
  beforeLoad: async ({ context }) => {
    const setup = await context.queryClient
      .fetchQuery(setupQuery)
      .catch(() => ({ required: false }));
    if (setup.required) throw redirect({ to: '/setup' });
    const ok = await context.queryClient
      .fetchQuery(meQuery)
      .then(() => true)
      .catch(() => false);
    if (ok) throw redirect({ to: '/' });
  },
  component: LoginPage,
});

function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const { queryClient } = Route.useRouteContext();
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { username: '', password: '' },
    validators: { onSubmit: loginInput },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        await unwrap(api.api.auth.login.$post({ json: value }));
        queryClient.clear();
        await navigate({ to: '/' });
      } catch (err) {
        setError(
          t.error(err instanceof ApiClientError ? err.code : 'internal'),
        );
      }
    },
  });

  return (
    <main className="grid min-h-dvh place-items-center bg-[radial-gradient(ellipse_at_top,var(--sheet),var(--paper)_60%)] p-4">
      <form
        className="w-full max-w-sm overflow-hidden rounded-xl border bg-card shadow-lg"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div className="flex items-center gap-2.5 bg-band px-6 py-4 text-band-ink">
          <TallyLamp live={false} />
          <span className="font-display text-3xl leading-none font-extrabold tracking-wide uppercase">
            {t('app.name')}
          </span>
        </div>
        <div className="space-y-5 p-6">
          <h1 className="font-display text-xl font-bold">{t('login.title')}</h1>
          <form.Field name="username">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>{t('login.username')}</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  autoComplete="username"
                  autoFocus
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={
                    field.state.meta.errors.length > 0 || error !== null
                  }
                />
                {field.state.meta.errors.length > 0 && (
                  <FieldError errors={[t('login.usernameRequired')]} />
                )}
              </div>
            )}
          </form.Field>
          <form.Field name="password">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>{t('login.password')}</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  type="password"
                  autoComplete="current-password"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={
                    field.state.meta.errors.length > 0 || error !== null
                  }
                />
                {field.state.meta.errors.length > 0 && (
                  <FieldError errors={[t('login.required')]} />
                )}
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
                {submitting ? t('login.submitting') : t('login.submit')}
              </Button>
            )}
          </form.Subscribe>
        </div>
      </form>
    </main>
  );
}
