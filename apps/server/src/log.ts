export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};
const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const SENSITIVE_KEY =
  /token|secret|password|hash|session|authorization|cookie|^code$|setupcode/i;
export const REDACTED = '[redacted]';
/** Shorter secrets are only redacted on exact match, to avoid mangling logs. */
const MIN_SUBSTRING_SECRET_LENGTH = 4;

/** Deep-copies `value`, replacing sensitive keys and known secret strings with `[redacted]`. */
export function redact(
  value: unknown,
  secrets: readonly string[] = [],
): unknown {
  const exact = new Set(secrets.filter((s) => s.length > 0));
  // Longest first so a secret containing another is replaced whole.
  const partial = secrets
    .filter((s) => s.length >= MIN_SUBSTRING_SECRET_LENGTH)
    .sort((a, b) => b.length - a.length);
  const scrub = (text: string): string => {
    if (exact.has(text)) return REDACTED;
    let out = text;
    for (const s of partial) {
      if (out.includes(s)) out = out.split(s).join(REDACTED);
    }
    return out;
  };
  const walk = (v: unknown, seen: WeakSet<object>): unknown => {
    if (typeof v === 'string') return scrub(v);
    if (v instanceof Error)
      return walk({ name: v.name, message: v.message, stack: v.stack }, seen);
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return '[circular]';
    seen.add(v);
    if (Array.isArray(v)) return v.map((item) => walk(item, seen));
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(v)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : walk(item, seen);
    }
    return out;
  };
  return walk(value, new WeakSet());
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  level?: LogLevel;
  pretty?: boolean;
  secrets?: readonly string[];
  write?: (line: string) => void;
}

const writers = new WeakMap<NodeJS.WritableStream, (line: string) => void>();

/**
 * Line writer for `stream` that survives the reader going away. Without an `error`
 * listener a write EPIPE (container log collector gone, `| head`) is an uncaught
 * exception; the handler logs it, the log write fails again, and the resulting
 * nextTick loop pins the CPU and starves the event loop, so SIGTERM is never handled.
 * After the first error the writer drops lines instead. One writer (and listener) per stream.
 */
export function streamWriter(
  stream: NodeJS.WritableStream,
): (line: string) => void {
  const cached = writers.get(stream);
  if (cached) return cached;
  let broken = false;
  stream.on('error', () => {
    broken = true;
  });
  const write = (line: string) => {
    if (!broken) stream.write(`${line}\n`);
  };
  writers.set(stream, write);
  return write;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const min = ORDER[options.level ?? 'info'];
  const pretty = options.pretty ?? process.env.NODE_ENV !== 'production';
  const secrets = options.secrets ?? [];
  const write = options.write ?? streamWriter(process.stdout);

  const log = (
    level: LogLevel,
    msg: string,
    data?: Record<string, unknown>,
  ) => {
    if (ORDER[level] < min) return;
    const time = new Date().toISOString();
    const safeMsg = redact(msg, secrets) as string;
    const safeData = data
      ? (redact(data, secrets) as Record<string, unknown>)
      : undefined;
    if (pretty) {
      const extra =
        safeData && Object.keys(safeData).length > 0
          ? ` ${JSON.stringify(safeData)}`
          : '';
      write(
        `${time} ${COLORS[level]}${level.toUpperCase().padEnd(5)}\x1b[0m ${safeMsg}${extra}`,
      );
    } else {
      write(JSON.stringify({ time, level, msg: safeMsg, ...safeData }));
    }
  };

  return {
    debug: (msg, data) => log('debug', msg, data),
    info: (msg, data) => log('info', msg, data),
    warn: (msg, data) => log('warn', msg, data),
    error: (msg, data) => log('error', msg, data),
  };
}
