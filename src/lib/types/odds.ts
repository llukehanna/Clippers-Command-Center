// src/lib/types/odds.ts
// Shared type definitions for odds integration.
// Zero runtime imports — pure type declarations only.
// Importable by both scripts/ and src/ (Phase 9 API routes).

// ── Query helper return shape ─────────────────────────────────────────────────

/**
 * Shape returned by getLatestOdds(gameId).
 * All numeric fields are nullable because bookmakers may omit individual markets.
 * captured_at is included as a string (ISO) so Phase 9 can compute meta.stale
 * without re-querying the database.
 */
export interface OddsSnapshot {
  spread_home: number | null;
  spread_away: number | null;
  moneyline_home: number | null;
  moneyline_away: number | null;
  total_points: number | null;
  captured_at: string; // ISO 8601 timestamp
}

// ── Adapter return shape ──────────────────────────────────────────────────────

/**
 * A single game event returned by an OddsAdapter.
 * home_team / away_team are provider team names (e.g. "Los Angeles Clippers")
 * used for matching against the games table.
 * snapshot uses Omit<OddsSnapshot, 'captured_at'> because captured_at is
 * assigned at insert time by the sync script.
 */
export interface OddsEvent {
  provider_event_id: string;
  commence_time: string;  // ISO 8601
  home_team: string;
  away_team: string;
  snapshot: Omit<OddsSnapshot, 'captured_at'>;
}

// ── Provider interface ────────────────────────────────────────────────────────

/**
 * OddsAdapter — the interface enabling ODDS-04 provider swappability.
 *
 * Swapping providers = instantiating a different class in sync-odds.ts and
 * passing it to the main function. No other changes are needed.
 *
 * TypeScript structural typing: any class with fetchNBAOdds() and providerKey
 * satisfies this interface without an explicit `implements OddsAdapter`.
 */
export interface OddsAdapter {
  /** Provider identifier written to odds_snapshots.provider column. */
  readonly providerKey: string;
  /** Fetch all available NBA game odds from the provider. */
  fetchNBAOdds(): Promise<OddsEvent[]>;
}
