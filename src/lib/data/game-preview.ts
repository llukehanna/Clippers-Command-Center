// src/lib/data/game-preview.ts
// GET /api/schedule/{game_id} — everything the game preview page shows.
// Each section is its own query (or ESPN fetch) under Promise.allSettled: a
// failure logs and becomes null, and the page hides that section.

import { json, type ApiResult } from './result';
import { sql, LAC_NBA_TEAM_ID } from '@/src/lib/db';
import { buildMeta, buildError } from '@/src/lib/api-utils';
import { REGULAR_SEASON_SQL } from '@/src/lib/game-type';
import { fetchEspnJson } from '@/src/lib/espn/fetch';
import { espnScheduleUrl, findScheduledGame, parseEspnSchedule } from '@/src/lib/espn/schedule';
import { ESPN_INJURIES_URL, parseEspnInjuries } from '@/src/lib/espn/injuries';
import { expectedLacMargin, modelSigma, pregameLacWinProb } from '@/src/lib/live/win-prob';
import { daysSince, lacSpreadSeries, latestLacLine, type OddsRow } from '@/src/lib/game-preview-utils';
import type { WpCalibration } from '@/src/lib/types/live-state';
import type { GamePreviewPayload, Insight, PreviewTeamForm } from '@/src/lib/ui/types';

interface GameRow {
  game_id: string; game_date: string; season_id: number; status: string; arena: string | null;
  start_time_utc: string | null; is_preseason: boolean;
  home_team_id: string; away_team_id: string; home_abbr: string; away_abbr: string;
  home_city: string | null; away_city: string | null; home_name: string; away_name: string;
  home_is_lac: boolean; away_is_lac: boolean;
}
interface RecordRow { team_id: string; wins: number; losses: number }
interface RollingRow { team_id: string; net_rating: number | null; record_wins: number | null; record_losses: number | null }
interface RankRow { team_id: string; off: number; def: number; net: number; off_rank: number; def_rank: number; net_rank: number; total: number }
interface MeetingRow { game_id: string; game_date: string; season_id: number; lac_home: boolean; home_score: number; away_score: number }
interface RestRow { team_id: string; prev_date: string | null }
interface InsightRow { insight_id: string; scope: string; category: string; headline: string; detail: string | null; importance: number }

const notFound = (id: string) => json(buildError('NOT_FOUND', `Game ${id} not found`), { status: 404 });
const round1 = (x: number) => Math.round(x * 10) / 10;
const round3 = (x: number) => Math.round(x * 1000) / 1000;

function settled<T>(r: PromiseSettledResult<T>, label: string): T | null {
  if (r.status === 'fulfilled') return r.value;
  console.error(`[game-preview] ${label} failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
  return null;
}

export async function loadGamePreview(gameIdParam: string): Promise<ApiResult> {
  if (!/^\d+$/.test(gameIdParam)) return notFound(gameIdParam);
  try {
    const [g] = await sql<GameRow[]>`
      SELECT g.game_id::text AS game_id, g.game_date::text AS game_date, g.season_id, g.status, g.arena,
             to_char(g.start_time_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_time_utc,
             g.is_preseason,
             g.home_team_id::text AS home_team_id, g.away_team_id::text AS away_team_id,
             ht.abbreviation AS home_abbr, at.abbreviation AS away_abbr,
             ht.city AS home_city, at.city AS away_city, ht.name AS home_name, at.name AS away_name,
             (ht.nba_team_id = ${LAC_NBA_TEAM_ID}) AS home_is_lac,
             (at.nba_team_id = ${LAC_NBA_TEAM_ID}) AS away_is_lac
      FROM all_games g
      JOIN teams ht ON ht.team_id = g.home_team_id
      JOIN teams at ON at.team_id = g.away_team_id
      WHERE g.game_id = ${gameIdParam}::bigint
      LIMIT 1
    `;
    if (!g || (!g.home_is_lac && !g.away_is_lac)) return notFound(gameIdParam);

    const lacHome = g.home_is_lac;
    const lacId = lacHome ? g.home_team_id : g.away_team_id;
    const oppId = lacHome ? g.away_team_id : g.home_team_id;
    const oppAbbr = lacHome ? g.away_abbr : g.home_abbr;
    const teamIds = [lacId, oppId];
    const regular = sql.unsafe(REGULAR_SEASON_SQL);

    const [oddsR, kvR, recordR, rollingR, ranksR, meetingsR, restR, insightsR, scheduleR, injuriesR] = await Promise.allSettled([
      sql<OddsRow[]>`
        SELECT captured_at::text AS captured_at, spread_home::float8 AS spread_home, spread_away::float8 AS spread_away,
               moneyline_home, moneyline_away, total_points::float8 AS total_points
        FROM odds_snapshots
        WHERE game_id = ${g.game_id}::bigint
        ORDER BY captured_at ASC
      `,
      sql<{ value: WpCalibration }[]>`SELECT value FROM app_kv WHERE key = 'wp:model'`,
      sql<RecordRow[]>`
        -- preview:record
        SELECT t.team_id::text AS team_id,
               COUNT(*) FILTER (WHERE (g.home_team_id = t.team_id AND g.home_score > g.away_score)
                                   OR (g.away_team_id = t.team_id AND g.away_score > g.home_score))::int AS wins,
               COUNT(*) FILTER (WHERE (g.home_team_id = t.team_id AND g.home_score < g.away_score)
                                   OR (g.away_team_id = t.team_id AND g.away_score < g.home_score))::int AS losses
        FROM unnest(${teamIds}::bigint[]) AS t(team_id)
        JOIN games g ON g.home_team_id = t.team_id OR g.away_team_id = t.team_id
        WHERE g.season_id = ${g.season_id} AND lower(g.status) = 'final'
          AND g.game_date < ${g.game_date}::date AND ${regular}
        GROUP BY t.team_id
      `,
      sql<RollingRow[]>`
        SELECT DISTINCT ON (team_id) team_id::text AS team_id, net_rating::float8 AS net_rating, record_wins, record_losses
        FROM rolling_team_stats
        WHERE team_id = ANY(${teamIds}::bigint[]) AND season_id = ${g.season_id}
          AND window_games = 10 AND as_of_game_date < ${g.game_date}::date
        ORDER BY team_id, as_of_game_date DESC
      `,
      sql<RankRow[]>`
        -- preview:ranks
        WITH team_values AS (
          SELECT a.team_id,
                 SUM(a.off_rating::float8 * a.possessions) / NULLIF(SUM(a.possessions::float8), 0) AS off,
                 SUM(a.def_rating::float8 * a.possessions) / NULLIF(SUM(a.possessions::float8), 0) AS def
          FROM advanced_team_game_stats a
          JOIN games g ON g.game_id = a.game_id
          WHERE g.season_id = ${g.season_id} AND g.game_date < ${g.game_date}::date AND ${regular}
          GROUP BY a.team_id
          HAVING COUNT(*) >= 5
        ), ranked AS (
          SELECT team_id, off, def, off - def AS net,
                 RANK() OVER (ORDER BY off DESC)::int AS off_rank,
                 RANK() OVER (ORDER BY def ASC)::int AS def_rank,
                 RANK() OVER (ORDER BY off - def DESC)::int AS net_rank,
                 COUNT(*) OVER ()::int AS total
          FROM team_values
          WHERE off IS NOT NULL AND def IS NOT NULL
        )
        SELECT team_id::text AS team_id, off, def, net, off_rank, def_rank, net_rank, total
        FROM ranked WHERE team_id = ANY(${teamIds}::bigint[])
      `,
      sql<MeetingRow[]>`
        -- preview:meetings
        SELECT g.game_id::text AS game_id, g.game_date::text AS game_date, g.season_id,
               (g.home_team_id = ${lacId}::bigint) AS lac_home, g.home_score, g.away_score
        FROM games g
        WHERE lower(g.status) = 'final' AND g.game_date < ${g.game_date}::date
          AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
          AND ((g.home_team_id = ${lacId}::bigint AND g.away_team_id = ${oppId}::bigint)
            OR (g.home_team_id = ${oppId}::bigint AND g.away_team_id = ${lacId}::bigint))
        ORDER BY g.game_date DESC
        LIMIT 5
      `,
      sql<RestRow[]>`
        -- preview:rest
        SELECT t.team_id::text AS team_id, MAX(g.game_date)::text AS prev_date
        FROM unnest(${teamIds}::bigint[]) AS t(team_id)
        JOIN all_games g ON g.home_team_id = t.team_id OR g.away_team_id = t.team_id
        WHERE g.game_date < ${g.game_date}::date AND g.game_date >= ${g.game_date}::date - 30
        GROUP BY t.team_id
      `,
      sql<InsightRow[]>`
        SELECT insight_id::text AS insight_id, scope, category, headline, detail, importance
        FROM insights
        WHERE game_id = ${g.game_id}::bigint AND is_active = true
        ORDER BY importance DESC
      `,
      fetchEspnJson(espnScheduleUrl(g.season_id + 1)),
      fetchEspnJson(ESPN_INJURIES_URL),
    ]);

    // The line: latest snapshot, its movement, and the model's pregame view.
    const odds = settled(oddsR, 'odds');
    const kv = settled(kvR, 'wp model');
    let line: GamePreviewPayload['line'] = null;
    if (odds) {
      const current = latestLacLine(odds, lacHome);
      const e = expectedLacMargin(current?.spread ?? null, lacHome);
      const sigma = modelSigma(kv?.[0]?.value ?? null, e.source);
      line = {
        current,
        movement: lacSpreadSeries(odds, lacHome),
        win_prob: { lac: round3(pregameLacWinProb(e.expected, sigma)), source: e.source },
      };
    }

    // Matchup.
    const records = settled(recordR, 'record');
    const rolling = settled(rollingR, 'rolling form');
    const ranks = settled(ranksR, 'ranks');
    const meetingRows = settled(meetingsR, 'meetings');
    const rest = settled(restR, 'rest');
    const form = (teamId: string): PreviewTeamForm => {
      const rec = records ? records.find((r) => r.team_id === teamId) ?? { wins: 0, losses: 0 } : null;
      const roll = rolling?.find((r) => r.team_id === teamId);
      const rank = ranks?.find((r) => r.team_id === teamId);
      return {
        record: rec ? { wins: rec.wins, losses: rec.losses } : null,
        last10: roll && roll.record_wins != null && roll.record_losses != null
          ? { wins: roll.record_wins, losses: roll.record_losses, net_rating: roll.net_rating == null ? null : round1(roll.net_rating) }
          : null,
        ranks: rank
          ? {
              off: { value: round1(rank.off), rank: rank.off_rank, of: rank.total },
              def: { value: round1(rank.def), rank: rank.def_rank, of: rank.total },
              net: { value: round1(rank.net), rank: rank.net_rank, of: rank.total },
            }
          : null,
        days_since_last: daysSince(g.game_date, rest?.find((r) => r.team_id === teamId)?.prev_date ?? null),
      };
    };
    const meetings = meetingRows?.map((m) => {
      const lacScore = m.lac_home ? m.home_score : m.away_score;
      const oppScore = m.lac_home ? m.away_score : m.home_score;
      return { game_id: m.game_id, game_date: m.game_date, season_id: m.season_id, lac_home: m.lac_home, lac_score: lacScore, opp_score: oppScore, won: lacScore > oppScore };
    }) ?? null;
    const thisSeason = meetings?.filter((m) => m.season_id === g.season_id) ?? null;
    const matchup: GamePreviewPayload['matchup'] = {
      season_series: thisSeason ? { wins: thisSeason.filter((m) => m.won).length, losses: thisSeason.filter((m) => !m.won).length } : null,
      meetings,
      lac: form(lacId),
      opp: form(oppId),
    };

    // ESPN.
    const scheduleJson = settled(scheduleR, 'espn schedule');
    const espnGame = scheduleJson ? findScheduledGame(parseEspnSchedule(scheduleJson), g.game_date, oppAbbr) : null;
    const injuryJson = settled(injuriesR, 'espn injuries');
    const report = injuryJson ? parseEspnInjuries(injuryJson) : null;

    const insights: Insight[] = (settled(insightsR, 'insights') ?? []).map((r) => ({
      insight_id: r.insight_id, scope: r.scope, category: r.category, headline: r.headline, detail: r.detail, importance: r.importance,
    }));

    const body: GamePreviewPayload = {
      meta: buildMeta('mixed', 300),
      game: {
        game_id: g.game_id,
        game_date: g.game_date,
        start_time_utc: g.start_time_utc,
        opponent_abbr: oppAbbr,
        home_away: lacHome ? 'home' : 'away',
        status: g.status,
        odds: line?.current
          ? { spread: line.current.spread, moneyline: line.current.moneyline, over_under: line.current.over_under, captured_at: line.current.captured_at }
          : null,
        home_team: { team_id: g.home_team_id, abbreviation: g.home_abbr, city: g.home_city ?? undefined, name: g.home_name },
        away_team: { team_id: g.away_team_id, abbreviation: g.away_abbr, city: g.away_city ?? undefined, name: g.away_name },
        is_preseason: g.is_preseason,
        arena: g.arena,
        season_id: g.season_id,
      },
      broadcasts: espnGame ? espnGame.broadcasts : null,
      injuries: report ? { updated_at: report.fetched_at, lac: report.byTeam.LAC ?? [], opp: report.byTeam[oppAbbr] ?? [] } : null,
      line,
      matchup,
      insights,
    };
    return json(body);
  } catch (err) {
    console.error('[GET /api/schedule/:game_id]', err);
    return json(buildError('INTERNAL_ERROR', 'Unexpected server error'), { status: 500 });
  }
}
