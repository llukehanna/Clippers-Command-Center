// src/lib/api-utils.ts
// Shared response builders for all Phase 9 API routes.
// Every route returns a `meta` envelope (MetaEnvelope) alongside its payload.

/**
 * The meta envelope included in every API response.
 * Matches the shape defined in Docs/API_SPEC.md.
 */
export interface MetaEnvelope {
  /** ISO 8601 timestamp of when this response was generated */
  generated_at: string;
  /** Data source used to build this response */
  source: 'nba_live' | 'balldontlie' | 'db' | 'odds_provider' | 'mixed';
  /** Whether the underlying data is considered stale */
  stale: boolean;
  /** Human-readable reason for staleness, or null if not stale */
  stale_reason: string | null;
  /** How many seconds the client may cache this response, or null if uncacheable */
  ttl_seconds: number | null;
}

/**
 * Build a MetaEnvelope for an API response.
 *
 * @param source       - Where the data came from
 * @param ttl_seconds  - Client-side cache TTL, or null
 * @param stale        - Whether the data is stale (default: false)
 * @param stale_reason - Reason for staleness (default: null)
 */
export function buildMeta(
  source: MetaEnvelope['source'],
  ttl_seconds: number | null,
  stale = false,
  stale_reason: string | null = null
): MetaEnvelope {
  return {
    generated_at: new Date().toISOString(),
    source,
    stale,
    stale_reason,
    ttl_seconds,
  };
}

/**
 * Build a standardised error envelope.
 *
 * @param code     - Machine-readable error code (e.g. "NOT_FOUND", "INTERNAL_ERROR")
 * @param message  - Human-readable description
 * @param details  - Optional additional context
 */
export function buildError(
  code: string,
  message: string,
  details?: Record<string, unknown>
): { error: { code: string; message: string; details: Record<string, unknown> } } {
  return {
    error: {
      code,
      message,
      details: details ?? {},
    },
  };
}
