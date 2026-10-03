import { QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '@/i18n/i18n.tsx';
import {
  createQueryClient,
  queryKeys,
  setPasswordChangeHandler,
  setUnauthorizedHandler,
} from '@/lib/api.ts';
import { applyInitialTheme, ThemeProvider } from '@/lib/theme.tsx';
import { routeTree } from './routeTree.gen.ts';
import './styles.css';

// Before first render: no theme flash (CSP forbids an inline script).
applyInitialTheme();

const queryClient = createQueryClient();
const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

setUnauthorizedHandler(() => {
  queryClient.clear();
  if (router.state.location.pathname !== '/login') {
    void router.navigate({ to: '/login' });
  }
});

setPasswordChangeHandler(() => {
  void queryClient.invalidateQueries({ queryKey: queryKeys.me });
  if (router.state.location.pathname !== '/change-password') {
    void router.navigate({ to: '/change-password' });
  }
});

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
);
