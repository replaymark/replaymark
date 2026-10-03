import type { ReactNode } from 'react';
import { TooltipProvider } from '../../../apps/web/src/components/ui/tooltip.tsx';
import { I18nProvider } from '../../../apps/web/src/i18n/i18n.tsx';
import { ThemeProvider } from '../../../apps/web/src/lib/theme.tsx';

/**
 * Root wrapper: theme (light/dark via `.dark` on <html>), i18n (de/en,
 * detected from the browser) and tooltips. Mirrors the app's own root in
 * `apps/web/src/main.tsx` + `routes/__root.tsx`, minus router and queries.
 */
export function ReplaymarkProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
