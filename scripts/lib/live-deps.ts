// scripts/lib/live-deps.ts
// Real I/O for the live poller: NBA CDN fetchers (ESPN when the CDN refuses
// us) and the live_state store.

import type { Sql } from 'postgres';
import {
  fetchBoxscoreConditional,
  fetchPlayByPlayConditional,
  fetchScoreboard,
  NbaHttpError,
  type CondResult,
} from './nba-live-client';
import {
  athleteNames,
  fetchEspnScoreboard,
  fetchEspnSummary,
  nameResolver,
  normalizeName,
  toActions,
  toBoxResponse,
  toBoxscore,
  toPbpResponse,
  toScoreboard,
  type EspnSummaryJson,
  type PersonIdResolver,
} from './espn-live-client';
import type { PollerDeps } from './live-poller';
import { saveLiveMoment, saveLiveState } from './live-store';
import { hubPublisherFromEnv, saveThenPublish, type Publisher } from './live-publish';

/** PollerDeps plus the hub publisher itself, so a caller can flush() it before exiting. */
export interface NbaPollerDeps extends PollerDeps {
  hub: Publisher | null;
}

type Feeds = Pick<PollerDeps, 'fetchScoreboard' | 'fetchPbp' | 'fetchBox'>;

const nbaFeeds: Feeds = {
  fetchScoreboard,
  fetchPbp: fetchPlayByPlayConditional,
  fetchBox: fetchBoxscoreConditional,
};

// ESPN serves play-by-play and the box score in one summary document; one
// fetch serves both feeds within a tick, and ESPN is never asked more often
// than this (the poller honours it like a CDN max-age).
const ESPN_SUMMARY_REUSE_MS = 1_500;
const ESPN_MIN_INTERVAL_MS = 3_000;

interface EspnGameContext {
  homeTricode: string;
  awayTricode: string;
  gameDate: string; // US Eastern, YYYY-MM-DD
  resolve: PersonIdResolver;
}

async function loadEspnContext(sql: Sql, gameDbId: string): Promise<EspnGameContext> {
  const [game] = await sql<{ home: string; away: string; game_date: string }[]>`
    SELECT h.abbreviation AS home, a.abbreviation AS away, g.game_date::text AS game_date
    FROM all_games g
    JOIN teams h ON h.team_id = g.home_team_id
    JOIN teams a ON a.team_id = g.away_team_id
    WHERE g.game_id = ${gameDbId}::bigint
  `;
  if (!game) throw new Error(`game ${gameDbId} not found`);
  // Active, recently updated rows win a (rare) name collision.
  const players = await sql<{ nba_person_id: number; display_name: string }[]>`
    SELECT nba_person_id, display_name FROM players
    WHERE nba_person_id IS NOT NULL
    ORDER BY is_active, updated_at
  `;
  const byName = new Map(players.map((p) => [normalizeName(p.display_name), p.nba_person_id]));
  return { homeTricode: game.home, awayTricode: game.away, gameDate: game.game_date, resolve: nameResolver(byName) };
}

export function espnFeeds(sql: Sql, gameDbId: string, nbaGameId: string, now: () => number = Date.now): Feeds {
  let context: Promise<EspnGameContext> | null = null;
  const ctx = () => (context ??= loadEspnContext(sql, gameDbId).catch((err) => {
    context = null; // retry next tick
    throw err;
  }));
  let eventId: string | null = null;
  let summary: { at: number; json: EspnSummaryJson } | null = null;

  async function fetchSb() {
    const c = await ctx();
    const { scoreboard, match } = toScoreboard(await fetchEspnScoreboard(c.gameDate), {
      nbaGameId,
      homeTricode: c.homeTricode,
      awayTricode: c.awayTricode,
    });
    if (match) eventId = match.espnEventId;
    return scoreboard;
  }

  async function getSummary(): Promise<EspnSummaryJson> {
    if (!eventId) await fetchSb();
    if (!eventId) throw new Error('ESPN scoreboard has no matching game');
    if (summary && now() - summary.at < ESPN_SUMMARY_REUSE_MS) return summary.json;
    const json = await fetchEspnSummary(eventId);
    summary = { at: now(), json };
    return json;
  }

  const ok = <T>(body: T): CondResult<T> =>
    ({ status: 200, body, validators: {}, freshness: { maxAgeMs: ESPN_MIN_INTERVAL_MS, ageMs: 0 } });

  async function actionsOf(json: EspnSummaryJson) {
    return toActions(json, (await ctx()).resolve, athleteNames(json));
  }

  return {
    fetchScoreboard: fetchSb,
    async fetchPbp() {
      const json = await getSummary();
      return ok(toPbpResponse(nbaGameId, await actionsOf(json)));
    },
    async fetchBox() {
      const json = await getSummary();
      const game = toBoxscore(json, nbaGameId, (await ctx()).resolve, await actionsOf(json));
      if (!game) throw new Error('ESPN summary has no box score yet');
      return ok(toBoxResponse(game));
    },
  };
}

/**
 * NBA CDN first; the first 403 switches every feed to ESPN for the rest of the
 * run (cdn.nba.com liveData has refused all clients since late October 2026).
 * LIVE_SOURCE=espn skips the CDN entirely.
 */
export function fallbackFeeds(primary: Feeds, backup: Feeds, startOnBackup = false, log: (m: string) => void = () => {}): Feeds {
  let onBackup = startOnBackup;
  async function via<K extends keyof Feeds>(k: K, args: Parameters<Feeds[K]>): Promise<Awaited<ReturnType<Feeds[K]>>> {
    type Fn = (...a: Parameters<Feeds[K]>) => Promise<Awaited<ReturnType<Feeds[K]>>>;
    if (!onBackup) {
      try {
        return await (primary[k] as Fn)(...args);
      } catch (err) {
        if (!(err instanceof NbaHttpError && err.status === 403)) throw err;
        log(`NBA CDN refused ${k} (403); using ESPN for the rest of this game`);
        onBackup = true;
      }
    }
    return (backup[k] as Fn)(...args);
  }
  return {
    fetchScoreboard: () => via('fetchScoreboard', []),
    fetchPbp: (...a) => via('fetchPbp', a),
    fetchBox: (...a) => via('fetchBox', a),
  };
}

export function nbaPollerDeps(sql: Sql, gameDbId: string, nbaGameId: string): NbaPollerDeps {
  const hub = hubPublisherFromEnv(nbaGameId);
  const log = (msg: string) => console.log(`[live] ${msg}`);
  const feeds = fallbackFeeds(nbaFeeds, espnFeeds(sql, gameDbId, nbaGameId), process.env.LIVE_SOURCE === 'espn', log);
  return {
    ...feeds,
    saveState: (doc) => saveThenPublish(doc, (d) => saveLiveState(sql, gameDbId, d), hub),
    saveMoment: (doc, reason) => saveLiveMoment(sql, gameDbId, doc, reason),
    now: Date.now,
    log,
    hub,
  };
}
