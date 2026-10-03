export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export type Responder =
  | Response
  | Error
  | ((req: RecordedRequest) => Response | Promise<Response>);

export interface FakeFetch {
  fetch: typeof fetch;
  requests: RecordedRequest[];
  /** Queue a response for requests whose URL starts with `prefix` (FIFO). */
  on(prefix: string, ...responses: Responder[]): FakeFetch;
}

export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** Fetch double with a route table of FIFO response queues; records every request. */
export function createFakeFetch(): FakeFetch {
  const routes: { prefix: string; queue: Responder[] }[] = [];
  const requests: RecordedRequest[] = [];
  const impl = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const req: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: init?.body == null ? undefined : String(init.body),
    };
    requests.push(req);
    const route = routes.find(
      (r) => url.startsWith(r.prefix) && r.queue.length > 0,
    );
    const next = route?.queue.shift();
    if (!next)
      throw new Error(`fake fetch: no response for ${req.method} ${url}`);
    if (next instanceof Error) throw next;
    if (next instanceof Response) return next;
    return next(req);
  };
  const fake: FakeFetch = {
    fetch: impl as typeof fetch,
    requests,
    on(prefix, ...responses) {
      routes.push({ prefix, queue: responses });
      return fake;
    },
  };
  return fake;
}
