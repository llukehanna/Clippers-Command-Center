// src/lib/data/game-story.ts
// GET /api/history/games/{game_id}/story — the postgame sections above the
// box score: flow chart, quarter splits, clutch, shot chart, record-book
// notes. Each section is independent; missing data or a failed query is null.

import { json, type ApiResult } from './result';
import { sql, LAC_NBA_TEAM_ID } from '@/src/lib/db';
import { buildMeta, buildError } from '@/src/lib/api-utils';
import { expectedLacMargin, modelSigma } from '@/src/lib/live/win-prob';
import { flowFromSeries } from '@/src/lib/live/flow-from-series';
import { recordNotes, type HighRow } from '@/src/lib/record-notes';
import type { Shot } from '@/src/lib/shots';
import type { WpCalibration } from '@/src/lib/types/live-state';
import type { GameStoryPayload, StoryClutchLine, StoryPeriodLine } from '@/src/lib/ui/types';

interface GameRow { game_id: string; status: string; home_team_id: string; away_team_id: string; home_abbr: string; away_abbr: string; home_is_lac: boolean; away_is_lac: boolean }
interface FlowRow { margin_series: [number, number][]; lac_largest_lead: number; lac_largest_deficit: number; lead_changes: number; times_tied: number; lac_best_run: number; opp_best_run: number }
interface PeriodRow extends StoryPeriodLine { team_id: string; period: number }
interface TopRow { period: number; name: string; pts: number }
interface ClutchRow extends StoryClutchLine { team_id: string; player_id: string | null; name: string | null }
interface ShotRow { x: number | null; y: number | null; made: boolean | null; shot_value: number | null; player_id: string | null; player: string | null }
interface HighDbRow { scope: string; stat_key: string; rank: number; value: string | number; player_id: string | null; player: string | null }

const MIN_LOCATED_SHOTS = 10;
const notFound = (id: string) => json(buildError('NOT_FOUND', `Game ${id} not found`), { status: 404 });

function settled<T>(r: PromiseSettledResult<T>, label: string): T | null {
  if (r.status === 'fulfilled') return r.value;
  console.error(`[game-story] ${label} failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
  return null;
}

// app_kv stores { season_id, label } (build-record-book); a bare number is the legacy shape.
function startYear(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const id = (value as { season_id?: unknown } | null)?.season_id;
  return typeof id === 'number' && Number.isFinite(id) ? id : null;
}

const periodLine = (r: PeriodRow | undefined): StoryPeriodLine =>
  ({ pts: r?.pts ?? 0, fgm: r?.fgm ?? 0, fga: r?.fga ?? 0, fg3m: r?.fg3m ?? 0, fg3a: r?.fg3a ?? 0, ftm: r?.ftm ?? 0, fta: r?.fta ?? 0 });
const clutchLine = (r: ClutchRow): StoryClutchLine =>
  ({ pts: r.pts, fgm: r.fgm, fga: r.fga, fg3m: r.fg3m, ftm: r.ftm, fta: r.fta, tov: r.tov });

export async function loadGameStory(gameIdParam: string): Promise<ApiResult> {
  if (!/^\d+$/.test(gameIdParam)) return notFound(gameIdParam);
  try {
    const [g] = await sql<GameRow[]>`
      SELECT g.game_id::text AS game_id, g.status,
             g.home_team_id::text AS home_team_id, g.away_team_id::text AS away_team_id,
             ht.abbreviation AS home_abbr, at.abbreviation AS away_abbr,
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

    const [flowR, spreadR, kvR, descR, periodsR, topR, clutchR, shotsR, highsR, startsR] = await Promise.allSettled([
      sql<FlowRow[]>`
        SELECT margin_series, lac_largest_lead, lac_largest_deficit, lead_changes, times_tied, lac_best_run, opp_best_run
        FROM game_flow WHERE game_id = ${g.game_id}::bigint
      `,
      sql<{ lac_spread: number | null }[]>`
        -- story:spread
        SELECT (CASE WHEN ${lacHome} THEN o.spread_home ELSE o.spread_away END)::float8 AS lac_spread
        FROM odds_snapshots o
        JOIN all_games g ON g.game_id = o.game_id
        WHERE o.game_id = ${g.game_id}::bigint
          AND (g.start_time_utc IS NULL OR o.captured_at <= g.start_time_utc)
        ORDER BY o.captured_at DESC
        LIMIT 1
      `,
      sql<{ value: WpCalibration }[]>`SELECT value FROM app_kv WHERE key = 'wp:model'`,
      sql<{ elapsed_sec: number; description: string | null }[]>`
        -- story:descriptions
        SELECT elapsed_sec, description FROM pbp_events
        WHERE game_id = ${g.game_id}::bigint AND points <> 0
        ORDER BY event_num
      `,
      sql<PeriodRow[]>`
        SELECT team_id::text AS team_id, period, pts, fgm, fga, fg3m, fg3a, ftm, fta
        FROM period_team_stats WHERE game_id = ${g.game_id}::bigint
        ORDER BY period
      `,
      sql<TopRow[]>`
        SELECT DISTINCT ON (pps.period) pps.period, p.display_name AS name, pps.pts
        FROM period_player_stats pps
        JOIN players p ON p.player_id = pps.player_id
        WHERE pps.game_id = ${g.game_id}::bigint AND pps.team_id = ${lacId}::bigint AND pps.pts > 0
        ORDER BY pps.period, pps.pts DESC, p.display_name
      `,
      sql<ClutchRow[]>`
        SELECT c.team_id::text AS team_id, c.player_id::text AS player_id, p.display_name AS name,
               c.pts, c.fgm, c.fga, c.fg3m, c.ftm, c.fta, c.tov
        FROM clutch_stats c
        LEFT JOIN players p ON p.player_id = c.player_id
        WHERE c.game_id = ${g.game_id}::bigint
      `,
      sql<ShotRow[]>`
        -- story:shots
        SELECT e.shot_x::float8 AS x, e.shot_y::float8 AS y, e.made, e.shot_value,
               e.player_id::text AS player_id, p.display_name AS player
        FROM pbp_events e
        LEFT JOIN players p ON p.player_id = e.player_id
        WHERE e.game_id = ${g.game_id}::bigint AND e.kind = 'fg' AND e.team_id = ${lacId}::bigint
        ORDER BY e.event_num
      `,
      sql<HighDbRow[]>`
        SELECT h.scope, h.stat_key, h.rank, h.value, h.player_id::text AS player_id, p.display_name AS player
        FROM rb_game_highs h
        LEFT JOIN players p ON p.player_id = h.player_id
        WHERE h.game_id = ${g.game_id}::bigint
      `,
      sql<{ key: string; value: unknown }[]>`
        -- story:starts
        SELECT key, value FROM app_kv WHERE key IN ('insights.records_start', 'insights.pbp_records_start')
      `,
    ]);

    // Flow.
    const flowRow = settled(flowR, 'flow')?.[0];
    const periods = settled(periodsR, 'periods') ?? [];
    let flow: GameStoryPayload['flow'] = null;
    if (flowRow && Array.isArray(flowRow.margin_series) && flowRow.margin_series.length > 1) {
      const spread = settled(spreadR, 'closing spread')?.[0]?.lac_spread ?? null;
      const e = expectedLacMargin(spread, lacHome);
      const sigma = modelSigma(settled(kvR, 'wp model')?.[0]?.value ?? null, e.source);
      const descriptions = new Map<number, string>();
      for (const d of settled(descR, 'descriptions') ?? []) if (d.description) descriptions.set(d.elapsed_sec, d.description);
      const maxPeriod = periods.reduce((m, p) => Math.max(m, p.period), 4);
      flow = {
        flow: flowFromSeries(flowRow.margin_series, maxPeriod, { expected: e.expected, sigma }, descriptions),
        expected_source: e.source,
        summary: {
          largest_lead: flowRow.lac_largest_lead,
          largest_deficit: flowRow.lac_largest_deficit,
          lead_changes: flowRow.lead_changes,
          times_tied: flowRow.times_tied,
          lac_best_run: flowRow.lac_best_run,
          opp_best_run: flowRow.opp_best_run,
        },
      };
    }

    // Quarters.
    let quarters: GameStoryPayload['quarters'] = null;
    if (periodsR.status === 'fulfilled' && periods.length) {
      const tops = new Map((settled(topR, 'top scorers') ?? []).map((t) => [t.period, { name: t.name, pts: t.pts }]));
      const numbers = [...new Set(periods.map((p) => p.period))].sort((a, b) => a - b);
      quarters = numbers.map((period) => ({
        period,
        lac: periodLine(periods.find((p) => p.period === period && p.team_id === lacId)),
        opp: periodLine(periods.find((p) => p.period === period && p.team_id !== lacId)),
        lac_top: tops.get(period) ?? null,
      }));
    }

    // Clutch.
    const clutchRows = settled(clutchR, 'clutch') ?? [];
    const lacClutch = clutchRows.find((r) => r.player_id === null && r.team_id === lacId);
    const oppClutch = clutchRows.find((r) => r.player_id === null && r.team_id !== lacId);
    // A team row means that team had clutch time; the side without one scored nothing in it.
    const ZERO_CLUTCH: StoryClutchLine = { pts: 0, fgm: 0, fga: 0, fg3m: 0, ftm: 0, fta: 0, tov: 0 };
    const clutch: GameStoryPayload['clutch'] = lacClutch || oppClutch
      ? {
          lac: lacClutch ? clutchLine(lacClutch) : ZERO_CLUTCH,
          opp: oppClutch ? clutchLine(oppClutch) : null,
          players: clutchRows
            .filter((r) => r.player_id !== null && r.team_id === lacId && (r.pts > 0 || r.fga > 0))
            .sort((a, b) => b.pts - a.pts)
            .map((r) => ({ name: r.name ?? 'Unknown', pts: r.pts, fgm: r.fgm, fga: r.fga })),
        }
      : null;

    // Shots.
    const shotRows = settled(shotsR, 'shots') ?? [];
    const located: Shot[] = shotRows
      .filter((r) => r.x != null && r.y != null && (r.shot_value === 2 || r.shot_value === 3))
      .map((r) => ({ x: r.x!, y: r.y!, made: r.made === true, value: r.shot_value as 2 | 3, player_id: r.player_id ?? '', player: r.player ?? 'Unknown' }));
    const shots = located.length >= MIN_LOCATED_SHOTS ? { shots: located, located: located.length, total: shotRows.length } : null;

    // Record book.
    const starts = new Map((settled(startsR, 'record starts') ?? []).map((r) => [r.key, startYear(r.value)]));
    const highs: HighRow[] = (settled(highsR, 'record book') ?? []).map((h) => ({ ...h, value: Number(h.value) }));
    const notes = recordNotes(highs, {
      records: starts.get('insights.records_start') ?? null,
      pbp: starts.get('insights.pbp_records_start') ?? null,
    });

    const final = g.status.toLowerCase() === 'final';
    const body: GameStoryPayload = {
      meta: buildMeta('db', final ? 86400 : 60),
      game_id: g.game_id,
      opp_abbr: lacHome ? g.away_abbr : g.home_abbr,
      flow,
      quarters,
      clutch,
      shots,
      records: notes.length ? notes : null,
    };
    return json(body);
  } catch (err) {
    console.error('[GET /api/history/games/:game_id/story]', err);
    return json(buildError('INTERNAL_ERROR', 'Unexpected server error'), { status: 500 });
  }
}
