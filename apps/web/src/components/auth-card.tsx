import type { FormEvent, ReactNode } from 'react';
import { TallyLamp } from '@/components/tally-lamp.tsx';
import { useT } from '@/i18n/i18n.tsx';

/** Centred card with the brand band, shared by the pre-session pages. */
export function AuthCard({
  title,
  onSubmit,
  children,
}: {
  title: string;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <main className="grid min-h-dvh place-items-center bg-[radial-gradient(ellipse_at_top,var(--sheet),var(--paper)_60%)] p-4">
      <form
        className="w-full max-w-sm overflow-hidden rounded-xl border bg-card shadow-lg"
        noValidate
        onSubmit={onSubmit}
      >
        <div className="flex items-center gap-2.5 bg-band px-6 py-4 text-band-ink">
          <TallyLamp live={false} />
          <span className="font-display text-3xl leading-none font-extrabold tracking-wide uppercase">
            {t('app.name')}
          </span>
        </div>
        <div className="space-y-5 p-6">
          <h1 className="font-display text-xl font-bold">{title}</h1>
          {children}
        </div>
      </form>
    </main>
  );
}
