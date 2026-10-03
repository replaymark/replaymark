import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/subscriptions')({
  beforeLoad: () => {
    throw redirect({ to: '/settings', hash: 'sync', replace: true });
  },
});
