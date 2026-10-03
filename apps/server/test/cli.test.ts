import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CliError,
  formatStatusTable,
  internalPort,
  parseCommand,
  parseImportYaml,
  run,
  type StatusRow,
} from '../src/cli.ts';

describe('parseCommand', () => {
  it('parses each command', () => {
    expect(parseCommand(['status'])).toEqual({ kind: 'status' });
    expect(parseCommand(['sync'])).toEqual({ kind: 'sync' });
    expect(parseCommand(['test-mail'])).toEqual({ kind: 'test-mail' });
    expect(parseCommand(['reset-password', 'mia'])).toEqual({
      kind: 'reset-password',
      username: 'mia',
    });
    expect(parseCommand(['import', 'a.yaml'])).toEqual({
      kind: 'import',
      file: 'a.yaml',
    });
  });

  it('returns help for no args or --help', () => {
    expect(parseCommand([])).toEqual({ kind: 'help' });
    expect(parseCommand(['--help'])).toEqual({ kind: 'help' });
    expect(parseCommand(['status', '-h'])).toEqual({ kind: 'help' });
  });

  it('rejects bad input', () => {
    expect(() => parseCommand(['nope'])).toThrow(CliError);
    expect(() => parseCommand(['import'])).toThrow(/needs a YAML/);
    expect(() => parseCommand(['import', 'a', 'b'])).toThrow(CliError);
    expect(() => parseCommand(['status', 'x'])).toThrow(/takes no/);
    expect(() => parseCommand(['reset-password'])).toThrow(/needs a username/);
    expect(() => parseCommand(['reset-password', 'a', 'b'])).toThrow(CliError);
    expect(() => parseCommand(['--bogus'])).toThrow(CliError);
  });

  it('reads INTERNAL_PORT', () => {
    expect(internalPort({})).toBe(8082);
    expect(internalPort({ INTERNAL_PORT: '9000' })).toBe(9000);
    expect(() => internalPort({ INTERNAL_PORT: 'x' })).toThrow(CliError);
  });
});

describe('formatStatusTable', () => {
  const subs = {
    'stream.online': 'enabled',
    'stream.offline': 'enabled',
    'channel.update': 'enabled',
  } as const;
  const rows: StatusRow[] = [
    {
      id: '1',
      login: 'papaplatte',
      displayName: 'Papaplatte',
      enabled: true,
      live: true,
      currentGame: 'Elden Ring',
      subscriptions: subs,
    },
    {
      id: '22',
      login: 'gronkh',
      displayName: 'GRONKH',
      enabled: false,
      live: false,
      currentGame: null,
      subscriptions: { ...subs, 'channel.update': 'missing' },
    },
  ];

  it('renders an aligned table', () => {
    expect(formatStatusTable(rows)).toBe(
      [
        'ID  LOGIN       STATE   LIVE  GAME        SUBSCRIPTIONS',
        '1   papaplatte  active  live  Elden Ring  enabled',
        '22  gronkh      paused  -     -           missing (2/3 enabled)',
      ].join('\n'),
    );
  });

  it('handles an empty list', () => {
    expect(formatStatusTable([])).toBe('No streamers configured.');
  });
});

describe('parseImportYaml', () => {
  it('maps the old format to the import body', () => {
    const yaml = `
default_games: ["Elden Ring"]
streamers:
  papaplatte:
    games: ["Minecraft", "Elden Ring"]
  gronkh: {}
  somestreamer:
    games: ["*"]
  bare:
`;
    expect(parseImportYaml(yaml)).toEqual({
      defaultGames: ['Elden Ring'],
      streamers: [
        { login: 'papaplatte', games: ['Minecraft', 'Elden Ring'] },
        { login: 'gronkh', games: null },
        { login: 'somestreamer', games: '*' },
        { login: 'bare', games: null },
      ],
    });
  });

  it('accepts an empty document', () => {
    expect(parseImportYaml('')).toEqual({ defaultGames: [], streamers: [] });
  });

  it('rejects malformed input', () => {
    expect(() => parseImportYaml('a: [')).toThrow(/Invalid YAML/);
    expect(() => parseImportYaml('- x')).toThrow(/mapping/);
    expect(() => parseImportYaml('default_games: 3')).toThrow(/default_games/);
    expect(() => parseImportYaml('streamers:\n  a:\n    games: [1]')).toThrow(
      /streamers.a.games/,
    );
  });
});

describe('run reset-password', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('prints the temporary password and exits 0', async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return Response.json({ username: 'mia', temporaryPassword: 'TMP-PASS' });
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await run(['reset-password', 'mia'])).toBe(0);
    expect(calls[0]?.url).toMatch(/\/internal\/users\/reset-password$/);
    expect(calls[0]?.body).toEqual({ username: 'mia' });
    expect(String(log.mock.calls[0]?.[0])).toContain('TMP-PASS');
  });

  it('exits non-zero for an unknown account', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json(
        { error: { code: 'not_found', message: 'Unknown user' } },
        { status: 404 },
      ),
    );
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run(['reset-password', 'nobody'])).toBe(1);
    expect(String(err.mock.calls[0]?.[0])).toContain('Unknown user');
  });
});
