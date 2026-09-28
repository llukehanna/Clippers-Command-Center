// src/lib/data/respond.ts
import { NextResponse } from 'next/server';
import type { ApiResult } from './result';

/** ApiResult → NextResponse, for route handlers. */
export function respond(result: ApiResult<unknown>): NextResponse {
  return NextResponse.json(result.body, { status: result.status, headers: result.headers });
}
