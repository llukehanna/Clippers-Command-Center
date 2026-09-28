// src/lib/data/result.ts
// Transport-neutral result of a data loader. API routes turn it into a
// NextResponse (src/lib/data/respond.ts); server pages read `body` directly,
// so pages never fetch their own API over HTTP.

export interface ApiResult<T = unknown> {
  status: number;
  body: T;
  headers?: Record<string, string>;
}

export function json<T>(body: T, init?: { status?: number; headers?: Record<string, string> }): ApiResult<T> {
  return { status: init?.status ?? 200, body, headers: init?.headers };
}

/**
 * The body of a successful result, else null. Returned untyped on purpose:
 * pages consume the same JSON shape the API routes serve.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function okBody(result: ApiResult<unknown>): any {
  return result.status >= 200 && result.status < 300 ? result.body : null;
}
