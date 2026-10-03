import { API_ERROR_CODES } from '@shared/errors.ts';
import { describe, expect, it } from 'vitest';
import {
  detectLang,
  errorMessage,
  interpolate,
  keyPaths,
  translate,
  translatePlural,
} from './core.ts';
import { de } from './de.ts';
import { en } from './en.ts';

describe('dictionaries', () => {
  it('en and de have identical key sets', () => {
    expect(keyPaths(de)).toEqual(keyPaths(en));
  });

  it('have no empty strings', () => {
    for (const dict of [en, de]) {
      for (const path of keyPaths(dict)) {
        const v = path
          .split('.')
          .reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], dict);
        expect(typeof v === 'string' && v.length > 0, path).toBe(true);
      }
    }
  });

  it('translate every API error code', () => {
    for (const code of API_ERROR_CODES) {
      expect(errorMessage('en', code)).toBeTruthy();
      expect(errorMessage('de', code)).toBeTruthy();
    }
  });
});

describe('interpolation and plurals', () => {
  it('replaces named placeholders and keeps unknown ones', () => {
    expect(interpolate('Hi {name}, {x}', { name: 'Ann' })).toBe('Hi Ann, {x}');
    expect(translate('de', 'overview.since', { time: '19:02' })).toBe(
      'seit 19:02',
    );
  });

  it('picks plural forms per language', () => {
    expect(translatePlural('en', 'overview.rosterCount', 1)).toBe('1 streamer');
    expect(translatePlural('en', 'overview.rosterCount', 14)).toBe(
      '14 streamers',
    );
    expect(translatePlural('en', 'overview.rosterCount', 0)).toBe(
      '0 streamers',
    );
    expect(translatePlural('de', 'overview.modeCustom', 2)).toBe('2 Spiele');
  });
});

describe('detectLang', () => {
  it('prefers the stored choice, then the browser language', () => {
    expect(detectLang('en', 'de-DE')).toBe('en');
    expect(detectLang(null, 'de-AT')).toBe('de');
    expect(detectLang(null, 'fr-FR')).toBe('en');
    expect(detectLang('xx', undefined)).toBe('en');
  });
});
