import { Writable } from 'node:stream';
import { describe, expect, test } from 'vitest';
import { createLogger, redact, streamWriter } from '../src/log.ts';

describe('redact', () => {
  test('redacts sensitive keys, nested objects and arrays', () => {
    const input = {
      user: 'a',
      accessToken: 't',
      nested: {
        Authorization: 'Bearer x',
        list: [{ password: 'p', ok: 1 }],
        cookie: 'c',
      },
      passwordHash: 'h',
      sessionId: 's',
    };
    expect(redact(input)).toEqual({
      user: 'a',
      accessToken: '[redacted]',
      nested: {
        Authorization: '[redacted]',
        list: [{ password: '[redacted]', ok: 1 }],
        cookie: '[redacted]',
      },
      passwordHash: '[redacted]',
      sessionId: '[redacted]',
    });
  });

  test('redacts known secret values anywhere', () => {
    expect(
      redact({ note: 'topsecretvalue', arr: ['topsecretvalue', 'fine'] }, [
        'topsecretvalue',
      ]),
    ).toEqual({
      note: '[redacted]',
      arr: ['[redacted]', 'fine'],
    });
  });

  test('redacts secrets embedded in longer strings', () => {
    expect(
      redact(
        {
          url: 'https://x.test/?key=topsecretvalue&b=topsecretvalue',
          err: new Error('auth failed for topsecretvalue'),
        },
        ['topsecretvalue'],
      ),
    ).toMatchObject({
      url: 'https://x.test/?key=[redacted]&b=[redacted]',
      err: { message: 'auth failed for [redacted]' },
    });
  });

  test('short secrets are redacted only on exact match', () => {
    expect(redact({ a: 'abc', b: 'abcdef-xyz' }, ['abc', ''])).toEqual({
      a: '[redacted]',
      b: 'abcdef-xyz',
    });
  });
});

describe('createLogger', () => {
  test('filters by level and writes JSON lines', () => {
    const lines: string[] = [];
    const log = createLogger({
      level: 'warn',
      pretty: false,
      secrets: ['s3cr3tvalue'],
      write: (l) => lines.push(l),
    });
    log.debug('d');
    log.info('i');
    log.warn('w', { value: 's3cr3tvalue' });
    log.error('e');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0] as string);
    expect(first).toMatchObject({
      level: 'warn',
      msg: 'w',
      value: '[redacted]',
    });
    expect(JSON.parse(lines[1] as string).level).toBe('error');
  });

  test('pretty mode writes a single readable line', () => {
    const lines: string[] = [];
    createLogger({
      level: 'debug',
      pretty: true,
      write: (l) => lines.push(l),
    }).debug('hello');
    expect(lines[0]).toContain('hello');
    expect(lines[0]).toContain('DEBUG');
  });
});

describe('streamWriter', () => {
  test('a broken output stream (EPIPE) is absorbed and later lines are dropped', async () => {
    const written: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc, done) {
        written.push(chunk.toString());
        done(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
      },
    });
    const write = streamWriter(stream);
    expect(streamWriter(stream)).toBe(write);
    expect(stream.listenerCount('error')).toBe(1);
    write('first');
    // Without the listener this error would be an uncaught exception.
    await new Promise((resolve) => setImmediate(resolve));
    write('second');
    expect(written).toEqual(['first\n']);
  });
});

describe('setup code logging', () => {
  test('keeps the setup code readable in the message', () => {
    const lines: string[] = [];
    const log = createLogger({
      pretty: false,
      secrets: ['scrypt$32768$8$1$AAAA'],
      write: (l) => lines.push(l),
    });
    log.warn('Setup code: ABCDE-FGHJK');
    expect(lines[0]).toContain('Setup code: ABCDE-FGHJK');
  });
});

describe('redact hardening', () => {
  test('redacts code and setupCode keys', () => {
    expect(
      redact({ code: 'ABCDE-FGHJK', setupCode: 'X', codec: 'h264' }),
    ).toEqual({
      code: '[redacted]',
      setupCode: '[redacted]',
      codec: 'h264',
    });
  });

  test('redacts secrets of 4 characters inside text', () => {
    expect(redact({ note: 'pw is abcd here' }, ['abcd'])).toEqual({
      note: 'pw is [redacted] here',
    });
  });
});
