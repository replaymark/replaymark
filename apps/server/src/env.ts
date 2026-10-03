import { z } from 'zod';

const optionalString = z.string().min(1).optional();

/**
 * Format written by `hashPassword` (http/auth.ts):
 * `scrypt$N$r$p$<32-byte salt, base64>$<64-byte key, base64>`.
 * Catches values mangled by `$` interpolation or truncated while pasting.
 */
export const ADMIN_PASSWORD_HASH_RE =
  /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/]{43}=\$[A-Za-z0-9+/]{86}==$/;

export const envSchema = z.object({
  TWITCH_CLIENT_ID: z.string().min(1),
  TWITCH_CLIENT_SECRET: z.string().min(1),
  TWITCH_WEBHOOK_SECRET: z.string().min(10).max(100),
  TWITCH_CALLBACK_URL: z.url(),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_SECURITY: z.enum(['starttls', 'ssl', 'none']),
  SMTP_USERNAME: optionalString,
  SMTP_PASSWORD: optionalString,
  SMTP_FROM: z.string().min(1),

  ADMIN_PASSWORD_HASH: z.string().regex(ADMIN_PASSWORD_HASH_RE).optional(),
  ADMIN_COOKIE_SECURE: z.stringbool().default(true),
  PUBLIC_BASE_URL: z.url().optional(),

  DATA_DIR: z.string().min(1).default('/data'),
  TZ: optionalString,
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  PUBLIC_PORT: z.coerce.number().int().min(0).max(65535).default(8080),
  ADMIN_PORT: z.coerce.number().int().min(0).max(65535).default(8081),
  INTERNAL_PORT: z.coerce.number().int().min(0).max(65535).default(8082),
  /** Built SPA directory; defaults to `../web/dist` relative to the server package. */
  WEB_DIST: optionalString,
});

export type Env = z.infer<typeof envSchema>;

/** Validates the environment. Errors name offending variables only, never their values. */
export function loadEnv(
  source: Record<string, string | undefined> = process.env,
): Env {
  // Empty strings count as unset so `.env` placeholders like `FOO=` fall back to defaults.
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== '') cleaned[key] = value;
  }
  const result = envSchema.safeParse(cleaned);
  if (result.success) return result.data;
  const names = [
    ...new Set(
      result.error.issues.map((issue) => String(issue.path[0] ?? '?')),
    ),
  ];
  throw new Error(
    `Invalid or missing environment variables: ${names.join(', ')}`,
  );
}

export interface SmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS?: boolean;
  ignoreTLS?: boolean;
  auth?: { user: string; pass: string };
}

export function smtpTransportOptions(env: Env): SmtpTransportOptions {
  const base = { host: env.SMTP_HOST, port: env.SMTP_PORT };
  const security =
    env.SMTP_SECURITY === 'starttls'
      ? { secure: false, requireTLS: true }
      : env.SMTP_SECURITY === 'ssl'
        ? { secure: true }
        : { secure: false, ignoreTLS: true };
  const auth = env.SMTP_USERNAME
    ? { auth: { user: env.SMTP_USERNAME, pass: env.SMTP_PASSWORD ?? '' } }
    : {};
  return { ...base, ...security, ...auth };
}
