// scripts/lib/schedule-utils.ts
// Pure helpers shared by the schedule, finalize, and odds pipelines.
// Zero DB imports — safe to unit test without DATABASE_URL.

// ── Seasons ───────────────────────────────────────────────────────────────────

/** Season label from its start year: 2026 → "2026-27". Matches upsertSeasons(). */
export function seasonLabel(seasonId: number): string {
  return `${seasonId}-${String(seasonId + 1).slice(-2)}`;
}

/**
 * Current NBA season id (start year) for a given instant.
 * Seasons roll over on July 1: Jan–Jun belong to the season that started the
 * previous calendar year. Uses UTC month (a few hours of skew around midnight
 * on July 1 is irrelevant — no games are played then).
 */
export function currentSeasonId(now: Date = new Date()): number {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() < 6 ? year - 1 : year;
}

/** NBA CDN "seasonYear" ("2026-27") → season id (2026). Returns null if unparseable. */
export function seasonIdFromSeasonYear(seasonYear: string | null | undefined): number | null {
  const m = /^(\d{4})-\d{2}$/.exec((seasonYear ?? '').trim());
  return m ? parseInt(m[1], 10) : null;
}

// ── Game ids ──────────────────────────────────────────────────────────────────
//
// games.nba_game_id is BIGINT and holds EITHER an official NBA game id with its
// leading zeros stripped ("0022501199" → 22501199) OR a balldontlie game id
// (e.g. 18448017). Only NBA-format ids can be used against cdn.nba.com /
// stats.nba.com.
//
// NBA format (10 chars): "00" + T + YY + NNNNN, where T is the game type
// (2 = regular season, 3 = All-Star, 4 = playoffs, 5 = play-in) and YY the
// season start year mod 100. Numerically that is 20_000_000..59_999_999.
// Preseason (T=1) is intentionally excluded — preseason games are not stored.

const NBA_ID_MIN = 20_000_000;
const NBA_ID_MAX = 59_999_999;

/**
 * True when `id` looks like an official NBA game id (see above). When
 * `seasonId` is given, the YY digits must also match the season, which rules
 * out balldontlie ids that happen to fall in the numeric range.
 */
export function isNbaFormatGameId(
  id: string | number | bigint | null | undefined,
  seasonId?: number | null
): boolean {
  if (id === null || id === undefined) return false;
  const s = String(id).trim();
  if (!/^\d+$/.test(s)) return false;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < NBA_ID_MIN || n > NBA_ID_MAX) return false;
  if (seasonId !== undefined && seasonId !== null) {
    const yy = Math.floor(n / 100_000) % 100;
    if (yy !== seasonId % 100) return false;
  }
  return true;
}

/**
 * 10-char NBA game id for CDN / stats.nba.com URLs ("0022501199"), or null
 * when `id` is not NBA-format (e.g. a balldontlie id).
 */
export function toNbaGameId10(
  id: string | number | bigint | null | undefined,
  seasonId?: number | null
): string | null {
  if (!isNbaFormatGameId(id, seasonId)) return null;
  return String(Number(String(id).trim())).padStart(10, '0');
}

/** True when an NBA-format game id is a playoff game (type digit 4). */
export function isPlayoffNbaGameId(id: string | number | bigint): boolean {
  if (!isNbaFormatGameId(id)) return false;
  return Math.floor(Number(String(id).trim()) / 10_000_000) === 4;
}

// ── Status ────────────────────────────────────────────────────────────────────

/**
 * Canonical lowercase game status. Every write to games.status goes through
 * this so readers can compare against 'final' / 'in_progress' / 'scheduled'
 * without case mismatches (legacy rows were written as 'Final').
 */
export function normalizeGameStatus(raw: string | null | undefined): string {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return 'scheduled';
  if (s === 'final' || s.startsWith('final/')) return 'final';
  if (s === 'in_progress' || s === 'scheduled') return s;
  return s.replace(/\s+/g, '_');
}

// ── Dates ─────────────────────────────────────────────────────────────────────

/**
 * Calendar date (YYYY-MM-DD) of an instant in America/New_York.
 * games.game_date is the Eastern date, so provider timestamps in UTC must be
 * converted before matching (a 7:30pm PT tipoff is already "tomorrow" in UTC).
 */
export function easternDateOf(instant: string | Date): string | null {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return null;
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
