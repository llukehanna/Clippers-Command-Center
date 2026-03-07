// src/app/api/live/route.ts
// GET /api/live — Live Game Dashboard endpoint.
// Returns current Clippers game state: NO_ACTIVE_GAME, DATA_DELAYED, or LIVE.
// All data comes from live_snapshots table (no CDN calls from this route).
// advanced_stats table is NOT queried — key_metrics computed on the fly.

import { NextResponse } from 'next/server';
import { sql, LAC_NBA_TEAM_ID } from '@/src/lib/db';
import { buildMeta, buildError } from '@/src/lib/api-utils';
import { getLatestOdds } from '@/src/lib/odds';
import { generateLiveInsights } from '@/src/lib/insights/live';
import type { BoxscoreTeam, BoxscorePlayer, TeamStatistics } from '@/src/lib/types/live';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SnapshotPayload {
  is_stale: boolean;
  stale_reason: string | null;
  home_box: BoxscoreTeam;
  away_box: BoxscoreTeam;
  recent_scoring: Array<{ team_id: string; points: number; event_time_seconds: number }>;
}

interface SnapRow {
  snapshot_id: number;
  game_id: string;
  period: number;
  clock: string;
  home_score: number;
  away_score: number;
  home_team_id: string;
  away_team_id: string;
  captured_at: string;
  payload: SnapshotPayload;
}

interface GameRow {
  game_id: string;
  nba_game_id: string;
  season_id: number;
  game_date: string;
  start_time_utc: string;
  home_team_id: string;
  home_abbr: string;
  home_name: string;
  away_team_id: string;
  away_abbr: string;
  away_name: string;
}

// ── Key metrics computation ───────────────────────────────────────────────────

/**
 * Compute eFG% = (FGM + 0.5 * FG3M) / FGA
 * Returns 0 if FGA is 0 (avoid division by zero).
 */
function computeEfg(stats: TeamStatistics): number {
  const fga = stats.fieldGoalsAttempted;
  if (fga === 0) return 0;
  return (stats.fieldGoalsMade + 0.5 * stats.threePointersMade) / fga;
}

/**
 * Estimate possessions: FGA - OREB + TOV + 0.44 * FTA
 */
function estimatePossessions(stats: TeamStatistics): number {
  return (
    stats.fieldGoalsAttempted -
    stats.reboundsOffensive +
    stats.turnovers +
    0.44 * stats.freeThrowsAttempted
  );
}

/**
 * Parse ISO 8601 minutes string (e.g. "PT25M01.00S") to decimal minutes.
 * Falls back to 0 on parse failure.
 */
function parseMinutes(minutesStr: string): number {
  const match = minutesStr.match(/PT(?:(\d+)M)?(?:([\d.]+)S)?/);
  if (!match) return 0;
  const mins = parseFloat(match[1] ?? '0');
  const secs = parseFloat(match[2] ?? '0');
  return mins + secs / 60;
}

/**
 * Compute game minutes played from all player minutes in a box score.
 * Uses the team with more player minutes (to handle partial data).
 * Falls back to 48 minutes if unable to parse.
 */
function computeGameMinutes(lacBox: BoxscoreTeam, oppBox: BoxscoreTeam): number {
  const sumMinutes = (box: BoxscoreTeam): number =>
    box.players
      .filter((p) => p.played === '1')
      .reduce((acc, p) => acc + parseMinutes(p.statistics.minutes), 0);

  const lacMins = sumMinutes(lacBox);
  const oppMins = sumMinutes(oppBox);

  // Convert to per-team game minutes (5 players on court at once → divide by 5)
  const gameMinutes = Math.max(lacMins, oppMins) / 5;
  return gameMinutes > 0 ? gameMinutes : 48;
}

interface KeyMetric {
  key: string;
  label: string;
  value: number | null;
  team: string;
  delta_vs_opp: number | null;
}

/**
 * Compute the 4 key metrics from box score data.
 * lacBox is the Clippers box, oppBox is the opponent box.
 * Returns array in fixed order: efg_pct, tov_margin, reb_margin, pace
 */
function computeKeyMetrics(lacBox: BoxscoreTeam, oppBox: BoxscoreTeam): KeyMetric[] {
  const lacStats = lacBox.statistics;
  const oppStats = oppBox.statistics;

  // eFG%
  const lacEfg = computeEfg(lacStats);
  const oppEfg = computeEfg(oppStats);

  // TO margin (positive = LAC has fewer turnovers = good)
  const tovMargin = lacStats.turnovers - oppStats.turnovers;

  // Reb margin
  const rebMargin = lacStats.reboundsTotal - oppStats.reboundsTotal;

  // Pace = 48 * ((LAC_POSS + OPP_POSS) / 2) / game_minutes_played
  const lacPoss = estimatePossessions(lacStats);
  const oppPoss = estimatePossessions(oppStats);
  const gameMinutes = computeGameMinutes(lacBox, oppBox);
  const pace = gameMinutes > 0 ? 48 * ((lacPoss + oppPoss) / 2) / gameMinutes : null;

  return [
    {
      key: 'efg_pct',
      label: 'eFG%',
      value: parseFloat(lacEfg.toFixed(3)),
      team: 'LAC',
      delta_vs_opp: parseFloat((lacEfg - oppEfg).toFixed(3)),
    },
    {
      key: 'tov_margin',
      label: 'TO Margin',
      value: tovMargin,
      team: 'LAC',
      delta_vs_opp: tovMargin,
    },
    {
      key: 'reb_margin',
      label: 'Reb Margin',
      value: rebMargin,
      team: 'LAC',
      delta_vs_opp: rebMargin,
    },
    {
      key: 'pace',
      label: 'Pace',
      value: pace !== null ? parseFloat(pace.toFixed(1)) : null,
      team: 'GAME',
      delta_vs_opp: null,
    },
  ];
}

// ── Box score builder ─────────────────────────────────────────────────────────

function formatFraction(made: number, attempted: number): string {
  return `${made}-${attempted}`;
}

/**
 * Parse ISO 8601 minutes string to "MM:SS" display format.
 */
function parseMinutesToDisplay(minutesStr: string): string {
  const match = minutesStr.match(/PT(?:(\d+)M)?(?:([\d.]+)S)?/);
  if (!match) return '0:00';
  const mins = parseInt(match[1] ?? '0', 10);
  const secs = Math.floor(parseFloat(match[2] ?? '0'));
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function buildPlayerRow(player: BoxscorePlayer): Record<string, unknown> {
  const s = player.statistics;
  return {
    player_id: player.personId,
    name: player.name,
    starter: player.starter === '1',
    MIN: parseMinutesToDisplay(s.minutes),
    PTS: s.points,
    REB: s.reboundsTotal,
    AST: s.assists,
    STL: s.steals,
    BLK: s.blocks,
    TO: s.turnovers,
    FG: formatFraction(s.fieldGoalsMade, s.fieldGoalsAttempted),
    '3PT': formatFraction(s.threePointersMade, s.threePointersAttempted),
    FT: formatFraction(s.freeThrowsMade, s.freeThrowsAttempted),
    '+/-': s.plusMinusPoints,
  };
}

function buildTeamTotals(stats: TeamStatistics): Record<string, unknown> {
  return {
    PTS: stats.points,
    REB: stats.reboundsTotal,
    AST: stats.assists,
    TO: stats.turnovers,
    FG: formatFraction(stats.fieldGoalsMade, stats.fieldGoalsAttempted),
    '3PT': formatFraction(stats.threePointersMade, stats.threePointersAttempted),
    FT: formatFraction(stats.freeThrowsMade, stats.freeThrowsAttempted),
  };
}

function buildBoxScore(
  lacBox: BoxscoreTeam,
  oppBox: BoxscoreTeam,
  lacAbbr: string,
  oppAbbr: string
) {
  return {
    columns: ['MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', 'FG', '3PT', 'FT', '+/-'],
    teams: [
      {
        team_abbr: lacAbbr,
        players: lacBox.players
          .filter((p) => p.played === '1')
          .map(buildPlayerRow),
        totals: buildTeamTotals(lacBox.statistics),
      },
      {
        team_abbr: oppAbbr,
        players: oppBox.players
          .filter((p) => p.played === '1')
          .map(buildPlayerRow),
        totals: buildTeamTotals(oppBox.statistics),
      },
    ],
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

export async function GET(): Promise<NextResponse> {
  try {
    // ── Step 1: Fetch most recent LAC snapshot ─────────────────────────────

    const [snap] = await sql<SnapRow[]>`
      SELECT
        ls.snapshot_id,
        ls.game_id::text          AS game_id,
        ls.period,
        ls.clock,
        ls.home_score,
        ls.away_score,
        g.home_team_id::text      AS home_team_id,
        g.away_team_id::text      AS away_team_id,
        ls.captured_at::text      AS captured_at,
        ls.payload
      FROM live_snapshots ls
      JOIN games g ON g.game_id = ls.game_id
      WHERE g.home_team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
         OR g.away_team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
      ORDER BY ls.captured_at DESC
      LIMIT 1
    `;

    // ── Step 2: NO_ACTIVE_GAME ─────────────────────────────────────────────

    if (!snap) {
      return NextResponse.json(
        {
          meta: buildMeta('mixed', 60),
          state: 'NO_ACTIVE_GAME',
          game: null,
          key_metrics: [],
          box_score: null,
          insights: [],
          other_games: [],
          odds: null,
        },
        NO_STORE
      );
    }

    // ── Step 3: DATA_DELAYED ───────────────────────────────────────────────

    const payload = snap.payload as SnapshotPayload;

    // Time-based stale check: if the newest snapshot is >60s old, the poll
    // daemon is offline regardless of what the payload flag says.
    const snapshotAgeMs = Date.now() - new Date(snap.captured_at).getTime();
    const isStale = payload.is_stale || snapshotAgeMs > 60_000;
    const staleReason = isStale
      ? (payload.stale_reason ?? (snapshotAgeMs > 60_000 ? 'poll daemon offline' : null))
      : null;

    if (isStale) {
      const gameData = await fetchGameDetails(snap.game_id, snap);

      return NextResponse.json(
        {
          meta: buildMeta('mixed', 5, true, staleReason ?? 'poll daemon offline'),
          state: 'DATA_DELAYED',
          game: gameData,
          key_metrics: [],
          box_score: null,
          insights: [],
          other_games: [],
          odds: null,
        },
        NO_STORE
      );
    }

    // ── Step 4: LIVE ───────────────────────────────────────────────────────

    // Fetch game details (teams table join)
    const gameData = await fetchGameDetails(snap.game_id, snap);

    // Determine which box is LAC and which is opponent
    const lacTeamRow = await sql<{ team_id: string; abbreviation: string; name: string }[]>`
      SELECT team_id::text AS team_id, abbreviation, name
      FROM teams
      WHERE nba_team_id = ${LAC_NBA_TEAM_ID}
      LIMIT 1
    `;
    const lacTeam = lacTeamRow[0];
    const lacInternalId = lacTeam?.team_id;

    const lacIsHome = snap.home_team_id === lacInternalId;
    const lacBox = lacIsHome ? payload.home_box : payload.away_box;
    const oppBox = lacIsHome ? payload.away_box : payload.home_box;

    const lacAbbr = (gameData ? (lacIsHome ? gameData.home.abbreviation : gameData.away.abbreviation) : null) ?? 'LAC';
    const oppAbbr = (gameData ? (lacIsHome ? gameData.away.abbreviation : gameData.home.abbreviation) : null) ?? 'OPP';

    // Compute key_metrics from raw box data (NOT from advanced_stats table)
    const keyMetrics = lacBox && oppBox ? computeKeyMetrics(lacBox, oppBox) : [];

    // Build LiveSnapshot for insight generation
    const liveSnap = {
      game_id: snap.game_id,
      period: snap.period,
      clock: snap.clock,
      home_score: snap.home_score,
      away_score: snap.away_score,
      home_team_id: snap.home_team_id,
      away_team_id: snap.away_team_id,
      recent_scoring: payload.recent_scoring ?? [],
    };

    // Generate live insights (pure function, no DB)
    const rawInsights = generateLiveInsights(liveSnap, {
      home_rolling_10: null,
      away_rolling_10: null,
    });

    const insights = rawInsights.map((candidate, idx) => ({
      insight_id: `live-${snap.game_id}-${idx}`,
      category: candidate.category,
      headline: candidate.headline,
      detail: candidate.detail,
      importance: candidate.importance,
      proof: {
        summary: candidate.category,
        result: candidate.proof_result[0] ?? null,
      },
    }));

    // Fetch odds
    const oddsRaw = await getLatestOdds(snap.game_id);
    const odds = oddsRaw
      ? {
          provider: 'odds_api',
          captured_at: oddsRaw.captured_at,
          spread_home: oddsRaw.spread_home,
          spread_away: oddsRaw.spread_away,
          moneyline_home: oddsRaw.moneyline_home,
          moneyline_away: oddsRaw.moneyline_away,
          total_points: oddsRaw.total_points,
        }
      : null;

    // Build box score
    const boxScore =
      lacBox && oppBox ? buildBoxScore(lacBox, oppBox, lacAbbr, oppAbbr) : null;

    return NextResponse.json(
      {
        meta: buildMeta('mixed', 5, false, null),
        state: 'LIVE',
        game: gameData,
        key_metrics: keyMetrics,
        box_score: boxScore,
        insights,
        other_games: [],
        odds,
      },
      NO_STORE
    );
  } catch (err) {
    console.error('[GET /api/live] Unexpected error:', err);
    return NextResponse.json(
      buildError('INTERNAL_ERROR', 'Failed to fetch live game data', {
        message: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, ...NO_STORE }
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fetch game details by joining games + teams tables.
 * Returns a structured game object matching the API_SPEC.md shape,
 * or null if the game record doesn't exist yet.
 */
async function fetchGameDetails(gameId: string, snap: SnapRow) {
  const rows = await sql<GameRow[]>`
    SELECT
      g.game_id::text          AS game_id,
      g.nba_game_id::text      AS nba_game_id,
      g.season_id,
      g.game_date::text        AS game_date,
      g.start_time_utc::text   AS start_time_utc,
      g.home_team_id::text     AS home_team_id,
      ht.abbreviation          AS home_abbr,
      ht.name                  AS home_name,
      g.away_team_id::text     AS away_team_id,
      at.abbreviation          AS away_abbr,
      at.name                  AS away_name
    FROM games g
    JOIN teams ht ON ht.team_id = g.home_team_id
    JOIN teams at ON at.team_id = g.away_team_id
    WHERE g.game_id = ${gameId}::bigint
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    // Fallback: build minimal game object from snapshot data alone
    return {
      game_id: snap.game_id,
      nba_game_id: null,
      season_id: null,
      game_date: null,
      start_time_utc: null,
      status: 'in_progress',
      period: snap.period,
      clock: snap.clock,
      home: {
        team_id: snap.home_team_id,
        abbreviation: null,
        name: null,
        score: snap.home_score,
        is_home: true,
      },
      away: {
        team_id: snap.away_team_id,
        abbreviation: null,
        name: null,
        score: snap.away_score,
        is_home: false,
      },
    };
  }

  return {
    game_id: row.game_id,
    nba_game_id: row.nba_game_id,
    season_id: row.season_id,
    game_date: row.game_date,
    start_time_utc: row.start_time_utc,
    status: 'in_progress',
    period: snap.period,
    clock: snap.clock,
    home: {
      team_id: row.home_team_id,
      abbreviation: row.home_abbr,
      name: row.home_name,
      score: snap.home_score,
      is_home: true,
    },
    away: {
      team_id: row.away_team_id,
      abbreviation: row.away_abbr,
      name: row.away_name,
      score: snap.away_score,
      is_home: false,
    },
  };
}
