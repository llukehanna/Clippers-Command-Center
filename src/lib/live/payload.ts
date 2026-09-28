// src/lib/live/payload.ts
// Pure builders for /api/live's derived fields (key metrics, box score, live
// insights). Shared by the route and by the browser, which rebuilds the page
// payload from pushed live state (Live v2 plan 2). No DB, no Next imports.

import type { BoxscorePlayer, BoxscoreTeam, TeamStatistics } from '../types/live';
import type { LiveStateDoc } from '../types/live-state';
import type { BoxScorePlayer, BoxValue, Insight, KeyMetric, LivePayload } from '../ui/types';
import { generateLiveInsights } from '../insights/live';

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

/**
 * Compute the 4 key metrics from box score data.
 * lacBox is the Clippers box, oppBox is the opponent box.
 * Returns array in fixed order: efg_pct, tov_margin, reb_margin, pace
 */
export function computeKeyMetrics(lacBox: BoxscoreTeam, oppBox: BoxscoreTeam): KeyMetric[] {
  const lacStats = lacBox.statistics;
  const oppStats = oppBox.statistics;

  // eFG%
  const lacEfg = computeEfg(lacStats);
  const oppEfg = computeEfg(oppStats);

  // TO margin = LAC turnovers − opponent turnovers (positive = LAC committed MORE; negative is good)
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

function buildPlayerRow(player: BoxscorePlayer): BoxScorePlayer {
  const s = player.statistics;
  return {
    player_id: player.personId,
    nba_person_id: player.personId,
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

function buildTeamTotals(stats: TeamStatistics): Record<string, BoxValue> {
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

export function buildBoxScore(
  lacBox: BoxscoreTeam,
  oppBox: BoxscoreTeam,
  lacAbbr: string,
  oppAbbr: string
): NonNullable<LivePayload['box_score']> {
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

export interface LiveInsightInput {
  game_id: string;
  home_team_id: string;
  away_team_id: string;
  period: number;
  clock: string;
  home_score: number;
  away_score: number;
  recent_scoring: LiveStateDoc['recent_scoring'];
}

/** Live run/clutch insights, shaped like the route has always returned them. */
export function liveInsights(s: LiveInsightInput): Insight[] {
  return generateLiveInsights(
    {
      game_id: s.game_id,
      period: s.period,
      clock: s.clock,
      home_score: s.home_score,
      away_score: s.away_score,
      home_team_id: s.home_team_id,
      away_team_id: s.away_team_id,
      recent_scoring: s.recent_scoring,
    },
    { home_rolling_10: null, away_rolling_10: null }
  ).map((c, idx) => ({
    insight_id: `live-${s.game_id}-${idx}`,
    category: c.category,
    headline: c.headline,
    detail: c.detail,
    importance: c.importance,
    proof: { summary: c.category, result: c.proof_result[0] ?? null },
  }));
}

/**
 * The page payload with pushed live state laid over the last /api/live
 * response. `base` supplies what the runner doesn't know (team names and ids,
 * odds); everything that changes during a game comes from `doc`.
 */
export function overlayLiveDoc(base: LivePayload, doc: LiveStateDoc): LivePayload {
  const game = base.game;
  if (!game) return base;
  const lacIsHome = game.home.abbreviation === 'LAC';
  const lacBox = lacIsHome ? doc.home_box : doc.away_box;
  const oppBox = lacIsHome ? doc.away_box : doc.home_box;
  const lacAbbr = (lacIsHome ? game.home.abbreviation : game.away.abbreviation) ?? 'LAC';
  const oppAbbr = (lacIsHome ? game.away.abbreviation : game.home.abbreviation) ?? 'OPP';
  return {
    ...base,
    meta: { ...base.meta, generated_at: doc.fetched_at, stale: false, stale_reason: null },
    state: 'LIVE',
    snapshot_captured_at: doc.fetched_at,
    game: {
      ...game,
      status: doc.status,
      status_text: doc.status_text,
      period: doc.period,
      clock: doc.clock,
      periods: doc.periods,
      home: { ...game.home, score: doc.home_score },
      away: { ...game.away, score: doc.away_score },
    },
    key_metrics: lacBox && oppBox ? computeKeyMetrics(lacBox, oppBox) : [],
    box_score: lacBox && oppBox ? buildBoxScore(lacBox, oppBox, lacAbbr, oppAbbr) : null,
    insights: liveInsights({
      game_id: game.game_id,
      home_team_id: game.home.team_id ?? '',
      away_team_id: game.away.team_id ?? '',
      period: doc.period,
      clock: doc.clock,
      home_score: doc.home_score,
      away_score: doc.away_score,
      recent_scoring: doc.recent_scoring,
    }),
    other_games: doc.other_games,
    cadence: doc.cadence,
  };
}
