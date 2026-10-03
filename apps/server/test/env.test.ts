import { describe, expect, test } from 'vitest';
import { loadEnv, smtpTransportOptions } from '../src/env.ts';
import { hashPassword } from '../src/http/auth.ts';

const base = {
  TWITCH_CLIENT_ID: 'cid',
  TWITCH_CLIENT_SECRET: 'csecret',
  TWITCH_WEBHOOK_SECRET: 'abcdefghijklmnop',
  TWITCH_CALLBACK_URL: 'https://twitch.example.com/webhook',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_SECURITY: 'starttls',
  SMTP_FROM: 'Notify <n@example.com>',
};

describe('loadEnv', () => {
  test('applies defaults', () => {
    const env = loadEnv(base);
    expect(env.DATA_DIR).toBe('/data');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.DEFAULT_LANGUAGE).toBe('en');
    expect(env.ADMIN_COOKIE_SECURE).toBe(true);
    expect(env.SMTP_PORT).toBe(587);
    expect(env.ADMIN_PASSWORD_HASH).toBeUndefined();
    expect(env.PUBLIC_BASE_URL).toBeUndefined();
  });

  test('accepts de and rejects other DEFAULT_LANGUAGE values', () => {
    expect(loadEnv({ ...base, DEFAULT_LANGUAGE: 'de' }).DEFAULT_LANGUAGE).toBe(
      'de',
    );
    expect(() => loadEnv({ ...base, DEFAULT_LANGUAGE: 'fr' })).toThrow(
      /DEFAULT_LANGUAGE/,
    );
  });

  test('parses ADMIN_COOKIE_SECURE=false', () => {
    expect(
      loadEnv({ ...base, ADMIN_COOKIE_SECURE: 'false' }).ADMIN_COOKIE_SECURE,
    ).toBe(false);
  });

  test('invalid secret length names the variable but not the value', () => {
    const value = 'short123';
    expect(() => loadEnv({ ...base, TWITCH_WEBHOOK_SECRET: value })).toThrow(
      /TWITCH_WEBHOOK_SECRET/,
    );
    try {
      loadEnv({ ...base, TWITCH_WEBHOOK_SECRET: value });
    } catch (err) {
      expect((err as Error).message).not.toContain(value);
    }
  });

  test('rejects over-long secret and bad SMTP_SECURITY', () => {
    expect(() =>
      loadEnv({
        ...base,
        TWITCH_WEBHOOK_SECRET: 'x'.repeat(101),
        SMTP_SECURITY: 'tls',
      }),
    ).toThrow(/TWITCH_WEBHOOK_SECRET, SMTP_SECURITY/);
  });
});

describe('ADMIN_PASSWORD_HASH format', () => {
  const hash = hashPassword('pw');

  test('accepts a hash from hashPassword', () => {
    expect(
      loadEnv({ ...base, ADMIN_PASSWORD_HASH: hash }).ADMIN_PASSWORD_HASH,
    ).toBe(hash);
  });

  test.each([
    ['truncated', hash.slice(0, -5)],
    ['interpolated $ segments', 'scrypt=8$1$abc'],
    ['kept quotes', `'${hash}'`],
    ['missing prefix', hash.replace('scrypt$', '')],
  ])('rejects %s naming the variable', (_name, value) => {
    expect(() => loadEnv({ ...base, ADMIN_PASSWORD_HASH: value })).toThrow(
      /ADMIN_PASSWORD_HASH/,
    );
  });
});

describe('smtpTransportOptions', () => {
  test('starttls', () => {
    const o = smtpTransportOptions(loadEnv(base));
    expect(o).toEqual({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      requireTLS: true,
    });
  });

  test('ssl with auth', () => {
    const o = smtpTransportOptions(
      loadEnv({
        ...base,
        SMTP_SECURITY: 'ssl',
        SMTP_PORT: '465',
        SMTP_USERNAME: 'u',
        SMTP_PASSWORD: 'p',
      }),
    );
    expect(o).toEqual({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      auth: { user: 'u', pass: 'p' },
    });
  });

  test('none', () => {
    const o = smtpTransportOptions(
      loadEnv({ ...base, SMTP_SECURITY: 'none', SMTP_PORT: '25' }),
    );
    expect(o).toEqual({
      host: 'smtp.example.com',
      port: 25,
      secure: false,
      ignoreTLS: true,
    });
  });
});
