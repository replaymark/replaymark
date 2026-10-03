import { useForm } from '@tanstack/react-form';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { AuthCard } from '@/components/auth-card.tsx';
import { FieldError } from '@/components/field-error.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { useT } from '@/i18n/i18n.tsx';
import { ApiClientError } from '@/lib/api.ts';
import { setupQuery, submitSetup } from '@/lib/auth.ts';

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;

export const Route = createFileRoute('/setup')({
  beforeLoad: async ({ context }) => {
    const { required } = await context.queryClient.fetchQuery(setupQuery);
    if (!required) throw redirect({ to: '/login' });
  },
  component: SetupPage,
});

function SetupPage() {
  const t = useT();
  const navigate = useNavigate();
  const { queryClient } = Route.useRouteContext();
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      code: '',
      username: '',
      email: '',
      password: '',
      repeat: '',
    },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        await submitSetup({
          code: value.code.trim(),
          username: value.username.trim().toLowerCase(),
          email: value.email.trim(),
          password: value.password,
        });
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
    <AuthCard
      title={t('setup.title')}
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <p className="text-sm text-muted-foreground">{t('setup.intro')}</p>
      <form.Field
        name="code"
        validators={{
          onSubmit: ({ value }) =>
            value.trim() ? undefined : t('setup.codeRequired'),
        }}
      >
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>{t('setup.code')}</Label>
            <Input
              id={field.name}
              name={field.name}
              autoComplete="one-time-code"
              autoFocus
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              aria-invalid={field.state.meta.errors.length > 0}
            />
            <p className="text-xs text-muted-foreground">
              {t('setup.codeHint')}
            </p>
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field
        name="username"
        validators={{
          onSubmit: ({ value }) =>
            USERNAME_RE.test(value.trim().toLowerCase())
              ? undefined
              : t('setup.usernameRequired'),
        }}
      >
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>{t('setup.username')}</Label>
            <Input
              id={field.name}
              name={field.name}
              autoComplete="username"
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
        name="email"
        validators={{
          onSubmit: ({ value }) =>
            EMAIL_RE.test(value.trim()) ? undefined : t('setup.emailInvalid'),
        }}
      >
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>{t('setup.email')}</Label>
            <Input
              id={field.name}
              name={field.name}
              type="email"
              autoComplete="email"
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
        name="password"
        validators={{
          onSubmit: ({ value }) =>
            value.length >= MIN_PASSWORD && value.length <= MAX_PASSWORD
              ? undefined
              : t('setup.passwordShort', { min: MIN_PASSWORD }),
        }}
      >
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>{t('setup.password')}</Label>
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
            value === fieldApi.form.getFieldValue('password')
              ? undefined
              : t('setup.mismatch'),
        }}
      >
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>{t('setup.repeat')}</Label>
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
            {submitting ? t('setup.submitting') : t('setup.submit')}
          </Button>
        )}
      </form.Subscribe>
    </AuthCard>
  );
}
