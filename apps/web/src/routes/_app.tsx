import { createFileRoute, redirect } from '@tanstack/react-router';
import { AppShell } from '@/components/app-shell.tsx';
import { meQuery, setupQuery } from '@/lib/auth.ts';

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context }) => {
    let me: Awaited<ReturnType<typeof meQuery.queryFn>>;
    try {
      me = await context.queryClient.ensureQueryData(meQuery);
    } catch {
      // No session: only now is the setup state relevant.
      const setup = await context.queryClient
        .fetchQuery(setupQuery)
        .catch(() => ({ required: false }));
      throw redirect({ to: setup.required ? '/setup' : '/login' });
    }
    if (me.mustChangePassword) throw redirect({ to: '/change-password' });
  },
  component: AppShell,
});
