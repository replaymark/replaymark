import type { AppType } from '@server/http/admin.ts';
import type { ApiError, ApiErrorCode } from '@shared/errors.ts';
import { QueryClient } from '@tanstack/react-query';
import type { ClientResponse } from 'hono/client';
import { hc } from 'hono/client';
import type { SuccessStatusCode } from 'hono/utils/http-status';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | 'network';
  readonly fields: Record<string, string[]> | undefined;
  constructor(
    status: number,
    code: ApiErrorCode | 'network',
    message: string,
    fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

let onUnauthorized: () => void = () => {};
let onPasswordChangeRequired: () => void = () => {};

/** Registered by main.tsx: a 403 password_change_required goes to /change-password. */
export function setPasswordChangeHandler(fn: () => void) {
  onPasswordChangeRequired = fn;
}

/** Registered by main.tsx once the router exists. */
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

const LOGIN_PATH = '/api/auth/login';

async function isPasswordChangeRequired(res: Response): Promise<boolean> {
  try {
    const body: unknown = await res.clone().json();
    return isApiError(body) && body.error.code === 'password_change_required';
  } catch {
    return false;
  }
}

const apiFetch: typeof fetch = async (input, init) => {
  let res: Response;
  try {
    res = await fetch(input, { ...init, credentials: 'include' });
  } catch (err) {
    throw new ApiClientError(
      0,
      'network',
      err instanceof Error ? err.message : String(err),
    );
  }
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (
    res.status === 401 &&
    !new URL(url, location.href).pathname.endsWith(LOGIN_PATH)
  ) {
    onUnauthorized();
  } else if (res.status === 403 && (await isPasswordChangeRequired(res))) {
    onPasswordChangeRequired();
  }
  return res;
};

export const api = hc<AppType>('/', { fetch: apiFetch });

type OkBody<R> =
  R extends ClientResponse<infer T, infer S, infer _F>
    ? S extends SuccessStatusCode
      ? T
      : never
    : never;

function isApiError(v: unknown): v is ApiError {
  return (
    typeof v === 'object' &&
    v !== null &&
    'error' in v &&
    typeof (v as ApiError).error?.code === 'string'
  );
}

/** Returns the success body or throws an `ApiClientError`. */
export async function unwrap<R extends ClientResponse<unknown, number, string>>(
  res: R | Promise<R>,
): Promise<OkBody<R>> {
  const r = await res;
  let body: unknown;
  try {
    body = await r.json();
  } catch {
    body = undefined;
  }
  if (r.ok) return body as OkBody<R>;
  if (isApiError(body)) {
    throw new ApiClientError(
      r.status,
      body.error.code,
      body.error.message,
      body.error.fields,
    );
  }
  throw new ApiClientError(
    r.status,
    r.status === 401 ? 'unauthorized' : 'internal',
    r.statusText,
  );
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: (count, err) =>
          !(
            err instanceof ApiClientError &&
            err.status >= 400 &&
            err.status < 500
          ) && count < 2,
      },
      mutations: { retry: false },
    },
  });
}

export const queryKeys = {
  me: ['me'] as const,
  setup: ['setup'] as const,
  account: ['account'] as const,
  users: ['users'] as const,
  overview: ['overview'] as const,
  streamers: ['streamers'] as const,
  gameGroups: ['game-groups'] as const,
  subscriptions: ['subscriptions'] as const,
  notifications: ['notifications'] as const,
  settings: ['settings'] as const,
  /** Prefix of every timeline query (list, categories, stream detail). */
  timeline: ['timeline'] as const,
};
