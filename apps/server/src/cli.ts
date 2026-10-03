import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { parse as parseYaml } from 'yaml';
import type { ImportInput, ImportReport } from './http/internal.ts';
import type {
  SubscriptionState,
  SubscriptionType,
  SyncResultDto,
} from './shared/schemas.ts';

export const USAGE = `Usage: node src/cli.ts <command> [args]

Commands:
  status              Show streamers with live state and subscriptions
  sync                Run a subscription sync and print the result
  test-mail           Send a test mail to the configured recipients
  reset-password <username>
                      Set a temporary password for an account and print it once
  import <file.yaml>  Import streamers and default games (old YAML format)

Options:
  -h, --help          Show this help

All commands talk to the running server on
127.0.0.1:$INTERNAL_PORT (default 8082).`;

export class CliError extends Error {}

export type Command =
  | { kind: 'help' }
  | { kind: 'status' }
  | { kind: 'sync' }
  | { kind: 'test-mail' }
  | { kind: 'reset-password'; username: string }
  | { kind: 'import'; file: string };

/** Parses argv (without node and script path) into a command. */
export function parseCommand(argv: readonly string[]): Command {
  let parsed: ReturnType<typeof parse>;
  function parse() {
    return parseArgs({
      args: [...argv],
      options: { help: { type: 'boolean', short: 'h' } },
      allowPositionals: true,
      strict: true,
    });
  }
  try {
    parsed = parse();
  } catch (err) {
    throw new CliError(err instanceof Error ? err.message : String(err));
  }
  const [cmd, ...rest] = parsed.positionals;
  if (parsed.values.help || cmd === undefined || cmd === 'help') {
    return { kind: 'help' };
  }
  const noArgs = <T extends Command>(c: T): T => {
    if (rest.length > 0) {
      throw new CliError(`'${cmd}' takes no arguments`);
    }
    return c;
  };
  switch (cmd) {
    case 'status':
    case 'sync':
    case 'test-mail':
      return noArgs({ kind: cmd });
    case 'reset-password': {
      const [username, ...extra] = rest;
      if (!username) throw new CliError("'reset-password' needs a username");
      if (extra.length > 0)
        throw new CliError("'reset-password' takes one username");
      return { kind: 'reset-password', username };
    }
    case 'import': {
      const [file, ...extra] = rest;
      if (!file) throw new CliError("'import' needs a YAML file");
      if (extra.length > 0) throw new CliError("'import' takes one file");
      return { kind: 'import', file };
    }
    default:
      throw new CliError(`Unknown command: ${cmd}`);
  }
}

export function internalPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.INTERNAL_PORT;
  if (raw === undefined || raw === '') return 8082;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new CliError('INTERNAL_PORT must be an integer between 0 and 65535');
  }
  return n;
}

export interface StatusRow {
  id: string;
  login: string;
  displayName: string;
  enabled: boolean;
  live: boolean;
  currentGame: string | null;
  subscriptions: Record<SubscriptionType, SubscriptionState>;
}

function subSummary(subs: StatusRow['subscriptions']): string {
  const states = Object.values(subs);
  if (states.length === 0) return 'missing';
  const enabled = states.filter((s) => s === 'enabled').length;
  if (enabled === states.length) return 'enabled';
  const other = states.find((s) => s !== 'enabled') ?? 'missing';
  return `${other} (${enabled}/${states.length} enabled)`;
}

/** Plain-text table: id, login, active/paused, live, current game, subscriptions. */
export function formatStatusTable(rows: readonly StatusRow[]): string {
  if (rows.length === 0) return 'No streamers configured.';
  const header = ['ID', 'LOGIN', 'STATE', 'LIVE', 'GAME', 'SUBSCRIPTIONS'];
  const body = rows.map((r) => [
    r.id,
    r.login,
    r.enabled ? 'active' : 'paused',
    r.live ? 'live' : '-',
    r.currentGame ?? '-',
    subSummary(r.subscriptions),
  ]);
  const all = [header, ...body];
  const widths = header.map((_, i) =>
    Math.max(...all.map((row) => (row[i] ?? '').length)),
  );
  return all
    .map((row) =>
      row
        .map((cell, i) => cell.padEnd(widths[i] ?? 0))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

export function formatSync(r: SyncResultDto | null): string {
  if (!r) return 'No sync result available.';
  const lines = [
    `Sync ${r.ok ? 'ok' : 'failed'} at ${r.at}: ${r.active} active, ${r.created} created, ${r.deleted} deleted`,
    ...r.errors.map((e) => `  error: ${e.trim()}`),
  ];
  return lines.join('\n');
}

export function formatImportReport(r: ImportReport): string {
  const list = (xs: string[]) => (xs.length > 0 ? xs.join(', ') : '-');
  return [
    `Imported (${r.imported.length}): ${list(r.imported)}`,
    `Unknown logins (${r.unknownLogins.length}): ${list(r.unknownLogins)}`,
    `Unknown games (${r.unknownGames.length}): ${list(r.unknownGames)}`,
  ].join('\n');
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function stringList(v: unknown, where: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x.trim())) {
    throw new CliError(`${where} must be a list of non-empty strings`);
  }
  return v as string[];
}

/**
 * Maps the old YAML structure to the /internal/import body:
 * `games: ["*"]` → any game, missing games (`{}`) → default games,
 * otherwise a custom list.
 */
export function yamlToImportBody(doc: unknown): ImportInput {
  if (doc === null || doc === undefined)
    return { defaultGames: [], streamers: [] };
  if (!isRecord(doc)) throw new CliError('YAML root must be a mapping');
  const defaultGames =
    doc.default_games == null
      ? []
      : stringList(doc.default_games, 'default_games');
  const rawStreamers = doc.streamers ?? {};
  if (!isRecord(rawStreamers)) {
    throw new CliError('streamers must be a mapping of login to settings');
  }
  const streamers = Object.entries(rawStreamers).map(([login, cfg]) => {
    if (!login.trim()) throw new CliError('streamer login must not be empty');
    if (cfg !== null && cfg !== undefined && !isRecord(cfg)) {
      throw new CliError(`streamers.${login} must be a mapping`);
    }
    const games = cfg?.games;
    if (games == null) return { login, games: null };
    const list = stringList(games, `streamers.${login}.games`);
    if (list.includes('*')) return { login, games: '*' as const };
    return { login, games: list };
  });
  return { defaultGames, streamers };
}

export function parseImportYaml(text: string): ImportInput {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (err) {
    throw new CliError(
      `Invalid YAML: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return yamlToImportBody(doc);
}

async function call<T>(
  port: number,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${port}/internal/${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new CliError(`Server not reachable on 127.0.0.1:${port}`);
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      isRecord(data) &&
      isRecord(data.error) &&
      typeof data.error.message === 'string'
        ? data.error.message
        : `HTTP ${res.status}`;
    throw new CliError(`Server error: ${msg}`);
  }
  return data as T;
}

export async function run(argv: readonly string[]): Promise<number> {
  try {
    const cmd = parseCommand(argv);
    switch (cmd.kind) {
      case 'help':
        console.log(USAGE);
        return 0;
      case 'reset-password': {
        const r = await call<{ username: string; temporaryPassword: string }>(
          internalPort(),
          'POST',
          'users/reset-password',
          { username: cmd.username },
        );
        console.log(
          `Temporary password for ${r.username} (shown once, a change is required at next login):\n${r.temporaryPassword}`,
        );
        return 0;
      }
      case 'status':
        console.log(
          formatStatusTable(
            await call<StatusRow[]>(internalPort(), 'GET', 'status'),
          ),
        );
        return 0;
      case 'sync': {
        const r = await call<SyncResultDto | null>(
          internalPort(),
          'POST',
          'sync',
        );
        console.log(formatSync(r));
        return r?.ok === false ? 1 : 0;
      }
      case 'test-mail':
        await call(internalPort(), 'POST', 'test-mail');
        console.log('Test mail sent.');
        return 0;
      case 'import': {
        let text: string;
        try {
          text = await readFile(cmd.file, 'utf8');
        } catch {
          throw new CliError(`Cannot read file: ${cmd.file}`);
        }
        const body = parseImportYaml(text);
        const report = await call<ImportReport>(
          internalPort(),
          'POST',
          'import',
          body,
        );
        console.log(formatImportReport(report));
        return 0;
      }
    }
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`error: ${err.message}`);
      if (
        /Unknown command|takes|needs a YAML|needs a username|Unknown option|Unexpected argument/.test(
          err.message,
        )
      ) {
        console.error(`\n${USAGE}`);
      }
      return 1;
    }
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await run(process.argv.slice(2));
}
