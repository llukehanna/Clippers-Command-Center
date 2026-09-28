// scripts/lib/pbp/ingest.ts
// One Clippers game's play-by-play → game_flow, period_*_stats, clutch_stats
// (all seasons) and pbp_events (current season, or keepRaw). Rewrites the
// game's rows in one transaction, so re-running is safe.
import { sql as rootSql } from '../db.js';
import type { Db } from '../upserts.js';
import { fetchPlayByPlay } from '../nba-live-client.js';
import { fetchStatsPlayByPlay } from '../stats-nba.js';
import { currentSeasonId, toNbaGameId10 } from '../schedule-utils.js';
import { normalizePbp } from './normalize.js';
import { deriveClutch, deriveGameFlow, derivePeriodStats } from './derive.js';
import type { NormalizedPbp, PbpSource, RawPlayByPlay } from './types.js';

/** First season cdn.nba.com serves play-by-play for (same archive as its box scores). */
export const CDN_PBP_FIRST_SEASON = 2019;

export interface IngestPbpOptions {
  db?: Db;
  /** true: store raw events and flag them keep (survive pruning). Raw events are always stored for the current season and for games already flagged keep. */
  keepRaw?: boolean;
  /** Use this play-by-play instead of fetching (tests, replays). */
  raw?: { data: RawPlayByPlay; source: PbpSource };
  log?: (msg: string) => void;
}

export type IngestPbpResult =
  | { status: 'ok'; events: number; unknownPlayers: number }
  | { status: 'missing' }
  /** The feed's last score differs from the game's final score (truncated feed) — nothing was written. */
  | { status: 'incomplete'; expected: { home: number; away: number }; got: { home: number; away: number } };

/**
 * CDN-era seasons use cdn.nba.com only: a failure returns null rather than
 * falling back to stats.nba.com, which blocks cloud IPs and stalls ~25 min per
 * game. stats.nba.com serves only seasons before the CDN archive (or unknown).
 */
export async function fetchNormalized(gid: string, seasonId: number | null, log: (m: string) => void): Promise<NormalizedPbp | null> {
  if (seasonId !== null && seasonId >= CDN_PBP_FIRST_SEASON) {
    try {
      const data = (await fetchPlayByPlay(gid)) as unknown as RawPlayByPlay;
      return normalizePbp(data, 'cdn');
    } catch (err) {
      log(`cdn play-by-play failed for ${gid} (${(err as Error).message})`);
      return null;
    }
  }
  const raw = await fetchStatsPlayByPlay(gid, log);
  return raw ? normalizePbp(raw, 'stats_pbp') : null;
}

export async function ingestGamePbp(gameDbId: string, opts: IngestPbpOptions = {}): Promise<IngestPbpResult> {
  const db = opts.db ?? rootSql;
  const log = opts.log ?? ((m: string) => console.log(`[pbp] ${m}`));

  const [game] = await db<{
    nba_game_id: string; season_id: number | null; home_team_id: string; away_team_id: string; home_abbr: string; away_abbr: string;
    home_score: number | null; away_score: number | null;
  }[]>`
    SELECT g.nba_game_id::text AS nba_game_id, g.season_id, g.home_score, g.away_score,
           g.home_team_id::text AS home_team_id, g.away_team_id::text AS away_team_id,
           h.abbreviation AS home_abbr, a.abbreviation AS away_abbr
    FROM games g
    JOIN teams h ON h.team_id = g.home_team_id
    JOIN teams a ON a.team_id = g.away_team_id
    WHERE g.game_id = ${gameDbId}::bigint
  `;
  if (!game) throw new Error(`[pbp] game_id ${gameDbId} not found`);
  const lacIsHome = game.home_abbr === 'LAC';
  if (!lacIsHome && game.away_abbr !== 'LAC') throw new Error(`[pbp] game_id ${gameDbId} is not a Clippers game`);
  const gid = toNbaGameId10(game.nba_game_id, game.season_id);
  if (!gid) throw new Error(`[pbp] game_id ${gameDbId}: ${game.nba_game_id} is not an NBA game id`);

  const pbp = opts.raw ? normalizePbp(opts.raw.data, opts.raw.source) : await fetchNormalized(gid, game.season_id, log);
  if (!pbp || pbp.events.length === 0) return { status: 'missing' };

  // Never persist a truncated feed: the last event must carry the final score.
  const last = pbp.events[pbp.events.length - 1];
  if (game.home_score !== null && game.away_score !== null &&
      (last.scoreHome !== game.home_score || last.scoreAway !== game.away_score)) {
    return {
      status: 'incomplete',
      expected: { home: game.home_score, away: game.away_score },
      got: { home: last.scoreHome, away: last.scoreAway },
    };
  }

  const flow = deriveGameFlow(pbp.events, lacIsHome);
  const periods = derivePeriodStats(pbp, { home: game.home_abbr, away: game.away_abbr });
  const clutch = deriveClutch(pbp.events);

  const teamIds = new Map<string, string>([[game.home_abbr, game.home_team_id], [game.away_abbr, game.away_team_id]]);
  const personIds = [...new Set(pbp.events.flatMap((e) => [e.personId, e.assistPersonId]).filter((x): x is number => x !== null))];
  const known = personIds.length
    ? await db<{ player_id: string; nba_person_id: number }[]>`
        SELECT player_id::text AS player_id, nba_person_id FROM players WHERE nba_person_id = ANY(${personIds}::int[])`
    : [];
  const playerIds = new Map(known.map((r) => [r.nba_person_id, r.player_id]));
  const unknownPlayers = personIds.filter((id) => !playerIds.has(id)).length;
  const unmappedRows =
    periods.teams.filter((t) => !teamIds.has(t.tricode)).length +
    periods.players.filter((p) => !teamIds.has(p.tricode)).length +
    clutch.filter((c) => !teamIds.has(c.tricode)).length;
  if (unmappedRows > 0) log(`game ${gameDbId}: ${unmappedRows} period/clutch row(s) dropped — tricode not ${game.home_abbr}/${game.away_abbr}`);

  await db.begin(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    // keepRaw: true also flags the rows keep, so season-rollover pruning spares them (replay games).
    const [existing] = await tx<{ keep: boolean | null }[]>`SELECT bool_or(keep) AS keep FROM pbp_events WHERE game_id = ${gameDbId}::bigint`;
    const keepFlag = (existing?.keep ?? false) || opts.keepRaw === true;
    const storeRaw = opts.keepRaw === true || keepFlag || game.season_id === currentSeasonId();

    await tx`DELETE FROM game_flow WHERE game_id = ${gameDbId}::bigint`;
    await tx`DELETE FROM period_team_stats WHERE game_id = ${gameDbId}::bigint`;
    await tx`DELETE FROM period_player_stats WHERE game_id = ${gameDbId}::bigint`;
    await tx`DELETE FROM clutch_stats WHERE game_id = ${gameDbId}::bigint`;
    await tx`DELETE FROM pbp_events WHERE game_id = ${gameDbId}::bigint`;

    await tx`
      INSERT INTO game_flow (game_id, lac_largest_lead, lac_largest_deficit, lead_changes, times_tied,
                             lac_best_run, opp_best_run, comeback_margin, margin_series, source)
      VALUES (${gameDbId}::bigint, ${flow.lacLargestLead}, ${flow.lacLargestDeficit}, ${flow.leadChanges}, ${flow.timesTied},
              ${flow.lacBestRun}, ${flow.oppBestRun}, ${flow.comebackMargin}, ${tx.json(flow.marginSeries)}, ${pbp.source})
    `;

    const teamRows = periods.teams
      .filter((t) => teamIds.has(t.tricode))
      .map((t) => ({
        game_id: gameDbId, team_id: teamIds.get(t.tricode)!, period: t.period,
        pts: t.pts, fgm: t.fgm, fga: t.fga, fg3m: t.fg3m, fg3a: t.fg3a, ftm: t.ftm, fta: t.fta, reb: t.reb, ast: t.ast, tov: t.tov,
      }));
    if (teamRows.length) await tx`INSERT INTO period_team_stats ${tx(teamRows)}`;

    const playerRows = periods.players
      .filter((p) => teamIds.has(p.tricode) && playerIds.has(p.personId))
      .map((p) => ({
        game_id: gameDbId, player_id: playerIds.get(p.personId)!, team_id: teamIds.get(p.tricode)!, period: p.period,
        pts: p.pts, reb: p.reb, ast: p.ast, fg3m: p.fg3m, fgm: p.fgm, fga: p.fga, stl: p.stl, blk: p.blk,
      }));
    if (playerRows.length) await tx`INSERT INTO period_player_stats ${tx(playerRows)}`;

    const clutchRows = clutch
      .filter((c) => teamIds.has(c.tricode) && (c.personId === null || playerIds.has(c.personId)))
      .map((c) => ({
        game_id: gameDbId, team_id: teamIds.get(c.tricode)!, player_id: c.personId === null ? null : playerIds.get(c.personId)!,
        pts: c.pts, fgm: c.fgm, fga: c.fga, fg3m: c.fg3m, ftm: c.ftm, fta: c.fta, tov: c.tov,
      }));
    if (clutchRows.length) await tx`INSERT INTO clutch_stats ${tx(clutchRows)}`;

    if (storeRaw) {
      const rows = pbp.events.map((e) => ({
        game_id: gameDbId, event_num: e.seq, action_number: e.actionNumber, action_type: e.actionType, sub_type: e.subType,
        period: e.period, clock_sec: e.clockSec, elapsed_sec: e.elapsedSec,
        team_id: e.teamTricode ? teamIds.get(e.teamTricode) ?? null : null,
        player_id: e.personId ? playerIds.get(e.personId) ?? null : null,
        kind: e.kind, made: e.made, shot_value: e.shotValue, points: e.points,
        score_home: e.scoreHome, score_away: e.scoreAway, description: e.description, keep: keepFlag,
      }));
      for (let i = 0; i < rows.length; i += 500) await tx`INSERT INTO pbp_events ${tx(rows.slice(i, i + 500))}`;
    }
  });

  return { status: 'ok', events: pbp.events.length, unknownPlayers };
}

/** Deletes raw events of past seasons, except games flagged keep. Returns rows deleted. */
export async function pruneRawEvents(db: Db = rootSql, now: Date = new Date()): Promise<number> {
  const result = await db`
    DELETE FROM pbp_events e USING games g
    WHERE g.game_id = e.game_id AND g.season_id < ${currentSeasonId(now)} AND NOT e.keep
  `;
  return result.count;
}
