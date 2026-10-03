import type { ApiErrorCode } from '@shared/errors.ts';
import { de } from './de.ts';
import { en, type Messages } from './en.ts';

export type Lang = 'en' | 'de';
export const LANGS: readonly Lang[] = ['en', 'de'];
export const dictionaries: Record<Lang, Messages> = { en, de };
export const LANG_KEY = 'replaymark.lang';

type Plural = { one: string; other: string };

type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${P}${K}`
    : T[K] extends Plural
      ? never
      : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];

type PluralPaths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? never
    : T[K] extends Plural
      ? `${P}${K}`
      : PluralPaths<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = Paths<Messages>;
export type PluralKey = PluralPaths<Messages>;
export type Vars = Record<string, string | number>;

export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in vars ? String(vars[name]) : m,
  );
}

function lookup(dict: Messages, key: string): unknown {
  let cur: unknown = dict;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && part in cur) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  const v = lookup(dictionaries[lang], key);
  return typeof v === 'string' ? interpolate(v, vars) : key;
}

export function translatePlural(
  lang: Lang,
  key: PluralKey,
  count: number,
  vars?: Vars,
): string {
  const v = lookup(dictionaries[lang], key) as Plural | undefined;
  if (!v) return key;
  const form =
    new Intl.PluralRules(lang).select(count) === 'one' ? 'one' : 'other';
  return interpolate(v[form], { count, ...vars });
}

export function errorMessage(
  lang: Lang,
  code: ApiErrorCode | 'network',
): string {
  return dictionaries[lang].errors[code];
}

export function detectLang(
  stored: string | null,
  navigatorLang: string | undefined,
): Lang {
  if (stored === 'en' || stored === 'de') return stored;
  return navigatorLang?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

/** Sorted dotted key paths of a dictionary (for parity tests). */
export function keyPaths(obj: object, prefix = ''): string[] {
  return Object.entries(obj)
    .flatMap(([k, v]) =>
      v && typeof v === 'object'
        ? keyPaths(v, `${prefix}${k}.`)
        : [`${prefix}${k}`],
    )
    .sort();
}
