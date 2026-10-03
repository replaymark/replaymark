import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import {
  ChartNoAxesGantt,
  Gamepad2,
  History,
  LayoutList,
  LogOut,
  Monitor,
  Moon,
  Settings,
  Sun,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { TallyLamp } from '@/components/tally-lamp.tsx';
import { Button } from '@/components/ui/button.tsx';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group.tsx';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip.tsx';
import type { MessageKey } from '@/i18n/core.ts';
import { useLang, useT } from '@/i18n/i18n.tsx';
import { api, unwrap } from '@/lib/api.ts';
import { meQuery } from '@/lib/auth.ts';
import { useServerEvents } from '@/lib/sse.ts';
import { type ThemeChoice, useTheme } from '@/lib/theme.tsx';
import { cn } from '@/lib/utils.ts';

const NAV = [
  { to: '/', label: 'nav.overview', icon: LayoutList },
  { to: '/games', label: 'nav.games', icon: Gamepad2 },
  { to: '/timeline', label: 'nav.timeline', icon: ChartNoAxesGantt },
  { to: '/history', label: 'nav.history', icon: History },
  {
    to: '/settings',
    label: 'nav.settings',
    short: 'nav.settingsShort',
    icon: Settings,
  },
] as const satisfies readonly {
  to: string;
  label: MessageKey;
  short?: MessageKey;
  icon: unknown;
}[];

const USERS_NAV = {
  to: '/users',
  label: 'nav.users',
  icon: Users,
} as const satisfies { to: string; label: MessageKey; icon: unknown };

const THEME_NEXT: Record<ThemeChoice, ThemeChoice> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};

function LangSwitch() {
  const { lang, setLang } = useLang();
  const t = useT();
  return (
    <ToggleGroup
      aria-label={t('shell.language')}
      value={[lang]}
      onValueChange={(v) => {
        const next = v[0];
        if (next === 'de' || next === 'en') setLang(next);
      }}
      spacing={0}
      className="rounded-md border border-white/15 p-0.5 text-xs font-semibold tracking-wider"
    >
      {(['de', 'en'] as const).map((l) => (
        <ToggleGroupItem
          key={l}
          value={l}
          className="h-7 min-w-0 rounded-[5px] px-2 text-xs font-semibold tracking-wider text-band-ink/70 transition-colors duration-150 hover:bg-transparent hover:text-band-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-band-ink aria-pressed:bg-white/15 aria-pressed:text-band-ink aria-pressed:ring-1 aria-pressed:ring-white/30 aria-pressed:ring-inset"
        >
          {l.toUpperCase()}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function ThemeToggle() {
  const { choice, setChoice } = useTheme();
  const t = useT();
  const Icon = choice === 'dark' ? Moon : choice === 'light' ? Sun : Monitor;
  const label = t(
    choice === 'dark'
      ? 'shell.themeDark'
      : choice === 'light'
        ? 'shell.themeLight'
        : 'shell.themeSystem',
  );
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="text-band-ink/80 hover:bg-white/10 hover:text-band-ink dark:hover:bg-white/10"
            aria-label={`${t('shell.theme')}: ${label}`}
            onClick={() => setChoice(THEME_NEXT[choice])}
          />
        }
      >
        <Icon />
      </TooltipTrigger>
      <TooltipContent>
        {t('shell.theme')}: {label}
      </TooltipContent>
    </Tooltip>
  );
}

function LogoutButton() {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const logout = async () => {
    try {
      await unwrap(api.api.auth.logout.$post());
      toast.success(t('shell.loggedOut'));
    } finally {
      qc.clear();
      await navigate({ to: '/login' });
    }
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="text-band-ink/80 hover:bg-white/10 hover:text-band-ink dark:hover:bg-white/10"
            aria-label={t('shell.logout')}
            onClick={() => void logout()}
          />
        }
      >
        <LogOut />
      </TooltipTrigger>
      <TooltipContent>{t('shell.logout')}</TooltipContent>
    </Tooltip>
  );
}

export function AppShell() {
  const t = useT();
  const me = useQuery(meQuery);
  const isAdmin = me.data?.role === 'admin';
  const items = isAdmin
    ? [...NAV.slice(0, -1), USERS_NAV, NAV[NAV.length - 1]]
    : NAV;
  useServerEvents();
  return (
    <div className="min-h-dvh pb-16 md:pb-0">
      <header className="sticky top-0 z-20 bg-band text-band-ink shadow-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4">
          <Link
            to="/"
            className="flex items-center gap-2.5 rounded-md focus-visible:outline-band-ink"
          >
            <TallyLamp live={false} />
            <span className="font-display text-2xl leading-none font-extrabold tracking-wide uppercase">
              {t('app.name')}
            </span>
          </Link>
          <nav aria-label={t('nav.main')} className="hidden md:block">
            <ul className="flex gap-1">
              {items.map((n) => (
                <li key={n.to}>
                  <Link
                    to={n.to}
                    activeOptions={{
                      exact: n.to === '/',
                      includeSearch: false,
                    }}
                    className="relative block rounded-md px-2.5 py-1.5 text-sm text-band-ink/70 transition-colors duration-150 hover:text-band-ink focus-visible:outline-band-ink data-[status=active]:bg-white/10 data-[status=active]:text-band-ink"
                  >
                    {t(n.label)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <LangSwitch />
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 pt-8 pb-10">
        <Outlet />
      </main>
      <nav
        aria-label={t('nav.main')}
        className="fixed inset-x-0 bottom-0 z-20 border-t bg-sheet/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className={cn('grid', isAdmin ? 'grid-cols-6' : 'grid-cols-5')}>
          {items.map((n) => (
            <li key={n.to}>
              <Link
                to={n.to}
                activeOptions={{ exact: n.to === '/', includeSearch: false }}
                className="relative flex h-16 min-w-0 flex-col items-center px-0.5 justify-center gap-1 text-[11px] text-muted-foreground transition-colors data-[status=active]:font-semibold data-[status=active]:text-foreground data-[status=active]:before:absolute data-[status=active]:before:inset-x-4 data-[status=active]:before:top-0 data-[status=active]:before:h-0.5 data-[status=active]:before:rounded-full data-[status=active]:before:bg-ink"
              >
                <n.icon className="size-5" aria-hidden />
                <span className="max-w-full truncate">
                  {t('short' in n ? n.short : n.label)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
