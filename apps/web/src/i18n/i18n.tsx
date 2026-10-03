import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  detectLang,
  errorMessage,
  LANG_KEY,
  type Lang,
  type MessageKey,
  type PluralKey,
  translate,
  translatePlural,
  type Vars,
} from './core.ts';

interface I18nCtx {
  lang: Lang;
  setLang(l: Lang): void;
}

const Ctx = createContext<I18nCtx | null>(null);

function initialLang(): Lang {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(LANG_KEY);
  } catch {}
  return detectLang(stored, navigator.language);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {}
    setLangState(l);
  }, []);

  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLang(): I18nCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLang outside I18nProvider');
  return v;
}

export function useT() {
  const { lang } = useLang();
  return useMemo(() => {
    const t = (key: MessageKey, vars?: Vars) => translate(lang, key, vars);
    t.plural = (key: PluralKey, count: number, vars?: Vars) =>
      translatePlural(lang, key, count, vars);
    t.error = (code: Parameters<typeof errorMessage>[1]) =>
      errorMessage(lang, code);
    return t;
  }, [lang]);
}

export function useFormat() {
  const { lang } = useLang();
  return useMemo(() => {
    const locale = lang === 'de' ? 'de-DE' : 'en-GB';
    const time = new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
    });
    const dateTime = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const date = new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const dayMonth = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'long',
    });
    const num = new Intl.NumberFormat(locale);
    const toDate = (d: Date | string | number) =>
      d instanceof Date ? d : new Date(d);
    return {
      locale,
      time: (d: Date | string | number) => time.format(toDate(d)),
      dateTime: (d: Date | string | number) => dateTime.format(toDate(d)),
      date: (d: Date | string | number) => date.format(toDate(d)),
      dayMonth: (d: Date | string | number) => dayMonth.format(toDate(d)),
      number: (n: number) => num.format(n),
    };
  }, [lang]);
}
