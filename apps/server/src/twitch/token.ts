import type { Clock } from '../clock.ts';

export const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const RENEW_MARGIN_MS = 5 * 60 * 1000;

export interface TokenProviderOptions {
  clientId: string;
  clientSecret: string;
  fetch: typeof fetch;
  clock: Clock;
}

export interface TokenProvider {
  getToken(): Promise<string>;
  invalidate(): void;
}

export class TokenError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'TokenError';
    this.status = status;
  }
}

/** App access token via client credentials; cached and shared between concurrent callers. */
export function createTokenProvider(opts: TokenProviderOptions): TokenProvider {
  let cached: { token: string; expiresAt: number } | undefined;
  let inFlight: Promise<string> | undefined;

  async function fetchToken(): Promise<string> {
    const body = new URLSearchParams({
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      grant_type: 'client_credentials',
    });
    const res = await opts.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 200);
      throw new TokenError(
        res.status,
        `Twitch token request failed (${res.status}): ${text}`,
      );
    }
    const json = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    cached = {
      token: json.access_token,
      expiresAt: opts.clock.now() + json.expires_in * 1000,
    };
    return json.access_token;
  }

  return {
    getToken() {
      if (cached && opts.clock.now() < cached.expiresAt - RENEW_MARGIN_MS) {
        return Promise.resolve(cached.token);
      }
      if (!inFlight) {
        inFlight = fetchToken().finally(() => {
          inFlight = undefined;
        });
      }
      return inFlight;
    },
    invalidate() {
      cached = undefined;
    },
  };
}
